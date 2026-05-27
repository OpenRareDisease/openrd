import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { getConsentLevel, getConsentStatus, redactionModeForConsent } from './consent.js';

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
