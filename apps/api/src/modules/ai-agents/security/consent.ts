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
 *
 * Every mutation through {@link updateConsent} also appends one row
 * per changed flag to `ai_consent_events` (db/migrations/009), so the
 * full grant/revoke timeline survives even when a flag is toggled
 * back and forth. {@link getConsentHistory} reads that timeline.
 */

import type { Pool, PoolClient } from 'pg';

import type { ConsentLevel } from '../retrievers/base.js';

/**
 * Anything we can `.query()` against — a pooled connection or a
 * checked-out client. Used so the read helpers can be reused inside
 * the transactional path of {@link updateConsent} without opening a
 * second connection.
 */
type Queryable = Pool | PoolClient;

/** Mirrors the CHECK constraint on `ai_consent_events.flag_name`.
 *  Stored as snake_case to keep the SQL and the type identical. */
export type ConsentEventFlag = 'personal' | 'third_party' | 'precise_values';

/** Who or what triggered a consent transition. Mirrors the CHECK
 *  constraint on `ai_consent_events.source`. */
export type ConsentEventSource = 'user' | 'admin' | 'system';

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

interface ConsentEventRow {
  id: string;
  user_id: string;
  flag_name: string;
  from_value: boolean;
  to_value: boolean;
  source: string;
  note: string | null;
  changed_at: Date | string;
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
 * Optional metadata for the event rows that {@link updateConsent}
 * writes. Mobile-initiated calls leave these at their defaults
 * (`source='user'`, `note=null`); future admin tooling will pass
 * `source='admin'` and an operator note.
 */
export interface ConsentUpdateOptions {
  /** Audit source for the resulting event row(s). Defaults to
   *  `'user'`. Coerced `precise→false` transitions (when the base
   *  pair drops without the caller asking) are always recorded as
   *  `'system'` regardless of this value. */
  source?: ConsentEventSource;
  /** Optional free-text note attached to every event row this update
   *  produces. Must NEVER contain PII — the column is intended to
   *  be safe to surface in the future audit viewer. */
  note?: string | null;
}

/** One row from `ai_consent_events`, normalised to camelCase for the
 *  TypeScript layer. */
export interface ConsentEvent {
  id: string;
  userId: string;
  flagName: ConsentEventFlag;
  fromValue: boolean;
  toValue: boolean;
  source: ConsentEventSource;
  note: string | null;
  changedAt: string;
}

export interface ConsentHistoryOptions {
  /** Number of newest events to return. Defaults to 100, clamped
   *  to `[1, 500]`. */
  limit?: number;
  /** Standard pagination offset. Defaults to 0. */
  offset?: number;
  /** When set, restrict to one flag's transitions. Useful for the
   *  per-flag timeline view. */
  flagName?: ConsentEventFlag;
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
export const getConsentStatus = async (pool: Queryable, userId: string): Promise<ConsentStatus> => {
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
export const getConsentLevel = async (pool: Queryable, userId: string): Promise<ConsentLevel> =>
  (await getConsentStatus(pool, userId)).level;

/**
 * Same as {@link getConsentStatus} but also returns the per-flag
 * `_at` timestamps. Returns `null` when the user has no profile row,
 * so the route layer can map that to a 404 instead of pretending a
 * never-consented user exists.
 */
export const getConsentDetails = async (
  pool: Queryable,
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

interface FlagChange {
  column: string;
  atColumn: string;
  newValue: boolean;
  flagName: ConsentEventFlag;
  fromValue: boolean;
  source: ConsentEventSource;
}

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
 *    create an inconsistent row. The coerced transition is recorded
 *    with `source='system'` so the timeline distinguishes it from a
 *    user-initiated revoke.
 *  - If the caller explicitly tries to set `preciseValues=true` while
 *    `personal` or `thirdParty` is (or becomes) false, we throw
 *    `ConsentMutationError('invalid_precise')` so the UI sees a clean
 *    400 rather than silently dropping the request.
 *  - For each flag whose value actually changed, the matching `_at`
 *    column is set to NOW() **and** a row is appended to
 *    `ai_consent_events` recording the from→to transition. Unchanged
 *    flags leave both the timestamp and the history alone.
 *  - The UPDATE + N INSERTs run inside a single transaction so the
 *    compliance trail never drifts from the live consent state.
 *
 * Throws {@link ConsentMutationError} with `code='profile_not_found'`
 * when the user has no `patient_profiles` row.
 */
export const updateConsent = async (
  pool: Pool,
  userId: string,
  input: ConsentUpdateInput,
  options: ConsentUpdateOptions = {},
): Promise<ConsentDetails> => {
  if (!userId) {
    throw new ConsentMutationError('userId is required', 'profile_not_found');
  }

  const callerSource: ConsentEventSource = options.source ?? 'user';
  const note: string | null = options.note ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await getConsentDetails(client, userId);
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

    // A precise→false transition is "coerced" (and recorded as
    // source=system) only when the caller didn't ask for it AND it
    // happened because the base pair dropped. A direct
    // `preciseValues: false` from the caller still counts as a user
    // revoke.
    const isCoercedPrecise =
      explicitPrecise === undefined &&
      nextPrecise !== current.flags.preciseValues &&
      (!nextPersonal || !nextThirdParty);

    const changes: FlagChange[] = [];
    if (nextPersonal !== current.flags.personal) {
      changes.push({
        column: 'ai_consent_personal',
        atColumn: 'ai_consent_personal_at',
        newValue: nextPersonal,
        flagName: 'personal',
        fromValue: current.flags.personal,
        source: callerSource,
      });
    }
    if (nextThirdParty !== current.flags.thirdParty) {
      changes.push({
        column: 'ai_consent_third_party',
        atColumn: 'ai_consent_third_party_at',
        newValue: nextThirdParty,
        flagName: 'third_party',
        fromValue: current.flags.thirdParty,
        source: callerSource,
      });
    }
    if (nextPrecise !== current.flags.preciseValues) {
      changes.push({
        column: 'ai_consent_precise_values',
        atColumn: 'ai_consent_precise_values_at',
        newValue: nextPrecise,
        flagName: 'precise_values',
        fromValue: current.flags.preciseValues,
        source: isCoercedPrecise ? 'system' : callerSource,
      });
    }

    if (changes.length === 0) {
      // No flag transitioned — idempotent call. Commit the empty
      // transaction (so we don't leak an open one) and return the
      // current state. No event row is appended.
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
    await client.query(
      `UPDATE patient_profiles
          SET ${setClauses.join(', ')}
        WHERE user_id = $${values.length}`,
      values,
    );

    // One event row per transition. We pass the from/to booleans
    // explicitly so the row reflects the actual before/after even if
    // the patient_profiles columns later drift or are renamed.
    for (const change of changes) {
      await client.query(
        `INSERT INTO ai_consent_events
            (user_id, flag_name, from_value, to_value, source, note)
          VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, change.flagName, change.fromValue, change.newValue, change.source, note],
      );
    }

    const refreshed = await getConsentDetails(client, userId);
    if (!refreshed) {
      // Race with profile deletion. Surface the same shape as the
      // initial lookup did.
      throw new ConsentMutationError('Patient profile not found', 'profile_not_found');
    }

    await client.query('COMMIT');
    return refreshed;
  } catch (error) {
    // Best-effort rollback; swallow rollback errors so the original
    // exception is what bubbles up.
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Pick the redaction mode that pairs with a given consent level.
 * Co-located with the consent checker so the mapping lives in
 * one place — the redactor reads it, the audit logger records it,
 * the orchestrator drives it.
 */
export const redactionModeForConsent = (level: ConsentLevel): 'strict' | 'precise' =>
  level === 'precise' ? 'precise' : 'strict';

/**
 * Read the grant/revoke history for one user, newest first.
 *
 * Backed by `ai_consent_events` (db/migrations/009). Each row records
 * a single flag transition (`from_value`→`to_value`) with its source
 * (`user` / `admin` / `system`) so support + compliance can
 * reconstruct the exact timeline even when a flag was toggled back
 * and forth — something the per-flag `_at` timestamps on
 * `patient_profiles` cannot do alone (they only retain the most
 * recent transition per flag).
 *
 * Returns an empty list when the user has no events yet, so callers
 * can render an empty state without an extra "exists?" branch. An
 * empty `userId` short-circuits to `[]` for the same reason
 * {@link getConsentStatus} short-circuits to `none`.
 */
export const getConsentHistory = async (
  pool: Queryable,
  userId: string,
  options: ConsentHistoryOptions = {},
): Promise<ConsentEvent[]> => {
  if (!userId) return [];

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters = ['user_id = $1'];
  const values: unknown[] = [userId];
  if (options.flagName) {
    filters.push(`flag_name = $${values.length + 1}`);
    values.push(options.flagName);
  }
  values.push(limit);
  values.push(offset);

  const result = await pool.query<ConsentEventRow>(
    `SELECT id, user_id, flag_name, from_value, to_value, source, note, changed_at
       FROM ai_consent_events
      WHERE ${filters.join(' AND ')}
      ORDER BY changed_at DESC, id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}`,
    values,
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    flagName: row.flag_name as ConsentEventFlag,
    fromValue: Boolean(row.from_value),
    toValue: Boolean(row.to_value),
    source: row.source as ConsentEventSource,
    note: row.note,
    changedAt: formatTimestamp(row.changed_at) ?? '',
  }));
};
