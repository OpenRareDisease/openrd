import { describe, expect, it, vi } from 'vitest';

import { OtpService } from './otp.service.js';
import type { AppEnv } from '../../config/env.js';

/**
 * `verifyCode` had no direct test — it was only ever mocked out from the
 * auth controller — which is how it carried an account-takeover bug
 * unnoticed.
 *
 * On a wrong code it incremented `attempt_count`, wrote an
 * `otp.verify_failed` audit row, and then threw. The throw reached a
 * catch whose only statement was ROLLBACK, so both writes were
 * discarded on every attempt. `attempt_count` therefore stayed at 0
 * forever, the OTP_MAX_VERIFY_ATTEMPTS ceiling could never fire, and a
 * sustained brute force left nothing in the audit log either. A 6-digit
 * code valid for ten minutes, with no per-code limit, is the sole
 * credential accepted by /auth/password/reset.
 *
 * These tests assert against the statements actually issued on the
 * connection, because that is where the bug lived — a test that only
 * checked the thrown error would have passed throughout.
 */

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
};

const env = {
  OTP_CODE_LENGTH: 6,
  OTP_TTL_MINUTES: 10,
  OTP_MAX_VERIFY_ATTEMPTS: 5,
  OTP_RESEND_INTERVAL_SECONDS: 60,
  OTP_PROVIDER: 'internal_test',
  OTP_TEST_PHONE_ALLOWLIST: '',
  OTP_HASH_SECRET: 'test-secret',
} as unknown as AppEnv;

/** A connection that records every statement, so the test can assert on
 *  transaction boundaries rather than on return values. */
const makeClient = (storedHash: string, attemptCount = 0) => {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    statements.push(sql.trim().split('\n')[0].trim());
    if (sql.includes('SELECT') && sql.includes('otp_verification_codes')) {
      return {
        rowCount: 1,
        rows: [
          {
            id: 'otp-1',
            request_id: 'req-1',
            code_hash: storedHash,
            expires_at: new Date(Date.now() + 60_000),
            attempt_count: attemptCount,
          },
        ],
      };
    }
    return { rowCount: 1, rows: [] };
  });
  return { client: { query, release: vi.fn() }, statements };
};

const serviceFor = (client: unknown) =>
  new OtpService({
    env,
    logger: silentLogger as never,
    pool: { connect: async () => client } as never,
    provider: { send: vi.fn() } as never,
  });

const verify = (service: OtpService, code: string) =>
  service.verifyCode({ phoneNumber: '+8613900000001', code, scene: 'register' });

describe('OtpService.verifyCode — failure bookkeeping', () => {
  it('commits the attempt counter and audit row before rejecting a wrong code', async () => {
    const { client, statements } = makeClient('a-hash-that-will-not-match');
    await expect(verify(serviceFor(client), '000000')).rejects.toThrow('OTP code invalid');

    // The counter and the audit row must survive the rejection.
    expect(statements.some((s) => s.startsWith('UPDATE otp_verification_codes'))).toBe(true);
    expect(statements.some((s) => s.startsWith('INSERT INTO audit_logs'))).toBe(true);
    expect(statements).toContain('COMMIT');
    // And crucially: no rollback undoing them.
    expect(statements).not.toContain('ROLLBACK');
  });

  it('writes the counter before the commit, not after', async () => {
    const { client, statements } = makeClient('nope');
    await expect(verify(serviceFor(client), '000000')).rejects.toThrow();
    const update = statements.findIndex((s) => s.startsWith('UPDATE otp_verification_codes'));
    const commit = statements.indexOf('COMMIT');
    expect(update).toBeGreaterThanOrEqual(0);
    expect(commit).toBeGreaterThan(update);
  });

  it('refuses once the ceiling is reached, which requires the counter to have persisted', async () => {
    const { client } = makeClient('nope', env.OTP_MAX_VERIFY_ATTEMPTS);
    await expect(verify(serviceFor(client), '000000')).rejects.toThrow('OTP attempts exceeded');
  });

  it('still rolls back when the failure is not a wrong code', async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql.trim().split('\n')[0].trim());
        if (sql.includes('SELECT')) throw new Error('connection reset');
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    await expect(verify(serviceFor(client), '000000')).rejects.toThrow('connection reset');
    expect(statements).toContain('ROLLBACK');
  });
});
