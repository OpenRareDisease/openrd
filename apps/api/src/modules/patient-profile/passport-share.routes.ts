import {
  Router,
  urlencoded,
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import {
  buildPassportSharePage,
  buildPickupFormPage,
  buildPickupUnavailablePage,
  buildPublicErrorPage,
} from './passport-share.html.js';
import {
  MAX_PICKUP_ATTEMPTS,
  MAX_SHARE_DAYS,
  PassportShareService,
  PICKUP_TTL_MINUTES,
  PickupNeedsBirthDateError,
  ShareLimitReachedError,
} from './passport-share.service.js';
import { PatientProfileService } from './profile.service.js';
import { getPool } from '../../db/pool.js';
import { createRateLimitMiddleware } from '../../middleware/rate-limit.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/require-auth.js';
import type { RouteContext } from '../../routes/index.js';
import { AppError } from '../../utils/app-error.js';
import { asyncHandler } from '../../utils/async-handler.js';

/**
 * Two routers, mounted in two different places, because they have
 * opposite audiences and must never share middleware by accident.
 *
 *   createPassportShareRouter  → /api/profiles/me/passport/shares
 *                                authenticated; the patient manages
 *                                their own links.
 *   createPublicPassportRouter → /s/passport/:token
 *                                UNAUTHENTICATED by design — the whole
 *                                point is that a clinician opens it
 *                                without an account.
 *
 * Mounting the public one outside /api is deliberate: /api carries the
 * auth middleware meant for the app's own client, and this is a page a
 * stranger's browser loads. It also gives the deployment a path prefix
 * it can treat differently at the proxy (no caching, its own rate
 * limit) without pattern-matching inside /api.
 *
 * What the mount point does NOT buy: `cors`, the JSON `errorHandler`
 * and the JSON `notFoundHandler` are registered on the app (server.ts),
 * not on the /api router, so they still see these requests. This comment
 * used to claim otherwise, and the claim was load-bearing — it is why
 * every failure that never reached a handler (a 429, an over-long form
 * body) was answered with a JSON envelope rendered as page text in a
 * clinician's browser.
 *
 * Keeping this surface HTML therefore takes TWO layers at the bottom of
 * `createPublicPassportRouter`, because Express routes the two kinds of
 * miss to two different places:
 *
 *   - `publicErrorHandler` catches anything that reaches a route or a
 *     middleware and then calls `next(err)`;
 *   - the terminal `router.use` above it catches anything that matches
 *     no route in this router and calls plain `next()`. An error handler
 *     never sees those. `GET /s/passport`, `GET /s/passport/a/b` and
 *     `POST /s/passport/<token>` used to leave the router and come back
 *     as 「{"error":"Route not found"}」 — a clinician whose forwarded
 *     link WeChat truncated at the last segment read that as the page.
 */

const RESOLVE_FAILED_PAGE = `<!DOCTYPE html>
<html lang="zh-Hans-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>链接已失效</title>
<style>body{margin:0;background:#FBF8F3;color:#17272E;line-height:1.75;
 font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
 .b{max-width:30rem;margin:18vh auto 0;padding:0 24px}
 h1{font-size:20px;margin:0 0 10px}p{color:#42565F;font-size:14.5px;margin:0 0 10px}</style>
</head><body><div class="b">
<h1>这个链接打不开了</h1>
<p>它可能已经过期，或者被分享它的人撤销了。</p>
<p>如果你需要这份资料，请让分享给你的患者重新生成一个链接。</p>
</div></body></html>`;

/**
 * One response for expired, revoked, never-existed — and, from the
 * terminal layer at the bottom of the public router, for a URL under
 * /s/passport that is not a share at all.
 *
 * Telling them apart would tell whoever is guessing tokens that they
 * guessed a real one — and a real one identifies a real patient. The
 * page says「过期或被撤销」for the same reason, which is also true and
 * is what an honest clinician actually needs to know.
 */
const sendUnavailable = (res: Response) => {
  res.status(404).type('html').send(RESOLVE_FAILED_PAGE);
};

export const createPassportShareRouter = (context: RouteContext) => {
  const router = Router();
  const pool = getPool();
  const shares = new PassportShareService(pool, context.logger);

  router.use(requireAuth(context.env, context.logger));

  // Minting a link is cheap for us and consequential for the patient,
  // and each one is a publication of their record. Keyed by user so one
  // account cannot spend another's budget.
  const mintLimiter = createRateLimitMiddleware({
    keyPrefix: 'passport:share',
    windowMs: 60_000,
    maxRequests: 10,
    message: '操作过于频繁，请稍后再试',
    keyResolver: (req) => (req as AuthenticatedRequest).user?.id ?? req.ip ?? 'unknown',
  });

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).user!.id;
      res.json({ data: await shares.list(userId) });
    }),
  );

  router.post(
    '/',
    mintLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).user!.id;
      const body = (req.body ?? {}) as { label?: unknown; days?: unknown };
      try {
        const link = await shares.create(userId, {
          label: typeof body.label === 'string' ? body.label : null,
          days: typeof body.days === 'number' ? body.days : undefined,
        });
        res.status(201).json({ data: link, maxDays: MAX_SHARE_DAYS });
      } catch (error) {
        if (error instanceof ShareLimitReachedError) {
          res.status(409).json({ error: error.message, code: 'share_limit_reached' });
          return;
        }
        throw error;
      }
    }),
  );

  // Same limiter as minting a link, because it is the same act: a
  // pickup code is a door, it counts against MAX_LIVE_SHARES, and it
  // appears in the same revoke list.
  router.post(
    '/pickup',
    mintLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).user!.id;
      const body = (req.body ?? {}) as { label?: unknown };
      try {
        const link = await shares.createPickup(userId, {
          label: typeof body.label === 'string' ? body.label : null,
        });
        res.status(201).json({
          data: link,
          ttlMinutes: PICKUP_TTL_MINUTES,
          maxAttempts: MAX_PICKUP_ATTEMPTS,
        });
      } catch (error) {
        if (error instanceof ShareLimitReachedError) {
          res.status(409).json({ error: error.message, code: 'share_limit_reached' });
          return;
        }
        // 409 rather than 400: nothing about the request is malformed.
        // The account is not in a state where a two-factor handover can
        // exist yet, and the message says which field fixes that.
        if (error instanceof PickupNeedsBirthDateError) {
          res.status(409).json({ error: error.message, code: 'pickup_needs_birth_date' });
          return;
        }
        throw error;
      }
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).user!.id;
      const ok = await shares.revoke(userId, req.params.id);
      if (!ok) {
        res.status(404).json({ error: '没有找到这个链接' });
        return;
      }
      res.json({ data: { revoked: true } });
    }),
  );

  return router;
};

export const createPublicPassportRouter = (context: RouteContext) => {
  const router = Router();
  const pool = getPool();
  const shares = new PassportShareService(pool, context.logger);
  const profiles = new PatientProfileService({ pool, logger: context.logger });

  /**
   * A flood guard, keyed by IP. NOT a bound on guessing.
   *
   * An unauthenticated caller has no identity to key on, so IP is what
   * there is. That is fine here because there is nothing to guess: the
   * token is 32 bytes of CSPRNG, and no rate limit meaningfully narrows
   * 2^256. What this actually buys is that a scripted flood of /s
   * requests does not turn into a database query per request.
   *
   * The number is loose on purpose for the same reason as the pickup
   * limiter below — a hospital outpatient department is one NAT
   * address, and 60/min is already generous for humans opening links
   * one at a time.
   */
  // No keyResolver: the shared default is `req.ip ||
  // req.socket.remoteAddress || 'unknown'`, and these two limiters had
  // been overriding it with `req.ip ?? 'unknown'` — which drops the
  // socket fallback and, because `??` passes an empty string through,
  // can key an entire flood into one bucket. These were the only
  // overrides of the shared resolver on a route with no authenticated
  // user to key on: every other override (profile.routes.ts,
  // legal.routes.ts, the mint limiter above) sits behind requireAuth
  // and keys on user.id. Not the only unauthenticated routes in the app
  // — /api/auth/* and /api/healthz are unauthenticated too — but those
  // already take the shared default, so this was the last weaker copy
  // of the rule.
  const openLimiter = createRateLimitMiddleware({
    keyPrefix: 'passport:open',
    windowMs: 60_000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  });

  /**
   * A flood guard, and explicitly NOT the security bound.
   *
   * Guessing is bounded by the three attempts counted on the row
   * (db/migrations/024) and by the size of the code space — not by
   * this. The number is deliberately far looser than the 60/min above
   * because a hospital outpatient department is one NAT address, and a
   * limiter tight enough to matter here would lock out an entire floor
   * of clinicians the moment two of them used the feature in an hour.
   * If you ever find yourself tightening this to stop an attack, the
   * thing to change is MAX_PICKUP_ATTEMPTS or PICKUP_CODE_LENGTH.
   */
  const pickupLimiter = createRateLimitMiddleware({
    keyPrefix: 'passport:pickup',
    windowMs: 60_000,
    maxRequests: 300,
    message: '请求过于频繁，请稍后再试',
  });

  /**
   * The pages here are private publications, and a proxy, a history
   * entry or a Referer carrying one onward is the leak.
   *
   * This is the router's FIRST layer rather than a line at the top of
   * each handler, which is what it used to be. Each of those lines was
   * true of the response it guarded and silent about every other one:
   * the 429 and the 413 reached no handler, and an unmatched path
   * reached no handler either and left the router entirely. Setting the
   * headers on the way in means the claim「every response out of this
   * router」is enforced by the router, and a route added below without
   * reading this comment still gets them.
   *
   * Headers set here survive `res.status().type().send()` on every path
   * below, including the error handler's — none of them rewrite the head.
   */
  router.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  /* ------------------------------------------------------------ *
   * Pickup. REGISTERED BEFORE `/:token` AND IT HAS TO STAY THERE —
   * Express matches in registration order, so moving these below the
   * token route would hand the literal string 「pickup」 to
   * `shares.resolve` and answer the form with a 404 page.
   * ------------------------------------------------------------ */

  /** `req.baseUrl` rather than a hardcoded '/s/passport/pickup': the
   *  form has to post back to wherever this router was actually
   *  mounted, including under a proxy path prefix. */
  const pickupAction = (req: Request) => `${req.baseUrl}/pickup`;

  router.get(
    '/pickup',
    pickupLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      res
        .status(200)
        .type('html')
        .send(buildPickupFormPage(pickupAction(req)));
    }),
  );

  router.post(
    '/pickup',
    pickupLimiter,
    // Parsed here and nowhere else. The app-level parser is
    // express.json (server.ts), so without this `req.body` is
    // undefined and every submission silently fails as a wrong code —
    // burning the patient's attempts on our own missing middleware.
    // 2kb because the payload is a code and a date.
    urlencoded({ extended: false, limit: '2kb' }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as { code?: unknown; dob?: unknown };

      const resolved = await shares.redeemPickup(body.code, body.dob);
      if (!resolved) {
        // One answer for all of: wrong code, wrong birthdate, expired,
        // burned, already used, revoked, never existed. The service
        // returns a bare null so there is nothing here to leak with.
        res
          .status(404)
          .type('html')
          .send(buildPickupUnavailablePage(pickupAction(req)));
        return;
      }

      const summary = await profiles.getClinicalPassportByUserId(resolved.userId);
      if (!summary) {
        // The code was right and the profile is gone — a deletion that
        // raced the redemption. Same page, for the same reason as the
        // token route: saying more would confirm the code was real.
        res
          .status(404)
          .type('html')
          .send(buildPickupUnavailablePage(pickupAction(req)));
        return;
      }

      // Deliberately NOT { shareId, code } — the log line is here so an
      // operator can see the feature is being used, not so it becomes a
      // second place a working credential lives.
      context.logger.info({ shareId: resolved.shareId }, 'passport pickup redeemed');

      res
        .status(200)
        .type('html')
        .send(buildPassportSharePage(summary, { viaPickup: true }));
    }),
  );

  router.get(
    '/:token',
    openLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      // A share is a private publication. Nothing between the patient's
      // clinician and us should hold a copy, and the URL itself is the
      // credential — so it must not travel onward in a Referer header or
      // sit in a shared proxy. That is the router's first layer now,
      // above, rather than a line here that only covered this route.
      const resolved = await shares.resolve(String(req.params.token ?? ''));
      if (!resolved) {
        sendUnavailable(res);
        return;
      }

      const summary = await profiles.getClinicalPassportByUserId(resolved.userId);
      if (!summary) {
        // The link resolved but the profile is gone — a deletion that
        // raced the open. Same page: the clinician's next step is
        // identical, and saying more would confirm the token was real.
        sendUnavailable(res);
        return;
      }

      const expiresAt = await pool.query(
        `SELECT expires_at FROM passport_share_links WHERE id = $1`,
        [resolved.shareId],
      );

      context.logger.info({ shareId: resolved.shareId }, 'passport share opened');

      res
        .status(200)
        .type('html')
        .send(
          buildPassportSharePage(summary, {
            expiresAt: String(expiresAt.rows[0]?.expires_at ?? ''),
          }),
        );
    }),
  );

  /**
   * Nothing above matched. Express does NOT send this to the error
   * handler — a route miss calls plain `next()`, which walks off the end
   * of the router and out to the app-level `notFoundHandler`
   * (middleware/not-found.ts), whose answer is 「{"error":"Route not
   * found"}」 as application/json.
   *
   * The three routes above are the whole surface, so everything else
   * under /s/passport lands here: `GET /s/passport` (a link WeChat
   * truncated at the last segment), `GET /s/passport/a/b`, a POST to a
   * token, or `/pickup` with something appended. Every one of those is a
   * clinician trying to open a handover and reading a JSON envelope as
   * the page.
   *
   * Same page and same 404 as a dead token, deliberately: an incomplete
   * URL and a revoked link are the same situation for the person holding
   * it, the next step is identical, and telling them apart would tell
   * someone probing which prefixes exist.
   */
  router.use((_req: Request, res: Response) => {
    sendUnavailable(res);
  });

  /**
   * The other half, for failures that DID enter a route or a middleware
   * and then called `next(err)` — an error handler never sees the misses
   * above.
   *
   * `openLimiter` rejecting the 61st open in a minute — one NAT'd
   * outpatient department is all it takes — and the urlencoded
   * parser rejecting a >2kb pickup body both call `next(err)` before
   * a handler runs. Without this layer they fall through to the
   * app-level `errorHandler` (server.ts), which answers JSON with no
   * Accept negotiation: the clinician holding the patient's phone
   * reads 「{"error":"请求过于频繁，请稍后再试"}」 as the page. The
   * PayloadTooLargeError is worse — it is neither AppError nor
   * ZodError, so it came back as a 500 「Internal server error」.
   *
   * The private headers those paths used to miss are no longer this
   * handler's business: they are set by the router's first layer, which
   * every request into this router passes through before any route,
   * limiter or parser can reject it.
   */
  const statusOf = (error: unknown): number => {
    if (error instanceof AppError) return error.statusCode;
    // body-parser tags its own rejections (`entity.too.large` → 413)
    // on `status`; keep them rather than flattening to 500.
    const raw = (error as { status?: unknown; statusCode?: unknown } | null | undefined) ?? {};
    const candidate = typeof raw.status === 'number' ? raw.status : raw.statusCode;
    return typeof candidate === 'number' && candidate >= 400 && candidate < 600 ? candidate : 500;
  };

  const retryAfterOf = (error: unknown, res: Response): number | null => {
    const detail = error instanceof AppError ? error.details : undefined;
    const fromError = (detail as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    if (typeof fromError === 'number') return fromError;
    // The limiter sets Retry-After before it calls next(), so the
    // header is the fallback source rather than a number invented here.
    const header = Number(res.getHeader('Retry-After'));
    return Number.isFinite(header) && header > 0 ? header : null;
  };

  const publicErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
    if (res.headersSent) {
      // A page already started going out; Express's default handler is
      // the only thing that can still close the socket sensibly.
      next(error);
      return;
    }

    const status = statusOf(error);

    if (status >= 500) {
      // The app-level handler used to log these. It no longer sees
      // them, so an unexplained page in a consulting room would
      // otherwise leave no trace at all.
      context.logger.error({ err: error }, 'public passport surface failed');
    }

    const page =
      status === 429
        ? buildPublicErrorPage({
            kind: 'rate_limited',
            retryAfterSeconds: retryAfterOf(error, res),
          })
        : status === 413
          ? buildPublicErrorPage({ kind: 'too_large', formAction: pickupAction(req) })
          : buildPublicErrorPage({ kind: 'failed' });

    res.status(status).type('html').send(page);
  };

  router.use(publicErrorHandler);

  return router;
};
