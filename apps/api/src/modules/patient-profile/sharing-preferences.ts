/**
 * Data-sharing preferences (the four non-AI privacy toggles).
 *
 * These mirror the four toggles in `apps/mobile/screens/p-privacy_settings`:
 *
 *   - `clinicalTrial` — let clinical-trial orgs read the profile for
 *     eligibility screening
 *   - `dataDonation` — donate anonymised data to FSHD research
 *   - `hospitalSync` — allow hospital HIS to push follow-up data into
 *     the profile
 *   - `communityShare` — allow posting recovery experience / videos
 *     in the community
 *
 * They live next to AI consent (the `ai_consent_*` columns on
 * `patient_profiles`) but are intentionally a separate read/write
 * surface: AI consent has the precise/basic/none level logic and the
 * grant-history table (`ai_consent_events`); these four are
 * independent booleans. Keeping them apart means the two screens can
 * evolve without one's rules contaminating the other.
 *
 * Failure modes match the AI consent helper for symmetry:
 *   - `profile_not_found` → 404
 *
 * See migration 010 for the column layout.
 */

import type { Pool } from 'pg';

export interface SharingPreferenceFlags {
  clinicalTrial: boolean;
  dataDonation: boolean;
  hospitalSync: boolean;
  communityShare: boolean;
}

export interface SharingPreferenceTimestamps {
  clinicalTrialAt: string | null;
  dataDonationAt: string | null;
  hospitalSyncAt: string | null;
  communityShareAt: string | null;
}

export interface SharingPreferences {
  flags: SharingPreferenceFlags;
  timestamps: SharingPreferenceTimestamps;
}

export interface SharingPreferenceUpdateInput {
  clinicalTrial?: boolean;
  dataDonation?: boolean;
  hospitalSync?: boolean;
  communityShare?: boolean;
}

export class SharingPreferenceMutationError extends Error {
  constructor(
    message: string,
    public readonly code: 'profile_not_found',
  ) {
    super(message);
    this.name = 'SharingPreferenceMutationError';
  }
}

/** Centralised mapping of API camelCase keys → DB snake_case columns,
 *  so the SELECT, the SET clause builder, and the tests all read the
 *  same source of truth. */
const COLUMN_MAP = {
  clinicalTrial: {
    column: 'clinical_trial_consent',
    atColumn: 'clinical_trial_consent_at',
  },
  dataDonation: {
    column: 'data_donation_consent',
    atColumn: 'data_donation_consent_at',
  },
  hospitalSync: {
    column: 'hospital_sync_consent',
    atColumn: 'hospital_sync_consent_at',
  },
  communityShare: {
    column: 'community_share_consent',
    atColumn: 'community_share_consent_at',
  },
} as const satisfies Record<keyof SharingPreferenceFlags, { column: string; atColumn: string }>;

interface SharingRow {
  clinical_trial_consent: boolean | null;
  clinical_trial_consent_at: Date | string | null;
  data_donation_consent: boolean | null;
  data_donation_consent_at: Date | string | null;
  hospital_sync_consent: boolean | null;
  hospital_sync_consent_at: Date | string | null;
  community_share_consent: boolean | null;
  community_share_consent_at: Date | string | null;
}

const formatTimestamp = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

const rowToPreferences = (row: SharingRow): SharingPreferences => ({
  flags: {
    clinicalTrial: Boolean(row.clinical_trial_consent),
    dataDonation: Boolean(row.data_donation_consent),
    hospitalSync: Boolean(row.hospital_sync_consent),
    communityShare: Boolean(row.community_share_consent),
  },
  timestamps: {
    clinicalTrialAt: formatTimestamp(row.clinical_trial_consent_at),
    dataDonationAt: formatTimestamp(row.data_donation_consent_at),
    hospitalSyncAt: formatTimestamp(row.hospital_sync_consent_at),
    communityShareAt: formatTimestamp(row.community_share_consent_at),
  },
});

/**
 * Read all four sharing preferences for the given user. Returns
 * `null` when the user has no `patient_profiles` row, so the route
 * can map that to a 404 instead of fabricating defaulted values.
 */
export const getSharingPreferences = async (
  pool: Pool,
  userId: string,
): Promise<SharingPreferences | null> => {
  if (!userId) return null;

  const result = await pool.query<SharingRow>(
    `SELECT clinical_trial_consent,
            clinical_trial_consent_at,
            data_donation_consent,
            data_donation_consent_at,
            hospital_sync_consent,
            hospital_sync_consent_at,
            community_share_consent,
            community_share_consent_at
       FROM patient_profiles
      WHERE user_id = $1
      LIMIT 1`,
    [userId],
  );

  if (result.rowCount === 0) return null;
  return rowToPreferences(result.rows[0]);
};

/**
 * Apply a partial update.
 *
 *   - Unspecified flags keep their current value (no inadvertent
 *     wipes when the client sends a single toggle change).
 *   - For each flag that actually changed, the matching `_at` column
 *     is set to `NOW()`. Unchanged flags leave their timestamp
 *     alone, so "上次更新 …" hints in the UI stay accurate.
 *   - When no flag changed, we skip the UPDATE entirely and return
 *     the current state — idempotent, no row touched.
 *
 * Throws {@link SharingPreferenceMutationError} with
 * `code='profile_not_found'` when the user has no profile row.
 */
export const updateSharingPreferences = async (
  pool: Pool,
  userId: string,
  input: SharingPreferenceUpdateInput,
): Promise<SharingPreferences> => {
  if (!userId) {
    throw new SharingPreferenceMutationError('userId is required', 'profile_not_found');
  }

  // Hold the row lock for the whole read → diff → write cycle so two
  // concurrent toggles can't both decide "nothing to change" against
  // the same snapshot, or both flip the same column and leave only
  // one timestamp updated. The transaction also guarantees the
  // RETURNING read on UPDATE sees our own writes, eliminating the
  // separate refresh round-trip.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lockResult = await client.query<SharingRow>(
      `SELECT clinical_trial_consent,
              clinical_trial_consent_at,
              data_donation_consent,
              data_donation_consent_at,
              hospital_sync_consent,
              hospital_sync_consent_at,
              community_share_consent,
              community_share_consent_at
         FROM patient_profiles
        WHERE user_id = $1
        FOR UPDATE`,
      [userId],
    );

    if (lockResult.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new SharingPreferenceMutationError('Patient profile not found', 'profile_not_found');
    }

    const current = rowToPreferences(lockResult.rows[0]);

    const changes: Array<{ column: string; atColumn: string; newValue: boolean }> = [];
    for (const key of Object.keys(COLUMN_MAP) as Array<keyof SharingPreferenceFlags>) {
      const nextValue = input[key];
      if (nextValue === undefined) continue;
      if (nextValue === current.flags[key]) continue;
      const map = COLUMN_MAP[key];
      changes.push({ column: map.column, atColumn: map.atColumn, newValue: nextValue });
    }

    if (changes.length === 0) {
      await client.query('COMMIT');
      return current;
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const change of changes) {
      values.push(change.newValue);
      setClauses.push(`${change.column} = $${values.length}`);
      setClauses.push(`${change.atColumn} = NOW()`);
    }
    setClauses.push('updated_at = NOW()');

    values.push(userId);
    const updateResult = await client.query<SharingRow>(
      `UPDATE patient_profiles
          SET ${setClauses.join(', ')}
        WHERE user_id = $${values.length}
        RETURNING clinical_trial_consent,
                  clinical_trial_consent_at,
                  data_donation_consent,
                  data_donation_consent_at,
                  hospital_sync_consent,
                  hospital_sync_consent_at,
                  community_share_consent,
                  community_share_consent_at`,
      values,
    );

    await client.query('COMMIT');

    if (updateResult.rowCount === 0) {
      throw new SharingPreferenceMutationError('Patient profile not found', 'profile_not_found');
    }
    return rowToPreferences(updateResult.rows[0]);
  } catch (error) {
    // Best-effort rollback in case BEGIN succeeded but a later step
    // threw before COMMIT/ROLLBACK ran (e.g. a network blip on the
    // UPDATE query). Swallow rollback failures — we're already on the
    // failure path and the original error is what the caller cares
    // about.
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }
};
