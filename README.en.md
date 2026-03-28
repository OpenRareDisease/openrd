# FSHD-openrd

[中文](./README.md)

FSHD-openrd is a monorepo for the FSHD patient platform. It includes the mobile app, backend API, an embedded OCR/report parsing engine, and supporting docs/scripts.

## Modules

- `apps/mobile`: Expo mobile app (iOS/Android/Web)
- `apps/api`: Node.js + Express backend API
- `apps/report-manager`: Python OCR/report parsing engine embedded by the main API
- `db`: database bootstrap scripts
- `docs`: engineering and release documentation

## Tech Stack

- Mobile: Expo + React Native + TypeScript
- API: Express + TypeScript + Zod
- Database: PostgreSQL
- Report/OCR: Python OCR + FSHD structured parsing embedded in the main API
- Quality: ESLint + Prettier + Husky

## Repository Layout

```text
openrd/
├── apps/
│   ├── api/
│   ├── mobile/
│   └── report-manager/
├── db/
├── docs/
├── docker-compose.yml
├── .env.example
└── package.json
```

## Prerequisites

- Node.js >= 18
- npm >= 10
- Python >= 3.10 (for embedded OCR engine / KB service)
- PostgreSQL >= 14 (local mode)
- Docker + Docker Compose v2 (container mode)

## Quick Start (Local)

1. Install dependencies

```bash
git clone <repo-url>
cd openrd
cp .env.example .env
npm install
```

2. Optional: start dependencies with Docker

```bash
docker compose up -d postgres
```

If host port `5432` is already occupied by a local PostgreSQL instance, use:

```bash
POSTGRES_PORT=5433 docker compose up -d postgres
```

3. Start API

```bash
npm run dev:api
```

4. Start mobile app

```bash
npm run dev:mobile
```

5. Optional: install embedded OCR runtime for local API runs

```bash
pip install -r apps/api/requirements-embedded-report.txt
```

6. Optional: start KB service for AI retrieval

```bash
python apps/api/knowledge_service.py
```

Common local runtime settings:

- `AI_API_BASE_URL=https://api.siliconflow.cn/v1`
- `AI_API_MODEL=Qwen/Qwen3-VL-32B-Instruct`
- `OCR_PROVIDER=embedded`
- `OCR_PYTHON_BIN=/opt/anaconda3/envs/openrd-kb/bin/python` for a local conda runtime only

## Docker End-to-End

```bash
docker compose up -d --build
```

Container mode already pins the deployment-safe overrides:

- API container uses `OCR_PYTHON_BIN=python3`
- KB container binds to `0.0.0.0:5010`
- API container talks to `KB_SERVICE_URL=http://kb-service:5010`

If host port `5432` is already in use, override it when starting containers:

```bash
POSTGRES_PORT=5433 docker compose up -d --build
```

Default ports:

- API: `http://localhost:4000`
- KB service: `http://localhost:5010`
- web (Expo web + nginx): `http://localhost:8080`

## Common Commands

```bash
npm run dev:api
npm run dev:mobile
npm run db:migrate
npm run lint
npm run format
npm run test:smoke
npm run test:latest
npm run test
```

Notes:

- `npm run test:smoke` runs the fast API smoke path.
- `npm run test:latest` runs the broadest end-to-end regression script currently in the repo.
- `npm run db:migrate` bootstraps and applies database migrations.
- `npm run test` executes all workspace test scripts.

## API Snapshot

- `GET /api/healthz`
- `GET /api/healthz/live`
- `GET /api/healthz/ready`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/otp/send`
- `POST /api/auth/otp/verify`
- `GET /api/profiles/me`
- `POST /api/profiles/me/measurements`
- `POST /api/profiles/me/activity-logs`
- `POST /api/profiles/me/documents/upload`
- `GET /api/profiles/me/documents/:id/ocr`
- `POST /api/ai/ask`

## Documentation

- [Docs Index](./docs/README.md)
- [Testing Guide](./docs/testing-guide.md)
- [Release Checklist](./docs/release-checklist.md)
- [Single-Node Cloud Deployment](./docs/cloud-tencent-docker.md)
- [Workflow](./docs/WORKFLOW.md)
- [AI Q&A](./docs/ai-chat.md)
- [Patient Profile Model](./docs/patient-profile.md)

## License

[MIT](./LICENSE)
