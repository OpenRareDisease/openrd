FROM ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddle:2.6.2

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# pdf2image needs poppler (pdftoppm). Some OCR flows also call tesseract.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-chi-sim \
      tesseract-ocr-eng \
      # Some PaddleOCR deps (opencv) may require these runtime libs on Debian.
      libglib2.0-0 \
      libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY apps/report-manager/requirements.txt ./apps/report-manager/requirements.txt
RUN pip install --no-cache-dir -r ./apps/report-manager/requirements.txt

COPY apps/report-manager ./apps/report-manager

WORKDIR /app/apps/report-manager

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
