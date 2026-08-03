import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { requireGuardianConsentForMinor, requireSensitiveDataConsent } from './require-consent.js';

/**
 * The first version of this feature had the gate only in the mobile
 * client while two comments claimed the server enforced it. These tests
 * exist so that claim is checkable: if the middleware stops refusing,
 * something here goes red rather than a reviewer having to re-derive it
 * from the routing table.
 */

const silentLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

const makeRes = () => {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: { code?: string } | null };
};

// `user` defaults only when the argument is omitted; the
// unauthenticated case passes null on purpose, because passing
// `undefined` explicitly re-applies the default and would have made
// that test assert nothing.
const run = async (pool: unknown, user: unknown = { id: 'user-1' }) => {
  const res = makeRes();
  const next = vi.fn() as unknown as NextFunction;
  await requireSensitiveDataConsent(pool as never, silentLogger as never)(
    { user } as unknown as Request,
    res,
    next,
  );
  return { res, next };
};

const poolWith = (rowCount: number) => ({ query: vi.fn(async () => ({ rowCount, rows: [] })) });

describe('requireSensitiveDataConsent', () => {
  it('lets the request through when an acceptance exists', async () => {
    const { res, next } = await run(poolWith(1));
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('refuses with a machine-readable code when nothing is recorded', async () => {
    const { res, next } = await run(poolWith(0));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    // The client maps this onto the consent document it already
    // renders; a bare 403 would leave the user stuck instead of asked.
    expect(res.body?.code).toBe('sensitive_consent_required');
  });

  it('fails CLOSED when the ledger cannot be read', async () => {
    // Storing a patient's MRI on the strength of a failed SELECT is not
    // a recoverable mistake, so an unavailable database refuses rather
    // than waves through.
    const pool = {
      query: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    };
    const { res, next } = await run(pool);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body?.code).toBe('consent_check_unavailable');
  });

  it('refuses an unauthenticated request instead of querying for undefined', async () => {
    const pool = poolWith(1);
    const { res, next } = await run(pool, null);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('asks about the sensitive-data document specifically', async () => {
    const pool = poolWith(1);
    await run(pool);
    const params = pool.query.mock.calls[0][1] as unknown[];
    expect(params).toEqual(['user-1', 'sensitive_data_consent']);
  });
});

describe('requireGuardianConsentForMinor', () => {
  const runGuardian = async (pool: unknown, body: unknown) => {
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireGuardianConsentForMinor(pool as never, silentLogger as never)(
      { user: { id: 'user-1' }, body } as unknown as Request,
      res,
      next,
    );
    return { res, next };
  };

  // Anchored to the server clock, not the caller's. The mobile rule
  // reads the handset, which is settable — and the population this
  // protects is children, so the skippable copy cannot be the only one.
  const underAge = '2020-01-01';
  const adult = '1985-03-20';

  it('lets an adult profile through without touching the ledger', async () => {
    const pool = poolWith(0);
    const { next } = await runGuardian(pool, { dateOfBirth: adult });
    expect(next).toHaveBeenCalledOnce();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('refuses an under-14 profile with no guardian acceptance', async () => {
    const { res, next } = await runGuardian(poolWith(0), { dateOfBirth: underAge });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body?.code).toBe('guardian_consent_required');
  });

  it('accepts an under-14 profile once the guardian has consented', async () => {
    const { res, next } = await runGuardian(poolWith(1), { dateOfBirth: underAge });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('asks about the guardian document, not the sensitive-data one', async () => {
    const pool = poolWith(1);
    await runGuardian(pool, { dateOfBirth: underAge });
    expect(pool.query.mock.calls[0][1]).toEqual(['user-1', 'guardian_consent']);
  });

  it('passes a body with no date of birth through', async () => {
    // Update paths may omit it, and a write that does not touch the
    // field cannot make the patient younger. Pinned because a schema
    // change making it removable would turn this into a hole.
    const { next } = await runGuardian(poolWith(0), { fullName: '张三' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('fails CLOSED when the ledger cannot be read', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    };
    const { res, next } = await runGuardian(pool, { dateOfBirth: underAge });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });
});
