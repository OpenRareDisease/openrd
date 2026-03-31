import json
import logging
import os
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
from pathlib import Path

from knowledge import FSHDKnowledgeBaseCloud

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
        instance = FSHDKnowledgeBaseCloud()
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


def _read_json(handler):
    length = int(handler.headers.get('content-length', '0'))
    if length <= 0:
        return None
    raw = handler.rfile.read(length)
    if not raw:
        return None
    return json.loads(raw.decode('utf-8'))


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

        try:
            payload = _read_json(self) or {}
        except Exception:
            self._send_json(400, {'error': 'invalid_json'})
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

        keep_debug = bool(payload.get('keep_debug_fields', False))

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
        except Exception as exc:
            logger.exception('knowledge service failed')
            self._send_json(500, {'error': str(exc)})

    def log_message(self, format, *args):
        logger.info('%s - %s', self.address_string(), format % args)


if __name__ == '__main__':
    host = os.getenv('KB_SERVICE_HOST', '127.0.0.1')
    port = _safe_int(os.getenv('KB_SERVICE_PORT', '5010'), 5010)
    _ensure_kb_warmup_started()
    server = HTTPServer((host, port), KnowledgeServiceHandler)
    logger.info('Knowledge service listening on http://%s:%s', host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info('Shutting down knowledge service')
        server.server_close()
