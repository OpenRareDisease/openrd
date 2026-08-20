# Changelog

All notable release-level changes for FSHD-openrd are tracked here.

## v2.6.0 - 2026-08-20

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
  passport heads a record 基因确诊 or 未经基因确诊 and brackets an administrator's entry
  as 管理员代填, because a neurologist reads those differently. 自述 is not among the
  words it prints: absence of a marker is not a signature, so no page here signs an
  unmarked value with the patient's name.
- **No administrator can type a genetic value into a record.** FSHD 分型, D4Z4 重复数,
  单倍型 and 甲基化 are laboratory results; read out over the phone and typed into a back
  office, what lands is a number that looks like laboratory data and is nobody's
  measurement, and it reads as one everywhere downstream — a clinical recommendation, a
  registry export — with nothing in the value to say otherwise. The back office draws no
  box for them and the server refuses the write with a 400 that names every field at fault
  — clearing one counts as a change and is refused too.
- **What that restricts is who may TYPE a genetic value, not where one comes from.** All
  four are read off an uploaded genetic report; 分型 and D4Z4 重复数 additionally have a
  box on the patient's own 编辑资料 form, and 单倍型 and 甲基化 have one nowhere. The
  passport brackets each printed value with where it CAME FROM: 报告读取 for a value the
  report supplied, 本人填写 for one typed into 编辑资料, 管理员代填 for one our own staff
  wrote, and 来源无法确定 where the value is in the record and we cannot say how it got
  there, rather than crediting the patient with it.
- **A surface says what the value is and where it came from; it no longer says what to do
  about it.** Whether 「open that report and fix the row」 is true depends on the report's
  status — a report still parsing, or one that failed to parse, draws no correction
  control and the server refuses the write. The passport, the share page and the PDF do
  not read a document's status, so an instruction on any of them was true for some
  readers and empty for others. Those pages now stop at the value and its bracket, and the
  correction lives on the report's own detail screen, which is the surface that knows. The
  cost is one more tap for a patient who wants to correct something; the gain is that we
  stop saying things that are false in the reader's situation.
- **The registry exports name a genetic value's origin per field instead of covering two
  with an 「or」.** 甲基化 and 单倍型 were labelled 「基线问卷或基因报告结构化解析」 in the
  TREAT-NMD alignment, and no patient form posts either — the questionnaire named an
  author who cannot exist, while the referral pack and the passport printed 来源无法确定
  over the same value. Each value now carries the sentence its own field can support, and
  none of them credits the patient with a number the report autofill may have supplied.
- **What is genuinely stuck is recorded rather than papered over:** a patient saving
  编辑资料 posts back the 单倍型 and 甲基化 the form had read, the report fills only a
  field left empty, and the exports read the baseline — so that copy keeps the old value
  after the report is corrected. The runbook's §3.4 says what support may and may not
  promise about it.
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

### Clinical safety

Everything below was found by rendering a surface and reading the bytes, or by
running the product and using it as a patient — not by reading code. They are
grouped by what a reader was told, because that is what they have in common.

**The laboratory gate could be satisfied by the document it exists to exclude.**
Whether the assistant may GRADE a genetics cell asked whether the Python
classifier had called the document a genetic report, and that classifier scores a
document on the genetics words it CONTAINS — so a 门诊病历摘要 quoting the patient's
own result scored higher than a summary and outranked the uploader's declared
type. The transcribed count was banded on the FSHD1 boundary and the transcribed
haplotype called permissive, in both modes, with `not_read_off_a_laboratory_report`
appearing nowhere. The more of the result a summary quoted, the more certainly it
flipped. The classifier decides that one label on STRUCTURE now, and because no
code change reclassifies a stored row, the gate stops trusting a single inferred
label: it asks whether the page shows a clinical narrative, whether it shows a
laboratory report, and only then what the uploader declared — read from the cell
every OCR provider stamps before classification exists, not from the column the
parse overwrites.

**A genuine 4qB report was read as 4qA.** The haplotype was whatever token appeared
first on the page, and on a real Southern blot that is the 检测方法 line naming the
standard probe pair — the exact wording this platform's own copy tells patients to
ask for. A report whose RESULT states the non-permissive allele graded
`trial_ready`. The parser flagged the ambiguity and dropped its confidence to
0.60; nothing downstream read either.

**The assistant could tell a patient they were genetically confirmed off boxes they
typed themselves**, on a record where the passport, the share page, the referral
pack, the anaesthesia card and all three registry exports decline to. It could
also attach a severity band to their own repeat count and invent a methylation
mechanism — with the direction backwards, since FSHD is associated with
hypomethylation. Ten rounds of redaction decided what data reaches the model and
nothing decided what it may conclude from it, and a rule written into the system
prompt did not hold: the model broke it on the next run, inside a table whose
column header was 「对你个人的意义」. So there is a guard on the answer now, built the
way the redactor is built — one place, positioned last, failing closed, saying
what it did — and each of its checks is grounded in a fact the turn holds rather
than in a vocabulary.

**Numbers that were not the patient's.** LDH 319 was published as 9, matched off
「乳酸脱氢酶法」 — the assay used to measure AST — and valued with the AST row's index.
A CK of 693 against a printed 50-310 with the laboratory's own ↑ was shown as an
ordinary number, because the flag and the interval sat inside the snippet the
parser had already captured and neither was recorded. On the 项目/参考区间/结果 column
order a reference was published as the result, and on 实测值/预计值/占预计值 the
predicted value as the measurement. A footnote defining a threshold could supply
the patient's molecular diagnosis. Which column holds the reading is determined
once per page now — by the row's own shapes where they differ, by the table's
header where they do not, and by publishing nothing where neither answers.

**Values read backwards.** 「不低于 11 个」 was canonicalised to below-eleven and 「未见
11 个以上」 to above-eleven; 「不排除」, which means the laboratory cannot rule the thing
out, was read as the report denying it; 「不过」, the ordinary connective, parsed as a
negation and flipped the bound after it. Negation and direction are parsed
separately and combined by one rule, and the residual failure reads as the
un-negated bound rather than as its complement.

**No abnormal laboratory value was visibly abnormal anywhere.** Two rounds taught
the parser to capture the flag and the interval, and neither reached a single
screen: the bridge minted the legacy value-only twins the passport happens to
prefer, the mobile metric type had three fields, and FHIR emitted `valueString`
alone. A reading is one type now, with one writer and one reader, so moving a
value without its flag is unwritable rather than merely absent. And a value
outside the interval the report itself printed, on a row the laboratory did not
mark, is now compared out loud — in a clause that is visibly this platform's, only
in the outside direction, and never in the laboratory's register.

**One value, one provenance.** The assistant read a different profile from every
other surface, because its retriever never ran the read-time projection; where a
report and a questionnaire box disagreed it read the box, so a genetically
confirmed patient could be told they were not. Document-first precedence now, the
passport's own ordering — the one `export/` had already adopted for FHIR and the
Phenopacket — and the two superseded tests carry the old reasoning and the record
of what replaced it. TREAT-NMD was the last holdout and 甲基化 turned out to be a
third cell, with the haplotype reaching exactly one reader — the registry — as a
genotype no patient-facing surface could contradict.

**Dates.** A save of the baseline overwrote an exact diagnosis date with a
fabricated 1 January, and it did not need the patient to touch the field. The
assistant told a patient diagnosed in 2023 that it was 2022, from a DATE column
decoded as local midnight and sliced in UTC. The passport printed raw ISO instants
where the referral pack printed calendar days, and the container is UTC while the
patients are UTC+8. Every calendar date now comes from one declared product
timezone on both sides.

**What the exports carry.** The portability export — the one whose docstring calls
it everything the platform stores about the caller — never queried the patient's
falls or their instrument administrations. TREAT-NMD and the Phenopacket carried
none of the readings FHIR carries, undeclared. The facial measurement, the 「facio」
in facioscapulohumeral, rendered as 「custom肌力」. Membership is now walked by a test
rather than by a reviewer; placement, which is prose, is not, and the entry says
where the derivation stops.

**Two things that were not clinical and would have shipped.** `hardDelete` recursed
into objects and not arrays, and `isUntrustworthyValue` returned false for
everything that was not a string — so a `patientName` and an `idCard` inside an
array under a genetics key were published verbatim into the prompt, against layer
1's own stated contract. And the delimiter strips in `context-builder.ts` and
`render.ts` were a single pass joined with the empty string, so a document could
weld a fence marker back together out of the halves and close the fence it was
quoted inside.

**The report impression channel ships off.** The keyword extractor that turned a
report's Chinese 影像/报告印象 into a term list is deleted: six rounds of patches never
stopped it asserting findings the report had RULED OUT, and the redactor drops the
raw impression, so what it emitted was the only version the model ever saw. What
replaces it — the report's own words, behind an eligibility gate, an identifier
scrub and a measurement mask — is built, tested and switched OFF, because two
rounds of red-teaming produced about 145 findings and the residual classes all
publish. `REPORT_IMPRESSION_CHANNEL_ENABLED` is one constant with that history
written above it; with it off the prompt is byte-identical to before the channel
existed.

**And the parser did not import on the interpreter production runs.** A parameter
annotation referenced a class defined 2049 lines later, which on 3.11 is a
NameError raised while the module is still importing — so the report parser loaded
in neither Docker image and the whole Python suite failed during collection. It was
invisible locally because this machine's `python3` is 3.14, where PEP 649 defers
annotation evaluation.

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
