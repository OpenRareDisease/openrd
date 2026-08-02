import type { Response } from 'express';
import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { LegalController } from './legal.controller.js';
import type { AuthenticatedRequest } from '../../middleware/require-auth.js';

const fakePool = (results: Array<{ rows: unknown[]; rowCount?: number }>) => {
  const query = vi.fn();
  for (const result of results) {
    query.mockResolvedValueOnce({
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
    } as unknown as QueryResult);
  }
  return { pool: { query } as unknown as Pool, query };
};

const fakeRes = () => {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
};

const fakeReq = (overrides: Partial<AuthenticatedRequest> = {}) =>
  ({
    user: { id: 'user-1', role: 'patient', token: 't' },
    body: {},
    headers: {},
    ip: '203.0.113.5',
    ...overrides,
  }) as unknown as AuthenticatedRequest;

describe('LegalController.recordMyAcceptance', () => {
  it('writes the acceptance against the AUTHENTICATED user, not the body', async () => {
    // There is no user id in the request body or path on purpose. This
    // asserts the property that keeps it that way: whatever the client
    // sends, the row is keyed by req.user.id.
    const { pool, query } = fakePool([
      { rows: [{ document: 'privacy_policy', version: '2026-08-02', accepted_at: new Date(0) }] },
    ]);
    const controller = new LegalController(pool);
    const res = fakeRes();

    await controller.recordMyAcceptance(
      fakeReq({
        body: { document: 'privacy_policy', version: '2026-08-02', userId: 'someone-else' },
        headers: { 'user-agent': 'Mozilla/5.0' },
      } as Partial<AuthenticatedRequest>),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(query.mock.calls[0][1]).toEqual([
      'user-1',
      'privacy_policy',
      '2026-08-02',
      '203.0.113.5',
      'Mozilla/5.0',
    ]);
  });

  it('rejects an unknown document with a validation error, not a DB round-trip', async () => {
    // Without the enum this would reach Postgres and come back as a 500
    // from the CHECK constraint — a client typo logged as a server
    // fault.
    const { pool, query } = fakePool([]);
    const controller = new LegalController(pool);

    await expect(
      controller.recordMyAcceptance(
        fakeReq({ body: { document: 'not_a_document', version: '2026-08-02' } }),
        fakeRes(),
      ),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a version longer than the column allows', async () => {
    const { pool, query } = fakePool([]);
    const controller = new LegalController(pool);

    await expect(
      controller.recordMyAcceptance(
        fakeReq({ body: { document: 'privacy_policy', version: 'v'.repeat(33) } }),
        fakeRes(),
      ),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('tolerates a missing User-Agent header', async () => {
    const { pool, query } = fakePool([
      {
        rows: [
          { document: 'sensitive_data_consent', version: '2026-08-02', accepted_at: new Date(0) },
        ],
      },
    ]);
    const controller = new LegalController(pool);

    await controller.recordMyAcceptance(
      fakeReq({ body: { document: 'sensitive_data_consent', version: '2026-08-02' } }),
      fakeRes(),
    );

    expect((query.mock.calls[0][1] as unknown[])[4]).toBeNull();
  });
});

describe('LegalController.getMyAcceptances', () => {
  it('returns only document / version / acceptedAt', async () => {
    // The stored row also holds ip and user_agent. A spread of the
    // service result would start handing patients their own IP history
    // back the moment someone widens the SELECT for an admin view.
    const { pool } = fakePool([
      {
        rows: [
          {
            document: 'privacy_policy',
            version: '2026-08-02',
            accepted_at: '2026-08-02T09:00:00Z',
          },
        ],
      },
    ]);
    const controller = new LegalController(pool);
    const res = fakeRes();

    await controller.getMyAcceptances(fakeReq(), res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { acceptances: Array<Record<string, unknown>> };
    expect(Object.keys(body.acceptances[0]).sort()).toEqual(['acceptedAt', 'document', 'version']);
  });

  it('scopes the read to the authenticated user', async () => {
    const { pool, query } = fakePool([{ rows: [] }]);
    const controller = new LegalController(pool);

    await controller.getMyAcceptances(fakeReq({ user: { id: 'user-9' } } as never), fakeRes());

    expect(query.mock.calls[0][1]).toEqual(['user-9']);
  });
});
