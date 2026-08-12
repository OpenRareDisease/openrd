-- 015_function_test_unit_constraint_down.sql
--
-- Reverse migration 015 in a hot rollback. Idempotent (IF EXISTS /
-- IF NOT EXISTS) so it can re-run against a partially-applied or
-- already-rolled-back state.
--
-- WHAT THIS RESTORES, AND WHAT IT CANNOT
-- ---------------------------------------------------------------
-- The forward migration does two destructive things: it maps known
-- unit aliases onto canonical values, and it NULLs every unit it does
-- not recognise. Neither is recoverable from the remaining `unit`
-- column. It therefore copies the pre-migration text into
-- `unit_legacy` first, and this script restores `unit` from that
-- column.
--
-- That restore only works if the forward migration that ran here was
-- the version carrying `unit_legacy`. On a database migrated by the
-- earlier version of 015 — the one that NULLed values with nothing
-- preserved — the column does not exist and the original text is
-- GONE. It cannot be reconstructed from this database; the only source
-- is the pre-migration `pg_dump` that the deploy runbook mandates
-- before every migration run. The guard below says so out loud instead
-- of silently succeeding, because a rollback that reports success
-- while leaving the data destroyed is worse than one that fails.
--
-- `unit_legacy` is intentionally NOT dropped here. It is the recovery
-- record; dropping it on rollback would destroy the very thing that
-- makes this rollback meaningful, and a rollback is exactly when it is
-- most likely to be needed twice.

-- Constraint first. Restoring free-text units while the CHECK is still
-- live would raise 23514 on every row this script exists to rescue.
ALTER TABLE patient_function_tests
  DROP CONSTRAINT IF EXISTS patient_function_tests_unit_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patient_function_tests'
      AND column_name = 'unit_legacy'
  ) THEN
    UPDATE patient_function_tests
      SET unit = unit_legacy
      WHERE unit_legacy IS NOT NULL
        AND unit IS DISTINCT FROM unit_legacy;
    -- WARNING rather than NOTICE for the good branch too. The two
    -- branches of this IF are the difference between「units restored」
    -- and「units are gone, go get the pg_dump」, and stock
    -- log_min_messages = warning discards a NOTICE — so on the
    -- documented rollback path (`npm run db:migrate:down`, which does
    -- not subscribe to node-postgres's 'notice' event either) the
    -- restore branch was indistinguishable from a DO block that never
    -- ran. An operator reading the server log has to be able to tell
    -- which of the two happened, not just hear from the bad one.
    RAISE WARNING 'patient_function_tests.unit restored from unit_legacy';
  ELSE
    RAISE WARNING 'patient_function_tests.unit_legacy does not exist: the CHECK constraint has been dropped, but any unit value migration 015 rewrote or NULLed is NOT recoverable from this database. Restore it from the pre-migration pg_dump.';
  END IF;
END;
$$ LANGUAGE plpgsql;
