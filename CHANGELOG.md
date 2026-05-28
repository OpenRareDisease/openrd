# Changelog

All notable release-level changes for FSHD-openrd are tracked here.

## v2.4.0 - 2026-05-28

Current release line on `release/v2.4.0`.

### Highlights

- Landed the AI patient QnA platform end-to-end: local pgvector knowledge base, orchestrator with consent gating and PII redaction, mobile SSE streaming with clickable citations, and user-facing AI call + consent history.
- Rewrote the patient profile service and canonicalised OCR `document_type` at the controller layer, backed by migrations 011/012 (NOT VALID CHECKs + cross-profile reference trigger).
- Closed 90+ security audit findings across PR-Sec-1 through PR-Sec-9 (path traversal, cross-user FK, PII scrub, LLM abort, KB service bearer auth, parser DoS, production env fail-fast, dependency CVEs).
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
