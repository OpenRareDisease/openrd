/**
 * The shapes the two fetchers produce and the refresh writes.
 *
 * Everything here mirrors `trial_records` in migration 026 column for
 * column, deliberately: a fetcher that invents a field the table has no
 * home for is a fetcher whose work is silently discarded on the way to
 * Postgres, and this file is where that mismatch is supposed to fail —
 * at `tsc`, not at 3am in a cron log.
 */

/**
 * The two registries, matching `trial_records.source`'s CHECK. Kept as
 * a const tuple so a third source cannot be added on the TypeScript
 * side alone: the migration's CHECK would reject every row it produced,
 * and the run would fail with a constraint violation nobody can read.
 */
export const TRIAL_SOURCES = ['ctgov', 'chinadrugtrials'] as const;

export type TrialSource = (typeof TRIAL_SOURCES)[number];

/** One row on its way into `trial_records`. */
export interface TrialRecordInput {
  source: TrialSource;
  /** The registry's own identifier: `NCT01234567` or `CTR20252821`. */
  sourceId: string;
  title: string;
  /**
   * The registry's status word, verbatim. For ctgov that is an English
   * enum token (`RECRUITING`); for chinadrugtrials it is already
   * Chinese (`进行中 尚未招募`). Neither is translated here — see
   * `statusZh`.
   */
  statusRaw: string;
  /**
   * Our translation of `statusRaw`, from the fixed map in
   * status-map.ts, or `null`.
   *
   * `null` means 「render statusRaw as it stands」 and never 「status
   * unknown」. It is what both a status word our map has not seen and a
   * source whose word is already Chinese come out as, and in both cases
   * the honest rendering is the registry's own word.
   */
  statusZh: string | null;
  /**
   * The registry's own phase token(s), not a display string. ctgov
   * emits an array and it is joined with `/` (`PHASE1/PHASE2`);
   * `NA` is ctgov's token for a study that has no phases at all
   * (observational, behavioural, device) and is NOT a phase name — a
   * surface that prints this column has to know that. `null` means the
   * registry published no phase.
   */
  phase: string | null;
  sponsor: string | null;
  /**
   * `null` — not `[]` — when the registry lists no location. The two
   * are different facts (「the registry did not say」 versus 「the
   * registry says nowhere」) and only `null` is the one we can support.
   */
  countries: string[] | null;
  /** The registry's own page for this record. Every claim the trial
   *  list makes has to be checkable in one tap. */
  url: string;
  /**
   * `YYYY-MM-DD`, the date the REGISTRY says the record last changed —
   * never our fetch time, which is `fetchedAt` on the run. `null` when
   * the registry publishes no such date (chinadrugtrials does not; see
   * that fetcher's header).
   *
   * A string rather than a Date because the column is DATE: handing
   * node-postgres a JS Date sends an instant, and an instant near
   * midnight lands on the previous day for anyone east of Greenwich.
   */
  sourceUpdatedAt: string | null;
  /** What we keep so a disagreement between what a patient sees and
   *  what the registry says can be settled. Each fetcher's header
   *  states exactly what it puts here. */
  raw: unknown;
}

/** What a fetcher returns when it got the WHOLE list. A fetcher that
 *  could not finish throws instead — there is no partial result, and
 *  no field here for one, because a half-list written to the table
 *  would be indistinguishable from the registry having got shorter. */
export interface TrialFetchResult {
  source: TrialSource;
  /**
   * When we finished reading the registry. Stamped on every row of the
   * run so a page can say 「截至 X」 with one date rather than a range.
   *
   * This is the Node clock, while `trial_fetch_runs.started_at` /
   * `finished_at` default to Postgres's `NOW()`. On the production VPS
   * both are the same machine; on a split host they are two NTP-synced
   * clocks. Nothing compares the two at finer than minute granularity,
   * and nothing should start.
   */
  fetchedAt: Date;
  records: TrialRecordInput[];
  /**
   * What the REGISTRY said matched our query, as opposed to
   * `records.length`, which is what we read.
   *
   * ctgov: the API's `totalCount`. chinadrugtrials: the sum of
   * 共 N 条记录 over the keyword searches, which double-counts a trial
   * matching two keywords and so is `>= records.length` for that
   * source.
   *
   * It is written to `trial_fetch_runs.source_reported_total` (see
   * migration 027) and it is the whole reason a run that wrote nothing
   * is readable: `ok = TRUE, records_upserted = 0,
   * source_reported_total = 0` is the registry answering 「nothing
   * matches」, which is a different sentence from 「we wrote nothing」
   * and is the only one a patient may be shown. Nothing shows a
   * patient either sentence today — the column has no reader on the
   * request path, and refresh.ts's header lists what would have to
   * change for it to get one.
   *
   * Both fetchers verify their record count against this number before
   * returning, so on this type they always agree except for the
   * keyword overlap above.
   */
  sourceReportedTotal: number;
}
