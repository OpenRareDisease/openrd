"""Unit tests for the shared chunker.

Run via `pytest scripts/kb_parsers/test_chunker.py` from the venv:
  source .venv/bin/activate
  pytest scripts/kb_parsers -q

Markdown-aware splitting is the only legacy behaviour we promise to
keep byte-stable, so its tests are most paranoid. Paragraph-greedy
splitting + the over-large-paragraph window fallback are the
general-purpose path covering PDF / docx / image content.
"""

from __future__ import annotations

import pytest

from kb_parsers.chunker import sanitize_for_db, split_markdown, split_paragraphs


# --------------------------------------------------------- split_paragraphs

def test_split_paragraphs_keeps_short_text_as_single_chunk() -> None:
    text = "这是一段刚好长过最低阈值的中文内容用于测试。"
    chunks = split_paragraphs(text, max_chars=200, min_chars=10)
    assert len(chunks) == 1
    assert chunks[0].content == text
    assert chunks[0].chunk_index == 0


def test_split_paragraphs_packs_paragraphs_greedy() -> None:
    text = "A 段。\n\nB 段。\n\nC 段。"
    chunks = split_paragraphs(text, max_chars=200, min_chars=1)
    # All three fit comfortably under 200 chars together.
    assert len(chunks) == 1
    assert "A 段" in chunks[0].content and "C 段" in chunks[0].content


def test_split_paragraphs_breaks_when_adding_would_exceed_cap() -> None:
    # Each paragraph is 50 chars; max_chars=120 fits two but not three.
    p = "x" * 50
    text = f"{p}\n\n{p}\n\n{p}"
    chunks = split_paragraphs(text, max_chars=120, min_chars=1)
    assert len(chunks) == 2


def test_split_paragraphs_drops_chunks_below_min_chars() -> None:
    # Single tiny paragraph -> dropped.
    chunks = split_paragraphs("hi", max_chars=200, min_chars=10)
    assert chunks == []


def test_split_paragraphs_window_fallback_for_oversized_paragraph() -> None:
    # One paragraph far longer than max_chars. Must produce multiple
    # chunks rather than one giant overflowing chunk.
    sentence = "甲基化是一种重要的表观遗传修饰。"
    big = sentence * 80  # ~ 1280 chars
    chunks = split_paragraphs(big, max_chars=200, min_chars=10)
    assert len(chunks) > 1
    assert all(len(c.content) <= 200 for c in chunks)
    # Recombined text should still contain the source.
    rejoined = "".join(c.content for c in chunks)
    assert sentence in rejoined


def test_split_paragraphs_window_handles_no_punctuation() -> None:
    # OCR output with zero sentence delimiters: window should fall
    # back to hard slicing rather than silently truncating.
    raw = "a" * 1000
    chunks = split_paragraphs(raw, max_chars=300, min_chars=10)
    assert len(chunks) >= 4
    assert all(len(c.content) <= 300 for c in chunks)


def test_split_paragraphs_chunk_index_is_dense_and_zero_based() -> None:
    text = "A" * 100 + "\n\n" + "B" * 100 + "\n\n" + "C" * 100
    chunks = split_paragraphs(text, max_chars=120, min_chars=1)
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


# ------------------------------------------------------------ split_markdown

def test_split_markdown_keeps_heading_with_its_section() -> None:
    md = "## A\nbody for A\n\n## B\nbody for B"
    chunks = split_markdown(md, max_chars=200, min_chars=5)
    assert len(chunks) == 2
    assert chunks[0].content.startswith("## A")
    assert chunks[1].content.startswith("## B")


def test_split_markdown_emits_no_chunks_for_empty_body() -> None:
    assert split_markdown("", max_chars=200, min_chars=5) == []
    assert split_markdown("\n\n   \n", max_chars=200, min_chars=5) == []


def test_split_markdown_skips_sections_shorter_than_min_chars() -> None:
    md = "## tiny\nx\n\n## real\nthis section is long enough to keep"
    chunks = split_markdown(md, max_chars=200, min_chars=20)
    assert len(chunks) == 1
    assert chunks[0].content.startswith("## real")


def test_split_markdown_subsplits_oversized_sections() -> None:
    big_body = ("para " + "x" * 200 + "\n\n") * 10  # ~2k chars
    md = f"## Big\n{big_body}"
    chunks = split_markdown(md, max_chars=400, min_chars=10)
    assert len(chunks) >= 2
    assert all(len(c.content) <= 400 + 50 for c in chunks)  # small slack


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   \n\n   ",
        "\n\n\n",
    ],
)
def test_split_paragraphs_blank_input_returns_empty(text: str) -> None:
    assert split_paragraphs(text, max_chars=100, min_chars=1) == []


# ------------------------------------------------------------ sanitize_for_db

def test_sanitize_strips_nul_bytes() -> None:
    # Real-world failure mode: pdfminer leaks NUL bytes from PDF
    # stream markers, which crashes the Postgres insert.
    raw = "hello\x00 world\x00\x00 again"
    assert sanitize_for_db(raw) == "hello world again"


def test_sanitize_keeps_tab_newline_carriage_return() -> None:
    raw = "a\tb\nc\rd"
    assert sanitize_for_db(raw) == "a\tb\nc\rd"


def test_sanitize_strips_other_c0_controls() -> None:
    raw = "ok\x07\x08\x0bbeep"
    assert sanitize_for_db(raw) == "okbeep"


def test_sanitize_is_a_no_op_on_clean_text() -> None:
    raw = "纯净文本 with English 123."
    assert sanitize_for_db(raw) == raw


def test_split_paragraphs_strips_nul_via_sanitize() -> None:
    chunks = split_paragraphs(
        "ok text long enough\x00 to survive min_chars filter",
        max_chars=200,
        min_chars=10,
    )
    assert len(chunks) == 1
    assert "\x00" not in chunks[0].content


def test_split_markdown_strips_nul_via_sanitize() -> None:
    chunks = split_markdown(
        "## H\nok body long enough\x00 to survive\x00",
        max_chars=200,
        min_chars=10,
    )
    assert len(chunks) == 1
    assert "\x00" not in chunks[0].content


# ---------------------------------------------------------- code tables

def _catalogue(entries: int = 20) -> str:
    """A miniature 《中国康复辅助器具目录》: a title page, a category
    header carrying the table's column headings, then numbered
    entries. Shaped like the real extraction — no blank lines
    anywhere, which is what sent the real one down the sentence
    windower."""
    lines = [
        "中国康复辅助器具目录（2023年版）",
        "中华人民共和国民政部 2023年11月",
        "01 12 下肢矫形器",
        "代  码名  称产品描述预期用途品名举例 类  别",
    ]
    for i in range(entries):
        lines.append(
            f"01 12 {i * 3:02d}第{i}号矫形器 围绕某关节的矫形器。"
            f"主材质为高弹性复合材料等。适用于第{i}类损伤的外部固定。"
        )
    return "\n".join(lines)


def test_code_table_gives_each_entry_its_own_chunk() -> None:
    chunks = split_paragraphs(_catalogue(20), max_chars=1200, min_chars=30)
    # 20 entries + the category record + the title page.
    assert len(chunks) == 22
    bodies = [c.content for c in chunks]
    assert sum("01 12 18第6号矫形器" in b for b in bodies) == 1
    # ...and only that entry. Before this split the same chunk carried
    # three or four unrelated device classes, so it embedded as none.
    only = next(b for b in bodies if "01 12 18第6号矫形器" in b)
    assert "第5号矫形器" not in only
    assert "第7号矫形器" not in only


def test_code_table_entry_carries_its_category() -> None:
    """「踝足矫形器在国家目录里是哪一类」 asks for the category, which
    lives on a header line the entry itself does not repeat."""
    chunks = split_paragraphs(_catalogue(20), max_chars=1200, min_chars=30)
    entry = next(c.content for c in chunks if "01 12 18第6号矫形器" in c.content)
    assert entry.startswith("01 12 下肢矫形器\n")


def test_code_table_loses_no_text() -> None:
    """Asserted against `_split_code_table` rather than through
    `split_paragraphs`: routed through the public function this passes
    whether or not the code-table path exists, because the sentence
    windower conserves text too. Only the direct call proves the new
    path does."""
    import re

    from kb_parsers.chunker import _split_code_table

    source = _catalogue(20)
    records = _split_code_table(source, max_chars=1200, min_chars=30)
    assert records is not None
    # Strip the injected category prefix before comparing; it is the
    # only thing this path adds.
    stripped = []
    for record in records:
        lines = record.split("\n")
        if len(lines) > 1 and re.fullmatch(r"\d{2} \d{2}\D.*", lines[0]):
            if re.match(r"\d{2} \d{2} \d{2}", lines[1]):
                lines = lines[1:]
        stripped.append("\n".join(lines))
    squash = lambda s: re.sub(r"\s+", "", s)  # noqa: E731
    assert squash("".join(stripped)) == squash(source)


def test_prose_with_a_few_codes_is_not_treated_as_a_table() -> None:
    """The guard is a plain count, so the thing it must never do is
    fire on prose. Measured against the corpus the runner-up document
    scores 2 against a threshold of 12."""
    text = "\n".join(
        [
            "患者于 2024 年确诊，随访见下表。",
            "01 12 首次评估结果正常。",
            "02 03 第二次评估。",
            "此后每年复查一次，具体安排由主诊医师决定。" * 40,
        ]
    )
    chunks = split_paragraphs(text, max_chars=300, min_chars=30)
    # Sentence windows, not record splits: the last paragraph is one
    # long run and gets cut on 。 rather than at a line start.
    assert len(chunks) > 1
    assert not any(c.content.startswith("01 12 首次评估") for c in chunks)


def test_code_table_needs_the_full_threshold() -> None:
    from kb_parsers.chunker import _MIN_CODE_TABLE_RECORDS, _split_code_table

    just_under = _catalogue(_MIN_CODE_TABLE_RECORDS - 2)  # + 1 category record
    assert _split_code_table(just_under, max_chars=1200, min_chars=30) is None
    just_over = _catalogue(_MIN_CODE_TABLE_RECORDS)
    assert _split_code_table(just_over, max_chars=1200, min_chars=30) is not None


def test_code_table_windows_an_oversized_entry() -> None:
    """One entry longer than the cap must still be cut, and the cap is
    on the whole chunk — the category prefix counts toward it, or a
    document with long category names would silently blow past what
    the embedder reads."""
    from kb_parsers.chunker import _split_code_table

    long_entry = "适用于某种损伤的外部固定和保护。" * 30
    text = _catalogue(20).replace(
        "01 12 18第6号矫形器 围绕某关节的矫形器。",
        f"01 12 18第6号矫形器 {long_entry}围绕某关节的矫形器。",
    )
    records = _split_code_table(text, max_chars=300, min_chars=30)
    assert records is not None
    # The entry was cut into several windows, each still labelled with
    # its category.
    windows = [r for r in records if "适用于某种损伤的外部固定和保护。" in r]
    assert len(windows) > 1
    assert all(r.startswith("01 12 下肢矫形器\n") for r in windows)
    assert max(len(r) for r in records) <= 300


def test_short_record_trails_onto_the_previous_one() -> None:
    """min_chars keeps meaningless fragments out of the index; it must
    not delete a catalogue entry that is simply terse."""
    from kb_parsers.chunker import _split_code_table

    records = _split_code_table(
        _catalogue(20) + "\n01 12 99短", max_chars=1200, min_chars=30
    )
    assert records is not None
    assert any("01 12 99短" in r for r in records)


def test_a_run_of_short_records_still_respects_max_chars() -> None:
    """The trail-onto-previous fallback must not become an unbounded
    accumulator.

    An annex table of code + short name and no description column
    produces nothing but sub-`min_chars` pieces. Trailing each one onto
    its predecessor with no cap merged 100 of them into a single
    3,001-character chunk carrying 100 unrelated device classes — both
    past `max_chars` (which nothing downstream re-measures, so the
    embedder silently truncates the tail) and back to the
    chunk-about-everything the code-table path exists to remove. Those
    two figures are this fixture's own, measured by running the
    pre-bound `elif out:` branch over it; entries 100-119 render at
    exactly `min_chars` and so stand alone rather than trailing.
    """
    from kb_parsers.chunker import _split_code_table

    lines = ["01 12 下肢矫形器"]
    for i in range(120):
        lines.append(f"01 12 {i % 100:02d}下肢矫形器变体{i}")
    source = "\n".join(lines)

    records = _split_code_table(source, max_chars=1200, min_chars=30)
    assert records is not None
    assert max(len(r) for r in records) <= 1200
    # Bounding the merge must not start dropping entries.
    joined = "\n".join(records) + "\n"
    assert all(f"下肢矫形器变体{i}\n" in joined for i in range(120))


def _junk_floor_would_drop(text: str) -> bool:
    """The length half of the retrieval-side junk floor, restated.

    `apps/api/knowledge.py:_is_junk` discards any hit under 30
    characters measured as `_norm_text` measures — ends stripped,
    whitespace runs collapsed to one space — before ranking and
    without saying so. A chunk the ingester stores under that length is
    unreachable by every query, so the assertions below are about
    whether the chunk still exists downstream, not about whether the
    chunker kept the characters. (`_is_junk` also drops navigation
    boilerplate; that half is not this path's business.)
    """
    import re

    return len(re.sub(r"\s+", " ", text.strip())) < 30


def test_no_code_table_chunk_lands_under_the_retrieval_junk_floor() -> None:
    """A run of short records that ends before the cap does.

    45 code + short-name entries fill one 1,199-character chunk and
    leave one record over. Appended as its own chunk it is 26
    characters — stored by the ingester, which applies no length
    filter, and then dropped by `_is_junk` on every query. The trailing
    merge exists to stop exactly that record from being lost, so
    handing it to a branch that emits it short loses it anyway, one
    layer down.
    """
    from kb_parsers.chunker import _split_code_table

    lines = ["01 12 下肢矫形器"]
    for i in range(45):
        lines.append(f"01 12 {i % 100:02d}踝足矫形器{i % 10}")
    source = "\n".join(lines)

    records = _split_code_table(source, max_chars=1200, min_chars=30)
    assert records is not None
    assert [r for r in records if _junk_floor_would_drop(r)] == []
    # The last record is still there, and still readable with its code,
    # and folding it in cost none of the ones before it.
    assert any("01 12 44踝足矫形器4" in r for r in records)
    joined = "\n".join(records) + "\n"
    assert all(f"01 12 {i:02d}踝足矫形器{i % 10}\n" in joined for i in range(45))
    # Bounded overshoot: the fold may cross `max_chars`, by less than
    # `min_chars`. It must not go back to accumulating without a bound.
    assert max(len(r) for r in records) <= 1200 + 30


def test_a_short_record_followed_by_a_long_one_is_not_orphaned() -> None:
    """The same hole in the middle of a document rather than at its end.

    A short piece that cannot fit onto the full chunk before it starts
    a new one; if the next entry is long enough to stand alone it is
    appended separately and the short chunk is never grown. Nothing
    after it can rescue it, so it is not only the document's last
    record that can leave here under `min_chars`.
    """
    from kb_parsers.chunker import _split_code_table

    lines = ["01 12 下肢矫形器"]
    for i in range(45):
        lines.append(f"01 12 {i % 100:02d}踝足矫形器{i % 10}")
    lines.append("01 12 99长条目 围绕某关节的矫形器，主材质为高弹性复合材料。" * 2)
    source = "\n".join(lines)

    records = _split_code_table(source, max_chars=1200, min_chars=30)
    assert records is not None
    assert [r for r in records if _junk_floor_would_drop(r)] == []
    assert any("01 12 44踝足矫形器4" in r for r in records)
    assert any("01 12 99长条目" in r for r in records)


def test_short_leading_prose_is_not_left_as_its_own_chunk() -> None:
    """The first-piece case: whatever precedes the first code.

    A catalogue whose front matter is three characters long produces a
    3-character piece with no previous chunk to trail onto, and the
    category record after it is long enough to stand alone, so nothing
    lands on it either. It is the same defect from the other end of the
    document — a stored chunk the retrieval floor deletes — and the
    only place it can go is forward, into what follows it.
    """
    from kb_parsers.chunker import _split_code_table

    # `_catalogue`'s first two lines are its title page; drop them so
    # the text before the first code is just the annex heading.
    body = _catalogue(20).split("\n", 2)[2]
    source = "附录一\n" + body
    records = _split_code_table(source, max_chars=1200, min_chars=30)
    assert records is not None
    assert [r for r in records if _junk_floor_would_drop(r)] == []
    assert records[0].startswith("附录一\n")


def test_a_chunk_padded_out_by_whitespace_still_counts_as_short() -> None:
    """`min_chars` counts characters; the junk floor counts them with
    whitespace collapsed, so the two disagree about a table row spaced
    out into columns.

    The category record here is 32 characters and 23 once collapsed: it
    satisfies `min_chars`, is emitted as its own chunk, and is then
    dropped from every search result. The shortest chunk the real
    catalogue produces is a category header of the same shape at 35 raw
    / 32 collapsed — two characters clear of the floor — so this is one
    more column of padding away rather than hypothetical.
    """
    from kb_parsers.chunker import _split_code_table

    padded_headings = "代  码    名  称    类  别"
    source = _catalogue(20).replace(
        "代  码名  称产品描述预期用途品名举例 类  别", padded_headings
    )

    header = f"01 12 下肢矫形器\n{padded_headings}"
    assert len(header) >= 30  # a length check on the raw text lets it pass
    assert _junk_floor_would_drop(header)  # ...and retrieval drops it anyway

    records = _split_code_table(source, max_chars=1200, min_chars=30)
    assert records is not None
    assert [r for r in records if _junk_floor_would_drop(r)] == []
    # It survived by joining the entry below it, not by being dropped.
    carrier = next(r for r in records if padded_headings in r)
    assert "01 12 00第0号矫形器" in carrier
