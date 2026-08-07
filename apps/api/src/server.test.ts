import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the ACCESS LOG is allowed to contain.
 *
 * The public share surface carries its credential in the URL path, so
 * the request logger is the one component that can quietly create a
 * second, working copy of it. Nothing in the suite touched pinoHttp,
 * `sanitizeHeaders` or the redact config before this file, which is why
 * a full replayable passport URL was being written to stdout at level
 * info on every open without a single test going red.
 *
 * These tests drive the real `createServer` — the same middleware stack
 * production boots — and read the log lines back off pino's destination.
 */

const queryMock = vi.fn();

vi.mock('./db/pool.js', () => ({
  initPool: vi.fn(),
  getPool: () => ({ query: queryMock }),
  closePool: vi.fn(),
}));

const { createServer } = await import('./server.js');
const { loadAppEnv, resetAppEnvCache } = await import('./config/env.js');

/** A token shaped like the real thing: 32 bytes of CSPRNG, base64url. */
const TOKEN = 'lJ8Qm3Zt7bF0xR2cN6vY1sK4hW9dA5pG-eU_TnC8oI0';

const makeApp = () => {
  const lines: Array<Record<string, unknown>> = [];
  const raw: string[] = [];
  const destination = {
    write: (chunk: string) => {
      raw.push(chunk);
      lines.push(JSON.parse(chunk) as Record<string, unknown>);
    },
  };
  resetAppEnvCache();
  const env = loadAppEnv({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
  const logger = pino({ level: 'info' }, destination as never);
  return { app: createServer({ env, logger }), lines, raw };
};

/** pino-http writes on the response's `finish` event, which lands after
 *  supertest has already resolved. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

const requestLine = (lines: Array<Record<string, unknown>>) =>
  lines.find((line) => 'req' in line)?.req as { url?: string; method?: string } | undefined;

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('分享令牌不能进访问日志', () => {
  it('打开分享链接后，整行日志里都找不到那个令牌', async () => {
    const { app, lines, raw } = makeApp();
    const res = await request(app).get(`/s/passport/${TOKEN}`);
    await flush();

    // The scrub is written against the path the share router is mounted
    // at, so first prove the request actually reached that router — a
    // moved mount point would otherwise leave this file green and the
    // real URL unscrubbed.
    expect(res.text).toContain('这个链接打不开了');

    // Not just `req.url`: the assertion is on the serialized line as a
    // whole, because the token is equally fatal if it turns up in
    // `req.params`, a query string or a header we forgot about.
    expect(raw.join('\n')).not.toContain(TOKEN);
    expect(requestLine(lines)).toBeDefined();
  });

  it('留下路由形状，操作者仍然看得出「有人打开了一个分享链接」', async () => {
    const { app, lines } = makeApp();
    await request(app).get(`/s/passport/${TOKEN}`);
    await flush();

    const req = requestLine(lines);
    expect(req?.method).toBe('GET');
    expect(req?.url).toBe('/s/passport/[Redacted]');
  });

  it('查询串里的令牌一起擦掉，路径后缀也不能漏出来', async () => {
    const { app, raw } = makeApp();
    await request(app).get(`/s/passport/${TOKEN}?from=wechat`);
    await flush();

    expect(raw.join('\n')).not.toContain(TOKEN);
    // The rest of the URL is not the credential and stays legible.
    expect(raw.join('\n')).toContain('/s/passport/[Redacted]?from=wechat');
  });

  it('取件码表单的路径不被当成令牌擦掉 —— 它是个路由，不是凭证', async () => {
    const { app, lines } = makeApp();
    await request(app).get('/s/passport/pickup');
    await flush();

    expect(requestLine(lines)?.url).toBe('/s/passport/pickup');
  });

  it('取件码走 POST body，本来就不进 URL —— 这里把它钉住', async () => {
    const { app, raw } = makeApp();
    await request(app)
      .post('/s/passport/pickup')
      .type('form')
      .send({ code: 'K7F3-9QTM', dob: '19850312' });
    await flush();

    expect(raw.join('\n')).not.toContain('K7F3');
    expect(raw.join('\n')).toContain('/s/passport/pickup');
  });
});

describe('凭证头不能进访问日志', () => {
  it('Authorization 和 Cookie 在日志里是 [Redacted]', async () => {
    const { app, lines, raw } = makeApp();
    await request(app)
      .get('/api/healthz')
      .set('authorization', 'Bearer jwt-that-would-open-every-record')
      .set('cookie', 'session=abc123');
    await flush();

    expect(raw.join('\n')).not.toContain('jwt-that-would-open-every-record');
    expect(raw.join('\n')).not.toContain('session=abc123');
    const req = lines.find((line) => 'req' in line)?.req as {
      headers?: Record<string, unknown>;
    };
    expect(req?.headers?.authorization).toBe('[Redacted]');
    expect(req?.headers?.cookie).toBe('[Redacted]');
  });
});
