import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { BROOKE_ITEM_CODE } from './brooke.js';
import { InstrumentsService } from './instruments.service.js';
import { VIGNOS_ITEM_CODE } from './vignos.js';
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
  priorAdministration?: Array<{ instrument_key: string; already_superseded: boolean }>;
  baselineState?: string | null;
  failOn?: RegExp;
}

/**
 * A SQL-routing fake client. Statements are matched on a distinctive
 * fragment rather than on call order, so adding a statement to the
 * service does not silently shift every assertion in this file onto
 * the wrong query.
 */
const fakePool = (options: FakeOptions = {}) => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const released = { count: 0 };

  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });

    if (options.failOn && options.failOn.test(sql)) {
      throw new Error('boom');
    }

    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/SELECT id FROM patient_profiles/.test(sql)) {
      const rows = options.profileRows ?? [{ id: 'profile-1' }];
      return { rows, rowCount: rows.length };
    }
    if (/EXISTS \(\s*SELECT 1 FROM instrument_administrations s WHERE s\.supersedes_id/.test(sql)) {
      const rows = options.priorAdministration ?? [];
      return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO instrument_administrations/.test(sql)) {
      return {
        rows: [
          {
            id: 'admin-1',
            administered_at: new Date('2026-08-01T02:00:00.000Z'),
            created_at: new Date('2026-08-01T02:00:01.000Z'),
          },
        ],
        rowCount: 1,
      };
    }
    if (/INSERT INTO instrument_item_responses/.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/AS state/.test(sql)) {
      return { rows: [{ state: options.baselineState ?? null }], rowCount: 1 };
    }
    if (/UPDATE patient_profiles/.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO patient_followup_events/.test(sql)) {
      return { rows: [], rowCount: 1 };
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

const vignosBody = (grade: number, extra: Record<string, unknown> = {}) => ({
  instrumentKey: 'vignos_lower_extremity',
  responses: [{ itemCode: VIGNOS_ITEM_CODE, responseValue: grade }],
  ...extra,
});

describe('InstrumentsService.listCatalogue', () => {
  it('serves the anchors, the citation and the limitations together', () => {
    const { pool } = fakePool();
    const service = new InstrumentsService({ pool, logger });
    const catalogue = service.listCatalogue();

    expect(catalogue.map((entry) => entry.key).sort()).toEqual([
      'brooke_upper_extremity',
      'vignos_lower_extremity',
    ]);
    for (const entry of catalogue) {
      // A screen must not be able to render the scale without its
      // caveats: they arrive in the same payload as the anchors.
      expect(entry.limitationsZh.length).toBeGreaterThan(0);
      expect(entry.sourceCitation.length).toBeGreaterThan(0);
      expect(entry.items[0].levels.length).toBeGreaterThan(0);
    }
  });

  it('touches no database at all', async () => {
    const { pool, query } = fakePool();
    new InstrumentsService({ pool, logger }).listCatalogue();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('InstrumentsService.recordAdministration', () => {
  it('stores the score, the scoring method and every item response', async () => {
    const { pool, calls } = fakePool();
    const service = new InstrumentsService({ pool, logger });

    const result = await service.recordAdministration('user-1', vignosBody(4));

    expect(result.administration.scoredValue).toBe(4);
    expect(result.administration.scoringMethod).toBe('vignos_v1_single_grade');
    expect(result.administration.instrumentVersion).toBe('v1');
    expect(result.administration.completeness).toBe(1);
    // The patient sees the anchor they picked, not a bare number.
    expect(result.administration.levelLabelZh).toContain('上不了楼梯');

    const insert = sqlMatching(calls, /INSERT INTO instrument_administrations/)[0];
    expect(insert.values).toContain('vignos_lower_extremity');
    expect(insert.values).toContain('vignos_v1_single_grade');
    expect(sqlMatching(calls, /INSERT INTO instrument_item_responses/)).toHaveLength(1);
    expect(sqlMatching(calls, /^\s*COMMIT/)).toHaveLength(1);
  });

  it('defaults source to self and assistedBy to none', async () => {
    const { pool, calls } = fakePool();
    const service = new InstrumentsService({ pool, logger });
    await service.recordAdministration('user-1', vignosBody(2));

    const insert = sqlMatching(calls, /INSERT INTO instrument_administrations/)[0];
    expect(insert.values).toContain('self');
    expect(insert.values).toContain('none');
  });

  it('stamps the item version from the definition, never from the request', async () => {
    const { pool, calls } = fakePool();
    const service = new InstrumentsService({ pool, logger });
    await service.recordAdministration('user-1', vignosBody(2));

    const insert = sqlMatching(calls, /INSERT INTO instrument_item_responses/)[0];
    expect(insert.values[1]).toBe(VIGNOS_ITEM_CODE);
    expect(insert.values[2]).toBe('v1');
  });

  it('refuses an unscorable body as a 400 without opening a transaction', async () => {
    const { pool, query } = fakePool();
    const service = new InstrumentsService({ pool, logger });

    await expect(service.recordAdministration('user-1', vignosBody(99))).rejects.toMatchObject({
      statusCode: 400,
    });
    // Nothing was written, and nothing needs rolling back.
    expect(query).not.toHaveBeenCalled();
  });

  it('404s a user with no profile and rolls back', async () => {
    const { pool, calls } = fakePool({ profileRows: [] });
    const service = new InstrumentsService({ pool, logger });

    await expect(service.recordAdministration('user-1', vignosBody(3))).rejects.toBeInstanceOf(
      AppError,
    );
    expect(sqlMatching(calls, /^\s*ROLLBACK/)).toHaveLength(1);
    expect(sqlMatching(calls, /^\s*COMMIT/)).toHaveLength(0);
  });

  it('rolls back and releases the client when a write fails mid-transaction', async () => {
    const { pool, calls, released } = fakePool({ failOn: /INSERT INTO instrument_item_responses/ });
    const service = new InstrumentsService({ pool, logger });

    await expect(service.recordAdministration('user-1', vignosBody(3))).rejects.toThrow('boom');
    expect(sqlMatching(calls, /^\s*ROLLBACK/)).toHaveLength(1);
    expect(released.count).toBe(1);
  });
});

describe('InstrumentsService.recordAdministration — corrections', () => {
  const correction = (extra: Record<string, unknown>) =>
    vignosBody(5, { supersedesId: '00000000-0000-4000-8000-000000000001', ...extra });

  it('404s a supersedesId that is not this patient’s', async () => {
    const { pool } = fakePool({ priorAdministration: [] });
    const service = new InstrumentsService({ pool, logger });

    await expect(service.recordAdministration('user-1', correction({}))).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('400s a correction that points at another instrument', async () => {
    const { pool } = fakePool({
      priorAdministration: [
        { instrument_key: 'brooke_upper_extremity', already_superseded: false },
      ],
    });
    const service = new InstrumentsService({ pool, logger });

    await expect(service.recordAdministration('user-1', correction({}))).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('409s a second correction of the same row so the chain stays linear', async () => {
    const { pool } = fakePool({
      priorAdministration: [{ instrument_key: 'vignos_lower_extremity', already_superseded: true }],
    });
    const service = new InstrumentsService({ pool, logger });

    await expect(service.recordAdministration('user-1', correction({}))).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('writes a new row rather than updating the old one', async () => {
    const { pool, calls } = fakePool({
      priorAdministration: [
        { instrument_key: 'vignos_lower_extremity', already_superseded: false },
      ],
    });
    const service = new InstrumentsService({ pool, logger });

    const result = await service.recordAdministration('user-1', correction({}));

    expect(result.administration.supersedesId).toBe('00000000-0000-4000-8000-000000000001');
    // The immutability decision, at the level this test can see it:
    // the service has no UPDATE path on instrument_administrations at
    // all. Migration 022's trigger is the enforcement.
    expect(sqlMatching(calls, /UPDATE instrument_administrations/)).toHaveLength(0);
  });
});

describe('InstrumentsService — Vignos to baseline wiring', () => {
  it('does nothing unless the patient asked for it', async () => {
    const { pool, calls } = fakePool({ baselineState: 'independent' });
    const service = new InstrumentsService({ pool, logger });

    const result = await service.recordAdministration('user-1', vignosBody(9));

    expect(result.baselineSync).toBeNull();
    expect(sqlMatching(calls, /UPDATE patient_profiles/)).toHaveLength(0);
    expect(sqlMatching(calls, /INSERT INTO patient_followup_events/)).toHaveLength(0);
  });

  it('writes the ambulation state the anchor states outright', async () => {
    const { pool, calls } = fakePool({ baselineState: 'independent' });
    const service = new InstrumentsService({ pool, logger });

    const result = await service.recordAdministration(
      'user-1',
      vignosBody(6, { applyToBaseline: true }),
    );

    expect(result.baselineSync).toEqual({
      ambulationState: 'assisted',
      baselineUpdated: true,
      followupEventType: null,
    });
    expect(sqlMatching(calls, /UPDATE patient_profiles/)[0].values).toContain('assisted');
    // Grade 6 says nothing about a wheelchair.
    expect(sqlMatching(calls, /INSERT INTO patient_followup_events/)).toHaveLength(0);
  });

  it('logs started_wheelchair for grade 9, dated at the administration and saying so', async () => {
    const { pool, calls } = fakePool({ baselineState: 'assisted' });
    const service = new InstrumentsService({ pool, logger });

    const result = await service.recordAdministration(
      'user-1',
      vignosBody(9, { applyToBaseline: true, administeredAt: '2026-07-30T01:00:00.000Z' }),
    );

    expect(result.baselineSync).toEqual({
      ambulationState: 'unable',
      baselineUpdated: true,
      followupEventType: 'started_wheelchair',
    });

    const event = sqlMatching(calls, /INSERT INTO patient_followup_events/)[0];
    expect(event.sql).toContain('started_wheelchair');
    expect(event.values[1]).toBe('2026-07-30T01:00:00.000Z');
    // The app does not know when the wheelchair started. The row says
    // so, rather than letting a clinician read the date as onset.
    expect(String(event.values[2])).toContain('不代表开始使用轮椅的实际时间');
  });

  it.each([8, 10])(
    'moves the state to unable for grade %i but claims no wheelchair',
    async (grade) => {
      const { pool, calls } = fakePool({ baselineState: 'assisted' });
      const service = new InstrumentsService({ pool, logger });

      const result = await service.recordAdministration(
        'user-1',
        vignosBody(grade, { applyToBaseline: true }),
      );

      expect(result.baselineSync?.ambulationState).toBe('unable');
      expect(result.baselineSync?.followupEventType).toBeNull();
      expect(sqlMatching(calls, /INSERT INTO patient_followup_events/)).toHaveLength(0);
    },
  );

  it('does not re-log started_wheelchair for a patient already recorded as unable', async () => {
    const { pool, calls } = fakePool({ baselineState: 'unable' });
    const service = new InstrumentsService({ pool, logger });

    const result = await service.recordAdministration(
      'user-1',
      vignosBody(9, { applyToBaseline: true }),
    );

    expect(result.baselineSync).toEqual({
      ambulationState: 'unable',
      baselineUpdated: false,
      followupEventType: null,
    });
    expect(sqlMatching(calls, /UPDATE patient_profiles/)).toHaveLength(0);
    expect(sqlMatching(calls, /INSERT INTO patient_followup_events/)).toHaveLength(0);
  });

  it('ignores applyToBaseline for Brooke — an arm grade says nothing about walking', async () => {
    const { pool, calls } = fakePool({ baselineState: 'independent' });
    const service = new InstrumentsService({ pool, logger });

    const result = await service.recordAdministration('user-1', {
      instrumentKey: 'brooke_upper_extremity',
      responses: [{ itemCode: BROOKE_ITEM_CODE, responseValue: 5 }],
      applyToBaseline: true,
    });

    expect(result.baselineSync).toBeNull();
    expect(sqlMatching(calls, /UPDATE patient_profiles/)).toHaveLength(0);
  });
});

describe('InstrumentsService.listAdministrations', () => {
  const listPool = (
    rows: Array<Record<string, unknown>>,
    responseRows: Array<Record<string, unknown>> = [],
  ) => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (/FROM instrument_item_responses/.test(sql)) {
        return { rows: responseRows, rowCount: responseRows.length };
      }
      return { rows, rowCount: rows.length };
    });
    return { pool: { query, connect: vi.fn() } as unknown as Pool, calls };
  };

  const storedRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'admin-1',
    instrument_key: 'vignos_lower_extremity',
    instrument_version: 'v1',
    raw_score: '4.000',
    scored_value: '4.000',
    scoring_method: 'vignos_v1_single_grade',
    completeness: '1.000',
    assisted_by: 'none',
    source: 'self',
    supersedes_id: null,
    superseded_by_id: null,
    administered_at: new Date('2026-07-01T00:00:00.000Z'),
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  });

  it('converts NUMERIC strings from pg back into numbers', async () => {
    // node-pg returns NUMERIC as a string to protect precision. Left
    // alone, a grade renders as "4.000" and compares as a string.
    const { pool } = listPool([storedRow()]);
    const service = new InstrumentsService({ pool, logger });
    const [administration] = await service.listAdministrations('user-1', {});

    expect(administration.scoredValue).toBe(4);
    expect(administration.rawScore).toBe(4);
    expect(administration.completeness).toBe(1);
  });

  it('resolves the anchor from the version the row was answered against', async () => {
    const { pool } = listPool([storedRow()]);
    const service = new InstrumentsService({ pool, logger });
    const [administration] = await service.listAdministrations('user-1', {});
    expect(administration.levelLabelZh).toContain('上不了楼梯');
  });

  it('returns a null label for a version this build does not know', async () => {
    // A row written by a newer deploy, read after a rollback. An
    // unknown anchor is unknown; captioning it with the current
    // wording would put words in the patient's mouth.
    const { pool } = listPool([storedRow({ instrument_version: 'v9' })]);
    const service = new InstrumentsService({ pool, logger });
    const [administration] = await service.listAdministrations('user-1', {});
    expect(administration.levelLabelZh).toBeNull();
    expect(administration.instrumentNameZh).toBeNull();
  });

  it('excludes superseded rows by default and includes them on request', async () => {
    const { pool, calls } = listPool([storedRow()]);
    const service = new InstrumentsService({ pool, logger });

    await service.listAdministrations('user-1', {});
    expect(calls[0].values[2]).toBe(false);

    await service.listAdministrations('user-1', { includeSuperseded: true });
    expect(calls[2].values[2]).toBe(true);
  });

  it('scopes every read to the calling user', async () => {
    const { pool, calls } = listPool([storedRow()]);
    const service = new InstrumentsService({ pool, logger });
    await service.listAdministrations('user-1', {});
    expect(calls[0].sql).toContain('p.user_id = $1');
    expect(calls[0].values[0]).toBe('user-1');
  });

  it('skips the response fetch entirely when there are no administrations', async () => {
    const { pool, calls } = listPool([]);
    const service = new InstrumentsService({ pool, logger });
    expect(await service.listAdministrations('user-1', {})).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('attaches item responses to their administration', async () => {
    const { pool } = listPool(
      [storedRow()],
      [
        {
          administration_id: 'admin-1',
          item_code: VIGNOS_ITEM_CODE,
          item_version: 'v1',
          response_value: '4.000',
          skipped: false,
          not_applicable: false,
        },
      ],
    );
    const service = new InstrumentsService({ pool, logger });
    const [administration] = await service.listAdministrations('user-1', {});
    expect(administration.responses).toEqual([
      {
        itemCode: VIGNOS_ITEM_CODE,
        itemVersion: 'v1',
        responseValue: 4,
        skipped: false,
        notApplicable: false,
      },
    ]);
  });
});

describe('InstrumentsService.getSummary', () => {
  const summaryPool = (rows: Array<Record<string, unknown>>) => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (/FROM instrument_item_responses/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows, rowCount: rows.length };
    });
    return { pool: { query, connect: vi.fn() } as unknown as Pool, calls };
  };

  const row = (key: string, score: string, day: string) => ({
    id: key + day,
    instrument_key: key,
    instrument_version: 'v1',
    raw_score: score,
    scored_value: score,
    scoring_method:
      key === 'vignos_lower_extremity' ? 'vignos_v1_single_grade' : 'brooke_v1_single_grade',
    completeness: '1',
    assisted_by: 'none',
    source: 'self',
    supersedes_id: null,
    superseded_by_id: null,
    administered_at: new Date(day),
    created_at: new Date(day),
  });

  it('returns one row per instrument, each labelled, not one flattened number', async () => {
    // Upper- and lower-limb function diverge in FSHD; one scale can
    // sit at its floor for years while the other moves.
    const { pool } = summaryPool([
      row('vignos_lower_extremity', '4', '2026-07-03T00:00:00.000Z'),
      row('brooke_upper_extremity', '3', '2026-07-02T00:00:00.000Z'),
    ]);
    const service = new InstrumentsService({ pool, logger });

    const summary = await service.getSummary('user-1');
    expect(summary.map((entry) => [entry.instrumentKey, entry.scoredValue])).toEqual([
      ['vignos_lower_extremity', 4],
      ['brooke_upper_extremity', 3],
    ]);
    expect(summary.every((entry) => entry.instrumentNameZh !== null)).toBe(true);
  });

  it('asks the database for the newest per instrument rather than paging and de-duplicating', async () => {
    // The bug this pins: a de-duplicate-in-JS version fetched a fixed
    // window of recent rows, so a patient who records one scale far
    // more often than the other pushed the other's latest score past
    // the window and the tile silently went blank for the instrument
    // they had been neglecting.
    const { pool, calls } = summaryPool([]);
    const service = new InstrumentsService({ pool, logger });
    await service.getSummary('user-1');

    expect(calls[0].sql).toContain('DISTINCT ON (a.instrument_key)');
    expect(calls[0].sql).not.toMatch(/LIMIT/);
    // Superseded rows are corrections; the tile must show the correction.
    expect(calls[0].sql).toContain('s.supersedes_id = a.id');
    expect(calls[0].values).toEqual(['user-1']);
  });

  it('is empty, not an error, for a patient who has not taken any', async () => {
    const { pool, calls } = summaryPool([]);
    const service = new InstrumentsService({ pool, logger });
    expect(await service.getSummary('user-1')).toEqual([]);
    // and does not go looking for item responses of nothing.
    expect(calls).toHaveLength(1);
  });
});
