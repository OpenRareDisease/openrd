import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getHealthSummary, _respondWithHealth } from './index.js';
import type { HealthSummary, RouteContext } from './index.js';
import { _resetShutdownState, beginShutdown } from '../lifecycle.js';

/**
 * Two contracts are pinned here, and both are things a deploy silently
 * gets wrong.
 *
 * 1. WHAT `ready` MEANS. A deploy is only graceful if the load balancer
 *    learns about it before the listener closes, and the only channel
 *    for that is this summary's `ready` flag — so the draining case is
 *    asserted here rather than left to the shutdown script, which is
 *    separated from it by a signal handler no test can reach. The
 *    inverse matters just as much: readiness must NOT follow a
 *    feature-scoped dependency. `ready` was gated on the KB being 'ok',
 *    which meant a warming or restarting KB took the whole API out of
 *    rotation and — through compose's depends_on chain — stopped the
 *    web container from starting at all.
 *
 * 2. WHAT /healthz TELLS A STRANGER. The route is anonymous on the
 *    public domain, and the full summary carries raw pg error text,
 *    internal service URLs and absolute container paths.
 */

const dbProbe = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })),
}));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: dbProbe.query }),
}));

const baseEnv = {
  // Not 'embedded', so the OCR probe short-circuits instead of
  // shelling out to Python.
  OCR_PROVIDER: 'mock',
  OCR_PYTHON_BIN: 'python3',
  HEALTHCHECK_TIMEOUT_MS: 500,
  kbServiceUrl: 'http://kb.invalid',
  AI_API_MODEL: 'test-model',
  AI_API_KEY: 'k',
  STORAGE_PROVIDER: 'local',
  isProductionLike: false,
};

const makeContext = (envOverrides: Record<string, unknown> = {}) =>
  ({
    env: { ...baseEnv, ...envOverrides },
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  }) as unknown as RouteContext;

const context = makeContext();

const stubKb = (status: string, httpStatus: number, state: unknown = null) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ status, state }), { status: httpStatus })),
  );

const kbReady = () => stubKb('ready', 200);

const kbDown = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('kb down');
    }),
  );

const componentStatus = (summary: HealthSummary, name: string) =>
  (summary.components[name] as { status: string }).status;

afterEach(() => {
  _resetShutdownState();
  vi.unstubAllGlobals();
  dbProbe.query.mockReset();
  dbProbe.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
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
    kbDown();
    beginShutdown();
    const summary = await getHealthSummary(context);
    expect(summary.ready).toBe(false);
    expect(componentStatus(summary, 'kbService')).toBe('error');
  });
});

describe('readiness is not gated on the knowledge base', () => {
  it('stays ready with the KB service completely down', async () => {
    kbDown();
    const summary = await getHealthSummary(context);
    // The whole point: auth, profile, measurement entry and document
    // upload all work without the KB, so a dead KB must not take this
    // instance out of rotation.
    expect(summary.ready).toBe(true);
    expect(summary.status).toBe('degraded');
    expect(componentStatus(summary, 'kbService')).toBe('error');
  });

  it('stays ready while the KB is still warming', async () => {
    stubKb('warming', 503);
    const summary = await getHealthSummary(context);
    expect(summary.ready).toBe(true);
    expect(summary.status).toBe('degraded');
    expect(componentStatus(summary, 'kbService')).toBe('warming');
  });

  it('surfaces an un-ingested corpus as its own status, not a generic error', async () => {
    // A warm model over zero kb_chunks reads as an ordinary KB outage
    // in the generic 'error' bucket, and the operator goes looking at
    // the network for a service that just needs `npm run kb:ingest`.
    stubKb('empty_corpus', 503, { corpusChunks: 0 });
    const summary = await getHealthSummary(context);
    expect(summary.ready).toBe(true);
    expect(componentStatus(summary, 'kbService')).toBe('empty_corpus');
    expect((summary.components.kbService as { state: unknown }).state).toEqual({
      corpusChunks: 0,
    });
  });

  it('still fails readiness when the database is down', async () => {
    // Relaxing the KB gate must not have relaxed the components that
    // genuinely make every request fail.
    kbReady();
    dbProbe.query.mockRejectedValueOnce(new Error('connection refused'));
    const summary = await getHealthSummary(context);
    expect(componentStatus(summary, 'database')).toBe('error');
    expect(summary.ready).toBe(false);
    expect(summary.status).toBe('error');
  });
});

describe('configuration problems that no probe would catch', () => {
  it('reports degraded when neither AI key is set', async () => {
    kbReady();
    const summary = await getHealthSummary(
      makeContext({ AI_API_KEY: undefined, OPENAI_API_KEY: undefined }),
    );
    // Ready, because auth/profile/upload are unaffected — but an
    // operator watching /healthz has to be able to see that every
    // patient question is about to answer 「AI 服务未配置」.
    expect(summary.ready).toBe(true);
    expect(summary.status).toBe('degraded');
    expect(componentStatus(summary, 'ai')).toBe('not_configured');
  });

  it('reports object storage as unreachable instead of green', async () => {
    // validateStorageEnv only asserts the MinIO settings are present,
    // and compose always supplies a default endpoint — so a prod stack
    // brought up without the minio container passed every check and
    // then 500'd on the first patient upload.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('kb.invalid')) {
          return new Response(JSON.stringify({ status: 'ready' }), { status: 200 });
        }
        throw new Error('getaddrinfo ENOTFOUND minio');
      }),
    );
    const summary = await getHealthSummary(
      makeContext({ STORAGE_PROVIDER: 'minio', MINIO_ENDPOINT: 'minio:9000' }),
    );
    expect(summary.status).toBe('degraded');
    expect(componentStatus(summary, 'storage')).toBe('error');
    // Not a readiness failure: taking the API out of rotation over the
    // object store would break auth and profile reads too.
    expect(summary.ready).toBe(true);
  });

  it('treats any HTTP answer from the object store as reachable', async () => {
    // A managed S3-compatible endpoint does not serve MinIO's health
    // path; a 403 there still proves something is listening.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input).includes('kb.invalid')
          ? new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
          : new Response('AccessDenied', { status: 403 }),
      ),
    );
    const summary = await getHealthSummary(
      makeContext({ STORAGE_PROVIDER: 'minio', MINIO_ENDPOINT: 'https://s3.example.com' }),
    );
    expect(componentStatus(summary, 'storage')).toBe('ok');
    expect(summary.status).toBe('ok');
  });
});

describe('what /healthz discloses to an anonymous caller', () => {
  const fullSummary = (): HealthSummary => ({
    status: 'degraded',
    ready: true,
    components: {
      database: { status: 'error', detail: 'connection to server at "10.0.3.7", port 5432 failed' },
      kbService: {
        status: 'error',
        url: 'http://kb-service:5010/health/ready',
        state: { lastError: 'psycopg: password authentication failed for user "postgres"' },
      },
      ocr: {
        status: 'ok',
        pythonBin: 'python3',
        pythonVersion: 'Python 3.11.9',
        parserPath: '/app/apps/report-manager/embedded_parser.py',
      },
      storage: { status: 'ok', provider: 'minio', endpoint: 'minio:9000' },
      ai: { status: 'configured', model: 'Qwen/Qwen2.5-72B-Instruct' },
    },
  });

  const requestFrom = (remoteAddress: string) =>
    ({ socket: { remoteAddress } }) as unknown as Request;

  it('strips every diagnostic field for a remote caller in production', () => {
    const ctx = makeContext({ isProductionLike: true });
    const body = _respondWithHealth(ctx, requestFrom('172.18.0.4'), fullSummary());

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('10.0.3.7');
    expect(serialized).not.toContain('kb-service:5010');
    expect(serialized).not.toContain('/app/apps/report-manager');
    expect(serialized).not.toContain('Python 3.11.9');
    expect(serialized).not.toContain('password authentication failed');
    expect(serialized).not.toContain('Qwen');

    // The verdict itself is still public — that is what a health check
    // is for.
    expect(body.status).toBe('degraded');
    expect(body.ready).toBe(true);
    expect(body.components).toEqual({
      database: { status: 'error' },
      kbService: { status: 'error' },
      ocr: { status: 'ok' },
      storage: { status: 'ok' },
      ai: { status: 'configured' },
    });
  });

  it('logs the withheld detail against the requestId it hands back', () => {
    const ctx = makeContext({ isProductionLike: true });
    const body = _respondWithHealth(ctx, requestFrom('172.18.0.4'), fullSummary());

    expect(body.requestId).toEqual(expect.any(String));
    const warn = ctx.logger.warn as unknown as ReturnType<typeof vi.fn>;
    expect(warn).toHaveBeenCalledTimes(1);
    const [logged] = warn.mock.calls[0] as [{ requestId: string; health: HealthSummary }];
    expect(logged.requestId).toBe(body.requestId);
    expect(JSON.stringify(logged.health)).toContain('10.0.3.7');
  });

  it('does not log on a healthy poll — the compose probe runs every 15s', () => {
    const ctx = makeContext({ isProductionLike: true });
    _respondWithHealth(ctx, requestFrom('172.18.0.4'), { ...fullSummary(), status: 'ok' });
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  it('keeps the full payload for a loopback caller', () => {
    const ctx = makeContext({ isProductionLike: true });
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const body = _respondWithHealth(ctx, requestFrom(peer), fullSummary());
      expect(JSON.stringify(body)).toContain('/app/apps/report-manager');
      expect(body).not.toHaveProperty('requestId');
    }
  });

  it('reads the TCP peer, not a header-derived req.ip', () => {
    // `trust proxy` makes req.ip the X-Forwarded-For value, which the
    // caller controls — so a remote client claiming to be 127.0.0.1
    // must still get the redacted payload.
    const ctx = makeContext({ isProductionLike: true });
    const spoofed = {
      ip: '127.0.0.1',
      socket: { remoteAddress: '172.18.0.4' },
    } as unknown as Request;
    const body = _respondWithHealth(ctx, spoofed, fullSummary());
    expect(JSON.stringify(body)).not.toContain('/app/apps/report-manager');
  });

  it('keeps the full payload outside production so local debugging works', () => {
    const ctx = makeContext({ isProductionLike: false });
    const body = _respondWithHealth(ctx, requestFrom('172.18.0.4'), fullSummary());
    expect(JSON.stringify(body)).toContain('10.0.3.7');
  });
});
