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

from kb_parsers.chunker import split_markdown, split_paragraphs


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
