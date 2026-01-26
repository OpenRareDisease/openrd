# @openrd/api

TypeScript Express service that powers the FSHD-openrd backend.

## Features

- Structured configuration with Zod-validated environment variables (`src/config/env.ts`)
- PostgreSQL connection pool and health checks
- Authentication module with register/login endpoints and JWT token issuance
- Centralized logging via `pino` and unified error handling middleware
- ESLint + Prettier + Husky enforced code style

## Scripts

```bash
npm run dev          # start the API in watch mode (loads ../../.env)
npm run build        # compile TypeScript to dist/
npm run start        # run the compiled JavaScript
npm run lint         # static analysis
npm run lint:fix     # fixable lint issues
npm run format       # prettier check
npm run format:write # prettier write
npm run test         # placeholder for Vitest suites
```

## Environment variables

Copy the repository `.env.example` to `.env` and adjust as needed. Key variables include database connection, JWT secret, and log level.
For OCR integration, you can either:

- Use Report Manager 002 by setting `REPORT_MANAGER_OCR_URL` (and optional `REPORT_MANAGER_OCR_API_KEY`).
- Or use Baidu OCR by setting `BAIDU_OCR_API_KEY` / `BAIDU_OCR_SECRET_KEY` (and optional endpoint overrides).

## Folder layout

```
src/
├── config/       # env + logger factories
├── db/           # PostgreSQL pool
├── middleware/   # common Express middlewares
├── modules/
│   └── auth/     # registration & login flows
├── routes/       # API routing entrypoint
└── utils/        # helpers (AppError, async wrapper)
```

## API summary

- `GET /api/healthz`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/profiles/me/documents/upload`
- `GET /api/profiles/me/documents/:id`
- `GET /api/profiles/me/documents/:id/ocr`

Extend modules under `src/modules/<domain>` to grow the service in a modular fashion.
