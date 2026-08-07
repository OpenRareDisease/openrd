-- Puts idx_patient_measurements_cohort back to 018's definition.
--
-- Rolling back the index alone does not roll back the query, so the
-- cohort distribution keeps working and keeps being correct — it just
-- loses the index-only plan and goes back to a heap scan plus a sort.
-- Recreating 018's shape rather than leaving the index dropped is the
-- safer end state: muscle_group still has a leading-column index, which
-- is the sequential scan 018 existed to prevent.

DROP INDEX IF EXISTS idx_patient_measurements_cohort;

CREATE INDEX IF NOT EXISTS idx_patient_measurements_cohort
  ON patient_measurements (muscle_group, strength_score);
