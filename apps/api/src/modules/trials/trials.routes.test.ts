import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../config/logger.js';
import { errorHandler } from '../../middleware/error-handler.js';

/**
 * /api/trials through the real router.
 *
 * Four things live here rather than in the service test because none
 * of them is a property of the service:
 *
 *  1. THE AUTH GATE. Contract §C requires every new route to sit behind
 *     requireAuth, and the only way to know it is mounted is to call
 *     the route without a token.
 *  2. THE PER-USER BUDGET. The router spends a paragraph on why the
 *     limiter is keyed on the user rather than the IP; nothing but a
 *     test holds the limiter itself in place.
 *  3. WHAT THE ROUTE ADDS TO THE SERVICE'S ANSWER, which is nothing.
 *     This file mocks `readTrialSnapshot`, so it CANNOT see the service
 *     widen its own row shape — that guard is `toSourceStatus`'s
 *     `toEqual` in trials.service.test.ts, and it is the one to edit
 *     when a column is added. What this asserts is the other half: the
 *     handler serialises what it was handed, without a field of its
 *     own creeping in beside it.
 *  4. WHAT HAPPENS WHEN THE DATABASE IS DOWN. An empty list is a
 *     statement about the registry. A 500 is a statement about us. Only
 *     one of them is true here.
 */

const snapshotMock = vi.fn();

vi.mock('./trials.service.js', async () => {
  const actual = await vi.importActual<typeof import('./trials.service.js')>('./trials.service.js');
  return { ...actual, readTrialSnapshot: (...args: unknown[]) => snapshotMock(...args) };
});

vi.mock('../../db/pool.js', () => ({ getPool: () => ({}) }));

const { createTrialsRouter } = await import('./trials.routes.js');

const logger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => logger,
} as unknown as AppLogger;

const JWT_SECRET = 'test-secret-for-trials-routes';
const context = { env: { JWT_SECRET } as unknown as AppEnv, logger };

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/trials', createTrialsRouter(context));
  app.use(errorHandler);
  return app;
};

const token = () => jwt.sign({ sub: 'user-1', role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });

const SNAPSHOT = {
  trials: [
    {
      source: 'ctgov',
      sourceId: 'NCT04635891',
      title: 'Validation of Motor Outcome Assessments in FSHD',
      statusRaw: 'RECRUITING',
      statusZh: '招募中',
      phase: 'N/A',
      sponsor: 'University of Kansas Medical Center',
      countries: ['United States'],
      url: 'https://clinicaltrials.gov/study/NCT04635891',
      sourceUpdatedAt: '2025-06-01',
      fetchedAt: '2026-08-13T04:00:07Z',
    },
  ],
  sources: [
    {
      source: 'ctgov',
      recordCount: 92,
      fetchedAt: '2026-08-13T04:00:07Z',
      lastRun: { startedAt: '2026-08-13T04:00:00Z', finishedAt: '2026-08-13T04:00:09Z', ok: true },
      lastSuccessAt: '2026-08-13T04:00:09Z',
    },
    {
      source: 'chinadrugtrials',
      recordCount: 0,
      fetchedAt: null,
      lastRun: { startedAt: '2026-08-13T04:00:00Z', finishedAt: '2026-08-13T04:00:30Z', ok: false },
      lastSuccessAt: null,
    },
  ],
};

describe('GET /api/trials', () => {
  beforeEach(() => {
    snapshotMock.mockReset();
    snapshotMock.mockResolvedValue(SNAPSHOT);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await request(makeApp()).get('/api/trials');
    expect(res.status).toBe(401);
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('serves the list and the freshness facts in one response', async () => {
    const res = await request(makeApp())
      .get('/api/trials')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    // The page renders 「拉取于 X」 and 「国内这部分取不到」 from this one
    // payload. A second round trip for the dates means one paint of an
    // undated trial list.
    expect(res.body.trials[0].fetchedAt).toBe('2026-08-13T04:00:07Z');
    expect(res.body.sources.map((s: { source: string }) => s.source)).toEqual([
      'ctgov',
      'chinadrugtrials',
    ]);
    // The page reads 「最近一次更新没有成功」 off this pair.
    expect(res.body.sources[1].lastRun).toEqual({
      startedAt: '2026-08-13T04:00:00Z',
      finishedAt: '2026-08-13T04:00:30Z',
      ok: false,
    });
    expect(res.body.sources[0].lastSuccessAt).toBe('2026-08-13T04:00:09Z');
  });

  it("serialises the service's answer and nothing else", async () => {
    // `trial_fetch_runs.error` is the raw fetch failure — a URL with our
    // egress proxy in it, a DNS name, a driver message — and this route
    // answers any logged-in patient. The service is what refuses to
    // select it (asserted there); this asserts the handler does not put
    // anything of its own on the wire either, so the payload is exactly
    // the object it was handed.
    const res = await request(makeApp())
      .get('/api/trials')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.body).toEqual(SNAPSHOT);
    expect(JSON.stringify(res.body)).not.toContain('error');
  });

  it('stops one account holding the pool open in a reload loop', async () => {
    // Every request takes a pooled connection and holds a transaction
    // across two queries. 60/min is the ceiling on how much of the pool
    // one account can hold; without the limiter mounted, a client stuck
    // reloading starves everyone else's login. Its own user id, because
    // the limiter's store is module-global and keyed on the caller.
    const app = makeApp();
    const looper = jwt.sign({ sub: 'reload-loop', role: 'patient' }, JWT_SECRET, {
      expiresIn: '1h',
    });
    let last = 0;
    for (let i = 0; i < 61; i += 1) {
      last = (await request(app).get('/api/trials').set('Authorization', `Bearer ${looper}`))
        .status;
    }
    expect(last).toBe(429);
    expect(snapshotMock).toHaveBeenCalledTimes(60);
  });

  it('fails loudly when the database cannot answer', async () => {
    snapshotMock.mockRejectedValue(new Error('connection terminated unexpectedly'));
    const res = await request(makeApp())
      .get('/api/trials')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(500);
    expect(res.body.trials).toBeUndefined();
  });
});
