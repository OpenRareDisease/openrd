-- 027: trial_fetch_runs.source_reported_total
--
-- WHY THIS COLUMN EXISTS
-- ---------------------------------------------------------------
-- After 026, a refresh that wrote nothing is one row:
--
--   source          | ok | records_upserted
--   chinadrugtrials | t  | 0
--
-- and that row is two different facts wearing the same clothes:
--
--   A. we asked the registry, it answered, and it said nothing
--      matches — 「国内登记平台目前没有相关记录」
--   B. we wrote nothing for some other reason — 「我们这边坏了」
--
-- A patient reads the first as a fact about FSHD research and the
-- second as a fact about FSHD research too, which is the problem. The
-- table has to tell them apart, and after 026 nothing in it could:
-- `records_upserted` counts what WE wrote, and there was no column for
-- what the SOURCE said.
--
-- WHICH ONE THE LIVE SITE IS DOING, MEASURED
--
-- Run against www.chinadrugtrials.org.cn on 2026-08-14 (the probe is
-- the real fetcher with the response bodies dumped; every keyword in
-- CDT_KEYWORDS, cold cookie jar):
--
--   request 1  HTTP 202, 25564 bytes, 0 × class="searchTable"   (the
--              anti-bot challenge; the fetcher replays its cookies)
--   面肩肱     HTTP 200, 45994 bytes, results table present,
--              暂无数据 row, 共 <i>0</i> 条记录, 共 <i>0</i> 页
--   面肩胛肱   HTTP 200, 46020 bytes, same
--   FSHD       HTTP 200, 46246 bytes, same
--
-- So today it is case A: the registry renders its own results table
-- and its own zero. That is a fact worth recording as one, and this
-- column is how it is recorded — as the registry's number, not as the
-- absence of ours.
--
--
-- WHAT GOES IN IT
--
-- The count the SOURCE ITSELF published for the query we ran:
--   ctgov            `totalCount` from the API's first page.
--   chinadrugtrials  the sum of 共 N 条记录 over the three keyword
--                    searches.
--
-- The chinadrugtrials sum double-counts a trial that matches two
-- keywords and writes it once, so for that source this number is >=
-- records_upserted rather than equal to it. Today all three keywords
-- report 0 and the sum is 0. The exact identity that matters is the
-- one it is here for: 0 means every query we ran came back with the
-- registry's own 「nothing matches」.
--
-- ctgov cannot legitimately report 0 — the query matched 92 studies on
-- 2026-08-13 and a registry does not unpublish its archive — so
-- ctgov.fetcher.ts refuses a run whose totalCount is 0 rather than
-- emptying the table. This column is therefore never 0 for ctgov on a
-- successful run; if a future reader sees one, the guard was removed.
--
-- What this column does NOT do is detect a partial collapse: 92 → 3
-- is written as 3, and no threshold in the fetcher rejects it, because
-- any threshold would be a number nobody measured. The column is what
-- makes such a collapse VISIBLE — the previous run's 92 is one row
-- above it — and deciding to alarm on that is an ops decision, not a
-- scraper one.
--
--
-- LOCKS AND COST
--
-- ADD COLUMN of a nullable column with no DEFAULT does not rewrite the
-- table (PostgreSQL >= 11); it takes ACCESS EXCLUSIVE on
-- trial_fetch_runs for the catalogue update only. Nothing reads that
-- table on the request path except the trials endpoint, and the writer
-- is an hourly cron. The table held 16 rows on the dev database when
-- this was written (SELECT count(*) FROM trial_fetch_runs).

ALTER TABLE trial_fetch_runs
  ADD COLUMN IF NOT EXISTS source_reported_total INT;

COMMENT ON COLUMN trial_fetch_runs.source_reported_total IS
  'What the REGISTRY said matched our query (ctgov totalCount; chinadrugtrials the sum of 共 N 条记录 across keywords), as opposed to records_upserted, which is what we wrote. 0 on a successful run means the source itself answered 「nothing matches」 — the one thing that distinguishes 「注册库没有相关记录」 from 「我们没写进去」.';

-- Non-negative: it is a count from someone else's page and the parser
-- that reads it is a regular expression over HTML.
ALTER TABLE trial_fetch_runs
  DROP CONSTRAINT IF EXISTS trial_fetch_runs_reported_total_nonneg;
ALTER TABLE trial_fetch_runs
  ADD CONSTRAINT trial_fetch_runs_reported_total_nonneg
  CHECK (source_reported_total IS NULL OR source_reported_total >= 0);

-- A successful run must say what the source reported. Without this,
-- 「the registry said zero」 is a property of whichever code path
-- happened to call completeFetchRun, i.e. a property that a future
-- caller can drop silently — which is exactly the class of defect this
-- column exists to close.
--
-- NOT VALID, and that is not laziness: rows written before this
-- migration have ok = TRUE and a NULL here, and the only ways to make
-- them pass are to invent a number for a fetch nobody can re-run or to
-- delete the freshness history 026's down-migration goes out of its
-- way to protect. NOT VALID enforces the constraint on every INSERT
-- and UPDATE from now on and leaves the legacy rows readable as what
-- they are: runs from before the source's own count was recorded.
-- (`trial_fetch_runs` is new in this branch and has never been
-- deployed, so on any production database this table is empty when 027
-- runs and the constraint is fully enforced from its first row.)
ALTER TABLE trial_fetch_runs
  DROP CONSTRAINT IF EXISTS trial_fetch_runs_ok_reported_total_check;
ALTER TABLE trial_fetch_runs
  ADD CONSTRAINT trial_fetch_runs_ok_reported_total_check
  CHECK (NOT ok OR source_reported_total IS NOT NULL) NOT VALID;
