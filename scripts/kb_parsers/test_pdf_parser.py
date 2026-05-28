"""Tests for the PDF parser.

We don't ship binary PDF fixtures — instead we monkeypatch the
module-level helpers (`_parse_text_layer`, `_ocr_page`,
`_page_count`) so each test exercises a specific control flow with
synthetic input. This keeps the suite hermetic + fast and pins the
contract between the parser orchestration and its helpers.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

import pytest

from kb_parsers import pdf_parser
from kb_parsers.base import ParsedSection
from kb_parsers.pdf_parser import PdfParser


def _section(page: int, text: str) -> ParsedSection:
    return ParsedSection(
        text=text,
        label=f"page {page}",
        extra={"page_index": page - 1, "source_method": "text_layer"},
    )


def test_keeps_pages_with_text_unchanged(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        pdf_parser,
        "_parse_text_layer",
        lambda p: [
            _section(1, "real text" * 20),
            _section(2, "more real text" * 20),
        ],
    )
    monkeypatch.setattr(pdf_parser, "_page_count", lambda p: 2)

    # No OCR should run for non-empty pages — fail loudly if it does.
    def explode(*_a, **_kw):  # pragma: no cover
        raise AssertionError("OCR must not be invoked for non-empty pages")

    monkeypatch.setattr(pdf_parser, "_ocr_page", explode)

    result = PdfParser().parse(tmp_path / "x.pdf")
    assert len(result.sections) == 2
    assert result.metadata["pages_via_ocr"] == 0
    assert result.metadata["ocr_failures"] == 0
    assert "ocr_dep_error" not in result.metadata
    assert "parse_error" not in result.metadata


def test_ocr_rescues_low_text_pages(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        pdf_parser,
        "_parse_text_layer",
        lambda p: [_section(1, ""), _section(2, "good text on this page that is long enough to clear the OCR fallback threshold")],
    )
    monkeypatch.setattr(pdf_parser, "_page_count", lambda p: 2)
    monkeypatch.setattr(
        pdf_parser,
        "_ocr_page",
        lambda p, idx: ("recovered text from scanned page" * 5, None),
    )

    result = PdfParser().parse(tmp_path / "x.pdf")
    labels = [s.label for s in result.sections]
    assert labels == ["page 1", "page 2"]
    assert "recovered text" in result.sections[0].text
    assert result.sections[0].extra["source_method"] == "ocr"
    assert result.metadata["pages_via_ocr"] == 1
    assert result.metadata["ocr_failures"] == 0


def test_ocr_env_failure_surfaces_in_metadata(monkeypatch, tmp_path: Path) -> None:
    """Missing poppler/tesseract used to silently drop scanned pages,
    so a broken bootstrap looked like content gaps. The parser now
    counts env failures and surfaces the last message under
    `ocr_dep_error` even when other pages had text-layer content."""

    monkeypatch.setattr(
        pdf_parser,
        "_parse_text_layer",
        lambda p: [_section(1, ""), _section(2, "good text on this page that is long enough to clear the OCR fallback threshold")],
    )
    monkeypatch.setattr(pdf_parser, "_page_count", lambda p: 2)
    monkeypatch.setattr(
        pdf_parser,
        "_ocr_page",
        lambda p, idx: ("", "PDF rasterise failed (poppler/pdftoppm?): boom"),
    )

    result = PdfParser().parse(tmp_path / "x.pdf")
    # Page 2 still made it; page 1 dropped because OCR couldn't run.
    assert len(result.sections) == 1
    assert result.sections[0].label == "page 2"
    assert result.metadata["ocr_failures"] == 1
    assert "poppler" in result.metadata["ocr_dep_error"]
    # NOT a fatal parse_error -- the file still produced usable content.
    assert "parse_error" not in result.metadata


def test_fully_scanned_pdf_with_broken_ocr_is_a_parse_error(
    monkeypatch, tmp_path: Path
) -> None:
    """All pages empty + every OCR attempt failing means the file is
    effectively unrecoverable. Elevate to parse_error so the
    ingester counts it under `files_errored` (visible signal) rather
    than `files_empty` (looks like a content problem)."""

    monkeypatch.setattr(
        pdf_parser,
        "_parse_text_layer",
        lambda p: [_section(1, ""), _section(2, "")],
    )
    monkeypatch.setattr(pdf_parser, "_page_count", lambda p: 2)
    monkeypatch.setattr(
        pdf_parser,
        "_ocr_page",
        lambda p, idx: ("", "tesseract OCR failed: chi_sim not found"),
    )

    result = PdfParser().parse(tmp_path / "x.pdf")
    assert result.sections == []
    assert result.metadata["ocr_failures"] == 2
    assert "parse_error" in result.metadata
    assert "chi_sim" in result.metadata["parse_error"]


def test_legitimately_blank_scan_is_not_an_error(monkeypatch, tmp_path: Path) -> None:
    """OCR ran fine but the page genuinely had no text (cover sheet,
    blank back page). Empty result, no env failure -- shouldn't
    pollute the metadata."""

    monkeypatch.setattr(
        pdf_parser,
        "_parse_text_layer",
        lambda p: [_section(1, ""), _section(2, "text content here")],
    )
    monkeypatch.setattr(pdf_parser, "_page_count", lambda p: 2)
    monkeypatch.setattr(pdf_parser, "_ocr_page", lambda p, idx: ("", None))

    result = PdfParser().parse(tmp_path / "x.pdf")
    assert len(result.sections) == 1
    assert result.sections[0].label == "page 2"
    assert result.metadata["ocr_failures"] == 0
    assert "ocr_dep_error" not in result.metadata
    assert "parse_error" not in result.metadata


def test_text_layer_extraction_failure_short_circuits(
    monkeypatch, tmp_path: Path
) -> None:
    """If pdfminer can't even open the file (encrypted PDF etc.),
    we surface a parse_error immediately without attempting OCR."""

    def boom(_p):
        raise RuntimeError("encrypted")

    monkeypatch.setattr(pdf_parser, "_parse_text_layer", boom)
    # If OCR were called, this would fail the test.
    monkeypatch.setattr(
        pdf_parser, "_ocr_page", lambda p, idx: pytest.fail("OCR should not run")
    )

    result = PdfParser().parse(tmp_path / "x.pdf")
    assert result.sections == []
    assert "parse_error" in result.metadata
    assert "encrypted" in result.metadata["parse_error"]
