-- Rollback for 018_measurement_cohort_index.sql.
--
-- Safe to run: dropping it costs nothing but the cohort distribution
-- query going back to a sequential scan of patient_measurements.

DROP INDEX IF EXISTS idx_patient_measurements_cohort;
