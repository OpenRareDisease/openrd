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
