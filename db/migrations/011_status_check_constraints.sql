-- 011_status_check_constraints.sql
--
-- Add CHECK constraints for status / enum-like TEXT columns that
-- previously relied on application-layer validation only. A future
-- pipeline (or a manual SQL fix-up) inserting an out-of-range value
-- would otherwise leave the DB in a state the application doesn't know
-- how to read, surfacing as a confusing 500 rather than a clean
-- write-time rejection.
--
-- All constraints are added NOT VALID so the migration succeeds on
-- legacy rows that may carry historical values; an operator can run
-- ALTER TABLE … VALIDATE CONSTRAINT once those rows are cleaned up.
--
-- The trigger on `patient_followup_events` enforces that
-- `linked_document_id`, when set, references a document belonging to
-- the same profile_id. Postgres CHECK constraints can't run a subquery
-- so a trigger is the only correctness-preserving option.

BEGIN;

-- ---------------------------------------------------------------- auth
ALTER TABLE app_users
  ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('patient', 'caregiver', 'clinician', 'admin'))
  NOT VALID;

ALTER TABLE auth_otps
  ADD CONSTRAINT auth_otps_status_check
  CHECK (status IN ('sent', 'verified', 'expired'))
  NOT VALID;

ALTER TABLE auth_otps
  ADD CONSTRAINT auth_otps_purpose_check
  CHECK (purpose IN ('register', 'login', 'reset'))
  NOT VALID;

-- ---------------------------------------------------------------- patient_submissions
ALTER TABLE patient_submissions
  ADD CONSTRAINT patient_submissions_kind_check
  CHECK (submission_kind IN ('baseline', 'followup', 'event'))
  NOT VALID;

-- ---------------------------------------------------------------- patient_documents
ALTER TABLE patient_documents
  ADD CONSTRAINT patient_documents_status_check
  CHECK (status IN ('uploaded', 'processing', 'processed', 'failed'))
  NOT VALID;

-- ---------------------------------------------------------------- patient_measurements
ALTER TABLE patient_measurements
  ADD CONSTRAINT patient_measurements_side_check
  CHECK (side IN ('none', 'left', 'right', 'bilateral'))
  NOT VALID;

ALTER TABLE patient_measurements
  ADD CONSTRAINT patient_measurements_entry_mode_check
  CHECK (entry_mode IN ('self_report', 'guided_assessment', 'ocr_import', 'clinician_entered'))
  NOT VALID;

-- ---------------------------------------------------------------- patient_medications
ALTER TABLE patient_medications
  ADD CONSTRAINT patient_medications_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'stopped'))
  NOT VALID;

-- ---------------------------------------------------------------- patient_followup_events
ALTER TABLE patient_followup_events
  ADD CONSTRAINT patient_followup_events_severity_check
  CHECK (severity IS NULL OR severity IN ('mild', 'moderate', 'severe'))
  NOT VALID;

-- Cross-row check: linked_document_id must belong to the same profile
-- as the followup event. Without this, a misuse of the API (or a
-- direct SQL UPDATE) could attach another patient's document to a
-- followup row. The application enforces this in
-- profile.service.ts#assertDocumentOwnedByProfile, but a DB-level
-- guard catches drift.
CREATE OR REPLACE FUNCTION patient_followup_events_same_profile_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.linked_document_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM patient_documents pd
       WHERE pd.id = NEW.linked_document_id
         AND pd.profile_id = NEW.profile_id
    ) THEN
      RAISE EXCEPTION
        'linked_document_id % does not belong to profile %',
        NEW.linked_document_id, NEW.profile_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS patient_followup_events_same_profile
  ON patient_followup_events;

CREATE TRIGGER patient_followup_events_same_profile
  BEFORE INSERT OR UPDATE OF linked_document_id, profile_id
  ON patient_followup_events
  FOR EACH ROW
  EXECUTE FUNCTION patient_followup_events_same_profile_guard();

-- ---------------------------------------------------------------- ai_prompt_audit
ALTER TABLE ai_prompt_audit
  ADD CONSTRAINT ai_prompt_audit_consent_level_check
  CHECK (consent_level IN ('none', 'basic', 'precise'))
  NOT VALID;

ALTER TABLE ai_prompt_audit
  ADD CONSTRAINT ai_prompt_audit_redaction_mode_check
  CHECK (redaction_mode IN ('strict', 'precise'))
  NOT VALID;

ALTER TABLE ai_prompt_audit
  ADD CONSTRAINT ai_prompt_audit_status_check
  CHECK (status IN ('success', 'error', 'consent_denied'))
  NOT VALID;

COMMIT;
