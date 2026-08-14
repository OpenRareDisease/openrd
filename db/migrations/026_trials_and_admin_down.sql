-- 026_trials_and_admin_down.sql
--
-- Reverse migration 026. Idempotent (IF EXISTS) so it can re-run
-- against a partially-applied or already-rolled-back state.
--
-- WHAT THIS DESTROYS, AND WHAT IT CANNOT PUT BACK
-- ---------------------------------------------------------------
-- Dropping `trial_records` destroys the cached registry snapshot. That
-- is fully recoverable and costs one `npm run trials:refresh`, because
-- every row in it is a copy of something clinicaltrials.gov still
-- serves — this is the one table in the repo whose contents are
-- someone else's.
--
-- Dropping `trial_fetch_runs` is the loss that does not come back. It
-- is the record of WHEN we could and could not reach each registry,
-- and nothing else holds that history: a re-run after the rollback
-- starts the freshness record from zero, so 「上次成功抓取是什么时候」
-- has no answer until the next successful run, and the record of an
-- outage that a patient may have seen a stale list during is gone. If
-- that history matters (it does for anything the 国内 registry half
-- ever claimed), dump the table before running this file:
--     pg_dump --data-only --table=trial_fetch_runs "$DATABASE_URL" > runs.sql
--
-- 026 wrote no rows into any pre-existing table and altered no
-- pre-existing column, so there is nothing else to restore.
--
-- APP_USERS.ROLE IS DELIBERATELY NOT TOUCHED HERE. 026 did not widen
-- the role CHECK — the constraint has admitted 'admin' since migration
-- 011 and 026 only asserts that (see its header). So this file must
-- not narrow it: doing so would revoke a value migration 011 owns, and
-- would break every existing clinician/admin row on a database that
-- rolls 026 back for an unrelated reason.
--
-- ACCOUNTS ALREADY GRANTED role = 'admin' KEEP IT. Rolling this
-- migration back removes the back-office's tables and index, not its
-- users. The API code being rolled back with it is what stops the
-- admin routes from existing; the row still says 'admin', and it will
-- work again the moment the code returns. Use `npm run admin:revoke`
-- if the intent is to take the access away — a rollback is not a
-- revocation and this file will not pretend it is.

-- ---------------------------------------------------------------- admin audit index
--
-- Dropping an index takes ACCESS EXCLUSIVE on audit_logs, which blocks
-- reads as well as writes — briefly, but on a table every login writes
-- to. DROP INDEX CONCURRENTLY is unavailable for the same reason
-- CREATE INDEX CONCURRENTLY was in the forward file: the runner wraps
-- this file in a transaction.

DROP INDEX IF EXISTS idx_audit_logs_event_type_occurred_at;

-- ---------------------------------------------------------------- trials
--
-- No dependency between the two tables (trial_fetch_runs has no FK to
-- trial_records — a run that fetched nothing still has to be
-- recordable), so the order here is only for readability.

DROP TABLE IF EXISTS trial_fetch_runs;
DROP TABLE IF EXISTS trial_records;
