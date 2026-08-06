import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../config/logger.js';

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
  // Mirrors server.ts: the app-level parser is JSON only. If the
  // pickup route stops bringing its own urlencoded middleware, this is
  // the line that makes the test notice.
  app.use(express.json({ limit: '256kb' }));
  app.use('/s/passport', createPublicPassportRouter(context));
  return app;
};

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
