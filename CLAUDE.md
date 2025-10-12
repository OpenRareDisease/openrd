# CLAUDE.md

Guidance for AI coding assistants working in this repository.

## Repository Overview

FSHD-openrd is a monorepo that houses both the Expo-based mobile application and the TypeScript Express backend API. The goal is to build a comprehensive management platform for FSHD (Facioscapulohumeral muscular dystrophy) patients.

## High-Level Architecture

- **Mobile App (`apps/mobile`)**
  - Expo Router with file-based navigation under `app/`
  - Screen implementations in `screens/`
  - Shared assets in `assets/`
  - TypeScript-first codebase with existing ESLint configuration
- **Backend API (`apps/api`)**
  - Express server with modular folders (`config`, `modules`, `middleware`)
  - PostgreSQL connection pool (`db/pool.ts`)
  - Authentication module offering register/login endpoints and JWT issuance
  - Centralized logging with `pino`
- **Shared Tooling**
  - Root `package.json` defines npm workspaces and scripts (`dev:api`, `dev:mobile`, `lint`, `test`)
  - Husky pre-commit hook runs `lint-staged` for ESLint/Prettier
  - Formatting rules live in `prettier.config.cjs`

## Development Commands

Run the following from the repository root unless noted otherwise:

```bash
npm run dev:mobile   # Launch Expo dev tools
npm run dev:api      # Start the API service (http://localhost:4000)
npm run lint         # Run lint scripts across workspaces
npm run test         # Execute available tests
```

Inside `apps/api` you can also run:

```bash
npm run lint:fix
npm run format:write
```

## Backend Notes

- Environment variables are defined in `.env` (see `.env.example` for defaults).
- Database schema bootstrap lives in `db/init_db.sql`.
- Authentication relies on the `app_users` table—ensure migrations stay in sync.
- Logging is structured (JSON by default) and routed through `pino`/`pino-http`.
- Error handling flows through `middleware/error-handler.ts` with `AppError` for operational issues.

## Contribution Tips

- Keep changes scoped to a single feature per PR.
- Update `TODO.md` when tasks are completed.
- Document API changes in README or dedicated docs.
- For UI work, follow existing naming conventions (`p-<page>.tsx`, screen components, etc.).
- Sensitive health data handling must remain privacy-first—never log secrets or raw PHI.

Stay consistent with TypeScript usage and the established folder structure to ensure smooth collaboration.
