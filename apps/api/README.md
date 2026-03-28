# @openrd/api

TypeScript + Express backend for the openrd platform.

## Scripts

```bash
npm run dev          # watch mode, loads ../../.env
npm run build        # compile to dist/
npm run start        # run compiled build
npm run lint
npm run lint:fix
npm run format
npm run format:write
npm run test
```

## Environment

Copy root `.env.example` to `.env` and configure at least:

- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `AI_API_BASE_URL`
- `AI_API_MODEL`
- `AI_API_KEY` or `OPENAI_API_KEY` (for AI features)
- `OCR_PROVIDER=embedded`
- `OCR_PYTHON_BIN` (default `python3`; in Docker keep it as `python3`)
- `CHROMA_API_KEY`
- `CHROMA_TENANT_ID`

## Key Routes

- `GET /api/healthz`
- `GET /api/healthz/live`
- `GET /api/healthz/ready`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/otp/send`
- `POST /api/auth/otp/verify`
- `POST /api/ai/ask`
- `POST /api/ai/ask/progress/init`
- `GET /api/ai/ask/progress/:progressId`
- `GET /api/profiles/me`
- `POST /api/profiles/me/measurements`
- `POST /api/profiles/me/function-tests`
- `POST /api/profiles/me/activity-logs`
- `POST /api/profiles/me/documents/upload`
- `POST /api/profiles/me/documents/:id/summary`
- `POST /api/profiles/me/medications`
- `GET /api/profiles/me/risk`

## Structure

```text
src/
├── config/
├── db/
├── middleware/
├── modules/
│   ├── auth/
│   └── patient-profile/
├── routes/
└── services/
```
