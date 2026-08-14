# Changelog

All notable release-level changes for FSHD-openrd are tracked here.

## v2.6.0 - 2026-08-13

Release line: the `v2.6.0` annotated tag on `master`.

Two feature areas and the consent the second one obliges us to ask for.

### Highlights

- **The assistant can see a trial that opened this year.** It used to answer 「有没有在
  招的试验」 out of the corpus — documents ingested at build time, right about mechanism
  and wrong about recruitment. `trial_records` now holds 92 real FSHD studies from
  ClinicalTrials.gov v2, refreshed by a host cron job that never touches the request
  path, so an upstream slowdown cannot become a slow answer. A record carries the
  registry's own id, title, status and last-changed date, plus the sponsor, phase and
  sites the registry filled in — present when it gave them, absent when it did not,
  never supplied by us. It carries **no eligibility criteria and
  no results**: `CTGOV_FIELDS` never requests them, so they are not in
  `trial_records.raw` either, and the page states above the list that it judges neither.
  Nothing of the registry's own text is translated except its fixed enum vocabularies,
  through hand-written maps — the study's title, sponsor and sites are carried verbatim,
  and a value no map covers renders as the registry wrote it. `fetched_at` is displayed
  rather than a snapshot being quietly served as current.
- **The domestic registry's zero is recorded as a zero.** chinadrugtrials.org.cn is wired
  and genuinely lists no FSHD trials (202 anti-bot, then 200 with 共 0 条记录). 「我们没
  找到」 and 「我们没能查」 are distinguishable in the data, because to a patient they are
  not the same sentence.
- **A back office over patient records, whose whole design is that it cannot lie about
  who typed what.** Provenance is stored per field, and only a write by our own staff
  records one — so an unmarked field means nobody here wrote it, which is not the same
  as the patient having typed it. Nothing is backfilled, so no
  existing record is retroactively relabelled. What an administrator may write is
  identity and history — 姓名, 称呼, 所在地区, 出生年份, 确诊年份, 家族史, 起病部位,
  备注 — deny-by-default, and every export format carries the origin through. The clinical
  passport prints 基因确诊 / 自述 / 管理员代填 as different things because a neurologist
  reads them differently.
- **No administrator can type a genetic value into a record.** FSHD 分型, D4Z4 重复数,
  单倍型 and 甲基化 are laboratory results; read out over the phone and typed into a back
  office, what lands is a number that looks like laboratory data and is nobody's
  measurement, and it reads as one everywhere downstream — a clinical recommendation, a
  registry export — with nothing in the value to say otherwise. They reach a baseline
  from an uploaded report or from the patient's own registration form, and an
  administrator sees them without being able to type them. The passport, the share page,
  the PDF and the referral pack print a patient-entered one with 本人填写 beside it.
- **Reads are audited, not just writes.** In a back office, 「谁看了谁的档案」 is the
  event that matters. The audit row is written _before_ the handler and a failed audit
  write is a 503 — an un-loggable read does not happen. The role cannot be self-granted
  and is read from the database per request, so a revoke takes effect on the next call
  rather than the next token.
- **The re-consent §9 promised.** Adding administrator access to medical records is a
  material change of recipients, so the policy version moved and every account is asked
  again — a screen, not a modal, leading with what changed rather than with a version
  number. It does not claim that refusing stops administrator access, because it does
  not; that question is recorded for counsel rather than papered over.

### Fixes

- 转诊资料 printed 「本平台尚无任何诊断依据记录 —— 以下内容仅为患者自述与自测」 over an
  administrator-entered 确诊年份, four lines above that diagnosis's own date. The
  four-state enum is now a `switch` with an exhaustiveness guard, so a fifth state fails
  typecheck instead of silently landing in the 「no record」 wording.
- A patient clearing a baseline field that is also mirrored into a column of its own could
  not erase the old value: `upsertBaseline` COALESCEd, so present-and-null read as absent.
  Now gated on presence.
- The Art. 29 单独同意 was being bundled into the app-entry re-consent gate for accounts
  that had never given it — which is precisely what 单独 forbids. It stays in its own
  flow at first upload.
- 我的's footer showed the repository's name, a version a year and a half stale, and a year
  two calendar years wrong. All three are now derived rather than typed into the screen.
- `scripts/admin-role.mjs` ships in the runtime image. Granting the first administrator
  happens on a running stack, and the alternative was a runbook telling the operator to
  UPDATE `app_users` in psql — skipping the `audit_logs` row the script writes in the
  same transaction. The one unaudited action would have been the one that creates the
  reader.

### Ops

- **Migrations 021 through 027**, each with a `_down`. 026 and 027 are the two this
  release adds, but the batch also includes the tables patients type into —
  `passport_share_links` (021), the instrument tables (022), `patient_falls` (023),
  `passport_pickup_codes` (024) — whose `_down` scripts are `DROP TABLE`, plus 022's
  rewrite of `independentlyAmbulatory` back to a boolean, which cannot be undone from the
  database. 025 rebuilds `idx_patient_measurements_cohort` and holds ACCESS EXCLUSIVE on
  `patient_measurements` for the whole build — reads blocked, not just writes. Read
  [`docs/runbooks/v2.6.0-deploy.md`](docs/runbooks/v2.6.0-deploy.md) §1.1 before
  deploying, and run the migration pre-flight before the stack comes up: the api image's
  CMD applies migrations on container start. The runbook is a delta on the v2.5.0 one,
  not a replacement.
- **New host cron job** for the trial refresh. Without it the data ages in place (the
  page says so; it does not pretend otherwise).
- **The reverse proxy must pass `/s/*`.** The passport share page is mounted outside
  `/api`, so a config with only `handle /api/*` hands the link to the static app, which
  answers 200 with the front-end router's 「页面未找到」 screen — the clinician sees a
  consumer app's not-found page and `opened_count` never moves. (「这个链接打不开了」 is
  the API's own expired-link page, served 404: that one means the proxy is right.)
  Updating the file is not enough — `up -d` leaves the existing caddy container in place,
  so recreate it.
- **Every active account sees a consent screen on next open.** Expected, not a fault.
  Ship the web export and the API together: the loop where the server calls a version
  current that the shipped bundle cannot display is guarded, but the guard is not a
  reason to stagger the deploy.

## v2.5.0 - 2026-08-03

Release line: the `v2.5.0` tag (there is no `release/v2.5.0` branch; since v2.4.0 the
annotated tag on `master` is the release line — the v2.4.0 entry below named a branch
that was never created, and anyone sent to check it out found nothing).

A deploy-readiness release. No new patient-facing feature area: the work is an 88-finding
audit of everything between a green test suite and a running production stack — env
validation, container topology, migration rollback, backups, health endpoints, retention,
and the documentation an operator actually deploys from.

### Highlights

- **Production fail-fast now covers what it claimed to.** `validateProductionEnv` gained
  gates for a missing AI key, `postgres:postgres` credentials at any hostname (the old
  check keyed on `localhost` and was a permanent no-op on the compose path), secret
  strength (≥32 chars, ≥10 distinct — deliberately not a character-class rule, which
  would reject `openssl rand -hex 32`), Baidu OCR credentials, a non-`.cn`
  `AI_API_BASE_URL` (PIPL Art. 38 cross-border transfer), production on local-disk
  storage, and plaintext MinIO. Three new acknowledgement flags:
  `AI_CROSS_BORDER_ACKNOWLEDGED`, `STORAGE_ALLOW_LOCAL`, `MINIO_ALLOW_INSECURE`.
- **Compose is now the deployment it documented.** `DATABASE_URL` is interpolated instead
  of hardcoded (an operator's managed-Postgres value was being silently discarded),
  `POSTGRES_PASSWORD` is mandatory with no default, `minio` joined the `prod` profile so
  the documented one-line prod command actually starts the object store, every service
  has a `mem_limit` and bounded logging, the api got `stop_grace_period: 25s` to match
  its 20s shutdown budget, and kb-service no longer receives the whole `.env` (it was
  holding `JWT_SECRET`, the OTP secret and the SMS/AI credentials).
- **Readiness stopped conflating "the KB is warm" with "the API can serve."** `isReady`
  is now database + embedded-OCR only; KB, object storage and an unconfigured AI key
  report `degraded`. Compose dependencies relaxed to `service_started`, so a slow bge-m3
  warm-up degrades AI chat instead of preventing the public site from starting at all.
- **`/api/healthz` stopped leaking.** In production-like envs a non-loopback caller gets
  status only; raw Postgres error text, the internal kb-service URL, the parser's
  absolute container path and the Python version are logged against a `requestId` that is
  echoed back, not served to the internet.
- **Migrations can be rolled back for real.** `migrate --down <id>` runs the `_down.sql`
  and deletes its ledger row in one transaction — running the down script by hand left
  the row behind and made the subsequent roll-forward a silent no-op. Migration 015 now
  preserves patient-entered `unit` text in `unit_legacy` before the canonicalising sweep,
  so its `_down` restores instead of merely claiming to. Migrations run under an advisory
  lock and record a SHA-256 so `--status` can report `drifted`.
- **Backups exist as code.** `scripts/db-backup.sh` / `scripts/db-restore.sh` (npm
  `db:backup` / `db:restore`) with an empty-corpus guard, archive verification before
  retention prunes anything, and a restore that refuses a non-empty target without
  `--force`.
- **Retention and erasure.** A periodic sweep bounds `otp_verification_codes`,
  `auth_otps`, `audit_logs` and `ai_prompt_audit`; account purge now tombstones the audit
  rows that used to keep a deleted patient's raw phone, email and IP forever.
- **Client-side failures are visible.** A root error boundary with a Chinese fallback
  replaces the white screen, upload timeouts scale with payload size instead of a flat
  60s that a near-cap file could never meet, and the web export no longer broadcasts the
  current route (including `documentId`) to any parent frame with `targetOrigin: '*'` —
  with `frame-ancestors 'none'` now set in both nginx and Caddy.
- **Python layer.** kb-service is threaded with a bounded search semaphore, fails
  readiness on an empty corpus, handles SIGTERM, clamps `/multi` parameters, and defaults
  to the HF mirror. PDF OCR is page-capped and streams pages to disk; the OCR engine
  actually in use (Tesseract) is now reported rather than assumed.
- **The legal layer stopped being placeholder text.** Four drafted documents in
  `apps/mobile/lib/legal-content.ts` (用户协议, 隐私政策, 敏感个人信息处理单独同意,
  儿童个人信息处理规则与监护人同意) naming the LLM vendor, the information inventory, the
  purposes, the retention periods and every recipient. Migration 019 adds
  `legal_document_acceptances`, so `(user_id, document, version, accepted_at)` is now a
  record rather than an assumption, and `GET`/`POST /api/legal/acceptances` read and write
  it. Enforcement is server-side, not just in the bundle: `requireSensitiveDataConsent`
  sits in front of report upload and every health-data write, and
  `requireGuardianConsentForMinor` recomputes the age from the _server_ clock before a
  profile for an under-14 patient can exist. Migration 020 adds `withdrawn_at` and
  `POST /api/legal/acceptances/withdraw`, so the 「随时撤回」 the documents promise is a
  capability rather than a sentence — a tombstone rather than a delete, because
  「撤回不影响撤回前已进行的处理」 has to stay provable. Two `【待补】` placeholders remain
  — the operator's registered name and the vendor's contracting entity — and they are why
  the release checklist's privacy-policy gate stays unticked.
- **CI exists.** `.github/workflows/ci.yml` runs three jobs — API (lint, format,
  typecheck, test), Mobile (lint, typecheck, test, web export), Report manager (pytest) —
  on Node 20 and Python 3.11, matching what the two images actually run. The mobile job
  runs the same `expo export` the web Dockerfile does, so Metro resolution and the
  static-render pass are gated. `docker compose build` still is not: the images are first
  built on the deploy host.
- **Docs rewritten against the tree, not the intent.** New `docs/runbooks/v2.5.0-deploy.md`
  (migrations 013–020, the corrected rollback procedure, the real mobile channel), a
  release checklist with version-bump / `NODE_ENV` / backup / corpus / privacy-policy
  gates, and `docs/cloud-tencent-docker.md` marked superseded for production use.

### Detailed Notes

- [v2.5.0 Deploy Runbook](./docs/runbooks/v2.5.0-deploy.md)
- [Release Checklist](./docs/release-checklist.md)

## v2.4.0 - 2026-05-28

Released 2026-06-20 as tag `v2.4.0`. (Earlier text here named a `release/v2.4.0` branch;
it was never created — the tag is the release line.)

### Highlights

- Landed the AI patient QnA platform end-to-end: local pgvector knowledge base, orchestrator with consent gating and PII redaction, mobile SSE streaming with clickable citations, and user-facing AI call + consent history.
- Rewrote the patient profile service and canonicalised OCR `document_type` at the controller layer, backed by migrations 011/012 (NOT VALID CHECKs + cross-profile reference trigger).
- Closed a multi-round security audit across 12 PRs (PR-Sec-1 through PR-Sec-10 + 2 follow-ups) covering path traversal, cross-user FK, PII scrub, LLM abort, KB service bearer auth, parser DoS, production env fail-fast, dependency CVEs, and the migration runner `_down.sql` filter that PR #58 caught silently rolling back v2.4.0 schema work.
- Hardened the mobile client: logout cache clear, 401 auto-logout, AppState stream cancel, data-sharing toggles wired to backend, inline citation cap, newly-registered onboarding redirect.
- Added the v2.4.0 deploy runbook and smoke-test coverage for the new feature surfaces.

### Detailed Notes

- [v2.4.0 Release Notes](./docs/releases/v2.4.0.md)

## v2.3.1 - 2026-03-31

Current release line on `release/v2.3.1`.

### Highlights

- Removed the legacy standalone `report-manager` HTTP service mode and kept only the embedded OCR/parser pipeline.
- Pruned obsolete environment variables, dead service files, and assistant-only residue that no longer matches the release path.
- Reorganized active docs, proposals, and archive materials so the current release path is easier to follow.

### Detailed Notes

- [v2.3.1 Release Notes](./docs/releases/v2.3.1.md)

## v2.3.0 - 2026-03-31

Current release line on `release/v2`.

### Highlights

- Expanded FSHD report parsing coverage across lab, cardio-respiratory, MRI, and ultrasound report types.
- Refreshed the patient archive, clinical passport, home, intake, Q&A, report detail, and progression management surfaces.
- Added structured monitoring panels, report management, and timeline detail views on the mobile client.
- Consolidated release notes and documentation navigation for onboarding and delivery.

### Detailed Notes

- [v2.3.0 Release Notes](./docs/releases/v2.3.0.md)

## v2.2.0 - 2026-03-29

Previous released state on `release/v2`.

### Highlights

- Improved passport report aggregation and report title alignment.

## v1.0.0 - 2026-03-31

Retrospective baseline tag for `master`.

### Highlights

- Established the monorepo structure for mobile, API, database bootstrap, and project tooling.
- Delivered the first auth/profile backend foundation and initial AI chat integration.
- Added the first workflow, architecture, and bootstrap documentation set.

### Detailed Notes

- [v1.0.0 Release Notes](./docs/releases/v1.0.0.md)
