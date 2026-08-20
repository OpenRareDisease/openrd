import { describe, expect, it, vi } from 'vitest';

import { PatientProfileService } from './profile.service.js';

/**
 * THE READS THE PORTABILITY EXPORT WAS MISSING.
 *
 * `getProfileByUserId` loads eight patient_* tables, and `GET
 * /me/data-export` used to be exactly that plus consent, submissions
 * and the AI audit trail. Two whole categories of the patient's own
 * clinical record were in neither: `patient_falls` (the diary — every
 * fall they recorded, and what they answered about it) and
 * `instrument_administrations` / `instrument_item_responses` (Brooke
 * and Vignos, the scales this product administers to them). Both live
 * outside PatientProfileService on purpose, and the export never went
 * and got them.
 *
 * These pin the four export-shaped readers added to close that. What
 * they are actually guarding is the difference between an export read
 * and a SCREEN read, because the screens are where these queries came
 * from and every one of their bounds is wrong for a file the patient
 * keeps:
 *
 *   - the diary screen asks 「最近」 and caps at 730 days; a portability
 *     file has no horizon,
 *   - the instrument list hides superseded rows so a trend line does
 *     not show a cliff that never happened; an export that hides them
 *     deletes the patient's own corrections,
 *   - both of legal.service.ts's readers ask 「is this consent in force」
 *     and drop withdrawn rows; 授权历史 is the one place a withdrawal
 *     has to appear.
 */

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
};

interface Call {
  sql: string;
  params: unknown[];
}

const makePool = (handler: (sql: string, params: unknown[]) => { rows: unknown[] }) => {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const result = handler(sql, params);
    return { rowCount: result.rows.length, rows: result.rows };
  });
  return { pool: { query, connect: vi.fn() } as never, calls };
};

const serviceFor = (pool: never) =>
  new PatientProfileService({ pool, logger: silentLogger as never });

const fallRow = (id: string, occurredOn: string) => ({
  id,
  occurred_on: occurredOn,
  fall_day_age: 900,
  activity: 'walking',
  location: 'indoor',
  hands_full: false,
  got_up_unaided: false,
  injured: true,
  created_at: new Date('2024-03-02T04:00:00Z'),
});

describe('listFallDiaryForExport', () => {
  it('reads the diary with no practical window, so an old fall still travels', async () => {
    const { pool, calls } = makePool(() => ({ rows: [fallRow('fall-1', '2019-05-04')] }));
    const result = await serviceFor(pool).listFallDiaryForExport('user-1', 3000);

    expect(result.falls).toEqual([
      {
        id: 'fall-1',
        occurredOn: '2019-05-04',
        daysAgo: 900,
        activity: 'walking',
        location: 'indoor',
        handsFull: false,
        gotUpUnaided: false,
        injured: true,
        createdAt: '2024-03-02T04:00:00.000Z',
      },
    ]);
    expect(result.truncated).toBe(false);

    // The window parameter has to be wide enough that no storable date
    // is outside it. 730 — the diary screen's own ceiling, and the
    // number a copy-paste from falls.service.ts would produce — would
    // silently drop the fall above.
    const windowDays = Number(calls[0].params[1]);
    expect(windowDays).toBeGreaterThan(100 * 365);
  });

  it('carries the retraction rule rather than re-deriving it', async () => {
    const { pool, calls } = makePool(() => ({ rows: [] }));
    await serviceFor(pool).listFallDiaryForExport('user-1', 3000);

    // FALL_DIARY_SQL, not a hand-rolled SELECT: a diary row whose
    // timeline twin was deleted is NOT live, and a second copy of that
    // predicate is how the export hands back falls the patient thinks
    // they retracted.
    expect(calls[0].sql).toContain('patient_falls');
    expect(calls[0].sql).toContain('deleted_at IS NULL');
    expect(calls[0].sql).toContain('origin_event_id');
  });

  it('flags truncation instead of presenting a cut list as the whole diary', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => fallRow(`fall-${i}`, '2026-01-01'));
    const { pool } = makePool(() => ({ rows }));
    const result = await serviceFor(pool).listFallDiaryForExport('user-1', 3);

    expect(result.falls).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('does not flag truncation when the last row exactly fills the cap', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => fallRow(`fall-${i}`, '2026-01-01'));
    const { pool } = makePool(() => ({ rows }));
    const result = await serviceFor(pool).listFallDiaryForExport('user-1', 3);

    expect(result.falls).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it('resolves an out-of-enum activity to null rather than shipping it raw', async () => {
    const { pool } = makePool(() => ({
      rows: [{ ...fallRow('fall-1', '2026-01-01'), activity: 'skydiving', location: 'moon' }],
    }));
    const result = await serviceFor(pool).listFallDiaryForExport('user-1', 3000);

    expect(result.falls[0].activity).toBeNull();
    expect(result.falls[0].location).toBeNull();
  });
});

const administrationRow = (id: string) => ({
  id,
  instrument_key: 'brooke_upper_extremity',
  instrument_version: '1.0.0',
  raw_score: '3',
  scored_value: '3',
  scoring_method: 'single_item_v1',
  completeness: '1',
  assisted_by: 'none',
  source: 'self',
  supersedes_id: null,
  superseded_by_id: null,
  administered_at: new Date('2026-05-01T00:00:00Z'),
  created_at: new Date('2026-05-01T00:00:00Z'),
});

describe('listInstrumentAdministrationsForExport', () => {
  it('includes superseded rows — a correction history is the record', async () => {
    const { pool, calls } = makePool((sql) =>
      sql.includes('instrument_item_responses')
        ? { rows: [] }
        : { rows: [administrationRow('adm-1')] },
    );
    const result = await serviceFor(pool).listInstrumentAdministrationsForExport('user-1', 2000);

    expect(result.administrations).toHaveLength(1);
    expect(result.administrations[0].instrumentKey).toBe('brooke_upper_extremity');
    // $3 is `includeSuperseded` on listAdministrations' query. `false`
    // is the screen's default and would drop every row the patient
    // corrected — their own mistake AND the fix for it.
    expect(calls[0].params[2]).toBe(true);
  });

  it('pages until a short page rather than stopping at the first', async () => {
    let page = 0;
    const { pool } = makePool((sql) => {
      if (sql.includes('instrument_item_responses')) return { rows: [] };
      page += 1;
      return page === 1
        ? { rows: Array.from({ length: 200 }, (_, i) => administrationRow(`adm-${i}`)) }
        : { rows: [administrationRow('adm-last')] };
    });
    const result = await serviceFor(pool).listInstrumentAdministrationsForExport('user-1', 2000);

    expect(result.administrations).toHaveLength(201);
    expect(result.truncated).toBe(false);
  });

  it('flags truncation when the cap is what stopped the loop', async () => {
    const { pool } = makePool((sql) =>
      sql.includes('instrument_item_responses')
        ? { rows: [] }
        : { rows: Array.from({ length: 200 }, (_, i) => administrationRow(`adm-${i}`)) },
    );
    const result = await serviceFor(pool).listInstrumentAdministrationsForExport('user-1', 200);

    expect(result.administrations).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });

  it('returns an empty list for a patient who has taken no scale', async () => {
    const { pool } = makePool(() => ({ rows: [] }));
    const result = await serviceFor(pool).listInstrumentAdministrationsForExport('user-1', 2000);

    expect(result.administrations).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe('listLegalAcceptancesForExport', () => {
  it('carries withdrawn acceptances — taking consent back is授权历史 too', async () => {
    const { pool, calls } = makePool(() => ({
      rows: [
        {
          document: 'privacy_policy',
          version: '2026-08-02',
          accepted_at: new Date('2026-08-02T01:00:00Z'),
          withdrawn_at: new Date('2026-08-10T02:00:00Z'),
        },
        {
          document: 'user_agreement',
          version: '2026-08-02',
          accepted_at: new Date('2026-08-02T01:00:00Z'),
          withdrawn_at: null,
        },
      ],
    }));
    const result = await serviceFor(pool).listLegalAcceptancesForExport('user-1');

    expect(result.acceptances).toEqual([
      {
        document: 'privacy_policy',
        version: '2026-08-02',
        acceptedAt: '2026-08-02T01:00:00.000Z',
        withdrawnAt: '2026-08-10T02:00:00.000Z',
      },
      {
        document: 'user_agreement',
        version: '2026-08-02',
        acceptedAt: '2026-08-02T01:00:00.000Z',
        withdrawnAt: null,
      },
    ]);
    // Neither `DISTINCT ON` nor `withdrawn_at IS NULL`: both belong to
    // legal.service.ts's 「is this in force」 readers and both would
    // turn a history into a snapshot.
    expect(calls[0].sql).not.toContain('DISTINCT ON');
    expect(calls[0].sql).not.toContain('withdrawn_at IS NULL');
  });

  it('returns an empty list rather than throwing for an account with none', async () => {
    const { pool } = makePool(() => ({ rows: [] }));
    const result = await serviceFor(pool).listLegalAcceptancesForExport('user-1');

    expect(result.acceptances).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe('listPassportSharesForExport', () => {
  it('carries every door, revoked ones included, and no token', async () => {
    const { pool } = makePool(() => ({
      rows: [
        {
          id: 'share-1',
          label: '门诊',
          created_at: new Date('2026-08-01T00:00:00Z'),
          expires_at: new Date('2026-08-08T00:00:00Z'),
          revoked_at: new Date('2026-08-02T00:00:00Z'),
          opened_count: 2,
          last_opened_at: new Date('2026-08-01T09:00:00Z'),
          pickup_expires_at: null,
          pickup_attempts: null,
          pickup_redeemed_at: null,
          pickup_burned_at: null,
        },
      ],
    }));
    const result = await serviceFor(pool).listPassportSharesForExport('user-1');

    expect(result.shares).toHaveLength(1);
    expect(result.shares[0].revokedAt).toBe('2026-08-02T00:00:00.000Z');
    expect(result.shares[0].token).toBeUndefined();
    expect(result.shares[0].code).toBeUndefined();
    expect(result.truncated).toBe(false);
  });

  it('flags truncation at the underlying list cap', async () => {
    const { pool } = makePool(() => ({
      rows: Array.from({ length: 50 }, (_, i) => ({
        id: `share-${i}`,
        label: null,
        created_at: new Date('2026-08-01T00:00:00Z'),
        expires_at: new Date('2026-08-08T00:00:00Z'),
        revoked_at: null,
        opened_count: 0,
        last_opened_at: null,
        pickup_expires_at: null,
        pickup_attempts: null,
        pickup_redeemed_at: null,
        pickup_burned_at: null,
      })),
    }));
    const result = await serviceFor(pool).listPassportSharesForExport('user-1');

    expect(result.shares).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });
});
