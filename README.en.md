# FSHD-openrd

[中文](./README.md)

FSHD-openrd is a monorepo for an FSHD patient-facing platform. It combines the mobile client, backend API, embedded OCR/report parsing, AI Q&A, and deployment tooling in one repository. The current repo is meant to support a real end-to-end workflow, not just isolated demos.

Current working version: `v2.5.0` (manifests bumped, tag not yet published)
Latest published release: `v2.4.0`
Baseline version: `master` / `v1.0.0`

## What is in the repo

- `apps/mobile`: Expo client for iOS / Android / Web
- `apps/api`: Node.js + Express API for auth, profile, follow-up, reports, and AI flows
- `apps/report-manager`: Python OCR / report parsing logic embedded by the main API
- `db`: database bootstrap and migration-related scripts
- `docs`: runbooks, testing, release notes, design notes, and historical records

## Main flows currently covered

- Auth, patient profile, measurements, symptoms, activities, and medications
- Submission and follow-up event flows, clinical passport, timeline, and aggregate views
- Report upload, embedded OCR, FSHD-specific structured extraction, and report detail views
- AI Q&A, KB retrieval, progress polling, and fallback handling
- Docker startup, DB migration, health checks, and regression scripts

## Tech stack

- Mobile: Expo + React Native + TypeScript
- API: Express + TypeScript + Zod
- Database: PostgreSQL
- Report processing: embedded Python OCR / parser
- Tooling: ESLint + Prettier + Husky + npm workspaces

## Repository layout

```text
openrd/
├── apps/
│   ├── api/
│   ├── mobile/
│   └── report-manager/
├── db/
├── docs/
├── scripts/
├── docker-compose.yml
├── .env.example
└── package.json
```

## How to read the docs

- Start with this file for the project overview, startup paths, and common commands.
- Use [docs/README.md](./docs/README.md) as the structured documentation index.
- Go deeper through module-level docs:
  - [apps/api/README.md](./apps/api/README.md)
  - [apps/mobile/README.md](./apps/mobile/README.md)
  - [apps/report-manager/README.md](./apps/report-manager/README.md)

## Prerequisites

- Node.js >= 20.12 (this is what the root `package.json` `engines.node` already declares; the `db:migrate:down` / `db:backup` / `db:restore` / `kb:prune` scripts all run `node --env-file-if-exists=.env`, a flag that only exists from 20.12. There is no `.npmrc`, so `npm install` on an older Node only warns and then succeeds — the failure surfaces later as `bad option` the first time you run the backup script. Both Dockerfiles and CI pin Node 20.)
- npm >= 10
- Python >= 3.10 for local OCR / KB runs
- PostgreSQL >= 14 for local mode
- Docker + Docker Compose v2 for container mode

## Quick start

### Option A: local development

1. Prepare dependencies and env file

```bash
git clone <repo-url>
cd openrd
cp .env.example .env
npm install
```

2. Start PostgreSQL, or provide your own database

```bash
docker compose up -d postgres
```

If host port `5432` is already occupied:

```bash
POSTGRES_PORT=5433 docker compose up -d postgres
```

3. Run DB bootstrap / migrations

```bash
npm run db:migrate
```

4. Install Python dependencies if you want embedded OCR locally

```bash
pip install -r apps/api/requirements-embedded-report.txt
```

5. Start the API

```bash
npm run dev:api
```

6. Start the KB service if you want to test AI retrieval

```bash
python apps/api/knowledge_service.py
```

7. Start the mobile client

```bash
npm run dev:mobile
```

Common local settings:

- `OTP_PROVIDER=mock`
- `OCR_PROVIDER=embedded`
- `STORAGE_PROVIDER=local` or `STORAGE_PROVIDER=minio`
- `AI_API_BASE_URL`, `AI_API_MODEL`, `AI_API_KEY` / `OPENAI_API_KEY`
- `OCR_PYTHON_BIN=/path/to/python` when running the API locally

> ⚠️ `EXPO_PUBLIC_API_URL` does **not** belong in the repo-root `.env`. Expo resolves dotenv files against the project root (`apps/mobile/`) and never reads the repo-root file, so a value written there is silently dropped and the bundle bakes in `http://localhost:4000/api`. Put it in `apps/mobile/.env` (template: `apps/mobile/.env.example`). The Docker web image takes a different path: a `Dockerfile.web` build ARG supplied by docker-compose's `WEB_EXPO_PUBLIC_API_URL`, default `/api`.

### Option B: Docker end-to-end

```bash
docker compose up -d --build
```

> ⚠️ `.env` must contain `POSTGRES_PASSWORD`; compose declares it as `${POSTGRES_PASSWORD:?…}` and refuses to render without it. `.env.example` **already ships that line** (`POSTGRES_PASSWORD=postgres`) — copy it as is for local development, do not append a second one. Production must change that line's value: `validateProductionEnv` independently rejects any `DATABASE_URL` still carrying the `postgres:postgres` pair.
>
> ⚠️ **Do not uncomment `DATABASE_URL` in `.env`.** The template leaves it commented on purpose: Option A needs `@localhost:5432`, Option B needs compose's internal `@postgres:5432`, and compose now interpolates the api's value so anything in `.env` wins over its default. Left commented, both paths work from an unmodified copy. Set it explicitly only for a database both contexts reach by the same name (a managed instance). If it does end up as loopback, the api exits with a boot error naming `DATABASE_URL` (compose hardcodes `OPENRD_IN_CONTAINER=true` for exactly this) instead of leaving a `migrate.js` ECONNREFUSED crash-loop.

If host port `5432` is already occupied:

```bash
POSTGRES_PORT=5433 docker compose up -d --build
```

Default ports:

- API: `http://localhost:4000`
- KB service: `http://localhost:5010`
- Web (Expo Web + nginx): `http://localhost:8080`

Container mode already provides these overrides:

- API uses `OCR_PYTHON_BIN=python3`
- KB binds to `0.0.0.0:5010`
- API reaches KB via `KB_SERVICE_URL=http://kb-service:5010`

**`DATABASE_URL` is deliberately NOT on that list.** Compose used to hardcode the internal address, which silently discarded an operator's managed-Postgres value; it is now interpolated, so `.env` wins and compose's `@postgres:5432` default applies only when `.env` says nothing — which is why the template's line stays commented out.

If you need MinIO compatibility for historical `v1` report files:

```bash
docker compose --profile minio up -d --build
```

And set in `.env`:

- `STORAGE_PROVIDER=minio`
- `MINIO_ENDPOINT=minio:9000`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET_NAME`

## Common commands

```bash
npm run dev:api
npm run dev:mobile
npm run db:migrate
npm run db:migrate:status
npm run lint
npm run format
npm run format:write
npm run test
npm run test:smoke
npm run test:latest
```

Notes:

- `npm run test` executes the tests defined by each workspace.
- `npm run test:smoke` is the fast API smoke path for day-to-day changes.
- `npm run test:latest` is the broadest end-to-end regression script in the repo.
- `npm run db:migrate` applies DB migrations and bootstrap steps.

## Recommended documentation entry points

### Runbooks and local validation

- [Docs Index](./docs/README.md)
- [Testing Guide](./docs/testing-guide.md)
- [Single-node Cloud Deployment](./docs/cloud-tencent-docker.md)

### Features and architecture

- [AI Q&A](./docs/ai-chat.md)
- [Patient Profile Data Model](./docs/patient-profile.md)
- [Version History / Changelog](./CHANGELOG.md) — includes the `v2.5.0` entry (the pending release).
- [v2.5.0 Deploy Runbook](./docs/runbooks/v2.5.0-deploy.md) — required reading before deploying `v2.5.0`; supersedes the v2.4.0 runbook.
- [v2.4.0 Release Notes](./docs/releases/v2.4.0.md) — latest published release.
- [v1.0.0 Release Notes](./docs/releases/v1.0.0.md)
- [v2.0.0 Release Notes](./docs/releases/v2.0.0.md)

### Collaboration and delivery

- [Workflow](./docs/WORKFLOW.md)
- [Release Checklist](./docs/release-checklist.md)
- [Updates Log](./docs/updates.md)

## License

[MIT](./LICENSE)
