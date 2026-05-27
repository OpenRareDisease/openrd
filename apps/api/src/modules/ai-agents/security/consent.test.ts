import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  ConsentMutationError,
  getConsentDetails,
  getConsentLevel,
  getConsentStatus,
  redactionModeForConsent,
  updateConsent,
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

describe('updateConsent', () => {
  /** Stateful fake pool: simulates one user's profile row across
   *  SELECT/UPDATE/SELECT round trips. */
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

    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (/^SELECT/i.test(sql.trim())) {
        return row
          ? ({ rows: [row], rowCount: 1 } as unknown as QueryResult)
          : ({ rows: [], rowCount: 0 } as unknown as QueryResult);
      }
      if (/^UPDATE/i.test(sql.trim()) && row) {
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
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });

    return {
      pool: { query } as unknown as Pool,
      updateCalls,
      getRow: () => row,
    };
  };

  it('throws profile_not_found when the user has no row', async () => {
    const { pool } = buildStatefulPool(null);
    await expect(updateConsent(pool, 'user-1', { personal: true })).rejects.toBeInstanceOf(
      ConsentMutationError,
    );
  });

  it('returns the current details when nothing actually changes', async () => {
    const { pool, updateCalls } = buildStatefulPool({
      personal: true,
      thirdParty: true,
      preciseValues: false,
    });
    const result = await updateConsent(pool, 'user-1', { personal: true });
    expect(result.level).toBe('basic');
    expect(updateCalls).toHaveLength(0);
  });

  it('grants basic consent and sets the matching _at columns', async () => {
    const { pool, updateCalls, getRow } = buildStatefulPool({
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
  });

  it('promotes to precise when all three are granted', async () => {
    const { pool } = buildStatefulPool({
      personal: true,
      thirdParty: true,
      preciseValues: false,
    });
    const result = await updateConsent(pool, 'user-1', { preciseValues: true });
    expect(result.level).toBe('precise');
    expect(result.timestamps.preciseValuesAt).toBeTruthy();
  });

  it('refuses to set preciseValues=true when the base pair is not satisfied', async () => {
    const { pool, updateCalls } = buildStatefulPool({
      personal: true,
      thirdParty: false,
      preciseValues: false,
    });
    await expect(updateConsent(pool, 'user-1', { preciseValues: true })).rejects.toMatchObject({
      code: 'invalid_precise',
    });
    expect(updateCalls).toHaveLength(0);
  });

  it('coerces preciseValues to false when personal is revoked', async () => {
    const { pool, updateCalls, getRow } = buildStatefulPool({
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
  });

  it('coerces preciseValues to false when third_party is revoked', async () => {
    const { pool } = buildStatefulPool({
      personal: true,
      thirdParty: true,
      preciseValues: true,
    });
    const result = await updateConsent(pool, 'user-1', { thirdParty: false });
    expect(result.flags.preciseValues).toBe(false);
    expect(result.level).toBe('none');
  });
});
