-- Soft delete for the three patient-authored follow-up record types
-- (function tests, symptom scores, follow-up events).
--
-- Why the app needs this at all: until now these tables were
-- append-only. A patient who fat-fingers「18.5 秒」into「185 秒」
-- leaves a permanent spike on their own trend line, which the home
-- screen then narrates back to them as deterioration and the AI
-- retriever feeds to the model as fact. They could see the mistake
-- and had no way to take it back.
--
-- Why soft delete and not DELETE:
--
--  1. These rows are longitudinal clinical evidence. A patient may
--     retract a record and later need to show a clinician (or a
--     trial coordinator) that the retraction happened and when —
--     a vanished row cannot answer that, an audited tombstone can.
--  2. `submission_id` groups a record with everything entered in the
--     same sitting. Hard-deleting one member silently rewrites the
--     history of a submission that other rows still point at.
--  3. Deletion here is a one-tap action for a population with
--     impaired fine motor control — mis-taps are expected, not
--     exceptional. A tombstone is recoverable by an operator;
--     a DELETE is not.
--
-- Account deletion (migration 014) is unaffected: its purge drops
-- app_users, and every patient_* table cascades — tombstones included.
-- Soft delete is retraction of one record, not erasure of a person.

ALTER TABLE patient_function_tests
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE patient_symptom_scores
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE patient_followup_events
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Every read path now carries `deleted_at IS NULL`, which makes the
-- pre-existing (profile_id, <time> DESC) indexes only partially
-- usable. These partial twins keep the live-row scans index-only and
-- stay small — tombstones never enter them.
CREATE INDEX IF NOT EXISTS idx_patient_function_tests_profile_live
  ON patient_function_tests (profile_id, performed_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_patient_symptom_scores_profile_live
  ON patient_symptom_scores (profile_id, symptom_key, recorded_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_patient_followup_events_profile_live
  ON patient_followup_events (profile_id, occurred_at DESC)
  WHERE deleted_at IS NULL;
