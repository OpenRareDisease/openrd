-- Reverse of 017.
DROP INDEX IF EXISTS idx_patient_function_tests_not_applicable;

ALTER TABLE patient_function_tests
  DROP CONSTRAINT IF EXISTS patient_function_tests_not_applicable_check;

ALTER TABLE patient_function_tests
  DROP COLUMN IF EXISTS not_applicable;
