-- 017_function_test_not_applicable.sql
--
-- 「今天做不了」needs a column of its own.
--
-- The daily followup form required a positive stair-climb time before
-- it would submit at all, which locked the entire daily-record path
-- for the patients furthest along — the ones whose profile already
-- says `independentlyAmbulatory: false` and lists a wheelchair. The
-- form's own helper text offered them a way out ("如果今天中途停顿、
-- 扶栏或无法完成…"); the validation did not.
--
-- Lifting the validation is only half of it. A test that cannot be
-- performed and a test that was never attempted are opposite facts
-- about a disease course, and with `measured_value` NULL for both, a
-- trend cannot tell them apart:
--
--   NULL, no row       →「这段时间没记录」
--   NULL, row present  →「这段时间做不到」
--
-- The second is the more clinically significant reading of the two,
-- and it is the one that was unrepresentable. An interim version
-- carried the meaning in `notes` — which is precisely the free-text
-- column the AI retriever refuses to read, so the signal was invisible
-- to the one consumer that most needed it.
--
-- BOOLEAN NOT NULL DEFAULT FALSE: every historical row is a test that
-- was performed, so the default is correct for the back-fill and no
-- data migration is needed.
--
-- Invariant, enforced below: a row cannot both be marked unable and
-- carry a measurement. Recording「做不到」and「15 秒」on the same
-- attempt is a contradiction, and this is exactly the shape of bad
-- data the AI would otherwise narrate with confidence.

BEGIN;

ALTER TABLE patient_function_tests
  ADD COLUMN IF NOT EXISTS not_applicable BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE patient_function_tests
  ADD CONSTRAINT patient_function_tests_not_applicable_check
  CHECK (NOT not_applicable OR measured_value IS NULL);

-- Counting「做不到」days over a window is the query this column exists
-- to make possible, so it gets the same shape as the other followup
-- lookups: profile + time, filtered to live rows.
CREATE INDEX IF NOT EXISTS idx_patient_function_tests_not_applicable
  ON patient_function_tests (profile_id, test_type, performed_at DESC)
  WHERE not_applicable AND deleted_at IS NULL;

COMMIT;
