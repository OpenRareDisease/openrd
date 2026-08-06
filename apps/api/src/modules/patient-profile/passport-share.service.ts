import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool, QueryResult } from 'pg';

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

/* ---------------------------------------------------------------- *
 * Pickup codes — see db/migrations/024_passport_pickup_codes.sql.
 *
 * A URL is right for WeChat and wrong across a consulting-room desk,
 * where there is no chat window between the two people and the patient
 * ends up holding a phone at someone else's reading distance — with the
 * grip and the raised arm this disease takes first. A pickup code is
 * eight characters they say out loud instead.
 * ---------------------------------------------------------------- */

/**
 * Crockford base32: no I, L, O or U.
 *
 * I/L/O are out because this alphabet's whole job is to survive being
 * spoken across a desk and typed by someone who is not looking at it —
 * 「1」/「I」/「l」 and 「0」/「O」 are the two mistakes that flow makes,
 * and the normalizer below folds them back rather than failing. U is
 * out so a random draw cannot spell something a patient has to read
 * aloud to their doctor.
 */
export const PICKUP_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/**
 * Eight, not six.
 *
 * Six would be 32^6 ≈ 1.1e9. A wrong code matches no row, so the
 * attempt counter cannot bound wrong-code guessing at all — there is
 * nothing to count on — and the only bound left is the size of the
 * space itself, against a public unauthenticated endpoint. 32^8 ≈
 * 1.1e12 is three orders of magnitude better for the cost of two more
 * characters, and it is still two spoken groups of four.
 */
export const PICKUP_CODE_LENGTH = 8;
/** Longer than the walk from the waiting room, shorter than the next
 *  patient's appointment. A pickup code is a password if it lives for
 *  days, so it does not get to. */
export const PICKUP_TTL_MINUTES = 15;
/** Three wrong birthdates and the code is dead. Counted on the row —
 *  see the migration comment for why an IP bucket cannot do this job
 *  when a hospital is one IP. */
export const MAX_PICKUP_ATTEMPTS = 3;

/** What the patient has to be told about a code they can still use. */
export type PassportPickupState = {
  expiresAt: string;
  attempts: number;
  redeemedAt: string | null;
  burnedAt: string | null;
};

export type PassportShareLink = {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  openedCount: number;
  lastOpenedAt: string | null;
  /** Non-null when this row is a pickup code rather than a URL share.
   *  The two are the same kind of door and belong in the same list, but
   *  they are not interchangeable on screen: one was forwarded in
   *  WeChat and one was read out loud. */
  pickup: PassportPickupState | null;
  /** Present ONLY in the response that created it. See the class note. */
  token?: string;
  /** Present ONLY in the response that created a pickup code. Same rule
   *  as `token`: the server keeps a digest and cannot reissue this. */
  code?: string;
};

export class ShareLimitReachedError extends Error {
  constructor() {
    super(`最多同时保留 ${MAX_LIVE_SHARES} 个有效链接，请先撤销一个再新建。`);
    this.name = 'ShareLimitReachedError';
  }
}

/**
 * The patient has no date of birth on file, so the second factor has
 * nothing to compare against.
 *
 * This refuses rather than degrades. A pickup code that accepts any
 * birthdate is not a weaker version of this feature — it is a code with
 * one factor that the screen would still describe as having two, which
 * is the exact class of lie this repo has shipped before.
 */
export class PickupNeedsBirthDateError extends Error {
  constructor() {
    super('取件码需要用出生日期来核对身份。请先在「基础档案」里填写出生日期，再生成取件码。');
    this.name = 'PickupNeedsBirthDateError';
  }
}

/**
 * Fold what a human typed back onto the alphabet, or reject it.
 *
 * Crockford's decoding rules, and they are the point of choosing this
 * alphabet: case is irrelevant, I and L read as 1, O reads as 0, and
 * separators are noise. A doctor who types 「o5fj-9lt7」 from a code
 * that was spoken as 「0 5 F J 9 1 T 7」 gets in, which is what we want,
 * because the alternative is a failed attempt burnt on a transcription
 * error rather than on an attack.
 *
 * Returns null — never a partially-cleaned string — for anything that
 * is not exactly PICKUP_CODE_LENGTH alphabet characters after folding.
 */
export const normalizePickupCode = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const folded = raw
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/[^0-9A-Z]/g, '');
  if (folded.length !== PICKUP_CODE_LENGTH) return null;
  for (const ch of folded) {
    if (!PICKUP_ALPHABET.includes(ch)) return null;
  }
  return folded;
};

/** 「K7F3-9QTM」. Two groups of four, because that is how a person reads
 *  eight characters out loud without losing their place. */
export const formatPickupCode = (code: string): string =>
  code.length === PICKUP_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

/**
 * Accept a birthdate in whatever shape it arrived and return an ISO
 * day, or null.
 *
 * The redemption page has no JavaScript (see passport-share.html.ts),
 * so this cannot lean on `<input type="date">` being honoured by an
 * ageing hospital Android or WeChat's X5 webview. It takes the digits
 * and ignores everything else, so 「1985-03-12」, 「1985/3/12」 and
 * 「19850312」 are all the same input.
 *
 * The round-trip through Date is not decoration: 「19850231」 parses as
 * eight digits and is not a day, and accepting it would spend one of
 * the three attempts on a date that could never have matched.
 */
export const normalizeBirthDate = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.length > 32) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1900 || year > 2100) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
};

/**
 * Draw a code from the alphabet without bias.
 *
 * 256 % 32 === 0, so a raw byte modulo 32 is uniform — this is one of
 * the few cases where the modulo shortcut is not a bug, and it is
 * written down here so nobody "fixes" it into a rejection loop or,
 * worse, copies the pattern to an alphabet where it is wrong.
 */
const drawPickupCode = (): string => {
  const bytes = randomBytes(PICKUP_CODE_LENGTH);
  let out = '';
  for (const byte of bytes) out += PICKUP_ALPHABET[byte % PICKUP_ALPHABET.length];
  return out;
};

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

/**
 * The pickup half of a joined row, or null when this share is a plain
 * URL link.
 *
 * Enumerated field by field rather than spread. The row this comes from
 * is a join across two tables, and the moment either grows a column
 * that is not for the client, a spread would ship it without anyone
 * touching this file.
 */
const toPickup = (row: Record<string, unknown>): PassportPickupState | null => {
  if (!row.pickup_expires_at) return null;
  return {
    expiresAt: toIso(row.pickup_expires_at),
    attempts: Number(row.pickup_attempts ?? 0),
    redeemedAt: row.pickup_redeemed_at ? toIso(row.pickup_redeemed_at) : null,
    burnedAt: row.pickup_burned_at ? toIso(row.pickup_burned_at) : null,
  };
};

const toRow = (row: Record<string, unknown>): PassportShareLink => ({
  id: String(row.id),
  label: row.label === null || row.label === undefined ? null : String(row.label),
  createdAt: toIso(row.created_at),
  expiresAt: toIso(row.expires_at),
  revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
  openedCount: Number(row.opened_count ?? 0),
  lastOpenedAt: row.last_opened_at ? toIso(row.last_opened_at) : null,
  pickup: toPickup(row),
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
  /**
   * MAX_LIVE_SHARES applies to every kind of door, not just URLs.
   *
   * Shared by `create` and `createPickup` on purpose: two copies of
   * this predicate is how one of them ends up counting only links, and
   * the cap is a comprehension limit on the revoke screen — a screen
   * that shows both.
   */
  private async assertLiveShareCapacity(userId: string): Promise<void> {
    const live = await this.pool.query(
      `SELECT count(*)::int AS n
         FROM passport_share_links
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [userId],
    );
    if (Number(live.rows[0]?.n ?? 0) >= MAX_LIVE_SHARES) throw new ShareLimitReachedError();
  }

  async create(
    userId: string,
    input: { label?: string | null; days?: number } = {},
  ): Promise<PassportShareLink> {
    await this.assertLiveShareCapacity(userId);

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
    // LEFT JOIN, so a pickup code is one row in this list rather than a
    // second list somewhere else. 「谁现在能看我的记录」 is only an
    // answer if it covers every door; a code the patient read out ten
    // minutes ago is a door. The join is single-valued because
    // idx_passport_pickup_share is unique — see the migration.
    const result = await this.pool.query(
      `SELECT s.id, s.label, s.created_at, s.expires_at, s.revoked_at,
              s.opened_count, s.last_opened_at,
              p.expires_at  AS pickup_expires_at,
              p.attempts    AS pickup_attempts,
              p.redeemed_at AS pickup_redeemed_at,
              p.burned_at   AS pickup_burned_at
         FROM passport_share_links s
         LEFT JOIN passport_pickup_codes p ON p.share_id = s.id
        WHERE s.user_id = $1
        ORDER BY s.created_at DESC
        LIMIT 50`,
      [userId],
    );
    return result.rows.map(toRow);
  }

  /**
   * Mint a pickup code. Returns the row WITH the plaintext code — the
   * only time it exists outside the patient's screen.
   *
   * One statement, two inserts. Not for speed: a share row that got
   * created while the pickup insert failed would be a live 021 link
   * with a token nobody holds, counting against the patient's cap for
   * fifteen minutes and appearing in the revoke list as a share they
   * never made. A CTE makes both rows land or neither.
   */
  async createPickup(
    userId: string,
    input: { label?: string | null } = {},
  ): Promise<PassportShareLink & { code: string }> {
    await this.assertLiveShareCapacity(userId);

    // Checked before minting, not at redemption. A code whose second
    // factor can never match is a code the patient reads out in the
    // appointment and watches fail, having been told on the previous
    // screen that the doctor just needs their birthday.
    const dob = await this.pool.query(
      `SELECT date_of_birth FROM patient_profiles WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    if (!dob.rows[0]?.date_of_birth) throw new PickupNeedsBirthDateError();

    const label = input.label?.trim() ? input.label.trim().slice(0, 60) : null;

    // The parent row's token is generated, hashed and dropped inside
    // this function. It exists because passport_share_links.token_hash
    // is NOT NULL and unique, not because anyone is meant to have it —
    // no route returns it, so a pickup row has no URL holder and is
    // reachable only through redeemPickup.
    const orphanTokenHash = hashToken(randomBytes(TOKEN_BYTES).toString('base64url'));

    // Retry rather than trust 40 bits never to collide: the unique
    // index on code_hash is what keeps redemption from updating two
    // rows, so a collision has to be a retry and not a 500.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = drawPickupCode();
      let inserted: QueryResult;
      try {
        inserted = await this.pool.query(
          `WITH s AS (
             INSERT INTO passport_share_links (user_id, token_hash, label, expires_at)
             VALUES ($1, $2, $3, NOW() + ($5 || ' minutes')::interval)
             RETURNING id, label, created_at, expires_at, revoked_at,
                       opened_count, last_opened_at
           ),
           p AS (
             INSERT INTO passport_pickup_codes (share_id, code_hash, expires_at)
             SELECT s.id, $4, s.expires_at FROM s
             RETURNING share_id, expires_at, attempts, redeemed_at, burned_at
           )
           SELECT s.id, s.label, s.created_at, s.expires_at, s.revoked_at,
                  s.opened_count, s.last_opened_at,
                  p.expires_at  AS pickup_expires_at,
                  p.attempts    AS pickup_attempts,
                  p.redeemed_at AS pickup_redeemed_at,
                  p.burned_at   AS pickup_burned_at
             FROM s JOIN p ON p.share_id = s.id`,
          [userId, orphanTokenHash, label, hashToken(code), String(PICKUP_TTL_MINUTES)],
        );
      } catch (error) {
        if ((error as { code?: string })?.code === '23505' && attempt < 4) continue;
        throw error;
      }

      // Same rule as a share link: the audit row records that a code
      // was minted and how long it lives. It does NOT record the code.
      await this.pool.query(
        `INSERT INTO audit_logs (event_type, event_payload)
         VALUES ('passport_pickup_created', $1::jsonb)`,
        [
          JSON.stringify({
            userId,
            shareId: inserted.rows[0].id,
            ttlMinutes: PICKUP_TTL_MINUTES,
          }),
        ],
      );

      return { ...toRow(inserted.rows[0]), code };
    }
    // Unreachable: the loop either returns or rethrows. Present so a
    // future edit to the retry bound cannot fall out of the function
    // with an implicit undefined.
    throw new Error('无法生成取件码，请重试');
  }

  /**
   * Redeem a code plus a birthdate, count the attempt, and burn the
   * code on the third wrong one — all in one statement.
   *
   * Same reason as `resolve`: a read followed by a separate update
   * leaves a window. Here the window would be worse than a stale
   * revocation, because the thing being written IS the bound — two
   * redemptions racing through a gap between SELECT and UPDATE would
   * both be "single use", and three concurrent guesses would each see
   * attempts=0.
   *
   * Returns null for every failure: wrong code, wrong birthdate,
   * expired, burned, already redeemed, revoked parent, never existed.
   * The caller cannot tell them apart because there is nothing in the
   * return value to tell them apart WITH — 「这个码不存在」 versus
   * 「密码错了」 tells a guesser that they guessed a real patient.
   */
  async redeemPickup(
    rawCode: unknown,
    rawBirthDate: unknown,
  ): Promise<{ userId: string; shareId: string } | null> {
    const code = normalizePickupCode(rawCode);
    const birthDate = normalizeBirthDate(rawBirthDate);
    // Both rejected before touching the database. A malformed code
    // cannot match any row anyway, and a malformed date would spend one
    // of the three attempts on something that could never have matched.
    if (!code || !birthDate) return null;

    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT p.id,
                p.share_id,
                s.user_id,
                (pr.date_of_birth IS NOT NULL AND pr.date_of_birth = $2::date) AS dob_ok
           FROM passport_pickup_codes p
           JOIN passport_share_links s ON s.id = p.share_id
           LEFT JOIN patient_profiles pr ON pr.user_id = s.user_id
          WHERE p.code_hash = $1
            AND p.redeemed_at IS NULL
            AND p.burned_at IS NULL
            AND p.expires_at > NOW()
            AND p.attempts < $3
            AND s.revoked_at IS NULL
            AND s.expires_at > NOW()
       ),
       spent AS (
         UPDATE passport_pickup_codes p
            SET attempts    = CASE WHEN c.dob_ok THEN p.attempts ELSE p.attempts + 1 END,
                redeemed_at = CASE WHEN c.dob_ok THEN NOW() ELSE NULL END,
                burned_at   = CASE WHEN NOT c.dob_ok AND p.attempts + 1 >= $3
                                   THEN NOW() ELSE NULL END
           FROM candidate c
          WHERE p.id = c.id
            -- Re-checked here, not only in the CTE above. Under READ
            -- COMMITTED a concurrent redemption of the same code makes
            -- Postgres re-evaluate THIS predicate against the row it
            -- just locked, while the 「candidate」 CTE still holds the older
            -- snapshot. Without these three lines two simultaneous
            -- submissions could both come back "single use".
            AND p.redeemed_at IS NULL
            AND p.burned_at IS NULL
            AND p.attempts < $3
          RETURNING p.id, p.share_id, c.user_id, c.dob_ok
       ),
       opened AS (
         UPDATE passport_share_links s
            SET opened_count = s.opened_count + 1, last_opened_at = NOW()
           FROM spent
          WHERE s.id = spent.share_id AND spent.dob_ok
          RETURNING s.id
       )
       SELECT user_id, share_id, dob_ok FROM spent`,
      [hashToken(code), birthDate, MAX_PICKUP_ATTEMPTS],
    );

    const row = result.rows[0];
    if (!row || row.dob_ok !== true) return null;
    return { userId: String(row.user_id), shareId: String(row.share_id) };
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
