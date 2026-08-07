import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../config/logger.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { notFoundHandler } from '../../middleware/not-found.js';

/**
 * The public half of the pickup flow, end to end through Express.
 *
 * Three things here cannot be tested at the service layer and have all
 * three broken this kind of feature before:
 *
 *  1. ROUTE ORDER. `/:token` is registered in the same router. If the
 *     pickup routes ever slide below it, Express hands the literal
 *     string 「pickup」 to `resolve()` and the form becomes a 404 —
 *     with every unit test still green.
 *  2. BODY PARSING. The app mounts express.json (server.ts) and this
 *     is an HTML form, so without the urlencoded middleware `req.body`
 *     is undefined, every submission reads as a wrong code, and the
 *     patient's three attempts are spent on our own missing line.
 *  3. THE SINGLE FAILURE PAGE. Wrong code, wrong birthdate, expired,
 *     burned, already used — one status and one body. A difference of
 *     even one byte tells a guesser they guessed a real patient.
 */

const queryMock = vi.fn();

vi.mock('../../db/pool.js', () => ({
  getPool: () => ({ query: queryMock }),
}));

const passportMock = vi.fn();

vi.mock('./profile.service.js', () => ({
  PatientProfileService: class {
    getClinicalPassportByUserId = passportMock;
  },
}));

const { createPublicPassportRouter } = await import('./passport-share.routes.js');

const logger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => logger,
} as unknown as AppLogger;

const context = { env: {} as AppEnv, logger };

const makeApp = () => {
  const app = express();
  // Mirrors server.ts, all four lines of it, because each one is a
  // thing this router has to survive:
  //   - trust proxy 1, so the rate limiters key on the forwarded client
  //     rather than on the proxy hop;
  //   - a JSON-only body parser, so a pickup route that stops bringing
  //     its own urlencoded middleware fails here and not in a hospital;
  //   - the app-level JSON notFoundHandler, which is where a path that
  //     matches no route in this router goes. This harness omitted it,
  //     so a test written here against an unmatched path would have been
  //     measured against Express's own HTML 「Cannot GET」 rather than
  //     against the 「{"error":"Route not found"}」 production actually
  //     returned — close enough to look fine, which is the shape of miss
  //     this file exists to prevent;
  //   - the app-level JSON error handler, which is precisely what the
  //     public surface must NOT fall through to.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));
  app.use('/s/passport', createPublicPassportRouter(context));
  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));
  return app;
};

/** 32 bytes of base64url, the shape `resolve()` accepts. */
const TOKEN = 'lJ8Qm3Zt7bF0xR2cN6vY1sK4hW9dA5pG-eU_TnC8oI0';

const summary = {
  patientName: '张三',
  generatedAt: '2026-08-05T00:00:00Z',
  diagnosis: {
    confirmation: 'self_reported' as const,
    geneticType: 'FSHD1',
    diagnosisDate: '2019-04-02',
    d4z4Repeats: null,
    methylationValue: null,
    geneEvidence: null,
  },
  motor: { summary: '上肢抬举受限', latestMeasurementAt: null, highlights: [] },
  imaging: { summary: null, latestMriDate: null },
  monitoring: { items: [] },
  timeline: [],
  nextSteps: [],
};

beforeEach(() => {
  queryMock.mockReset();
  passportMock.mockReset();
  (logger.error as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe('取件码表单页不能被 /:token 吃掉', () => {
  it('GET /s/passport/pickup 返回表单，而不是「链接已失效」', async () => {
    const res = await request(makeApp()).get('/s/passport/pickup');
    expect(res.status).toBe(200);
    expect(res.text).toContain('用取件码打开患者记录');
    expect(res.text).toContain('name="code"');
    expect(res.text).toContain('name="dob"');
    // Never reached the token resolver — that path would have queried.
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('表单 action 用挂载点算出来，不是写死的 /s/passport/pickup', async () => {
    const app = express();
    app.use('/proxy-prefix/s/passport', createPublicPassportRouter(context));
    const res = await request(app).get('/proxy-prefix/s/passport/pickup');
    expect(res.text).toContain('action="/proxy-prefix/s/passport/pickup"');
  });

  it('表单页不进缓存、不进索引、不带 Referer 出去', async () => {
    const res = await request(makeApp()).get('/s/passport/pickup');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('POST：表单编码真的被解析了', () => {
  it('对上了就直接渲染临床记录，不经过任何跳转', async () => {
    queryMock.mockResolvedValue({
      rows: [{ user_id: 'u1', share_id: 's1', dob_ok: true }],
      rowCount: 1,
    });
    passportMock.mockResolvedValue(summary);

    const res = await request(makeApp())
      .post('/s/passport/pickup')
      .type('form')
      .send({ code: 'k7f3-9qt7', dob: '19850312' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('临床记录摘要');
    // The service saw the fields, which is the whole point of this
    // test: a missing urlencoded parser makes both undefined and the
    // request fails as a wrong code instead.
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1][1]).toBe('1985-03-12');
  });

  it('取件码打开的页面不写「本链接将于 X 失效」—— 它已经用掉了', async () => {
    queryMock.mockResolvedValue({
      rows: [{ user_id: 'u1', share_id: 's1', dob_ok: true }],
      rowCount: 1,
    });
    passportMock.mockResolvedValue(summary);
    const res = await request(makeApp())
      .post('/s/passport/pickup')
      .type('form')
      .send({ code: 'K7F39QT7', dob: '19850312' });
    expect(res.text).toContain('取件码是一次性的');
    expect(res.text).not.toContain('本链接将于');
  });

  it('自我报告的诊断仍然顶着未确诊横幅 —— 换个入口不换这条规矩', async () => {
    queryMock.mockResolvedValue({
      rows: [{ user_id: 'u1', share_id: 's1', dob_ok: true }],
      rowCount: 1,
    });
    passportMock.mockResolvedValue(summary);
    const res = await request(makeApp())
      .post('/s/passport/pickup')
      .type('form')
      .send({ code: 'K7F39QT7', dob: '19850312' });
    expect(res.text).toContain('未经基因确诊');
  });
});

describe('每一种失败都是同一张页', () => {
  const submit = (body: Record<string, string>) =>
    request(makeApp()).post('/s/passport/pickup').type('form').send(body);

  it('码不存在、生日错、格式错、档案已删 —— 同一个状态码同一段正文', async () => {
    // never existed
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    const missing = await submit({ code: 'K7F39QT7', dob: '19850312' });

    // right code, wrong birthdate
    queryMock.mockResolvedValue({
      rows: [{ user_id: 'u1', share_id: 's1', dob_ok: false }],
      rowCount: 1,
    });
    const wrongDob = await submit({ code: 'K7F39QT7', dob: '19900101' });

    // malformed — never reaches the database at all
    const malformed = await submit({ code: 'nope', dob: 'nope' });

    // resolved, but the profile was deleted between minting and pickup
    queryMock.mockResolvedValue({
      rows: [{ user_id: 'u1', share_id: 's1', dob_ok: true }],
      rowCount: 1,
    });
    passportMock.mockResolvedValue(null);
    const deleted = await submit({ code: 'K7F39QT7', dob: '19850312' });

    for (const res of [missing, wrongDob, malformed, deleted]) {
      expect(res.status).toBe(404);
      expect(res.text).toBe(missing.text);
    }
    expect(missing.text).toContain('这个取件码打不开');
    // And it says so out loud, so an honest clinician does not read the
    // silence as us being coy about a bug.
    expect(missing.text).toContain('不会告诉你上面哪一种情况才是真的');
  });

  it('完全没有 body 时也是那张页，而不是 500', async () => {
    const res = await request(makeApp()).post('/s/passport/pickup');
    expect(res.status).toBe(404);
    expect(res.text).toContain('这个取件码打不开');
  });

  it('失败页也不进缓存、不进索引', async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await submit({ code: 'K7F39QT7', dob: '19850312' });
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
  });
});

/**
 * Failures that happen BEFORE any handler runs.
 *
 * Everything above this line is a page because the reader has no
 * account and no app. These were not: a rate-limit rejection, an
 * over-long form body and a throw on the way to the passport all fell
 * through to the app-level JSON error handler, so the clinician holding
 * the patient's phone read 「{"error":"请求过于频繁，请稍后再试"}」 as
 * the page — and, because those paths never reach `setPrivateHeaders`,
 * read it from a response with no no-store / noindex / no-referrer.
 *
 * The 429 case exhausts a module-global limiter bucket, so it keys on
 * its own X-Forwarded-For address and any test added after it should do
 * the same rather than inherit an emptied bucket.
 */
describe('还没进 handler 就失败的，也得是一张页', () => {
  it('限流 429 是一张中文页面，不是一段 JSON', async () => {
    const app = makeApp();
    const flood = '203.0.113.7';
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    let res = await request(app).get(`/s/passport/${TOKEN}`).set('x-forwarded-for', flood);
    for (let i = 0; i < 60 && res.status !== 429; i += 1) {
      res = await request(app).get(`/s/passport/${TOKEN}`).set('x-forwarded-for', flood);
    }

    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('这个链接暂时打不开');
    // It says whose fault it is not: one outpatient department is one
    // NAT address, and the link itself is still good.
    expect(res.text).toContain('链接本身没有失效');
    expect(res.text).not.toContain('{"error"');
    // Retry-After is set by the limiter before it hands over, and the
    // page reads the number back off it.
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.text).toContain(`请等 ${res.headers['retry-after']} 秒`);
    // The headers the handler would have applied, applied anyway.
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('超长的表单 body 得到 413 和一张页，不是 500「Internal server error」', async () => {
    const res = await request(makeApp())
      .post('/s/passport/pickup')
      .set('x-forwarded-for', '203.0.113.8')
      .type('form')
      .send(`code=${'x'.repeat(3000)}&dob=19850312`);

    // PayloadTooLargeError is neither AppError nor ZodError, so the JSON
    // handler flattened it to a 500 that blamed us for the doctor's
    // paste.
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('提交的内容太长了');
    expect(res.text).not.toContain('Internal server error');
    // And it puts them back on the form rather than at a dead end.
    expect(res.text).toContain('action="/s/passport/pickup"');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('查档案时抛异常 —— 500 也是一张页，而且说清楚不是链接失效', async () => {
    queryMock.mockRejectedValue(new Error('database is on fire'));

    const res = await request(makeApp())
      .get(`/s/passport/${TOKEN}`)
      .set('x-forwarded-for', '203.0.113.9');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('这一页现在打不开');
    expect(res.text).toContain('不是链接失效');
    // Nothing about the failure leaks into a page a stranger reads.
    expect(res.text).not.toContain('database is on fire');
    expect(res.text).not.toContain('Internal server error');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    // The app-level handler used to log this. It no longer sees it, so
    // this router has to.
    expect(logger.error).toHaveBeenCalled();
  });
});

/**
 * Paths under /s/passport that match NO route in this router.
 *
 * A different exit from the one above: a route miss calls plain
 * `next()`, and an Express error handler never sees that — the request
 * walks off the end of the router and out to the app-level
 * `notFoundHandler`, which is why `makeApp` above now mounts it. Before
 * the terminal layer, every one of these came back as
 * 「{"error":"Route not found"}」 as application/json, with none of the
 * private headers, from a URL a clinician got by forwarding a link
 * WeChat truncated or by deleting 「/pickup」 to go up a level.
 *
 * The assertions are on the answer, not on the layer: HTML, the same
 * page a dead token gets, and the headers — so a future route that
 * matches these paths and answers wrongly fails here too.
 */
describe('没匹配上任何路由的路径，也得是一张页', () => {
  const NOT_A_SHARE = [
    ['GET', '/s/passport', '被截断到最后一段的链接'],
    ['GET', '/s/passport/', '截断后又补了一个斜杠'],
    ['GET', '/s/passport/a/b', '多出一段'],
    ['GET', '/s/passport/pickup/extra', '取件码表单后面又接了东西'],
    ['POST', `/s/passport/${TOKEN}`, '对令牌页发 POST'],
  ] as const;

  for (const [method, path, why] of NOT_A_SHARE) {
    it(`${method} ${path}（${why}）返回中文页面，不是 JSON`, async () => {
      const app = makeApp();
      const res = await (method === 'POST' ? request(app).post(path) : request(app).get(path));

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('text/html');
      // The app-level JSON 404 is mounted in this harness, so this
      // assertion is what says the request never got that far.
      expect(res.text).not.toContain('Route not found');
      expect(res.text).not.toContain('{"error"');
      // The same page a revoked or expired token gets: an incomplete URL
      // and a dead link are the same situation for whoever holds it.
      expect(res.text).toContain('这个链接打不开了');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['x-robots-tag']).toContain('noindex');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });
  }

  it('这一层不吃掉它上面的路由 —— 取件码表单和令牌页还在', async () => {
    const app = makeApp();
    const form = await request(app).get('/s/passport/pickup');
    expect(form.status).toBe(200);
    expect(form.text).toContain('用取件码打开患者记录');

    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    const token = await request(app)
      .get(`/s/passport/${TOKEN}`)
      .set('x-forwarded-for', '203.0.113.10');
    expect(token.status).toBe(404);
    // Reached the resolver — the terminal layer never queries.
    expect(queryMock).toHaveBeenCalled();
  });
});
