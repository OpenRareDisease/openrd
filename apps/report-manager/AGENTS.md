# Repository Guidelines

## Project Structure & Module Organization

- `app/` holds the FastAPI application code, organized by `dependencies/`, `models/`, `routes/`, and `services/`.
- `main.py` is the FastAPI entrypoint; `app.py` and `run.py` provide alternate run hooks.
- `config.py` contains configuration defaults; database/MinIO/AI settings are typically overridden via `.env`.
- `db_init_script.sql` and `minio_init_script.py` initialize PostgreSQL and MinIO.
- `test_upload_and_analyze.py` is a local integration-style test script.

## Build, Test, and Development Commands

- Install dependencies:
  ```bash
  pip install -r requirements.txt
  ```
- Run the API locally:
  ```bash
  python -m uvicorn main:app --reload --port 8000
  ```
- Initialize the database:
  ```bash
  psql -h <db_host> -U <user> -f db_init_script.sql
  # or
  python init_db.py
  ```
- Initialize MinIO:
  ```bash
  python minio_init_script.py
  ```
- Run tests (if pytest is installed):
  ```bash
  pytest
  ```
- Run the example upload script:
  ```bash
  python test_upload_and_analyze.py
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

- `pytest` is the recommended runner; currently, tests are minimal and include an integration-style script.
- Name tests with the `test_*.py` convention and add API tests under a `tests/` folder if you expand coverage.
- Validate both success and failure cases for API endpoints.

## Commit & Pull Request Guidelines

- Commit history suggests short, imperative messages (e.g., “Add …”, “Update …”, “Initial commit”).
- PRs should include: a clear description, steps to test, and any API changes (endpoints, request/response shapes).
- If the change affects UI/docs, add screenshots or example cURL commands.

## Security & Configuration Tips

- Store secrets in `.env`; do not commit API keys or credentials.
- Confirm MinIO and PostgreSQL endpoints match your local environment before running initialization scripts.
