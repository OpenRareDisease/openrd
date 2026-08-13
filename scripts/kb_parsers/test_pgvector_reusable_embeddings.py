"""`PgVectorBackend.reusable_embeddings` against a real Postgres.

This is the only implementation of the embedding cache read that ever
runs in production, and it carries the two guards the docstrings in
`kb_backends/base.py` and `scripts/kb-ingest.py` make their strongest
claims about: `AND embed_model = %s` and `AND embedding IS NOT NULL`.
Every other reuse test in this directory drives a hand-written
`FakeBackend` that re-implements those guards in Python, so until this
file existed the SQL could lose both of them and
`pytest scripts/kb_parsers` stayed green in 0.04s — the
「a different embed model is never reused」 test proved only that the
ingest forwards `embedder.model_name` to *something*.

What a lost model guard costs, since nothing downstream detects it: the
next KB_EMBED_MODEL change reuses every bge-m3 vector under the new
model's name, two geometries land in one HNSW index, and the 0.40
relevance floor is applied to distances that no longer mean what it was
measured against. `_validate_embedding_dims` does not catch it — any
other 1024-d model passes — and `scripts/kb-verify.py` never looks at
`embed_model`.

So these tests hold a real connection. They never touch `kb_chunks`:
the fixture creates its own scratch table, seeds it, and drops it.

When no database is reachable the suite does NOT quietly pass. Under CI
(or KB_DB_TESTS_REQUIRED=1) an unreachable database is a hard failure —
a green run must mean the SQL ran. Locally it degrades to a skip, but a
loud one: a UserWarning that pytest prints in its warnings summary
without -rs, plus a banner on stderr.
"""

from __future__ import annotations

import importlib
import os
import sys
import uuid
import warnings
from pathlib import Path
from typing import Dict, List, Optional

import pytest

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent
_API_ROOT = _REPO_ROOT / "apps" / "api"

#: A green run has to mean the SQL executed. GitHub Actions sets CI=true
#: for every job, so the report-manager job (which now brings up a
#: pgvector service container) cannot forget to opt in; the explicit
#: variable is for anyone reproducing that mode locally.
_DB_REQUIRED = bool(os.environ.get("CI") or os.environ.get("KB_DB_TESTS_REQUIRED"))


def _database_url() -> str:
    """DATABASE_URL from the environment, falling back to the repo's
    .env — which is where a developer running plain `pytest` has it.
    Without the fallback the local run would skip permanently, and a
    skip nobody ever sees is the hollow gate this file exists to
    close."""
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return url
    env_file = _REPO_ROOT / ".env"
    if not env_file.exists():
        return ""
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() != "DATABASE_URL":
            continue
        return value.strip().strip('"').strip("'")
    return ""


def _no_database(reason: str) -> None:
    """Fail under CI, skip loudly everywhere else. Never returns."""
    if _DB_REQUIRED:
        pytest.fail(
            "pgvector cache tests require a database and CI/KB_DB_TESTS_REQUIRED "
            f"is set: {reason}. This suite is the only thing that executes the "
            "embed_model / NULL-embedding guards in "
            "apps/api/kb_backends/pgvector.py; skipping it would leave them "
            "untested. Bring up a Postgres with the pgvector extension and "
            "point DATABASE_URL at it."
        )
    banner = (
        "\n"
        "=========================================================\n"
        " SKIPPED: PgVectorBackend.reusable_embeddings is UNTESTED\n"
        f" {reason}\n"
        " Nothing else in the repo executes that SQL. Set DATABASE_URL\n"
        " to a Postgres with the vector extension to actually test it.\n"
        "=========================================================\n"
    )
    print(banner, file=sys.stderr, flush=True)
    warnings.warn(
        "PgVectorBackend.reusable_embeddings was NOT tested: " + reason,
        UserWarning,
        stacklevel=2,
    )
    pytest.skip(reason, allow_module_level=False)


@pytest.fixture(scope="module")
def pgvector_mod():
    if str(_API_ROOT) not in sys.path:
        sys.path.insert(0, str(_API_ROOT))
    return importlib.import_module("kb_backends.pgvector")


@pytest.fixture(scope="module")
def scratch(pgvector_mod):
    """A PgVectorBackend bound to a throwaway table, plus a seeder.

    The table is created and dropped here, so a failing assertion cannot
    leave rows behind; the name carries the pid so two runs (or two
    agents on one dev database) never collide. `kb_chunks` is never
    read or written.
    """
    import psycopg

    url = _database_url()
    if not url:
        _no_database("DATABASE_URL is not set and the repo .env has no value for it")

    try:
        admin = psycopg.connect(url, connect_timeout=5)
    except Exception as exc:  # noqa: BLE001 — any connect failure means "no database"
        _no_database(f"cannot connect to DATABASE_URL ({type(exc).__name__}: {exc})")

    table = f"kb_chunks_reuse_test_{os.getpid()}_{uuid.uuid4().hex[:8]}"
    dim = pgvector_mod.EXPECTED_EMBED_DIM
    backend = None
    try:
        with admin:
            admin.autocommit = True
            with admin.cursor() as cur:
                cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
                if cur.fetchone() is None:
                    # Fresh CI container. Locally this branch is never
                    # taken, so the tests do not need CREATE EXTENSION
                    # rights on a developer's database.
                    try:
                        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
                    except Exception as exc:  # noqa: BLE001
                        _no_database(f"the vector extension is not installed ({exc})")
                # Mirrors db/migrations/006_pgvector_kb.sql for every
                # column the cache read touches, including the UNIQUE on
                # fingerprint — one fingerprint is one row in
                # production, which is why the model guard protects
                # against reusing the WRONG vector rather than picking
                # between two.
                cur.execute(
                    f"CREATE TABLE {table} ("
                    "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
                    "  source_file TEXT NOT NULL,"
                    "  source_fingerprint TEXT NOT NULL,"
                    "  chunk_index INTEGER NOT NULL DEFAULT 0,"
                    "  content TEXT NOT NULL,"
                    "  fingerprint TEXT NOT NULL UNIQUE,"
                    "  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,"
                    "  embed_model TEXT NOT NULL DEFAULT 'BAAI/bge-m3',"
                    f"  embedding vector({dim}),"
                    "  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"
                    "  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
                    ")"
                )

        backend = pgvector_mod.PgVectorBackend(
            connection_string=url, table_name=table, min_size=1, max_size=1
        )
        yield _Scratch(backend=backend, table=table, url=url, dim=dim)
    finally:
        if backend is not None:
            backend.close()
        with psycopg.connect(url, connect_timeout=5) as cleanup:
            cleanup.autocommit = True
            with cleanup.cursor() as cur:
                cur.execute(f"DROP TABLE IF EXISTS {table}")


class _Scratch:
    def __init__(self, backend, table: str, url: str, dim: int) -> None:
        self.backend = backend
        self.table = table
        self.url = url
        self.dim = dim

    def vector(self, marker: float) -> List[float]:
        """A distinguishable 1024-d vector.

        Every component is a binary fraction so it survives pgvector's
        float4 storage exactly and the assertions can use `==` rather
        than an epsilon that would hide a real change.
        """
        return [marker + (i % 8) / 8.0 for i in range(self.dim)]

    def seed(
        self,
        fingerprint: str,
        *,
        embed_model: str = "BAAI/bge-m3",
        embedding: Optional[List[float]] = None,
    ) -> None:
        import psycopg

        literal = None if embedding is None else "[" + ",".join(repr(x) for x in embedding) + "]"
        with psycopg.connect(self.url, connect_timeout=5) as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self.table} "
                    "(source_file, source_fingerprint, chunk_index, content, "
                    " fingerprint, embed_model, embedding) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s::vector)",
                    (
                        "test/doc.md",
                        "srcfp",
                        0,
                        "内容",
                        fingerprint,
                        embed_model,
                        literal,
                    ),
                )

    def reuse(self, fingerprints: List[str], model: str) -> Dict[str, List[float]]:
        return self.backend.reusable_embeddings(fingerprints, model)


MODEL = "BAAI/bge-m3"
OTHER_MODEL = "BAAI/bge-m3-wrong"


def _fp(name: str) -> str:
    return f"{name}-{uuid.uuid4().hex}"


# ------------------------------------------------------------- the four guards


def test_exact_model_match_reuses_the_stored_vector(scratch):
    fingerprint = _fp("hit")
    stored = scratch.vector(1.0)
    scratch.seed(fingerprint, embed_model=MODEL, embedding=stored)

    out = scratch.reuse([fingerprint], MODEL)

    assert list(out) == [fingerprint]
    assert out[fingerprint] == stored


def test_a_different_embed_model_is_not_reused(scratch):
    """The guard the fakes were enforcing on the SQL's behalf. Two
    models are two geometries; a distance across them is meaningless in
    a way nothing downstream can detect, so a fingerprint hit under the
    wrong model has to come back empty and be re-embedded."""
    fingerprint = _fp("othermodel")
    scratch.seed(fingerprint, embed_model=MODEL, embedding=scratch.vector(2.0))

    assert scratch.reuse([fingerprint], OTHER_MODEL) == {}
    # ...and the row is genuinely there, so the empty result is the
    # guard talking and not a seeding mistake.
    assert scratch.reuse([fingerprint], MODEL) != {}


def test_a_null_embedding_is_omitted_rather_than_returned_as_empty(scratch):
    """A row with no vector must be absent from the result, not present
    with `[]`. An empty list looks like a valid cache hit to the ingest,
    which would upsert a chunk with no embedding and only trip the
    dimension check much later — or, on a backend that does not check,
    store an unsearchable chunk."""
    fingerprint = _fp("nullvec")
    scratch.seed(fingerprint, embed_model=MODEL, embedding=None)

    out = scratch.reuse([fingerprint], MODEL)

    assert out == {}
    assert fingerprint not in out


def test_a_fingerprint_that_is_not_stored_returns_nothing(scratch):
    assert scratch.reuse([_fp("absent")], MODEL) == {}


def test_a_mixed_batch_returns_only_the_rows_that_pass_every_guard(scratch):
    """The real call shape: the ingest hands over every pending
    fingerprint at once. Exactly one of these four is reusable."""
    hit, wrong_model, null_vec, absent = (
        _fp("mix-hit"),
        _fp("mix-model"),
        _fp("mix-null"),
        _fp("mix-absent"),
    )
    stored = scratch.vector(3.0)
    scratch.seed(hit, embed_model=MODEL, embedding=stored)
    scratch.seed(wrong_model, embed_model=OTHER_MODEL, embedding=scratch.vector(4.0))
    scratch.seed(null_vec, embed_model=MODEL, embedding=None)

    out = scratch.reuse([hit, wrong_model, null_vec, absent], MODEL)

    assert out == {hit: stored}


# --------------------------------------------------------- shape of the result


def test_the_returned_vector_is_a_plain_list_of_floats(scratch):
    """`register_vector` hands rows back as numpy arrays. The method
    materialises them so a reused vector round-trips through the same
    upsert path as a freshly embedded one; without that, the reuse path
    would depend on the psycopg adapter accepting a numpy array where a
    list is expected."""
    fingerprint = _fp("shape")
    stored = scratch.vector(5.0)
    scratch.seed(fingerprint, embed_model=MODEL, embedding=stored)

    vector = scratch.reuse([fingerprint], MODEL)[fingerprint]

    assert type(vector) is list
    assert len(vector) == scratch.dim
    assert all(type(x) is float for x in vector)


# ------------------------------------------------------- the short-circuit


def test_empty_input_never_reaches_the_database(scratch, monkeypatch):
    """`if not fingerprints or not embed_model` is a real guard, not
    decoration: the ingest calls this with an empty list whenever every
    file was unchanged, and an empty `ANY(ARRAY[])` would still cost a
    pool checkout and a round trip. Asserting on the return value alone
    would pass with the guard deleted, so the pool is replaced with one
    that refuses to hand out a connection."""

    class ExplodingPool:
        def connection(self):  # pragma: no cover - must never be called
            raise AssertionError("reusable_embeddings queried the database anyway")

    monkeypatch.setattr(scratch.backend, "pool", ExplodingPool())

    assert scratch.backend.reusable_embeddings([], MODEL) == {}
    assert scratch.backend.reusable_embeddings(["some-fingerprint"], "") == {}


# ------------------------------------------------------------- schema drift


def test_the_scratch_table_matches_the_shipped_kb_chunks_schema(scratch):
    """The fixture's DDL is a copy of db/migrations/006, and a copy
    drifts — after which these tests would keep passing against a shape
    production no longer has. Checked twice, because neither check is
    available everywhere: against the migration's own text, which is in
    the tree on any machine, and against the live `kb_chunks` when this
    database has one (a fresh CI database does not).
    """
    import re as _re

    import psycopg

    ddl = (_REPO_ROOT / "db" / "migrations" / "006_pgvector_kb.sql").read_text(
        encoding="utf-8"
    )
    dim = scratch.dim
    for pattern in (
        r"\bfingerprint\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b",
        r"\bembed_model\s+TEXT\s+NOT\s+NULL\b",
        rf"\bembedding\s+vector\({dim}\)",
    ):
        assert _re.search(pattern, ddl), f"006 no longer declares {pattern!r}"

    columns = ("fingerprint", "embed_model", "embedding")
    with psycopg.connect(scratch.url, connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name, column_name, udt_name, is_nullable "
                "FROM information_schema.columns "
                "WHERE table_name = ANY(%s) AND column_name = ANY(%s)",
                ([scratch.table, "kb_chunks"], list(columns)),
            )
            rows = cur.fetchall()

    scratch_shape = {c: (u, n) for t, c, u, n in rows if t == scratch.table}
    assert set(scratch_shape) == set(columns)
    live_shape = {c: (u, n) for t, c, u, n in rows if t == "kb_chunks"}
    if live_shape:
        assert scratch_shape == live_shape
