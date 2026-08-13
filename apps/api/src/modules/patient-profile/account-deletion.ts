import type { Pool } from 'pg';

import type { AppLogger } from '../../config/logger.js';
import { AUDIT_IDENTITY_KEYS, maskAuditPayload } from '../../services/audit/identity-masking.js';
import { normalizePhone } from '../../utils/phone.js';

/**
 * Account deletion with a cooling-off period (删除权 / right to
 * erasure).
 *
 * Lifecycle: request → 7-day cooling-off (cancellable) → purge.
 * The purge deletes the app_users row inside one transaction —
 * patient_profiles and every patient_* table cascade from it — plus
 * the legacy chat tables whose FKs predate ON DELETE clauses and
 * would otherwise veto the user DELETE. Uploaded files are removed
 * AFTER the transaction commits: the DB is the source of truth, and
 * an orphaned file is recoverable garbage while a dangling DB row is
 * a broken account.
 *
 * account_deletion_requests deliberately has no FK to app_users —
 * its rows are the compliance ledger proving the deletion happened,
 * so they must survive the very DELETE they describe. audit_logs is in
 * the same category and is tombstoned rather than deleted; see the
 * UPDATE inside purgeDueAccountDeletions for why.
 */

export const ACCOUNT_DELETION_COOLING_DAYS = 7;

/**
 * `event_payload - 'phoneNumber' - 'email' - …`, built from the single
 * list of identifier-bearing keys so a new audit field cannot be masked
 * at write time and then forgotten here.
 *
 * Interpolated into SQL rather than parameterised because jsonb's `-`
 * operator takes a key literal, not a bind slot. Safe only because
 * AUDIT_IDENTITY_KEYS is a frozen `as const` tuple of compile-time
 * literals — never widen it to anything derived from input.
 */
const AUDIT_PAYLOAD_STRIP_EXPR = AUDIT_IDENTITY_KEYS.map((key) => `- '${key}'`).join(' ');

/** How often the purge sweep re-runs after the startup pass. */
export const DELETION_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface DeletionRequestStatus {
  status: 'pending' | 'cancelled' | 'purged';
  requestedAt: string;
  scheduledPurgeAt: string;
  cancelledAt: string | null;
}

interface DeletionRow {
  status: 'pending' | 'cancelled' | 'purged';
  requested_at: Date;
  scheduled_purge_at: Date;
  cancelled_at: Date | null;
}

const toStatus = (row: DeletionRow): DeletionRequestStatus => ({
  status: row.status,
  requestedAt: row.requested_at.toISOString(),
  scheduledPurgeAt: row.scheduled_purge_at.toISOString(),
  cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
});

/** Failure modes carry a `code` so the controller picks an HTTP
 *  status without string-matching (mirrors ConsentMutationError). */
export class DeletionRequestError extends Error {
  constructor(
    message: string,
    public readonly code: 'already_pending' | 'not_pending' | 'phone_mismatch',
  ) {
    super(message);
    this.name = 'DeletionRequestError';
  }
}

/**
 * Open a deletion request. `confirmPhoneNumber` must match the
 * account's registered number exactly — the destructive path demands
 * the user retype it, not just tap a button.
 */
export const requestAccountDeletion = async (
  pool: Pool,
  userId: string,
  confirmPhoneNumber: string,
): Promise<DeletionRequestStatus> => {
  const userResult = await pool.query<{ phone_number: string }>(
    'SELECT phone_number FROM app_users WHERE id = $1',
    [userId],
  );
  // normalizePhone on BOTH sides: accounts store the app's +86 form,
  // but a user retyping their number naturally writes bare digits —
  // strict string equality would lock them out of their own deletion
  // right (the exact bug the OTP allowlist had).
  const registered = userResult.rows[0]?.phone_number;
  if (!registered || normalizePhone(registered) !== normalizePhone(confirmPhoneNumber)) {
    throw new DeletionRequestError('手机号与账号不匹配', 'phone_mismatch');
  }

  const existing = await pool.query<DeletionRow>(
    `SELECT status, requested_at, scheduled_purge_at, cancelled_at
     FROM account_deletion_requests
     WHERE user_id = $1 AND status = 'pending'`,
    [userId],
  );
  if (existing.rows.length > 0) {
    throw new DeletionRequestError('已有进行中的注销申请', 'already_pending');
  }

  const inserted = await pool.query<DeletionRow>(
    `INSERT INTO account_deletion_requests (user_id, scheduled_purge_at)
     VALUES ($1, NOW() + make_interval(days => $2))
     RETURNING status, requested_at, scheduled_purge_at, cancelled_at`,
    [userId, ACCOUNT_DELETION_COOLING_DAYS],
  );
  return toStatus(inserted.rows[0]);
};

/** Cancel the pending request (any time before the purge sweep picks
 *  it up). */
export const cancelAccountDeletion = async (
  pool: Pool,
  userId: string,
): Promise<DeletionRequestStatus> => {
  const updated = await pool.query<DeletionRow>(
    `UPDATE account_deletion_requests
     SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND status = 'pending'
     RETURNING status, requested_at, scheduled_purge_at, cancelled_at`,
    [userId],
  );
  if (updated.rows.length === 0) {
    throw new DeletionRequestError('没有进行中的注销申请', 'not_pending');
  }
  return toStatus(updated.rows[0]);
};

/** Latest request in any state (pending → banner + cancel button;
 *  null → nothing to show). */
export const getAccountDeletionStatus = async (
  pool: Pool,
  userId: string,
): Promise<DeletionRequestStatus | null> => {
  const result = await pool.query<DeletionRow>(
    `SELECT status, requested_at, scheduled_purge_at, cancelled_at
     FROM account_deletion_requests
     WHERE user_id = $1
     ORDER BY requested_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows.length > 0 ? toStatus(result.rows[0]) : null;
};

/**
 * Purge every due request. Returns the number of accounts purged.
 * Called from the startup sweep and the periodic interval — both
 * single-instance assumptions, same as the OCR job map.
 *
 * `removeFile` failures do not fail the purge — by the time we call it
 * the DB commit already made the deletion authoritative — but they are
 * counted into an `account.purge_files_orphaned` audit row, because a
 * purge the ledger records as complete while files survive it is a
 * PIPL Art. 47 gap and not just an operational one.
 */
export const purgeDueAccountDeletions = async (
  pool: Pool,
  removeFile: (storageUri: string) => Promise<void>,
  logger: AppLogger,
): Promise<number> => {
  const due = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id
     FROM account_deletion_requests
     WHERE status = 'pending' AND scheduled_purge_at <= NOW()`,
  );

  let purged = 0;
  for (const request of due.rows) {
    const client = await pool.connect();
    let fileUris: string[] = [];
    try {
      await client.query('BEGIN');

      const files = await client.query<{ storage_uri: string }>(
        `SELECT d.storage_uri
         FROM patient_documents d
         JOIN patient_profiles p ON p.id = d.profile_id
         WHERE p.user_id = $1`,
        [request.user_id],
      );
      fileUris = files.rows.map((row) => row.storage_uri);

      // Legacy chat tables (migration 003) reference app_users with
      // no ON DELETE clause — clear them first or the user DELETE is
      // vetoed.
      await client.query(
        `DELETE FROM chat_messages
         WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = $1)`,
        [request.user_id],
      );
      await client.query('DELETE FROM chat_sessions WHERE user_id = $1', [request.user_id]);
      await client.query('DELETE FROM patient_statements WHERE user_id = $1', [request.user_id]);

      await client.query(
        `UPDATE account_deletion_requests
         SET status = 'purged', purged_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [request.id],
      );

      // Everything keyed by phone number rather than by user_id, which
      // no cascade can reach.
      //
      // A purge that leaves these behind does not do what the ledger
      // two statements above says it did. On a rare-disease registry a
      // phone number is not incidental — it is the account's primary
      // identifier and, against a population this small, a
      // re-identifier. Read it before the user row goes, because after
      // the DELETE there is nothing left to read it from.
      const identity = await client.query<{ phone_number: string | null; email: string | null }>(
        'SELECT phone_number, email FROM app_users WHERE id = $1',
        [request.user_id],
      );
      const phoneNumber = identity.rows[0]?.phone_number ?? null;
      const email = identity.rows[0]?.email ?? null;

      if (phoneNumber) {
        await client.query('DELETE FROM otp_verification_codes WHERE phone_number = $1', [
          phoneNumber,
        ]);
        await client.query('DELETE FROM auth_otps WHERE phone_number = $1', [phoneNumber]);
        await client.query('DELETE FROM auth_login_guards WHERE identifier = $1', [phoneNumber]);
      }
      if (email) {
        await client.query('DELETE FROM auth_login_guards WHERE identifier = $1', [email]);
      }

      // audit_logs: TOMBSTONE, do not delete.
      //
      // These rows are the compliance trail — 「this account registered
      // on that date, failed login N times, requested deletion」 — and
      // deleting them destroys the evidence that the deletion itself was
      // handled correctly, which is the one record a PIPL Art. 47
      // complaint or an app-store data-deletion review actually asks to
      // see. So the row survives and the identifiers inside it do not:
      // phoneNumber / email / identifier / ip / userAgent are stripped
      // and a `subjectPurgedAt` marker is written in their place.
      //
      // `userId` deliberately stays. Once app_users is gone that UUID
      // resolves to nothing and re-identifies no one, but it is what
      // still lets an auditor tell「one account, forty failed logins」
      // from「forty accounts, one each」.
      //
      // Three WHERE branches because nothing here is keyed by user_id at
      // the column level (init_db.sql:386's ON DELETE SET NULL is inert
      // — no insert site ever populates audit_logs.user_id):
      //   1. userId in the payload — every post-login/registration row.
      //   2. the raw phone/email — pre-masking rows written before
      //      logAudit started masking identifiers at the write boundary.
      //      Rows written after that carry only a masked value, which is
      //      already pseudonymous and matches nothing here by design.
      //   3. `identifier`, which holds either shape depending on whether
      //      the user typed a phone or an email at the login form.
      // Seq scan on an unindexed jsonb key, deliberately: this runs at
      // most a handful of times per six-hour sweep, and the retention
      // sweep bounds how large the table can get.
      await client.query(
        `UPDATE audit_logs
         SET event_payload = (event_payload ${AUDIT_PAYLOAD_STRIP_EXPR})
             || jsonb_build_object('subjectPurgedAt', to_jsonb(NOW()))
         WHERE event_payload->>'userId' = $1
            OR ($2::text IS NOT NULL
                AND (event_payload->>'phoneNumber' = $2 OR event_payload->>'identifier' = $2))
            OR ($3::text IS NOT NULL
                AND (event_payload->>'email' = $3 OR event_payload->>'identifier' = $3))`,
        [request.user_id, phoneNumber, email],
      );

      // Cascades: patient_profiles (and its whole patient_* subtree),
      // refresh tokens, donations; ai_prompt_audit rows stay with
      // user_id nulled (their own compliance trail).
      await client.query('DELETE FROM app_users WHERE id = $1', [request.user_id]);

      await client.query('COMMIT');
      purged += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      logger.error(
        { requestId: request.id, error: error instanceof Error ? error.message : String(error) },
        'Account purge failed; request stays pending for the next sweep',
      );
      continue;
    } finally {
      client.release();
    }

    let orphanedFileCount = 0;
    for (const uri of fileUris) {
      try {
        await removeFile(uri);
      } catch (error) {
        orphanedFileCount += 1;
        logger.warn(
          { storageUri: uri, error: error instanceof Error ? error.message : String(error) },
          'Orphaned upload file left behind after account purge',
        );
      }
    }

    if (orphanedFileCount > 0) {
      // The blob removals run after the commit, so the ledger row
      // above already says 'purged' while these files are still
      // sitting in the bucket. A container log that rotates is not a
      // record of an incomplete erasure — this is the same gap the
      // document delete endpoint closes with its intent row, in the
      // other direction: there the file dies with no trail, here it
      // survives an erasure the ledger claims finished.
      //
      // The count and nothing else. `storage_uri` embeds the file name
      // the upload arrived with, and both providers keep every
      // `[A-Za-z0-9-_.]` character of it (local-storage.ts,
      // minio-storage.ts), so a hospital-issued name such as
      //「ZHANG-WEI-1987-WES.pdf」survives into the URI intact — report
      // content and an identity in one string. (A Chinese title does
      // not survive: every other character is replaced with `_`, so
      //「基因检测 2026」stores as「_____2026」. The latin case is the
      // one that leaks, which is why the rule is about the URI and not
      // about the language.) deleteDocumentForUser keeps storage_uri
      // out of audit_logs for exactly that reason, and the row that
      // says an account was erased is the last place to start writing
      // it. The URIs are in the warn lines above for as long as the
      // log is kept; what has to outlive the log is the fact that this
      // purge did not finish.
      //
      // No key here needs masking (see AUDIT_IDENTITY_KEYS) — `userId`
      // deliberately survives a purge, and a count identifies nobody —
      // but it still goes through maskAuditPayload so the write
      // boundary stays the single place that decides.
      //
      // Best-effort: the purge itself already committed, and failing
      // the sweep over its own bookkeeping would strand the remaining
      // due requests.
      try {
        await pool.query(
          `INSERT INTO audit_logs (event_type, event_payload)
           VALUES ($1, $2)`,
          [
            'account.purge_files_orphaned',
            maskAuditPayload({ userId: request.user_id, orphanedFileCount }),
          ],
        );
      } catch (auditError) {
        logger.error(
          {
            requestId: request.id,
            orphanedFileCount,
            error: auditError instanceof Error ? auditError.message : String(auditError),
          },
          'Account purge left files behind and could not record it in audit_logs',
        );
      }
    }
  }
  return purged;
};
