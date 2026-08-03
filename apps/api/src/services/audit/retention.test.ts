import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AUDIT_RETENTION_DAYS,
  OTP_RETENTION_GRACE_HOURS,
  RETENTION_SWEEP_INTERVAL_MS,
  startRetentionSweep,
  sweepExpiredRetentionData,
} from './retention.js';
import type { AppLogger } from '../../config/logger.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as AppLogger;

const makePool = (rowCounts: number[] = [0, 0, 0, 0]) => {
  const calls: { sql: string; params: unknown[] }[] = [];
  let index = 0;
  const pool = {
    query: vi.fn().mockImplementation((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return Promise.resolve({ rowCount: rowCounts[index++] ?? 0, rows: [] });
    }),
  } as unknown as Pool;
  return { pool, calls };
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('sweepExpiredRetentionData', () => {
  it('bounds all four unbounded tables', async () => {
    const { pool, calls } = makePool();
    await sweepExpiredRetentionData(pool);

    const tables = calls.map((call) => call.sql.match(/DELETE FROM (\w+)/)?.[1]);
    expect(tables).toEqual([
      'otp_verification_codes',
      'auth_otps',
      'audit_logs',
      'ai_prompt_audit',
    ]);
  });

  it('gives OTP rows a grace window past expiry rather than deleting at expiry', async () => {
    // The counters in these rows are the brute-force defence; erasing
    // them the instant a code expires would erase them out from under
    // an attack still in progress.
    const { pool, calls } = makePool();
    await sweepExpiredRetentionData(pool);

    for (const call of calls.slice(0, 2)) {
      expect(call.sql).toContain('expires_at < NOW() - make_interval(hours =>');
      expect(call.params).toEqual([OTP_RETENTION_GRACE_HOURS]);
    }
    expect(OTP_RETENTION_GRACE_HOURS).toBe(24);
  });

  it('uses the timestamp column each audit table actually has', async () => {
    const { pool, calls } = makePool();
    await sweepExpiredRetentionData(pool);

    expect(calls[2].sql).toContain('occurred_at <');
    expect(calls[3].sql).toContain('created_at <');
    expect(calls[2].params).toEqual([AUDIT_RETENTION_DAYS]);
    expect(calls[3].params).toEqual([AUDIT_RETENTION_DAYS]);
  });

  it('reports per-table counts so one log line can name what went', async () => {
    const { pool } = makePool([3, 1, 12, 5]);
    await expect(sweepExpiredRetentionData(pool)).resolves.toEqual({
      otpVerificationCodes: 3,
      authOtps: 1,
      auditLogs: 12,
      aiPromptAudit: 5,
    });
  });

  it('treats a null rowCount as zero rather than NaN', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: null, rows: [] }),
    } as unknown as Pool;
    const result = await sweepExpiredRetentionData(pool);
    expect(result.auditLogs).toBe(0);
  });
});

describe('startRetentionSweep', () => {
  it('runs once immediately and then on the interval', async () => {
    vi.useFakeTimers();
    const { pool } = makePool();
    startRetentionSweep(pool, logger);
    await vi.advanceTimersByTimeAsync(0);
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);

    await vi.advanceTimersByTimeAsync(RETENTION_SWEEP_INTERVAL_MS);
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(8);
  });

  it('survives a failing sweep instead of taking the process down', async () => {
    // This runs detached from any request, so an unhandled rejection
    // here would kill the API on Node 15+.
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('pool blip')),
    } as unknown as Pool;
    startRetentionSweep(pool, logger);
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
  });

  it('does not pin the process open during a graceful shutdown', () => {
    const { pool } = makePool();
    const timer = startRetentionSweep(pool, logger);
    // `unref()` is why the shutdown path in index.ts can exit without
    // clearing this timer; hasRef() is the only observable proof.
    expect(timer.hasRef()).toBe(false);
    clearInterval(timer);
  });
});
