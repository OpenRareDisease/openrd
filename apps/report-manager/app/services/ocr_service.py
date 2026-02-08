import PyPDF2
from PIL import Image
import pytesseract
import os
import tempfile
from pdf2image import convert_from_path
import traceback

try:
    from paddleocr import PaddleOCR
    import numpy as np
    _PADDLE_AVAILABLE = True
except Exception:
    PaddleOCR = None
    np = None
    _PADDLE_AVAILABLE = False

SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/jpg"}

_paddle_ocr = None
_paddle_logged = False
_tesseract_logged = False

def _get_paddle_ocr():
    global _paddle_ocr
    if _paddle_ocr is None:
        # use_angle_cls helps with rotated scans
        _paddle_ocr = PaddleOCR(use_angle_cls=True, lang="ch")
    return _paddle_ocr

def _paddle_image_to_string(image):
    """
    OCR an image using PaddleOCR. Returns concatenated text lines.
    """
    if not _PADDLE_AVAILABLE:
        return ""
    try:
        global _paddle_logged
        if not _paddle_logged:
            print("OCR engine: PaddleOCR")
            _paddle_logged = True
        ocr = _get_paddle_ocr()
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
        return "\n".join(texts)
    except Exception as e:
        print(f"PaddleOCR error: {e}")
        print(traceback.format_exc())
        return ""

def extract_text_from_pdf(pdf_path):
    """
    Extract text from a PDF file using PyPDF2 for text-based PDFs and pytesseract for image-based PDFs
    """
    text = ""
    
    # 尝试使用PyPDF2提取文本
    try:
        with open(pdf_path, 'rb') as file:
            reader = PyPDF2.PdfReader(file)
            num_pages = len(reader.pages)
            
            for page_num in range(num_pages):
                page = reader.pages[page_num]
                text += page.extract_text() or ""
    except Exception as e:
        print(f"PyPDF2 extraction error: {e}")
    
    # 如果PyPDF2提取的文本较少，尝试使用OCR
    if len(text.strip()) < 100:
        try:
            # 将PDF转换为图像
            images = convert_from_path(pdf_path)
            
            # 使用PaddleOCR优先，其次使用Tesseract提取图像中的文本
            ocr_text = ""
            for i, image in enumerate(images):
                if _PADDLE_AVAILABLE:
                    paddle_text = _paddle_image_to_string(image)
                    if paddle_text:
                        ocr_text += paddle_text + "\n"
                        continue
                if not _PADDLE_AVAILABLE or not ocr_text:
                    global _tesseract_logged
                    if not _tesseract_logged:
                        print("OCR engine: Tesseract (fallback)")
                        _tesseract_logged = True
                    # 保存图像到临时文件
                    temp_image_path = os.path.join(tempfile.gettempdir(), f"temp_image_{i}.png")
                    image.save(temp_image_path, 'PNG')
                    # 使用Tesseract提取文本
                    ocr_text += pytesseract.image_to_string(Image.open(temp_image_path))
                    # 删除临时图像文件
                    os.remove(temp_image_path)
            
            text = ocr_text
        except Exception as e:
            print(f"OCR extraction error: {e}")
    
    return text

def extract_text_from_file(file_path, content_type):
    """
    Extract text from a PDF or image file.
    """
    if content_type in SUPPORTED_IMAGE_TYPES:
        try:
            image = Image.open(file_path)
            if _PADDLE_AVAILABLE:
                paddle_text = _paddle_image_to_string(image)
                if paddle_text:
                    return paddle_text
            global _tesseract_logged
            if not _tesseract_logged:
                print("OCR engine: Tesseract (fallback)")
                _tesseract_logged = True
            return pytesseract.image_to_string(image, lang="chi_sim")
        except Exception as e:
            print(f"Image OCR error: {e}")
            return ""
    return extract_text_from_pdf(file_path)
