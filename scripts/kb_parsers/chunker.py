"""Shared chunking helpers used by the multi-format ingester.

Three strategies live here:

- `split_markdown` — heading-aware: splits markdown bodies at ATX
  headings of level >= 2, keeping the heading with the section that
  follows it. Mirrors the pre-refactor behaviour so existing .md
  ingest output stays byte-stable.

- `split_paragraphs` — format-neutral: greedy paragraph packer. Used
  for PDF / docx / image / html sections where there is no markdown
  heading structure to exploit. Splits text on blank-line paragraph
  boundaries and packs paragraphs until `max_chars` is reached.

- `_split_code_table` — record-aware, and tried first from inside
  `split_paragraphs`. A classification catalogue is a table of
  numbered entries, not prose; cutting it on sentence punctuation
  produces chunks that are about nothing. See the comment on
  `_CODE_TABLE_RECORD`.

All return `RawChunk(content, chunk_index)`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List


@dataclass
class RawChunk:
    content: str
    chunk_index: int


# Postgres rejects NUL (0x00) inside TEXT/VARCHAR; PDFs and the
# occasional WPS-saved docx ship binary stream markers as embedded
# nulls that pdfminer / python-docx pass through verbatim. Strip them
# centrally so every parser benefits without each having to remember.
# We also drop the other C0 controls that have no legitimate place in
# extracted text (BEL, BS, VT, FF, etc.) — they confuse downstream
# code while contributing nothing. Tab / LF / CR are intentionally
# kept.
_BANNED_CONTROL_CHARS = "".join(
    chr(c) for c in range(32) if c not in (0x09, 0x0A, 0x0D)
)
_CONTROL_TRANSLATION = str.maketrans("", "", _BANNED_CONTROL_CHARS)


def sanitize_for_db(text: str) -> str:
    """Remove the control bytes that prevent the DB layer (or anyone
    reading a chunk back) from storing or echoing the content
    cleanly. Idempotent on already-sanitized text."""
    if not text:
        return text
    return text.translate(_CONTROL_TRANSLATION)


def split_markdown(body: str, max_chars: int = 1200, min_chars: int = 30) -> List[RawChunk]:
    """Break a markdown body into well-sized chunks (heading-aware)."""
    sections = _split_by_headings(sanitize_for_db(body))
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
    text = sanitize_for_db(text)

    records = _split_code_table(text, max_chars=max_chars, min_chars=min_chars)
    if records is not None:
        return [RawChunk(content=c, chunk_index=i) for i, c in enumerate(records)]

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


# ------------------------------------------------------------ code table

#: A record boundary in an ISO 9999 / GB-T 16432 style classification
#: catalogue: two or three space-separated two-digit groups at the
#: start of a line, followed by the class name. Two groups is a
#: category header (「01 12 下肢矫形器」), three is an entry
#: (「01 12 06踝足矫形器」 — the source does not always put a space
#: before the name).
#:
#: Why this exists. 《中国康复辅助器具目录（2023年版）》 extracts as a
#: single 74,209-character paragraph with no blank line in it, so the
#: paragraph packer handed the whole catalogue to `_window_text`,
#: which cuts on 。 — and a table of 432 numbered entries has no
#: sentences. Every chunk therefore straddled three or four unrelated
#: device classes. The one carrying 「01 12 06踝足矫形器」 also carried
#: knee, hip and thigh orthoses, so it embedded as none of them: it
#: came back 8th for 「踝足矫形器在国家目录里是哪一类」, which is the
#: single question this document exists to answer, asked by someone
#: standing at a subsidy window. Splitting on the codes instead gives
#: one chunk per device class, each led by its own code.
_CODE_TABLE_RECORD = re.compile(r"(?m)^[ \t]*(\d{2}(?: \d{2}){1,2})(?=\D|$)")

#: How many records it takes before we believe a document is a
#: classification catalogue rather than prose that happens to contain
#: a few numbers. Deliberately a plain count: the cost of a false
#: positive is bounded — chunks break at line starts instead of at
#: sentence ends, and no text is dropped or duplicated — so a more
#: elaborate test would buy accuracy nobody can spend. Measured
#: against the corpus, exactly one of 235 documents trips this:
#: 《中国康复辅助器具目录（2023年版）》 matches 533 record boundaries,
#: 432 entry codes sitting under 101 category headers.
_MIN_CODE_TABLE_RECORDS = 12


def _split_code_table(
    text: str, *, max_chars: int, min_chars: int
) -> List[str] | None:
    """Split a classification catalogue on its own entry codes.

    Returns None — meaning "not a code table, use the normal path" —
    unless the text carries at least `_MIN_CODE_TABLE_RECORDS` record
    boundaries. Every caller must treat None as "fall through", never
    as "empty".

    When it does return a list, no text has been dropped and every
    chunk in it is long enough to survive the retrieval junk floor: see
    `_absorb_short_chunks` for why both halves of that have to be true
    at once, and why conserving the characters is not by itself
    conserving the record.
    """
    matches = list(_CODE_TABLE_RECORD.finditer(text))
    if len(matches) < _MIN_CODE_TABLE_RECORDS:
        return None

    out: List[str] = []

    def emit(body: str, *, prefix: str = "") -> None:
        body = body.strip()
        if not body:
            return
        # The prefix counts toward the cap. Windowing first and
        # prefixing after would push every entry chunk over it by the
        # length of its category name — silently, since nothing
        # downstream re-measures, and the embedder truncates.
        budget = max_chars - (len(prefix) + 1 if prefix else 0)
        for window in _window_text(body, max_chars=max(budget, 1)):
            piece = f"{prefix}\n{window}" if prefix else window
            if len(piece) >= min_chars:
                out.append(piece)
            elif out and len(out[-1]) + 1 + len(piece) <= max_chars:
                # Too short to stand alone, but dropping it would lose
                # text. Trail it onto the previous record instead —
                # `min_chars` exists to keep meaningless fragments out
                # of the index, not to delete content.
                #
                # Only while it still fits. An annex table of code +
                # short name and no description column produces nothing
                # but sub-`min_chars` pieces, and an unbounded trail
                # merged 100 of them into one 3,001-character chunk
                # carrying 100 unrelated device classes — the exact
                # chunk-about-everything this whole path was written to
                # remove, and past the cap the `budget` above is
                # computed to respect. (That is the measurement from
                # `test_a_run_of_short_records_still_respects_max_chars`,
                # the only artefact that produces it: no document in
                # the corpus has an annex of that shape today, so the
                # bound is a guard against the next one, not a repair
                # of something shipping.)
                out[-1] = f"{out[-1]}\n{piece}"
            else:
                # The previous chunk is full, or there is no previous
                # chunk. Start a new one and let `_absorb_short_chunks`
                # settle it at the end — a chunk that leaves here under
                # `min_chars` is not a small chunk, it is a deleted one.
                out.append(piece)

    # Whatever precedes the first code — the title page and the table
    # of contents — is prose and goes through the normal windower.
    emit(text[: matches[0].start()])

    #: The category header a given entry sits under, so an entry chunk
    #: answers 「哪一类」 and not only 「什么编码」. Only its first line:
    #: the rest of a category record is the table's column headings.
    category = ""
    bounds = [m.start() for m in matches] + [len(text)]
    for i, match in enumerate(matches):
        record = text[bounds[i] : bounds[i + 1]]
        code = match.group(1)
        if code.count(" ") == 1:
            category = record.strip().splitlines()[0].strip()
            emit(record)
        else:
            emit(record, prefix=category)

    return _absorb_short_chunks(out, min_chars=min_chars)


def _absorb_short_chunks(records: List[str], *, min_chars: int) -> List[str]:
    """Fold any chunk still under `min_chars` into a neighbour.

    `emit` trails a short piece onto the previous chunk while it fits
    under `max_chars`; when it does not fit it starts a new chunk. That
    new chunk grows only if another short piece follows it, so it
    leaves the loop under `min_chars` whenever it is the last record of
    the document, or the next record is long enough to stand alone, or
    the run ends on a trailing window of an over-long entry.

    Such a chunk is not a smaller chunk — it is a deleted one.
    `apps/api/knowledge.py:_is_junk` drops any hit shorter than 30
    characters, the same number the ingester passes here as
    `min_chars`, so the record is embedded, stored, and then filtered
    out of every search result before ranking, with nothing said about
    it. `kb-ingest.py` applies no length filter of its own, so this
    function is the last place that can notice.

    Length is measured the way that filter measures it — whitespace
    collapsed to single spaces — and not the way `emit` packs. The two
    differ by however much whitespace a record carries, and the margin
    is thin: the shortest chunk 《中国康复辅助器具目录（2023年版）》
    produces today is a category header, 「01 33 矫形鞋」 plus the
    table's column headings, at 35 raw characters and 32 collapsed. One
    more column of padding in the next catalogue puts a chunk that
    satisfies `min_chars` here under the floor over there.

    A short chunk is therefore merged into a neighbour even when the
    result runs past `max_chars`. The overshoot is the folded chunk's
    own length — under `min_chars` of text, 30 characters against a
    1,200 cap — and it costs the tail of one chunk's embedding, i.e.
    the last record's name is missing from that vector while its text
    still comes back with the chunk. Leaving the chunk short costs the
    record entirely. Merging forward first keeps the document's order:
    a short chunk absorbs what follows it, and only a short tail with
    nothing after it folds backwards.

    A lone short chunk would have no neighbour to fold into, and is
    returned as it is rather than dropped. It cannot arise on this
    path: reaching it takes `_MIN_CODE_TABLE_RECORDS` (12) record
    boundaries, and the shortest possible record — a bare 「01 12 01」 —
    already puts twelve of them at 107 characters.
    """
    merged: List[str] = []
    for record in records:
        if merged and _retrievable_len(merged[-1]) < min_chars:
            merged[-1] = f"{merged[-1]}\n{record}"
        else:
            merged.append(record)
    if len(merged) > 1 and _retrievable_len(merged[-1]) < min_chars:
        tail = merged.pop()
        merged[-1] = f"{merged[-1]}\n{tail}"
    return merged


def _retrievable_len(text: str) -> int:
    """How long this chunk is to the retrieval junk floor.

    Mirrors `_norm_text` in apps/api/knowledge.py: strip the ends, then
    collapse every whitespace run to one space. A chunk cannot pad
    itself past the floor with indentation, so neither may it here.
    """
    return len(re.sub(r"\s+", " ", text.strip()))


# ---------------------------------------------------------------- window

#: Soft sentence delimiters we break on inside an oversized paragraph.
#: Chinese and Western punctuation both included because the corpus
#: has both.
_SENTENCE_DELIMITERS = re.compile(r"(?<=[。！？!?\.])")


def _window_text(text: str, max_chars: int) -> List[str]:
    """Split `text` into windows of at most `max_chars`, breaking after
    sentence-ending punctuation wherever the next sentence would not
    fit.

    This docstring used to promise a break "when one falls inside the
    last 20% of the window". There is no such preference in the code
    and never was; sentences are packed greedily. The behaviour is
    fine — what was wrong was a reader believing the windows were
    tuned when they are not.
    """
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
