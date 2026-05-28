"""Chroma Cloud backend.

Mirrors the behaviour of the previous FSHDKnowledgeBaseCloud
implementation, kept as a one-flag fallback while we migrate to the
local pgvector backend.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Set

import chromadb

from .base import BackendChunk, QueryHit, VectorBackend

logger = logging.getLogger("fshd_kb.chroma_cloud")


class ChromaCloudBackend(VectorBackend):
    id = "chroma_cloud"

    def __init__(
        self,
        api_key: Optional[str] = None,
        tenant: Optional[str] = None,
        database: Optional[str] = None,
        collection_name: Optional[str] = None,
    ) -> None:
        self.api_key = (api_key or os.getenv("CHROMA_API_KEY", "")).strip()
        self.tenant = (
            tenant
            or os.getenv("CHROMA_TENANT_ID", "")
            or os.getenv("CHROMA_TENANT", "")
        ).strip()
        self.database = (database or os.getenv("CHROMA_DATABASE", "FSHD")).strip()
        self.collection_name = (
            collection_name or os.getenv("CHROMA_COLLECTION", "fshd_knowledge_base")
        ).strip()

        if not self.api_key:
            raise RuntimeError("Missing env CHROMA_API_KEY")
        if not self.tenant:
            raise RuntimeError("Missing env CHROMA_TENANT_ID")
        if not self.database:
            raise RuntimeError("Missing env CHROMA_DATABASE")
        if not self.collection_name:
            raise RuntimeError("Missing env CHROMA_COLLECTION")

        logger.info("Connecting to Chroma Cloud tenant=%s database=%s", self.tenant, self.database)
        self.client = chromadb.CloudClient(
            api_key=self.api_key,
            tenant=self.tenant,
            database=self.database,
        )
        logger.info("Opening collection %s", self.collection_name)
        self.collection = self.client.get_collection(name=self.collection_name)
        logger.info("Chroma Cloud backend ready")

    def query_multi(
        self,
        query_embeddings: List[List[float]],
        fetch_k: int,
        where: Optional[Dict[str, Any]] = None,
    ) -> List[List[QueryHit]]:
        if not query_embeddings:
            return []

        kwargs: Dict[str, Any] = {
            "query_embeddings": query_embeddings,
            "n_results": fetch_k,
            "include": ["documents", "metadatas", "distances"],
        }
        if where:
            kwargs["where"] = where

        results = self.collection.query(**kwargs)

        docs_all = results.get("documents") or []
        metas_all = results.get("metadatas") or []
        dists_all = results.get("distances") or []

        out: List[List[QueryHit]] = []
        for qi in range(len(query_embeddings)):
            docs = docs_all[qi] if qi < len(docs_all) and docs_all[qi] else []
            metas = metas_all[qi] if qi < len(metas_all) and metas_all[qi] else []
            dists = dists_all[qi] if qi < len(dists_all) and dists_all[qi] else []
            hits: List[QueryHit] = []
            for i, doc in enumerate(docs):
                md = metas[i] if i < len(metas) and metas[i] is not None else {}
                dist = dists[i] if i < len(dists) else None
                source = (
                    md.get("source_file")
                    or md.get("source")
                    or md.get("file")
                    or md.get("path")
                    or md.get("folder_path")
                )
                hits.append(
                    QueryHit(
                        content=doc or "",
                        metadata=dict(md) if md else {},
                        distance=float(dist) if dist is not None else None,
                        fingerprint=None,
                        source_file=str(source) if source else None,
                    )
                )
            out.append(hits)
        return out

    def upsert(self, chunks: List[BackendChunk]) -> None:
        if not chunks:
            return
        ids = [chunk.fingerprint for chunk in chunks]
        documents = [chunk.content for chunk in chunks]
        metadatas = [
            {
                **(chunk.metadata or {}),
                "source_file": chunk.source_file,
                "source_fingerprint": chunk.source_fingerprint,
                "chunk_index": chunk.chunk_index,
                "embed_model": chunk.embed_model or "",
            }
            for chunk in chunks
        ]
        embeddings = [chunk.embedding for chunk in chunks]
        self.collection.upsert(
            ids=ids,
            documents=documents,
            metadatas=metadatas,
            embeddings=embeddings,
        )

    def delete_fingerprints(self, fingerprints: List[str]) -> int:
        if not fingerprints:
            return 0
        self.collection.delete(ids=fingerprints)
        # Chroma's delete does not return a count, so we report the
        # requested length as a best-effort signal.
        return len(fingerprints)

    def list_source_fingerprints(self, source_files: List[str]) -> Dict[str, Set[str]]:
        """Return every distinct source_fingerprint per source_file.
        See VectorBackend.list_source_fingerprints — the set shape lets
        the ingest script detect interrupted cleanups."""
        if not source_files:
            return {}
        # Chroma can filter on metadata with $in, but the older API used
        # a single-key dict. Fall back to per-file queries for safety.
        # We pull up to a handful of chunks per source so the set is
        # exhaustive across surviving fingerprints (the previous
        # `limit=1` could miss a stale fingerprint if Chroma happened
        # to return a chunk from the new batch first).
        result: Dict[str, Set[str]] = {}
        for source in source_files:
            try:
                hits = self.collection.get(
                    where={"source_file": source},
                    include=["metadatas"],
                    # 32 is plenty to discover every distinct fingerprint
                    # for a single source in practice (each fingerprint
                    # is per-source, not per-chunk).
                    limit=32,
                )
                metas = hits.get("metadatas") or []
                fingerprints: Set[str] = set()
                for meta in metas:
                    if not meta:
                        continue
                    fp = meta.get("source_fingerprint")
                    if fp:
                        fingerprints.add(str(fp))
                if fingerprints:
                    result[source] = fingerprints
            except Exception:
                # Best-effort; ingest scripts must tolerate missing data.
                logger.exception("Failed to read source_fingerprint for %s", source)
        return result

    def delete_by_source(self, source_file: str) -> int:
        if not source_file:
            return 0
        # Best-effort delete; Chroma does not return removed counts.
        self.collection.delete(where={"source_file": source_file})
        return 0
