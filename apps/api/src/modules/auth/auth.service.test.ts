import type { Pool, PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { RegisterInput } from './auth.schema.js';
import { AuthService } from './auth.service.js';
import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../config/logger.js';
import { AppError } from '../../utils/app-error.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child() {
    return silentLogger;
  },
} as unknown as AppLogger;

const fakeEnv = {
  BCRYPT_SALT_ROUNDS: 4, // tiny so bcrypt finishes fast in tests
  JWT_SECRET: 'test-secret-12345678901234567890',
  JWT_EXPIRES_IN: '7d',
} as unknown as AppEnv;

interface ScriptedClient {
  client: PoolClient;
  calls: string[];
}

/**
 * Build a fake `PoolClient` whose `.query()` records the SQL fragment
 * (or BEGIN / COMMIT / ROLLBACK keyword) and replies according to the
 * provided handler. Used to assert ROLLBACK was emitted on every
 * post-BEGIN failure path the registration handler can hit.
 */
const scriptedClient = (
  handler: (text: string, params?: unknown[]) => Promise<QueryResult> | QueryResult,
): ScriptedClient => {
  const calls: string[] = [];
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    calls.push(text.trim().split(/\s+/)[0].toUpperCase());
    return handler(text, params);
  });
  const release = vi.fn();
  return {
    client: { query, release } as unknown as PoolClient,
    calls,
  };
};

const buildPool = (script: ScriptedClient): Pool & { query: ReturnType<typeof vi.fn> } => {
  // logAudit uses pool.query directly (not the transactional client), so
  // we also stub it to silently consume audit writes.
  const auditQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as unknown as QueryResult);
  return {
    query: auditQuery,
    connect: vi.fn().mockResolvedValue(script.client),
  } as unknown as Pool & { query: ReturnType<typeof vi.fn> };
};

const samplePayload: RegisterInput = {
  phoneNumber: '13800001234',
  otpCode: '123456',
  password: 'pw-correct-horse',
  role: 'patient',
};

describe('AuthService.register transaction handling (PR #48 review)', () => {
  it('ROLLBACK runs when the existence SELECT throws after BEGIN', async () => {
    // Simulate a transient DB failure on the SELECT. The previous
    // implementation released the client back to the pool with the
    // transaction still open; the borrower of the connection then
    // inherited the aborted transaction.
    const script = scriptedClient(async (text) => {
      if (/^BEGIN/i.test(text.trim())) return { rows: [], rowCount: 0 } as unknown as QueryResult;
      if (/^ROLLBACK/i.test(text.trim()))
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
      if (/SELECT id FROM app_users/i.test(text)) {
        throw new Error('connection reset');
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });
    const pool = buildPool(script);
    const svc = new AuthService({ env: fakeEnv, logger: silentLogger, pool });

    await expect(svc.register(samplePayload)).rejects.toThrow(/connection reset/);

    expect(script.calls).toContain('BEGIN');
    expect(script.calls).toContain('ROLLBACK');
    expect(script.calls).not.toContain('COMMIT');
    expect((script.client.release as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('ROLLBACK runs when COMMIT itself fails', async () => {
    // The COMMIT path is the easiest one to miss in a hand-rolled
    // transaction: COMMIT throws → control jumps to outer finally,
    // which releases a still-aborted transaction. The outer catch
    // must re-issue ROLLBACK so the pool stays clean.
    const script = scriptedClient(async (text) => {
      const head = text.trim().split(/\s+/)[0].toUpperCase();
      if (head === 'BEGIN') return { rows: [], rowCount: 0 } as unknown as QueryResult;
      if (head === 'ROLLBACK') return { rows: [], rowCount: 0 } as unknown as QueryResult;
      if (head === 'COMMIT') throw new Error('commit timed out');
      if (/SELECT id FROM app_users/i.test(text))
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
      if (/INSERT INTO app_users/i.test(text))
        return {
          rows: [
            {
              id: 'u-1',
              phone_number: '13800001234',
              email: null,
              role: 'patient',
              created_at: new Date('2026-05-28T00:00:00Z'),
            },
          ],
          rowCount: 1,
        } as unknown as QueryResult;
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });
    const pool = buildPool(script);
    const svc = new AuthService({ env: fakeEnv, logger: silentLogger, pool });

    await expect(svc.register(samplePayload)).rejects.toThrow(/commit timed out/);

    expect(script.calls).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT', 'ROLLBACK']));
    // Order matters: ROLLBACK must come AFTER the failed COMMIT.
    expect(script.calls.indexOf('ROLLBACK')).toBeGreaterThan(script.calls.indexOf('COMMIT'));
  });

  it('409 path (existing user) still issues exactly one ROLLBACK and not a COMMIT', async () => {
    // The explicit-rollback branch must still set txOpen=false so the
    // outer catch doesn't try to rollback again — we'd otherwise see
    // two ROLLBACK calls on the wire.
    const script = scriptedClient(async (text) => {
      if (/SELECT id FROM app_users/i.test(text)) {
        return { rows: [{ id: 'existing' }], rowCount: 1 } as unknown as QueryResult;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });
    const pool = buildPool(script);
    const svc = new AuthService({ env: fakeEnv, logger: silentLogger, pool });

    await expect(svc.register(samplePayload)).rejects.toBeInstanceOf(AppError);

    const rollbacks = script.calls.filter((c) => c === 'ROLLBACK');
    expect(rollbacks).toHaveLength(1);
    expect(script.calls).not.toContain('COMMIT');
  });
});
