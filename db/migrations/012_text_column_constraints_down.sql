-- 012_text_column_constraints_down.sql
--
-- Reverse migration 012 in a hot rollback. All operations idempotent
-- (IF EXISTS) so this script can re-run safely against a partially-
-- applied or fully-rolled-back state.

BEGIN;

-- ---------------------------------------------------------------- function tests
ALTER TABLE patient_function_tests
  DROP CONSTRAINT IF EXISTS patient_function_tests_type_check;

-- ---------------------------------------------------------------- patient_activity_logs
ALTER TABLE patient_activity_logs
  DROP CONSTRAINT IF EXISTS patient_activity_logs_source_check;

-- ---------------------------------------------------------------- patient_documents
ALTER TABLE patient_documents
  DROP CONSTRAINT IF EXISTS patient_documents_type_check;

-- ---------------------------------------------------------------- ai_consent_events
ALTER TABLE ai_consent_events
  DROP CONSTRAINT IF EXISTS ai_consent_events_note_length_check;

COMMIT;
