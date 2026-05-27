/**
 * Consent checking.
 *
 * Maps the three boolean consent columns on `patient_profiles`
 * (`ai_consent_third_party`, `ai_consent_personal`,
 * `ai_consent_precise_values`) into the three-tier model documented in
 * docs/proposals/local-rag-migration.md §5:
 *
 *   - `none`    : missing third_party or personal consent. The
 *                 orchestrator must refuse to call the LLM.
 *   - `basic`   : third_party + personal granted, no precise_values.
 *                 Strict-mode redaction applies; numeric values get
 *                 clinicalised.
 *   - `precise` : all three granted. Precise-mode redaction; raw
 *                 numeric values are allowed through the allowlist.
 *
 * The checker is intentionally a thin function rather than a class
 * because it carries no state — every call is a fresh DB read against
 * a single user, so callers can use it from middleware, tools, or
 * audit code without juggling lifetimes.
 */

import type { Pool } from 'pg';

import type { ConsentLevel } from '../retrievers/base.js';

interface ConsentRow {
  ai_consent_personal: boolean | null;
  ai_consent_third_party: boolean | null;
  ai_consent_precise_values: boolean | null;
}

interface ConsentRowWithTimestamps extends ConsentRow {
  ai_consent_personal_at: Date | string | null;
  ai_consent_third_party_at: Date | string | null;
  ai_consent_precise_values_at: Date | string | null;
}

export interface ConsentStatus {
  level: ConsentLevel;
  flags: {
    personal: boolean;
    thirdParty: boolean;
    preciseValues: boolean;
  };
}

export interface ConsentTimestamps {
  personalAt: string | null;
  thirdPartyAt: string | null;
  preciseValuesAt: string | null;
}

/** {@link ConsentStatus} plus per-flag `_at` timestamps. The Phase 3a
 *  mobile UI uses the timestamps to show "已同意于 …" hints; the audit
 *  layer doesn't need them. */
export interface ConsentDetails extends ConsentStatus {
  timestamps: ConsentTimestamps;
}

export interface ConsentUpdateInput {
  personal?: boolean;
  thirdParty?: boolean;
  preciseValues?: boolean;
}

/**
 * Failure modes for {@link updateConsent}. Carries a `code` so the
 * route layer can pick an HTTP status without string-matching the
 * message. Kept in the security module so the helper stays framework-
 * agnostic.
 */
export class ConsentMutationError extends Error {
  constructor(
    message: string,
    public readonly code: 'profile_not_found' | 'invalid_precise',
  ) {
    super(message);
    this.name = 'ConsentMutationError';
  }
}

const NO_CONSENT: ConsentStatus = {
  level: 'none',
  flags: { personal: false, thirdParty: false, preciseValues: false },
};

const computeLevel = (
  personal: boolean,
  thirdParty: boolean,
  preciseValues: boolean,
): ConsentLevel => {
  if (!personal || !thirdParty) return 'none';
  return preciseValues ? 'precise' : 'basic';
};

const formatTimestamp = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

/**
 * Look up the current consent status for the given user.
 *
 * Returns `none` for users without a `patient_profiles` row so any
 * caller can treat "no profile" as "no consent" without an extra
 * branch. Both `personal` and `third_party` must be true for the
 * orchestrator to use patient data at all; `precise_values` only
 * elevates the redaction mode.
 */
export const getConsentStatus = async (pool: Pool, userId: string): Promise<ConsentStatus> => {
  if (!userId) return NO_CONSENT;

  const result = await pool.query<ConsentRow>(
    `SELECT ai_consent_personal,
            ai_consent_third_party,
            ai_consent_precise_values
       FROM patient_profiles
      WHERE user_id = $1
      LIMIT 1`,
    [userId],
  );

  if (result.rowCount === 0) return NO_CONSENT;

  const row = result.rows[0];
  const personal = Boolean(row.ai_consent_personal);
  const thirdParty = Boolean(row.ai_consent_third_party);
  const preciseValues = Boolean(row.ai_consent_precise_values);

  let level: ConsentLevel = 'none';
  if (personal && thirdParty) {
    level = preciseValues ? 'precise' : 'basic';
  }

  return {
    level,
    flags: { personal, thirdParty, preciseValues },
  };
};

/**
 * Convenience: just the level, for callers that don't need the
 * raw flag breakdown.
 */
export const getConsentLevel = async (pool: Pool, userId: string): Promise<ConsentLevel> =>
  (await getConsentStatus(pool, userId)).level;

/**
 * Same as {@link getConsentStatus} but also returns the per-flag
 * `_at` timestamps. Returns `null` when the user has no profile row,
 * so the route layer can map that to a 404 instead of pretending a
 * never-consented user exists.
 */
export const getConsentDetails = async (
  pool: Pool,
  userId: string,
): Promise<ConsentDetails | null> => {
  if (!userId) return null;

  const result = await pool.query<ConsentRowWithTimestamps>(
    `SELECT ai_consent_personal,
            ai_consent_third_party,
            ai_consent_precise_values,
            ai_consent_personal_at,
            ai_consent_third_party_at,
            ai_consent_precise_values_at
       FROM patient_profiles
      WHERE user_id = $1
      LIMIT 1`,
    [userId],
  );

  if (result.rowCount === 0) return null;

  const row = result.rows[0];
  const personal = Boolean(row.ai_consent_personal);
  const thirdParty = Boolean(row.ai_consent_third_party);
  const preciseValues = Boolean(row.ai_consent_precise_values);

  return {
    level: computeLevel(personal, thirdParty, preciseValues),
    flags: { personal, thirdParty, preciseValues },
    timestamps: {
      personalAt: formatTimestamp(row.ai_consent_personal_at),
      thirdPartyAt: formatTimestamp(row.ai_consent_third_party_at),
      preciseValuesAt: formatTimestamp(row.ai_consent_precise_values_at),
    },
  };
};

/**
 * Apply a partial consent update.
 *
 * Rules enforced here (rather than in the route) so every caller —
 * including future admin tooling — gets the same semantics:
 *
 *  - Unspecified flags keep their current value.
 *  - When the resulting `personal` or `thirdParty` would be false,
 *    `preciseValues` is **coerced** to false as well. Precise mode is
 *    only meaningful on top of the basic two; leaving it true would
 *    create an inconsistent row.
 *  - If the caller explicitly tries to set `preciseValues=true` while
 *    `personal` or `thirdParty` is (or becomes) false, we throw
 *    `ConsentMutationError('invalid_precise')` so the UI sees a clean
 *    400 rather than silently dropping the request.
 *  - For each flag whose value actually changed, the matching `_at`
 *    column is set to NOW(); unchanged flags leave their timestamp
 *    alone. This gives compliance a clean grant/revoke history with
 *    no extra audit table.
 *
 * Throws {@link ConsentMutationError} with `code='profile_not_found'`
 * when the user has no `patient_profiles` row.
 */
export const updateConsent = async (
  pool: Pool,
  userId: string,
  input: ConsentUpdateInput,
): Promise<ConsentDetails> => {
  if (!userId) {
    throw new ConsentMutationError('userId is required', 'profile_not_found');
  }

  const current = await getConsentDetails(pool, userId);
  if (!current) {
    throw new ConsentMutationError('Patient profile not found', 'profile_not_found');
  }

  const nextPersonal = input.personal ?? current.flags.personal;
  const nextThirdParty = input.thirdParty ?? current.flags.thirdParty;
  const explicitPrecise = input.preciseValues;
  let nextPrecise = explicitPrecise ?? current.flags.preciseValues;

  // Coerce precise to false when the base pair drops, regardless of
  // the caller's intent — but reject the request if the caller
  // explicitly asked for precise=true alongside a falsey base.
  if (!nextPersonal || !nextThirdParty) {
    if (explicitPrecise === true) {
      throw new ConsentMutationError(
        'precise_values requires both personal and third_party consent',
        'invalid_precise',
      );
    }
    nextPrecise = false;
  }

  const changes: Array<[string, unknown, string | null]> = [];
  if (nextPersonal !== current.flags.personal) {
    changes.push(['ai_consent_personal', nextPersonal, 'ai_consent_personal_at']);
  }
  if (nextThirdParty !== current.flags.thirdParty) {
    changes.push(['ai_consent_third_party', nextThirdParty, 'ai_consent_third_party_at']);
  }
  if (nextPrecise !== current.flags.preciseValues) {
    changes.push(['ai_consent_precise_values', nextPrecise, 'ai_consent_precise_values_at']);
  }

  if (changes.length === 0) {
    return current;
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [column, value, atColumn] of changes) {
    values.push(value);
    setClauses.push(`${column} = $${values.length}`);
    if (atColumn) setClauses.push(`${atColumn} = NOW()`);
  }
  setClauses.push('updated_at = NOW()');

  values.push(userId);
  await pool.query(
    `UPDATE patient_profiles
        SET ${setClauses.join(', ')}
      WHERE user_id = $${values.length}`,
    values,
  );

  const refreshed = await getConsentDetails(pool, userId);
  if (!refreshed) {
    // Race with profile deletion. Surface the same shape as the
    // initial lookup did.
    throw new ConsentMutationError('Patient profile not found', 'profile_not_found');
  }
  return refreshed;
};

/**
 * Pick the redaction mode that pairs with a given consent level.
 * Co-located with the consent checker so the mapping lives in
 * one place — the redactor reads it, the audit logger records it,
 * the orchestrator drives it.
 */
export const redactionModeForConsent = (level: ConsentLevel): 'strict' | 'precise' =>
  level === 'precise' ? 'precise' : 'strict';
