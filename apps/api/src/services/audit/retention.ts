import type { Pool } from 'pg';

import type { AppLogger } from '../../config/logger.js';

/**
 * Time-based retention for the four tables nothing else ever deletes
 * from.
 *
 * `grep 'DELETE FROM' src/` used to return exactly nine statements —
 * seven inside the account-deletion purge, one login-guard clear, one
 * document delete. Every OTP ever sent left a permanent row keyed by
 * phone number, and audit_logs / ai_prompt_audit grew monotonically.
 * That is a PIPL Art. 19 problem before it is an operational one: the
 * policy has to state a retention period, and there was no period to
 * state because nothing expired.
 *
 * The windows below are the answer to 「你们保存多久」. They are
 * module constants rather than environment variables on purpose: a
 * retention period is a published commitment in the privacy policy, not
 * a per-deploy tuning knob, and an operator quietly raising it in .env
 * would put the deployment out of step with the document users
 * consented to. Changing one means changing the policy text in the same
 * commit.
 *
 * Every statement is idempotent and bounded by a timestamp, so a
 * re-run, an overlapping tick, or a crashed sweep costs nothing.
 */

/** One sweep every six hours, matching the account-deletion purge. */
export const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * OTP rows die 24h after they expire, not at expiry.
 *
 * The grace window exists so a support ticket filed the same day
 * (「我没收到验证码」) can still be answered from `sent_at` /
 * `attempt_count`, and so the resend/attempt counters that make up the
 * brute-force defence are not erased out from under an attack that is
 * still in progress. Past that the row is a phone number and a dead
 * hash.
 */
export const OTP_RETENTION_GRACE_HOURS = 24;

/**
 * 180 days for audit_logs and ai_prompt_audit.
 *
 * Long enough to investigate an incident reported a season late and to
 * answer a data-subject access request about AI processing over a
 * meaningful window; short enough that it is a bounded period we can
 * write into the privacy policy. Both tables hold masked identifiers
 * (see identity-masking.ts) and ai_prompt_audit stores only a prompt
 * hash and field names, never prompt text — so the residual after
 * masking is thin, and the cap is about the retention *commitment*
 * rather than about containing an exposure.
 */
export const AUDIT_RETENTION_DAYS = 180;

export interface RetentionSweepResult {
  otpVerificationCodes: number;
  authOtps: number;
  auditLogs: number;
  aiPromptAudit: number;
}

/**
 * Delete everything past its retention window. Returns per-table counts
 * so the caller can log a single line instead of four.
 *
 * Not run in one transaction: these are four independent deletes with
 * no consistency relationship, and holding one transaction open across
 * all of them would take four sets of row locks on a live table for no
 * benefit. A failure part-way leaves the remaining tables to the next
 * tick.
 */
export const sweepExpiredRetentionData = async (pool: Pool): Promise<RetentionSweepResult> => {
  const otpVerificationCodes = await pool.query(
    `DELETE FROM otp_verification_codes
     WHERE expires_at < NOW() - make_interval(hours => $1)`,
    [OTP_RETENTION_GRACE_HOURS],
  );
  const authOtps = await pool.query(
    `DELETE FROM auth_otps
     WHERE expires_at < NOW() - make_interval(hours => $1)`,
    [OTP_RETENTION_GRACE_HOURS],
  );
  const auditLogs = await pool.query(
    `DELETE FROM audit_logs
     WHERE occurred_at < NOW() - make_interval(days => $1)`,
    [AUDIT_RETENTION_DAYS],
  );
  const aiPromptAudit = await pool.query(
    `DELETE FROM ai_prompt_audit
     WHERE created_at < NOW() - make_interval(days => $1)`,
    [AUDIT_RETENTION_DAYS],
  );

  return {
    otpVerificationCodes: otpVerificationCodes.rowCount ?? 0,
    authOtps: authOtps.rowCount ?? 0,
    auditLogs: auditLogs.rowCount ?? 0,
    aiPromptAudit: aiPromptAudit.rowCount ?? 0,
  };
};

/**
 * Start the sweep: once now, then on an interval.
 *
 * Same single-instance assumption as the OCR and account-deletion
 * sweeps it is wired alongside, and the same `.unref()` so the timer
 * cannot pin the process open during a graceful shutdown or a test run.
 * Returns the timer so a caller can clear it.
 */
export const startRetentionSweep = (pool: Pool, logger: AppLogger): NodeJS.Timeout => {
  const run = () =>
    void sweepExpiredRetentionData(pool)
      .then((result) => {
        const total =
          result.otpVerificationCodes + result.authOtps + result.auditLogs + result.aiPromptAudit;
        if (total > 0) {
          logger.info({ ...result, total }, 'Retention sweep removed expired rows');
        }
      })
      .catch((error) => {
        logger.error({ error }, 'Retention sweep failed');
      });

  run();
  const timer = setInterval(run, RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
};
