import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { readTrialSnapshot, trialFetchState, TRIAL_SOURCES } from './trials.service.js';

/**
 * A stub client that answers each SQL by shape, so a test can say what
 * the two reads return without depending on their order in the file.
 * `queries` records every statement, which is how the transaction
 * assertions below see the BEGIN / ROLLBACK.
 */
const clientWith = (opts: { trials?: unknown[]; runs?: unknown[]; failOn?: 'trials' | 'runs' }) => {
  const queries: string[] = [];
  const released = { count: 0 };
  const query = vi.fn(async (sql: string) => {
    queries.push(sql);
    if (sql.includes('FROM trial_records\n')) {
      if (opts.failOn === 'trials') throw new Error('relation "trial_records" does not exist');
      return { rows: opts.trials ?? [], rowCount: (opts.trials ?? []).length };
    }
    if (sql.includes('unnest($1::text[])')) {
      if (opts.failOn === 'runs') throw new Error('boom');
      return { rows: opts.runs ?? [], rowCount: (opts.runs ?? []).length };
    }
    return { rows: [], rowCount: 0 };
  });
  const client = {
    query,
    release: () => {
      released.count += 1;
    },
  } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, queries, released, query };
};

/**
 * What the LEFT JOINs actually produce for a source with no runs and no
 * rows: a row exists (it comes from `unnest` on the parameter), and
 * every column from the joined tables is NULL. Written out rather than
 * simply omitted from the fixture, because omitting it tests a shape the
 * query cannot return — and then `lastRun` reads null for the wrong
 * reason.
 */
const noRun = (source: string) => ({
  source,
  last_started_at: null,
  last_finished_at: null,
  last_ok: null,
  last_success_at: null,
  newest_fetched_at: null,
  record_count: 0,
});

const okRun = (source: string) => ({
  source,
  last_started_at: '2026-08-13T04:00:00Z',
  last_finished_at: '2026-08-13T04:00:09Z',
  last_ok: true,
  last_success_at: '2026-08-13T04:00:09Z',
  newest_fetched_at: '2026-08-13T04:00:07Z',
  record_count: 92,
});

describe('readTrialSnapshot', () => {
  it('reads both halves inside one read-only REPEATABLE READ transaction', async () => {
    const { pool, queries, released } = clientWith({});
    await readTrialSnapshot(pool);

    expect(queries[0]).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(queries.at(-1)).toBe('ROLLBACK');
    // The rows and the freshness dates must come out of the same
    // snapshot; a refresh committing between them would date the
    // previous fetch's list with the current fetch's timestamp.
    expect(queries.filter((q) => q.includes('FROM trial_records\n'))).toHaveLength(1);
    expect(queries.filter((q) => q.includes('unnest($1::text[])'))).toHaveLength(1);
    expect(released.count).toBe(1);
  });

  it('never selects trial_records.raw', () => {
    // `raw` is the fetcher's pinned-field object, not the full study —
    // ClinicalTrials.gov's eligibilityCriteria and resultsSection are
    // never requested, so they are in no row (see ctgov.fetcher.ts's
    // header). This SELECT list is the second layer of the §A5
    // boundary: it keeps the fields that ARE in `raw` out of the
    // prompt, and it holds even if the pinned field list grows.
    const { pool, queries } = clientWith({});
    return readTrialSnapshot(pool).then(() => {
      const trialsSql = queries.find((q) => q.includes('FROM trial_records\n')) as string;
      expect(trialsSql).not.toMatch(/\braw\b/);
    });
  });

  it('returns every source even when it has no runs and no rows', async () => {
    // 「国内这部分取不到」 has to be sayable. A source that vanishes from
    // the payload when nothing about it exists reads on screen exactly
    // like a source with nothing to report.
    const { pool } = clientWith({ runs: [okRun('ctgov'), noRun('chinadrugtrials')] });
    const snapshot = await readTrialSnapshot(pool);

    expect(snapshot.sources.map((s) => s.source)).toEqual([...TRIAL_SOURCES]);
    expect(snapshot.sources[1]).toEqual({
      source: 'chinadrugtrials',
      recordCount: 0,
      fetchedAt: null,
      lastRun: null,
      lastSuccessAt: null,
    });
    expect(trialFetchState(snapshot.sources[1])).toBe('never_ran');
  });

  it('distinguishes ok / failed / unfinished / never_ran', async () => {
    const { pool } = clientWith({
      runs: [
        okRun('ctgov'),
        {
          source: 'chinadrugtrials',
          last_started_at: '2026-08-13T05:00:00Z',
          last_finished_at: '2026-08-13T05:00:30Z',
          last_ok: false,
          last_success_at: '2026-08-01T04:00:11Z',
          newest_fetched_at: '2026-08-01T04:00:10Z',
          record_count: 3,
        },
      ],
    });
    const failed = (await readTrialSnapshot(pool)).sources[1];
    expect(trialFetchState(failed)).toBe('failed');
    // A failed run does not erase the last good one — the page still has
    // a date to show beside 「国内这部分现在取不到」.
    expect(failed.lastSuccessAt).toBe('2026-08-01T04:00:11Z');

    const unfinished = clientWith({
      runs: [
        noRun('chinadrugtrials'),
        {
          source: 'ctgov',
          last_started_at: '2026-08-13T06:00:00Z',
          last_finished_at: null,
          last_ok: false,
          last_success_at: '2026-08-13T04:00:09Z',
          newest_fetched_at: '2026-08-13T04:00:07Z',
          record_count: 92,
        },
      ],
    });
    const snapshot = await readTrialSnapshot(unfinished.pool);
    // Started and never came back: 026's write protocol makes this
    // distinguishable from 「cron never fired」, and the read side must
    // not collapse the two into one state.
    expect(trialFetchState(snapshot.sources[0])).toBe('unfinished');
    expect(trialFetchState(snapshot.sources[1])).toBe('never_ran');
  });

  it('dates a source from its rows, not from when its run finished', async () => {
    // A run that finishes with `ok = TRUE` having written no rows —
    // which is every chinadrugtrials run today — moves `last_success_at`
    // and leaves the rows' own `fetched_at` where it was.「拉取于」 is a
    // statement about the data, so it comes off the data.
    const { pool } = clientWith({
      runs: [
        {
          ...okRun('ctgov'),
          last_success_at: '2026-08-13T04:00:09Z',
          newest_fetched_at: '2026-08-13T04:00:07Z',
        },
      ],
    });
    const [ctgov] = (await readTrialSnapshot(pool)).sources;
    expect(ctgov.fetchedAt).toBe('2026-08-13T04:00:07Z');
    expect(ctgov.lastSuccessAt).toBe('2026-08-13T04:00:09Z');
  });

  it('maps a row without dropping the two dates apart', async () => {
    const { pool } = clientWith({
      trials: [
        {
          source: 'ctgov',
          source_id: 'NCT04635891',
          title: 'Validation of Motor Outcome Assessments in FSHD',
          status_raw: 'RECRUITING',
          status_zh: '招募中',
          phase: 'N/A',
          sponsor: 'University of Kansas Medical Center',
          countries: ['United States'],
          url: 'https://clinicaltrials.gov/study/NCT04635891',
          source_updated_at: '2025-06-01',
          fetched_at: '2026-08-13T04:00:07Z',
        },
      ],
      runs: [okRun('ctgov')],
    });
    const [trial] = (await readTrialSnapshot(pool)).trials;

    // The registry's last edit and our last read are different facts and
    // the row carries both.
    expect(trial.sourceUpdatedAt).toBe('2025-06-01');
    expect(trial.fetchedAt).toBe('2026-08-13T04:00:07Z');
    expect(trial.statusRaw).toBe('RECRUITING');
  });

  it('leaves statusZh null rather than inventing a Chinese word', async () => {
    const { pool } = clientWith({
      trials: [
        {
          source: 'ctgov',
          source_id: 'NCT05902884',
          title: 'MSOT in FSHD',
          status_raw: 'Enrolling by invitation',
          status_zh: null,
          phase: null,
          sponsor: null,
          countries: null,
          url: 'https://clinicaltrials.gov/study/NCT05902884',
          source_updated_at: null,
          fetched_at: '2026-08-13T04:00:07Z',
        },
      ],
    });
    const [trial] = (await readTrialSnapshot(pool)).trials;
    expect(trial.statusZh).toBeNull();
    expect(trial.statusRaw).toBe('Enrolling by invitation');
    // A NULL array column is an empty list, not a missing field.
    expect(trial.countries).toEqual([]);
  });

  it('releases the connection and rethrows when a read fails', async () => {
    const { pool, queries, released } = clientWith({ failOn: 'runs' });
    await expect(readTrialSnapshot(pool)).rejects.toThrow('boom');
    // A database that cannot answer must reach the caller as a failure.
    // Returning an empty snapshot here would put an empty trial list on
    // the patient's screen and call it the registry's answer.
    expect(queries.at(-1)).toBe('ROLLBACK');
    expect(released.count).toBe(1);
  });
});
