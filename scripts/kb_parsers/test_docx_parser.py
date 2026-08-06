"""Tests for the docx parser.

Builds tiny .docx fixtures on the fly via python-docx so we don't
have to ship binary blobs in the repo. Covers heading-aware
sectioning, table flattening, and the legacy-.doc conversion bridge.

The legacy-.doc tests build a real OLE2 file with whichever converter
the machine has, so the round trip is exercised end to end rather than
mocked. They skip (never silently pass) when no converter exists.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from docx import Document  # type: ignore

from kb_parsers import docx_parser as docx_mod
from kb_parsers.docx_parser import DocxParser, find_doc_converter


def _write_docx(tmp_path: Path, build) -> Path:
    f = tmp_path / "fixture.docx"
    doc = Document()
    build(doc)
    doc.save(str(f))
    return f


def _make_legacy_doc(tmp_path: Path, body: str) -> Path:
    """Produce a genuine OLE2 .doc, or skip the test.

    Uses the same converter the parser would, running it backwards
    (txt -> doc). Building the fixture rather than checking in a binary
    keeps the repo clean and means the test is exercising a file the
    local toolchain actually considers a legacy .doc.
    """
    converter = find_doc_converter()
    if converter is None:
        pytest.skip("no legacy-.doc converter on this machine")
    kind, exe = converter

    src = tmp_path / "seed.txt"
    src.write_text(body, encoding="utf-8")
    outdir = tmp_path / "legacy"
    outdir.mkdir()

    if kind == "textutil":
        out = outdir / "fixture.doc"
        cmd = [exe, "-convert", "doc", str(src), "-output", str(out)]
    else:
        out = outdir / "seed.doc"
        cmd = [
            exe,
            "--headless",
            "--norestore",
            f"-env:UserInstallation=file://{tmp_path / 'lo-fixture'}",
            "--convert-to",
            "doc",
            "--outdir",
            str(outdir),
            str(src),
        ]
    proc = subprocess.run(cmd, capture_output=True, timeout=180, check=False)
    if not out.exists() or out.stat().st_size == 0:
        pytest.skip(
            f"{kind} could not build a .doc fixture: "
            f"{(proc.stderr or b'').decode('utf-8', 'replace')[:200]}"
        )
    with out.open("rb") as fh:
        if fh.read(4) != b"\xD0\xCF\x11\xE0":
            pytest.skip(f"{kind} did not emit an OLE2 container")

    # The whole bug class is「.doc wearing a .docx extension」, so the
    # fixture wears one too.
    disguised = tmp_path / "looks_legit.docx"
    disguised.write_bytes(out.read_bytes())
    return disguised


def _fake_converter(tmp_path: Path, body: str) -> Path:
    """A stub executable standing in for LibreOffice.

    Parses `--outdir` out of argv the way the real thing does, so the
    parser's argv construction is under test too, not just its handling
    of the result.
    """
    script = tmp_path / "fake-soffice"
    script.write_text(
        "#!/bin/sh\n"
        "outdir=''\n"
        "prev=''\n"
        'for a in "$@"; do\n'
        '  if [ "$prev" = "--outdir" ]; then outdir="$a"; fi\n'
        '  prev="$a"\n'
        "done\n" + body,
        encoding="utf-8",
    )
    script.chmod(0o755)
    return script


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


def test_legacy_doc_is_converted_and_its_text_recovered(tmp_path: Path) -> None:
    """The regression this whole branch exists for.

    《中国康复辅助器具目录（2023年版）》 is a 2,303,041-byte OLE2 file
    with a .docx extension. Detection alone left it out of the index at
    every ingest, so the KB could not answer「踝足矫形器在国家目录里是哪一
    类」. Detection must now be followed by conversion, and the text has
    to come back out.
    """
    body = "踝足矫形器属于 01 12 06 类。\n\n第二段：辅助器具目录测试文本。\n"
    f = _make_legacy_doc(tmp_path, body)

    result = DocxParser().parse(f)

    assert result.metadata.get("parse_error") is None, result.metadata
    assert result.sections, "conversion produced no sections"
    text = "\n".join(s.text for s in result.sections)
    assert "踝足矫形器属于 01 12 06 类" in text
    assert "辅助器具目录测试文本" in text
    # Provenance survives onto the chunk metadata so kb-doctor can tell
    # a converted file from a native .docx.
    assert result.metadata.get("format_hint") == "legacy_doc"
    assert result.metadata.get("converted_via") in {"textutil", "libreoffice"}


def test_legacy_doc_without_a_converter_fails_loudly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No converter must be an error carrying the install command, not
    a quiet skip — the quiet skip is what hid the catalogue."""
    monkeypatch.setattr(docx_mod, "find_doc_converter", lambda: None)
    f = tmp_path / "looks_legit.docx"
    f.write_bytes(b"\xD0\xCF\x11\xE0" + b"\x00" * 100)

    result = DocxParser().parse(f)

    assert result.sections == []
    assert result.metadata.get("format_hint") == "legacy_doc"
    assert result.metadata.get("converter_available") is False
    error = result.metadata.get("parse_error", "")
    assert "legacy .doc" in error
    # The message has to be actionable without reading this file.
    assert "libreoffice" in error.lower()
    assert "apt-get install" in error
    assert "KB_DOC_CONVERTER" in error


def test_legacy_doc_conversion_failure_is_surfaced(tmp_path: Path) -> None:
    """Garbage that only *looks* like a .doc: the real converter rejects
    it and the failure reaches the ingester's per-file error log.

    Needs a converter to be the converter's refusal rather than the
    missing-converter message, which
    `test_legacy_doc_without_a_converter_fails_loudly` already covers.
    """
    if find_doc_converter() is None:
        pytest.skip("no legacy-.doc converter on this machine")
    f = tmp_path / "looks_legit.docx"
    f.write_bytes(b"\xD0\xCF\x11\xE0" + b"\x00" * 100)

    result = DocxParser().parse(f)

    assert result.sections == []
    assert result.metadata.get("format_hint") == "legacy_doc"
    assert "legacy .doc conversion failed" in result.metadata.get("parse_error", "")


def test_legacy_doc_converter_returning_ole2_does_not_recurse(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A converter that silently hands back the original bytes would,
    without the zip-magic check, drop us into the legacy branch again on
    its own output — one conversion per level, forever."""
    script = _fake_converter(
        tmp_path,
        "printf '\\320\\317\\021\\340junkjunk' > \"$outdir/out.docx\"\n",
    )
    monkeypatch.setattr(
        docx_mod, "find_doc_converter", lambda: ("libreoffice", str(script))
    )
    f = tmp_path / "looks_legit.docx"
    f.write_bytes(b"\xD0\xCF\x11\xE0" + b"\x00" * 100)

    result = DocxParser().parse(f)

    assert result.sections == []
    error = result.metadata.get("parse_error", "")
    assert "not a .docx package" in error
    assert "d0cf11e0" in error


def test_legacy_doc_converter_producing_nothing_is_reported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    script = _fake_converter(
        tmp_path, "echo 'Error: source file could not be loaded' >&2\nexit 1\n"
    )
    monkeypatch.setattr(
        docx_mod, "find_doc_converter", lambda: ("libreoffice", str(script))
    )
    f = tmp_path / "looks_legit.docx"
    f.write_bytes(b"\xD0\xCF\x11\xE0" + b"\x00" * 100)

    result = DocxParser().parse(f)

    assert result.sections == []
    error = result.metadata.get("parse_error", "")
    assert "legacy .doc conversion failed" in error
    assert "could not be loaded" in error


def test_legacy_doc_conversion_keeps_the_decompression_cap(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The converted package is a file we create from untrusted input,
    so the 32 MB `word/document.xml` cap applies to it too. Shrink the
    cap rather than build a 32 MB fixture."""
    f = _make_legacy_doc(tmp_path, "some body text that is longer than the cap\n")
    monkeypatch.setattr(docx_mod, "_MAX_DOCX_XML_BYTES", 16)

    result = DocxParser().parse(f)

    assert result.sections == []
    error = result.metadata.get("parse_error", "")
    assert "over the 16-byte cap" in error
    assert result.metadata.get("format_hint") == "legacy_doc"


def test_converter_env_override_is_honoured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Containers put soffice outside PATH; the override is the
    documented escape hatch, so it has to actually win."""
    monkeypatch.setenv("KB_DOC_CONVERTER", "/opt/libreoffice/program/soffice")
    assert find_doc_converter() == ("libreoffice", "/opt/libreoffice/program/soffice")

    monkeypatch.setenv("KB_DOC_CONVERTER", "/somewhere/textutil")
    assert find_doc_converter() == ("textutil", "/somewhere/textutil")


def test_docx_parser_corrupt_file_returns_parse_error(tmp_path: Path) -> None:
    f = tmp_path / "broken.docx"
    f.write_bytes(b"not actually a zip")
    result = DocxParser().parse(f)
    assert result.sections == []
    assert "parse_error" in result.metadata


def test_docx_parser_attaches_tables_to_the_current_heading(tmp_path: Path) -> None:
    """Regression: tables used to be iterated AFTER all paragraphs,
    so every table in the document ended up attached to whatever
    heading was last seen during the paragraph pass. A table that
    appears between Heading A and Heading B should belong to A."""

    def build(doc):
        doc.add_heading("Heading A", level=1)
        doc.add_paragraph("alpha intro")
        table = doc.add_table(rows=2, cols=2)
        table.cell(0, 0).text = "alpha_h1"
        table.cell(0, 1).text = "alpha_h2"
        table.cell(1, 0).text = "alpha_v1"
        table.cell(1, 1).text = "alpha_v2"
        doc.add_heading("Heading B", level=1)
        doc.add_paragraph("beta paragraph")

    f = _write_docx(tmp_path, build)
    result = DocxParser().parse(f)

    by_label = {s.label: s.text for s in result.sections}
    assert "Heading A" in by_label, f"section for A missing: {list(by_label)}"
    assert "Heading B" in by_label, f"section for B missing: {list(by_label)}"

    # Table content must live under A (where it appeared), not B.
    assert "alpha_h1\talpha_h2" in by_label["Heading A"]
    assert "alpha_v1\talpha_v2" in by_label["Heading A"]
    assert "alpha_h1" not in by_label["Heading B"]
    assert "beta paragraph" in by_label["Heading B"]
    assert "beta paragraph" not in by_label["Heading A"]


def test_docx_parser_handles_interleaved_paragraphs_and_tables(tmp_path: Path) -> None:
    """Multiple tables under different headings should each land in
    their own section. Exercises the document-order traversal end
    to end."""

    def build(doc):
        doc.add_heading("Section 1", level=1)
        doc.add_paragraph("text 1")
        t1 = doc.add_table(rows=1, cols=1)
        t1.cell(0, 0).text = "t1_cell"
        doc.add_heading("Section 2", level=1)
        t2 = doc.add_table(rows=1, cols=1)
        t2.cell(0, 0).text = "t2_cell"
        doc.add_paragraph("text 2")

    f = _write_docx(tmp_path, build)
    result = DocxParser().parse(f)
    by_label = {s.label: s.text for s in result.sections}

    assert "t1_cell" in by_label["Section 1"]
    assert "t2_cell" in by_label["Section 2"]
    assert "t1_cell" not in by_label["Section 2"]
    assert "t2_cell" not in by_label["Section 1"]
    assert "text 1" in by_label["Section 1"]
    assert "text 2" in by_label["Section 2"]
