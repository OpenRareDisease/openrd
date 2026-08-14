/**
 * `npm run trials:refresh` — read both registries, write what came
 * back, and record what happened either way.
 *
 *
 * THE TWO SOURCES ARE INDEPENDENT
 *
 * Each gets its own `trial_fetch_runs` row and its own try/catch, and
 * one failing does not stop the other. That is the shape the page
 * needs: 「ClinicalTrials.gov 截至 8 月 13 日；国内这部分现在取不到，
 * 上次成功 8 月 6 日」 is only sayable if a failed domestic scrape left
 * the global half alone.
 *
 *
 * WHAT COMMITS TOGETHER
 *
 * For one source: the delete of rows the registry dropped, the upsert
 * of every row it returned, and the flip of the run to `ok = TRUE`.
 * All three in one transaction, or none of them. A run marked
 * successful whose rows did not land would put a date on the page that
 * describes data that is not there.
 *
 * Nothing touches `trial_records` on a failed fetch. The previous
 * records stay exactly as they were, with their own older `fetched_at`,
 * and the failed run row is how a reader knows to distrust their age.
 *
 *
 * A NOTE FOR WHATEVER RENDERS THIS
 *
 * `records_upserted = 0` with `ok = TRUE` is a real and expected
 * answer for chinadrugtrials, not an error: no FSHD trial is
 * registered at 药物临床试验登记与信息公示平台 (measured 2026-08-13 and
 * again 2026-08-14 — see chinadrugtrials.fetcher.ts).
 *
 * 「国内登记平台目前没有相关记录（截至 X）」 and 「国内这部分现在取不
 * 到（上次成功 X）」 are different sentences, and the column that tells
 * them apart is `source_reported_total`, NOT `records_upserted`:
 *
 *   ok = TRUE,  source_reported_total = 0   the registry itself
 *                                           answered 「nothing」
 *   ok = FALSE                              we could not read it
 *
 * `records_upserted = 0` alone says only that we wrote nothing, which
 * is true of both. Do not render 「没有相关记录」 off `ok` and a row
 * count.
 *
 * AND NOTHING CAN RENDER IT OFF THE RIGHT COLUMN EITHER, TODAY, so the
 * honest answer for that state is neither sentence. `completeFetchRun`
 * writes `source_reported_total` (trials.repository.ts) and no SELECT
 * in this tree reads it back: `SOURCE_STATUS_SQL` in trials.service.ts
 * is the only request-path read of `trial_fetch_runs` and it does not
 * select the column, `TrialSourceStatus` has no field for it, so
 * /api/trials cannot carry it and no client can hold it. A screen
 * saying 「没有相关记录」 is therefore a screen that inferred it from
 * `ok` and a row count, which is the inference this note exists to
 * forbid.
 *
 * Where the number does surface: refresh.cli.ts prints each run's
 * value on stdout — from the fetch result in memory, not from the
 * column — and the column itself is readable in psql. To put it in
 * front of a patient instead, widen the
 * successful-run LATERAL in `SOURCE_STATUS_SQL`, add the field to
 * `TrialSourceStatus` and `toSourceStatus`, and decode it in the
 * client. Whatever does that has to read NULL as 「we cannot say」:
 * migration 027's `trial_fetch_runs_ok_reported_total_check` is NOT
 * VALID, so a successful run written before 027 still has NULL there.
 *
 * Read it for the ZERO, and only for the zero. ctgov's value is one
 * query's `totalCount`; chinadrugtrials' is the sum of 共 N 条记录 over
 * three keyword searches, and a trial matching two of them is in that
 * sum twice. So `= 0` means 「every search we ran came back empty」 for
 * both sources, and that is a fact about the registry — but a positive
 * value is not a number of trials for chinadrugtrials and must never be
 * shown as one.
 *
 * ctgov never reaches the first of the two rows above: its fetcher
 * refuses a totalCount of 0 outright, because zero from a registry that
 * published 92 matching studies is our query having broken, not an
 * empty registry.
 *
 * `trial_records.phase` holds the REGISTRY's own token and the two
 * registries do not share a vocabulary — ctgov says `PHASE1`,
 * `PHASE1/PHASE2` or `NA`, chinadrugtrials says `I期`. Neither is a
 * display string. A surface that prints the column has to branch on
 * `source`, and must not print ctgov's `NA` as a phase: it is ctgov's
 * token for a study that has no phases at all.
 */

import { fetchChinaDrugTrials } from './chinadrugtrials.fetcher.js';
import { fetchCtgovTrials } from './ctgov.fetcher.js';
import {
  completeFetchRun,
  failFetchRun,
  replaceTrialRecords,
  startFetchRun,
  type TrialsDb,
} from './trials.repository.js';
import type { TrialFetchResult, TrialSource } from './trials.types.js';
import type { AppLogger } from '../../config/logger.js';

export interface TrialSourceFetcher {
  source: TrialSource;
  fetch: () => Promise<TrialFetchResult>;
}

/** A source that was read, wrote its rows and flipped its run row. */
export interface RefreshSourceSuccess {
  source: TrialSource;
  ok: true;
  /** The `trial_fetch_runs` row this refresh committed. */
  runId: string;
  recordsUpserted: number;
  recordsDeleted: number;
  /**
   * What the SOURCE said matched. `0` here alongside
   * `recordsUpserted: 0` is the registry's own 「nothing matches」, and
   * it is the only fact 「没有相关记录」 may be rendered from. See the
   * header, TrialFetchResult.sourceReportedTotal and migration 027.
   *
   * Only the 0 is a count of trials for both sources. For ctgov the
   * number is `totalCount`, the registry's own count for one query; for
   * chinadrugtrials it is the SUM of 共 N 条记录 over the CDT_KEYWORDS
   * searches, which counts a trial matching two keywords twice. A
   * positive value therefore may not be printed as 「the registry says
   * N trials」 — refresh.cli.ts's reportedPhrase is where that is
   * spelled out, and it is the sentence to copy.
   */
  sourceReportedTotal: number;
  error: null;
}

/** A source that did not produce a list. `trial_records` is untouched
 *  and whatever was there stays, with its own older `fetched_at`. */
export interface RefreshSourceFailure {
  source: TrialSource;
  ok: false;
  /**
   * `null` when no run row was written, so this source's attempt left
   * no trace in `trial_fetch_runs` at all — which is why that case is
   * also logged at error level.
   *
   * Three ways to get here, not one: the database was unreachable; the
   * INSERT came back without an id on a healthy database; or — because
   * both sources share one connection — the previous source's ROLLBACK
   * itself failed, leaving the connection in an aborted transaction in
   * which this INSERT cannot run. The third is a real sequence: the
   * catch that logs 'ROLLBACK failed after a write error' is the one
   * that produces it.
   */
  runId: string | null;
  recordsUpserted: number;
  recordsDeleted: number;
  /** Nothing to report: the fetch never got an answer from the
   *  registry, so there is no count of the registry's own to carry. */
  sourceReportedTotal: null;
  error: string;
}

/**
 * Discriminated on `ok` rather than flat, so 「what the registry said」
 * is a `number` exactly where it exists. A flat shape would make the
 * CLI print it through a `?? '?'` fallback for a null that a successful
 * run cannot have — a branch nobody can reach and nobody can test.
 */
export type RefreshSourceOutcome = RefreshSourceSuccess | RefreshSourceFailure;

export interface RefreshTrialsDeps {
  db: TrialsDb;
  logger: AppLogger;
  /** Overridden in tests. Defaults to the two real registries. */
  fetchers?: TrialSourceFetcher[];
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const buildDefaultFetchers = (logger: AppLogger): TrialSourceFetcher[] => [
  { source: 'ctgov', fetch: () => fetchCtgovTrials({ fetchImpl: fetch, logger }) },
  {
    source: 'chinadrugtrials',
    fetch: () => fetchChinaDrugTrials({ fetchImpl: fetch, logger }),
  },
];

const refreshOne = async (
  db: TrialsDb,
  logger: AppLogger,
  fetcher: TrialSourceFetcher,
): Promise<RefreshSourceOutcome> => {
  const { source } = fetcher;

  let runId: string;
  try {
    runId = await startFetchRun(db, source);
  } catch (error) {
    // Nothing else in this function can run, and there is no row to
    // write the reason into. This log line is the only record.
    const message = messageOf(error);
    // `err`, not `error`: pino's standard serializer is keyed on `err`,
    // and `{ error }` renders as `error: {}` under this repo's logger
    // config (measured against a real failed run) — which loses the one
    // thing this line exists to carry.
    logger.error(
      { source, err: error },
      'Could not open a trial_fetch_runs row; source not attempted',
    );
    return {
      source,
      ok: false,
      runId: null,
      recordsUpserted: 0,
      recordsDeleted: 0,
      sourceReportedTotal: null,
      error: message,
    };
  }

  try {
    const result = await fetcher.fetch();
    if (result.source !== source) {
      throw new Error(`fetcher registered as ${source} returned a ${result.source} result`);
    }

    await db.query('BEGIN');
    let upserted: number;
    let deleted: number;
    try {
      const replaced = await replaceTrialRecords(db, source, result.records, result.fetchedAt);
      upserted = replaced.upserted;
      deleted = replaced.deleted;
      await completeFetchRun(db, runId, upserted, result.sourceReportedTotal);
      await db.query('COMMIT');
    } catch (error) {
      // ROLLBACK first, or the failure UPDATE below runs inside an
      // aborted transaction and fails too, and the run is left saying
      // 「started and never came back」 for a failure we know the
      // reason for. Its own failure must not replace the reason we are
      // here.
      try {
        await db.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error({ source, runId, err: rollbackError }, 'ROLLBACK failed after a write error');
      }
      throw error;
    }

    logger.info(
      {
        source,
        runId,
        recordsUpserted: upserted,
        recordsDeleted: deleted,
        sourceReportedTotal: result.sourceReportedTotal,
      },
      'Refreshed a trial registry',
    );
    return {
      source,
      ok: true,
      runId,
      recordsUpserted: upserted,
      recordsDeleted: deleted,
      sourceReportedTotal: result.sourceReportedTotal,
      error: null,
    };
  } catch (error) {
    const message = messageOf(error);
    logger.error({ source, runId, err: error }, 'Trial refresh failed for a source');
    try {
      await failFetchRun(db, runId, message);
    } catch (writeError) {
      // The run row stays `ok = FALSE, finished_at IS NULL`, which
      // still reads as 「started and never came back」 — the reason is
      // lost but the failure is not.
      logger.error({ source, runId, err: writeError }, 'Could not record why a refresh failed');
    }
    return {
      source,
      ok: false,
      runId,
      recordsUpserted: 0,
      recordsDeleted: 0,
      sourceReportedTotal: null,
      error: message,
    };
  }
};

/**
 * Refresh every source, in order, never stopping early. Returns one
 * outcome per source; the caller decides the exit code.
 */
export const refreshTrials = async (deps: RefreshTrialsDeps): Promise<RefreshSourceOutcome[]> => {
  const { db, logger } = deps;
  const fetchers = deps.fetchers ?? buildDefaultFetchers(logger);

  const outcomes: RefreshSourceOutcome[] = [];
  for (const fetcher of fetchers) {
    outcomes.push(await refreshOne(db, logger, fetcher));
  }
  return outcomes;
};
