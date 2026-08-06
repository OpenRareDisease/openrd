"""Microsoft Word (.docx) parser via python-docx, with a zip+XML
fallback for files that confuse python-docx (broken bookmarks etc.).

Strategy: walk the document body once, group paragraphs by the most
recent `Heading 1` / `Heading 2` they sit under, and emit one
`ParsedSection` per heading group (labelled with the heading text).
Documents with no headings degenerate to a single section that holds
the whole body — the chunker handles further splitting.

Tables are flattened to tab-separated text and appended to the
section they belong to. Inline images are ignored on purpose; the
image parser handles standalone images and a follow-up could extract
embedded images if a clinical use case appears.

Two failure modes we handle explicitly:
  - Legacy .doc files saved with a .docx extension: detected by the
    Composite Document File magic (`D0 CF 11 E0`). We convert them to
    real .docx with an external converter and then run the normal path
    over the conversion. See `_convert_legacy_doc` for why this is not
    just an error message any more.
  - .docx whose bookmark XML refs python-docx can't resolve: we fall
    back to opening the file as a zip and stripping XML tags from
    `word/document.xml`. Loses heading structure but recovers text,
    which is what the embedder cares about.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import List, Tuple

from .base import Parser, ParseResult, ParsedSection

#: Magic bytes for a legacy .doc (OLE2 compound file). Files with this
#: header are not valid .docx and python-docx will raise PackageNotFound.
_OLE2_MAGIC = b"\xD0\xCF\x11\xE0"

#: Magic bytes of any zip archive, which every real .docx is. Used to
#: sanity-check what a converter handed back before we trust it.
_ZIP_MAGIC = b"PK\x03\x04"

#: Lazy strip of XML tags. Good enough for fallback text recovery —
#: we lose paragraph/run boundaries but keep the words.
_XML_TAG_RE = re.compile(r"<[^>]+>")


# ------------------------------------------------------ legacy .doc bridge

#: Environment override for installations where the converter is not on
#: PATH (containers that ship LibreOffice under /opt, mostly). Points at
#: the executable itself, e.g.
#: KB_DOC_CONVERTER=/opt/libreoffice/program/soffice
_CONVERTER_ENV_VAR = "KB_DOC_CONVERTER"

#: Wall-clock cap on one conversion. LibreOffice's first headless run
#: builds a user profile and can take ~20s; a 2 MB catalogue then
#: converts in a few more. 180s is generous enough not to fire on a
#: slow CI box and short enough that a wedged soffice cannot hang a
#: corpus-wide ingest indefinitely.
_CONVERT_TIMEOUT_SECONDS = 180

#: Printed verbatim in the parse_error when no converter exists. The
#: whole point of this module's legacy branch is that a silent skip is
#: how 《中国康复辅助器具目录（2023年版）》 — 110 pages of the national
#: assistive-device catalogue, the document that answers「踝足矫形器在
#: 国家目录里是哪一类」— sat outside the knowledge base unnoticed. If we
#: cannot convert, say so loudly and say what to install.
_CONVERTER_INSTALL_HINT = (
    "no legacy-.doc converter available. Install LibreOffice so "
    "`soffice --headless --convert-to docx` is on PATH "
    "(macOS: `brew install --cask libreoffice`; "
    "Debian/Ubuntu: `apt-get install -y libreoffice-writer`). "
    "macOS also ships `textutil`, which is used first when present. "
    f"For a non-PATH install set {_CONVERTER_ENV_VAR}=/path/to/soffice."
)


def find_doc_converter() -> Tuple[str, str] | None:
    """Locate a tool that can turn a legacy .doc into a .docx.

    Returns `(kind, executable)` where kind is "textutil" or
    "libreoffice", or None when neither is available. Split out as a
    module-level function so tests can monkeypatch the "nothing
    installed" case without touching PATH.

    Preference order is deliberate: `textutil` ships with macOS, needs
    no user profile and converts the 2.3 MB catalogue in ~0.4s, while
    LibreOffice needs ~20s on its first headless run. CI and production
    are Linux and land on LibreOffice.
    """
    override = os.getenv(_CONVERTER_ENV_VAR, "").strip()
    if override:
        # Trust the operator's path but still classify it, because the
        # two tools take completely different argv shapes.
        kind = "textutil" if Path(override).name == "textutil" else "libreoffice"
        return (kind, override)

    exe = shutil.which("textutil")
    if exe:
        return ("textutil", exe)
    for name in ("libreoffice", "soffice"):
        exe = shutil.which(name)
        if exe:
            return ("libreoffice", exe)
    return None


def _convert_legacy_doc(
    path: Path, converter: Tuple[str, str], workdir: Path
) -> Tuple[Path | None, str | None]:
    """Convert `path` (a legacy .doc) into a .docx inside `workdir`.

    Returns `(converted_path, None)` on success or `(None, reason)` on
    failure. Never raises: the ingester treats a returned parse_error as
    a per-file problem and keeps going, and a raised exception here
    would abort the whole batch.

    The conversion always writes into `workdir`, never next to the
    source: the corpus under content/medical-kb/source/ is input, and an
    ingest run that mutates its own input is a debugging nightmare the
    first time two runs overlap.
    """
    kind, exe = converter
    if kind == "textutil":
        out = workdir / "converted.docx"
        cmd = [exe, "-convert", "docx", str(path), "-output", str(out)]
    else:
        # `-env:UserInstallation` gives this run its own throwaway
        # LibreOffice profile. Without it, a soffice already running on
        # the machine (or two ingest workers started together) makes the
        # second invocation exit immediately with "another instance is
        # accessing the user profile" and no output file.
        profile = workdir / "lo-profile"
        cmd = [
            exe,
            "--headless",
            "--norestore",
            f"-env:UserInstallation=file://{profile}",
            "--convert-to",
            "docx",
            "--outdir",
            str(workdir),
            str(path),
        ]
        out = None  # LibreOffice names the output after the input stem.

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=_CONVERT_TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError:
        return None, f"converter not executable: {exe}"
    except subprocess.TimeoutExpired:
        return None, (
            f"{kind} conversion timed out after {_CONVERT_TIMEOUT_SECONDS}s"
        )
    except Exception as exc:  # pragma: no cover - defensive
        return None, f"{kind} conversion failed to start: {exc}"

    if out is None:
        # Pick the .docx LibreOffice produced. workdir is freshly
        # created and holds nothing else, so a single top-level match is
        # unambiguous; anything other than exactly one match means the
        # conversion did not do what we asked.
        produced = sorted(p for p in workdir.glob("*.docx") if p.is_file())
        if len(produced) != 1:
            stderr = (proc.stderr or b"").decode("utf-8", "replace").strip()
            return None, (
                f"{kind} produced {len(produced)} .docx files "
                f"(exit {proc.returncode}): {stderr[:300]}"
            )
        out = produced[0]

    if not out.exists() or out.stat().st_size == 0:
        stderr = (proc.stderr or b"").decode("utf-8", "replace").strip()
        return None, (
            f"{kind} produced no output (exit {proc.returncode}): "
            f"{stderr[:300]}"
        )

    # Verify we got a zip container back and not, say, the original
    # bytes copied through. Without this a converter that silently
    # no-ops would send us straight back into the OLE2 branch on the
    # converted file — the recursion this check exists to prevent.
    with out.open("rb") as fh:
        head = fh.read(4)
    if head != _ZIP_MAGIC:
        return None, (
            f"{kind} output is not a .docx package "
            f"(leading bytes {head.hex() or 'empty'})"
        )

    return out, None


class DocxParser(Parser):
    extensions = (".docx",)
    parser_name = "docx"

    def parse(self, path: Path) -> ParseResult:
        try:
            from docx import Document  # type: ignore
        except ImportError:
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "parse_error": "python-docx not installed",
                },
            )

        # Detect legacy .doc files masquerading as .docx before
        # python-docx prints a less actionable error.
        try:
            # `with` so the file descriptor is closed when the read
            # finishes — the previous `path.open("rb").read(4)` left
            # the fd open until CPython's GC happened to collect it.
            # Harmless on CPython under normal load, but on PyPy or
            # with low fd ulimits a corpus-wide ingest could exhaust
            # the limit and start raising OSError partway through.
            with path.open("rb") as fh:
                head = fh.read(4)
        except Exception as exc:
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "parse_error": f"cannot read file: {exc}",
                },
            )
        if head == _OLE2_MAGIC:
            return self._parse_legacy_doc(path)

        return self._parse_package(path)

    # ------------------------------------------------------------------

    def _parse_legacy_doc(self, path: Path) -> ParseResult:
        """Convert a legacy .doc to .docx, then run the normal path.

        This branch used to stop at a parse_error telling the operator
        to re-save the file by hand. Nobody did, and nothing showed the
        gap: 《中国康复辅助器具目录（2023年版）》 (2,303,041 bytes, 110
        pages, ~68k words of the national assistive-device catalogue)
        was rejected at every ingest for months, so the KB could not
        answer「踝足矫形器在国家目录里是哪一类」for a patient assembling a
        subsidy claim. Converting is cheap; the manual step never
        happened.

        When no converter exists we still fail — loudly, with the
        install command in the message. A silent skip is precisely how
        the catalogue went missing, so the one thing this must never do
        is degrade quietly.
        """
        converter = find_doc_converter()
        if converter is None:
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "parse_error": (
                        "legacy .doc format with .docx extension; "
                        + _CONVERTER_INSTALL_HINT
                    ),
                    "format_hint": "legacy_doc",
                    "converter_available": False,
                },
            )

        kind, _exe = converter
        workdir = Path(tempfile.mkdtemp(prefix="kb-doc-convert-"))
        try:
            converted, reason = _convert_legacy_doc(path, converter, workdir)
            if converted is None:
                return ParseResult(
                    sections=[],
                    metadata={
                        "parser": self.parser_name,
                        "parse_error": (
                            f"legacy .doc conversion failed: {reason}"
                        ),
                        "format_hint": "legacy_doc",
                        "converter_available": True,
                        "converted_via": kind,
                    },
                )

            # Same 32 MB cap the zip fallback applies, enforced here too.
            # The converted package is a file WE just created from
            # attacker-controlled input, so the decompression-bomb
            # question is live even though python-docx (not our zip
            # fallback) is what opens it next.
            oversize = _document_xml_over_cap(converted)
            if oversize is not None:
                return ParseResult(
                    sections=[],
                    metadata={
                        "parser": self.parser_name,
                        "parse_error": (
                            f"legacy .doc conversion produced a document.xml "
                            f"of {oversize} bytes, over the "
                            f"{_MAX_DOCX_XML_BYTES}-byte cap; refusing to "
                            f"expand it"
                        ),
                        "format_hint": "legacy_doc",
                        "converter_available": True,
                        "converted_via": kind,
                    },
                )

            result = self._parse_package(converted)
            # The ingester merges file-level metadata onto every chunk,
            # so this ends up queryable per row. It matters because the
            # text came out of a conversion, not out of the file on
            # disk: heading styles do not reliably survive a .doc round
            # trip, so a section-boundary oddity in one of these files
            # has an explanation the row itself can now tell you.
            # kb-doctor prints it when it re-parses such a file.
            result.metadata["format_hint"] = "legacy_doc"
            result.metadata["converted_via"] = kind
            return result
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def _parse_package(self, path: Path) -> ParseResult:
        """Parse a real .docx package (zip + OOXML).

        Split out of `parse` so the legacy-.doc branch can feed its
        conversion through exactly the same code rather than a parallel
        implementation that would drift.
        """
        from docx import Document  # type: ignore

        try:
            doc = Document(str(path))
        except Exception as exc:
            # Try the zip+XML fallback. Catches broken bookmark refs,
            # missing item-name entries etc. — anything where the file
            # is still a valid zip but python-docx's relationship
            # graph can't be reconstructed.
            fallback = _parse_via_xml(path)
            if fallback is not None:
                fallback.metadata["fallback_reason"] = str(exc)
                return fallback
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "parse_error": f"python-docx failed to open: {exc}",
                },
            )

        sections: List[ParsedSection] = []
        current_heading = ""
        current_lines: List[str] = []

        def flush() -> None:
            text = "\n".join(line for line in current_lines if line.strip()).strip()
            if text:
                sections.append(
                    ParsedSection(
                        text=text,
                        label=current_heading,
                        extra={"section_index": len(sections)},
                    )
                )

        # Walk the document body in document order so a table that
        # appears between Heading A and Heading B is attached to A,
        # not to whatever heading is current after every paragraph
        # has been processed. python-docx's `doc.paragraphs` /
        # `doc.tables` collections each preserve internal order but
        # lose ordering between the two types; `iter_inner_content`
        # is the documented escape hatch (>= 1.0).
        from docx.table import Table  # type: ignore
        from docx.text.paragraph import Paragraph  # type: ignore

        for block in doc.iter_inner_content():
            if isinstance(block, Paragraph):
                style_name = (block.style.name if block.style else "") or ""
                text = (block.text or "").strip()
                if not text:
                    continue
                if style_name.startswith("Heading"):
                    flush()
                    current_heading = text
                    current_lines = []
                    continue
                current_lines.append(text)
            elif isinstance(block, Table):
                rows: List[str] = []
                for row in block.rows:
                    cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if cells:
                        rows.append("\t".join(cells))
                if rows:
                    current_lines.append("[表格]")
                    current_lines.extend(rows)
            # Other inner-content types (sdt, etc.) are ignored.

        flush()

        return ParseResult(
            sections=sections,
            metadata={
                "parser": self.parser_name,
                "sections_total": len(sections),
            },
        )


#: Cap on the decompressed size of `word/document.xml` we'll read
#: from a .docx in the fallback path. Python's stdlib zipfile does
#: NOT protect against decompression bombs by default — a 1 KB
#: compressed entry can expand to gigabytes. Real Word documents
#: rarely exceed a few MB; capping at 32 MB keeps the legit corpus
#: working while refusing a zip bomb.
_MAX_DOCX_XML_BYTES = 32 * 1024 * 1024


def _document_xml_over_cap(path: Path) -> int | None:
    """Return the declared uncompressed size of `word/document.xml` when
    it exceeds `_MAX_DOCX_XML_BYTES`, else None.

    Reads the zip central directory only — nothing is decompressed, so
    a bomb is refused before any allocation. Returns None for anything
    it cannot inspect (not a zip, no document.xml): the callers treat
    None as "no objection from this check", and the checks that follow
    them will reject a package that is broken for other reasons.
    """
    try:
        with zipfile.ZipFile(path) as zf:
            try:
                info = zf.getinfo("word/document.xml")
            except KeyError:
                return None
    except Exception:
        return None
    return info.file_size if info.file_size > _MAX_DOCX_XML_BYTES else None


def _parse_via_xml(path: Path) -> ParseResult | None:
    """Last-resort text extraction: open the .docx as a zip, read
    `word/document.xml`, strip XML tags. Returns None when even the
    zip can't be opened (so the caller surfaces the original
    python-docx error instead of a misleading fallback message).
    Section boundaries are lost — everything becomes a single
    ParsedSection that the chunker will paragraph-split.
    """
    try:
        with zipfile.ZipFile(path) as zf:
            try:
                # Inspect the uncompressed size BEFORE reading. A
                # zip bomb declares a small compressed size but
                # expands to gigabytes on read; the size cap kills
                # that path before any allocation happens.
                info = zf.getinfo("word/document.xml")
            except KeyError:
                return None
            if info.file_size > _MAX_DOCX_XML_BYTES:
                return None
            raw = zf.read("word/document.xml")
    except Exception:
        return None

    # Decode + drop tags. The XML uses unicode space tokens we want to
    # preserve, but tag attributes leak garbage if we just strip
    # angle brackets — handle the common case of paragraph close.
    text = raw.decode("utf-8", errors="ignore")
    # Insert newline at paragraph and table boundaries so we keep at
    # least some structure for the chunker.
    text = re.sub(r"</w:p>", "\n", text)
    text = re.sub(r"</w:tr>", "\n", text)
    text = _XML_TAG_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    if not text:
        return None

    return ParseResult(
        sections=[
            ParsedSection(
                text=text,
                label="",
                extra={"source_method": "xml_fallback"},
            )
        ],
        metadata={
            "parser": "docx",
            "fallback": "xml",
        },
    )
