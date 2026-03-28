FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-chi-sim \
      tesseract-ocr-eng \
      libglib2.0-0 \
      libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/requirements-embedded-report.txt ./apps/api/requirements-embedded-report.txt

RUN npm ci
RUN pip3 install --break-system-packages --no-cache-dir -r ./apps/api/requirements-embedded-report.txt

COPY apps/api ./apps/api
COPY apps/report-manager ./apps/report-manager
COPY db ./db

RUN npm run build --workspace @openrd/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
ENV OCR_PYTHON_BIN=python3
ENV OCR_DISABLE_PADDLE=true
ENV REPORT_MANAGER_DISABLE_PADDLE=true

EXPOSE 4000

CMD ["sh", "-c", "node --enable-source-maps dist/db/migrate.js && node --enable-source-maps dist/index.js"]
