# FSHD-openrd

[中文](./README.md)

---

FSHD-openrd is a unified monorepo that powers the mobile application and backend services for managing Facioscapulohumeral muscular dystrophy (FSHD). The platform combines intelligent Q&A, dynamic health records, disease management tools, patient communities, and clinical trial matching.

## 🎯 Overview

The project empowers patients and caregivers with data-driven insights, AI-assisted recommendations, and collaboration features that connect medical experts, researchers, and the broader community.

## 🛠 Tech Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Mobile | Expo (React Native + TypeScript) | Shared codebase targeting iOS, Android, and Web |
| Backend API | Express + TypeScript | REST API surface for authentication, archives, Q&A, etc. |
| Database | PostgreSQL | Primary data store for transactional data |
| Code Quality | ESLint + Prettier + Husky | Consistent style enforcement and git hooks |
| Logging | pino + pino-http | Structured logging for observability |

## 📁 Repository Layout

```
openrd/
├── apps/
│   ├── api/                # Express API service (TypeScript)
│   │   ├── src/            # Configuration, modules, middleware
│   │   ├── package.json    # Dependencies and scripts
│   │   └── eslint.config.mjs
│   └── mobile/             # Expo React Native application
│       ├── app/            # Expo Router pages
│       ├── screens/        # High-level UI compositions
│       ├── assets/         # Fonts, icons, media
│       └── package.json
├── db/                     # PostgreSQL bootstrap scripts
├── ui/                     # Static design prototypes
├── .husky/                 # Git hooks (pre-commit runs lint-staged)
├── .env.example            # Environment variable template
├── package.json            # Workspace configuration & shared scripts
└── prettier.config.cjs     # Formatting rules
```

## 🚀 Getting Started

### 1. Requirements

- Node.js ≥ 18
- npm ≥ 10
- PostgreSQL ≥ 14
- Optional: Expo Go for device testing

### 2. Installation

```bash
git clone <repository-url>
cd openrd
cp .env.example .env      # adjust for your environment
npm install               # installs workspace dependencies & sets up Husky
```

To bootstrap the database schema:

```bash
psql -U postgres -f db/init_db.sql
```

### 3. Development commands

| Module | Command | Description |
| --- | --- | --- |
| Backend API | `npm run dev:api` | Starts the API server on `http://localhost:4000` |
| Mobile app | `npm run dev:mobile` | Launches the Expo developer tools |
| Lint | `npm run lint` | Runs ESLint for all workspaces |
| Test | `npm run test` | Executes workspace test suites |

## 🔐 Backend capabilities

The API service (`apps/api`) currently exposes:

- `GET /api/healthz` – health probe with database reachability check
- `POST /api/auth/register` – phone/email registration with bcrypt password hashing
- `POST /api/auth/login` – login via phone or email returning a JWT access token
- Centralized logging and error handling powered by pino
- Reusable PostgreSQL connection pool shared across modules

Environment variables are validated in `apps/api/src/config/env.ts`. Copy `.env.example` to configure local values.

## 🧭 Git workflow

- Branching: keep `main` deployable; create feature branches as `feature/<scope>`
- Pre-commit: Husky runs `lint-staged` to enforce ESLint and Prettier formatting
- Pre-flight checks: run `npm run lint` and `npm run test` before opening a PR
- Database changes: store SQL scripts or migrations inside `db/` and document them in PRs

See [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) for the extended collaboration guide.

## 📄 Additional docs

- [System Architecture](./FSHD-openrd-系统架构设计文档.md)
- [Product Requirements](./prd-v2.md)
- [Database Bootstrap](./db/init_db.sql)

## 💬 Support

- Email: support@fshd-openrd.org
- Community: join our patient forum
- Documentation: more developer guides and API references coming soon

---

We welcome contributions from the FSHD community, healthcare professionals, and developers. Please follow the shared workflow and quality standards to keep the platform reliable.
