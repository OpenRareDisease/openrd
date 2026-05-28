"""Image parser: OCR raster images with tesseract (chi_sim + eng).

Returns a single `ParsedSection` containing the decoded text. Images
without recognisable text come back with an empty section list so the
ingester can record "empty" and move on instead of polluting the KB
with noise.
"""

from __future__ import annotations

import warnings
from pathlib import Path

from .base import Parser, ParseResult, ParsedSection

_OCR_LANGS = "chi_sim+eng"

#: Pillow's default MAX_IMAGE_PIXELS (~89 megapixels) only emits a
#: warning on overrun, not an exception, so a "decompression bomb"
#: (a 1×1 GB PNG/TIFF expanding into RAM) would wedge the worker
#: without ever raising. Cap to a value generous for medical scans
#: but cheap to allocate, and promote the warning to an error so it
#: surfaces as a clean parse_error rather than OOM.
_MAX_IMAGE_PIXELS = 50_000_000


def _configure_pillow_bomb_guard():
    try:
        from PIL import Image  # type: ignore

        Image.MAX_IMAGE_PIXELS = _MAX_IMAGE_PIXELS
        # Image.DecompressionBombError already raises; the warning
        # variant fires at MAX/2. Promote both to errors so either
        # threshold surfaces as a catchable exception in the parser.
        warnings.simplefilter("error", Image.DecompressionBombWarning)
    except ImportError:
        # Pillow may not be installed; the per-call import below
        # surfaces the missing dep as parse_error.
        pass


_configure_pillow_bomb_guard()


class ImageParser(Parser):
    extensions = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp")
    parser_name = "image"

    def parse(self, path: Path) -> ParseResult:
        try:
            from PIL import Image  # type: ignore
            import pytesseract  # type: ignore
        except ImportError as exc:
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "parse_error": f"OCR libs missing: {exc}",
                },
            )

        try:
            with Image.open(path) as img:
                text = pytesseract.image_to_string(img, lang=_OCR_LANGS).strip()
        except Exception as exc:
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "parse_error": f"OCR failed: {exc}",
                },
            )

        if not text:
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "ocr_empty": True,
                },
            )

        return ParseResult(
            sections=[
                ParsedSection(
                    text=text,
                    label="",
                    extra={"source_method": "ocr"},
                )
            ],
            metadata={
                "parser": self.parser_name,
            },
        )
