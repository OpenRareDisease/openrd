/**
 * The agreement-acceptance ledger (migration 019).
 *
 * Two operations, both deliberately small: write one acceptance, read
 * back what a user has accepted. Everything policy-shaped —— which
 * documents are required, which version is current —— lives in
 * legal.constants.ts so this file stays a data-access layer and the
 * rules are readable in one place.
 *
 * The read returns the LATEST acceptance per document plus an
 * `outstanding` list. `outstanding` is the question every caller
 * actually has: the mobile consent gate asks 「这个用户还欠哪些同意」
 * before the first report upload, and a future re-consent prompt will
 * ask the same question after a policy revision.
 */

import type { Pool } from 'pg';

import {
  CONDITIONAL_DOCUMENTS,
  LEGAL_DOCUMENT_IDS,
  LEGAL_DOCUMENT_VERSIONS,
  LEGAL_IP_MAX_LENGTH,
  LEGAL_USER_AGENT_MAX_LENGTH,
  type LegalDocumentId,
} from './legal.constants.js';

export interface LegalAcceptance {
  document: LegalDocumentId;
  version: string;
  acceptedAt: string;
}

export interface LegalAcceptanceSummary {
  /** Latest acceptance per document, newest first. */
  acceptances: LegalAcceptance[];
  /** Version this build considers current, per document. */
  current: Record<LegalDocumentId, string>;
  /**
   * Documents the user has either never accepted, or accepted at a
   * version older than the current one. Both cases need the same
   * treatment (show the document, ask again), so they are one list.
   */
  outstanding: LegalDocumentId[];
}

export interface RecordAcceptanceInput {
  userId: string;
  document: LegalDocumentId;
  version: string;
  ip?: string | null;
  userAgent?: string | null;
}

interface AcceptanceRow {
  document: string;
  version: string;
  accepted_at: Date | string;
}

const formatTimestamp = (value: Date | string): string => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

/** Trim to the column's CHECK bound instead of letting Postgres reject
 *  the row. These two fields are evidence-grade context, not the point
 *  of the record; losing the tail of a User-Agent string must never be
 *  the reason a registration fails. */
const clamp = (value: string | null | undefined, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

const rowToAcceptance = (row: AcceptanceRow): LegalAcceptance => ({
  document: row.document as LegalDocumentId,
  version: row.version,
  acceptedAt: formatTimestamp(row.accepted_at),
});

/**
 * Record one acceptance.
 *
 * Idempotent by construction: the unique index on
 * (user_id, document, version) plus ON CONFLICT DO NOTHING means a
 * double tap, a retry over a flaky connection, or a user who re-reads
 * and re-accepts the same version all collapse into the first row —
 * and `acceptedAt` therefore keeps meaning 「第一次同意的时间」, which is
 * the timestamp a compliance question is about. The RETURNING clause is
 * empty on conflict, so the follow-up SELECT is what makes the call
 * return the same answer every time.
 */
export const recordAcceptance = async (
  pool: Pool,
  input: RecordAcceptanceInput,
): Promise<LegalAcceptance> => {
  const inserted = await pool.query<AcceptanceRow>(
    `INSERT INTO legal_document_acceptances (user_id, document, version, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, document, version) DO NOTHING
     RETURNING document, version, accepted_at`,
    [
      input.userId,
      input.document,
      input.version,
      clamp(input.ip, LEGAL_IP_MAX_LENGTH),
      clamp(input.userAgent, LEGAL_USER_AGENT_MAX_LENGTH),
    ],
  );

  if (inserted.rowCount) {
    return rowToAcceptance(inserted.rows[0]);
  }

  const existing = await pool.query<AcceptanceRow>(
    `SELECT document, version, accepted_at
       FROM legal_document_acceptances
      WHERE user_id = $1 AND document = $2 AND version = $3
      LIMIT 1`,
    [input.userId, input.document, input.version],
  );

  if (existing.rowCount) {
    return rowToAcceptance(existing.rows[0]);
  }

  // Neither branch produced a row. The only way here is a concurrent
  // DELETE between the INSERT and the SELECT — i.e. the account was
  // purged mid-request. Fail loudly rather than returning a fabricated
  // timestamp for a record that does not exist.
  throw new Error(
    `Failed to record acceptance of ${input.document}@${input.version}: no row after upsert`,
  );
};

/**
 * What has this user accepted, and what do they still owe?
 *
 * DISTINCT ON keeps one row per document — the newest — which is what
 * both callers want; the full history is available by querying the
 * table directly and is not exposed over HTTP, because nothing needs
 * it yet and every extra field on a consent endpoint is surface area.
 */
export const getAcceptanceSummary = async (
  pool: Pool,
  userId: string,
): Promise<LegalAcceptanceSummary> => {
  const result = await pool.query<AcceptanceRow>(
    `SELECT DISTINCT ON (document) document, version, accepted_at
       FROM legal_document_acceptances
      WHERE user_id = $1
      ORDER BY document, accepted_at DESC`,
    [userId],
  );

  const acceptances = result.rows
    .map(rowToAcceptance)
    .sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));

  const latestByDocument = new Map(acceptances.map((item) => [item.document, item]));
  const outstanding = LEGAL_DOCUMENT_IDS.filter((document) => {
    // A conditional document is only outstanding once the user has
    // shown it applies to them by accepting it at all — after that a
    // stale version does need re-consent. Never having accepted it is
    // the normal state for most accounts, not a debt.
    const latest = latestByDocument.get(document);
    if (CONDITIONAL_DOCUMENTS.includes(document)) {
      return Boolean(latest) && latest?.version !== LEGAL_DOCUMENT_VERSIONS[document];
    }
    return !latest || latest.version !== LEGAL_DOCUMENT_VERSIONS[document];
  });

  return {
    acceptances,
    current: { ...LEGAL_DOCUMENT_VERSIONS },
    outstanding: [...outstanding],
  };
};

/**
 * Has this user given the Art. 29 单独同意 for sensitive personal
 * information, at any version?
 *
 * Version-insensitive on purpose, and this is the one place where that
 * is the right call: an outdated sensitive-PI consent should prompt a
 * re-confirmation (which `outstanding` drives), but it must not make
 * the API behave as though the user never consented and start refusing
 * access to reports they already uploaded under the older text.
 */
export const hasAcceptedDocument = async (
  pool: Pool,
  userId: string,
  document: LegalDocumentId,
): Promise<boolean> => {
  const result = await pool.query(
    `SELECT 1
       FROM legal_document_acceptances
      WHERE user_id = $1 AND document = $2
      LIMIT 1`,
    [userId, document],
  );
  return (result.rowCount ?? 0) > 0;
};
