import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';

import type { AppLogger } from '../../config/logger.js';

/**
 * Short-lived, revocable, read-only shares of one patient's clinical
 * passport.
 *
 * See db/migrations/021_passport_share_links.sql for why this exists
 * and what it is careful about. This module owns the two invariants the
 * table can only half-enforce:
 *
 *   1. The plaintext token exists exactly once, in the response to the
 *      call that created it. Nothing stores it, nothing logs it, and it
 *      is not recoverable — a patient who loses the link makes a new
 *      one, which is also the safer behaviour.
 *   2. Resolution is by hash and checks expiry and revocation in the
 *      same statement, so there is no window where a revoked link still
 *      resolves because two queries disagreed.
 */

/** Ceiling on how long a share can live. Not a preference — a share is
 *  a publication of a medical record to whoever holds the URL, made by
 *  someone who was thinking about one appointment. Thirty days is
 *  already generous for「下周三复诊」. */
export const MAX_SHARE_DAYS = 30;
/** What the patient gets if they do not choose. One clinic visit, plus
 *  the week where they forget they made it. */
export const DEFAULT_SHARE_DAYS = 7;
/**
 * How many live links one account may hold.
 *
 * Not an abuse limit — it is a comprehension limit. The revoke screen
 * is the patient's only view of who can currently read their record,
 * and a list nobody reads is not control. Hitting the cap is a prompt
 * to revoke something, which is the behaviour worth encouraging.
 */
export const MAX_LIVE_SHARES = 5;

const TOKEN_BYTES = 32;

export type PassportShareLink = {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  openedCount: number;
  lastOpenedAt: string | null;
  /** Present ONLY in the response that created it. See the class note. */
  token?: string;
};

export class ShareLimitReachedError extends Error {
  constructor() {
    super(`最多同时保留 ${MAX_LIVE_SHARES} 个有效链接，请先撤销一个再新建。`);
    this.name = 'ShareLimitReachedError';
  }
}

const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * Compare two hex digests without leaking, through timing, how much of
 * a guess was right.
 *
 * The lookup below is an indexed equality on the hash, so the database
 * has already made its own timing decisions and this is belt-and-braces
 * — but it costs nothing and it means a future change to a scan-based
 * lookup does not silently become an oracle.
 */
export const digestsMatch = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
};

const toIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

const toRow = (row: Record<string, unknown>): PassportShareLink => ({
  id: String(row.id),
  label: row.label === null || row.label === undefined ? null : String(row.label),
  createdAt: toIso(row.created_at),
  expiresAt: toIso(row.expires_at),
  revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
  openedCount: Number(row.opened_count ?? 0),
  lastOpenedAt: row.last_opened_at ? toIso(row.last_opened_at) : null,
});

export class PassportShareService {
  constructor(
    private readonly pool: Pool,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Mint a link. Returns the row WITH the plaintext token — the only
   * time it exists outside the patient's clipboard.
   */
  async create(
    userId: string,
    input: { label?: string | null; days?: number } = {},
  ): Promise<PassportShareLink> {
    const live = await this.pool.query(
      `SELECT count(*)::int AS n
         FROM passport_share_links
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [userId],
    );
    if (Number(live.rows[0]?.n ?? 0) >= MAX_LIVE_SHARES) throw new ShareLimitReachedError();

    // Clamp rather than reject: a patient who typed 90 wants a long
    // link, and refusing the whole request teaches them nothing. The
    // response carries the real expiry, and the UI states it.
    const requested = Number.isFinite(input.days) ? Number(input.days) : DEFAULT_SHARE_DAYS;
    const days = Math.min(MAX_SHARE_DAYS, Math.max(1, Math.round(requested)));

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const label = input.label?.trim() ? input.label.trim().slice(0, 60) : null;

    const inserted = await this.pool.query(
      `INSERT INTO passport_share_links (user_id, token_hash, label, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval)
       RETURNING id, label, created_at, expires_at, revoked_at, opened_count, last_opened_at`,
      [userId, hashToken(token), label, String(days)],
    );

    // The audit row records that a share was created and for how long.
    // It does NOT record the token: an audit log that contains working
    // links is a second copy of the thing this design refuses to store.
    await this.pool.query(
      `INSERT INTO audit_logs (event_type, event_payload)
       VALUES ('passport_share_created', $1::jsonb)`,
      [JSON.stringify({ userId, shareId: inserted.rows[0].id, days })],
    );

    return { ...toRow(inserted.rows[0]), token };
  }

  /** Everything the patient has ever shared, newest first. Revoked and
   *  expired rows stay: 「我撤销过」 is part of what they are entitled
   *  to see, and hiding it would make the screen look like a list of
   *  mistakes they cannot prove they fixed. */
  async list(userId: string): Promise<PassportShareLink[]> {
    const result = await this.pool.query(
      `SELECT id, label, created_at, expires_at, revoked_at, opened_count, last_opened_at
         FROM passport_share_links
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [userId],
    );
    return result.rows.map(toRow);
  }

  /** Idempotent: revoking an already-revoked link is a success, because
   *  from the patient's side it is. Returns false only when the link is
   *  not theirs or does not exist. */
  async revoke(userId: string, shareId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE passport_share_links
          SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE id = $1 AND user_id = $2
        RETURNING id`,
      [shareId, userId],
    );
    if (result.rowCount === 0) return false;
    await this.pool.query(
      `INSERT INTO audit_logs (event_type, event_payload)
       VALUES ('passport_share_revoked', $1::jsonb)`,
      [JSON.stringify({ userId, shareId })],
    );
    return true;
  }

  /**
   * Resolve a token to the user whose passport it opens, and count the
   * open.
   *
   * Expiry and revocation are checked in the same statement that reads
   * the row, so a link revoked between two queries cannot slip through
   * the gap. Returns null for every failure — expired, revoked, never
   * existed — because the caller must not be able to tell those apart:
   * distinguishing 「已撤销」 from 「不存在」 tells whoever is guessing
   * that they guessed a real patient.
   */
  async resolve(token: string): Promise<{ userId: string; shareId: string } | null> {
    if (!token || token.length < 20 || token.length > 200) return null;
    const result = await this.pool.query(
      `UPDATE passport_share_links
          SET opened_count = opened_count + 1, last_opened_at = NOW()
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
        RETURNING id, user_id, token_hash`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (!digestsMatch(String(row.token_hash), hashToken(token))) {
      this.logger.error({ shareId: row.id }, 'passport share hash mismatch after indexed lookup');
      return null;
    }
    return { userId: String(row.user_id), shareId: String(row.id) };
  }
}
