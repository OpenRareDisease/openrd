-- 011_status_check_constraints_down.sql
--
-- Reverse migration 011 in a hot rollback. Use this only when prod
-- is actively misbehaving because of one of the CHECK constraints or
-- the linked_document trigger — not for "we changed our mind about
-- the design".
--
-- All operations are idempotent (IF EXISTS) so this script can run
-- against a partially-applied 011 without erroring out.

BEGIN;

-- ---------------------------------------------------------------- ai_prompt_audit
ALTER TABLE ai_prompt_audit
  DROP CONSTRAINT IF EXISTS ai_prompt_audit_status_check;
ALTER TABLE ai_prompt_audit
  DROP CONSTRAINT IF EXISTS ai_prompt_audit_redaction_mode_check;
ALTER TABLE ai_prompt_audit
  DROP CONSTRAINT IF EXISTS ai_prompt_audit_consent_level_check;

-- ---------------------------------------------------------------- patient_followup_events
DROP TRIGGER IF EXISTS patient_followup_events_same_profile
  ON patient_followup_events;
DROP FUNCTION IF EXISTS patient_followup_events_same_profile_guard();

ALTER TABLE patient_followup_events
  DROP CONSTRAINT IF EXISTS patient_followup_events_severity_check;

-- ---------------------------------------------------------------- patient_medications
ALTER TABLE patient_medications
  DROP CONSTRAINT IF EXISTS patient_medications_status_check;

-- ---------------------------------------------------------------- patient_measurements
ALTER TABLE patient_measurements
  DROP CONSTRAINT IF EXISTS patient_measurements_entry_mode_check;
ALTER TABLE patient_measurements
  DROP CONSTRAINT IF EXISTS patient_measurements_side_check;

-- ---------------------------------------------------------------- patient_documents
ALTER TABLE patient_documents
  DROP CONSTRAINT IF EXISTS patient_documents_status_check;

-- ---------------------------------------------------------------- patient_submissions
ALTER TABLE patient_submissions
  DROP CONSTRAINT IF EXISTS patient_submissions_kind_check;

-- ---------------------------------------------------------------- otp_verification_codes
ALTER TABLE otp_verification_codes
  DROP CONSTRAINT IF EXISTS otp_verification_codes_scene_check;

-- ---------------------------------------------------------------- auth_otps
ALTER TABLE auth_otps
  DROP CONSTRAINT IF EXISTS auth_otps_purpose_check;
ALTER TABLE auth_otps
  DROP CONSTRAINT IF EXISTS auth_otps_status_check;

-- ---------------------------------------------------------------- app_users
ALTER TABLE app_users
  DROP CONSTRAINT IF EXISTS app_users_role_check;

COMMIT;
