import hashlib
import hmac
import json
import logging
import os
import re
import signal
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from pathlib import Path

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


# `_load_env()` and the HF default below run BEFORE `from knowledge import
# ...` on purpose. knowledge.py resolves KB_FINAL_N / KB_FETCH_K /
# KB_MAX_PER_SOURCE at module-import time, and the sentence-transformers
# stack snapshots HF_ENDPOINT into `huggingface_hub.constants` the first
# time it is imported. With the old ordering (import first, load .env
# second) anything that only lived in the repo-root .env was read after
# the value had already been frozen, so the file silently did nothing.
_load_env()

#: This platform deploys on mainland-China servers, where huggingface.co
#: is unreachable — `SentenceTransformer('BAAI/bge-m3')` blocks on
#: "Network is unreachable" until the container healthcheck gives up, and
#: because the api waits on kb-service being healthy and web waits on the
#: api, the ENTIRE site fails to come up over a model download. The same
#: decision was already taken one layer down for pip (Dockerfile.kb pins
#: PIP_INDEX_URL to the Tsinghua mirror for exactly this reason); this
#: makes the model download agree with it instead of defaulting the other
#: way. Override with HF_ENDPOINT=https://huggingface.co when deploying
#: outside the GFW — `setdefault` means an explicitly-provided value
#: (shell env, .env, or the compose `environment:` block) always wins.
os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')

from knowledge import FSHDKnowledgeBase  # noqa: E402  (must follow _load_env)

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
    # Read the four fields under the same lock every writer holds. Since
    # the server went multi-threaded (see ThreadingHTTPServer below) a
    # probe thread can otherwise observe a half-applied transition — e.g.
    # status='ready' with the previous run's last_error still attached —
    # and that snapshot is forwarded verbatim into the api's /healthz
    # body, so a torn read becomes a misleading operator-facing report.
    # The lock is only ever held for a handful of assignments (the slow
    # FSHDKnowledgeBase() construction happens outside it), so this
    # cannot serialise probes behind the warmup.
    with kb_init_lock:
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


#: How long a *confirmed empty* or *unknown* corpus verdict is cached
#: before the next probe. A non-empty verdict is cached forever (see
#: `_corpus_chunk_count`), so the steady state costs zero queries; this
#: only controls how fast the service notices `npm run kb:ingest`
#: finishing while it is already running, so it can be generous.
_CORPUS_RECHECK_SECONDS = 30

#: Same identifier shape PgVectorBackend validates `table_name` against
#: in its constructor. Re-checked here because the count below has to
#: f-string the table name into SQL (psycopg cannot bind identifiers) and
#: a second file interpolating a value must not inherit trust from the
#: first one's validation.
_SQL_IDENTIFIER_RE = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,62}')

#: Ceiling on how long the count may wait for a pool connection. The
#: pgvector pool defaults to max_size=2 and psycopg's own pool timeout is
#: 30s, so without this a probe issued while both connections are busy
#: with searches would stall far past the api's 2.5s HEALTHCHECK_TIMEOUT_MS
#: — reintroducing, on a different path, exactly the queueing that moving
#: to a threaded server was meant to remove. Giving up early just yields
#: "unknown", which is retried _CORPUS_RECHECK_SECONDS later.
_CORPUS_PROBE_TIMEOUT_SECONDS = 2.0

_corpus_probe_lock = threading.Lock()
#: `checked_at=None` means "never probed". Don't initialise it to 0.0 and
#: compare against time.monotonic(): monotonic's epoch is arbitrary and on
#: Linux is host boot time, so a stack coming up on a freshly booted VM
#: would read 0.0 as "probed a few seconds ago" and skip the first probe.
_corpus_probe = {'count': None, 'checked_at': None}


def _corpus_chunk_count(kb):
    """Return the number of rows in the KB corpus table, or None when it
    cannot be determined.

    None means "don't know" (backend without a countable table, DB
    hiccup) and is deliberately distinct from 0 — readiness only fails on
    a *confirmed* zero, never on an inconclusive probe.
    """
    with _corpus_probe_lock:
        cached = _corpus_probe['count']
        if cached:
            # Non-zero is terminal: a populated corpus is never re-probed,
            # so the per-15s healthcheck does not put a count(*) on the
            # database for the entire life of the container.
            return cached
        checked_at = _corpus_probe['checked_at']
        if checked_at is not None and time.monotonic() - checked_at < _CORPUS_RECHECK_SECONDS:
            return cached

        count = None
        backend = getattr(kb, 'backend', None)
        pool = getattr(backend, 'pool', None)
        table = getattr(backend, 'table_name', None)
        try:
            if pool is not None and isinstance(table, str) and _SQL_IDENTIFIER_RE.fullmatch(table):
                with pool.connection(timeout=_CORPUS_PROBE_TIMEOUT_SECONDS) as conn:
                    with conn.cursor() as cur:
                        cur.execute(f'SELECT count(*) FROM {table}')  # noqa: S608 — identifier re-validated above
                        row = cur.fetchone()
                count = int(row[0]) if row else None
            elif backend is not None:
                # Backends with no SQL pool (chroma_cloud) — fall back to
                # the one enumeration the VectorBackend interface exposes.
                # It counts distinct source files rather than chunks, which
                # is the wrong number to report but the right answer to the
                # only question this gate asks: is there anything at all?
                count = len(backend.list_all_source_files())
        except NotImplementedError:
            count = None
        except Exception as exc:
            # A probe failure is not an empty corpus. Log it and report
            # "unknown" so a transient DB blip cannot take the whole
            # stack out (the api gates its own readiness on ours).
            logger.warning('corpus size probe failed: %s', exc)
            count = None

        _corpus_probe['count'] = count
        _corpus_probe['checked_at'] = time.monotonic()
        return count


def _readiness():
    """Compute the /health/ready and /health verdict.

    Returns `(http_status, status_string, state_dict)`.

    Three outcomes instead of the previous two:

      * `ready`        — model warm AND the corpus has rows.
      * `warming`      — the embedding model is still loading (unchanged).
      * `empty_corpus` — model warm, but `kb_chunks` is confirmed empty.

    `empty_corpus` returns 503, i.e. it fails readiness rather than
    reporting a green-but-degraded state. That choice costs something and
    was made deliberately: the api hard-gates its own /healthz/ready on
    this endpoint, so a 503 here keeps a fresh environment from coming up
    at all. The alternative is worse. A warm model over an empty corpus
    is not a degraded KB, it is a KB that answers every single patient
    question about their own disease with zero chunks — and the api
    renders zero-chunks-with-no-failure-reason as 「（无内容）」, which is
    indistinguishable from "the literature genuinely says nothing about
    this". Silently telling FSHD patients there is nothing on file is not
    a state this service should report as healthy. An operator who hits
    this gets a loud, specific, one-command fix (`npm run kb:ingest`, or
    the pg_dump/psql restore in the deploy runbook §3.5); an operator who
    does not get this gate finds out from a patient.

    A corpus size that cannot be determined (DB blip, backend without a
    countable table) is NOT treated as empty — see `_corpus_chunk_count`.
    """
    _ensure_kb_warmup_started()
    state = _snapshot_kb_state()
    if not (kb_ready_event.is_set() and kb_instance is not None):
        return 503, 'warming', state

    count = _corpus_chunk_count(kb_instance)
    state['corpusChunks'] = count
    if count == 0:
        logger.error(
            'KB corpus is empty: the embedding model is warm but the vector '
            'table has 0 rows, so every retrieval will return nothing. Run '
            '`npm run kb:ingest` (or restore the corpus per the deploy '
            'runbook) before serving traffic.'
        )
        return 503, 'empty_corpus', state

    return 200, 'ready', state


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


#: Server-side ceilings on the search knobs `/multi` accepts from its
#: caller. `_MAX_REQUEST_BYTES` bounds the request; these bound the
#: *work*. Without them a 200-byte body can ask for `fetch_k: 5_000_000`
#: across 400 queries, which becomes 400 embeddings plus 400 pgvector
#: scans with a five-million-row LIMIT — the pgvector backend applies
#: only a floor (`max(1, fetch_k)`), no ceiling. The only real caller
#: sends fetch_k=80 / final_n=8 over a handful of rewritten queries, so
#: these caps are an order of magnitude above anything legitimate.
_MAX_FETCH_K = 500
_MAX_TOP_K = 100
_MAX_PER_SOURCE = 50
_MAX_QUERIES = 16


#: How many `/multi` searches may run at once, and how long a request
#: waits for a slot before being shed.
#:
#: The server is threaded (see ThreadingHTTPServer in `__main__`) so a
#: health probe can never queue behind an in-flight search, but threading
#: alone would be reckless here: each concurrent search runs a bge-m3 CPU
#: embed (multi-gigabyte torch process, and no compose service declares a
#: mem_limit) and then borrows a connection from a pool whose default
#: max_size is 2. Unbounded threads would turn a burst of patient
#: questions into CPU thrash plus pool-timeout errors. The semaphore
#: keeps the *expensive* path serialised roughly as it was before while
#: leaving the *cheap* paths (health, 401s, malformed bodies) genuinely
#: concurrent — which is the only thing the healthcheck needed.
#:
#: Raise KB_MAX_CONCURRENT_SEARCHES together with KB_PG_POOL_MAX; leaving
#: them out of step just moves the queue into psycopg's pool timeout.
_MAX_CONCURRENT_SEARCHES = max(1, _safe_int(os.getenv('KB_MAX_CONCURRENT_SEARCHES', '2'), 2))
#: Must stay below the caller's own 30s /multi timeout in medical-kb.ts,
#: or we hold a thread producing a response the api has already aborted.
_SEARCH_QUEUE_WAIT_SECONDS = max(1, _safe_int(os.getenv('KB_SEARCH_QUEUE_WAIT_SECONDS', '20'), 20))
_SEARCH_SLOTS = threading.BoundedSemaphore(_MAX_CONCURRENT_SEARCHES)


def _clamp_search_params(top_k, fetch_k, max_per_source, queries):
    """Clamp caller-supplied search knobs into the supported range.

    Returns `(top_k, fetch_k, max_per_source, queries)`. Over-long query
    lists are truncated rather than rejected: the caller is the api's
    query-rewriter, and dropping the tail of an over-eager rewrite still
    answers the patient's question, whereas a 4xx loses the whole turn.
    """
    top_k = max(1, min(int(top_k), _MAX_TOP_K))
    fetch_k = max(1, min(int(fetch_k), _MAX_FETCH_K))
    max_per_source = max(1, min(int(max_per_source), _MAX_PER_SOURCE))
    if len(queries) > _MAX_QUERIES:
        queries = queries[:_MAX_QUERIES]
    return top_k, fetch_k, max_per_source, queries


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
            status_code, status, state = _readiness()
            self._send_json(status_code, {'status': status, 'service': 'knowledge-base', 'state': state})
            return

        if parsed.path == '/health':
            status_code, status, state = _readiness()
            self._send_json(status_code, {'status': status, 'state': state})
            return

        self._send_json(404, {'error': 'not_found'})

    def do_POST(self):
        parsed = urlparse(self.path)
        # Default-deny on POST: every POST path goes through the
        # auth check unless explicitly listed as public. The legacy
        # `if path in _AUTH_REQUIRED_PATHS` form was structurally
        # tautological because `parsed.path != '/multi'` already
        # short-circuits above and `/multi` is the only entry in
        # the set — flipping to default-deny means a future
        # writable endpoint can't ship without explicitly opting
        # OUT of auth (no public POST exists today).
        _PUBLIC_POST_PATHS = frozenset()  # nothing public on POST
        if not _authorise(self) and parsed.path not in _PUBLIC_POST_PATHS:
            self._send_json(401, {'error': 'unauthorized'})
            return

        if parsed.path != '/multi':
            self._send_json(404, {'error': 'not_found'})
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
        top_k, fetch_k, max_per_source, queries = _clamp_search_params(
            top_k, fetch_k, max_per_source, queries
        )

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
        if not _SEARCH_SLOTS.acquire(timeout=_SEARCH_QUEUE_WAIT_SECONDS):
            # Shed instead of queueing forever. The caller
            # (medical-kb.ts) gives /multi 30s; holding a request past
            # that just burns a thread on a response nobody will read,
            # and the api turns a 503 here into the honest 「检索失败」
            # context line rather than silently answering with no
            # sources.
            logger.warning(
                'search rejected: all %d slots busy after %ss (request_id=%s)',
                _MAX_CONCURRENT_SEARCHES,
                _SEARCH_QUEUE_WAIT_SECONDS,
                request_id,
            )
            self._send_json(503, {'error': 'kb_busy', 'request_id': request_id})
            return
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
        finally:
            _SEARCH_SLOTS.release()

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


#: The dev-only fallback string `docker-compose.yml` interpolates
#: when neither the shell env nor the .env file provides a real
#: `KB_SERVICE_TOKEN`. Pinned here so the prod safety check can refuse
#: to start when this exact placeholder shows up under NODE_ENV=
#: production — without that check, a prod deploy that forgot to
#: inject a real secret would silently run with the public placeholder
#: (visible in the public repo) and `not _REQUIRED_TOKEN` would not
#: fire because the string is non-empty.
_DEV_PLACEHOLDER_TOKEN = 'dev-only-local-token-NOT-FOR-PROD'


def _check_prod_token_safety(host: str, token: str, node_env: str) -> str | None:
    """Return an error message if the (host, token, NODE_ENV) combo is
    unsafe to start with; return None otherwise.

    Two distinct guards:

      1. "prod-shaped without any token at all" — covers bare-metal
         deploys where someone bound to 0.0.0.0 or flipped
         NODE_ENV=production but forgot to set KB_SERVICE_TOKEN.
         (This is the original PR #51 check.)

      2. "production using the docker-compose dev placeholder" —
         covers the case where `docker compose up` runs against a
         prod-shape config without overriding the placeholder. The
         compose fallback fills KB_SERVICE_TOKEN with the public
         repo string, so the #1 check (which fires on empty) would
         NOT trigger. This second guard catches that path explicitly.

    Factored out of `__main__` so the test suite can exercise every
    branch without subprocessing the whole server.
    """
    normalised_env = (node_env or '').lower()
    # `staging` counts as production for both guards. env.ts defines
    # isProductionLike as `NODE_ENV === 'production' || === 'staging'`
    # and refuses to boot the Node api on this same placeholder under
    # either — and env.ts's own comment claims it 「Mirrors the KB
    # service's _DEV_PLACEHOLDER_TOKEN guard」, which was untrue while
    # this side checked only 'production'. The gap is not theoretical:
    # the deploy runbook brings kb-service up BEFORE the api, so on a
    # staging deploy that forgot to override KB_SERVICE_TOKEN the KB
    # would start happily on a token published in a public repo and
    # serve the whole medical corpus for the window before the api
    # started and failed.
    _PRODUCTION_LIKE_ENVS = {'production', 'staging'}
    is_prod_like = host == '0.0.0.0' or normalised_env in _PRODUCTION_LIKE_ENVS
    is_production = normalised_env in _PRODUCTION_LIKE_ENVS

    if is_prod_like and not token:
        return (
            'KB_SERVICE_TOKEN is required when binding to 0.0.0.0 or when '
            'NODE_ENV=production/staging. Refusing to start an unauthenticated '
            'KB service on a non-loopback interface.'
        )
    if is_production and token == _DEV_PLACEHOLDER_TOKEN:
        return (
            f'KB_SERVICE_TOKEN is set to the docker-compose dev placeholder '
            f'({_DEV_PLACEHOLDER_TOKEN!r}) in a production environment '
            f'(NODE_ENV={normalised_env}). '
            f'Inject a real secret (e.g. via `openssl rand -hex 32`) through '
            f'the deployment env before starting the KB service.'
        )
    return None


if __name__ == '__main__':
    host = os.getenv('KB_SERVICE_HOST', '127.0.0.1')
    port = _safe_int(os.getenv('KB_SERVICE_PORT', '5010'), 5010)

    _safety_error = _check_prod_token_safety(
        host=host,
        token=_REQUIRED_TOKEN,
        node_env=os.getenv('NODE_ENV') or '',
    )
    if _safety_error is not None:
        raise SystemExit(_safety_error)

    _ensure_kb_warmup_started()
    # ThreadingHTTPServer, not HTTPServer. The single-threaded server
    # handled one request at a time, so /health/ready queued behind any
    # in-flight /multi — and the api gives that probe only
    # HEALTHCHECK_TIMEOUT_MS (2.5s) while a search is allowed 30s. One
    # patient asking a question was enough to make the api report the KB
    # as 'error', flip /api/healthz/ready to 503, and march the api
    # container towards 'unhealthy' with nothing actually wrong. The
    # expensive path stays bounded by _SEARCH_SLOTS; this only lets the
    # cheap paths overtake it.
    server = ThreadingHTTPServer((host, port), KnowledgeServiceHandler)
    #: Don't let a client holding a connection open block shutdown —
    #: SIGTERM already has a 10s grace period before Docker SIGKILLs.
    server.daemon_threads = True
    logger.info(
        'Knowledge service listening on http://%s:%s (auth=%s, max_concurrent_searches=%s, hf_endpoint=%s)',
        host,
        port,
        'on' if _REQUIRED_TOKEN else 'off',
        _MAX_CONCURRENT_SEARCHES,
        os.environ.get('HF_ENDPOINT'),
    )

    def _handle_sigterm(_signum, _frame):
        # python is PID 1 in this container (Dockerfile.kb uses exec-form
        # CMD) and CPython installs a handler for SIGINT but not SIGTERM.
        # A signal with default disposition sent to a namespace's PID 1
        # is dropped by the kernel, so every `docker compose stop/down`
        # and the `--force-recreate kb-service` the China-deploy runbook
        # tells operators to run blocked for the full 10s grace period
        # and then SIGKILLed — server_close() never ran. shutdown() must
        # not be called from the serve_forever thread, hence the thread.
        logger.info('SIGTERM received, shutting down knowledge service')
        threading.Thread(target=server.shutdown, name='kb-shutdown', daemon=True).start()

    signal.signal(signal.SIGTERM, _handle_sigterm)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info('Shutting down knowledge service')
    finally:
        server.server_close()
