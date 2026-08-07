import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppEnv } from './config/env.js';
import type { AppLogger } from './config/logger.js';
import { initPool } from './db/pool.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { registerRoutes } from './routes/index.js';

interface CreateServerOptions {
  env: AppEnv;
  logger: AppLogger;
}

const REDACTED = '[Redacted]';

/**
 * A passport share token is a bearer credential that travels in the URL
 * path (/s/passport/:token), so an unscrubbed access log is a second,
 * replayable copy of a patient's whole clinical record — diagnosis,
 * D4Z4 repeats, MRI summary — sitting in stdout and in whatever
 * collects it, for that sink's retention window. The feature is built
 * around that copy not existing: passport-share.service.ts opens by
 * stating the plaintext token is never stored or logged, `create()`
 * keeps it out of the audit row, and the pickup success line logs
 * { shareId } and not the code. pino-http was reinstating it at level
 * info on every open.
 *
 * The scrub runs on the SERIALIZED value rather than on the request:
 * pino.stdSerializers.req reads req.originalUrl in preference to
 * req.url, so rewriting req.url would miss it under Express. The route
 * prefix is kept so an operator can still see that a share was opened.
 * `req.url` on the emitted line is therefore `req.originalUrl` — the
 * RAW request target, byte for byte as the client wrote it, which is
 * why the encoding paragraph below exists.
 *
 * WHICH SPELLINGS THE PATTERN COVERS. Measured by driving the real
 * router — server.test.ts exercises every spelling named below — not
 * reasoned about from the route table.
 *
 * Three things widen it past the obvious `\/s\/passport\/` — the first
 * two because it must be LOOSER than Express's router, for two
 * different reasons, and the third because a request target is not
 * plain text. The first version was none of them.
 *
 * 1. Looser where the router is loose: case-insensitive, and `\/+`
 *    before the token. `case sensitive routing` and `strict routing`
 *    are both off — their Express defaults, and nothing here turns
 *    them on — so `/S/passport/<token>`, `/s/PASSPORT/<token>`,
 *    `/s/passport//<token>` (the mount's own optional trailing slash
 *    swallows the extra one) and `/s/passport/<token>/` all reach
 *    `GET /:token` with `req.params.token` equal to the token and
 *    render the whole record. A case-sensitive single-slash pattern
 *    scrubbed the canonical spelling and wrote those four to stdout in
 *    clear.
 *
 * 2. Looser where the router is NOT. The `\/+` between `s` and
 *    `passport` is pure over-scrub: the mount path is matched
 *    literally, so `/s//passport/<token>` 404s. So does everything
 *    past the first tail segment — `/s/passport///<token>` and
 *    `/s/passport/a/<token>` route nowhere. The token inside them is
 *    still live and still replayable at the canonical spelling, so the
 *    log must not keep it. That is also why this is a pattern over the
 *    string rather than a hook on what the router matched: the
 *    spellings that leak are disproportionately the ones the router
 *    REJECTED, and a router-keyed scrub would see none of them.
 *
 * 3. PERCENT-ENCODING IS NOT A SPELLING, IT IS AN ENCODING — and it is
 *    the one a normal client produces. A share URL carried inside a
 *    query parameter arrives as
 *    `?next=%2Fs%2Fpassport%2F<token>`, which is precisely what
 *    `encodeURIComponent` writes; a caller has to FORGET to encode to
 *    produce the raw-slash spelling. In that target the two literals
 *    are hidden behind `%2F` and no pattern over the raw request
 *    target matches, while the token — base64url, so nothing in it
 *    ever needs escaping — sits there byte for byte and decodes back
 *    to a working link. This was measured leaking on the same line
 *    that carried a correctly scrubbed `req.query.next`: Express had
 *    decoded the query, so the walk saw the prefix there, and the same
 *    credential went out once clean and once in clear.
 *
 *    So the pattern is applied over a percent-DECODING CHAIN, not over
 *    one string: the value, its decoding, that decoding's decoding,
 *    bounded at three passes (`decodedForms`). The DEEPEST form that
 *    matches is the one emitted — depth 2 catches
 *    `%252Fs%252Fpassport%252F…`, depth 0 still catches a raw target.
 *    Deepest first rather than shallowest because one value can carry
 *    one share URL raw and another encoded and only the fully decoded
 *    form sees both, and a form that does not match is skipped rather
 *    than emitted, so this never scrubs less than the old raw-only
 *    pass did. The price is that a line reporting an encoded target
 *    reports the DECODED one: `?next=/s/passport/[Redacted]` for a
 *    request that spelled it `%2Fs%2Fpassport%2F…`. The raw target
 *    cannot be kept here, because keeping it is keeping the token.
 *
 * The boundary is the two literals, not the route. `s` and `passport`,
 * in that order, slash-separated, reached either directly or by
 * decoding: a target that does not spell them that way is not scrubbed,
 * whatever it carries. That set is unbounded rather than a short list —
 * `/s/passport./<token>`, `/s/passpor/<token>`, `/spassport/<token>`,
 * non-ASCII case folding (`/s/passporK/…` — ſ and K do not fold under
 * a non-`u` `i` flag, here or in path-to-regexp's own regexp).
 *
 * State that residual for what it is: a leak. The token inside those
 * strings is untouched and still opens the record at the canonical
 * spelling, so 「it 404s」 is not what makes it survivable — the token
 * is the credential, not the path it arrived in. What bounds it is that
 * no client produces those MISSPELLINGS: they are edits to the two
 * literals, and an edited literal has to be typed by hand, character by
 * character, by someone already holding the token.
 *
 * That is a claim about spelling only, and it is worth being precise
 * about, because the looser version of this sentence — 「every
 * mechanical transformation a real client applies is covered」 — was
 * written here and was false. Encoding is not spelling, and the
 * decoding chain is a mechanism with its own failure modes; see
 * `decodedForms`, where a whole-string `decodeURIComponent` and one
 * stray `%` elsewhere on the line reopened this leak in its exact
 * original signature. What is covered is what the tests below cover.
 *
 * server.test.ts pins both halves: those targets 404, and the token IS
 * still on the line. Widening the pattern to cover one of them is a
 * fine change; it just has to come with editing this paragraph, which
 * that assertion forces.
 *
 * /s/passport/pickup stays readable — it is a route, not a credential,
 * and the pickup code itself only ever arrives in a POST body. The
 * `\/*` after 「pickup」 is what carries the exemption through
 * `/s/passport/pickup/`, which non-strict routing serves the same form;
 * delete it and that live route logs as `/s/passport/[Redacted]`. It is
 * wider than the router — `/s/passport/pickup//` 404s and is still left
 * readable — which costs nothing, because a run of slashes is not a
 * credential. The `#` beside `?` in the lookahead's terminator class
 * cannot arrive in a request target — Node and every browser strip the
 * fragment before sending, so `GET /s/passport/pickup#form` reaches
 * Express as `/s/passport/pickup` — but the walk covers headers and
 * query VALUES too, and `?next=/s/passport/pickup%23form` puts a real
 * `#` in one. It is there so the lookahead terminates wherever the
 * tail's `[^?#]*` terminates; drop it and `req.query.next` on that
 * request logs as `/s/passport/[Redacted]#form`. In the RAW target on
 * the same line the terminator is still `%23`, so the exemption does
 * not fire there and `req.url` over-scrubs to `/s/passport/[Redacted]`.
 * That is left alone deliberately: over-scrubbing a route costs an
 * operator nothing while `req.query` beside it stays readable, and
 * teaching the lookahead a second spelling of `#` is one more branch to
 * leave untested. A leading `\/*` used to sit inside the
 * lookahead as well, credited here as the thing stopping the engine
 * backtracking one slash out of the prefix and redacting 「pickup」 as a
 * token. It cannot do that: the only position it matches at starts with
 * `/`, and the tail's first character class `[^/?#]` rejects `/` there
 * anyway. Measured at 0 differences over 400,000 random strings and a
 * 14,280-URL grammar, and removed. Anything appended after 「pickup」 is
 * a token again — `/s/passport/pickup/<token>` redacts.
 */
const SHARE_TOKEN_IN_PATH = /(\/s\/+passport\/+)(?!pickup\/*(?:[?#]|$))[^/?#][^?#]*/gi;

/** The value, then each successive percent-decoding of it, shallowest
 *  first. Stops on a fixed point and at three passes — `%252525…` is not
 *  a spelling anyone sends, and an unbounded loop on a hostile query
 *  string is a worse bug than the one being fixed.
 *
 *  Decoding runs PER ESCAPE RUN, not over the whole string, and that is
 *  the whole point of this helper rather than a bare
 *  `decodeURIComponent`. That function throws on a malformed escape
 *  ANYWHERE in its input, so a whole-string call plus `catch { break }`
 *  let one stray `%` elsewhere on the line abort the chain at depth 0 —
 *  and then the encoded share URL was never decoded and never scrubbed.
 *  Measured: `?next=%2Fs%2Fpassport%2F<token>&bad=%` logged the token
 *  verbatim in `req.url` while `req.query.next` on the same line was
 *  correctly redacted. `?discount=20%` is an ordinary thing for a URL
 *  to carry, so this was not an exotic input; it was the third round on
 *  this same credential. A run that cannot be decoded is now returned
 *  unchanged, which also keeps the fixed-point break reachable: a
 *  string of nothing but malformed escapes stops on pass 1. */
const PERCENT_ESCAPE_RUN = /(?:%[0-9a-f]{2})+/gi;

const decodedForms = (value: string): string[] => {
  const forms = [value];
  for (let pass = 0; pass < 3; pass += 1) {
    const current = forms[forms.length - 1] as string;
    if (!current.includes('%')) {
      break;
    }
    const next = current.replace(PERCENT_ESCAPE_RUN, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
    if (next === current) {
      break;
    }
    forms.push(next);
  }
  return forms;
};

const redactShareToken = (value: string): string => {
  const forms = decodedForms(value);
  for (let index = forms.length - 1; index >= 0; index -= 1) {
    const form = forms[index] as string;
    const scrubbed = form.replace(SHARE_TOKEN_IN_PATH, `$1${REDACTED}`);
    if (scrubbed !== form) {
      return scrubbed;
    }
  }
  return value;
};

/** Only rebuild containers we recognise. `req.headers` and `req.query`
 *  are null-prototype objects; anything with its own class (a Date, a
 *  Buffer, an Error) is returned untouched rather than flattened. */
const isPlainContainer = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/**
 * The scrub walks the whole serialized object, not `url`.
 *
 * A url-only scrub was measured leaking the live token twice over, both
 * on the same log line the finding is about:
 *
 *   - `Referer: https://…/s/passport/<token>` on ANY route. The share
 *     pages send `Referrer-Policy: no-referrer`, but that governs the
 *     browsers we serve, not what an arbitrary client puts in a header,
 *     and `sanitizeHeaders` only blanks named credential headers.
 *   - `/anything?next=/s/passport/<token>`, because pino's req
 *     serializer emits `req.query` beside `req.url`, and the tail class
 *     `[^?#]*` stops the url match at the `?`.
 *
 * Both are the same credential in the same line; `url` was just the
 * field the first fix happened to look at. The walk covers the response
 * record too, on the same reasoning: `res.headers` is a place a share
 * URL fits, and it is one function away from `req.headers`.
 *
 * The depth cap is a cap on WALKING, and what it does at the bottom is
 * the whole point. It used to be 4 and to return the subtree it had
 * stopped at, which meant `GET /anything?a[b][c][d]=/s/passport/<token>`
 * — one unauthenticated request, on any route — put the live token on
 * the line verbatim, while the paragraph here claimed the cap was 「deep
 * enough for … a nested `qs` group」. It was not: Express parses query
 * strings with qs in extended mode by default, qs nests to depth 5, and
 * the fourth level landed exactly on the cap.
 *
 * So: 8, which clears qs's own limit with room for the record wrapper
 * around it, and past 8 the container is REPLACED rather than emitted.
 * Emitting a subtree the walk declined to enter is emitting whatever
 * string is inside it, which is the bug above; a marker says the same
 * thing without carrying the credential. Non-container values are
 * returned as they are at any depth — a number cannot be a token, and
 * strings are scrubbed above the cap check, so no depth exempts one.
 */
const MAX_WALK_DEPTH = 8;
const UNWALKED = '[Unwalked]';

const redactSharePaths = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') {
    return redactShareToken(value);
  }
  if (Array.isArray(value) || isPlainContainer(value)) {
    if (depth >= MAX_WALK_DEPTH) {
      return UNWALKED;
    }
    if (Array.isArray(value)) {
      return value.map((item) => redactSharePaths(item, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactSharePaths(item, depth + 1);
    }
    return out;
  }
  return value;
};

const sanitizeHeaders = (headers: Record<string, unknown> | undefined) => {
  if (!headers) {
    return headers;
  }

  const clone: Record<string, unknown> = { ...headers };
  for (const key of ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization']) {
    if (key in clone) {
      clone[key] = REDACTED;
    }
  }
  return clone;
};

/**
 * pino-http has ALREADY run the standard serializer by the time this is
 * called. `pinoHttp` wraps every custom serializer it is handed —
 * `wrapRequestSerializer` / `wrapResponseSerializer`, pino-http
 * logger.js:33-34 — and those hand the custom function the standard
 * serializer's OUTPUT, not the raw req/res. So this takes the
 * serialized record as given.
 *
 * The version before this one called `pino.stdSerializers.req/res` a
 * second time, on that output. Both standard serializers read the raw
 * object's own accessors, and the serialized record does not have them:
 * `res.headersSent` (so `statusCode` came back null on EVERY line —
 * the access log shipped with no status in it at all), `res.getHeaders`
 * (so `headers` came back undefined and JSON dropped the key, which
 * made the whole response-side scrub dead code), `req.socket` (so
 * `remoteAddress` and `remotePort` were dropped from every request
 * line). Measured, not reasoned about: the emitted record was exactly
 * `"res":{"statusCode":null}`.
 *
 * `Location: /s/passport/<token>` would be the same credential on the
 * response side of the same line. No route in this API sets one today —
 * nothing calls `res.redirect` — so the integration path cannot reach
 * that branch, which is why `logSerializers` is exported and
 * server.test.ts feeds it the record shape pino-http produces.
 */
const scrubLogRecord = (serialized: unknown): unknown => {
  if (!serialized || typeof serialized !== 'object') {
    return serialized;
  }
  // Spread first: pino returns the record on a prototype, and the walk
  // below only rebuilds plain containers.
  const clone: Record<string, unknown> = { ...(serialized as Record<string, unknown>) };
  if ('headers' in clone) {
    clone.headers = sanitizeHeaders(clone.headers as Record<string, unknown> | undefined);
  }
  for (const [key, value] of Object.entries(clone)) {
    clone[key] = redactSharePaths(value, 1);
  }
  return clone;
};

export const logSerializers = {
  req: scrubLogRecord,
  res: scrubLogRecord,
};

export const createServer = ({ env, logger }: CreateServerOptions) => {
  const app = express();

  // Trust the reverse proxy so `req.ip` reflects the real client
  // rather than the proxy hop. Without this, the IP-keyed rate
  // limiter (rate-limit.ts) degenerates to a single global bucket
  // behind any nginx / ingress / LB — one noisy user trips the AI
  // rate limit for everyone and OTP / login throttles become useless.
  // The hop count (1) matches the standard "single front-proxy"
  // topology; raise via TRUST_PROXY env when fronting multiple
  // hops, but keep the explicit default visible in code.
  app.set('trust proxy', 1);

  app.use(helmet());

  const allowedOrigins = env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  // `'*'` + `credentials: true` is the textbook misconfig: even when
  // production env validation blocks the wildcard, the dev branch
  // would otherwise reflect every Origin AND ship Access-Control-
  // Allow-Credentials: true, which `origin: true` does turn into a
  // credentialed open CORS. Force credentials off for the wildcard
  // branch so the misconfig can never become exploitable even in dev.
  const corsOptions =
    env.CORS_ORIGIN === '*'
      ? { origin: true, credentials: false }
      : { origin: allowedOrigins, credentials: true };

  app.use(cors(corsOptions));
  // Explicit 256 KB body limit. Express defaults to 100 KB, but a
  // future caller widening this somewhere else would silently move
  // the ceiling. Pin it here for visibility — 256 KB is the
  // realistic upper bound for /ai/ask question + queries payloads.
  app.use(express.json({ limit: '256kb' }));
  app.use(
    pinoHttp({
      logger,
      serializers: logSerializers,
    }),
  );

  initPool(env, logger);
  registerRoutes(app, { env, logger });

  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));

  return app;
};
