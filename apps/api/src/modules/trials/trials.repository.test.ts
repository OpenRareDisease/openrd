import { describe, expect, it } from 'vitest';

import {
  MAX_RUN_ERROR_CHARS,
  completeFetchRun,
  failFetchRun,
  replaceTrialRecords,
  startFetchRun,
  truncateRunError,
  type TrialsDb,
} from './trials.repository.js';
import type { TrialRecordInput } from './trials.types.js';

interface Call {
  sql: string;
  values: unknown[] | undefined;
}

const recordingDb = (rowsFor?: (sql: string) => Array<Record<string, unknown>>) => {
  const calls: Call[] = [];
  const db: TrialsDb = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      const rows = rowsFor?.(sql) ?? [];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, calls };
};

const record = (overrides: Partial<TrialRecordInput> = {}): TrialRecordInput => ({
  source: 'ctgov',
  sourceId: 'NCT00000001',
  title: 'A study',
  statusRaw: 'RECRUITING',
  statusZh: '招募中',
  phase: 'PHASE2',
  sponsor: 'Somebody',
  countries: ['United States'],
  url: 'https://clinicaltrials.gov/study/NCT00000001',
  sourceUpdatedAt: '2026-01-02',
  raw: { any: 'thing' },
  ...overrides,
});

describe('startFetchRun', () => {
  it('writes the row before the fetch, leaving ok to its FALSE default', async () => {
    const { db, calls } = recordingDb(() => [{ id: '42' }]);
    const runId = await startFetchRun(db, 'ctgov');

    expect(runId).toBe('42');
    expect(calls[0]?.sql).toContain('INSERT INTO trial_fetch_runs (source)');
    // Naming `ok` or `finished_at` here would be the bug: a run that
    // dies mid-fetch has to be left saying 「started and never came
    // back」.
    expect(calls[0]?.sql).not.toContain('ok');
    expect(calls[0]?.sql).not.toContain('finished_at');
    expect(calls[0]?.values).toEqual(['ctgov']);
  });

  it('refuses to carry on if the insert returned no id', async () => {
    const { db } = recordingDb(() => []);
    await expect(startFetchRun(db, 'ctgov')).rejects.toThrow('returned no id');
  });
});

describe('completeFetchRun / failFetchRun', () => {
  it('a success clears the error and stamps a finish time', async () => {
    const { db, calls } = recordingDb();
    await completeFetchRun(db, '42', 92, 92);

    expect(calls[0]?.sql).toContain('ok = TRUE');
    expect(calls[0]?.sql).toContain('finished_at = NOW()');
    // trial_fetch_runs_ok_no_error_check makes ok=TRUE with an error
    // unwritable, so a retried run has to clear it.
    expect(calls[0]?.sql).toContain('error = NULL');
    expect(calls[0]?.values).toEqual(['42', 92, 92]);
  });

  it('writes the registry own count, including when it is zero', async () => {
    // The row this assertion exists for:
    //   chinadrugtrials | ok = TRUE | records_upserted = 0
    // which after 026 was the same row for 「the registry says there is
    // nothing」 and 「we wrote nothing」. The zero the SITE printed has
    // to reach source_reported_total, and it has to reach it as a 0 and
    // not as an omitted parameter that the column then holds as NULL —
    // which trial_fetch_runs_ok_reported_total_check rejects (migration
    // 027).
    const { db, calls } = recordingDb();
    await completeFetchRun(db, '30', 0, 0);

    expect(calls[0]?.sql).toContain('source_reported_total = $3');
    expect(calls[0]?.values).toEqual(['30', 0, 0]);
  });

  it('a failure records the reason and leaves ok alone', async () => {
    const { db, calls } = recordingDb();
    await failFetchRun(db, '42', 'ctgov page 1: HTTP 503 (20 bytes)');

    expect(calls[0]?.sql).not.toContain('ok =');
    expect(calls[0]?.values).toEqual(['42', 'ctgov page 1: HTTP 503 (20 bytes)']);
  });

  it('marks a truncated reason as truncated instead of quietly cutting it', async () => {
    const long = 'x'.repeat(MAX_RUN_ERROR_CHARS + 500);
    const truncated = truncateRunError(long);

    expect(truncated.length).toBeLessThan(long.length);
    expect(truncated).toContain(`[truncated, ${long.length} chars]`);
    expect(truncateRunError('short')).toBe('short');
  });
});

describe('replaceTrialRecords', () => {
  it('drops the rows the registry no longer returns and upserts the rest', async () => {
    const { db, calls } = recordingDb();
    const fetchedAt = new Date('2026-08-13T22:00:00.000Z');
    const result = await replaceTrialRecords(
      db,
      'ctgov',
      [record(), record({ sourceId: 'NCT00000002' })],
      fetchedAt,
    );

    expect(result).toEqual({ upserted: 2, deleted: 0 });
    expect(calls[0]?.sql).toContain('DELETE FROM trial_records');
    // Scoped to this source: a failed chinadrugtrials run must not be
    // able to take the ctgov list with it.
    expect(calls[0]?.values).toEqual(['ctgov', ['NCT00000001', 'NCT00000002']]);

    expect(calls).toHaveLength(3);
    expect(calls[1]?.sql).toContain('ON CONFLICT (source, source_id) DO UPDATE');
    expect(calls[1]?.values?.[10]).toBe(fetchedAt);
    // raw goes down as a JSON string for the ::jsonb cast.
    expect(calls[1]?.values?.[11]).toBe('{"any":"thing"}');
  });

  it('empties the source when the registry legitimately returns nothing', async () => {
    // The domestic registry's answer today. `<> ALL(ARRAY[]::text[])`
    // is true for every row, so this clears the source — which is
    // correct, and is only reachable because the fetcher verified the
    // empty result against the site's own 「共 0 条记录」.
    const { db, calls } = recordingDb();
    const result = await replaceTrialRecords(db, 'chinadrugtrials', [], new Date());

    expect(result).toEqual({ upserted: 0, deleted: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual(['chinadrugtrials', []]);
  });

  it('refuses a record filed under another source', async () => {
    const { db, calls } = recordingDb();

    await expect(
      replaceTrialRecords(db, 'chinadrugtrials', [record({ source: 'ctgov' })], new Date()),
    ).rejects.toThrow('chinadrugtrials fetcher produced a record marked ctgov (NCT00000001)');
    // Nothing was sent: the check runs before the DELETE, so a
    // mislabelled batch cannot empty the source it was aimed at.
    expect(calls).toHaveLength(0);
  });
});
