-- 012_text_column_constraints.sql
--
-- Tail of constraint hardening: text columns where the schema comment
-- declares an invariant ("never PII", "category short label") but no
-- run-time enforcement existed. A direct SQL UPDATE / a future support
-- tool / a careless migration could violate those invariants and the
-- application would silently swallow the bad value.
--
-- All constraints added NOT VALID so the migration succeeds on legacy
-- rows that may carry historical strings; an operator can run ALTER
-- TABLE ... VALIDATE CONSTRAINT once the back-fill is done.

BEGIN;

-- ---------------------------------------------------------------- ai_consent_events
-- The original 009 migration documented `note` as "Never contains
-- PII; safe to surface in the future audit viewer" but added no
-- length cap. A misuse (a support agent pasting a full chat
-- transcript) would silently insert thousands of characters and
-- drag every consent-history query down. Cap at 2 KiB — generous for
-- a free-text note, well below "this column is being abused for log
-- storage". The CHECK is a defensive guard rail, not a hard wall;
-- legitimate notes will sit comfortably under the limit.
ALTER TABLE ai_consent_events
  ADD CONSTRAINT ai_consent_events_note_length_check
  CHECK (note IS NULL OR length(note) <= 2048)
  NOT VALID;

-- ---------------------------------------------------------------- auth_logs (existing tables, defensive)
-- patient_documents.document_type is an enum-like TEXT column the
-- application validates via Zod, but the DB has no constraint. Added
-- here rather than in 011 because the canonical value set lives in
-- profile.constants.ts and the list was finalised between PR-Sec-3
-- and PR-Sec-4. NOT VALID so historical mri / genetic_report etc.
-- rows that happen to be lowercase-correct keep validating without
-- a manual back-fill.
ALTER TABLE patient_documents
  ADD CONSTRAINT patient_documents_type_check
  CHECK (document_type IN ('mri', 'genetic_report', 'blood_panel', 'other'))
  NOT VALID;

-- The activity log `source` column has a fixed value set in
-- profile.constants.ts (`ACTIVITY_SOURCES`). Pin the same set in SQL
-- so a misbehaving ingest pipeline can't slip in an unrecognised
-- source.
ALTER TABLE patient_activity_logs
  ADD CONSTRAINT patient_activity_logs_source_check
  CHECK (source IN ('manual', 'voice_transcription', 'imported', 'stair_test'))
  NOT VALID;

-- ---------------------------------------------------------------- function tests
ALTER TABLE patient_function_tests
  ADD CONSTRAINT patient_function_tests_type_check
  CHECK (test_type IN (
    'stair_climb',
    'ten_meter_walk',
    'sit_to_stand',
    'six_minute_walk',
    'timed_up_and_go',
    'custom'
  ))
  NOT VALID;

COMMIT;
