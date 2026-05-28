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
import logging
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Sequence

# pdfminer is noisy by default — it logs a "Could not get FontBBox"
# warning for nearly every page of every academic PDF in the FSHD
# corpus. The text extraction still works; the warning just buries
# the actual ingest output. Silence below ERROR globally for the
# whole pdfminer package.
logging.getLogger("pdfminer").setLevel(logging.ERROR)

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

#: Where unzipped corpus material lands by default. Matches the path
#: documented in docs/proposals/local-rag-migration.md §4.3 and the
#: .gitignore entry. Override with --source.
DEFAULT_CONTENT_ROOT = ROOT / "content" / "medical-kb" / "source"

#: Default backend for the ingest pipeline. The shared backend
#: factory still defaults to chroma_cloud for read-side compatibility
#: during the Chroma->pgvector rollout (see issue #21), but the
#: ingester writes to local pgvector unless KB_BACKEND explicitly says
#: otherwise -- a fresh clone running `npm run kb:ingest` should not
#: accidentally write to / fail on Chroma.
DEFAULT_BACKEND = "pgvector"

DEFAULT_BATCH_SIZE = int(os.getenv("KB_INGEST_BATCH_SIZE", "32"))

#: Bumped when the chunker, parsers, or fingerprint logic changes in
#: a way that would invalidate previously stored chunks. The
#: per-file fingerprint includes this so a refactor invalidates the
#: whole KB without needing a manual wipe.
PIPELINE_VERSION = "v2.multi-format"


# --------------------------------------------------------- injection scanner

#: Patterns that frequently appear in prompt-injection payloads. Hits
#: don't block ingestion — the corpus is allowed to discuss prompt
#: injection in legitimate academic / security content — but they
#: trigger a warning so an operator can audit a particular chunk
#: before it's served to an LLM tool call. The KB pipeline wraps every
#: chunk in <<<BEGIN_DOC_CHUNK>>> / <<<END_DOC_CHUNK>>> at runtime
#: (see context-builder.ts), so this scanner is primarily a tripwire:
#: noisy hits indicate the operator may want to remove or annotate the
#: source file before it goes into production retrieval.
_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(?:all\s+)?(?:previous|above)\s+instructions?", re.IGNORECASE),
    re.compile(r"<<\s*SYSTEM\s*>>", re.IGNORECASE),
    re.compile(r"\[\s*SYSTEM\s*PROMPT\s*\]", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+", re.IGNORECASE),
    re.compile(r"disregard\s+(?:all\s+)?(?:previous|above)\s+", re.IGNORECASE),
    re.compile(r"<<<\s*BEGIN_DOC_CHUNK\s*>>>", re.IGNORECASE),
    re.compile(r"<<<\s*END_DOC_CHUNK\s*>>>", re.IGNORECASE),
    # Common Chinese variants.
    re.compile(r"忽略(?:之前|以上|前面).{0,3}(?:指令|指示|规则)"),
    re.compile(r"你\s*现在\s*是"),
]


#: Zero-width / bidi / line/paragraph separator characters an attacker
#: can use to defeat the ASCII-anchored injection patterns. e.g.
#: "ig​nore previous instructions" passes the raw scan but
#: reads correctly to the LLM. Stripped before pattern matching.
_INVISIBLE_CHARS_RE = re.compile(r"[​-‏‪-‮⁦-⁩  ﻿]")


def _normalise_for_injection_scan(content: str) -> str:
    """Defeat zero-width + bidi-control evasion before the pattern
    scan. NFKC collapses compatibility forms (full-width Latin,
    superscripts, etc.) so e.g. "ｉｇｎｏｒｅ" matches "ignore"; the
    regex strips zero-width joiners and bidi controls (`U+200B`-
    `U+200F`, `U+202A`-`U+202E`, `U+2066`-`U+2069`, BOM). The
    original string still gets ingested into the chunk — we only use
    the normalised form for detection.

    NOTE: pure script-level homoglyph evasion (Greek `ο` vs Latin
    `o`, Cyrillic `а` vs Latin `a`) is NOT covered here — that
    requires the Unicode confusables mapping (TR#39). The current
    scanner is a tripwire, not a complete filter; the pattern set is
    deliberately false-positive-friendly and an operator-reviewable
    warning is the unit of work. A motivated attacker writing
    homoglyph-clean content is a separate threat model we accept."""
    return _INVISIBLE_CHARS_RE.sub("", unicodedata.normalize("NFKC", content))


def scan_for_injection_markers(content: str) -> List[str]:
    """Return a list of matched pattern descriptions for the given
    chunk body. Empty list means the chunk looks benign. The scanner
    is intentionally pattern-based and case-insensitive; false
    positives are expected (and acceptable) — the cost of a manual
    review on a flagged chunk is much lower than the cost of a real
    injection landing in the KB unnoticed.

    Input is first run through `_normalise_for_injection_scan` so
    homoglyph (Greek omicron etc.) + zero-width / bidi evasion
    techniques don't bypass the ASCII-anchored patterns."""
    normalised = _normalise_for_injection_scan(content)
    hits: List[str] = []
    for pattern in _INJECTION_PATTERNS:
        match = pattern.search(normalised)
        if match:
            hits.append(match.group(0)[:80])
    return hits


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


#: Chunk size for streaming file reads when computing source
#: fingerprints. Sized to keep memory bounded on huge clinical PDFs
#: (>100 MB) while still amortising the per-read overhead. The 1 MiB
#: value is a comfortable middle ground; tweak if a real corpus shows
#: hot spots.
_HASH_STREAM_CHUNK = 1024 * 1024


def source_fingerprint_from_path(
    file_path: Path, parser_name: str, pipeline_version: str
) -> str:
    """Streaming source fingerprint.

    The previous helper required the whole file body in memory just to
    feed `hashlib.sha256`. A multi-hundred-MB PDF (not unusual for
    clinical archives shipped as scans) would push the worker's RSS
    past container limits during a corpus-wide ingest. Stream-read the
    file in fixed-size chunks instead so memory stays bounded.
    """
    h = hashlib.sha256()
    h.update(b"file:")
    with file_path.open("rb") as fh:
        while True:
            buf = fh.read(_HASH_STREAM_CHUNK)
            if not buf:
                break
            h.update(buf)
    h.update(b"\x1fparser:")
    h.update(parser_name.encode("ascii"))
    h.update(b"\x1fpipeline:")
    h.update(pipeline_version.encode("ascii"))
    return h.hexdigest()[:32]


def source_fingerprint(
    file_bytes: bytes, parser_name: str, pipeline_version: str
) -> str:
    """In-memory variant kept for callers that already have the bytes
    (tests, small in-process buffers). Production ingest uses the
    streaming variant above."""
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
    """Stable identifier used both in DB rows and user-facing logs.

    Normalised to Unicode NFC so a macOS-sourced filename (HFS+ stores
    decomposed NFD by default for CJK / accented characters) and a
    Linux-sourced filename (NFC) hash to the same key. Without this,
    `--prune` would treat the NFC name in the DB and the NFD name on
    disk as different paths and either delete the live chunks or
    miss real orphans depending on which side the test runs from.
    """
    raw = str(file_path.relative_to(content_root))
    return unicodedata.normalize("NFC", raw)


def resolve_effective_root(content_root: Path) -> Path:
    """Strip a single wrapper directory when the corpus root contains
    exactly one subdirectory and nothing else.

    Unzipping `FSHD_知识库.zip` into `content/medical-kb/source/`
    leaves the real category folders one level deeper, under
    `content/medical-kb/source/FSHD_知识库/`. Without this, the first
    relative path segment is the wrapper name and `category` ends up
    as "FSHD_知识库" for every chunk -- killing the category-based
    metadata the Chroma corpus relied on.

    We only descend one level and only when the wrapper is
    unambiguous (1 subdir, 0 files, no `.`-hidden entries). Anything
    fancier and the operator should pass --source explicitly.
    """
    if not content_root.is_dir():
        return content_root
    visible = [
        child
        for child in content_root.iterdir()
        if not child.name.startswith(".") and child.name != "__MACOSX"
    ]
    if len(visible) == 1 and visible[0].is_dir():
        return visible[0]
    return content_root


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
    #: Number of (source_file, chunks) deletions issued by --prune.
    files_pruned: int = 0
    chunks_pruned: int = 0
    #: Per-source `delete_by_source` failures during --prune. Rolled
    #: into the process exit status so a silent prune failure can't
    #: leave the script returning 0 with stale chunks still in the DB.
    prune_errors: int = 0
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


def _prune_orphans(
    *,
    content_root: Path,
    backend: VectorBackend,
    dry_run: bool,
    stats: IngestStats,
    only_filter_active: bool,
) -> None:
    """Drop chunks whose source_file no longer exists on disk.

    Called after the main ingest loop when `--prune` is set. Compares
    the set of `source_file` values currently in the backend against
    the files we just walked on disk; anything present in the DB but
    missing on disk is an orphan and gets deleted (one
    `delete_by_source` call per file so the action log stays
    informative).

    Skipped silently when the operator scoped the ingest with
    `--only` -- a partial-format walk would mark every chunk of
    other formats as "missing on disk" and wipe them. The action
    log emits a single warning so the operator knows pruning was
    suppressed.
    """
    if only_filter_active:
        stats.actions.append(
            "prune    skipped (--only filter active; would mis-classify "
            "out-of-scope formats as orphans)"
        )
        return

    try:
        db_source_files = set(backend.list_all_source_files())
    except NotImplementedError as exc:
        stats.actions.append(f"prune    skipped: {exc}")
        return

    # Compute on-disk source keys for ALL supported extensions. We
    # intentionally re-walk the tree here (rather than reusing the
    # ingest loop's matched files) so prune still works in the
    # "all-files-deleted" case where the ingest loop never ran.
    all_exts: set[str] = set()
    for parser in ALL_PARSERS:
        all_exts.update(parser.extensions)
    on_disk_keys = {
        relative_source_key(path, content_root)
        for path in content_root.rglob("*")
        if path.is_file()
        and not path.name.startswith(".")
        and path.suffix.lower() in all_exts
    }

    orphans = sorted(db_source_files - on_disk_keys)
    if not orphans:
        stats.actions.append("prune    no orphans found")
        return

    for source_key in orphans:
        if dry_run:
            stats.actions.append(f"prune    would delete {source_key}")
            stats.files_pruned += 1
            continue
        try:
            deleted = backend.delete_by_source(source_key)
            stats.actions.append(
                f"prune    deleted {source_key} ({deleted} chunks)"
            )
            stats.files_pruned += 1
            stats.chunks_pruned += deleted
        except Exception as exc:
            # Track in a counted field, not just the action log:
            # main() folds prune_errors into the exit status so a
            # silent delete failure can't return 0 while stale chunks
            # stay in the DB.
            stats.prune_errors += 1
            stats.actions.append(f"prune    error {source_key}: {exc}")


def ingest(
    *,
    content_root: Path,
    backend: VectorBackend,
    embedder: Embedder,
    batch_size: int = DEFAULT_BATCH_SIZE,
    dry_run: bool = False,
    only: Sequence[str] | None = None,
    prune: bool = False,
) -> IngestStats:
    stats = IngestStats()

    if not content_root.exists():
        raise FileNotFoundError(f"Content root does not exist: {content_root}")

    allowed = _supported_extensions(only)
    files, stats.files_skipped_unsupported = _gather_files(content_root, allowed)
    stats.files_seen = len(files)
    if not files:
        # No supported files on disk this round. The ingest loop is a
        # no-op, but --prune must still run so the "every file was
        # deleted" case (issue #20 reproducer) still removes the now-
        # orphaned chunks from the DB.
        if prune:
            _prune_orphans(
                content_root=content_root,
                backend=backend,
                dry_run=dry_run,
                stats=stats,
                only_filter_active=bool(only),
            )
        return stats

    source_keys = [relative_source_key(f, content_root) for f in files]
    existing_fps = backend.list_source_fingerprints(source_keys)

    pending: List[BackendChunk] = []
    chunks_per_source: Dict[str, int] = {}
    # (source_key, new_source_fingerprint) pairs whose stale chunks
    # should be removed after every new chunk has been upserted.
    updated_sources: List[tuple[str, str]] = []

    for file_path in files:
        source_key = relative_source_key(file_path, content_root)
        parser: Parser | None = get_parser_for(file_path)
        if parser is None:
            # Filtered upstream, but defensive.
            stats.files_skipped_unsupported += 1
            continue

        try:
            # Streaming hash so the file body never lives in memory
            # all at once. The parser still re-opens the file in
            # parser.parse(); the duplicate I/O is the cost of the
            # memory cap.
            file_fp = source_fingerprint_from_path(
                file_path, parser.parser_name, PIPELINE_VERSION
            )
        except Exception as exc:
            stats.files_errored += 1
            stats.actions.append(f"error    {source_key}: read failed: {exc}")
            continue

        # Treat the file as unchanged ONLY when there's exactly one
        # known fingerprint AND it matches the on-disk one. If the
        # backend reports multiple fingerprints for this source, the
        # previous run crashed between upsert and stale-cleanup —
        # forcing re-ingestion is what triggers the cleanup retry on
        # the next pass.
        known_fps = existing_fps.get(source_key)
        if known_fps == {file_fp}:
            stats.files_unchanged += 1
            stats.actions.append(f"unchanged {source_key}")
            continue
        if known_fps and len(known_fps) > 1:
            stats.actions.append(
                f"warn     {source_key}: backend reports {len(known_fps)} "
                f"distinct fingerprints (likely an interrupted cleanup); "
                f"forcing re-ingest"
            )

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
            # Defer the delete until AFTER the new chunks are upserted.
            # The previous order (delete-then-upsert, with the upsert
            # happening at the end of the whole-corpus loop) could leave
            # a file with ZERO chunks if the process crashed between the
            # delete and the upsert. The deferred delete pattern
            # guarantees the file always has a usable set of chunks in
            # the DB; in the crash window, both the old and new
            # fingerprints coexist and the next ingest run dedupes them.
            updated_sources.append((source_key, file_fp))
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

            # Pattern-scan every chunk for prompt-injection markers.
            # Hits surface as a warning in the action log; the chunk
            # still ingests (legitimate research material may discuss
            # these patterns) but the operator gets a visible audit
            # trail to review before the chunk is served to an LLM.
            injection_hits = scan_for_injection_markers(raw.content)
            if injection_hits:
                stats.actions.append(
                    f"warn     {source_key}#{raw.chunk_index}: "
                    f"injection markers detected: {injection_hits}"
                )

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
                        "injection_hits": injection_hits if injection_hits else None,
                    },
                    embed_model=embedder.model_name,
                )
            )

    stats.chunks_upserted = len(pending)
    if pending and not dry_run:
        for start in range(0, len(pending), batch_size):
            batch = pending[start : start + batch_size]
            texts = [chunk.content for chunk in batch]
            embeddings = embedder.embed_texts(texts)
            if len(embeddings) != len(batch):
                raise RuntimeError(
                    f"Embedder returned {len(embeddings)} vectors for "
                    f"{len(batch)} chunks"
                )
            for chunk, emb in zip(batch, embeddings):
                chunk.embedding = emb
            backend.upsert(batch)
            stats.actions.append(
                f"upsert   batch {start // batch_size + 1}: {len(batch)} chunks"
            )

        # All new chunks landed safely → drop the stale ones whose
        # source_fingerprint no longer matches. Anything that fails
        # here leaves the DB with both fingerprints present; the next
        # ingest's list_source_fingerprints call will surface multiple
        # fingerprints for that source_key and force re-ingestion
        # (which retries the cleanup).
        #
        # Backends that don't implement scoped fingerprint deletion
        # (e.g. chroma_cloud) raise NotImplementedError. Surfacing
        # that as a single per-run warning (rather than falling back
        # to delete_by_source, which would wipe the just-upserted
        # batch) lets the operator know stale chunks may persist on
        # that backend without breaking the ingest.
        unsupported_logged = False
        for source_key, keep_fp in updated_sources:
            try:
                removed = backend.delete_by_source_other_fingerprints(
                    source_key, keep_fp
                )
                if removed:
                    stats.actions.append(
                        f"cleanup  {source_key}: removed {removed} stale chunks"
                    )
            except NotImplementedError as exc:
                if not unsupported_logged:
                    stats.actions.append(
                        f"warn     scoped stale-chunk delete unsupported: {exc}; "
                        f"old fingerprints will remain on this backend"
                    )
                    unsupported_logged = True
            except Exception as exc:
                stats.actions.append(
                    f"cleanup  {source_key}: stale-chunk delete failed: {exc}"
                )

    if prune:
        _prune_orphans(
            content_root=content_root,
            backend=backend,
            dry_run=dry_run,
            stats=stats,
            only_filter_active=bool(only),
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
    parser.add_argument(
        "--prune",
        action="store_true",
        help=(
            "After the main ingest, delete chunks in the backend whose "
            "source_file no longer exists under --source. Skipped when "
            "--only is set (a partial walk would falsely mark "
            "out-of-scope formats as orphans). Combine with --dry-run to "
            "preview what would be deleted."
        ),
    )
    args = parser.parse_args()

    only_list = [s for s in (args.only or "").split(",") if s.strip()] or None
    backend_name = os.getenv("KB_BACKEND") or DEFAULT_BACKEND

    raw_source = Path(args.source)
    effective_source = resolve_effective_root(raw_source)

    print("KB ingest")
    print(f"  source       : {raw_source}")
    if effective_source != raw_source:
        print(f"  effective    : {effective_source}  (stripped single-dir wrapper)")
    print(f"  backend      : {backend_name}")
    print(f"  embed model  : {os.getenv('KB_EMBED_MODEL', 'BAAI/bge-m3')}")
    print(f"  pipeline ver : {PIPELINE_VERSION}")
    print(f"  batch size   : {args.batch_size}")
    if only_list:
        print(f"  only         : {only_list}")
    if args.dry_run:
        print("  DRY RUN (no backend writes)")
    print()

    backend = create_backend(backend_name)
    embedder = create_embedder()

    stats = ingest(
        content_root=effective_source,
        backend=backend,
        embedder=embedder,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
        only=only_list,
        prune=args.prune,
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
    if args.prune:
        print(f"  pruned files       : {stats.files_pruned}")
        print(f"  pruned chunks      : {stats.chunks_pruned}")
        print(f"  prune errors       : {stats.prune_errors}")

    backend.close()
    # Prune delete failures must contribute to a non-zero exit so an
    # operator (or CI) running --prune can't get a "green" run while
    # stale chunks remain in the DB.
    return 1 if (stats.files_errored or stats.prune_errors) else 0


if __name__ == "__main__":
    sys.exit(main())
