#!/usr/bin/env python3
"""Ingest content/medical-kb/ into the configured KB backend.

Walks every `.md` file under the content root, parses optional YAML
frontmatter, splits the body into chunks, embeds each chunk with the
configured Embedder, and upserts the result through the VectorBackend.

The pipeline is idempotent. A per-file fingerprint (frontmatter + body)
is stored on every chunk; rerunning the script only re-ingests files
whose fingerprint changed.

Examples
--------
  python scripts/kb-ingest.py
  python scripts/kb-ingest.py --dry-run
  python scripts/kb-ingest.py --source content/medical-kb/fshd
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
from typing import Any, Dict, List, Tuple

# Make apps/api importable when running from the repo root.
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "apps" / "api"))

from kb_backends import create_backend  # noqa: E402
from kb_backends.base import BackendChunk, VectorBackend  # noqa: E402
from embed_models import Embedder, create_embedder  # noqa: E402

DEFAULT_CONTENT_ROOT = ROOT / "content" / "medical-kb"
DEFAULT_BATCH_SIZE = int(os.getenv("KB_INGEST_BATCH_SIZE", "32"))


# ---------------------------------------------------------------- frontmatter

def parse_frontmatter(text: str) -> Tuple[Dict[str, Any], str]:
    """Return (frontmatter_dict, body_text).

    Frontmatter is the YAML block at the very top of the file delimited
    by `---` lines. Files without a frontmatter return ({}, full_text).
    """
    if not text.startswith("---"):
        return {}, text

    # Strip the opening delimiter line.
    after_open = text.split("\n", 1)
    if len(after_open) < 2 or after_open[0].strip() != "---":
        return {}, text
    rest = after_open[1]

    end_match = re.search(r"^---\s*$", rest, flags=re.MULTILINE)
    if not end_match:
        return {}, text

    yaml_block = rest[: end_match.start()]
    body = rest[end_match.end():].lstrip("\n")

    try:
        import yaml  # type: ignore

        parsed = yaml.safe_load(yaml_block) or {}
        if not isinstance(parsed, dict):
            parsed = {}
        return parsed, body
    except ImportError:
        return _simple_yaml_parse(yaml_block), body


def _simple_yaml_parse(text: str) -> Dict[str, Any]:
    """Minimal fallback when PyYAML is not installed.

    Handles `key: value` and `key: [a, b, c]`. Quoted values are
    unwrapped. Anything fancier (nested maps, multi-line strings) is
    silently skipped — install PyYAML for full support.
    """
    result: Dict[str, Any] = {}
    for raw_line in text.split("\n"):
        line = raw_line.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^([^:]+):\s*(.*)$", line)
        if not match:
            continue
        key = match.group(1).strip()
        value: Any = match.group(2).strip()

        if isinstance(value, str) and value:
            if (value[0] == value[-1] == '"') or (value[0] == value[-1] == "'"):
                value = value[1:-1]
            elif value.startswith("[") and value.endswith("]"):
                inner = value[1:-1]
                items = [
                    item.strip().strip("\"'")
                    for item in inner.split(",")
                    if item.strip()
                ]
                value = items
        result[key] = value
    return result


# -------------------------------------------------------------------- chunker

@dataclass
class _RawChunk:
    content: str
    chunk_index: int


def split_markdown(body: str, max_chars: int = 1200, min_chars: int = 30) -> List[_RawChunk]:
    """Break a markdown body into well-sized chunks.

    The strategy is:
      1. Split at every ATX heading of level >= 2, keeping the heading
         with the section that follows it. This preserves topical
         coherence.
      2. Sections longer than `max_chars` are sub-split on blank-line
         paragraph breaks, packing paragraphs greedily up to the cap.
      3. Anything shorter than `min_chars` is dropped — those are
         usually navigation lines that just add noise.
    """
    sections = _split_by_headings(body)
    out: List[_RawChunk] = []

    for section in sections:
        section = section.strip()
        if not section:
            continue

        if len(section) <= max_chars:
            if len(section) >= min_chars:
                out.append(_RawChunk(content=section, chunk_index=len(out)))
            continue

        paragraphs = re.split(r"\n\s*\n", section)
        current: List[str] = []
        current_len = 0
        for p in paragraphs:
            p = p.strip()
            if not p:
                continue
            projected = current_len + len(p) + (2 if current else 0)
            if projected > max_chars and current:
                text = "\n\n".join(current)
                if len(text) >= min_chars:
                    out.append(_RawChunk(content=text, chunk_index=len(out)))
                current = [p]
                current_len = len(p)
            else:
                current.append(p)
                current_len = projected if current else len(p)

        if current:
            text = "\n\n".join(current)
            if len(text) >= min_chars:
                out.append(_RawChunk(content=text, chunk_index=len(out)))

    return out


def _split_by_headings(body: str) -> List[str]:
    """Split markdown on ATX headings of level >= 2, keeping the heading
    line with its section."""
    parts = re.split(r"(?=^##+\s)", body, flags=re.MULTILINE)
    return [p for p in parts if p.strip()]


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


def source_fingerprint(frontmatter: Dict[str, Any], body: str) -> str:
    """Fingerprint everything that goes into a file: ordered frontmatter
    keys + the raw body. Changes to either trigger a re-ingest.

    The frontmatter is serialised with `json.dumps(sort_keys=True)`
    rather than `repr()` so the fingerprint is stable across Python
    versions (Python's repr format for dicts/lists is not part of the
    language contract and has shifted between minor releases).
    """
    h = hashlib.sha256()
    h.update(b"frontmatter:")
    h.update(json.dumps(frontmatter, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    h.update(b"---body---")
    h.update(body.encode("utf-8"))
    return h.hexdigest()[:32]


# ------------------------------------------------------------------ pipeline

@dataclass
class IngestStats:
    files_seen: int = 0
    files_unchanged: int = 0
    files_new: int = 0
    files_updated: int = 0
    files_empty: int = 0
    files_errored: int = 0
    chunks_upserted: int = 0
    actions: List[str] = field(default_factory=list)


def relative_source_key(file_path: Path, content_root: Path) -> str:
    """Stable identifier used both in DB rows and in user-facing logs."""
    return str(file_path.relative_to(content_root))


def ingest(
    *,
    content_root: Path,
    backend: VectorBackend,
    embedder: Embedder,
    batch_size: int = DEFAULT_BATCH_SIZE,
    dry_run: bool = False,
) -> IngestStats:
    stats = IngestStats()

    if not content_root.exists():
        raise FileNotFoundError(f"Content root does not exist: {content_root}")

    files = sorted(content_root.rglob("*.md"))
    stats.files_seen = len(files)
    if not files:
        return stats

    source_keys = [relative_source_key(f, content_root) for f in files]
    existing_fps = backend.list_source_fingerprints(source_keys)

    pending: List[BackendChunk] = []
    chunks_per_source: Dict[str, int] = {}

    for file_path in files:
        source_key = relative_source_key(file_path, content_root)

        try:
            text = file_path.read_text(encoding="utf-8")
        except Exception as exc:
            stats.files_errored += 1
            stats.actions.append(f"error    {source_key}: {exc}")
            continue

        frontmatter, body = parse_frontmatter(text)
        file_fp = source_fingerprint(frontmatter, body)

        if existing_fps.get(source_key) == file_fp:
            stats.files_unchanged += 1
            stats.actions.append(f"unchanged {source_key}")
            continue

        raw_chunks = split_markdown(body)
        if not raw_chunks:
            stats.files_empty += 1
            stats.actions.append(f"empty    {source_key}")
            continue

        if source_key in existing_fps:
            stats.files_updated += 1
            stats.actions.append(f"updated  {source_key} ({len(raw_chunks)} chunks)")
            if not dry_run:
                backend.delete_by_source(source_key)
        else:
            stats.files_new += 1
            stats.actions.append(f"new      {source_key} ({len(raw_chunks)} chunks)")

        chunks_per_source[source_key] = len(raw_chunks)
        base_metadata = dict(frontmatter)
        for raw in raw_chunks:
            chunk_fp = chunk_fingerprint(source_key, raw.chunk_index, raw.content)
            pending.append(
                BackendChunk(
                    content=raw.content,
                    fingerprint=chunk_fp,
                    source_file=source_key,
                    source_fingerprint=file_fp,
                    chunk_index=raw.chunk_index,
                    embedding=[],  # filled in batches below
                    metadata={
                        **base_metadata,
                        # Snapshot of the chunk count for this file at
                        # ingest time. Stays stable per file because
                        # changed files are wiped + re-ingested as a
                        # batch (see delete_by_source above). If we
                        # ever switch to partial re-ingest, this field
                        # would drift and should be revisited.
                        "chunks_in_file": chunks_per_source[source_key],
                    },
                    embed_model=embedder.model_name,
                )
            )

    stats.chunks_upserted = len(pending)
    if not pending or dry_run:
        return stats

    # Embed + upsert in batches so memory stays bounded for large KBs.
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
        help="Directory containing markdown sources (default: content/medical-kb)",
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
    args = parser.parse_args()

    print(f"KB ingest")
    print(f"  source       : {args.source}")
    print(f"  backend      : {os.getenv('KB_BACKEND', 'chroma_cloud')}")
    print(f"  embed model  : {os.getenv('KB_EMBED_MODEL', 'BAAI/bge-m3')}")
    print(f"  batch size   : {args.batch_size}")
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
    )

    if args.verbose:
        print("Per-file actions:")
        for action in stats.actions:
            print(f"  {action}")
        print()

    print("Summary:")
    print(f"  files seen     : {stats.files_seen}")
    print(f"  unchanged      : {stats.files_unchanged}")
    print(f"  new            : {stats.files_new}")
    print(f"  updated        : {stats.files_updated}")
    print(f"  empty          : {stats.files_empty}")
    print(f"  errored        : {stats.files_errored}")
    print(f"  chunks upserted: {stats.chunks_upserted}")

    backend.close()
    # Non-zero exit so npm / CI / smoke scripts can grep for success
    # without scraping stdout. Any per-file read error counts as a
    # failure even if the rest of the ingest succeeded -- silent
    # half-ingests would be worse.
    return 1 if stats.files_errored else 0


if __name__ == "__main__":
    sys.exit(main())
