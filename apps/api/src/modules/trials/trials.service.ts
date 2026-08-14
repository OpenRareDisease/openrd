/**
 * Read side of the cached trial registry.
 *
 * The refresh is an out-of-band process (`npm run trials:refresh`, host
 * cron) and this module is the only thing the request path runs — see
 * the header of db/migrations/026_trials_and_admin.sql for why the
 * fetch is not on the request path at all. Nothing here ever reaches
 * clinicaltrials.gov or chinadrugtrials.org.cn.
 *
 * WHAT THIS MODULE OWES ITS CALLERS
 *
 * A cached list of trials with no date on it is a claim about the
 * present made from an unknown past, so `readTrialSnapshot` never
 * returns rows without also returning the freshness facts that date
 * them. There is one call and it answers both questions at once, which
 * is what stops a caller rendering a list first and discovering its age
 * second. Its two consumers today are ./trials.routes.ts (the 试验
 * page's endpoint) and ../ai-agents/retrievers/clinical-trials.ts (the
 * AI tool).
 *
 * `sources` always has one entry per registry in TRIAL_SOURCES, even
 * for a registry that has never been fetched and has no rows. That is
 * the load-bearing part: 「国内这部分取不到」 is a sentence the page has
 * to be able to say, and a source that simply vanishes from the payload
 * when nothing about it exists reads on screen exactly like a source
 * with nothing to report.
 */

import type { Pool, PoolClient } from 'pg';

// One definition of the source vocabulary for the whole module: the
// refresh writes rows keyed on it and this file reads them back, and two
// copies of a list that must match a CHECK constraint is one copy too
// many.
import { TRIAL_SOURCES, type TrialSource } from './trials.types.js';

export { TRIAL_SOURCES, type TrialSource };

/** Registry display names. Used where a source id would be shown to a
 *  human or handed to the model; nothing branches on these. */
export const TRIAL_SOURCE_LABELS: Record<TrialSource, string> = {
  ctgov: 'ClinicalTrials.gov',
  chinadrugtrials: '药物临床试验登记与信息公示平台',
};

export interface TrialRecord {
  source: TrialSource;
  /** The registry's own id — an NCT number, or a CTR number. */
  sourceId: string;
  title: string;
  /** The registry's word, verbatim. Never translated here. */
  statusRaw: string;
  /**
   * Our own fixed translation, written by the refresh. `null` means the
   * mapping did not recognise `statusRaw`, and the only correct
   * rendering of that is `statusRaw` itself — NOT 「状态未知」. The row
   * has a status; we have no approved Chinese word for it.
   */
  statusZh: string | null;
  phase: string | null;
  sponsor: string | null;
  countries: string[];
  url: string;
  /** The registry's own last-changed date, `YYYY-MM-DD`, or `null` when
   *  the registry did not publish one. NOT our fetch time. */
  sourceUpdatedAt: string | null;
  /**
   * When WE last read this row, ISO 8601 in UTC.
   *
   * The column is per row, but under the current write path every row
   * of one source carries the same instant, and a caller must not
   * design around a spread that cannot happen. `replaceTrialRecords`
   * (./trials.repository.ts) DELETEs the studies the registry stopped
   * returning and re-stamps every survivor with the run's `fetchedAt`,
   * in one transaction — so a row cannot fall behind its own source,
   * and 「this row was left behind by later fetches」 is not a state
   * this data can be in. Confirmed against the dev database on
   * 2026-08-14:
   *
   *   select source, count(*), count(distinct fetched_at)
   *     from trial_records group by 1;   -- ctgov | 92 | 1
   *
   * What it is still for: it is the only date attached to the rows
   * themselves, and it is the date behind 「本平台读取时间」 on every
   * rendered record. A UNION of two sources refreshed on different
   * schedules does spread — which is why the page dates the list from
   * the OLDEST of them (apps/mobile/lib/trials.ts, `resolveFetchedOn`)
   * rather than the newest.
   */
  fetchedAt: string;
}

/**
 * The most recent refresh attempt for a source, whatever became of it.
 *
 * `finishedAt === null` with `ok === false` is not a missing field: the
 * refresh inserts this row when the attempt STARTS (026's write
 * protocol), so it is a run that began and never wrote an ending —
 * either one happening right now or one that was killed mid-flight.
 * `trial_fetch_runs` records no heartbeat, so nothing here can tell
 * those apart and nothing here pretends to.
 */
export interface TrialFetchRun {
  startedAt: string;
  /** ISO 8601 in UTC, or `null` for a run that never reported an end. */
  finishedAt: string | null;
  ok: boolean;
}

export interface TrialSourceStatus {
  source: TrialSource;
  /** Rows currently cached for this source. Counted from
   *  `trial_records`, not taken from a run's `records_upserted`, so a
   *  source whose last run upserted 92 rows into a table that was then
   *  truncated does not report 92. */
  recordCount: number;
  /**
   * The newest `fetched_at` among this source's cached rows, ISO 8601
   * in UTC, or `null` when it has none.
   *
   * Taken off the ROWS rather than off the run, and the two genuinely
   * come apart: a run that finishes with `ok = TRUE` and writes no rows
   * moves `lastSuccessAt` and leaves this one where it was. That is not
   * hypothetical — it is what `chinadrugtrials` does on every run
   * today, so on 2026-08-14 the dev database holds a successful run
   * finished at 00:03:31Z for a source with zero rows and a null
   * `fetchedAt`:
   *
   *   select source, ok, records_upserted from trial_fetch_runs
   *    order by started_at desc limit 2;
   *   -- chinadrugtrials | t | 0
   *   -- ctgov           | t | 92
   *
   * So this field, not `lastSuccessAt`, is what may date the rows —
   * 「拉取于」 on the page and 「这些记录读取于」 in the AI answer both
   * come from here (apps/mobile/lib/trials.ts,
   * ../ai-agents/tools/list-clinical-trials.ts). `lastSuccessAt` says
   * only when a run last finished.
   */
  fetchedAt: string | null;
  /** The latest attempt, or `null` when the refresh has never started
   *  for this source on this database. */
  lastRun: TrialFetchRun | null;
  /**
   * `finished_at` of the most recent run with `ok = TRUE`, ISO 8601 in
   * UTC, or `null` when this source has never had one.
   *
   * Not nullable-by-accident: `trial_fetch_runs_ok_finished_check`
   * (migration 026) makes `ok = TRUE` with a NULL `finished_at`
   * unwritable, so whenever a successful run exists this value exists.
   * `null` here therefore means 「never succeeded」 and nothing else —
   * which is what lets the page say 「国内这部分从来没取到过」 instead of
   * leaving a blank.
   */
  lastSuccessAt: string | null;
}

/**
 * One reading of `lastRun`, for the server-side consumers that need a
 * verdict rather than the raw facts.
 *
 *   ok         — the latest attempt finished and reported success.
 *   failed     — it finished and reported a failure.
 *   unfinished — it started and never wrote an ending (see TrialFetchRun).
 *   never_ran  — no attempt has ever started for this source.
 *
 * Deliberately NOT a field on the wire. The 试验 page derives its own
 * verdict defensively from `lastRun` (apps/mobile/lib/trials.ts), so a
 * `state` string in the payload would be a field nothing reads; this
 * lives here because ../ai-agents/tools/list-clinical-trials.ts has to
 * put the same verdict in front of the model.
 */
export type TrialFetchState = 'ok' | 'failed' | 'unfinished' | 'never_ran';

export const trialFetchState = (status: TrialSourceStatus): TrialFetchState => {
  if (!status.lastRun) return 'never_ran';
  if (status.lastRun.ok) return 'ok';
  return status.lastRun.finishedAt === null ? 'unfinished' : 'failed';
};

export interface TrialSnapshot {
  trials: TrialRecord[];
  /** One entry per TRIAL_SOURCES member, in that order, always. */
  sources: TrialSourceStatus[];
}

interface TrialRow {
  source: string;
  source_id: string;
  title: string;
  status_raw: string;
  status_zh: string | null;
  phase: string | null;
  sponsor: string | null;
  countries: string[] | null;
  url: string;
  source_updated_at: string | null;
  fetched_at: string;
}

interface RunRow {
  source: string;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_ok: boolean | null;
  last_success_at: string | null;
  newest_fetched_at: string | null;
  record_count: number;
}

/**
 * `to_char(... AT TIME ZONE 'UTC')` rather than letting the driver hand
 * back a Date and formatting in JS.
 *
 * Two reasons, both about the value a patient reads. A `timestamptz`
 * rendered by Postgres's own default formatting follows the session's
 * TimeZone GUC, so the same row can come back `+00` on one connection
 * and `+08` on another and the page's 「拉取于」 would move with the
 * pool's configuration rather than with the fetch. And a Date round-trip
 * through the driver is one more place for the string the client
 * receives to stop being the string the database holds. One spelling,
 * fixed at the query, and it is the spelling `new Date(...)` parses in
 * every browser this ships to.
 */
const UTC_ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

const TRIALS_SQL = `
  SELECT source,
         source_id,
         title,
         status_raw,
         status_zh,
         phase,
         sponsor,
         countries,
         url,
         to_char(source_updated_at, 'YYYY-MM-DD')            AS source_updated_at,
         to_char(fetched_at AT TIME ZONE 'UTC', ${UTC_ISO})   AS fetched_at
    FROM trial_records
   ORDER BY source, source_updated_at DESC NULLS LAST, source_id
`;

/**
 * One row per requested source, whether or not it has ever been
 * fetched. `unnest` on the parameter rather than `GROUP BY source` over
 * the tables is what makes the never-fetched case a row instead of an
 * absence — see the module header.
 *
 * The two LATERAL lookups are the same shape as the two questions
 * `idx_trial_fetch_runs_latest (source, started_at DESC)` was built for:
 * 「the latest run for this source」 and 「the latest successful one」.
 * `id DESC` is a tie-break only — two runs for one source can share a
 * `started_at` down to the microsecond only if something starts them
 * concurrently, and picking the older of the two would report a stale
 * outcome as the current one.
 *
 * WHAT IT DOES NOT SELECT, AND WHAT THAT COSTS. `error`, on purpose —
 * see trials.routes.ts. And `source_reported_total`, the registry's
 * own count (migration 027), which no query in this tree selects, so
 * every successful run writes it and nothing reads it. The sentence
 * 027 exists to make sayable — 「登记库自己说没有相关记录」, as opposed
 * to 「我们没写进去」 — is therefore sayable on no surface fed from
 * here, and neither may be rendered off `ok` plus `record_count`
 * (refresh.ts's header). Putting it on the wire means widening the
 * `ok_run` LATERAL, `RunRow`, `TrialSourceStatus` and `toSourceStatus`
 * together, and reading NULL as 「we cannot say」: the 027 CHECK that
 * requires the value on a successful run is NOT VALID, so a run
 * written before 027 still has NULL there.
 */
const SOURCE_STATUS_SQL = `
  SELECT s.source,
         to_char(latest.started_at  AT TIME ZONE 'UTC', ${UTC_ISO}) AS last_started_at,
         to_char(latest.finished_at AT TIME ZONE 'UTC', ${UTC_ISO}) AS last_finished_at,
         latest.ok                                                  AS last_ok,
         to_char(ok_run.finished_at AT TIME ZONE 'UTC', ${UTC_ISO}) AS last_success_at,
         to_char(cnt.newest AT TIME ZONE 'UTC', ${UTC_ISO})         AS newest_fetched_at,
         COALESCE(cnt.n, 0)                                         AS record_count
    FROM unnest($1::text[]) AS s(source)
    LEFT JOIN LATERAL (
      SELECT f.started_at, f.finished_at, f.ok
        FROM trial_fetch_runs f
       WHERE f.source = s.source
       ORDER BY f.started_at DESC, f.id DESC
       LIMIT 1
    ) latest ON TRUE
    LEFT JOIN LATERAL (
      SELECT f.finished_at
        FROM trial_fetch_runs f
       WHERE f.source = s.source AND f.ok
       ORDER BY f.started_at DESC, f.id DESC
       LIMIT 1
    ) ok_run ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n, max(r.fetched_at) AS newest
        FROM trial_records r
       WHERE r.source = s.source
    ) cnt ON TRUE
`;

const toTrial = (row: TrialRow): TrialRecord => ({
  // The CHECK constraint on trial_records.source is what makes this
  // cast true; nothing else in this file relies on it.
  source: row.source as TrialSource,
  sourceId: row.source_id,
  title: row.title,
  statusRaw: row.status_raw,
  statusZh: row.status_zh,
  phase: row.phase,
  sponsor: row.sponsor,
  countries: row.countries ?? [],
  url: row.url,
  sourceUpdatedAt: row.source_updated_at,
  fetchedAt: row.fetched_at,
});

const toSourceStatus = (source: TrialSource, row: RunRow | undefined): TrialSourceStatus => ({
  source,
  recordCount: row?.record_count ?? 0,
  fetchedAt: row?.newest_fetched_at ?? null,
  // `started_at` is NOT NULL on the table, so a non-null value here is
  // exactly 「a run exists」 — which is why the absence of a run is a
  // null `lastRun` rather than a run with null fields.
  lastRun:
    row && row.last_started_at !== null
      ? {
          startedAt: row.last_started_at,
          finishedAt: row.last_finished_at,
          // `ok` is NOT NULL on the table; the `=== true` is how a LEFT
          // JOIN miss reads as 「not successful」 rather than as truthy.
          ok: row.last_ok === true,
        }
      : null,
  lastSuccessAt: row?.last_success_at ?? null,
});

/**
 * Every cached trial plus the freshness facts that date it.
 *
 * READ IN ONE SNAPSHOT, deliberately. The two queries run inside one
 * REPEATABLE READ transaction so they cannot see different states of
 * the database. Without it, a refresh committing between them returns
 * the rows from before it and the success timestamp from after it —
 * i.e. the previous fetch's list under the current fetch's date, which
 * is the exact failure this whole feature exists to prevent. It is a
 * narrow window and it is also the cheapest thing in this file to
 * close: two indexed reads of a table the migration header measures at
 * 92 rows.
 *
 * READ ONLY is not decoration either — it is what lets this run against
 * a hot standby, and it makes the transaction incapable of the write
 * that would turn a page load into a lock the refresh waits on.
 *
 * The connection is released in `finally`, and the transaction is
 * ROLLBACKed rather than COMMITted: nothing was written, and a rollback
 * cannot fail in a way that turns a successful read into a 500.
 */
export const readTrialSnapshot = async (pool: Pool): Promise<TrialSnapshot> => {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const trialsResult = await client.query<TrialRow>(TRIALS_SQL);
    const runsResult = await client.query<RunRow>(SOURCE_STATUS_SQL, [[...TRIAL_SOURCES]]);
    await client.query('ROLLBACK');

    const bySource = new Map(runsResult.rows.map((row) => [row.source, row]));
    return {
      trials: trialsResult.rows.map(toTrial),
      sources: TRIAL_SOURCES.map((source) => toSourceStatus(source, bySource.get(source))),
    };
  } catch (error) {
    // Best-effort unwind so the connection does not go back to the pool
    // mid-transaction. If the failure was the connection itself this
    // throws too, and swallowing that is correct — the original error is
    // the one the caller needs, and pg discards a client that errors on
    // release anyway.
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
