import { afterEach, describe, expect, it, vi } from 'vitest';

import { getHealthSummary } from './index.js';
import type { RouteContext } from './index.js';
import { _resetShutdownState, beginShutdown } from '../lifecycle.js';

/**
 * A deploy is only graceful if the load balancer learns about it before
 * the listener closes, and the only channel for that is this summary's
 * `ready` flag. So the draining case is asserted here rather than left
 * to the shutdown script — the two are separated by a signal handler
 * that no test can reach.
 */

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })) }),
}));

const context = {
  env: {
    // Not 'embedded', so the OCR probe short-circuits instead of
    // shelling out to Python.
    OCR_PROVIDER: 'mock',
    OCR_PYTHON_BIN: 'python3',
    HEALTHCHECK_TIMEOUT_MS: 500,
    kbServiceUrl: 'http://kb.invalid',
    AI_API_MODEL: 'test-model',
    AI_API_KEY: 'k',
  },
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
} as unknown as RouteContext;

const kbReady = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ status: 'ready' }), { status: 200 })),
  );

afterEach(() => {
  _resetShutdownState();
  vi.unstubAllGlobals();
});

describe('readiness during shutdown', () => {
  it('is ready while healthy and not draining', async () => {
    kbReady();
    const summary = await getHealthSummary(context);
    expect(summary.ready).toBe(true);
    expect(summary.status).toBe('ok');
    expect(summary).not.toHaveProperty('draining');
  });

  it('stops being ready once shutdown begins, even with every component healthy', async () => {
    kbReady();
    beginShutdown();
    const summary = await getHealthSummary(context);
    expect(summary.ready).toBe(false);
    expect(summary).toHaveProperty('draining', true);
    // /healthz must not escalate an ordinary deploy to an error — the
    // components really are fine, and paging on every rollout is how a
    // health check gets ignored.
    expect(summary.status).toBe('degraded');
  });

  it('reports draining without hiding a real component failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('kb down');
      }),
    );
    beginShutdown();
    const summary = await getHealthSummary(context);
    expect(summary.ready).toBe(false);
    expect((summary.components.kbService as { status: string }).status).toBe('error');
  });
});
