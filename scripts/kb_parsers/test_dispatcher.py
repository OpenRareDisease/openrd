"""Tests for the parser dispatcher.

The dispatcher's only job is to route a `Path` to a `Parser` by file
suffix. These tests pin that contract — adding a new parser should
not be allowed to silently shadow an existing one.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from kb_parsers import (
    ALL_PARSERS,
    DocxParser,
    HtmlParser,
    ImageParser,
    MarkdownParser,
    PdfParser,
    get_parser_for,
)


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("doc.md", MarkdownParser),
        ("DOC.MD", MarkdownParser),
        ("doc.markdown", MarkdownParser),
        ("report.pdf", PdfParser),
        ("report.PDF", PdfParser),
        ("notes.docx", DocxParser),
        ("scan.png", ImageParser),
        ("scan.jpg", ImageParser),
        ("scan.JPEG", ImageParser),
        ("page.htm", HtmlParser),
        ("page.HTML", HtmlParser),
    ],
)
def test_get_parser_for_routes_by_extension(filename: str, expected: type) -> None:
    parser = get_parser_for(Path(filename))
    assert parser is not None
    assert isinstance(parser, expected)


@pytest.mark.parametrize(
    "filename",
    [
        "deck.pptx",       # pptx parser not in scope yet
        "data.csv",
        "image.svg",
        "archive.zip",
        "noext",
    ],
)
def test_get_parser_for_returns_none_for_unsupported(filename: str) -> None:
    assert get_parser_for(Path(filename)) is None


def test_all_parsers_have_unique_extensions() -> None:
    """Each extension should be claimed by exactly one parser, so the
    dispatch is deterministic regardless of registration order."""
    seen: dict[str, str] = {}
    for parser in ALL_PARSERS:
        for ext in parser.extensions:
            assert ext not in seen, (
                f"extension {ext!r} claimed by both "
                f"{seen[ext]} and {type(parser).__name__}"
            )
            seen[ext] = type(parser).__name__


def test_all_parsers_declare_a_name() -> None:
    for parser in ALL_PARSERS:
        assert parser.parser_name
        assert parser.parser_name != "base"
