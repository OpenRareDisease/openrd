"""Regression tests for the OCR layer.

Until now this layer had zero coverage, which is how production ended up
silently running a different engine than the one the code is written
around (`OCR_DISABLE_PADDLE=true` in apps/api/Dockerfile plus no
paddleocr in apps/api/requirements-embedded-report.txt) with nothing
recording it per document.

These tests deliberately do NOT install or exercise PaddleOCR — a single
PaddleOCR process peaks around 6.4 GB RSS, which is why it is not in the
api image in the first place. They pin the Tesseract-only behaviour that
production actually has, plus the page bound that keeps a long scanned
record from rasterising the api container to death.
"""

import importlib
import os
import shutil
import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.services import ocr_service


def _tesseract_available() -> bool:
    return shutil.which("tesseract") is not None


def _poppler_available() -> bool:
    # pdf2image shells out to poppler's pdftoppm / pdfinfo.
    return shutil.which("pdftoppm") is not None


def _text_image(text: str, size=(900, 220)) -> Image.Image:
    """A high-contrast synthetic 'scan'. Black on white at a large point
    size is the easiest possible input for Tesseract — the point is to
    pin that the wiring works, not to benchmark accuracy."""
    image = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.load_default(size=96)
    except TypeError:  # Pillow < 10.1 has no size kwarg on the default font
        font = ImageFont.load_default()
    draw.text((40, 50), text, fill="black", font=font)
    return image


class ResolveOcrEngineTest(unittest.TestCase):
    def setUp(self):
        self._saved = os.environ.get("OCR_DISABLE_PADDLE")

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("OCR_DISABLE_PADDLE", None)
        else:
            os.environ["OCR_DISABLE_PADDLE"] = self._saved

    def test_disable_flag_pins_tesseract(self):
        """The production configuration. apps/api/Dockerfile sets this,
        so this branch is what every uploaded report goes through."""
        os.environ["OCR_DISABLE_PADDLE"] = "true"
        resolved = ocr_service.resolve_ocr_engine()
        self.assertEqual(resolved["engine"], "tesseract")
        self.assertIn("OCR_DISABLE_PADDLE", resolved["reason"])

    def test_missing_paddle_package_falls_back_to_tesseract(self):
        """Even with the flag unset, the api image has no paddleocr
        wheel. Resolution must report tesseract rather than claiming an
        engine that would fail its lazy import at the first page."""
        os.environ["OCR_DISABLE_PADDLE"] = ""
        if importlib.util.find_spec("paddleocr") is not None:
            self.skipTest("paddleocr is installed in this environment")
        resolved = ocr_service.resolve_ocr_engine()
        self.assertEqual(resolved["engine"], "tesseract")
        self.assertIn("not installed", resolved["reason"])

    def test_resolution_does_not_import_paddleocr(self):
        """`resolve_ocr_engine` is called at parser startup, so it must
        stay cheap and crash-free: importing paddle is heavy and is
        known to abort on some platforms (the reason the disable flag
        exists). find_spec must not pull the module in."""
        os.environ["OCR_DISABLE_PADDLE"] = ""
        ocr_service.resolve_ocr_engine()
        self.assertNotIn("paddleocr", sys.modules)

    def test_paddle_image_to_string_is_inert_when_disabled(self):
        os.environ["OCR_DISABLE_PADDLE"] = "1"
        self.assertEqual(ocr_service._paddle_image_to_string(_text_image("FSHD")), "")


class OcrEngineReportTest(unittest.TestCase):
    def test_report_shape(self):
        report = ocr_service.ocr_engine_report()
        self.assertIn("expected", report)
        self.assertIn("used", report)
        self.assertEqual(report["max_pdf_pages"], ocr_service._MAX_PDF_PAGES)
        self.assertIsInstance(report["used"], list)


@unittest.skipUnless(_tesseract_available(), "tesseract binary not installed")
class TesseractImagePathTest(unittest.TestCase):
    """Pins the behaviour of the engine production actually runs."""

    def setUp(self):
        self._saved = os.environ.get("OCR_DISABLE_PADDLE")
        os.environ["OCR_DISABLE_PADDLE"] = "true"
        self._tmp = Path(__file__).resolve().parent / "_ocr_tmp"
        self._tmp.mkdir(exist_ok=True)

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("OCR_DISABLE_PADDLE", None)
        else:
            os.environ["OCR_DISABLE_PADDLE"] = self._saved
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_reads_latin_text_off_a_png(self):
        path = self._tmp / "sample.png"
        _text_image("FSHD 2026").save(path)
        text = ocr_service.extract_text_from_file(str(path), "image/png")
        self.assertIn("FSHD", text.upper())

    def test_records_tesseract_in_the_engine_report(self):
        path = self._tmp / "engine.png"
        _text_image("FSHD 2026").save(path)
        ocr_service.extract_text_from_file(str(path), "image/png")
        self.assertIn("tesseract", ocr_service.ocr_engine_report()["used"])

    def test_unreadable_image_returns_empty_string_not_an_exception(self):
        """The parser treats OCR as best-effort; a corrupt upload must
        yield empty text so the analysis layer reports 'nothing found'
        instead of the whole request 502-ing."""
        path = self._tmp / "corrupt.png"
        path.write_bytes(b"not a png")
        self.assertEqual(ocr_service.extract_text_from_file(str(path), "image/png"), "")


class PdfPageLimitTest(unittest.TestCase):
    def setUp(self):
        self._saved_pages = ocr_service._MAX_PDF_PAGES
        self._saved_flag = os.environ.get("OCR_DISABLE_PADDLE")
        os.environ["OCR_DISABLE_PADDLE"] = "true"
        self._tmp = Path(__file__).resolve().parent / "_ocr_pdf_tmp"
        self._tmp.mkdir(exist_ok=True)

    def tearDown(self):
        ocr_service._MAX_PDF_PAGES = self._saved_pages
        if self._saved_flag is None:
            os.environ.pop("OCR_DISABLE_PADDLE", None)
        else:
            os.environ["OCR_DISABLE_PADDLE"] = self._saved_flag
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _write_pdf(self, pages: int) -> Path:
        # Image-only PDF: no text layer, so it must take the OCR branch.
        images = [_text_image(f"PAGE {i}") for i in range(pages)]
        path = self._tmp / f"scan_{pages}p.pdf"
        images[0].save(path, save_all=True, append_images=images[1:])
        return path

    def test_over_long_pdf_raises_with_an_actionable_message(self):
        ocr_service._MAX_PDF_PAGES = 2
        path = self._write_pdf(4)
        with self.assertRaises(ocr_service.OcrPageLimitExceeded) as ctx:
            ocr_service.extract_text_from_file(str(path), "application/pdf")
        message = str(ctx.exception)
        self.assertIn("4", message)   # the actual page count
        self.assertIn("2", message)   # the cap it exceeded
        self.assertIn("拆分", message)  # tells the patient what to do

    def test_page_limit_is_not_swallowed_by_the_generic_ocr_handler(self):
        """`extract_text_from_pdf` catches broad OCR exceptions and
        returns whatever text it has. The page limit must escape that
        handler — otherwise an over-long record silently comes back as
        empty text and gets analysed as an unreadable report."""
        ocr_service._MAX_PDF_PAGES = 1
        path = self._write_pdf(3)
        with self.assertRaises(ocr_service.OcrPageLimitExceeded):
            ocr_service.extract_text_from_pdf(str(path))

    @unittest.skipUnless(
        _tesseract_available() and _poppler_available(),
        "tesseract and/or poppler (pdftoppm) not installed",
    )
    def test_pdf_at_the_limit_is_processed(self):
        """Boundary: exactly _MAX_PDF_PAGES pages must go through. The
        render asks poppler for cap+1 pages to detect overflow, so an
        off-by-one here would reject every document at the cap."""
        ocr_service._MAX_PDF_PAGES = 2
        path = self._write_pdf(2)
        text = ocr_service.extract_text_from_file(str(path), "application/pdf")
        self.assertIn("PAGE", text.upper())


if __name__ == "__main__":
    unittest.main()
