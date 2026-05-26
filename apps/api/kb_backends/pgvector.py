"""Local pgvector backend.

Reads connection details from DATABASE_URL (the same string the rest of
the application uses). The backend assumes the schema created by
db/migrations/006_pgvector_kb.sql.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import psycopg
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row

from .base import BackendChunk, QueryHit, VectorBackend

logger = logging.getLogger("fshd_kb.pgvector")


class PgVectorBackend(VectorBackend):
    id = "pgvector"

    def __init__(
        self,
        connection_string: Optional[str] = None,
        table_name: str = "kb_chunks",
    ) -> None:
        self.connection_string = connection_string or os.getenv("DATABASE_URL", "").strip()
        if not self.connection_string:
            raise RuntimeError("Missing env DATABASE_URL for pgvector backend")
        self.table_name = table_name
        # Keep a persistent connection; psycopg 3 is thread-safe for
        # serial use and the KB service queues queries through a single
        # backend instance.
        self.conn = psycopg.connect(self.connection_string, autocommit=False)
        register_vector(self.conn)
        logger.info("pgvector backend connected: table=%s", self.table_name)

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
        with self.conn.cursor(row_factory=dict_row) as cur:
            for q_emb in query_embeddings:
                params: List[Any] = [q_emb, *where_params, q_emb, fetch_k]
                cur.execute(sql, params)
                rows = cur.fetchall()
                hits = [
                    QueryHit(
                        content=row["content"],
                        metadata=row.get("metadata") or {},
                        distance=float(row["distance"]) if row["distance"] is not None else None,
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
        try:
            with self.conn.cursor() as cur:
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
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    # ----------------------------------------------------------------- delete

    def delete_fingerprints(self, fingerprints: List[str]) -> int:
        if not fingerprints:
            return 0
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self.table_name} WHERE fingerprint = ANY(%s)",
                    (fingerprints,),
                )
                deleted = cur.rowcount or 0
            self.conn.commit()
            return deleted
        except Exception:
            self.conn.rollback()
            raise

    def delete_by_source(self, source_file: str) -> int:
        if not source_file:
            return 0
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self.table_name} WHERE source_file = %s",
                    (source_file,),
                )
                deleted = cur.rowcount or 0
            self.conn.commit()
            return deleted
        except Exception:
            self.conn.rollback()
            raise

    # --------------------------------------------------------------- introspection

    def list_source_fingerprints(self, source_files: List[str]) -> Dict[str, str]:
        if not source_files:
            return {}
        with self.conn.cursor() as cur:
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
            with self.conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            return {"backend": self.id, "status": "ok"}
        except Exception as exc:
            return {"backend": self.id, "status": "error", "detail": str(exc)}

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass

    # -------------------------------------------------------------------- util

    def _build_where(self, where: Optional[Dict[str, Any]]):
        """Translate a Chroma-style metadata filter into SQL.

        Only equality on top-level keys is supported for now; this matches
        what the existing query generator emits. Unrecognized payloads
        are ignored to keep behaviour parity with the cloud backend.
        """
        if not where:
            return "", []
        clauses: List[str] = []
        params: List[Any] = []
        for key, value in where.items():
            if isinstance(value, (str, int, float, bool)):
                clauses.append("metadata ->> %s = %s")
                params.extend([key, str(value)])
        if not clauses:
            return "", []
        return "AND " + " AND ".join(clauses), params


def _json_dump(payload: Dict[str, Any]) -> str:
    import json

    return json.dumps(payload, ensure_ascii=False)
