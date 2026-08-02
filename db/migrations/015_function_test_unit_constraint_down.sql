-- 015_function_test_unit_constraint_down.sql
--
-- Reverse migration 015 in a hot rollback. Idempotent (IF EXISTS) so
-- it can re-run against a partially-applied or already-rolled-back
-- state.
ALTER TABLE patient_function_tests
  DROP CONSTRAINT IF EXISTS patient_function_tests_unit_check;
