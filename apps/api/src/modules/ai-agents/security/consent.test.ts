import type { Pool, PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  ConsentMutationError,
  getConsentDetails,
  getConsentHistory,
  getConsentLevel,
  getConsentStatus,
  redactionModeForConsent,
  updateConsent,
  type ConsentEventFlag,
  type ConsentEventSource,
} from './consent.js';

const fakePool = (rows: unknown[]) =>
  ({
    query: vi.fn().mockResolvedValue({
      rows,
      rowCount: rows.length,
    } as unknown as QueryResult),
  }) as unknown as Pool;

describe('getConsentStatus', () => {
  it('returns none when userId is empty', async () => {
    const pool = fakePool([]);
    const status = await getConsentStatus(pool, '');
    expect(status.level).toBe('none');
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('returns none when no profile row exists', async () => {
    const pool = fakePool([]);
    const status = await getConsentStatus(pool, 'user-1');
    expect(status.level).toBe('none');
    expect(status.flags).toEqual({
      personal: false,
      thirdParty: false,
      preciseValues: false,
    });
  });

  it('returns none if only personal is granted', async () => {
    const pool = fakePool([
      {
        ai_consent_personal: true,
        ai_consent_third_party: false,
        ai_consent_precise_values: false,
      },
    ]);
    const status = await getConsentStatus(pool, 'user-1');
    expect(status.level).toBe('none');
  });

  it('returns none if only third_party is granted', async () => {
    const pool = fakePool([
      {
        ai_consent_personal: false,
        ai_consent_third_party: true,
        ai_consent_precise_values: false,
      },
    ]);
    const status = await getConsentStatus(pool, 'user-1');
    expect(status.level).toBe('none');
  });

  it('returns basic when both flags are granted', async () => {
    const pool = fakePool([
      {
        ai_consent_personal: true,
        ai_consent_third_party: true,
        ai_consent_precise_values: false,
      },
    ]);
    const status = await getConsentStatus(pool, 'user-1');
    expect(status.level).toBe('basic');
    expect(status.flags.preciseValues).toBe(false);
  });

  it('returns precise when all three flags are granted', async () => {
    const pool = fakePool([
      {
        ai_consent_personal: true,
        ai_consent_third_party: true,
        ai_consent_precise_values: true,
      },
    ]);
    const status = await getConsentStatus(pool, 'user-1');
    expect(status.level).toBe('precise');
  });

  it('precise_values alone (without the base pair) still resolves to none', async () => {
    const pool = fakePool([
      {
        ai_consent_personal: false,
        ai_consent_third_party: false,
        ai_consent_precise_values: true,
      },
    ]);
    const status = await getConsentStatus(pool, 'user-1');
    expect(status.level).toBe('none');
  });
});

describe('getConsentLevel', () => {
  it('returns just the level field', async () => {
    const pool = fakePool([
      {
        ai_consent_personal: true,
        ai_consent_third_party: true,
        ai_consent_precise_values: false,
      },
    ]);
    expect(await getConsentLevel(pool, 'user-1')).toBe('basic');
  });
});

describe('redactionModeForConsent', () => {
  it('maps none -> strict (orchestrator will refuse upstream anyway)', () => {
    expect(redactionModeForConsent('none')).toBe('strict');
  });
  it('maps basic -> strict', () => {
    expect(redactionModeForConsent('basic')).toBe('strict');
  });
  it('maps precise -> precise', () => {
    expect(redactionModeForConsent('precise')).toBe('precise');
  });
});

describe('getConsentDetails', () => {
  it('returns null when no profile row exists', async () => {
    const pool = fakePool([]);
    expect(await getConsentDetails(pool, 'user-1')).toBeNull();
  });

  it('returns level + flags + timestamps when row exists', async () => {
    const pool = fakePool([
      {
        ai_consent_personal: true,
        ai_consent_third_party: true,
        ai_consent_precise_values: false,
        ai_consent_personal_at: '2026-05-20T10:00:00Z',
        ai_consent_third_party_at: '2026-05-20T10:00:00Z',
        ai_consent_precise_values_at: null,
      },
    ]);
    const details = await getConsentDetails(pool, 'user-1');
    expect(details).toEqual({
      level: 'basic',
      flags: { personal: true, thirdParty: true, preciseValues: false },
      timestamps: {
        personalAt: '2026-05-20T10:00:00.000Z',
        thirdPartyAt: '2026-05-20T10:00:00.000Z',
        preciseValuesAt: null,
      },
    });
  });
});

interface RecordedEvent {
  userId: string;
  flagName: ConsentEventFlag;
  fromValue: boolean;
  toValue: boolean;
  source: ConsentEventSource;
  note: string | null;
}

describe('updateConsent', () => {
  /** Stateful fake pool: simulates one user's profile row + its
   *  associated ai_consent_events log across BEGIN / SELECT / UPDATE /
   *  INSERT / COMMIT round trips through a checked-out client.
   *
   *  The transactional path of `updateConsent` uses pool.connect(), so
   *  we mock both .connect() → client and the client's own .query().
   *  The fake doesn't simulate true isolation — there's no need: the
   *  unit tests only check that the right statements ran with the
   *  right values, not Postgres semantics. */
  const buildStatefulPool = (
    initial: {
      personal: boolean;
      thirdParty: boolean;
      preciseValues: boolean;
      personalAt?: string | null;
      thirdPartyAt?: string | null;
      preciseValuesAt?: string | null;
    } | null,
  ) => {
    const row = initial
      ? {
          ai_consent_personal: initial.personal,
          ai_consent_third_party: initial.thirdParty,
          ai_consent_precise_values: initial.preciseValues,
          ai_consent_personal_at: initial.personalAt ?? null,
          ai_consent_third_party_at: initial.thirdPartyAt ?? null,
          ai_consent_precise_values_at: initial.preciseValuesAt ?? null,
        }
      : null;

    const updateCalls: Array<{ sql: string; values: unknown[] }> = [];
    const recordedEvents: RecordedEvent[] = [];
    const txnLog: string[] = [];

    let eventIdCounter = 0;

    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      const trimmed = sql.trim();
      if (/^BEGIN/i.test(trimmed)) {
        txnLog.push('BEGIN');
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
      }
      if (/^COMMIT/i.test(trimmed)) {
        txnLog.push('COMMIT');
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
      }
      if (/^ROLLBACK/i.test(trimmed)) {
        txnLog.push('ROLLBACK');
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
      }
      if (/^SELECT/i.test(trimmed)) {
        if (/FROM ai_consent_events/i.test(trimmed)) {
          // Mirror the real ORDER BY changed_at DESC — recordedEvents
          // is append-only newest-last, so reverse for the read.
          const slice = [...recordedEvents].reverse().map((evt, idx) => ({
            id: `evt-${idx}`,
            user_id: evt.userId,
            flag_name: evt.flagName,
            from_value: evt.fromValue,
            to_value: evt.toValue,
            source: evt.source,
            note: evt.note,
            changed_at: new Date(2026, 4, 27, 12, idx, 0).toISOString(),
          }));
          return {
            rows: slice,
            rowCount: slice.length,
          } as unknown as QueryResult;
        }
        return row
          ? ({ rows: [row], rowCount: 1 } as unknown as QueryResult)
          : ({ rows: [], rowCount: 0 } as unknown as QueryResult);
      }
      if (/^UPDATE/i.test(trimmed) && row) {
        updateCalls.push({ sql, values: values ?? [] });
        // Mutate the in-memory row based on the SET clause.
        const updates = sql.match(/ai_consent_(personal|third_party|precise_values) = \$(\d+)/g);
        updates?.forEach((part) => {
          const m = part.match(/ai_consent_(personal|third_party|precise_values) = \$(\d+)/);
          if (!m) return;
          const field = m[1];
          const idx = Number(m[2]) - 1;
          const v = Boolean((values ?? [])[idx]);
          if (field === 'personal') {
            row!.ai_consent_personal = v;
            row!.ai_consent_personal_at = '2026-05-27T12:00:00Z';
          } else if (field === 'third_party') {
            row!.ai_consent_third_party = v;
            row!.ai_consent_third_party_at = '2026-05-27T12:00:00Z';
          } else if (field === 'precise_values') {
            row!.ai_consent_precise_values = v;
            row!.ai_consent_precise_values_at = '2026-05-27T12:00:00Z';
          }
        });
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      if (/^INSERT INTO ai_consent_events/i.test(trimmed)) {
        const vals = values ?? [];
        recordedEvents.push({
          userId: String(vals[0]),
          flagName: vals[1] as ConsentEventFlag,
          fromValue: Boolean(vals[2]),
          toValue: Boolean(vals[3]),
          source: vals[4] as ConsentEventSource,
          note: (vals[5] ?? null) as string | null,
        });
        eventIdCounter += 1;
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });

    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const connect = vi.fn(async () => client);

    return {
      pool: { query, connect } as unknown as Pool,
      updateCalls,
      recordedEvents,
      txnLog,
      getRow: () => row,
      release,
      eventIdCounter: () => eventIdCounter,
    };
  };

  it('throws profile_not_found when the user has no row', async () => {
    const { pool, txnLog, release } = buildStatefulPool(null);
    await expect(updateConsent(pool, 'user-1', { personal: true })).rejects.toBeInstanceOf(
      ConsentMutationError,
    );
    // Even the failure path must close the transaction and release
    // the client; otherwise we leak pool connections.
    expect(txnLog).toContain('BEGIN');
    expect(txnLog).toContain('ROLLBACK');
    expect(release).toHaveBeenCalled();
  });

  it('returns the current details when nothing actually changes', async () => {
    const { pool, updateCalls, recordedEvents, txnLog } = buildStatefulPool({
      personal: true,
      thirdParty: true,
      preciseValues: false,
    });
    const result = await updateConsent(pool, 'user-1', { personal: true });
    expect(result.level).toBe('basic');
    expect(updateCalls).toHaveLength(0);
    // Idempotent call: no event row, but the empty transaction still
    // commits cleanly so we don't leave one open.
    expect(recordedEvents).toHaveLength(0);
    expect(txnLog).toEqual(['BEGIN', 'COMMIT']);
  });

  it('grants basic consent and sets the matching _at columns', async () => {
    const { pool, updateCalls, getRow, recordedEvents, txnLog } = buildStatefulPool({
      personal: false,
      thirdParty: false,
      preciseValues: false,
    });
    const result = await updateConsent(pool, 'user-1', { personal: true, thirdParty: true });
    expect(result.level).toBe('basic');
    expect(updateCalls).toHaveLength(1);
    const sql = updateCalls[0].sql;
    expect(sql).toMatch(/ai_consent_personal_at = NOW\(\)/);
    expect(sql).toMatch(/ai_consent_third_party_at = NOW\(\)/);
    expect(sql).not.toMatch(/ai_consent_precise_values_at = NOW\(\)/);
    expect(getRow()?.ai_consent_personal).toBe(true);
    expect(getRow()?.ai_consent_third_party).toBe(true);
    // Two event rows — one per changed flag — both source='user'.
    expect(recordedEvents).toEqual([
      {
        userId: 'user-1',
        flagName: 'personal',
        fromValue: false,
        toValue: true,
        source: 'user',
        note: null,
      },
      {
        userId: 'user-1',
        flagName: 'third_party',
        fromValue: false,
        toValue: true,
        source: 'user',
        note: null,
      },
    ]);
    expect(txnLog).toEqual(['BEGIN', 'COMMIT']);
  });

  it('promotes to precise when all three are granted', async () => {
    const { pool, recordedEvents } = buildStatefulPool({
      personal: true,
      thirdParty: true,
      preciseValues: false,
    });
    const result = await updateConsent(pool, 'user-1', { preciseValues: true });
    expect(result.level).toBe('precise');
    expect(result.timestamps.preciseValuesAt).toBeTruthy();
    expect(recordedEvents).toEqual([
      {
        userId: 'user-1',
        flagName: 'precise_values',
        fromValue: false,
        toValue: true,
        source: 'user',
        note: null,
      },
    ]);
  });

  it('refuses to set preciseValues=true when the base pair is not satisfied', async () => {
    const { pool, updateCalls, recordedEvents, txnLog, release } = buildStatefulPool({
      personal: true,
      thirdParty: false,
      preciseValues: false,
    });
    await expect(updateConsent(pool, 'user-1', { preciseValues: true })).rejects.toMatchObject({
      code: 'invalid_precise',
    });
    expect(updateCalls).toHaveLength(0);
    // Validation failures must roll back, not commit, so a partial
    // write never escapes the transaction.
    expect(recordedEvents).toHaveLength(0);
    expect(txnLog).toEqual(['BEGIN', 'ROLLBACK']);
    expect(release).toHaveBeenCalled();
  });

  it('coerces preciseValues to false when personal is revoked and tags it source=system', async () => {
    const { pool, updateCalls, getRow, recordedEvents } = buildStatefulPool({
      personal: true,
      thirdParty: true,
      preciseValues: true,
    });
    const result = await updateConsent(pool, 'user-1', { personal: false });
    expect(result.flags.personal).toBe(false);
    expect(result.flags.preciseValues).toBe(false);
    expect(result.level).toBe('none');
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].sql).toMatch(/ai_consent_precise_values_at = NOW\(\)/);
    expect(getRow()?.ai_consent_precise_values).toBe(false);
    // The personal row is the user's revoke (source='user'); the
    // precise row is the automatic coercion (source='system').
    expect(recordedEvents).toEqual([
      {
        userId: 'user-1',
        flagName: 'personal',
        fromValue: true,
        toValue: false,
        source: 'user',
        note: null,
      },
      {
        userId: 'user-1',
        flagName: 'precise_values',
        fromValue: true,
        toValue: false,
        source: 'system',
        note: null,
      },
    ]);
  });

  it('coerces preciseValues to false when third_party is revoked and tags it source=system', async () => {
    const { pool, recordedEvents } = buildStatefulPool({
      personal: true,
      thirdParty: true,
      preciseValues: true,
    });
    const result = await updateConsent(pool, 'user-1', { thirdParty: false });
    expect(result.flags.preciseValues).toBe(false);
    expect(result.level).toBe('none');
    expect(recordedEvents.map((e) => [e.flagName, e.source])).toEqual([
      ['third_party', 'user'],
      ['precise_values', 'system'],
    ]);
  });

  it('records an explicit precise=false revoke as source=user (not coerced)', async () => {
    const { pool, recordedEvents } = buildStatefulPool({
      personal: true,
      thirdParty: true,
      preciseValues: true,
    });
    const result = await updateConsent(pool, 'user-1', { preciseValues: false });
    expect(result.flags.preciseValues).toBe(false);
    expect(result.level).toBe('basic');
    // Caller asked for precise=false directly — that's a user-driven
    // revoke, even though the base pair is still true.
    expect(recordedEvents).toEqual([
      {
        userId: 'user-1',
        flagName: 'precise_values',
        fromValue: true,
        toValue: false,
        source: 'user',
        note: null,
      },
    ]);
  });

  it('passes through the optional source + note to every event row', async () => {
    const { pool, recordedEvents } = buildStatefulPool({
      personal: false,
      thirdParty: false,
      preciseValues: false,
    });
    await updateConsent(
      pool,
      'user-1',
      { personal: true, thirdParty: true },
      { source: 'admin', note: 'rollout 2026-05' },
    );
    expect(recordedEvents.every((e) => e.source === 'admin')).toBe(true);
    expect(recordedEvents.every((e) => e.note === 'rollout 2026-05')).toBe(true);
  });
});

describe('getConsentHistory', () => {
  const eventRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'evt-1',
    user_id: 'user-1',
    flag_name: 'personal',
    from_value: false,
    to_value: true,
    source: 'user',
    note: null,
    changed_at: '2026-05-27T12:00:00Z',
    ...overrides,
  });

  it('returns [] for empty userId without querying', async () => {
    const pool = fakePool([]);
    const out = await getConsentHistory(pool, '');
    expect(out).toEqual([]);
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('maps event rows into the camelCase shape', async () => {
    const pool = fakePool([
      eventRow({ id: 'evt-1', flag_name: 'personal' }),
      eventRow({
        id: 'evt-2',
        flag_name: 'precise_values',
        from_value: true,
        to_value: false,
        source: 'system',
        note: 'auto-coerced',
        changed_at: '2026-05-27T11:00:00Z',
      }),
    ]);
    const out = await getConsentHistory(pool, 'user-1');
    expect(out).toEqual([
      {
        id: 'evt-1',
        userId: 'user-1',
        flagName: 'personal',
        fromValue: false,
        toValue: true,
        source: 'user',
        note: null,
        changedAt: '2026-05-27T12:00:00.000Z',
      },
      {
        id: 'evt-2',
        userId: 'user-1',
        flagName: 'precise_values',
        fromValue: true,
        toValue: false,
        source: 'system',
        note: 'auto-coerced',
        changedAt: '2026-05-27T11:00:00.000Z',
      },
    ]);
  });

  it('clamps limit into [1, 500] and offset to >= 0', async () => {
    const pool = fakePool([]);
    await getConsentHistory(pool, 'user-1', { limit: 99999, offset: -5 });
    const mock = pool.query as unknown as ReturnType<typeof vi.fn>;
    const [, values] = mock.mock.calls[0];
    expect(values).toEqual(['user-1', 500, 0]);
  });

  it('adds a flag_name filter when requested', async () => {
    const pool = fakePool([]);
    await getConsentHistory(pool, 'user-1', { flagName: 'precise_values', limit: 10 });
    const mock = pool.query as unknown as ReturnType<typeof vi.fn>;
    const [sql, values] = mock.mock.calls[0];
    expect(String(sql)).toMatch(/flag_name = \$2/);
    expect(values).toEqual(['user-1', 'precise_values', 10, 0]);
  });
});
