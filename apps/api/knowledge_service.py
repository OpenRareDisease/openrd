import hashlib
import hmac
import json
import logging
import os
import threading
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
from pathlib import Path

from knowledge import FSHDKnowledgeBase

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def _load_env():
    if load_dotenv is None:
        return
    env_path = Path(__file__).resolve().parents[2] / '.env'
    if env_path.exists():
        load_dotenv(env_path)


_load_env()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('fshd_kb_service')

kb_instance = None
kb_init_lock = threading.Lock()
kb_ready_event = threading.Event()
kb_warmup_thread = None
kb_state = {
    'status': 'idle',
    'started_at': None,
    'ready_at': None,
    'last_error': None,
    'last_traceback': None,
}


def _safe_int(value, default):
    try:
        return int(value)
    except Exception:
        return default


def _now_iso():
    return __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()


def _snapshot_kb_state():
    return {
        'status': kb_state['status'],
        'startedAt': kb_state['started_at'],
        'readyAt': kb_state['ready_at'],
        'lastError': kb_state['last_error'],
    }


def _set_kb_state(status, *, error=None, trace=None):
    kb_state['status'] = status
    if status == 'initializing':
        kb_state['started_at'] = _now_iso()
        kb_state['ready_at'] = None
        kb_state['last_error'] = None
        kb_state['last_traceback'] = None
    elif status == 'ready':
        kb_state['ready_at'] = _now_iso()
        kb_state['last_error'] = None
        kb_state['last_traceback'] = None
    elif status == 'error':
        kb_state['last_error'] = error
        kb_state['last_traceback'] = trace


def _warmup_kb():
    global kb_instance
    try:
        logger.info('Starting knowledge base warmup')
        instance = FSHDKnowledgeBase()
        with kb_init_lock:
            kb_instance = instance
            kb_ready_event.set()
            _set_kb_state('ready')
        logger.info('Knowledge base warmup completed')
    except Exception as exc:
        with kb_init_lock:
          kb_ready_event.clear()
          _set_kb_state('error', error=str(exc), trace=traceback.format_exc(limit=12))
        logger.exception('Knowledge base warmup failed')


def _ensure_kb_warmup_started():
    global kb_warmup_thread
    with kb_init_lock:
        if kb_instance is not None:
            kb_ready_event.set()
            if kb_state['status'] != 'ready':
                _set_kb_state('ready')
            return

        if kb_warmup_thread is not None and kb_warmup_thread.is_alive():
            return

        kb_ready_event.clear()
        _set_kb_state('initializing')
        kb_warmup_thread = threading.Thread(
            target=_warmup_kb,
            name='kb-warmup',
            daemon=True,
        )
        kb_warmup_thread.start()


def _get_kb():
    _ensure_kb_warmup_started()
    if kb_instance is not None:
        return kb_instance

    if not kb_ready_event.wait(timeout=_safe_int(os.getenv('KB_READY_WAIT_SECONDS', '90'), 90)):
        raise RuntimeError('knowledge base is still warming up')

    if kb_instance is None:
        raise RuntimeError(kb_state['last_error'] or 'knowledge base is unavailable')
    return kb_instance


#: Hard cap on request body length. The KB service only accepts a
#: small JSON envelope (a question + a few rewritten queries + a
#: shallow `where` filter); the legacy `int(content-length)` read
#: blindly trusted whatever the client claimed and let a single
#: `Content-Length: 9999999999` allocate gigabytes into the worker.
_MAX_REQUEST_BYTES = 1 * 1024 * 1024  # 1 MiB

#: Token expected on every `/multi` and `/health/*` request as an
#: `Authorization: Bearer <token>` header. The legacy service was
#: bound to `0.0.0.0` with no auth, so any caller reachable to the
#: container (sidecar gap, dev cluster, shared compose network) could
#: enumerate the entire KB. We refuse to start in production mode
#: without one; dev keeps the bare-bones behaviour when the env is
#: explicitly empty.
_REQUIRED_TOKEN = (os.getenv('KB_SERVICE_TOKEN') or '').strip()
#: Paths that require a valid bearer token. Health endpoints stay
#: unauth'd so kube-style probes work without leaking the token into
#: manifests.
_AUTH_REQUIRED_PATHS = ('/multi',)


def _read_json(handler):
    raw_length = handler.headers.get('content-length', '0')
    try:
        length = int(raw_length)
    except ValueError:
        raise _RequestError(400, 'invalid_content_length')
    if length <= 0:
        return None
    if length > _MAX_REQUEST_BYTES:
        # Refuse before allocating anything. Without this cap an
        # attacker could announce `Content-Length: 9_999_999_999`
        # and OOM-kill the worker that holds the warmed singleton.
        raise _RequestError(413, 'request_body_too_large')
    raw = handler.rfile.read(length)
    if not raw:
        return None
    try:
        return json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise _RequestError(400, 'invalid_json')


class _RequestError(Exception):
    """Internal-only signal so handlers can return a clean 4xx with a
    generic envelope and let the central catch log the request id."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


def _hash_phi(value: str) -> str:
    """Stable short hash for logging. Used so an operator can correlate
    a query across logs without the query itself ever appearing in
    INFO-level output."""
    if not value:
        return ''
    return hashlib.sha256(value.encode('utf-8')).hexdigest()[:8]


def _authorise(handler) -> bool:
    """Constant-time bearer-token check. Refuses requests when the
    server has a token configured and the caller didn't supply a
    matching one. Health endpoints stay unauth'd so kube-style probes
    work without leaking the token into manifests."""
    if not _REQUIRED_TOKEN:
        return True
    header = handler.headers.get('Authorization', '') or ''
    if not header.startswith('Bearer '):
        return False
    supplied = header[len('Bearer '):].strip()
    return hmac.compare_digest(supplied, _REQUIRED_TOKEN)


class KnowledgeServiceHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            logger.warning('Client disconnected before response was sent')

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/health/live':
            self._send_json(200, {'status': 'ok', 'service': 'knowledge-base', 'state': _snapshot_kb_state()})
            return

        if parsed.path == '/health/ready':
            _ensure_kb_warmup_started()
            state = _snapshot_kb_state()
            status_code = 200 if kb_ready_event.is_set() and kb_instance is not None else 503
            payload = {'status': 'ready' if status_code == 200 else 'warming', 'service': 'knowledge-base', 'state': state}
            self._send_json(status_code, payload)
            return

        if parsed.path == '/health':
            _ensure_kb_warmup_started()
            state = _snapshot_kb_state()
            status_code = 200 if kb_ready_event.is_set() and kb_instance is not None else 503
            payload = {'status': 'ready' if status_code == 200 else 'warming', 'state': state}
            self._send_json(status_code, payload)
            return

        self._send_json(404, {'error': 'not_found'})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != '/multi':
            self._send_json(404, {'error': 'not_found'})
            return

        if parsed.path in _AUTH_REQUIRED_PATHS and not _authorise(self):
            self._send_json(401, {'error': 'unauthorized'})
            return

        try:
            payload = _read_json(self) or {}
        except _RequestError as exc:
            self._send_json(exc.status, {'error': exc.code})
            return
        except Exception:
            # Defensive — _read_json should only raise _RequestError.
            self._send_json(400, {'error': 'invalid_request'})
            return

        question = str(payload.get('question') or payload.get('q') or '').strip()
        queries = payload.get('queries') or []
        if not isinstance(queries, list):
            queries = []

        top_k = _safe_int(payload.get('top_k') or payload.get('final_n'), int(os.getenv('KB_FINAL_N', '8')))
        fetch_k = _safe_int(payload.get('fetch_k'), int(os.getenv('KB_FETCH_K', '80')))
        max_per_source = _safe_int(payload.get('max_per_source'), int(os.getenv('KB_MAX_PER_SOURCE', '4')))

        where = payload.get('where')
        if where is not None and not isinstance(where, dict):
            where = None
        # Validate `where` keys + values against an allowlist before
        # forwarding into the backend. The legacy code passed the dict
        # through verbatim; pgvector silently dropped complex predicates
        # with a warning (so a caller who *thought* they were filtering
        # got an unfiltered global search) and chroma_cloud accepted
        # any nested $-operator. Now: only scalar-equality on known
        # safe metadata keys passes; anything else is dropped.
        if where:
            where = _filter_where(where)
            if not where:
                where = None

        keep_debug = bool(payload.get('keep_debug_fields', False))

        request_id = uuid.uuid4().hex[:12]
        try:
            kb = _get_kb()
            result = kb.search_multi(
                question=question,
                queries=[str(x) for x in queries if x is not None],
                final_n=top_k,
                fetch_k=fetch_k,
                max_per_source=max_per_source,
                where=where,
                keep_debug_fields=keep_debug,
            )
            self._send_json(200, result)
        except Exception:
            # Log the full traceback server-side with the request id;
            # the client gets a generic envelope so DB credentials,
            # internal file paths, etc. that may live in the exception
            # string never reach the wire.
            logger.exception('knowledge service failed (request_id=%s)', request_id)
            self._send_json(500, {'error': 'kb_internal_error', 'request_id': request_id})

    def log_message(self, format, *args):
        """Route BaseHTTPRequestHandler's per-request access log through
        the structured `fshd_kb_service` logger. Without this override,
        the default impl writes per-request lines straight to stderr,
        bypassing the PHI-hygiene work in knowledge.py (which only
        applies to application logs). The line still includes path /
        status from `format % args`; PHI-bearing query strings would
        be a concern but `/multi` only takes bodies, not query params,
        so the path itself is fixed."""
        logger.info('%s - %s', self.address_string(), format % args)


#: Known-safe metadata keys callers may filter on. Everything else is
#: dropped before reaching either backend's `where`. Keep in sync with
#: the metadata fields the ingest pipeline emits in
#: `_derive_metadata_from_path` + per-chunk extras.
_WHERE_ALLOWED_KEYS = frozenset({
    'source_file',
    'source_fingerprint',
    'folder_path',
    'category',
    'file_type',
    'language',
})


def _filter_where(where: dict) -> dict:
    """Return a copy of `where` restricted to scalar-equality on known
    safe keys. Unknown keys or non-scalar values (dicts with $-operators,
    arrays, etc.) are silently dropped — they were never honoured
    correctly by the pgvector backend anyway, and the chroma path
    accepted them unchecked."""
    safe = {}
    for key, value in where.items():
        if key not in _WHERE_ALLOWED_KEYS:
            continue
        if isinstance(value, (str, int, float, bool)):
            safe[key] = value
    return safe


if __name__ == '__main__':
    host = os.getenv('KB_SERVICE_HOST', '127.0.0.1')
    port = _safe_int(os.getenv('KB_SERVICE_PORT', '5010'), 5010)

    # Refuse to start in production-shaped configs without a
    # `KB_SERVICE_TOKEN`. The combination of "0.0.0.0 bind" + "no
    # auth" was the original P0 — explicit fail-fast prevents a
    # later misconfig from re-creating it.
    is_prod_like = host == '0.0.0.0' or (os.getenv('NODE_ENV') or '').lower() == 'production'
    if is_prod_like and not _REQUIRED_TOKEN:
        raise SystemExit(
            'KB_SERVICE_TOKEN is required when binding to 0.0.0.0 or when '
            'NODE_ENV=production. Refusing to start an unauthenticated KB '
            'service on a non-loopback interface.',
        )

    _ensure_kb_warmup_started()
    server = HTTPServer((host, port), KnowledgeServiceHandler)
    logger.info(
        'Knowledge service listening on http://%s:%s (auth=%s)',
        host,
        port,
        'on' if _REQUIRED_TOKEN else 'off',
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info('Shutting down knowledge service')
        server.server_close()
