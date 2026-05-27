"""Shared chunking helpers used by the multi-format ingester.

Two strategies live here:

- `split_markdown` — heading-aware: splits markdown bodies at ATX
  headings of level >= 2, keeping the heading with the section that
  follows it. Mirrors the pre-refactor behaviour so existing .md
  ingest output stays byte-stable.

- `split_paragraphs` — format-neutral: greedy paragraph packer. Used
  for PDF / docx / image / html sections where there is no markdown
  heading structure to exploit. Splits text on blank-line paragraph
  boundaries and packs paragraphs until `max_chars` is reached.

Both return `RawChunk(content, chunk_index)`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List


@dataclass
class RawChunk:
    content: str
    chunk_index: int


def split_markdown(body: str, max_chars: int = 1200, min_chars: int = 30) -> List[RawChunk]:
    """Break a markdown body into well-sized chunks (heading-aware)."""
    sections = _split_by_headings(body)
    return _pack_sections(sections, max_chars=max_chars, min_chars=min_chars)


def split_paragraphs(
    text: str, max_chars: int = 1200, min_chars: int = 30
) -> List[RawChunk]:
    """Greedy paragraph packer for free-form text.

    Falls back to character windows (with a soft sentence boundary at
    Chinese punctuation 。！？ and Western .!?) when a single
    "paragraph" exceeds `max_chars`. Without that fallback, books and
    OCR output that ship as one giant paragraph would produce a single
    over-large chunk that the embedder truncates silently.
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paragraphs:
        return []

    chunks: List[str] = []
    current: List[str] = []
    current_len = 0
    for p in paragraphs:
        if len(p) > max_chars:
            # Flush whatever is already buffered, then sub-split this
            # over-large paragraph.
            if current:
                joined = "\n\n".join(current)
                if len(joined) >= min_chars:
                    chunks.append(joined)
                current = []
                current_len = 0
            for window in _window_text(p, max_chars=max_chars):
                if len(window) >= min_chars:
                    chunks.append(window)
            continue

        projected = current_len + len(p) + (2 if current else 0)
        if projected > max_chars and current:
            joined = "\n\n".join(current)
            if len(joined) >= min_chars:
                chunks.append(joined)
            current = [p]
            current_len = len(p)
        else:
            current.append(p)
            current_len = projected if current else len(p)

    if current:
        joined = "\n\n".join(current)
        if len(joined) >= min_chars:
            chunks.append(joined)

    return [RawChunk(content=c, chunk_index=i) for i, c in enumerate(chunks)]


def _split_by_headings(body: str) -> List[str]:
    parts = re.split(r"(?=^##+\s)", body, flags=re.MULTILINE)
    return [p for p in parts if p.strip()]


def _pack_sections(
    sections: List[str], *, max_chars: int, min_chars: int
) -> List[RawChunk]:
    out: List[RawChunk] = []
    for section in sections:
        section = section.strip()
        if not section:
            continue
        if len(section) <= max_chars:
            if len(section) >= min_chars:
                out.append(RawChunk(content=section, chunk_index=len(out)))
            continue
        # Re-use paragraph packing for over-large heading sections.
        sub = split_paragraphs(section, max_chars=max_chars, min_chars=min_chars)
        for raw in sub:
            out.append(RawChunk(content=raw.content, chunk_index=len(out)))
    return out


# ---------------------------------------------------------------- window

#: Soft sentence delimiters we prefer to break on inside an oversized
#: paragraph. Chinese and Western punctuation both included because
#: the corpus has both.
_SENTENCE_DELIMITERS = re.compile(r"(?<=[。！？!?\.])")


def _window_text(text: str, max_chars: int) -> List[str]:
    """Split `text` into windows of at most `max_chars`, preferring
    breaks after sentence-ending punctuation when one falls inside the
    last 20% of the window."""
    if len(text) <= max_chars:
        return [text]

    sentences = [s for s in _SENTENCE_DELIMITERS.split(text) if s]
    out: List[str] = []
    buf = ""
    for sentence in sentences:
        if len(sentence) > max_chars:
            # A "sentence" itself is too long (rare; comes from OCR
            # output without punctuation). Fall back to hard slicing
            # so we never lose content.
            if buf:
                out.append(buf)
                buf = ""
            for start in range(0, len(sentence), max_chars):
                out.append(sentence[start : start + max_chars])
            continue
        if len(buf) + len(sentence) > max_chars and buf:
            out.append(buf)
            buf = sentence
        else:
            buf = buf + sentence if buf else sentence
    if buf:
        out.append(buf)
    return out
