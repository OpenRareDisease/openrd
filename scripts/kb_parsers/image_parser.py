"""Image parser: OCR raster images with tesseract (chi_sim + eng).

Returns a single `ParsedSection` containing the decoded text. Images
without recognisable text come back with an empty section list so the
ingester can record "empty" and move on instead of polluting the KB
with noise.
"""

from __future__ import annotations

from pathlib import Path

from .base import Parser, ParseResult, ParsedSection

_OCR_LANGS = "chi_sim+eng"


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
