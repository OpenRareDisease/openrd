"""PDF parser with OCR fallback.

Tries pdfminer.six first for born-digital PDFs. Pages whose extracted
text looks suspiciously empty (likely a scanned image) fall back to
OCR via pdf2image + pytesseract (chi_sim + eng). Each page is emitted
as its own `ParsedSection` so the ingester can label citations with
the page number and the chunker can keep page boundaries.

Why pdfminer over PyPDF2: pdfminer handles CJK + columns / footers
markedly better and is the de-facto choice for academic PDFs in the
FSHD corpus (medical guidelines, journal papers, etc.).
"""

from __future__ import annotations

from io import StringIO
from pathlib import Path
from typing import List

from .base import Parser, ParseResult, ParsedSection

#: Below this many non-whitespace characters per page we assume the
#: page is a scanned image and try OCR. 60 picks up headers/footers
#: while still triggering on otherwise-blank pages.
_OCR_FALLBACK_THRESHOLD = 60

#: Tesseract language pack. chi_sim covers simplified Chinese, eng
#: covers Latin scripts. Install via `brew install tesseract-lang`.
_OCR_LANGS = "chi_sim+eng"

#: Resolution used when rasterising a PDF page for OCR. 300 dpi is
#: tesseract's documented sweet spot — lower hurts accuracy a lot,
#: higher is slow without a real quality bump for printed text.
_OCR_DPI = 300


class PdfParser(Parser):
    extensions = (".pdf",)
    parser_name = "pdf"

    def parse(self, path: Path) -> ParseResult:
        try:
            sections = _parse_text_layer(path)
        except Exception as exc:
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "parse_error": f"pdfminer failed: {exc}",
                },
            )

        ocr_pages = 0
        for section in sections:
            if _looks_empty(section.text):
                ocr_text = _ocr_page(path, _page_index_from_label(section.label))
                if ocr_text and not _looks_empty(ocr_text):
                    section.text = ocr_text
                    section.extra["source_method"] = "ocr"
                    ocr_pages += 1

        # Drop pages that are still empty after OCR. Keeps the section
        # list aligned with what actually has content; downstream
        # chunker handles per-page wrap.
        sections = [s for s in sections if s.text.strip()]

        return ParseResult(
            sections=sections,
            metadata={
                "parser": self.parser_name,
                "pages_total": _page_count(path),
                "pages_with_text": len(sections),
                "pages_via_ocr": ocr_pages,
            },
        )


def _parse_text_layer(path: Path) -> List[ParsedSection]:
    """Return one ParsedSection per PDF page using pdfminer's text
    extraction. Pages with no text layer come back empty; the caller
    decides whether to retry via OCR."""
    from pdfminer.high_level import extract_text_to_fp  # type: ignore
    from pdfminer.layout import LAParams  # type: ignore
    from pdfminer.pdfdocument import PDFDocument  # type: ignore
    from pdfminer.pdfpage import PDFPage  # type: ignore
    from pdfminer.pdfparser import PDFParser  # type: ignore

    laparams = LAParams()
    sections: List[ParsedSection] = []

    with path.open("rb") as fh:
        document = PDFDocument(PDFParser(fh))
        page_count = sum(1 for _ in PDFPage.create_pages(document))

    for index in range(page_count):
        buf = StringIO()
        with path.open("rb") as fh:
            extract_text_to_fp(
                fh,
                buf,
                laparams=laparams,
                page_numbers=[index],
                output_type="text",
            )
        text = buf.getvalue().strip()
        sections.append(
            ParsedSection(
                text=text,
                label=f"page {index + 1}",
                extra={"page_index": index, "source_method": "text_layer"},
            )
        )

    return sections


def _ocr_page(path: Path, page_index: int) -> str:
    """Rasterise one PDF page and run tesseract on it. Returns the
    decoded text or '' on any failure (the section just keeps its
    empty text-layer extract in that case)."""
    if page_index < 0:
        return ""
    try:
        from pdf2image import convert_from_path  # type: ignore
        import pytesseract  # type: ignore

        images = convert_from_path(
            str(path),
            dpi=_OCR_DPI,
            first_page=page_index + 1,
            last_page=page_index + 1,
        )
        if not images:
            return ""
        text = pytesseract.image_to_string(images[0], lang=_OCR_LANGS)
        return text.strip()
    except Exception:
        return ""


def _page_count(path: Path) -> int:
    try:
        from pdfminer.pdfdocument import PDFDocument  # type: ignore
        from pdfminer.pdfpage import PDFPage  # type: ignore
        from pdfminer.pdfparser import PDFParser  # type: ignore

        with path.open("rb") as fh:
            document = PDFDocument(PDFParser(fh))
            return sum(1 for _ in PDFPage.create_pages(document))
    except Exception:
        return 0


def _looks_empty(text: str) -> bool:
    return len("".join(text.split())) < _OCR_FALLBACK_THRESHOLD


def _page_index_from_label(label: str) -> int:
    """`page 7` -> 6 (zero-based). Returns -1 when the label isn't a
    page label so `_ocr_page` can short-circuit."""
    if not label.startswith("page "):
        return -1
    try:
        return int(label[5:]) - 1
    except ValueError:
        return -1
