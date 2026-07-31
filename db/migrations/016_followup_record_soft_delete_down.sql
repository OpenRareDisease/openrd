-- Rollback for 016_followup_record_soft_delete.sql.
--
-- WARNING: dropping `deleted_at` resurrects every retracted record —
-- the rows are still there, only the tombstone flag goes away. Before
-- running this on data that has been live, decide what should happen
-- to the retracted rows (export them, or DELETE them by hand while
-- the column still exists); the column drop cannot be undone from the
-- remaining data.

DROP INDEX IF EXISTS idx_patient_followup_events_profile_live;
DROP INDEX IF EXISTS idx_patient_symptom_scores_profile_live;
DROP INDEX IF EXISTS idx_patient_function_tests_profile_live;

ALTER TABLE patient_followup_events
  DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE patient_symptom_scores
  DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE patient_function_tests
  DROP COLUMN IF EXISTS deleted_at;
