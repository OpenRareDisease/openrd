import json
import logging
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

from knowledge import FSHDKnowledgeBaseCloud

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('fshd_kb_service')

kb_instance = None


def _safe_int(value, default):
    try:
        return int(value)
    except Exception:
        return default


def _get_kb():
    global kb_instance
    if kb_instance is None:
        kb_instance = FSHDKnowledgeBaseCloud()
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
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/health':
            try:
                _get_kb()
                self._send_json(200, {'status': 'ok'})
            except Exception as exc:
                logger.exception('health check failed')
                self._send_json(500, {'status': 'error', 'message': str(exc)})
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
    server = HTTPServer((host, port), KnowledgeServiceHandler)
    logger.info('Knowledge service listening on http://%s:%s', host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info('Shutting down knowledge service')
        server.server_close()
