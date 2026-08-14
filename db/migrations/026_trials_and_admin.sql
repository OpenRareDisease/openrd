-- 026_trials_and_admin.sql
--
-- The storage half of two features that ship together: the cached
-- trial registry the 试验 page reads, and the back-office an operator
-- uses to read a patient's record on their behalf.
--
--
-- WHY THE TRIAL LIST IS A TABLE AND NOT A FETCH
--
-- Production runs on a VPS inside mainland China and the registry we
-- can actually read is clinicaltrials.gov, which is outside it. A
-- request-path fetch makes every patient's page depend on a link that
-- is sometimes slow and sometimes down, and the failure mode is the
-- worst one this app has: a spinner, or a blank list that looks like
-- 「没有试验」 rather than 「我们取不到」. So the fetch is a separate
-- process (`npm run trials:refresh`, host cron) and the request path
-- reads `trial_records` only.
--
-- That trade has a cost, and `trial_fetch_runs` is how the cost is
-- paid honestly: a cache with no freshness record cannot tell a
-- patient how old the list is, and a list of trials with no date on it
-- is a claim about the present made from an unknown past. Every page
-- and every AI answer that quotes this data has to be able to say
-- 「截至 <date>」, and both halves of that sentence come out of these
-- two tables.
--
-- `trial_fetch_runs` is therefore NOT a log. It is read on the request
-- path to answer two questions the page must answer out loud:
--   * how new is this list (last run with ok = TRUE, per source)
--   * which source is currently broken (last run per source, ok =
--     FALSE) — the 国内 registry has no public API and will break.
--
--
-- WHAT THIS FILE DOES NOT DO: app_users.role
--
-- The admin back-office needs `app_users.role` to accept 'admin'. It
-- already does, and has since migration 011. Checked before writing
-- this file, against the dev database:
--
--   SELECT conname, pg_get_constraintdef(oid), convalidated
--     FROM pg_constraint WHERE conrelid = 'app_users'::regclass;
--
--   app_users_role_check
--     CHECK ((role = ANY (ARRAY['patient'::text, 'caregiver'::text,
--                               'clinician'::text, 'admin'::text])))
--     NOT VALID   (convalidated = f)
--
-- So there is nothing to widen, and dropping and re-adding a
-- constraint this file did not write is how 'clinician' would quietly
-- disappear from the set. Instead the property the rest of this branch
-- depends on is ASSERTED at the bottom of this file, behaviourally
-- (insert 'admin' into a copy of the table's constraints) rather than
-- by name — a database whose constraint has drifted fails this
-- migration instead of failing the first `npm run admin:grant`.
--
-- The constraint is still NOT VALID and this file leaves it that way.
-- What NOT VALID does and does not mean here: new INSERTs and UPDATEs
-- ARE checked, so 'admin' being in the set is the only thing
-- admin:grant needs. What is unverified is the pre-011 rows. Promoting
-- it with VALIDATE CONSTRAINT would abort the deploy on the first
-- legacy row outside the set, and buys nothing for this feature —
-- requireAdmin compares role to the literal 'admin', so an unexpected
-- legacy value is simply not an admin. See migration 022's note for
-- the one thing NOT VALID does cost: a row already holding an
-- out-of-set role cannot be UPDATEd, so `admin:grant` against such an
-- account raises 23514. scripts/admin-role.mjs reports that case by
-- name rather than as a raw driver error.
--
--
-- LOCKS THIS MIGRATION TAKES
--
--   trial_records, trial_fetch_runs   CREATE TABLE on relations that
--     do not exist yet. Nothing live can be waiting on them.
--
--   audit_logs                        CREATE INDEX takes SHARE, which
--     blocks INSERT into audit_logs for the duration of the build.
--     Every login, every OTP send, every passport share writes to that
--     table, so this is the one statement here with a live blast
--     radius. It is not CONCURRENTLY because it cannot be: the runner
--     wraps every migration file in one transaction and rejects a file
--     that manages its own (see SELF_MANAGED_TX in
--     apps/api/src/db/migrate.ts), and CREATE INDEX CONCURRENTLY
--     cannot run inside a transaction block.
--
--   app_users                         ACCESS SHARE, for the CREATE
--     TEMP TABLE ... (LIKE app_users) probe. No writer is blocked.
--
--
-- MEASURED
--
-- PostgreSQL 18.0 (Homebrew, aarch64-apple-darwin25), a scratch table
-- with audit_logs' exact column set holding 1,000,000 rows spread over
-- 180 days across 7 event types (169 MB), VACUUM ANALYZEd:
--
--   CREATE INDEX (event_type, occurred_at)      728.5 ms   (\timing)
--
-- and the query the back-office runs against it,
-- EXPLAIN (ANALYZE, BUFFERS), warm:
--
--   SELECT id, event_payload, occurred_at FROM ...
--    WHERE event_type = 'admin.record_read'
--      AND occurred_at >= NOW() - INTERVAL '30 days'
--    ORDER BY occurred_at DESC LIMIT 50
--
--     without the index   Parallel Seq Scan + top-N heapsort
--                         18,944 buffers, 56.6 ms
--     with the index      Index Scan Backward, 11 buffers, 0.2 ms
--
-- 1,000,000 is an upper bound chosen to make the lock window legible,
-- not a measurement of production. audit_logs is bounded by
-- AUDIT_RETENTION_DAYS = 180 in apps/api/src/services/audit/retention.ts,
-- so its real size is 180 days of traffic. Before deploying, ask:
--     SELECT count(*), pg_size_pretty(pg_total_relation_size('audit_logs'))
--       FROM audit_logs;
-- and scale the 728.5 ms accordingly.
--
-- trial_records is sized by the registry, not by our users: on
-- 2026-08-13,
--   curl -sS -A 'openrd-trials/1.0' \
--     'https://clinicaltrials.gov/api/v2/studies?query.cond=facioscapulohumeral+muscular+dystrophy&countTotal=true&pageSize=1'
-- returned totalCount = 92 in 0.11 s. Two orders of magnitude below
-- anything that needs a secondary index, which is why the table below
-- has none beyond its primary key.


-- ---------------------------------------------------------------- trial records

CREATE TABLE IF NOT EXISTS trial_records (
  -- Which registry this row was read from. The two are not merged and
  -- not deduplicated: a trial registered in both places is two rows,
  -- because the two registries disagree about status and update dates
  -- and picking a winner would be us inventing a fact.
  source            TEXT NOT NULL
                    CHECK (source IN ('ctgov', 'chinadrugtrials')),
  -- The registry's own identifier: an NCT number, or a CTR number.
  source_id         TEXT NOT NULL,
  title             TEXT NOT NULL,
  -- The registry's word, verbatim, untranslated and un-normalised.
  -- This column is the appeal court for every other status field: the
  -- old corpus snapshot this feature replaces rendered `Recruiting` as
  -- 「招聘」 (a job opening) and `facioscapulohumeral` as
  -- 「面肩关节疾病」, and there was no way to see that had happened
  -- because nothing kept the source string.
  status_raw        TEXT NOT NULL,
  -- Our translation, from a fixed mapping — never machine translation,
  -- and NULL when the mapping does not recognise status_raw. NULL here
  -- means 「show the English」, not 「unknown status」: guessing at a
  -- status word is how 招聘 happened.
  status_zh         TEXT,
  phase             TEXT,
  sponsor           TEXT,
  countries         TEXT[],
  -- The registry's own page. Every claim this feature makes to a
  -- patient has to be checkable in one tap by them or their doctor.
  url               TEXT NOT NULL,
  -- When the REGISTRY says the record last changed. Distinct from
  -- fetched_at below, and the distinction is the whole point: a record
  -- we fetched this morning may not have been touched by its sponsor
  -- since 2019, and 「最后更新」 must not be allowed to mean our
  -- fetch time. DATE, not timestamptz, because that is the precision
  -- the registries publish.
  source_updated_at DATE,
  -- When WE last read it. Shown on the page and in AI answers; see the
  -- header.
  fetched_at        TIMESTAMPTZ NOT NULL,
  -- The whole response object for this study. Kept so a disagreement
  -- between what a patient sees and what the registry says can be
  -- settled against what the registry actually returned at fetch time,
  -- rather than against our parser's memory of it. Also the only way a
  -- field we did not think to extract can be recovered without
  -- re-fetching history we no longer have.
  raw               JSONB NOT NULL,
  PRIMARY KEY (source, source_id)
);

COMMENT ON TABLE trial_records IS
  'Cached registry records for the patient-facing trial list. Written only by the out-of-band refresh (npm run trials:refresh); the request path reads it and never fetches. fetched_at must reach every surface that quotes a row.';

-- No secondary index, deliberately. The whole table is 92 rows today
-- (measurement in the header) and the page reads all of them; an index
-- on status or source would be a maintained object that no plan ever
-- chooses. Add one when a query exists that needs it.


-- ---------------------------------------------------------------- fetch runs

CREATE TABLE IF NOT EXISTS trial_fetch_runs (
  id               BIGSERIAL PRIMARY KEY,
  source           TEXT NOT NULL
                   CHECK (source IN ('ctgov', 'chinadrugtrials')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  -- Defaults to FALSE because the row is written when the attempt
  -- STARTS and flipped to TRUE only when it completes. A refresh that
  -- is OOM-killed, times out at the cron level, or takes the container
  -- down with it therefore leaves a row saying `ok = FALSE,
  -- finished_at IS NULL` — 「started and never came back」 — instead of
  -- leaving no row at all. The absence of a row is indistinguishable
  -- from 「cron never fired」, and both of those read on the page as
  -- the previous success still being current.
  ok               BOOLEAN NOT NULL DEFAULT FALSE,
  error            TEXT,
  records_upserted INT NOT NULL DEFAULT 0,
  -- A successful run has finished and has nothing to report. Without
  -- these two, `ok = TRUE, finished_at IS NULL` is writable, and the
  -- page's freshness date would come from a run that never ended.
  CONSTRAINT trial_fetch_runs_ok_finished_check
    CHECK (NOT ok OR finished_at IS NOT NULL),
  CONSTRAINT trial_fetch_runs_ok_no_error_check
    CHECK (NOT ok OR error IS NULL)
);

COMMENT ON TABLE trial_fetch_runs IS
  'One row per refresh attempt, inserted at start with ok=FALSE and flipped on success. Read on the request path to answer 「这份名单有多新」 and 「哪个源现在取不到」 — a feature, not a log.';

-- Both request-path questions are 「the latest row for this source」,
-- with the successful-only variant filtering on `ok` afterwards. One
-- index serves both: at two sources times a cron tick the table grows
-- by a few thousand rows a year, so the recheck on `ok` costs nothing
-- worth a second, partial index.
--
-- Nothing deletes from this table. That is intentional and it is
-- affordable: the rows carry no personal data and an hourly cron on
-- two sources produces ~17,500 rows a year. It is deliberately NOT in
-- the retention sweep in services/audit/retention.ts, whose windows
-- exist because those tables hold identifiers; this one holds
-- timestamps and error strings from public registries.
CREATE INDEX IF NOT EXISTS idx_trial_fetch_runs_latest
  ON trial_fetch_runs (source, started_at DESC);


-- ---------------------------------------------------------------- admin audit index
--
-- requireAdmin writes one audit_logs row per admin request, reads
-- included, so the back-office is now the heaviest writer into this
-- table and 「谁在什么时候看了谁」 is a query somebody will actually
-- run. Every such query filters on event_type ('admin.%') and bounds
-- occurred_at; before this file the table carried its primary key and
-- one other index, idx_audit_logs_user_id, on a column that no insert
-- site populates (see the account-deletion tombstone note in
-- account-deletion.ts). Plan comparison in the header.

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type_occurred_at
  ON audit_logs (event_type, occurred_at);


-- ---------------------------------------------------------------- role precondition
--
-- Assert, do not alter. See the header for why there is nothing to
-- widen.
--
-- The probe is behavioural and name-agnostic on purpose: it copies
-- app_users' CHECK constraints onto a throwaway temp table and tries
-- the insert the grant script will make. It therefore does not care
-- what the constraint is called, how many values it lists, or which
-- migration added it — only whether 'admin' gets in.
--
-- WHAT IT PROVES AND WHAT IT DOES NOT. It proves that no CHECK
-- constraint on app_users rejects role = 'admin'. It does not prove
-- that a constraint exists at all — a database where
-- app_users_role_check was dropped (011_status_check_constraints_down.sql
-- does exactly that) passes this probe, correctly: an unconstrained
-- column accepts 'admin' too. The precondition being asserted is
-- 「grant will not be rejected」, which is the precondition admin:grant
-- actually has.
--
-- Verified in both directions before shipping: against the dev
-- database it passes, and against a copy of app_users whose role CHECK
-- was narrowed to ('patient','caregiver','clinician') under a
-- deliberately different constraint NAME it raises.
DO $probe$
BEGIN
  CREATE TEMP TABLE role_check_probe_026
    (LIKE app_users INCLUDING CONSTRAINTS INCLUDING DEFAULTS);

  BEGIN
    INSERT INTO role_check_probe_026 (phone_number, password_hash, role)
    VALUES ('+8600000000000', 'not-a-hash-this-row-never-commits', 'admin');
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION
      'app_users rejects role = ''admin''. The admin back-office cannot be granted on this database. Inspect it with: SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = ''app_users''::regclass AND contype = ''c'';';
  END;

  DROP TABLE role_check_probe_026;
END;
$probe$;
