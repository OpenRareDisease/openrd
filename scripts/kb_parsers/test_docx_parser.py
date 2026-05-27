"""Tests for the docx parser.

Builds tiny .docx fixtures on the fly via python-docx so we don't
have to ship binary blobs in the repo. Covers heading-aware
sectioning, table flattening, and the legacy-.doc detection.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document  # type: ignore

from kb_parsers.docx_parser import DocxParser


def _write_docx(tmp_path: Path, build) -> Path:
    f = tmp_path / "fixture.docx"
    doc = Document()
    build(doc)
    doc.save(str(f))
    return f


def test_docx_parser_groups_paragraphs_by_heading(tmp_path: Path) -> None:
    def build(doc):
        doc.add_heading("First section", level=1)
        doc.add_paragraph("alpha line")
        doc.add_paragraph("beta line")
        doc.add_heading("Second section", level=1)
        doc.add_paragraph("gamma line")

    f = _write_docx(tmp_path, build)
    result = DocxParser().parse(f)
    labels = [s.label for s in result.sections]
    assert "First section" in labels
    assert "Second section" in labels

    first = next(s for s in result.sections if s.label == "First section")
    assert "alpha line" in first.text
    assert "beta line" in first.text
    assert "gamma line" not in first.text


def test_docx_parser_no_headings_yields_single_section(tmp_path: Path) -> None:
    def build(doc):
        doc.add_paragraph("plain one")
        doc.add_paragraph("plain two")

    f = _write_docx(tmp_path, build)
    result = DocxParser().parse(f)
    assert len(result.sections) == 1
    assert result.sections[0].label == ""
    assert "plain one" in result.sections[0].text
    assert "plain two" in result.sections[0].text


def test_docx_parser_flattens_tables(tmp_path: Path) -> None:
    def build(doc):
        doc.add_paragraph("intro paragraph")
        table = doc.add_table(rows=2, cols=2)
        table.cell(0, 0).text = "h1"
        table.cell(0, 1).text = "h2"
        table.cell(1, 0).text = "v1"
        table.cell(1, 1).text = "v2"

    f = _write_docx(tmp_path, build)
    result = DocxParser().parse(f)
    body = "\n".join(s.text for s in result.sections)
    assert "h1\th2" in body
    assert "v1\tv2" in body
    assert "[表格]" in body


def test_docx_parser_skips_empty_paragraphs(tmp_path: Path) -> None:
    def build(doc):
        doc.add_paragraph("real content")
        doc.add_paragraph("")
        doc.add_paragraph("   ")
        doc.add_paragraph("more")

    f = _write_docx(tmp_path, build)
    result = DocxParser().parse(f)
    assert result.sections
    text = result.sections[0].text
    assert "real content" in text
    assert "more" in text


def test_docx_parser_detects_legacy_doc_format(tmp_path: Path) -> None:
    # Forge a file with OLE2 magic bytes that has a .docx extension —
    # this is the common WPS / older-Word failure mode.
    f = tmp_path / "looks_legit.docx"
    f.write_bytes(b"\xD0\xCF\x11\xE0" + b"\x00" * 100)
    result = DocxParser().parse(f)
    assert result.sections == []
    assert result.metadata.get("format_hint") == "legacy_doc"
    assert "legacy .doc" in result.metadata.get("parse_error", "")


def test_docx_parser_corrupt_file_returns_parse_error(tmp_path: Path) -> None:
    f = tmp_path / "broken.docx"
    f.write_bytes(b"not actually a zip")
    result = DocxParser().parse(f)
    assert result.sections == []
    assert "parse_error" in result.metadata
