import { describe, expect, it, vi } from 'vitest';

import { refreshTrials, type TrialSourceFetcher } from './refresh.js';
import type { TrialsDb } from './trials.repository.js';
import type { TrialFetchResult, TrialRecordInput, TrialSource } from './trials.types.js';
import type { AppLogger } from '../../config/logger.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as AppLogger;

interface FakeDbOptions {
  /** Throw when the statement contains this fragment. */
  failOn?: string;
}

const fakeDb = (options: FakeDbOptions = {}) => {
  const statements: string[] = [];
  /** Whole statements with their parameters, for the assertions that
   *  care what was written rather than in what order. */
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  let nextRunId = 1;
  const db: TrialsDb = {
    query: async (sql, values) => {
      statements.push(sql.trim().split('\n')[0]?.trim() ?? '');
      calls.push({ sql, values });
      if (options.failOn && sql.includes(options.failOn)) {
        throw new Error(`postgres said no to: ${options.failOn}`);
      }
      if (sql.includes('INSERT INTO trial_fetch_runs')) {
        const row = { id: String(nextRunId) };
        nextRunId += 1;
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { db, statements, calls };
};

const trialRecord = (source: TrialSource, sourceId: string): TrialRecordInput => ({
  source,
  sourceId,
  title: 'A study',
  statusRaw: 'RECRUITING',
  statusZh: '招募中',
  phase: null,
  sponsor: null,
  countries: null,
  url: `https://example.invalid/${sourceId}`,
  sourceUpdatedAt: null,
  raw: {},
});

/** `sourceReportedTotal` defaults to the number of records, which is
 *  what both real fetchers produce when no keyword overlaps; the tests
 *  that care about the registry's own number pass it explicitly. */
const okFetcher = (
  source: TrialSource,
  records: TrialRecordInput[],
  sourceReportedTotal = records.length,
): TrialSourceFetcher => ({
  source,
  fetch: async (): Promise<TrialFetchResult> => ({
    source,
    fetchedAt: new Date(),
    records,
    sourceReportedTotal,
  }),
});

const failingFetcher = (source: TrialSource, message: string): TrialSourceFetcher => ({
  source,
  fetch: async () => {
    throw new Error(message);
  },
});

describe('refreshTrials — the shape of a good run', () => {
  it('writes the run row, then the records, then the success flag, in one transaction', async () => {
    const { db, statements } = fakeDb();

    const outcomes = await refreshTrials({
      db,
      logger: silentLogger,
      fetchers: [okFetcher('ctgov', [trialRecord('ctgov', 'NCT00000001')])],
    });

    expect(outcomes).toEqual([
      {
        source: 'ctgov',
        ok: true,
        runId: '1',
        recordsUpserted: 1,
        recordsDeleted: 0,
        sourceReportedTotal: 1,
        error: null,
      },
    ]);
    expect(statements).toEqual([
      'INSERT INTO trial_fetch_runs (source) VALUES ($1) RETURNING id',
      'BEGIN',
      'DELETE FROM trial_records WHERE source = $1 AND source_id <> ALL($2::text[])',
      'INSERT INTO trial_records (',
      'UPDATE trial_fetch_runs',
      'COMMIT',
    ]);
    // The run row is opened OUTSIDE the transaction. Inside it, a
    // process killed mid-fetch would roll the row away and leave
    // nothing — which reads the same as cron never firing.
    expect(statements.indexOf('BEGIN')).toBeGreaterThan(0);
  });
});

describe('refreshTrials — an empty registry and a broken one are different outcomes', () => {
  it('records an empty result as a success', async () => {
    // 药物临床试验登记与信息公示平台 has no FSHD trial registered
    // today. The page has to be able to say 「国内登记平台目前没有相关
    // 记录（截至 X）」, and that sentence needs ok = TRUE with zero
    // records.
    const { db } = fakeDb();
    const [outcome] = await refreshTrials({
      db,
      logger: silentLogger,
      fetchers: [okFetcher('chinadrugtrials', [])],
    });

    expect(outcome?.ok).toBe(true);
    expect(outcome?.recordsUpserted).toBe(0);
    expect(outcome?.error).toBeNull();
  });

  it('carries the registry own zero into the run row, not just our own', async () => {
    // 「共 0 条记录」 on the site and 「we wrote 0 rows」 are not the
    // same fact, and after 026 the run row could only hold the second.
    // This is the assertion that the first one survives the write —
    // without it, `records_upserted = 0, ok = TRUE` is again a row that
    // a broken scraper and an empty registry both produce.
    const { db, calls } = fakeDb();
    const [outcome] = await refreshTrials({
      db,
      logger: silentLogger,
      fetchers: [okFetcher('chinadrugtrials', [], 0)],
    });

    expect(outcome).toMatchObject({ ok: true, recordsUpserted: 0, sourceReportedTotal: 0 });

    const complete = calls.find((call) => call.sql.includes('ok = TRUE'));
    expect(complete?.sql).toContain('source_reported_total = $3');
    expect(complete?.values).toEqual(['1', 0, 0]);
  });

  it('reports what the registry said even when it differs from what we wrote', async () => {
    // chinadrugtrials sums 共 N 条记录 over three keyword searches and
    // writes each trial once, so a trial matching two keywords makes
    // the registry's number larger than ours. The run row records both
    // rather than picking one.
    const { db, calls } = fakeDb();
    const [outcome] = await refreshTrials({
      db,
      logger: silentLogger,
      fetchers: [okFetcher('chinadrugtrials', [trialRecord('chinadrugtrials', 'CTR20252821')], 2)],
    });

    expect(outcome).toMatchObject({ ok: true, recordsUpserted: 1, sourceReportedTotal: 2 });
    expect(calls.find((call) => call.sql.includes('ok = TRUE'))?.values).toEqual(['1', 1, 2]);
  });

  it('records a broken scrape as a failure, with the reason, and writes no records', async () => {
    const { db, statements } = fakeDb();
    const [outcome] = await refreshTrials({
      db,
      logger: silentLogger,
      fetchers: [
        failingFetcher(
          'chinadrugtrials',
          'chinadrugtrials search page 1: no results table in the response (25210 bytes)',
        ),
      ],
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toContain('no results table');
    // trial_records was not touched at all: the previous list stands,
    // with its own older fetched_at.
    expect(statements.some((sql) => sql.includes('trial_records'))).toBe(false);
    expect(statements).toContain('UPDATE trial_fetch_runs');
  });
});

describe('refreshTrials — one source failing does not take the other with it', () => {
  it('still refreshes the second source after the first fails', async () => {
    const { db } = fakeDb();
    const outcomes = await refreshTrials({
      db,
      logger: silentLogger,
      fetchers: [
        failingFetcher('ctgov', 'ctgov page 1: no response within 30000ms'),
        okFetcher('chinadrugtrials', [trialRecord('chinadrugtrials', 'CTR20252821')]),
      ],
    });

    expect(outcomes.map((outcome) => [outcome.source, outcome.ok])).toEqual([
      ['ctgov', false],
      ['chinadrugtrials', true],
    ]);
  });

  it('attempts the second source even when the first could not open a run row', async () => {
    // The database was unreachable for the very first statement. There
    // is no row to write a reason into, so the outcome carries a null
    // runId and the failure is logged.
    let first = true;
    const db: TrialsDb = {
      query: async (sql) => {
        if (sql.includes('INSERT INTO trial_fetch_runs') && first) {
          first = false;
          throw new Error('connection terminated unexpectedly');
        }
        if (sql.includes('INSERT INTO trial_fetch_runs')) {
          return { rows: [{ id: '7' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const outcomes = await refreshTrials({
      db,
      logger: silentLogger,
      fetchers: [okFetcher('ctgov', []), okFetcher('chinadrugtrials', [])],
    });

    expect(outcomes[0]).toMatchObject({
      source: 'ctgov',
      ok: false,
      runId: null,
      // Nothing was read, so there is no registry count to report. A 0
      // here would be this refresh asserting an empty registry it never
      // asked.
      sourceReportedTotal: null,
    });
    expect(outcomes[1]).toMatchObject({ source: 'chinadrugtrials', ok: true, runId: '7' });
  });
});

describe('refreshTrials — a write that fails mid-transaction', () => {
  it('rolls back, then records the reason on the run row', async () => {
    const { db, statements } = fakeDb({ failOn: 'INSERT INTO trial_records' });

    const [outcome] = await refreshTrials({
      db,
      logger: silentLogger,
      fetchers: [okFetcher('ctgov', [trialRecord('ctgov', 'NCT00000001')])],
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toContain('postgres said no');
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    // ROLLBACK comes first, or this UPDATE would run inside an aborted
    // transaction and the reason would be lost.
    expect(statements.lastIndexOf('UPDATE trial_fetch_runs')).toBeGreaterThan(
      statements.indexOf('ROLLBACK'),
    );
  });

  it('refuses a fetcher that returned a different source than it registered as', async () => {
    const { db, statements } = fakeDb();
    const [outcome] = await refreshTrials({
      db,
      logger: silentLogger,
      fetchers: [
        {
          source: 'ctgov',
          fetch: async () => ({
            source: 'chinadrugtrials',
            fetchedAt: new Date(),
            records: [],
            sourceReportedTotal: 0,
          }),
        },
      ],
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toContain('fetcher registered as ctgov returned a chinadrugtrials');
    expect(statements).not.toContain('BEGIN');
  });
});
