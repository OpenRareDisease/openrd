#!/usr/bin/env python3
"""Ingest content/medical-kb/ into the configured KB backend.

Walks every supported source file under the content root (markdown,
PDF, docx, image, html) and runs each through the matching parser in
`scripts.kb_parsers`. Each parser returns one or more `ParsedSection`s
which are then chunked, embedded with the configured Embedder, and
upserted via the VectorBackend.

The pipeline is idempotent: a per-file fingerprint (raw file bytes +
parser version) is stored on every chunk, so rerunning only
re-ingests files whose fingerprint changed.

Examples
--------
  python scripts/kb-ingest.py
  python scripts/kb-ingest.py --dry-run
  python scripts/kb-ingest.py --source content/medical-kb/source/FSHD_知识库
  python scripts/kb-ingest.py --only .pdf,.docx
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Sequence

# Make apps/api + scripts importable when running from the repo root.
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(HERE))

from kb_backends import create_backend  # noqa: E402
from kb_backends.base import BackendChunk, VectorBackend  # noqa: E402
from embed_models import Embedder, create_embedder  # noqa: E402
from kb_parsers import (  # noqa: E402
    ALL_PARSERS,
    ParseResult,
    Parser,
    get_parser_for,
)
from kb_parsers.chunker import RawChunk, split_markdown, split_paragraphs  # noqa: E402

DEFAULT_CONTENT_ROOT = ROOT / "content" / "medical-kb"
DEFAULT_BATCH_SIZE = int(os.getenv("KB_INGEST_BATCH_SIZE", "32"))

#: Bumped when the chunker, parsers, or fingerprint logic changes in
#: a way that would invalidate previously stored chunks. The
#: per-file fingerprint includes this so a refactor invalidates the
#: whole KB without needing a manual wipe.
PIPELINE_VERSION = "v2.multi-format"


# ----------------------------------------------------------- fingerprinting

def _normalize_for_hash(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def chunk_fingerprint(source_key: str, chunk_index: int, content: str) -> str:
    h = hashlib.sha256()
    h.update(source_key.encode("utf-8"))
    h.update(b"\x1f")
    h.update(str(chunk_index).encode("ascii"))
    h.update(b"\x1f")
    h.update(_normalize_for_hash(content).encode("utf-8"))
    return h.hexdigest()[:32]


def source_fingerprint(
    file_bytes: bytes, parser_name: str, pipeline_version: str
) -> str:
    """Fingerprint = hash(file content + parser version + pipeline
    version). Changes to the file OR to how we parse it trigger a
    re-ingest, so a refactor to the chunker is enough to invalidate
    every chunk."""
    h = hashlib.sha256()
    h.update(b"file:")
    h.update(file_bytes)
    h.update(b"\x1fparser:")
    h.update(parser_name.encode("ascii"))
    h.update(b"\x1fpipeline:")
    h.update(pipeline_version.encode("ascii"))
    return h.hexdigest()[:32]


# ------------------------------------------------------------------ helpers

_CJK_RANGE = re.compile(r"[㐀-鿿豈-﫿]")


def _detect_language(text: str) -> str:
    """Crude but stable: > 5% CJK chars -> zh, else en. Tagged on
    every chunk so the retriever can filter by `language` when a
    future feature wants Chinese-only or English-only results."""
    if not text:
        return ""
    sample = text[:2000]
    cjk = len(_CJK_RANGE.findall(sample))
    total = len(sample)
    if total == 0:
        return ""
    return "zh" if cjk / total > 0.05 else "en"


def relative_source_key(file_path: Path, content_root: Path) -> str:
    """Stable identifier used both in DB rows and user-facing logs."""
    return str(file_path.relative_to(content_root))


def _derive_metadata_from_path(source_key: str) -> Dict[str, Any]:
    """Pull `folder_path` and `category` from the relative path so
    chunks carry the same structural metadata as the legacy Chroma
    import (preserved for retriever ranking compatibility)."""
    parts = source_key.split(os.sep)
    return {
        "source_file": parts[-1],
        "folder_path": os.sep.join(parts[:-1]) if len(parts) > 1 else "",
        # Top-level folder under the content root (e.g.
        # "01.疾病定义和科普"). Empty when the file sits at root.
        "category": parts[0] if len(parts) > 1 else "",
    }


def _supported_extensions(only: Sequence[str] | None) -> set[str]:
    """Resolve the `--only` filter to a concrete extension set."""
    all_exts: set[str] = set()
    for p in ALL_PARSERS:
        all_exts.update(p.extensions)
    if not only:
        return all_exts
    requested = {ext.strip().lower() for ext in only if ext.strip()}
    requested = {ext if ext.startswith(".") else f".{ext}" for ext in requested}
    unknown = requested - all_exts
    if unknown:
        raise SystemExit(
            f"--only contains unsupported extensions: {sorted(unknown)}. "
            f"Known: {sorted(all_exts)}"
        )
    return requested


def _chunk_sections(parse_result: ParseResult) -> List[RawChunk]:
    """Run each ParsedSection through the right chunker, then renumber
    chunk_index globally across the whole file so per-file fingerprints
    stay stable."""
    chunks: List[RawChunk] = []
    for section in parse_result.sections:
        text = section.text.strip()
        if not text:
            continue
        is_md = bool(section.extra.get("is_markdown"))
        sub = split_markdown(text) if is_md else split_paragraphs(text)
        for raw in sub:
            tagged = raw.content
            if section.label:
                # Prefix the label so cited chunks show "page 5 / 临床
                # 表现 / ...". The label is short so this stays a tiny
                # overhead per chunk.
                tagged = f"[{section.label}]\n{raw.content}"
            chunks.append(RawChunk(content=tagged, chunk_index=len(chunks)))
    return chunks


# ------------------------------------------------------------------ pipeline

@dataclass
class IngestStats:
    files_seen: int = 0
    files_skipped_unsupported: int = 0
    files_unchanged: int = 0
    files_new: int = 0
    files_updated: int = 0
    files_empty: int = 0
    files_errored: int = 0
    chunks_upserted: int = 0
    actions: List[str] = field(default_factory=list)


def _gather_files(
    content_root: Path, allowed_exts: set[str]
) -> tuple[List[Path], int]:
    """Walk `content_root` and return (matched_files, skipped_count)."""
    matched: List[Path] = []
    skipped = 0
    for path in sorted(content_root.rglob("*")):
        if not path.is_file():
            continue
        if path.name.startswith("."):
            continue
        suffix = path.suffix.lower()
        if suffix in allowed_exts:
            matched.append(path)
        else:
            skipped += 1
    return matched, skipped


def ingest(
    *,
    content_root: Path,
    backend: VectorBackend,
    embedder: Embedder,
    batch_size: int = DEFAULT_BATCH_SIZE,
    dry_run: bool = False,
    only: Sequence[str] | None = None,
) -> IngestStats:
    stats = IngestStats()

    if not content_root.exists():
        raise FileNotFoundError(f"Content root does not exist: {content_root}")

    allowed = _supported_extensions(only)
    files, stats.files_skipped_unsupported = _gather_files(content_root, allowed)
    stats.files_seen = len(files)
    if not files:
        return stats

    source_keys = [relative_source_key(f, content_root) for f in files]
    existing_fps = backend.list_source_fingerprints(source_keys)

    pending: List[BackendChunk] = []
    chunks_per_source: Dict[str, int] = {}

    for file_path in files:
        source_key = relative_source_key(file_path, content_root)
        parser: Parser | None = get_parser_for(file_path)
        if parser is None:
            # Filtered upstream, but defensive.
            stats.files_skipped_unsupported += 1
            continue

        try:
            file_bytes = file_path.read_bytes()
            file_fp = source_fingerprint(file_bytes, parser.parser_name, PIPELINE_VERSION)
        except Exception as exc:
            stats.files_errored += 1
            stats.actions.append(f"error    {source_key}: read failed: {exc}")
            continue

        if existing_fps.get(source_key) == file_fp:
            stats.files_unchanged += 1
            stats.actions.append(f"unchanged {source_key}")
            continue

        try:
            parse_result = parser.parse(file_path)
        except Exception as exc:
            stats.files_errored += 1
            stats.actions.append(f"error    {source_key}: parse failed: {exc}")
            continue

        if parse_result.metadata.get("parse_error"):
            stats.files_errored += 1
            stats.actions.append(
                f"error    {source_key}: {parse_result.metadata['parse_error']}"
            )
            continue

        raw_chunks = _chunk_sections(parse_result)
        if not raw_chunks:
            stats.files_empty += 1
            stats.actions.append(f"empty    {source_key}")
            continue

        if source_key in existing_fps:
            stats.files_updated += 1
            stats.actions.append(
                f"updated  {source_key} ({len(raw_chunks)} chunks)"
            )
            if not dry_run:
                backend.delete_by_source(source_key)
        else:
            stats.files_new += 1
            stats.actions.append(
                f"new      {source_key} ({len(raw_chunks)} chunks)"
            )

        chunks_per_source[source_key] = len(raw_chunks)
        path_metadata = _derive_metadata_from_path(source_key)
        file_metadata: Dict[str, Any] = {
            **path_metadata,
            **parse_result.metadata,
            "file_type": file_path.suffix.lower().lstrip("."),
        }

        for raw in raw_chunks:
            chunk_fp = chunk_fingerprint(source_key, raw.chunk_index, raw.content)
            language = _detect_language(raw.content)
            pending.append(
                BackendChunk(
                    content=raw.content,
                    fingerprint=chunk_fp,
                    source_file=source_key,
                    source_fingerprint=file_fp,
                    chunk_index=raw.chunk_index,
                    embedding=[],
                    metadata={
                        **file_metadata,
                        "chunks_in_file": chunks_per_source[source_key],
                        "language": language,
                    },
                    embed_model=embedder.model_name,
                )
            )

    stats.chunks_upserted = len(pending)
    if not pending or dry_run:
        return stats

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
        backend.upsert(batch)
        stats.actions.append(
            f"upsert   batch {start // batch_size + 1}: {len(batch)} chunks"
        )

    return stats


# ---------------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest medical KB content")
    parser.add_argument(
        "--source",
        default=str(DEFAULT_CONTENT_ROOT),
        help="Directory containing source files (default: content/medical-kb)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Walk files and report actions without writing to the backend",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="Embedding + upsert batch size (default %(default)s)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print every per-file action",
    )
    parser.add_argument(
        "--only",
        help=(
            "Comma-separated extension list to limit the ingest "
            "(e.g. --only .pdf,.docx). Defaults to all supported."
        ),
    )
    args = parser.parse_args()

    only_list = [s for s in (args.only or "").split(",") if s.strip()] or None

    print("KB ingest")
    print(f"  source       : {args.source}")
    print(f"  backend      : {os.getenv('KB_BACKEND', 'pgvector')}")
    print(f"  embed model  : {os.getenv('KB_EMBED_MODEL', 'BAAI/bge-m3')}")
    print(f"  pipeline ver : {PIPELINE_VERSION}")
    print(f"  batch size   : {args.batch_size}")
    if only_list:
        print(f"  only         : {only_list}")
    if args.dry_run:
        print("  DRY RUN (no backend writes)")
    print()

    backend = create_backend()
    embedder = create_embedder()

    stats = ingest(
        content_root=Path(args.source),
        backend=backend,
        embedder=embedder,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
        only=only_list,
    )

    if args.verbose:
        print("Per-file actions:")
        for action in stats.actions:
            print(f"  {action}")
        print()

    print("Summary:")
    print(f"  files seen         : {stats.files_seen}")
    print(f"  skipped (unsupp.)  : {stats.files_skipped_unsupported}")
    print(f"  unchanged          : {stats.files_unchanged}")
    print(f"  new                : {stats.files_new}")
    print(f"  updated            : {stats.files_updated}")
    print(f"  empty              : {stats.files_empty}")
    print(f"  errored            : {stats.files_errored}")
    print(f"  chunks upserted    : {stats.chunks_upserted}")

    backend.close()
    return 1 if stats.files_errored else 0


if __name__ == "__main__":
    sys.exit(main())
