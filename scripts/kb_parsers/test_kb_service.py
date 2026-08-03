"""Tests for the KB HTTP service security guards added in PR-Sec-5.

The service module isn't a kb_parsers module — it lives under
apps/api/knowledge_service.py — but the same importlib bootstrap the
ingest tests use makes it loadable here without standing up the full
service.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent


@pytest.fixture(scope="module")
def kb_service():
    apps_api = _REPO_ROOT / "apps" / "api"
    if str(apps_api) not in sys.path:
        sys.path.insert(0, str(apps_api))
    return importlib.import_module("knowledge_service")


# --------------------------------------------------------------- _filter_where


def test_filter_where_keeps_known_scalar_keys(kb_service):
    out = kb_service._filter_where(
        {"source_file": "fshd/a.md", "language": "zh", "file_type": "md"}
    )
    assert out == {"source_file": "fshd/a.md", "language": "zh", "file_type": "md"}


def test_filter_where_drops_unknown_keys(kb_service):
    out = kb_service._filter_where({"source_file": "a", "naughty_key": "evil"})
    assert out == {"source_file": "a"}


def test_filter_where_drops_non_scalar_values(kb_service):
    out = kb_service._filter_where(
        {
            "source_file": {"$in": ["a", "b"]},  # Chroma-style operator
            "language": ["zh", "en"],  # array
            "file_type": {"nested": True},
        }
    )
    assert out == {}


def test_filter_where_accepts_basic_scalars(kb_service):
    out = kb_service._filter_where(
        {"language": "zh", "file_type": "pdf", "source_fingerprint": "abc123"}
    )
    assert out == {"language": "zh", "file_type": "pdf", "source_fingerprint": "abc123"}


# --------------------------------------------------------------- _authorise


def test_authorise_returns_true_when_no_token_configured(kb_service, monkeypatch):
    monkeypatch.setattr(kb_service, "_REQUIRED_TOKEN", "")

    class FakeHandler:
        headers = {"Authorization": "Bearer something"}

    assert kb_service._authorise(FakeHandler()) is True


def test_authorise_rejects_missing_bearer_header(kb_service, monkeypatch):
    monkeypatch.setattr(kb_service, "_REQUIRED_TOKEN", "secret-token")

    class FakeHandler:
        headers = {}

    assert kb_service._authorise(FakeHandler()) is False


def test_authorise_rejects_wrong_token(kb_service, monkeypatch):
    monkeypatch.setattr(kb_service, "_REQUIRED_TOKEN", "secret-token")

    class FakeHandler:
        headers = {"Authorization": "Bearer wrong-token"}

    assert kb_service._authorise(FakeHandler()) is False


def test_authorise_accepts_matching_token(kb_service, monkeypatch):
    monkeypatch.setattr(kb_service, "_REQUIRED_TOKEN", "secret-token")

    class FakeHandler:
        headers = {"Authorization": "Bearer secret-token"}

    assert kb_service._authorise(FakeHandler()) is True


def test_authorise_uses_constant_time_compare(kb_service, monkeypatch):
    # Smoke test that `hmac.compare_digest` is on the path (the
    # function should not short-circuit on first mismatch).
    monkeypatch.setattr(kb_service, "_REQUIRED_TOKEN", "a" * 32)

    class FakeHandler:
        headers = {"Authorization": "Bearer " + "b" * 32}

    # Just assert it returns False without raising — hmac.compare_digest
    # raises TypeError on length mismatch; same-length wrong values
    # are the case we care about here.
    assert kb_service._authorise(FakeHandler()) is False


# --------------------------------------------------------------- _hash_phi

def test_hash_phi_is_stable_and_short(kb_service):
    h = kb_service._hash_phi("我 38 岁女性 家族史")
    assert len(h) == 8
    assert kb_service._hash_phi("我 38 岁女性 家族史") == h
    assert kb_service._hash_phi("") == ""


def test_hash_phi_does_not_echo_input(kb_service):
    out = kb_service._hash_phi("张三 110101199005203212 13800001234")
    assert "张三" not in out
    assert "110101199005203212" not in out
    assert "13800001234" not in out


# --------------------------------------------------------------- log_message wiring


def test_log_message_is_on_handler_class_not_nested_in_filter_where(kb_service):
    """Round-2 review caught `log_message` indented inside
    `_filter_where` so the override never installed — the default
    BaseHTTPRequestHandler.log_message kept writing per-request lines
    to stderr, bypassing the structured `fshd_kb_service` logger."""
    handler_cls = kb_service.KnowledgeServiceHandler
    assert hasattr(handler_cls, 'log_message')
    assert 'log_message' in handler_cls.__dict__, (
        'log_message must be defined on KnowledgeServiceHandler, '
        'not inherited from BaseHTTPRequestHandler'
    )

    # _filter_where must NOT carry log_message as a stray attribute
    # (the bug we just fixed).
    assert not hasattr(kb_service._filter_where, 'log_message'), (
        'log_message should not be a nested function inside _filter_where'
    )

    # Behavioural smoke: calling the override routes through `logger`.
    calls = []

    class _FakeLogger:
        def info(self, fmt, *args):
            calls.append(fmt % args)

    original_logger = kb_service.logger
    kb_service.logger = _FakeLogger()
    try:
        class _FakeHandler:
            def address_string(self):
                return '127.0.0.1'

        handler_cls.log_message(_FakeHandler(), '"%s %s" %d', 'GET', '/health', 200)
    finally:
        kb_service.logger = original_logger

    assert any('127.0.0.1' in line and '/health' in line for line in calls), (
        f'expected access log to land via logger; got {calls!r}'
    )


def test_health_paths_constant_removed(kb_service):
    """The unused `_HEALTH_PATHS` constant was removed because it
    introduced confusing intent without a caller."""
    assert not hasattr(kb_service, '_HEALTH_PATHS')


# --------------------------------------------------------------- _check_prod_token_safety


def test_prod_token_safety_rejects_placeholder_under_node_env_production(kb_service):
    """PR #55 review: the docker-compose default placeholder
    `dev-only-local-token-NOT-FOR-PROD` is non-empty, so the
    original "not _REQUIRED_TOKEN" check would NOT fire even if a
    prod deploy forgot to override it. The new second guard catches
    exactly this: NODE_ENV=production AND token == placeholder."""
    err = kb_service._check_prod_token_safety(
        host='0.0.0.0',
        token=kb_service._DEV_PLACEHOLDER_TOKEN,
        node_env='production',
    )
    assert err is not None
    assert 'placeholder' in err.lower()
    assert 'production' in err.lower()


def test_prod_token_safety_accepts_placeholder_in_dev_compose(kb_service):
    """The same placeholder MUST be accepted when NODE_ENV is not
    production — that's the whole point of the docker-compose dev
    fallback, so `docker compose up` keeps working without anyone
    touching .env."""
    # Empty NODE_ENV (typical dev compose-up)
    err_dev = kb_service._check_prod_token_safety(
        host='0.0.0.0',
        token=kb_service._DEV_PLACEHOLDER_TOKEN,
        node_env='',
    )
    assert err_dev is None

    # Explicit development NODE_ENV
    err_dev2 = kb_service._check_prod_token_safety(
        host='0.0.0.0',
        token=kb_service._DEV_PLACEHOLDER_TOKEN,
        node_env='development',
    )
    assert err_dev2 is None


def test_prod_token_safety_accepts_real_secret_in_production(kb_service):
    """A genuine random secret + NODE_ENV=production should start
    cleanly (the happy path the bot's verification covers)."""
    err = kb_service._check_prod_token_safety(
        host='0.0.0.0',
        token='3f8a9b2c1d4e5f60718293a4b5c6d7e8',  # mimicking openssl rand -hex
        node_env='production',
    )
    assert err is None


def test_prod_token_safety_original_pr_51_guard_still_fires(kb_service):
    """The PR #51 "0.0.0.0 with empty token" check must still work —
    don't lose it under the new second-guard refactor."""
    err = kb_service._check_prod_token_safety(
        host='0.0.0.0',
        token='',
        node_env='',  # not production yet — host alone is enough
    )
    assert err is not None
    assert '0.0.0.0' in err

    err_prod = kb_service._check_prod_token_safety(
        host='127.0.0.1',  # loopback, but NODE_ENV is prod
        token='',
        node_env='production',
    )
    assert err_prod is not None


def test_prod_token_safety_loopback_dev_without_token_is_fine(kb_service):
    """Plain loopback dev (no 0.0.0.0, no NODE_ENV=production, no
    token) is the documented "minimal dev" path. Must not require
    a token."""
    err = kb_service._check_prod_token_safety(
        host='127.0.0.1',
        token='',
        node_env='',
    )
    assert err is None


# --------------------------------------------------------------- cross-file drift

def test_dev_placeholder_matches_docker_compose_yaml(kb_service):
    """Pin docker-compose ↔ Python constant consistency.

    The Python `_DEV_PLACEHOLDER_TOKEN` literal and the
    `${KB_SERVICE_TOKEN:-...}` fallback in `docker-compose.yml`
    must stay byte-identical, and both compose services must use
    the same fallback. Without this assertion two silent failures
    can ship:

      A) Someone edits docker-compose.yml's default to a new
         string and forgets knowledge_service.py. A prod deploy
         that omits the env override now boots with the new
         compose default — `_check_prod_token_safety` no longer
         recognises it as the placeholder, the placeholder guard
         doesn't fire, and the service comes up authenticating
         against a string that's effectively a public secret.

      B) Someone edits the Python constant and forgets the YAML.
         Same end result the other direction.

      C) Someone edits only one of the two compose services'
         fallbacks — the api → kb fetch then 401s because the two
         containers disagree on what the default token is.

    The previous round of this PR claimed the test imports caught
    this drift; they didn't (they compared the Python constant to
    itself). This one actually reads the YAML.
    """
    import re

    yml_path = _REPO_ROOT / 'docker-compose.yml'
    yml_text = yml_path.read_text(encoding='utf-8')

    # Strip comment lines first — the compose file documents the
    # contract in a comment block that contains the literal
    # `${KB_SERVICE_TOKEN:-...}` form (with ellipsis), which would
    # otherwise show up as a fake third match.
    non_comment = '\n'.join(
        line for line in yml_text.splitlines() if not line.lstrip().startswith('#')
    )

    # We expect exactly two `${KB_SERVICE_TOKEN:-<default>}` forms
    # — one on the kb-service container, one on the api container.
    # Both must carry the same default; that default must equal
    # the Python placeholder constant.
    matches = re.findall(r'\$\{KB_SERVICE_TOKEN:-([^}]+)\}', non_comment)
    assert len(matches) == 2, (
        f'expected 2 ${{KB_SERVICE_TOKEN:-...}} fallbacks in docker-compose.yml, '
        f'got {len(matches)} — has the compose file been restructured? '
        f'(if a future PR drops the `:-default` form, this assertion intentionally trips '
        f'so the placeholder guard contract gets reviewed)'
    )
    assert matches[0] == matches[1], (
        f'kb-service and api containers disagree on the KB_SERVICE_TOKEN default: '
        f'{matches[0]!r} vs {matches[1]!r} — the api → kb_service request would 401 '
        f'on a fresh `docker compose up` with no env override'
    )
    assert matches[0] == kb_service._DEV_PLACEHOLDER_TOKEN, (
        f'docker-compose.yml KB_SERVICE_TOKEN default ({matches[0]!r}) does not '
        f'match knowledge_service._DEV_PLACEHOLDER_TOKEN '
        f'({kb_service._DEV_PLACEHOLDER_TOKEN!r}). A prod deploy that forgets '
        f'to override KB_SERVICE_TOKEN would bypass the placeholder guard '
        f'because the runtime token would no longer equal the constant the '
        f'guard compares against.'
    )


# --------------------------------------------------------------- staging parity


def test_prod_token_safety_rejects_placeholder_under_node_env_staging(kb_service):
    """`staging` is production-like on the Node side (env.ts defines
    isProductionLike as production||staging and refuses to boot on this
    same placeholder), but this guard used to check only 'production'.

    The window that opened: the deploy runbook brings kb-service up
    BEFORE the api, so on a staging deploy that forgot to override
    KB_SERVICE_TOKEN, the KB came up happily authenticating against a
    token published in the public repo — and with the documented
    KB_SERVICE_PUBLISH_HOST=0.0.0.0 knob that is the whole medical
    corpus, reachable by anyone, for as long as it takes the api to
    start and fail."""
    err = kb_service._check_prod_token_safety(
        host='127.0.0.1',
        token=kb_service._DEV_PLACEHOLDER_TOKEN,
        node_env='staging',
    )
    assert err is not None
    assert 'placeholder' in err.lower()
    assert 'staging' in err.lower()


def test_prod_token_safety_requires_token_under_node_env_staging(kb_service):
    """Guard 1 (empty token) must cover staging too, not just guard 2."""
    err = kb_service._check_prod_token_safety(host='127.0.0.1', token='', node_env='staging')
    assert err is not None


def test_prod_token_safety_staging_accepts_real_secret(kb_service):
    err = kb_service._check_prod_token_safety(
        host='0.0.0.0',
        token='3f8a9b2c1d4e5f60718293a4b5c6d7e8',
        node_env='staging',
    )
    assert err is None


# --------------------------------------------------------------- _clamp_search_params


def test_clamp_search_params_caps_runaway_values(kb_service):
    """`/multi` reads these straight off the request body and the
    pgvector backend applies only a floor. Without a ceiling a 200-byte
    body asks for a five-million-row LIMIT across hundreds of queries."""
    top_k, fetch_k, max_per_source, queries = kb_service._clamp_search_params(
        10_000, 5_000_000, 10_000, ['q'] * 400
    )
    assert top_k == kb_service._MAX_TOP_K
    assert fetch_k == kb_service._MAX_FETCH_K
    assert max_per_source == kb_service._MAX_PER_SOURCE
    assert len(queries) == kb_service._MAX_QUERIES


def test_clamp_search_params_leaves_the_real_callers_values_alone(kb_service):
    """medical-kb.ts sends fetch_k=80 / final_n=8 over a handful of
    rewritten queries. The clamp must be invisible to it."""
    assert kb_service._clamp_search_params(8, 80, 4, ['a', 'b', 'c']) == (
        8,
        80,
        4,
        ['a', 'b', 'c'],
    )


def test_clamp_search_params_applies_floors(kb_service):
    """Zero and negative values would make the backend's own max(1, ...)
    the only thing standing between us and a nonsense LIMIT."""
    assert kb_service._clamp_search_params(0, -5, -1, []) == (1, 1, 1, [])


# --------------------------------------------------------------- empty-corpus gate


class _FakeBackend:
    """Stands in for PgVectorBackend without a database. Only the two
    attributes `_corpus_chunk_count` reaches for."""

    def __init__(self, count=None, table_name='kb_chunks', raises=None):
        self._count = count
        self.table_name = table_name
        self._raises = raises
        self.pool = self if count is not None or raises else None
        self.queries = []

    # --- minimal psycopg pool/connection/cursor surface ---
    def connection(self, timeout=None):
        # `timeout` is required: the probe passes one so a busy pool
        # cannot stall a healthcheck past its 2.5s budget, and a fake
        # that rejected the kwarg would hide a regression there.
        assert timeout is not None
        return self

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def execute(self, sql):
        if self._raises:
            raise self._raises
        self.queries.append(sql)

    def fetchone(self):
        return (self._count,)

    def list_all_source_files(self):
        raise NotImplementedError('fake backend')


class _FakeKb:
    def __init__(self, backend):
        self.backend = backend


def _reset_corpus_probe(kb_service):
    kb_service._corpus_probe['count'] = None
    kb_service._corpus_probe['checked_at'] = None


def test_corpus_chunk_count_reads_the_backend_table(kb_service):
    _reset_corpus_probe(kb_service)
    backend = _FakeBackend(count=12352)
    assert kb_service._corpus_chunk_count(_FakeKb(backend)) == 12352
    assert backend.queries == ['SELECT count(*) FROM kb_chunks']


def test_corpus_chunk_count_caches_a_populated_corpus(kb_service):
    """A populated corpus is terminal — the per-15s container
    healthcheck must not put a count(*) on the database forever."""
    _reset_corpus_probe(kb_service)
    backend = _FakeBackend(count=5)
    kb = _FakeKb(backend)
    for _ in range(5):
        assert kb_service._corpus_chunk_count(kb) == 5
    assert len(backend.queries) == 1


def test_corpus_chunk_count_reports_none_when_the_probe_fails(kb_service):
    """A DB blip is not an empty corpus. Returning 0 here would fail
    readiness — and the api gates its own readiness on ours, so a
    transient error would take the whole stack down."""
    _reset_corpus_probe(kb_service)
    backend = _FakeBackend(count=1, raises=RuntimeError('connection refused'))
    assert kb_service._corpus_chunk_count(_FakeKb(backend)) is None


def test_corpus_chunk_count_rejects_an_unsafe_table_name(kb_service):
    """The count has to f-string the identifier into SQL. This file must
    not inherit trust from PgVectorBackend's constructor validation."""
    _reset_corpus_probe(kb_service)
    backend = _FakeBackend(count=1, table_name='kb_chunks; DROP TABLE users--')
    # Falls through to list_all_source_files(), which the fake refuses.
    assert kb_service._corpus_chunk_count(_FakeKb(backend)) is None
    assert backend.queries == []


def _force_warm(kb_service, backend):
    """Mark the module as if the embedding model finished loading, with
    the given backend behind it. Avoids constructing a real
    FSHDKnowledgeBase (which would download ~2 GB of bge-m3 weights)."""
    kb_service.kb_instance = _FakeKb(backend)
    kb_service.kb_ready_event.set()
    kb_service.kb_state['status'] = 'ready'
    _reset_corpus_probe(kb_service)


def test_readiness_reports_empty_corpus_when_the_table_has_no_rows(kb_service):
    """The gap this closes: every health check went green the moment the
    embedding model loaded, so a fresh environment with an unpopulated
    kb_chunks came up fully healthy while search_medical_kb returned
    nothing and the model told every patient FSHD has nothing on file."""
    original = kb_service.kb_instance
    try:
        _force_warm(kb_service, _FakeBackend(count=0))
        status_code, status, state = kb_service._readiness()
        assert status_code == 503
        assert status == 'empty_corpus'
        assert state['corpusChunks'] == 0
    finally:
        kb_service.kb_instance = original
        _reset_corpus_probe(kb_service)


def test_readiness_is_ready_with_a_populated_corpus(kb_service):
    original = kb_service.kb_instance
    try:
        _force_warm(kb_service, _FakeBackend(count=12352))
        status_code, status, state = kb_service._readiness()
        assert (status_code, status) == (200, 'ready')
        assert state['corpusChunks'] == 12352
    finally:
        kb_service.kb_instance = original
        _reset_corpus_probe(kb_service)


def test_readiness_stays_ready_when_the_corpus_size_is_unknown(kb_service):
    """Fail-open on an inconclusive probe, on purpose: the gate exists
    for an empty corpus, not to add a new way for the KB to take the api
    down."""
    original = kb_service.kb_instance
    try:
        _force_warm(kb_service, _FakeBackend(count=1, raises=RuntimeError('boom')))
        status_code, status, state = kb_service._readiness()
        assert (status_code, status) == (200, 'ready')
        assert state['corpusChunks'] is None
    finally:
        kb_service.kb_instance = original
        _reset_corpus_probe(kb_service)


# --------------------------------------------------------------- concurrency


def test_server_is_threaded(kb_service):
    """/health/ready used to queue behind an in-flight /multi on the
    single-threaded HTTPServer — and the api gives that probe 2.5s while
    a search may take 30s, so one patient question was enough to make
    the api report the KB as errored."""
    import http.server

    source = (_REPO_ROOT / 'apps' / 'api' / 'knowledge_service.py').read_text(encoding='utf-8')
    assert 'ThreadingHTTPServer((host, port)' in source
    assert hasattr(http.server, 'ThreadingHTTPServer')


def test_search_concurrency_is_bounded(kb_service):
    """Threading alone would be reckless: every concurrent search runs a
    bge-m3 CPU embed and borrows from a pool whose default max_size is
    2. The expensive path stays bounded; only the cheap paths overtake."""
    assert kb_service._MAX_CONCURRENT_SEARCHES >= 1
    assert kb_service._SEARCH_SLOTS._initial_value == kb_service._MAX_CONCURRENT_SEARCHES
    # Must stay under medical-kb.ts's own 30s /multi timeout, or we hold
    # a thread producing a response the caller already abandoned.
    assert kb_service._SEARCH_QUEUE_WAIT_SECONDS < 30


def test_sigterm_handler_is_installed_in_main(kb_service):
    """python is PID 1 in the kb image and CPython installs no SIGTERM
    handler, so the kernel dropped the signal and every `docker compose
    stop` / `--force-recreate kb-service` stalled the full grace period
    before SIGKILL."""
    source = (_REPO_ROOT / 'apps' / 'api' / 'knowledge_service.py').read_text(encoding='utf-8')
    assert 'signal.signal(signal.SIGTERM' in source


# --------------------------------------------------------------- HF mirror default


def test_hf_endpoint_defaults_to_the_china_mirror(kb_service):
    """huggingface.co is unreachable from the mainland-China servers
    this deploys on, and Dockerfile.kb already defaults pip to the
    Tsinghua mirror for exactly that reason. The model download must not
    default the other way — a blocked bge-m3 pull fails the kb
    healthcheck, which fails api startup, which fails web startup."""
    import os as _os

    assert _os.environ.get('HF_ENDPOINT') == 'https://hf-mirror.com'


def test_hf_endpoint_is_set_before_the_knowledge_import(kb_service):
    """Ordering matters: huggingface_hub snapshots HF_ENDPOINT into its
    constants at import time, and knowledge.py resolves KB_FINAL_N et al
    at module scope. Both must happen after _load_env()."""
    import re

    source = (_REPO_ROOT / 'apps' / 'api' / 'knowledge_service.py').read_text(encoding='utf-8')
    # Anchor on real statements, not the prose above them — the comment
    # explaining this ordering quotes the import line verbatim.
    kb_import = re.search(r'^from knowledge import ', source, re.MULTILINE)
    load_env = re.search(r'^_load_env\(\)$', source, re.MULTILINE)
    hf_default = re.search(r"^os\.environ\.setdefault\('HF_ENDPOINT'", source, re.MULTILINE)
    assert kb_import and load_env and hf_default
    assert load_env.start() < kb_import.start()
    assert hf_default.start() < kb_import.start()


def test_corpus_probe_is_retried_after_the_recheck_window(kb_service):
    """An empty verdict must NOT be terminal — an operator running
    `npm run kb:ingest` against a running service has to see readiness
    flip without restarting the container."""
    _reset_corpus_probe(kb_service)
    backend = _FakeBackend(count=0)
    kb = _FakeKb(backend)
    assert kb_service._corpus_chunk_count(kb) == 0
    # Second call inside the window is served from cache.
    assert kb_service._corpus_chunk_count(kb) == 0
    assert len(backend.queries) == 1
    # Age the probe past the window; the corpus has since been ingested.
    kb_service._corpus_probe['checked_at'] -= kb_service._CORPUS_RECHECK_SECONDS + 1
    backend._count = 12352
    assert kb_service._corpus_chunk_count(kb) == 12352
    assert len(backend.queries) == 2
    _reset_corpus_probe(kb_service)


def test_corpus_probe_runs_on_a_freshly_booted_host(kb_service):
    """`checked_at` starts as None rather than 0.0 on purpose: monotonic's
    epoch is arbitrary (host boot time on Linux), so a 0.0 sentinel would
    read as 'just probed' on a VM that booted seconds ago and the first
    probe would be skipped."""
    assert kb_service._corpus_probe['checked_at'] in (None, ) or isinstance(
        kb_service._corpus_probe['checked_at'], float
    )
    _reset_corpus_probe(kb_service)
    assert kb_service._corpus_probe['checked_at'] is None
    backend = _FakeBackend(count=7)
    assert kb_service._corpus_chunk_count(_FakeKb(backend)) == 7
    _reset_corpus_probe(kb_service)
