import type { Pool } from 'pg';

import type { AppLogger } from '../../config/logger.js';
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
 * so they must survive the very DELETE they describe.
 */

export const ACCOUNT_DELETION_COOLING_DAYS = 7;

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
 * `removeFile` failures are logged and skipped: by the time we call
 * it the DB commit already made the deletion authoritative.
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

    for (const uri of fileUris) {
      try {
        await removeFile(uri);
      } catch (error) {
        logger.warn(
          { storageUri: uri, error: error instanceof Error ? error.message : String(error) },
          'Orphaned upload file left behind after account purge',
        );
      }
    }
  }
  return purged;
};
