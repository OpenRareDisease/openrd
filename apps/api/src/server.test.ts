import { createHash } from 'node:crypto';
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

const { createServer, logSerializers } = await import('./server.js');
const { loadAppEnv, resetAppEnvCache } = await import('./config/env.js');

/** A token shaped like the real thing: 32 bytes of CSPRNG, base64url. */
const TOKEN = 'lJ8Qm3Zt7bF0xR2cN6vY1sK4hW9dA5pG-eU_TnC8oI0';
/** What `PassportShareService.resolve` looks the token up by. Seeing it
 *  in the query arguments is how a test proves a spelling really got as
 *  far as the resolver with the live credential, rather than 404ing
 *  somewhere above it. */
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
/** What `sanitizeHeaders` writes in place of a credential header. */
const REDACTED_LABEL = '[Redacted]';
const reachedResolver = () =>
  queryMock.mock.calls.some((call) => JSON.stringify(call[1] ?? '').includes(TOKEN_HASH));

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

const responseLine = (lines: Array<Record<string, unknown>>) =>
  lines.find((line) => 'res' in line)?.res as
    | { statusCode?: number | null; headers?: Record<string, unknown> }
    | undefined;

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

  /**
   * `req.url` is not the only field on the line a whole share URL fits
   * in, and the two below were measured writing the live token to
   * stdout while every assertion above stayed green.
   */
  it('Referer 里带着分享链接 —— 任何一条路由上都不能漏', async () => {
    const { app, raw, lines } = makeApp();
    // Not a hypothetical shape: the share pages send `Referrer-Policy:
    // no-referrer`, but that governs browsers we serve, not what an
    // arbitrary client sends us — and the header lands on whatever
    // route it is sent to, which is usually not the share router.
    await request(app).get('/api/healthz').set('referer', `https://openrd.cn/s/passport/${TOKEN}`);
    await flush();

    expect(raw.join('\n')).not.toContain(TOKEN);
    const req = lines.find((line) => 'req' in line)?.req as {
      headers?: Record<string, unknown>;
    };
    // The route prefix survives, same as in `url` — an operator can
    // still see a share page was the referrer.
    expect(req?.headers?.referer).toBe('https://openrd.cn/s/passport/[Redacted]');
  });

  it('查询串参数里带着一整条分享链接 —— req.query 也是这条日志的一部分', async () => {
    const { app, raw } = makeApp();
    // The url match stops at the `?`, so the second copy is scrubbed by
    // the /g pass over `url` — but pino serializes `req.query` beside
    // `req.url`, and that copy is only reached by walking the object.
    await request(app).get(`/api/healthz?next=/s/passport/${TOKEN}`);
    await flush();

    expect(raw.join('\n')).not.toContain(TOKEN);
    expect(raw.join('\n')).toContain('/s/passport/[Redacted]');
  });
});

/**
 * The same token, spelled the ways Express will still route.
 *
 * Every test above uses the canonical `/s/passport/<token>`, which is
 * why a case-sensitive single-slash scrub shipped: `case sensitive
 * routing` and `strict routing` are both off, so four other spellings
 * reach `GET /:token` with `req.params.token` equal to the token,
 * render the patient's whole record, and — before this — wrote the
 * working credential to stdout in clear.
 *
 * Each case asserts BOTH halves, because either one alone is green on
 * the broken code: that the request really did reach the resolver (the
 * lookup went out keyed on sha256 of THIS token, so it is a live
 * credential and not a 404 shape), and that the token is nowhere in
 * the emitted line.
 *
 * A distinct X-Forwarded-For per case so none of them inherits the
 * open limiter's bucket from another.
 */
describe('令牌的每一种拼法都得擦掉，不只是标准那一种', () => {
  const ROUTED: Array<[string, string, string]> = [
    [`/S/passport/${TOKEN}`, '/S/passport/[Redacted]', '路由默认大小写不敏感，首段大写照样进'],
    [`/s/PASSPORT/${TOKEN}`, '/s/PASSPORT/[Redacted]', '中间那一段大写也一样'],
    [`/s/passport//${TOKEN}`, '/s/passport//[Redacted]', '多一个斜杠，挂载点会吃掉它'],
    [`/s/passport/${TOKEN}/`, '/s/passport/[Redacted]', '末尾多一个斜杠，非严格路由照样匹配'],
    [
      `/s/passport/%6C${TOKEN.slice(1)}`,
      '/s/passport/[Redacted]',
      '令牌首字母百分号编码，Express 解码后仍是同一个令牌',
    ],
  ];

  ROUTED.forEach(([path, expected, why], index) => {
    it(`${path.replace(TOKEN, '<token>').replace(TOKEN.slice(1), '<token>')} —— ${why}`, async () => {
      const { app, lines, raw } = makeApp();
      await request(app)
        .get(path)
        .set('x-forwarded-for', `198.51.100.${10 + index}`);
      await flush();

      // It reached the resolver WITH THIS TOKEN: the lookup went out
      // keyed on sha256(TOKEN), so this is the record-rendering path
      // with a live credential in the URL, not a 404 that never looked
      // and not some other query the stack happened to make.
      expect(reachedResolver()).toBe(true);
      expect(raw.join('\n')).not.toContain(TOKEN);
      expect(requestLine(lines)?.url).toBe(expected);
    });
  });

  /**
   * Spellings Express routes NOWHERE — and that is not a reason to log
   * the token. The credential in them is still live and still works at
   * the canonical spelling, so a scrub keyed on what the router matched
   * would miss exactly these.
   */
  const UNROUTED: Array<[string, string, string]> = [
    [`/s/passport///${TOKEN}`, '/s/passport///[Redacted]', '三个斜杠，挂载点之后就没人认了'],
    [`/s/passport/a/${TOKEN}`, '/s/passport/[Redacted]', '中间多一段，整条尾巴都得擦'],
    [`/s/passport/pickup/${TOKEN}`, '/s/passport/[Redacted]', '接在取件码路由后面的令牌不受豁免'],
    // The prefix's first `\/+` is pure over-scrub, not a match for
    // router behaviour: the mount path is matched literally, so an
    // extra slash HERE routes nowhere, unlike the one before the token.
    [`/s//passport/${TOKEN}`, '/s//passport/[Redacted]', '挂载点那一段的斜杠不能多 —— 但还是得擦'],
    // Percent-encoding INSIDE the route literals. Express matches the
    // undecoded pathname, so these 404 — but the decoding chain reaches
    // the prefix, and the line reports the decoded form. They used to
    // live in the documented residual below, on the argument that they
    // route nowhere; the token in them was live all the same.
    [`/%73/passport/${TOKEN}`, '/s/passport/[Redacted]', '第一段编码 —— 解码链认得出来'],
    [`/s/pass%70ort/${TOKEN}`, '/s/passport/[Redacted]', '第二段里的编码，同理'],
  ];

  UNROUTED.forEach(([path, expected, why], index) => {
    it(`${path.replace(TOKEN, '<token>')} —— ${why}`, async () => {
      const { app, lines, raw } = makeApp();
      await request(app)
        .get(path)
        .set('x-forwarded-for', `198.51.100.${20 + index}`);
      await flush();

      // The mirror of the ROUTED block's first assertion: these really
      // did NOT reach the resolver, which is what makes them the case
      // a router-keyed scrub would have missed entirely.
      expect(reachedResolver()).toBe(false);
      expect(raw.join('\n')).not.toContain(TOKEN);
      expect(requestLine(lines)?.url).toBe(expected);
    });
  });

  /**
   * The pickup exemption has to survive the same permissiveness, or an
   * operator loses the one route shape the scrub is meant to keep.
   *
   * This is the full set of pickup spellings that Express actually
   * serves the form for — driving the real router over a grammar of
   * first segment × separators × case found no others. Each case
   * asserts BOTH halves, for the same reason the token cases do: that
   * the path really is a live route (200, and the form page came back),
   * and that the log line kept it readable. Asserting only the log line
   * would let「it is a route, not a credential」stay green after the
   * route moved.
   *
   * `/s/passport/pickup/` is the one the trailing `\/*` in the
   * lookahead exists for. Without that case here, deleting `\/*` is a
   * green mutation that starts redacting a live route.
   */
  it.each([
    ['/s/passport/pickup/', '末尾一个斜杠，非严格路由照样发同一个表单'],
    ['/s/passport//pickup/', '两处斜杠都多一个，还是同一个表单'],
    ['/s/passport/PICKUP', '大写的取件码路由仍然匹配 /pickup'],
    ['/s/passport/PiCkUp', '大小写混写也一样'],
    ['/s/passport//pickup', '多一个斜杠的取件码路由也还是路由'],
    ['/s/passport/pickup?x=1', '取件码路由后面带查询串'],
    ['/S/passport/pickup', '首段大写的取件码路由'],
    ['/s/PASSPORT/pickup', '中段大写的取件码路由'],
  ])('%s 仍然读得出来 —— %s', async (path) => {
    const { app, lines } = makeApp();
    const res = await request(app).get(path).set('x-forwarded-for', '198.51.100.60');
    await flush();

    // It is a route: the pickup form came back, so leaving it readable
    // is leaving a route readable and not a credential.
    expect(res.status).toBe(200);
    expect(res.text).toContain('取件码');
    expect(requestLine(lines)?.url).toBe(path);
  });
});

/**
 * The boundary, pinned from the other side.
 *
 * The scrub is keyed on the two literals `s` and `passport`, reached
 * either directly or by percent-decoding, so a target that spells them
 * with other characters keeps its token in the log. The set of such
 * targets is unbounded — every punctuation, truncation and case fold of
 * those two words — so it is a documented residual rather than a list
 * to chase closed.
 *
 * It IS a leak, and these cases say so out loud: the last assertion is
 * that the token is still on the line, and that token still opens the
 * record at the canonical spelling. 「It 404s」 is not the excuse — the
 * credential is the token, not the path it rode in on. What bounds the
 * residual is that nothing produces these targets mechanically; a
 * client encodes, folds case and doubles slashes, and all three are
 * covered above. Reaching one of these takes hand-typing, by someone
 * who already holds the token.
 *
 * The 404 assertion is kept for a narrower reason: if a future Express
 * or mount change makes one of them route, the residual stops being a
 * hand-typed curiosity and this file goes red rather than quietly
 * widening.
 */
describe('擦不到的拼法，也确实哪儿都进不去', () => {
  const UNCOVERED: Array<[string, string]> = [
    [`/s/passport./${TOKEN}`, '第二段后面多一个点，挂载点就不认了'],
    [`/s/passpor/${TOKEN}`, '第二段少一个字母'],
    [`/spassport/${TOKEN}`, '两段之间没有斜杠'],
    // The only case here that is not an edited literal. `%C5%BF` is the
    // long s, U+017F: `'ſ'.toUpperCase()` is ASCII `'S'`, but the `i`
    // flag folds it only with `u` alongside, and this pattern has no
    // `u` — so the decoding chain reduces the target to
    // `/ſ/paſſport/<token>` and neither form matches. Percent-encoded
    // rather than raw because a raw U+017F cannot reach Node at all:
    // its client rejects a path outside U+0021-U+00FF, and every
    // browser encodes it first, so this IS the spelling that arrives.
    [`/%C5%BF/pa%C5%BF%C5%BFport/${TOKEN}`, '长 s 折叠：i 标志没有 u 就不把 ſ 折成 s'],
  ];

  UNCOVERED.forEach(([path, why], index) => {
    it(`${path.replace(TOKEN, '<token>')} —— ${why}`, async () => {
      const { app, lines, raw } = makeApp();
      const res = await request(app)
        .get(path)
        .set('x-forwarded-for', `198.51.100.${70 + index}`);
      await flush();

      // Not a route — which is not what makes the residual survivable,
      // only what keeps it to hand-typed targets. Pinned so that a
      // mount change which makes one of these route turns this red.
      expect(res.status).toBe(404);
      expect(reachedResolver()).toBe(false);

      // And the residual itself, stated rather than implied: the token
      // IS still in the line, and it opens the record at the canonical
      // spelling. Widening the pattern to cover one of these is a fine
      // change — it just has to come with editing the boundary
      // paragraph in server.ts, which this assertion forces.
      expect(raw.join('\n')).toContain(TOKEN);
      expect(requestLine(lines)?.url).toBe(path);
    });
  });
});

/**
 * The spelling `encodeURIComponent` produces — i.e. the normal one.
 *
 * `req.url` on the emitted line is `req.originalUrl`, the RAW request
 * target, so a share URL passed as a query parameter arrives with its
 * slashes as `%2F` and a pattern over the raw target never sees the
 * route literals. The token is base64url and needs no escaping, so it
 * sat there byte for byte. The 「查询串参数里带着一整条分享链接」 test
 * above picks the raw-slash spelling, which a client produces only by
 * forgetting to encode; every case here was measured writing the live
 * token to stdout while that test stayed green.
 *
 * Each case asserts the token is gone AND what the line says instead,
 * because 「token is gone」 alone is also satisfied by redacting the
 * whole field, and the point of keeping the prefix is that an operator
 * can still read what happened.
 */
describe('百分号编码的分享链接 —— encodeURIComponent 是正常写法，不是异常写法', () => {
  const ENCODED: Array<[string, string, string]> = [
    [
      `/api/healthz?next=${encodeURIComponent(`/s/passport/${TOKEN}`)}`,
      '/api/healthz?next=/s/passport/[Redacted]',
      'encodeURIComponent 编出来的那一条',
    ],
    [
      `/api/healthz?next=${encodeURIComponent(encodeURIComponent(`/s/passport/${TOKEN}`))}`,
      '/api/healthz?next=/s/passport/[Redacted]',
      '再编一次 —— 解码链得往下走两层',
    ],
    [
      `/api/healthz?next=%2fS%2fPASSPORT%2f${TOKEN}`,
      '/api/healthz?next=/S/PASSPORT/[Redacted]',
      '小写的 %2f 配大写的路由段 —— 编码和大小写可以叠在一起',
    ],
  ];

  ENCODED.forEach(([path, expected, why], index) => {
    it(`${path.replace(TOKEN, '<token>')} —— ${why}`, async () => {
      const { app, lines, raw } = makeApp();
      await request(app)
        .get(path)
        .set('x-forwarded-for', `198.51.100.${80 + index}`);
      await flush();

      expect(raw.join('\n')).not.toContain(TOKEN);
      // The decoded form, not the raw target: the raw one cannot be
      // kept, because keeping it is keeping the token.
      expect(requestLine(lines)?.url).toBe(expected);
    });
  });

  /**
   * A stray `%` somewhere else on the line must not take the encoded
   * share URL down with it.
   *
   * `decodeURIComponent` throws on ANY malformed escape in its input,
   * so decoding the whole string and catching the throw aborted the
   * chain at depth 0 — and the encoded share URL beside it was never
   * decoded and never scrubbed. Measured leaking, on a line whose
   * `req.query.next` was correctly redacted: the same credential once
   * clean and once in clear. `?discount=20%` is an ordinary thing for a
   * URL to carry, and a third-party Referer is not ours to sanitise, so
   * this was not an exotic input. It was the third round on this token.
   */
  const MALFORMED_NEIGHBOUR: Array<[string, string]> = [
    [`&bad=%`, '尾随的裸百分号'],
    [`&x=%ZZ`, '不是十六进制的转义'],
    [`&pct=100%`, '一个百分比数字，最普通不过的取值'],
  ];

  MALFORMED_NEIGHBOUR.forEach(([suffix, why], index) => {
    it(`同一行上另有 ${suffix} —— ${why}，分享链接照样要被擦掉`, async () => {
      const { app, lines, raw } = makeApp();
      await request(app)
        .get(`/api/healthz?next=${encodeURIComponent(`/s/passport/${TOKEN}`)}${suffix}`)
        .set('x-forwarded-for', `198.51.100.${100 + index}`);
      await flush();

      expect(raw.join('\n')).not.toContain(TOKEN);
      expect(requestLine(lines)?.url).toContain('/s/passport/[Redacted]');
    });
  });

  it('坏转义排在分享链接前面 —— 顺序不该有影响', async () => {
    const { app, lines, raw } = makeApp();
    await request(app)
      .get(`/api/healthz?a=%&next=${encodeURIComponent(`/s/passport/${TOKEN}`)}`)
      .set('x-forwarded-for', '198.51.100.110');
    await flush();

    expect(raw.join('\n')).not.toContain(TOKEN);
    expect(requestLine(lines)?.url).toContain('/s/passport/[Redacted]');
  });

  it('Referer 里坏转义和编码过的分享链接并排 —— 头字段走的是同一条链', async () => {
    const { app, raw } = makeApp();
    await request(app)
      .get('/api/healthz')
      .set('x-forwarded-for', '198.51.100.111')
      .set(
        'referer',
        `https://openrd.cn/r?to=${encodeURIComponent(`/s/passport/${TOKEN}`)}&j=%E0%A4%A`,
      );
    await flush();

    expect(raw.join('\n')).not.toContain(TOKEN);
  });

  it('Referer 里的分享链接被整条编码 —— 头字段也走同一条解码链', async () => {
    const { app, raw, lines } = makeApp();
    await request(app)
      .get('/api/healthz')
      .set('x-forwarded-for', '198.51.100.90')
      .set('referer', `https://openrd.cn/r?to=${encodeURIComponent(`/s/passport/${TOKEN}`)}`);
    await flush();

    expect(raw.join('\n')).not.toContain(TOKEN);
    const req = lines.find((line) => 'req' in line)?.req as {
      headers?: Record<string, unknown>;
    };
    expect(req?.headers?.referer).toBe('https://openrd.cn/r?to=/s/passport/[Redacted]');
  });

  /**
   * The `#` in the lookahead's terminator class, pinned.
   *
   * It cannot arrive in a request target — Node and every browser strip
   * the fragment before sending, so `GET /s/passport/pickup#form`
   * reaches Express as `/s/passport/pickup`. But the walk covers query
   * VALUES, and `%23` in one decodes to a real `#`. Drop the `#` from
   * the class and the pickup exemption stops terminating where the
   * tail's `[^?#]*` terminates, so a live route logs as
   * `/s/passport/[Redacted]#form` in `req.query`.
   *
   * `req.url` over-scrubs the same value, and that is left alone: in
   * the RAW target the terminator is still `%23`, so the exemption does
   * not fire and the tail runs on. Over-scrubbing a route costs an
   * operator nothing here — `req.query.next` on the same line keeps it
   * readable — and the alternative is teaching the lookahead a second
   * spelling of `#`, which is one more branch to leave untested.
   */
  it('查询串里的取件码链接带锚点 —— 取件码是路由，锚点不改变这一点', async () => {
    const { app, lines } = makeApp();
    await request(app)
      .get('/api/healthz?next=/s/passport/pickup%23form')
      .set('x-forwarded-for', '198.51.100.91');
    await flush();

    const req = lines.find((line) => 'req' in line)?.req as {
      query?: Record<string, unknown>;
    };
    expect(req?.query?.next).toBe('/s/passport/pickup#form');
    expect(requestLine(lines)?.url).toBe('/api/healthz?next=/s/passport/[Redacted]');
  });
});

/**
 * The response half of the line has to BE there before scrubbing it
 * means anything.
 *
 * pino-http wraps a custom serializer around the standard one and hands
 * it the standard one's OUTPUT. Calling `pino.stdSerializers.res` again
 * on that output reads `res.headersSent` and `res.getHeaders`, which it
 * does not have, so every line shipped as `"res":{"statusCode":null}` —
 * an access log with no status and no headers, and a response-side
 * scrub that could not run because there was nothing to run it on.
 */
describe('响应那一半：状态码是真的，响应头也在，而且擦过', () => {
  it('访问日志里有真正的状态码和响应头', async () => {
    const { app, lines } = makeApp();
    await request(app).get('/api/healthz').set('x-forwarded-for', '198.51.100.95');
    await flush();

    const res = responseLine(lines);
    expect(res?.statusCode).toBe(200);
    expect(res?.headers?.['content-type']).toContain('application/json');
  });

  it('请求那一半也没被二次序列化掉 —— 客户端地址还在', async () => {
    const { app, lines } = makeApp();
    await request(app).get('/api/healthz').set('x-forwarded-for', '198.51.100.96');
    await flush();

    // `remoteAddress` / `remotePort` come off `req.socket`, which the
    // serialized record does not carry — the second pass dropped them.
    const req = requestLine(lines) as { remoteAddress?: string } | undefined;
    expect(req?.remoteAddress).toBeTruthy();
  });

  /**
   * Fed directly, because nothing in this API calls `res.redirect`, so
   * no request can produce a `Location` header. The input is the record
   * shape pino-http produces — `wrapResponseSerializer` hands the
   * custom serializer `{ statusCode, headers }` — and the assertion
   * above proves that is really what arrives.
   */
  it('Location 里的分享链接擦掉，Set-Cookie 也不能留', () => {
    const line = logSerializers.res({
      statusCode: 302,
      headers: {
        location: `/s/passport/${TOKEN}`,
        'set-cookie': 'session=abc123',
        'content-type': 'text/html',
      },
    }) as { statusCode?: number; headers?: Record<string, unknown> };

    expect(JSON.stringify(line)).not.toContain(TOKEN);
    expect(line.statusCode).toBe(302);
    expect(line.headers?.location).toBe('/s/passport/[Redacted]');
    expect(line.headers?.['set-cookie']).toBe(REDACTED_LABEL);
    // Everything else stays legible.
    expect(line.headers?.['content-type']).toBe('text/html');
  });
});

/**
 * How deep the walk has to go before it stops.
 *
 * Express parses query strings with qs in extended mode by default and
 * qs nests to depth 5, so `?a[b][c][d]=…` is one unauthenticated GET on
 * any route — and against the old cap of 4 it landed one level past the
 * walk and put the live token on the line verbatim, while every
 * assertion above stayed green.
 */
describe('嵌套查询串也在这条日志里 —— 走得不够深就等于没擦', () => {
  it.each([
    ['/api/healthz?a[b]=', 1],
    ['/api/healthz?a[b][c]=', 2],
    ['/api/healthz?a[b][c][d]=', 3],
    ['/api/healthz?a[b][c][d][e]=', 4],
  ])('%s<share-url> —— qs 造得出来的每一层', async (prefix) => {
    const { app, raw } = makeApp();
    await request(app).get(`${prefix}/s/passport/${TOKEN}`).set('x-forwarded-for', '198.51.100.99');
    await flush();

    expect(raw.join('\n')).not.toContain(TOKEN);
    expect(raw.join('\n')).toContain('/s/passport/[Redacted]');
  });

  it('比 qs 造得出来的还深 —— 走不进去的子树就不往外发', () => {
    // Deeper than the cap, and deeper than any request can produce, so
    // it goes to the serializer directly. The point is what happens at
    // the bottom: emitting a subtree the walk declined to enter is
    // emitting whatever string is inside it.
    let deep: unknown = `/s/passport/${TOKEN}`;
    for (let level = 0; level < 12; level += 1) {
      deep = { down: deep };
    }

    const line = logSerializers.req({ url: '/api/healthz', query: deep });
    expect(JSON.stringify(line)).not.toContain(TOKEN);
    expect(JSON.stringify(line)).toContain('[Unwalked]');
  });
});

describe('凭证头不能进访问日志', () => {
  // Every name in `sanitizeHeaders`'s list, so dropping one from it is
  // not a green mutation. `set-cookie` is a response header and is
  // covered by the Location case above.
  it.each([
    ['authorization', 'Bearer jwt-that-would-open-every-record'],
    ['cookie', 'session=abc123'],
    ['x-api-key', 'key-that-would-open-every-record'],
    ['proxy-authorization', 'Basic cHJveHk6c2VjcmV0'],
  ])('%s 在日志里是 [Redacted]', async (header, value) => {
    const { app, lines, raw } = makeApp();
    await request(app)
      .get('/api/healthz')
      .set('x-forwarded-for', '198.51.100.98')
      .set(header, value);
    await flush();

    expect(raw.join('\n')).not.toContain(value);
    const req = lines.find((line) => 'req' in line)?.req as {
      headers?: Record<string, unknown>;
    };
    expect(req?.headers?.[header]).toBe(REDACTED_LABEL);
  });
});
