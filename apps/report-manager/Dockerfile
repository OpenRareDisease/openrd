FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# pdf2image needs poppler (pdftoppm). Some OCR flows also call tesseract.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-chi-sim \
      tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

COPY apps/report-manager/requirements.txt ./apps/report-manager/requirements.txt
RUN pip install --no-cache-dir -r ./apps/report-manager/requirements.txt

COPY apps/report-manager ./apps/report-manager

WORKDIR /app/apps/report-manager

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
