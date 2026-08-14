-- 027_trial_fetch_runs_source_reported_total_down.sql
--
-- Reverse migration 027. Idempotent (IF EXISTS) so it can re-run
-- against a partially-applied or already-rolled-back state.
--
-- WHAT THIS DESTROYS
-- ---------------------------------------------------------------
-- The registry's own count for every run recorded since 027 went in.
-- It is not recoverable by re-running the fetch: the number belongs to
-- the moment it was read, and a re-fetch answers for today. After this
-- file, a run with records_upserted = 0 is once again ambiguous
-- between 「the registry says there is nothing」 and 「we wrote
-- nothing」 — see the forward file for why that ambiguity is the
-- reason the column exists.
--
-- Dump it first if the history matters:
--     pg_dump --data-only --table=trial_fetch_runs "$DATABASE_URL" > runs.sql
--
-- The API code being rolled back with this file is what stops writing
-- the column; nothing else reads it, so dropping it breaks no
-- constraint on trial_records and touches no other table.

ALTER TABLE trial_fetch_runs
  DROP CONSTRAINT IF EXISTS trial_fetch_runs_ok_reported_total_check;
ALTER TABLE trial_fetch_runs
  DROP CONSTRAINT IF EXISTS trial_fetch_runs_reported_total_nonneg;
ALTER TABLE trial_fetch_runs
  DROP COLUMN IF EXISTS source_reported_total;
