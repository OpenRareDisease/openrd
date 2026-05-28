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
