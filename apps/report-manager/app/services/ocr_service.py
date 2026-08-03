import importlib.util
import PyPDF2
from PIL import Image
import pytesseract
import os
import sys
import tempfile
from pdf2image import convert_from_path
import traceback

PaddleOCR = None
np = None
_PADDLE_AVAILABLE = False

# Tesseract 配置：中文单语 + PSM 6。
#
# 生产上是 Tesseract-only（OCR_DISABLE_PADDLE=true），而这条流水线原本
# 是围绕 PaddleOCR 调的。2026-08-03 线上传了一张福建某院的大便常规，
# 项目名读出来了、结果值全成了乱码：阴性(-) 被读成 BAEC) / BARE(-) /
# KARE / BAPE(-)。
#
# 原因是 lang="chi_sim+eng"：两个模型竞争时，eng 会拿拉丁字母去套中文
# 字形。多出来的「拉丁字符」不是识别到了英文，是把中文误读成了英文。
#
# 在两张真实报告上实测（同一张图、同一台机器、只改这两个参数）：
#
#   大便常规 1190x840        「阴性」次数  非空白字符  数字  拉丁
#     chi_sim+eng (原)            8          683       94    35
#     chi_sim --psm 6            12          946       98     7
#
#   生化全套                     医学缩写行  非空白字符  数字  拉丁
#     chi_sim+eng (原)               7         2214     290   376
#     chi_sim --psm 6                7         2698     443   316
#
# 关键的两点：ALT/AST/GGT 这类医学缩写在两种配置下都是 7 行，去掉 eng
# 并没有丢掉英文缩写（chi_sim 的字库本身含 ASCII）；而数字从 290 涨到
# 443，对化验单来说数字就是数据本身。拉丁计数下降是好事——降掉的是
# 上面那些 BAEC/KARE 之类的噪声。
#
# --psm 6（假定整页是一个统一文本块）比默认的全自动分页更适合化验单
# 的表格版式：默认模式会把表格切成互不相关的区域，行内的「项目—结果—
# 参考值」对应关系因此散掉。
#
# 如果哪天 PaddleOCR 装回来了，这些就只影响 fallback 路径。
TESSERACT_LANG = "chi_sim"
TESSERACT_CONFIG = "--psm 6"

def _paddle_disabled() -> bool:
    """
    Allow disabling PaddleOCR on platforms where Paddle may crash (e.g. Apple Silicon via emulation).
    """
    return (
        os.getenv("OCR_DISABLE_PADDLE", "").strip().lower() in {"1", "true", "yes", "y"}
    )

SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/jpg"}

def _env_int(name: str, default: int) -> int:
    """Read an int from the environment, falling back on anything
    unparseable. This module is imported by the parser subprocess the api
    spawns per upload, so a typo'd env value must not turn every single
    upload into an import crash whose only symptom is empty stdout that
    the api reports as 「parser returned no output」."""
    try:
        return max(1, int(os.getenv(name, "").strip()))
    except (TypeError, ValueError):
        return default


#: Maximum number of PDF pages we will rasterise for OCR (override with
#: OCR_MAX_PDF_PAGES).
#:
#: The previous code called `convert_from_path(pdf_path, dpi=300)` with
#: no bound and no `output_folder`, so pdf2image materialised EVERY page
#: as an in-memory PIL image before the OCR loop started — roughly 26 MB
#: per A4 page at 300 dpi. A JPEG-compressed hospital scan of 50+ pages
#: fits comfortably under the 10 MB upload cap, so a routine patient
#: upload could drive the api container (which is where this runs) to
#: multi-gigabyte RSS. With no mem_limit on any compose service, the
#: kernel then picks an OOM victim by score — which can be postgres or
#: kb-service rather than the parse that caused it.
_MAX_PDF_PAGES = _env_int("OCR_MAX_PDF_PAGES", 30)

#: Above this page count we drop to 200 dpi. 300 dpi buys real accuracy
#: on the small print in Chinese lab tables, but the memory/time cost is
#: quadratic in dpi and a long document is far more likely to be a
#: multi-visit record than a single dense genetic report.
_HIGH_DPI_MAX_PAGES = 3
_HIGH_DPI = 300
_LOW_DPI = 200

_paddle_ocr = None
_paddle_logged = False
_tesseract_logged = False

#: Which engines actually produced text during this process. Recorded so
#: the engine in use is visible per document rather than inferred from a
#: Dockerfile ENV — see `ocr_engine_report()`.
_engines_used = set()


class OcrPageLimitExceeded(Exception):
    """Raised when a PDF has more pages than `_MAX_PDF_PAGES`.

    Deliberately an error rather than a silent truncation. Truncating
    would drop the tail of a medical record — a D4Z4 repeat count or an
    FSHD1-POSITIVE conclusion on page 35 would simply vanish, and the
    downstream analysis has no way to tell a document that ended from
    one that was cut off. Failing loudly gives the patient an actionable
    message (split the file / upload the relevant pages) instead of a
    confidently incomplete report.
    """


def _log_ocr_message(message):
    print(message, file=sys.stderr)


def resolve_ocr_engine() -> dict:
    """Report which OCR engine will actually run, and why.

    Determined WITHOUT importing or constructing PaddleOCR: `find_spec`
    only looks the module up on the path, so this stays safe to call at
    startup (importing paddle is heavy and crashes on some platforms,
    which is the whole reason OCR_DISABLE_PADDLE exists).

    Background this function exists to make visible: production runs
    Tesseract-only. `apps/api/Dockerfile` pins OCR_DISABLE_PADDLE=true
    and `apps/api/requirements-embedded-report.txt` — the only pip
    install in the api image — contains no paddleocr, while
    `apps/report-manager/requirements.txt` pins paddleocr==2.8.1 for
    local dev. So the pipeline is written and tuned around PaddleOCR
    (`_paddle_image_to_string`, use_angle_cls for rotated scans) but the
    engine reading D4Z4 counts and MRC scores off real hospital scans in
    production is Tesseract. That split is an accepted trade-off, not an
    oversight — paddleocr peaks around 6.4 GB RSS in a single process,
    which does not fit the deployment this ships on. What was missing was
    any way to tell from a log line, a health payload, or a stored
    document which of the two produced a given result. That is what this
    reports.
    """
    if _paddle_disabled():
        return {
            "engine": "tesseract",
            "reason": "OCR_DISABLE_PADDLE is set",
        }
    missing = [
        name for name in ("paddleocr", "numpy") if importlib.util.find_spec(name) is None
    ]
    if missing:
        return {
            "engine": "tesseract",
            "reason": f"not installed: {', '.join(missing)}",
        }
    return {"engine": "paddleocr", "reason": "paddleocr available and enabled"}


def ocr_engine_report() -> dict:
    """Resolved engine plus the engines that actually produced text.

    `expected` is what `resolve_ocr_engine()` predicted; `used` is what
    really ran. They can differ per document — PaddleOCR returning no
    text for a page falls through to Tesseract — and a run where they
    disagree is exactly the case an operator needs to see.
    """
    resolved = resolve_ocr_engine()
    return {
        "expected": resolved["engine"],
        "reason": resolved["reason"],
        "used": sorted(_engines_used),
        "max_pdf_pages": _MAX_PDF_PAGES,
    }

def _get_paddle_ocr():
    global _paddle_ocr
    if _paddle_ocr is None:
        if _paddle_disabled():
            return None
        # Import lazily: importing Paddle/PaddleOCR can be heavy and may crash on some platforms.
        global PaddleOCR, np, _PADDLE_AVAILABLE
        if not _PADDLE_AVAILABLE:
            try:
                from paddleocr import PaddleOCR as _PaddleOCR  # type: ignore
                import numpy as _np  # type: ignore
                PaddleOCR = _PaddleOCR
                np = _np
                _PADDLE_AVAILABLE = True
            except Exception as e:
                # PaddleOCR is optional; fall back to Tesseract.
                _log_ocr_message(f"PaddleOCR unavailable, falling back to Tesseract: {e}")
                _PADDLE_AVAILABLE = False
                return None
        # use_angle_cls helps with rotated scans
        _paddle_ocr = PaddleOCR(use_angle_cls=True, lang="ch")
    return _paddle_ocr

def _paddle_image_to_string(image):
    """
    OCR an image using PaddleOCR. Returns concatenated text lines.
    """
    if _paddle_disabled():
        return ""
    try:
        global _paddle_logged
        if not _paddle_logged:
            _log_ocr_message("OCR engine: PaddleOCR")
            _paddle_logged = True
        ocr = _get_paddle_ocr()
        if ocr is None:
            return ""
        if np is None:
            return ""
        img = np.array(image)
        try:
            result = ocr.ocr(img, cls=True)
        except TypeError:
            # Some PaddleOCR versions do not accept cls argument.
            result = ocr.ocr(img)
        def _flatten_texts(obj):
            if obj is None:
                return []
            if isinstance(obj, str):
                return [obj] if obj.strip() else []
            if isinstance(obj, (list, tuple)):
                out = []
                for v in obj:
                    out.extend(_flatten_texts(v))
                return out
            return []

        def _unwrap_json(obj):
            if hasattr(obj, "json"):
                try:
                    val = obj.json() if callable(obj.json) else obj.json
                except TypeError:
                    val = obj.json
                if isinstance(val, dict):
                    if isinstance(val.get("res"), dict):
                        return val["res"]
                    return val
            return None

        def _extract_texts(result_obj):
            items = result_obj if isinstance(result_obj, (list, tuple)) else [result_obj]
            texts = []
            for item in items:
                if item is None:
                    continue
                data = _unwrap_json(item)
                if isinstance(data, dict):
                    texts.extend(_flatten_texts(data.get("rec_texts")))
                    texts.extend(_flatten_texts(data.get("rec_text")))
                    texts.extend(_flatten_texts(data.get("text")))
                if isinstance(item, dict):
                    texts.extend(_flatten_texts(item.get("rec_texts")))
                    texts.extend(_flatten_texts(item.get("rec_text")))
                    texts.extend(_flatten_texts(item.get("text")))
                    continue
                if isinstance(item, (list, tuple)):
                    # PaddleOCR classic format: [ [box], (text, score) ]
                    if len(item) >= 2 and isinstance(item[1], (list, tuple)) and item[1]:
                        texts.extend(_flatten_texts(item[1][0]))
                        continue
                    for v in item:
                        texts.extend(_flatten_texts(v))
            return [t for t in texts if isinstance(t, str) and t.strip()]

        if result is None:
            return ""
        texts = _extract_texts(result)
        joined = "\n".join(texts)
        if joined:
            _engines_used.add("paddleocr")
        return joined
    except Exception as e:
        _log_ocr_message(f"PaddleOCR error: {e}")
        _log_ocr_message(traceback.format_exc())
        return ""

def _page_limit_message(page_count) -> str:
    counted = f"{page_count} 页" if page_count is not None else f"超过 {_MAX_PDF_PAGES} 页"
    return (
        f"PDF 页数过多（{counted}），本次最多支持 {_MAX_PDF_PAGES} 页。"
        f"请拆分文件后分次上传，或只上传需要识别的页面。"
    )


def extract_text_from_pdf(pdf_path):
    """
    Extract text from a PDF file using PyPDF2 for text-based PDFs and pytesseract for image-based PDFs

    Raises OcrPageLimitExceeded when the document needs OCR and has more
    than `_MAX_PDF_PAGES` pages. Note the ordering: the PyPDF2 text-layer
    pass runs on documents of any length because it is cheap and streams
    page by page; only the rasterising OCR path is bounded.
    """
    text = ""
    page_count = None

    # 尝试使用PyPDF2提取文本
    try:
        with open(pdf_path, 'rb') as file:
            reader = PyPDF2.PdfReader(file)
            num_pages = len(reader.pages)
            page_count = num_pages

            for page_num in range(num_pages):
                page = reader.pages[page_num]
                text += page.extract_text() or ""
    except Exception as e:
        _log_ocr_message(f"PyPDF2 extraction error: {e}")

    # 如果PyPDF2提取的文本较少，尝试使用OCR
    if len(text.strip()) < 100:
        # Bound the render BEFORE it happens when we know the page count.
        # PyPDF2 already told us for free above; failing here costs no
        # rasterisation at all.
        if page_count is not None and page_count > _MAX_PDF_PAGES:
            raise OcrPageLimitExceeded(_page_limit_message(page_count))

        try:
            # 使用PaddleOCR优先，其次使用Tesseract提取图像中的文本
            # 用 TemporaryDirectory() 把所有页的临时图像放在隔离目录里：
            # 旧的实现固定文件名 (temp_image_{i}.png) 在系统 tmp 根目录下，
            # 两个并发 OCR 请求拿到同一个 i 时会互相覆盖，PIL 句柄也可能
            # 复用错文件。隔离目录 + with 语句让多个 worker 安全并行，并
            # 在异常路径也保证目录被清掉。
            ocr_text = ""
            with tempfile.TemporaryDirectory(prefix="ocr_pdf_") as tmpdir:
                # `output_folder=tmpdir` is what makes this bounded in
                # memory: pdf2image writes each rendered page to disk and
                # hands back PIL images backed by those files, instead of
                # holding every page of the document in RAM at once.
                # `last_page=_MAX_PDF_PAGES + 1` renders one page past the
                # cap on purpose — it is how we detect an over-long
                # document when PyPDF2 could not give us a page count
                # above, without paying for the whole render.
                dpi = (
                    _HIGH_DPI
                    if page_count is not None and page_count <= _HIGH_DPI_MAX_PAGES
                    else _LOW_DPI
                )
                images = convert_from_path(
                    pdf_path,
                    dpi=dpi,
                    output_folder=tmpdir,
                    first_page=1,
                    last_page=_MAX_PDF_PAGES + 1,
                )
                if len(images) > _MAX_PDF_PAGES:
                    raise OcrPageLimitExceeded(_page_limit_message(page_count))

                for i, image in enumerate(images):
                    paddle_text = _paddle_image_to_string(image)
                    if paddle_text:
                        ocr_text += paddle_text + "\n"
                        continue
                    global _tesseract_logged
                    if not _tesseract_logged:
                        _log_ocr_message("OCR engine: Tesseract (fallback)")
                        _tesseract_logged = True
                    temp_image_path = os.path.join(tmpdir, f"page_{i}.png")
                    image.save(temp_image_path, 'PNG')
                    # 旧实现用 Image.open(path) 但没 close —— 在长批
                    # 文档 / 低 ulimit 平台 (Windows / 容器) 上会累积
                    # 文件描述符直到 OS 拒绝新的 open。用 with 让 PIL
                    # 句柄随作用域释放。
                    with Image.open(temp_image_path) as page_image:
                        page_text = pytesseract.image_to_string(
                            page_image,
                            lang=TESSERACT_LANG,
                            config=TESSERACT_CONFIG,
                        )
                    if page_text.strip():
                        _engines_used.add("tesseract")
                    ocr_text += page_text

            text = ocr_text
        except OcrPageLimitExceeded:
            # Must not be swallowed by the generic handler below — a page
            # cap the caller can act on is not an OCR failure to log and
            # continue past with empty text.
            raise
        except Exception as e:
            _log_ocr_message(f"OCR extraction error: {e}")
    elif text.strip():
        # The text layer answered; no OCR engine ran at all. Record that
        # so a document parsed from an embedded text layer is not
        # mistaken for one Tesseract read off a scan.
        _engines_used.add("pypdf2")

    return text

def extract_text_from_file(file_path, content_type):
    """
    Extract text from a PDF or image file.
    """
    if content_type in SUPPORTED_IMAGE_TYPES:
        try:
            # PIL.Image.open lazy-loads but holds the underlying file
            # descriptor open until the Image is garbage-collected. On
            # platforms with a low ulimit (Windows defaults, Docker
            # without explicit limits) a busy OCR worker can leak its
            # way to "too many open files". Use a context manager so the
            # fd is released as soon as we're done.
            with Image.open(file_path) as image:
                paddle_text = _paddle_image_to_string(image)
                if paddle_text:
                    return paddle_text
                global _tesseract_logged
                if not _tesseract_logged:
                    _log_ocr_message("OCR engine: Tesseract (fallback)")
                    _tesseract_logged = True
                image_text = pytesseract.image_to_string(
                    image, lang=TESSERACT_LANG, config=TESSERACT_CONFIG
                )
                if image_text.strip():
                    _engines_used.add("tesseract")
                return image_text
        except Exception as e:
            _log_ocr_message(f"Image OCR error: {e}")
            return ""
    return extract_text_from_pdf(file_path)
