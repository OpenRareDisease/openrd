#!/usr/bin/env python3
"""One-shot migration: Chroma Cloud collection -> local pgvector.

Pages through every document in CHROMA_COLLECTION, re-embeds it with
the configured local embedder (KB_EMBED_MODEL, default BAAI/bge-m3),
and upserts the result into the pgvector backend.

Run this once when switching KB_BACKEND from chroma_cloud to pgvector.
It is safe to re-run: chunks are keyed by a stable fingerprint, so
repeated invocations refresh existing rows instead of duplicating them.

Examples
--------
  python scripts/kb-import-from-chroma.py
  python scripts/kb-import-from-chroma.py --limit 200          # smoke test
  python scripts/kb-import-from-chroma.py --batch-size 64
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "apps" / "api"))

from kb_backends.chroma_cloud import ChromaCloudBackend  # noqa: E402
from kb_backends.pgvector import PgVectorBackend  # noqa: E402
from kb_backends.base import BackendChunk  # noqa: E402
from embed_models import create_embedder  # noqa: E402

DEFAULT_BATCH_SIZE = int(os.getenv("KB_INGEST_BATCH_SIZE", "32"))


def _normalize_for_hash(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _content_fingerprint(text: str) -> str:
    h = hashlib.sha256()
    h.update(b"chroma_import:")
    h.update(_normalize_for_hash(text).encode("utf-8"))
    return h.hexdigest()[:32]


def _source_key(metadata: Dict[str, Any], fallback: str) -> str:
    for key in ("source_file", "source", "file", "path", "folder_path"):
        value = metadata.get(key)
        if value:
            return str(value)
    return fallback


def _safe_chunk_index(metadata: Dict[str, Any], default: int) -> int:
    raw = metadata.get("chunk_index", metadata.get("chunkIndex"))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _looks_like_junk(text: str) -> bool:
    if not text or len(text.strip()) < 30:
        return True
    return False


def fetch_chroma_page(backend: ChromaCloudBackend, offset: int, limit: int) -> Dict[str, List[Any]]:
    """Get a page from the underlying chromadb collection.

    ChromaCloudBackend doesn't expose paging directly; we reach into the
    raw collection it holds for this one-off task.
    """
    return backend.collection.get(
        limit=limit,
        offset=offset,
        include=["documents", "metadatas"],
    )


def import_from_chroma(
    *,
    chroma: ChromaCloudBackend,
    pgvector_backend: PgVectorBackend,
    embedder,
    batch_size: int,
    page_size: int,
    limit: Optional[int],
    keep_junk: bool,
) -> Dict[str, int]:
    stats = {
        "fetched": 0,
        "skipped_junk": 0,
        "skipped_empty": 0,
        "upserted": 0,
        "batches": 0,
    }

    pending: List[BackendChunk] = []
    seen_fps: set[str] = set()
    offset = 0

    while True:
        page = fetch_chroma_page(chroma, offset=offset, limit=page_size)
        ids = page.get("ids") or []
        docs = page.get("documents") or []
        metas = page.get("metadatas") or []
        if not ids:
            break

        for idx, doc_id in enumerate(ids):
            stats["fetched"] += 1

            content = docs[idx] if idx < len(docs) else ""
            metadata = metas[idx] if idx < len(metas) and metas[idx] else {}

            if not content or not content.strip():
                stats["skipped_empty"] += 1
                continue
            if not keep_junk and _looks_like_junk(content):
                stats["skipped_junk"] += 1
                continue

            fp = _content_fingerprint(content)
            if fp in seen_fps:
                continue
            seen_fps.add(fp)

            source_key = _source_key(metadata, fallback=f"chroma_import/{str(doc_id)}")
            chunk_index = _safe_chunk_index(metadata, default=idx)

            pending.append(
                BackendChunk(
                    content=_normalize_for_hash(content),
                    fingerprint=fp,
                    source_file=source_key,
                    source_fingerprint="chroma_import",
                    chunk_index=chunk_index,
                    embedding=[],  # filled in batches below
                    metadata={
                        **dict(metadata),
                        "imported_from": "chroma_cloud",
                        "chroma_id": str(doc_id),
                    },
                    embed_model=embedder.model_name,
                )
            )

            if limit is not None and stats["fetched"] >= limit:
                break

        if limit is not None and stats["fetched"] >= limit:
            break

        if len(ids) < page_size:
            break
        offset += page_size

    if not pending:
        return stats

    print(
        f"Embedding {len(pending)} chunks with {embedder.model_name} "
        f"(dim={embedder.dimension})..."
    )
    for start in range(0, len(pending), batch_size):
        batch = pending[start : start + batch_size]
        texts = [chunk.content for chunk in batch]
        embeddings = embedder.embed_texts(texts)
        if len(embeddings) != len(batch):
            raise RuntimeError(
                f"Embedder returned {len(embeddings)} vectors for {len(batch)} chunks"
            )
        for chunk, emb in zip(batch, embeddings):
            chunk.embedding = emb
        pgvector_backend.upsert(batch)
        stats["upserted"] += len(batch)
        stats["batches"] += 1
        print(
            f"  batch {stats['batches']}: upserted {len(batch)} "
            f"(running total {stats['upserted']}/{len(pending)})"
        )

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Chroma Cloud collection into pgvector")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--page-size", type=int, default=200)
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after importing this many documents (useful for a smoke test)",
    )
    parser.add_argument(
        "--keep-junk",
        action="store_true",
        help="Skip the standard junk filter (default removes very short or boilerplate fragments)",
    )
    args = parser.parse_args()

    print(f"KB import from Chroma Cloud -> pgvector")
    print(f"  collection : {os.getenv('CHROMA_COLLECTION', 'fshd_knowledge_base')}")
    print(f"  tenant     : {os.getenv('CHROMA_TENANT_ID', '?')}")
    print(f"  batch size : {args.batch_size}")
    print(f"  page size  : {args.page_size}")
    if args.limit is not None:
        print(f"  LIMIT      : {args.limit}")
    print()

    chroma = ChromaCloudBackend()
    pgvector_backend = PgVectorBackend()
    embedder = create_embedder()

    stats = import_from_chroma(
        chroma=chroma,
        pgvector_backend=pgvector_backend,
        embedder=embedder,
        batch_size=args.batch_size,
        page_size=args.page_size,
        limit=args.limit,
        keep_junk=args.keep_junk,
    )

    print()
    print("Summary:")
    for key in ("fetched", "skipped_junk", "skipped_empty", "upserted", "batches"):
        print(f"  {key:<16}: {stats[key]}")

    pgvector_backend.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
