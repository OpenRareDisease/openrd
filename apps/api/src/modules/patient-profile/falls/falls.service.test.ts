import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { FallsService, MAX_FALL_ROWS } from './falls.service.js';
import type { AppLogger } from '../../../config/logger.js';
import { AppError } from '../../../utils/app-error.js';

const logger = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as AppLogger;

interface FakeOptions {
  profileRows?: Array<{ id: string }>;
  eventRows?: Array<{ id: string }>;
  fallUpdateRows?: Array<{ origin_event_id: string | null }>;
  historyRows?: unknown[];
  diaryRows?: unknown[];
  failOn?: RegExp;
}

/**
 * A SQL-routing fake, matched on a distinctive fragment rather than on
 * call order — same reasoning as instruments.service.test.ts. Adding a
 * statement to the service must not silently shift every assertion in
 * this file onto the wrong query.
 */
const fakePool = (options: FakeOptions = {}) => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const released = { count: 0 };

  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (options.failOn && options.failOn.test(sql)) throw new Error('boom');
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
    if (/SELECT id FROM patient_profiles/.test(sql)) {
      const rows = options.profileRows ?? [{ id: 'profile-1' }];
      return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO patient_followup_events/.test(sql)) {
      const rows = options.eventRows ?? [{ id: 'event-1' }];
      return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO patient_falls/.test(sql)) {
      return {
        rows: [
          {
            id: 'fall-1',
            occurred_on: values[1],
            fall_day_age: 2,
            activity: values[2],
            location: values[3],
            hands_full: values[4],
            got_up_unaided: values[5],
            injured: values[6],
            created_at: new Date('2026-08-05T02:00:00.000Z'),
          },
        ],
        rowCount: 1,
      };
    }
    if (/UPDATE patient_falls/.test(sql)) {
      const rows = options.fallUpdateRows ?? [{ origin_event_id: 'event-1' }];
      return { rows, rowCount: rows.length };
    }
    if (/UPDATE patient_followup_events/.test(sql)) return { rows: [], rowCount: 1 };
    if (/FROM \(/.test(sql)) {
      const rows = options.historyRows ?? [];
      return { rows, rowCount: rows.length };
    }
    if (/to_char\(pf\.occurred_on/.test(sql)) {
      const rows = options.diaryRows ?? [];
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  });

  const client = {
    query,
    release: () => {
      released.count += 1;
    },
  } as unknown as PoolClient;

  const pool = {
    connect: vi.fn(async () => client),
    query,
  } as unknown as Pool;

  return { pool, calls, query, released };
};

const sqlMatching = (calls: Array<{ sql: string; values: unknown[] }>, pattern: RegExp) =>
  calls.filter((call) => pattern.test(call.sql));

describe('FallsService.recordFall', () => {
  it('saves a fall that carries nothing but a date', async () => {
    // The one-tap case this table was shaped around: a patient
    // recording a fall an hour later, one-handed, must be able to save
    // before answering anything else.
    const { pool, calls } = fakePool();
    const fall = await new FallsService({ pool, logger }).recordFall('user-1', {
      occurredOn: '2026-08-03',
    });

    expect(fall.id).toBe('fall-1');
    expect(fall.occurredOn).toBe('2026-08-03');
    expect(fall.activity).toBeNull();
    expect(fall.location).toBeNull();
    expect(fall.handsFull).toBeNull();
    expect(fall.gotUpUnaided).toBeNull();
    expect(fall.injured).toBeNull();

    const insert = sqlMatching(calls, /INSERT INTO patient_falls/)[0];
    expect(insert.values.slice(2, 7)).toEqual([null, null, null, null, null]);
  });

  it('writes the followup event twin in the same transaction', async () => {
    // Without the twin, falls disappear from the 病程时间线 that has
    // been showing them. Nothing this release ships removes a surface.
    const { pool, calls } = fakePool();
    await new FallsService({ pool, logger }).recordFall('user-1', {
      occurredOn: '2026-08-03',
      activity: 'stairs',
      location: 'indoor',
      handsFull: true,
      gotUpUnaided: false,
      injured: true,
    });

    const order = calls.map((call) => call.sql.trim().split(/\s+/).slice(0, 3).join(' '));
    expect(order[0]).toMatch(/^BEGIN/);
    expect(order.at(-1)).toMatch(/^COMMIT/);

    const event = sqlMatching(calls, /INSERT INTO patient_followup_events/)[0];
    expect(event.sql).toContain("'fall'");
    // Noon, not midnight: `occurred_at` is a TIMESTAMPTZ and the diary
    // only knows the day, so the invented time has to be the one that
    // still reads back as the same calendar date from any timezone.
    expect(event.sql).toContain("INTERVAL '12 hours'");

    const insert = sqlMatching(calls, /INSERT INTO patient_falls/)[0];
    // The diary row names the event, so the two are one fall rather
    // than two.
    expect(insert.values[7]).toBe('event-1');
    expect(insert.values.slice(2, 7)).toEqual(['stairs', 'indoor', true, false, true]);
  });

  it('never writes free text onto the event', async () => {
    // The whole point of migration 023 is that the interesting half of
    // a fall stopped living in a box the AI retriever must refuse.
    // Composing a sentence to fill it here would put words in the
    // patient's record that the patient did not write.
    const { pool, calls } = fakePool();
    await new FallsService({ pool, logger }).recordFall('user-1', { occurredOn: '2026-08-03' });
    const event = sqlMatching(calls, /INSERT INTO patient_followup_events/)[0];
    expect(event.sql).not.toContain('description');
    expect(event.values).toHaveLength(2);
  });

  it('rolls back and releases when the diary insert fails', async () => {
    // A committed event with no diary row is the state the down
    // migration warns is unrecoverable, in reverse: a fall on the
    // timeline that the diary and the counts never see.
    const { pool, calls, released } = fakePool({ failOn: /INSERT INTO patient_falls/ });
    await expect(
      new FallsService({ pool, logger }).recordFall('user-1', { occurredOn: '2026-08-03' }),
    ).rejects.toThrow('boom');
    expect(sqlMatching(calls, /^\s*ROLLBACK/)).toHaveLength(1);
    expect(sqlMatching(calls, /^\s*COMMIT/)).toHaveLength(0);
    expect(released.count).toBe(1);
  });

  it('refuses to write a diary row when the event INSERT returns no id', async () => {
    // The guard this pins is unreachable from any live input — a
    // successful single-row `INSERT ... RETURNING` always yields a row,
    // and a failing one throws (covered above). It is here for the
    // refactor that replaces `rows[0]?.id ?? null` with a non-null
    // assertion, or drops the check: that ships a fall with
    // origin_event_id = null, which the down migration calls
    // unrecoverable, and which makes deleteFall leave the event
    // standing on the 病程时间线 after the patient watches the entry
    // disappear.
    const { pool, calls, released } = fakePool({ eventRows: [] });
    await expect(
      new FallsService({ pool, logger }).recordFall('user-1', { occurredOn: '2026-08-03' }),
    ).rejects.toMatchObject({ statusCode: 500 });

    expect(sqlMatching(calls, /INSERT INTO patient_falls/)).toHaveLength(0);
    expect(sqlMatching(calls, /^\s*ROLLBACK/)).toHaveLength(1);
    expect(sqlMatching(calls, /^\s*COMMIT/)).toHaveLength(0);
    expect(released.count).toBe(1);
  });

  it('404s a user with no profile instead of inventing one', async () => {
    const { pool, released } = fakePool({ profileRows: [] });
    await expect(
      new FallsService({ pool, logger }).recordFall('user-1', { occurredOn: '2026-08-03' }),
    ).rejects.toBeInstanceOf(AppError);
    expect(released.count).toBe(1);
  });
});

describe('FallsService.deleteFall', () => {
  it('retracts the timeline twin along with the diary entry', async () => {
    // Otherwise the patient taps 删除, watches the entry disappear, and
    // is still told they fell that week — the event survives and the
    // un-mirrored branch of FALL_HISTORY_SQL counts it again.
    const { pool, calls } = fakePool();
    await new FallsService({ pool, logger }).deleteFall('user-1', 'fall-1');

    const fallUpdate = sqlMatching(calls, /UPDATE patient_falls/)[0];
    expect(fallUpdate.sql).toContain('deleted_at = NOW()');
    expect(fallUpdate.sql).toContain('pp.user_id = $1');
    expect(fallUpdate.values).toEqual(['user-1', 'fall-1']);

    const eventUpdate = sqlMatching(calls, /UPDATE patient_followup_events/)[0];
    expect(eventUpdate.values).toEqual(['event-1']);
    expect(sqlMatching(calls, /^\s*COMMIT/)).toHaveLength(1);
  });

  it('skips the event update for a diary entry that never had a twin', async () => {
    const { pool, calls } = fakePool({ fallUpdateRows: [{ origin_event_id: null }] });
    await new FallsService({ pool, logger }).deleteFall('user-1', 'fall-1');
    expect(sqlMatching(calls, /UPDATE patient_followup_events/)).toHaveLength(0);
    expect(sqlMatching(calls, /^\s*COMMIT/)).toHaveLength(1);
  });

  it('404s another user’s row without saying whether it exists', async () => {
    const { pool, calls, released } = fakePool({ fallUpdateRows: [] });
    await expect(
      new FallsService({ pool, logger }).deleteFall('user-1', 'fall-1'),
    ).rejects.toBeInstanceOf(AppError);
    expect(sqlMatching(calls, /^\s*ROLLBACK/)).toHaveLength(1);
    expect(released.count).toBe(1);
  });
});

describe('FallsService reads', () => {
  it('scopes every read to the calling user and bounds every row set', async () => {
    const { pool, calls } = fakePool();
    await new FallsService({ pool, logger }).listFalls('user-1');
    for (const call of calls) {
      expect(call.sql).toContain('pp.user_id = $1');
      expect(call.values[0]).toBe('user-1');
      expect(call.sql).toContain(`LIMIT ${MAX_FALL_ROWS}`);
    }
  });

  it('summarises the full history, not just the entries it can list', async () => {
    // A fall logged through the old POST /me/followup-events route has
    // no diary entry. Summarising only the list would show a patient
    // 「1 次」 for a period they recorded three falls in.
    const { pool } = fakePool({
      diaryRows: [
        {
          id: 'fall-1',
          occurred_on: '2026-08-01',
          fall_day_age: 4,
          activity: 'stairs',
          location: 'indoor',
          hands_full: null,
          got_up_unaided: null,
          injured: null,
          created_at: new Date('2026-08-01T04:00:00.000Z'),
        },
      ],
      historyRows: [
        { event_type: 'fall', severity: null, occurred_at: '2026-08-01', fall_day_age: 4 },
        { event_type: 'fall', severity: 'mild', occurred_at: '2026-06-01', fall_day_age: 65 },
        { event_type: 'fall', severity: null, occurred_at: '2026-03-01', fall_day_age: 157 },
      ],
    });
    const result = await new FallsService({ pool, logger }).listFalls('user-1');

    expect(result.falls).toHaveLength(1);
    expect(result.summary.total).toBe(3);
    expect(result.summary.quarters.map((q) => q.count)).toEqual([2, 1]);
    expect(result.windowDays).toBe(180);
  });

  it('clamps a window it was handed rather than interpolating it', async () => {
    const { pool, calls } = fakePool();
    await new FallsService({ pool, logger }).getFallsSummary('user-1', 99999);
    expect(calls[0].values[1]).toBe('730');

    const nan = fakePool();
    await new FallsService({ pool: nan.pool, logger }).getFallsSummary('user-1', Number.NaN);
    // `NaN days` is a Postgres error, not an answer.
    expect(nan.calls[0].values[1]).toBe('180');
  });

  it('flags a capped read so the quarterly comparison is suppressed', async () => {
    const historyRows = Array.from({ length: MAX_FALL_ROWS }, (_, i) => ({
      event_type: 'fall',
      severity: null,
      occurred_at: '2026-08-01',
      fall_day_age: i,
    }));
    const { pool } = fakePool({ historyRows });
    const summary = await new FallsService({ pool, logger }).getFallsSummary('user-1', 730);
    expect(summary.atCap).toBe(true);
  });
});
