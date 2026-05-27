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

export interface ConsentStatus {
  level: ConsentLevel;
  flags: {
    personal: boolean;
    thirdParty: boolean;
    preciseValues: boolean;
  };
}

const NO_CONSENT: ConsentStatus = {
  level: 'none',
  flags: { personal: false, thirdParty: false, preciseValues: false },
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
 * Pick the redaction mode that pairs with a given consent level.
 * Co-located with the consent checker so the mapping lives in
 * one place — the redactor reads it, the audit logger records it,
 * the orchestrator drives it.
 */
export const redactionModeForConsent = (level: ConsentLevel): 'strict' | 'precise' =>
  level === 'precise' ? 'precise' : 'strict';
