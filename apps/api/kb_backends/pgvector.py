"""Local pgvector backend.

Reads connection details from DATABASE_URL (the same string the rest of
the application uses). The backend assumes the schema created by
db/migrations/006_pgvector_kb.sql.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

import psycopg
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .base import BackendChunk, QueryHit, VectorBackend

logger = logging.getLogger("fshd_kb.pgvector")

#: Embedding dimensionality this backend expects. Must match the
#: `vector(N)` declaration on kb_chunks.embedding (db/migrations/006).
#: Surfaces dimension mismatches as a clear ValueError instead of
#: relying on pgvector's binary error message.
EXPECTED_EMBED_DIM = 1024


class PgVectorBackend(VectorBackend):
    id = "pgvector"

    def __init__(
        self,
        connection_string: Optional[str] = None,
        table_name: str = "kb_chunks",
        min_size: Optional[int] = None,
        max_size: Optional[int] = None,
    ) -> None:
        self.connection_string = connection_string or os.getenv("DATABASE_URL", "").strip()
        if not self.connection_string:
            raise RuntimeError("Missing env DATABASE_URL for pgvector backend")
        self.table_name = table_name

        # Pool sizing is configurable via env so ops can bump it without a
        # code change when the KB service grows past its current
        # single-process-single-thread profile. Constructor arguments win
        # over env for test injection.
        resolved_min = min_size if min_size is not None else _env_int("KB_PG_POOL_MIN", 1)
        resolved_max = max_size if max_size is not None else _env_int("KB_PG_POOL_MAX", 2)
        if resolved_min < 1 or resolved_max < resolved_min:
            raise ValueError(
                f"Invalid pool sizing: KB_PG_POOL_MIN={resolved_min}, "
                f"KB_PG_POOL_MAX={resolved_max} (need 1 <= min <= max)"
            )

        # Verify the pgvector extension is available up front. The pool
        # opens connections lazily in a background thread and swallows
        # configure-callback exceptions, so a missing extension would
        # otherwise surface only at first INSERT with an inscrutable
        # error. This synchronous probe gives the operator an
        # actionable message at startup.
        self._verify_vector_extension()

        # ConnectionPool gives us reconnect on broken connections, idle
        # timeout handling, and basic concurrency safety. Defaults (1, 2)
        # are plenty for the current KB service (single Python process,
        # serial query handling); raise max via KB_PG_POOL_MAX if a future
        # worker pool needs more headroom.
        self.pool = ConnectionPool(
            conninfo=self.connection_string,
            min_size=resolved_min,
            max_size=resolved_max,
            configure=self._configure_conn,
            kwargs={"autocommit": False},
            open=True,
        )
        logger.info(
            "pgvector backend ready: table=%s pool=[%d,%d]",
            self.table_name,
            resolved_min,
            resolved_max,
        )

    def _verify_vector_extension(self) -> None:
        """Synchronously confirm the pgvector extension is installed.

        pgvector.psycopg.register_vector silently returns if the vector
        type isn't registered in pg_type, and ConnectionPool swallows
        configure-callback exceptions in its background worker. Both
        leave operators with a confusing first-query failure later.
        This probe runs once at backend init with its own short-lived
        connection so missing-extension surfaces immediately with a
        clear message.
        """
        with psycopg.connect(self.connection_string) as probe:
            with probe.cursor() as cur:
                cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
                if cur.fetchone() is None:
                    raise RuntimeError(
                        "pgvector extension is not available on this database. "
                        "Run `CREATE EXTENSION IF NOT EXISTS vector;` (or apply "
                        "db/migrations/006_pgvector_kb.sql via `npm run db:migrate`) "
                        "after installing the pgvector package on the Postgres "
                        "host (`brew install pgvector` for Homebrew Postgres, or "
                        "use the `pgvector/pgvector:pg16` Docker image)."
                    )

    @staticmethod
    def _configure_conn(conn: psycopg.Connection) -> None:
        register_vector(conn)

    # ------------------------------------------------------------------ query

    def query_multi(
        self,
        query_embeddings: List[List[float]],
        fetch_k: int,
        where: Optional[Dict[str, Any]] = None,
    ) -> List[List[QueryHit]]:
        if not query_embeddings:
            return []

        where_sql, where_params = self._build_where(where)
        sql = (
            f"SELECT content, metadata, source_file, fingerprint, "
            f"  (embedding <=> %s::vector) AS distance "
            f"FROM {self.table_name} "
            f"WHERE embedding IS NOT NULL "
            f"{where_sql} "
            f"ORDER BY embedding <=> %s::vector "
            f"LIMIT %s"
        )

        out: List[List[QueryHit]] = []
        with self.pool.connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                for q_emb in query_embeddings:
                    params: List[Any] = [q_emb, *where_params, q_emb, fetch_k]
                    cur.execute(sql, params)
                    rows = cur.fetchall()
                    hits = [
                        QueryHit(
                            content=row["content"],
                            metadata=row.get("metadata") or {},
                            distance=(
                                float(row["distance"]) if row["distance"] is not None else None
                            ),
                            fingerprint=row.get("fingerprint"),
                            source_file=row.get("source_file"),
                        )
                        for row in rows
                    ]
                    out.append(hits)
        return out

    # ----------------------------------------------------------------- upsert

    def upsert(self, chunks: List[BackendChunk]) -> None:
        if not chunks:
            return

        # Validate up front so mis-dimensioned vectors fail with a clear
        # message instead of pgvector's lower-level type error.
        self._validate_embedding_dims(chunks)

        sql = (
            f"INSERT INTO {self.table_name} ("
            f"  source_file, source_fingerprint, chunk_index, content, "
            f"  fingerprint, metadata, embed_model, embedding"
            f") VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s::vector) "
            f"ON CONFLICT (fingerprint) DO UPDATE SET "
            f"  source_file = EXCLUDED.source_file, "
            f"  source_fingerprint = EXCLUDED.source_fingerprint, "
            f"  chunk_index = EXCLUDED.chunk_index, "
            f"  content = EXCLUDED.content, "
            f"  metadata = EXCLUDED.metadata, "
            f"  embed_model = EXCLUDED.embed_model, "
            f"  embedding = EXCLUDED.embedding"
        )
        with self.pool.connection() as conn:
            try:
                with conn.cursor() as cur:
                    for chunk in chunks:
                        cur.execute(
                            sql,
                            (
                                chunk.source_file,
                                chunk.source_fingerprint,
                                chunk.chunk_index,
                                chunk.content,
                                chunk.fingerprint,
                                _json_dump(chunk.metadata or {}),
                                chunk.embed_model or "",
                                chunk.embedding,
                            ),
                        )
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    # ----------------------------------------------------------------- delete

    def delete_fingerprints(self, fingerprints: List[str]) -> int:
        if not fingerprints:
            return 0
        with self.pool.connection() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f"DELETE FROM {self.table_name} WHERE fingerprint = ANY(%s)",
                        (fingerprints,),
                    )
                    deleted = cur.rowcount or 0
                conn.commit()
                return deleted
            except Exception:
                conn.rollback()
                raise

    def delete_by_source(self, source_file: str) -> int:
        if not source_file:
            return 0
        with self.pool.connection() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f"DELETE FROM {self.table_name} WHERE source_file = %s",
                        (source_file,),
                    )
                    deleted = cur.rowcount or 0
                conn.commit()
                return deleted
            except Exception:
                conn.rollback()
                raise

    # --------------------------------------------------------------- introspection

    def list_source_fingerprints(self, source_files: List[str]) -> Dict[str, str]:
        if not source_files:
            return {}
        with self.pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT source_file, source_fingerprint "
                    f"FROM {self.table_name} "
                    f"WHERE source_file = ANY(%s) "
                    f"GROUP BY source_file, source_fingerprint",
                    (source_files,),
                )
                rows = cur.fetchall()
        return {row[0]: row[1] for row in rows if row[0]}

    def health(self) -> Dict[str, Any]:
        try:
            with self.pool.connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
            return {"backend": self.id, "status": "ok"}
        except Exception as exc:
            return {"backend": self.id, "status": "error", "detail": str(exc)}

    def close(self) -> None:
        try:
            self.pool.close()
        except Exception as exc:
            # Don't crash callers on shutdown, but surface the problem
            # so leaked connections / unresponsive pools are visible.
            logger.warning("error while closing pgvector pool: %s", exc)

    # -------------------------------------------------------------------- util

    def _validate_embedding_dims(self, chunks: List[BackendChunk]) -> None:
        for chunk in chunks:
            if chunk.embedding is None or len(chunk.embedding) != EXPECTED_EMBED_DIM:
                actual = "None" if chunk.embedding is None else len(chunk.embedding)
                raise ValueError(
                    f"Embedding dimension mismatch for chunk fingerprint={chunk.fingerprint} "
                    f"source={chunk.source_file} embed_model={chunk.embed_model}: "
                    f"got {actual} values, expected {EXPECTED_EMBED_DIM}"
                )

    def _build_where(self, where: Optional[Dict[str, Any]]):
        """Translate a Chroma-style metadata filter into SQL.

        Only equality on top-level keys is supported for now; this matches
        what the existing query generator emits. Unsupported payloads
        (dicts for $in / $gt, list values, nested expressions) are
        dropped with a warning so misconfigured upstream filters surface
        as warnings instead of silently returning unfiltered results.
        """
        if not where:
            return "", []
        clauses: List[str] = []
        params: List[Any] = []
        for key, value in where.items():
            if isinstance(value, (str, int, float, bool)):
                clauses.append("metadata ->> %s = %s")
                params.extend([key, str(value)])
            else:
                logger.warning(
                    "pgvector backend dropping unsupported metadata filter: %s=%r "
                    "(only scalar equality is implemented; consider widening _build_where)",
                    key,
                    value,
                )
        if not clauses:
            return "", []
        return "AND " + " AND ".join(clauses), params


def _json_dump(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("invalid %s=%r, falling back to %d", name, raw, default)
        return default
