import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_AUDIT_EVENTS,
  requireAdmin,
  _auditPathOf,
  type AdminAuditSpec,
} from './require-admin.js';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';

const JWT_SECRET = 'test-secret-not-a-real-one';
const ADMIN_ID = '11111111-2222-3333-4444-555555555555';
const PATIENT_ID = '99999999-8888-7777-6666-555555555555';

const env = { JWT_SECRET } as unknown as AppEnv;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as AppLogger;

/**
 * A logger that keeps what it was given, for the one test that is about
 * a branch NOT writing a line.
 *
 * The 400 for a mistyped patient id is deliberately silent: it is the
 * caller's typo rather than a fault, and it is a line any authenticated
 * administrator can produce on demand — i.e. one somebody can flood the
 * error log with, ahead of the rows they would rather nobody read.
 * Nothing pinned that until this existed: putting the `logger.error`
 * back into the branch left the whole suite green.
 */
const recordingLogger = () => {
  const errors: unknown[][] = [];
  const warns: unknown[][] = [];
  return {
    errors,
    warns,
    logger: {
      info: () => undefined,
      debug: () => undefined,
      warn: (...args: unknown[]) => {
        warns.push(args);
      },
      error: (...args: unknown[]) => {
        errors.push(args);
      },
    } as unknown as AppLogger,
  };
};

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

/** A pool that answers the role SELECT from `account` and records
 *  every statement, with an optional hook to make one of them throw. */
const fakePool = (options: {
  account?: { role: string; is_active: boolean };
  failAuditInsert?: boolean;
  failRoleSelect?: boolean;
}) => {
  const calls: RecordedQuery[] = [];
  return {
    calls,
    pool: {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values: values ?? [] });
        if (sql.includes('FROM app_users')) {
          if (options.failRoleSelect) throw new Error('connection terminated');
          return { rows: options.account ? [options.account] : [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO audit_logs')) {
          if (options.failAuditInsert) throw new Error('audit insert failed');
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    },
  };
};

const auditCalls = (calls: RecordedQuery[]) =>
  calls.filter((call) => call.sql.includes('INSERT INTO audit_logs'));

const auditPayload = (calls: RecordedQuery[]) =>
  JSON.parse(auditCalls(calls)[0].values[1] as string) as Record<string, unknown>;

/** Run the whole array the factory returns, in order, and report which
 *  handler stopped it. `reached` is true only if a hypothetical route
 *  handler after the middleware would have run. */
const run = async (
  spec: AdminAuditSpec,
  pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  req: Partial<Request> & { headers: Record<string, string> },
  logger: AppLogger = silentLogger,
) => {
  const handlers = requireAdmin({ env, logger }, spec, {
    pool: pool as never,
  });
  const request = {
    params: {},
    method: 'GET',
    originalUrl: '/api/admin/patients',
    ...req,
  } as unknown as Request;
  const response = {} as Response;

  for (const handler of handlers) {
    const outcome = await new Promise<unknown>((resolve) => {
      handler(request, response, ((error?: unknown) => resolve(error)) as NextFunction);
    });
    if (outcome)
      return { error: outcome as { statusCode: number; message: string }, reached: false };
  }
  return { error: null, reached: true };
};

const bearer = (payload: Record<string, unknown>) => ({
  authorization: `Bearer ${jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' })}`,
});

describe('requireAdmin', () => {
  it('runs requireAuth first, so an unauthenticated caller never reaches the role query', async () => {
    const { calls, pool } = fakePool({ account: { role: 'admin', is_active: true } });
    const result = await run({ event: 'admin.list' }, pool, { headers: {} });

    expect(result.error).toMatchObject({ statusCode: 401 });
    expect(calls).toHaveLength(0);
  });

  it('lets an admin through and writes one audit row before the handler runs', async () => {
    const { calls, pool } = fakePool({ account: { role: 'admin', is_active: true } });
    const result = await run({ event: 'admin.list' }, pool, {
      headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
    });

    expect(result.error).toBeNull();
    expect(result.reached).toBe(true);
    expect(auditCalls(calls)).toHaveLength(1);
    expect(auditCalls(calls)[0].values[0]).toBe('admin.list');
    expect(auditPayload(calls)).toEqual({
      adminUserId: ADMIN_ID,
      targetUserId: null,
      path: '/api/admin/patients',
      method: 'GET',
    });
  });

  it('audits a READ, not only a write', async () => {
    // The reason this middleware exists rather than a helper the write
    // handlers call: 「谁看了谁」 is the fact the trail is read for, and
    // a GET is where it happens.
    const { calls, pool } = fakePool({ account: { role: 'admin', is_active: true } });
    await run({ event: 'admin.record_read', targetParam: 'userId' }, pool, {
      headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
      params: { userId: PATIENT_ID },
      originalUrl: `/api/admin/patients/${PATIENT_ID}`,
    });

    expect(auditCalls(calls)[0].values[0]).toBe('admin.record_read');
    expect(auditPayload(calls)).toMatchObject({
      adminUserId: ADMIN_ID,
      targetUserId: PATIENT_ID,
      method: 'GET',
    });
  });

  it('reads the role from the database, so a token minted before a revoke is worthless', async () => {
    // The whole point of the extra SELECT. The token below is validly
    // signed and says `role: 'admin'`; the row says otherwise, and the
    // row wins. Without this, `npm run admin:revoke` would do nothing
    // until the revoked admin's token expired on its own.
    const { calls, pool } = fakePool({ account: { role: 'patient', is_active: true } });
    const result = await run({ event: 'admin.list' }, pool, {
      headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
    });

    expect(result.error).toMatchObject({ statusCode: 403 });
    expect(auditCalls(calls)).toHaveLength(0);
  });

  it('refuses a deactivated admin', async () => {
    const { pool } = fakePool({ account: { role: 'admin', is_active: false } });
    const result = await run({ event: 'admin.list' }, pool, {
      headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
    });

    expect(result.error).toMatchObject({ statusCode: 403 });
  });

  it('refuses a token whose subject has no row at all', async () => {
    const { pool } = fakePool({});
    const result = await run({ event: 'admin.list' }, pool, {
      headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
    });

    expect(result.error).toMatchObject({ statusCode: 403 });
  });

  it('tells a refused caller nothing about which of the three reasons it was', async () => {
    const messages = new Set<string>();
    for (const account of [
      undefined,
      { role: 'admin', is_active: false },
      { role: 'patient', is_active: true },
    ]) {
      const { pool } = fakePool({ account });
      const result = await run({ event: 'admin.list' }, pool, {
        headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
      });
      messages.add((result.error as { message: string }).message);
    }
    expect(messages.size).toBe(1);
  });

  it('refuses the request when the audit row cannot be written', async () => {
    // Fail closed. A patient record served with no trace of the read is
    // the one outcome this middleware exists to prevent, so the
    // operator gets a 503 and retries.
    const { calls, pool } = fakePool({
      account: { role: 'admin', is_active: true },
      failAuditInsert: true,
    });
    const result = await run({ event: 'admin.record_read', targetParam: 'userId' }, pool, {
      headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
      params: { userId: PATIENT_ID },
      originalUrl: `/api/admin/patients/${PATIENT_ID}`,
    });

    expect(result.error).toMatchObject({ statusCode: 503 });
    expect(result.reached).toBe(false);
    expect(auditCalls(calls)).toHaveLength(1);
  });

  it('refuses the request when the role cannot be read', async () => {
    const { calls, pool } = fakePool({ failRoleSelect: true });
    const result = await run({ event: 'admin.list' }, pool, {
      headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
    });

    expect(result.error).toMatchObject({ statusCode: 503 });
    expect(auditCalls(calls)).toHaveLength(0);
  });

  it('refuses rather than audits a null target when the declared parameter does not resolve', async () => {
    // The shape of the bug: a guard mounted with router.use() above the
    // layer that parses :userId, or a mis-spelt parameter name. Either
    // way the trail would have recorded a look with no one being looked
    // at, which is worse than a 500 somebody has to fix.
    const { calls, pool } = fakePool({ account: { role: 'admin', is_active: true } });
    const result = await run({ event: 'admin.record_read', targetParam: 'userId' }, pool, {
      headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
      params: {},
      originalUrl: `/api/admin/patients/${PATIENT_ID}`,
    });

    expect(result.error).toMatchObject({ statusCode: 500 });
    expect(auditCalls(calls)).toHaveLength(0);
  });

  it('answers a mistyped patient id with a 400 that does not blame the route', async () => {
    // The parameter EXISTS and does not parse, which is an operator
    // pasting `P-00417` out of a spreadsheet — not a bug in the router.
    // Answering it with the 500 above told them our route was
    // misconfigured, and wrote a `logger.error` any authenticated
    // administrator could produce at will.
    const { calls, pool } = fakePool({ account: { role: 'admin', is_active: true } });
    const recorded = recordingLogger();
    const result = await run(
      { event: 'admin.record_write', targetParam: 'userId' },
      pool,
      {
        headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
        params: { userId: 'P-00417' },
        method: 'PATCH',
        originalUrl: '/api/admin/patients/P-00417',
      },
      recorded.logger,
    );

    expect(result.error).toMatchObject({ statusCode: 400 });
    expect((result.error as { message: string }).message).not.toContain('misconfigured');
    // Nobody was looked at, so nothing is audited — same reasoning as
    // the 403.
    expect(auditCalls(calls)).toHaveLength(0);
    expect(result.reached).toBe(false);
    // And nothing is logged. Half of why this branch stopped being a
    // 500 was the `logger.error` every mistyped id used to write.
    expect(recorded.errors).toEqual([]);
    expect(recorded.warns).toEqual([]);
  });

  it('leaves audit_logs.user_id unset, matching every other insert site', async () => {
    const { calls, pool } = fakePool({ account: { role: 'admin', is_active: true } });
    await run({ event: 'admin.list' }, pool, {
      headers: bearer({ sub: ADMIN_ID, role: 'admin' }),
    });

    expect(auditCalls(calls)[0].sql).not.toContain('user_id');
    expect(auditCalls(calls)[0].values).toHaveLength(2);
  });
});

describe('_auditPathOf', () => {
  it('drops the query string, which is where a searched-for patient name would be', () => {
    // audit_logs is the table identity-masking.ts exists to keep names
    // and phone numbers out of. `?q=张三` is a name.
    expect(_auditPathOf('/api/admin/patients?q=%E5%BC%A0%E4%B8%89&page=2')).toBe(
      '/api/admin/patients',
    );
  });

  it('keeps a path that has no query string exactly as it is', () => {
    expect(_auditPathOf(`/api/admin/patients/${PATIENT_ID}/documents`)).toBe(
      `/api/admin/patients/${PATIENT_ID}/documents`,
    );
  });
});

describe('ADMIN_AUDIT_EVENTS', () => {
  it('covers the six event types the back-office writes', () => {
    expect([...ADMIN_AUDIT_EVENTS]).toEqual([
      'admin.list',
      'admin.record_read',
      'admin.record_write',
      'admin.export',
      'admin.grant',
      'admin.revoke',
    ]);
  });

  it('contains the literals scripts/admin-role.mjs writes into audit_logs', async () => {
    // admin-role.mjs is a .mjs and cannot import this constant, so the
    // two are kept in step here instead. A typo there would not break
    // anything visibly — it would just drop the grant/revoke trail out
    // of every `event_type LIKE 'admin.%'` query, silently.
    const scriptPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../scripts/admin-role.mjs',
    );
    const source = await readFile(scriptPath, 'utf8');
    const written = [...source.matchAll(/'(admin\.[a-z_]+)'/g)].map((match) => match[1]);

    expect(written.length).toBeGreaterThan(0);
    for (const event of written) {
      expect(ADMIN_AUDIT_EVENTS).toContain(event);
    }
    expect(new Set(written)).toEqual(new Set(['admin.grant', 'admin.revoke']));
  });
});
