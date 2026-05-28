import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  SharingPreferenceMutationError,
  getSharingPreferences,
  updateSharingPreferences,
} from './sharing-preferences.js';

const fakePool = (rows: unknown[]) =>
  ({
    query: vi.fn().mockResolvedValue({
      rows,
      rowCount: rows.length,
    } as unknown as QueryResult),
  }) as unknown as Pool;

const fullRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  clinical_trial_consent: false,
  clinical_trial_consent_at: null,
  data_donation_consent: false,
  data_donation_consent_at: null,
  hospital_sync_consent: false,
  hospital_sync_consent_at: null,
  community_share_consent: false,
  community_share_consent_at: null,
  ...overrides,
});

describe('getSharingPreferences', () => {
  it('returns null when userId is empty (no DB call)', async () => {
    const pool = fakePool([]);
    const out = await getSharingPreferences(pool, '');
    expect(out).toBeNull();
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('returns null when no profile row exists', async () => {
    const pool = fakePool([]);
    expect(await getSharingPreferences(pool, 'user-1')).toBeNull();
  });

  it('maps DB columns into camelCase flags + ISO timestamps', async () => {
    const pool = fakePool([
      fullRow({
        clinical_trial_consent: true,
        clinical_trial_consent_at: '2026-05-20T10:00:00Z',
        community_share_consent: true,
        community_share_consent_at: '2026-05-21T11:00:00Z',
      }),
    ]);
    const prefs = await getSharingPreferences(pool, 'user-1');
    expect(prefs).toEqual({
      flags: {
        clinicalTrial: true,
        dataDonation: false,
        hospitalSync: false,
        communityShare: true,
      },
      timestamps: {
        clinicalTrialAt: '2026-05-20T10:00:00.000Z',
        dataDonationAt: null,
        hospitalSyncAt: null,
        communityShareAt: '2026-05-21T11:00:00.000Z',
      },
    });
  });
});

describe('updateSharingPreferences', () => {
  /** Stateful fake pool that simulates one user's profile row across
   *  SELECT → UPDATE → SELECT round trips. Mirrors the pattern in
   *  consent.test.ts so the two helpers stay testable the same way. */
  const buildStatefulPool = (
    initial: {
      clinicalTrial: boolean;
      dataDonation: boolean;
      hospitalSync: boolean;
      communityShare: boolean;
    } | null,
  ) => {
    const row = initial
      ? fullRow({
          clinical_trial_consent: initial.clinicalTrial,
          data_donation_consent: initial.dataDonation,
          hospital_sync_consent: initial.hospitalSync,
          community_share_consent: initial.communityShare,
        })
      : null;

    const updateCalls: Array<{ sql: string; values: unknown[] }> = [];

    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      const trimmed = sql.trim();
      if (/^SELECT/i.test(trimmed)) {
        return row
          ? ({ rows: [row], rowCount: 1 } as unknown as QueryResult)
          : ({ rows: [], rowCount: 0 } as unknown as QueryResult);
      }
      if (/^UPDATE/i.test(trimmed) && row) {
        updateCalls.push({ sql, values: values ?? [] });
        const columnRe =
          /(clinical_trial|data_donation|hospital_sync|community_share)_consent = \$(\d+)/g;
        const matches = sql.match(columnRe);
        matches?.forEach((part) => {
          const m = part.match(
            /(clinical_trial|data_donation|hospital_sync|community_share)_consent = \$(\d+)/,
          );
          if (!m) return;
          const prefix = m[1];
          const idx = Number(m[2]) - 1;
          const v = Boolean((values ?? [])[idx]);
          const col = `${prefix}_consent` as keyof typeof row;
          const atCol = `${prefix}_consent_at` as keyof typeof row;
          (row as Record<string, unknown>)[col] = v;
          (row as Record<string, unknown>)[atCol] = '2026-05-27T12:00:00Z';
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
    await expect(
      updateSharingPreferences(pool, 'user-1', { clinicalTrial: true }),
    ).rejects.toBeInstanceOf(SharingPreferenceMutationError);
  });

  it('returns current state and skips UPDATE when nothing actually changes', async () => {
    const { pool, updateCalls } = buildStatefulPool({
      clinicalTrial: true,
      dataDonation: false,
      hospitalSync: true,
      communityShare: false,
    });
    const result = await updateSharingPreferences(pool, 'user-1', { clinicalTrial: true });
    expect(result.flags.clinicalTrial).toBe(true);
    expect(updateCalls).toHaveLength(0);
  });

  it('flips one flag, leaves the others untouched, bumps the matching _at', async () => {
    const { pool, updateCalls, getRow } = buildStatefulPool({
      clinicalTrial: false,
      dataDonation: false,
      hospitalSync: false,
      communityShare: false,
    });
    const result = await updateSharingPreferences(pool, 'user-1', { dataDonation: true });
    expect(result.flags).toEqual({
      clinicalTrial: false,
      dataDonation: true,
      hospitalSync: false,
      communityShare: false,
    });
    expect(updateCalls).toHaveLength(1);
    const sql = updateCalls[0].sql;
    expect(sql).toMatch(/data_donation_consent_at = NOW\(\)/);
    expect(sql).not.toMatch(/clinical_trial_consent_at = NOW\(\)/);
    expect(sql).not.toMatch(/hospital_sync_consent_at = NOW\(\)/);
    expect(sql).not.toMatch(/community_share_consent_at = NOW\(\)/);
    expect(getRow()?.data_donation_consent).toBe(true);
    expect(result.timestamps.dataDonationAt).toBeTruthy();
    expect(result.timestamps.clinicalTrialAt).toBeNull();
  });

  it('flips multiple flags in a single UPDATE', async () => {
    const { pool, updateCalls } = buildStatefulPool({
      clinicalTrial: false,
      dataDonation: false,
      hospitalSync: false,
      communityShare: false,
    });
    const result = await updateSharingPreferences(pool, 'user-1', {
      clinicalTrial: true,
      hospitalSync: true,
      communityShare: true,
    });
    expect(result.flags).toEqual({
      clinicalTrial: true,
      dataDonation: false,
      hospitalSync: true,
      communityShare: true,
    });
    expect(updateCalls).toHaveLength(1);
    const sql = updateCalls[0].sql;
    expect(sql).toMatch(/clinical_trial_consent = \$1/);
    expect(sql).toMatch(/hospital_sync_consent = \$2/);
    expect(sql).toMatch(/community_share_consent = \$3/);
    // Three flags + the userId go into the placeholders, so the WHERE
    // clause should reference $4.
    expect(sql).toMatch(/WHERE user_id = \$4/);
  });

  it('revokes a previously granted flag (true → false) and bumps _at', async () => {
    const { pool, getRow, updateCalls } = buildStatefulPool({
      clinicalTrial: true,
      dataDonation: true,
      hospitalSync: true,
      communityShare: true,
    });
    const result = await updateSharingPreferences(pool, 'user-1', { communityShare: false });
    expect(result.flags.communityShare).toBe(false);
    expect(result.flags.clinicalTrial).toBe(true);
    expect(getRow()?.community_share_consent).toBe(false);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].sql).toMatch(/community_share_consent_at = NOW\(\)/);
  });
});
