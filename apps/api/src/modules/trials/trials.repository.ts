/**
 * The only writer of `trial_records` and `trial_fetch_runs`.
 *
 * The request path reads these tables and never calls anything in this
 * file — see migration 026's header for why the fetch is out of band.
 */

import type { TrialRecordInput, TrialSource } from './trials.types.js';

/**
 * What this module needs from a connection.
 *
 * It must be a single connection — a `pg.Client`, or one `PoolClient`
 * checked out for the whole run — and NOT a `Pool`. `refreshTrials`
 * issues BEGIN and COMMIT as statements, and a Pool hands each
 * statement to whichever connection is free, which would open a
 * transaction on one connection and commit on another. Narrowed to
 * this shape so a test can pass a recording fake.
 */
export interface TrialsDb {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

/**
 * How much of a failure reason is kept.
 *
 * `trial_fetch_runs.error` is TEXT and nothing SELECTs it — no route,
 * no ops endpoint (see trials.routes.ts). The cap is here to bound an
 * unbounded TEXT write, not to fit a screen: the fetchers' messages are
 * one line by construction, but a driver error carrying a query and a
 * stack is not, and neither is whatever a future source throws. The
 * whole reason is already on the refresh job's stderr and log line
 * (refresh.cli.ts, refresh.ts); this column is the copy someone reads
 * out of psql later, so the truncation is marked rather than silent.
 */
export const MAX_RUN_ERROR_CHARS = 2_000;

export const truncateRunError = (message: string): string =>
  message.length <= MAX_RUN_ERROR_CHARS
    ? message
    : `${message.slice(0, MAX_RUN_ERROR_CHARS)}… [truncated, ${message.length} chars]`;

/**
 * Write the row that says an attempt STARTED, and return its id.
 *
 * Committed on its own, before the fetch, which is the whole point:
 * `ok` defaults to FALSE and `finished_at` to NULL, so a refresh that
 * is OOM-killed or cut off by a cron timeout leaves 「started and never
 * came back」 behind. Writing the row at the end instead would leave
 * nothing at all, and nothing is indistinguishable from 「cron never
 * fired」 — which reads on the page as the previous success still being
 * current.
 */
export const startFetchRun = async (db: TrialsDb, source: TrialSource): Promise<string> => {
  const result = await db.query('INSERT INTO trial_fetch_runs (source) VALUES ($1) RETURNING id', [
    source,
  ]);
  const id = result.rows[0]?.id;
  if (id === undefined || id === null) {
    throw new Error(`trial_fetch_runs INSERT for ${source} returned no id`);
  }
  // BIGSERIAL comes back from node-postgres as a string (int8 is not
  // safely representable as a JS number). Kept as one rather than
  // parsed, because it is only ever sent back as a parameter.
  return String(id);
};

/**
 * Flip the run to success.
 *
 * Called INSIDE the same transaction as the record write, so `ok =
 * TRUE` and the rows it describes commit together. A page that reads
 * 「最后成功 X」 from a run whose data never landed is worse than one
 * that reads nothing.
 *
 * `sourceReportedTotal` is not optional and has no default. It is the
 * registry's own count (migration 027), and it is the only thing that
 * COULD separate 「the registry says there is nothing」 from 「we wrote
 * nothing」 — a successful run that did not record it would put those
 * two back into the same row. Nothing selects the column back out yet,
 * so today the separation exists in the table and not on any screen;
 * refresh.ts's header says what would have to change. The table
 * refuses an unrecorded one anyway
 * (trial_fetch_runs_ok_reported_total_check), which is deliberate
 * belt-and-braces: this signature is what a caller reads, the
 * constraint is what a caller cannot get around.
 */
export const completeFetchRun = async (
  db: TrialsDb,
  runId: string,
  recordsUpserted: number,
  sourceReportedTotal: number,
): Promise<void> => {
  await db.query(
    `UPDATE trial_fetch_runs
        SET ok = TRUE, finished_at = NOW(), error = NULL, records_upserted = $2,
            source_reported_total = $3
      WHERE id = $1`,
    [runId, recordsUpserted, sourceReportedTotal],
  );
};

/**
 * Record why the attempt ended without data. `ok` stays FALSE — the
 * table's CHECK constraints make an `ok = TRUE` row with an error
 * unwritable, which is deliberate.
 */
export const failFetchRun = async (db: TrialsDb, runId: string, message: string): Promise<void> => {
  await db.query(
    `UPDATE trial_fetch_runs
        SET finished_at = NOW(), error = $2
      WHERE id = $1`,
    [runId, truncateRunError(message)],
  );
};

const UPSERT_SQL = `
  INSERT INTO trial_records (
    source, source_id, title, status_raw, status_zh, phase, sponsor,
    countries, url, source_updated_at, fetched_at, raw
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
  ON CONFLICT (source, source_id) DO UPDATE SET
    title             = EXCLUDED.title,
    status_raw        = EXCLUDED.status_raw,
    status_zh         = EXCLUDED.status_zh,
    phase             = EXCLUDED.phase,
    sponsor           = EXCLUDED.sponsor,
    countries         = EXCLUDED.countries,
    url               = EXCLUDED.url,
    source_updated_at = EXCLUDED.source_updated_at,
    fetched_at        = EXCLUDED.fetched_at,
    raw               = EXCLUDED.raw
`;

export interface ReplaceResult {
  upserted: number;
  /** Rows the registry no longer returns for our query. */
  deleted: number;
}

/**
 * Make `trial_records` for this source equal what the fetcher read.
 *
 * WHY IT DELETES. A study the registry has stopped returning for the
 * FSHD query is not an FSHD study any more, and leaving it in place
 * would show a patient a trial with a stale `fetched_at` sitting in a
 * list where every neighbour is fresh. The delete is safe here and
 * nowhere else, because the only way to reach this function is a fetch
 * that verified its own completeness against the registry's own count
 * — a fetcher that could not finish throws, and this is never called.
 *
 * Both statements plus the run's success flag belong to ONE
 * transaction, opened by the caller. Half of this applied is a list
 * that is neither the old one nor the new one.
 *
 * One statement per record rather than one batched INSERT: the whole
 * table is 92 rows today (measured, see migration 026), the caller is
 * a cron job with nobody waiting, and a driver error then names the
 * record it was writing instead of naming a 1,100-parameter statement.
 */
export const replaceTrialRecords = async (
  db: TrialsDb,
  source: TrialSource,
  records: TrialRecordInput[],
  fetchedAt: Date,
): Promise<ReplaceResult> => {
  const sourceIds: string[] = [];
  for (const record of records) {
    if (record.source !== source) {
      // A fetcher writing under another source's key would corrupt the
      // other source's list, and the run that did it would report
      // success.
      throw new Error(
        `trial_records: ${source} fetcher produced a record marked ${record.source} (${record.sourceId})`,
      );
    }
    sourceIds.push(record.sourceId);
  }

  const deleted = await db.query(
    'DELETE FROM trial_records WHERE source = $1 AND source_id <> ALL($2::text[])',
    [source, sourceIds],
  );

  for (const record of records) {
    await db.query(UPSERT_SQL, [
      record.source,
      record.sourceId,
      record.title,
      record.statusRaw,
      record.statusZh,
      record.phase,
      record.sponsor,
      record.countries,
      record.url,
      record.sourceUpdatedAt,
      fetchedAt,
      JSON.stringify(record.raw),
    ]);
  }

  return { upserted: records.length, deleted: deleted.rowCount ?? 0 };
};
