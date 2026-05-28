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

import warnings
from io import StringIO
from pathlib import Path
from typing import List, Optional, Tuple

from .base import Parser, ParseResult, ParsedSection

# Same Pillow decompression-bomb guard as image_parser. pdf2image
# converts PDF pages into Pillow Image objects; without this a
# corpus-dropped scanned PDF with absurdly large page dimensions
# could OOM the worker.
try:
    from PIL import Image  # type: ignore

    Image.MAX_IMAGE_PIXELS = 50_000_000
    warnings.simplefilter("error", Image.DecompressionBombWarning)
except ImportError:
    pass

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
        ocr_failures = 0
        last_ocr_error: Optional[str] = None

        for section in sections:
            if not _looks_empty(section.text):
                continue
            ocr_text, ocr_err = _ocr_page(
                path, _page_index_from_label(section.label)
            )
            if ocr_err is not None:
                # OCR couldn't even run for this page (missing
                # poppler / tesseract / chi_sim traineddata, or a
                # rasterise crash). Track it separately from
                # "OCR ran but found no text" so a missing dep
                # doesn't get mis-attributed to corpus gaps.
                ocr_failures += 1
                last_ocr_error = ocr_err
                continue
            if ocr_text and not _looks_empty(ocr_text):
                section.text = ocr_text
                section.extra["source_method"] = "ocr"
                ocr_pages += 1

        # Drop pages that are still empty after OCR. Keeps the section
        # list aligned with what actually has content; downstream
        # chunker handles per-page wrap.
        sections = [s for s in sections if s.text.strip()]

        metadata: dict = {
            "parser": self.parser_name,
            "pages_total": _page_count(path),
            "pages_with_text": len(sections),
            "pages_via_ocr": ocr_pages,
            "ocr_failures": ocr_failures,
        }
        if last_ocr_error is not None:
            # Surfaced regardless of whether the file still produced
            # SOME content: a single env error is usually the same
            # error for every scanned page in the corpus, so the
            # operator wants to see it once per file at minimum.
            metadata["ocr_dep_error"] = last_ocr_error

        # Elevate to a hard parse_error when the file was effectively
        # unrecoverable: nothing in the text layer, every OCR attempt
        # failed. The ingester counts this in `files_errored`
        # instead of `files_empty`, which is the difference between
        # "fix your bootstrap" and "this file is genuinely blank".
        if not sections and ocr_failures > 0:
            metadata["parse_error"] = (
                f"all pages empty and OCR unavailable: {last_ocr_error}"
            )

        return ParseResult(sections=sections, metadata=metadata)


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


def _ocr_page(path: Path, page_index: int) -> Tuple[str, Optional[str]]:
    """Rasterise one PDF page and run tesseract on it.

    Returns `(text, error)` where:
      - `text=''` and `error=None`  -> OCR ran, image had no text (a
        legitimately blank scan / cover page).
      - `text != ''` and `error=None` -> OCR succeeded.
      - `error is not None` -> OCR couldn't run at all (missing
        poppler, missing tesseract binary, missing chi_sim
        traineddata, rasterise crash). The caller surfaces this so a
        missing host-side dep doesn't masquerade as a content gap.
    """
    if page_index < 0:
        return "", None

    try:
        from pdf2image import convert_from_path  # type: ignore
    except ImportError as exc:
        return "", f"pdf2image not installed: {exc}"
    try:
        import pytesseract  # type: ignore
    except ImportError as exc:
        return "", f"pytesseract not installed: {exc}"

    try:
        images = convert_from_path(
            str(path),
            dpi=_OCR_DPI,
            first_page=page_index + 1,
            last_page=page_index + 1,
        )
    except Exception as exc:
        # pdf2image surfaces `PDFInfoNotInstalledError` /
        # `FileNotFoundError` when poppler / pdftoppm isn't on PATH;
        # both bubble up here. The bootstrap docs now list poppler
        # alongside tesseract.
        return "", f"PDF rasterise failed (poppler/pdftoppm?): {exc}"

    if not images:
        return "", None

    try:
        text = pytesseract.image_to_string(images[0], lang=_OCR_LANGS)
    except Exception as exc:
        # Common case: tesseract binary missing or chi_sim
        # traineddata not in tessdata. Both want the operator to
        # `brew install tesseract tesseract-lang`.
        return "", f"tesseract OCR failed (binary/chi_sim missing?): {exc}"

    return text.strip(), None


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
