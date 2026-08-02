# Repository Guidelines

## Project Structure & Module Organization

- `embedded_parser.py` is the only supported entrypoint and is invoked by `apps/api`.
- `app/services/fshd_report_service.py` holds FSHD-specific classification, extraction, and normalization logic.
- `app/services/ocr_service.py` handles PDF/image OCR extraction.
- `tests/test_fshd_report_service.py` is the committed regression suite for the parser layer.
- `tests/test_ocr_service.py` covers the OCR layer: engine resolution and the PDF page bound.

## Build, Test, and Development Commands

- Install dependencies:
  ```bash
  pip install -r requirements.txt
  ```
- Install test-only dependencies (no paddleocr — see the file header):
  ```bash
  pip install -r requirements-dev.txt
  ```
- Run the embedded parser locally:
  ```bash
  python embedded_parser.py --file-path /absolute/path/to/report.pdf --mime-type application/pdf
  ```
- Run the checked-in regression tests:
  ```bash
  python -m pytest tests
  ```
  `conftest.py` puts this directory on `sys.path`, so the whole Python suite
  also runs from the repository root — which is what CI should use:
  ```bash
  python -m pytest apps/report-manager/tests scripts/kb_parsers
  ```

## Coding Style & Naming Conventions

- Use 4-space indentation and standard Python style (PEP 8).
- Format and lint with:
  ```bash
  black .
  flake8
  ```
- Prefer clear, descriptive names (e.g., `report_name`, `user_id`, `upload_and_analyze`).

## Testing Guidelines

- `python -m pytest tests` is the current committed regression path.
- OCR tests that need the `tesseract` binary or poppler skip cleanly when those
  are missing, so the suite stays runnable on a bare machine.
- Name tests with the `test_*.py` convention and add API tests under a `tests/` folder if you expand coverage.
- Validate both success and failure cases for API endpoints.

## Commit & Pull Request Guidelines

- Commit history suggests short, imperative messages (e.g., “Add …”, “Update …”, “Initial commit”).
- PRs should include: a clear description, steps to test, and any API changes (endpoints, request/response shapes).
- If the change affects UI/docs, add screenshots or example cURL commands.

## Security & Configuration Tips

- Store secrets in the repository root `.env`; do not commit API keys or credentials.
- The local `apps/report-manager/.env` file is not part of the active repository configuration path.
- Prefer updating `apps/api/requirements-embedded-report.txt` together with this package when parser dependencies change.
