"""Pin the resolved KB backend default to pgvector.

Issue #21 flipped the factory default from 'chroma_cloud' to
'pgvector' after the Phase 1.4 ingest landed 12352 chunks locally.
This test catches an accidental revert (e.g. someone adding back a
`KB_BACKEND` fallback or re-wiring the factory) without bringing up
a real Postgres.

We don't actually instantiate either backend -- both have heavy
import-time / connect-time work. We just inspect the factory's
resolved name via a tiny monkey-patched factory that captures the
argument both code paths would have used.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
_API_ROOT = _HERE.parent.parent / "apps" / "api"


@pytest.fixture(scope="module")
def factory_mod():
    if str(_API_ROOT) not in sys.path:
        sys.path.insert(0, str(_API_ROOT))
    return importlib.import_module("kb_backends.factory")


def test_create_backend_defaults_to_pgvector(monkeypatch, factory_mod):
    """No env override + no explicit arg => the factory should pick
    pgvector. We capture which branch the factory entered by
    monkey-patching the two backend constructors before they get
    imported by the lazy `from .pgvector import ...`."""
    monkeypatch.delenv("KB_BACKEND", raising=False)

    captured = {}

    class _StubPg:
        def __init__(self):  # pragma: no cover
            captured["picked"] = "pgvector"

    class _StubChroma:
        def __init__(self):  # pragma: no cover
            captured["picked"] = "chroma_cloud"

    pg_mod = importlib.import_module("kb_backends.pgvector")
    chroma_mod = importlib.import_module("kb_backends.chroma_cloud")
    monkeypatch.setattr(pg_mod, "PgVectorBackend", _StubPg)
    monkeypatch.setattr(chroma_mod, "ChromaCloudBackend", _StubChroma)

    factory_mod.create_backend()
    assert captured["picked"] == "pgvector"


def test_create_backend_honours_explicit_chroma_arg(monkeypatch, factory_mod):
    """`KB_BACKEND=chroma_cloud` (or explicit arg) is the documented
    rollback path; it must keep working after the default flip."""
    captured = {}

    class _StubPg:
        def __init__(self):  # pragma: no cover
            captured["picked"] = "pgvector"

    class _StubChroma:
        def __init__(self):
            captured["picked"] = "chroma_cloud"

    pg_mod = importlib.import_module("kb_backends.pgvector")
    chroma_mod = importlib.import_module("kb_backends.chroma_cloud")
    monkeypatch.setattr(pg_mod, "PgVectorBackend", _StubPg)
    monkeypatch.setattr(chroma_mod, "ChromaCloudBackend", _StubChroma)

    factory_mod.create_backend("chroma_cloud")
    assert captured["picked"] == "chroma_cloud"


def test_create_backend_env_override(monkeypatch, factory_mod):
    monkeypatch.setenv("KB_BACKEND", "chroma_cloud")
    captured = {}

    class _StubPg:
        def __init__(self):  # pragma: no cover
            captured["picked"] = "pgvector"

    class _StubChroma:
        def __init__(self):
            captured["picked"] = "chroma_cloud"

    pg_mod = importlib.import_module("kb_backends.pgvector")
    chroma_mod = importlib.import_module("kb_backends.chroma_cloud")
    monkeypatch.setattr(pg_mod, "PgVectorBackend", _StubPg)
    monkeypatch.setattr(chroma_mod, "ChromaCloudBackend", _StubChroma)

    factory_mod.create_backend()
    assert captured["picked"] == "chroma_cloud"


def test_create_backend_rejects_unknown(factory_mod):
    with pytest.raises(RuntimeError, match="Unknown KB_BACKEND"):
        factory_mod.create_backend("redis")


def test_unsupported_backend_raises_not_implemented_for_list_all_source_files():
    """`list_all_source_files` is opt-in. Backends that don't
    override it must surface NotImplementedError so `--prune` can
    branch on it instead of crashing."""
    if str(_API_ROOT) not in sys.path:
        sys.path.insert(0, str(_API_ROOT))
    base_mod = importlib.import_module("kb_backends.base")

    class _Stub(base_mod.VectorBackend):
        id = "test_stub"

        def query_multi(self, _q, _k, where=None):  # pragma: no cover
            return []

        def upsert(self, _chunks):  # pragma: no cover
            return None

        def delete_fingerprints(self, _fp):  # pragma: no cover
            return 0

        def list_source_fingerprints(self, _files):  # pragma: no cover
            return {}

        def delete_by_source(self, _key):  # pragma: no cover
            return 0

    with pytest.raises(NotImplementedError, match="test_stub"):
        _Stub().list_all_source_files()
