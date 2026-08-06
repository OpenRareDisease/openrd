import { Router, urlencoded, type Request, type Response } from 'express';

import {
  buildPassportSharePage,
  buildPickupFormPage,
  buildPickupUnavailablePage,
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
 * Mounting the public one outside /api is deliberate: /api carries
 * auth, CORS and JSON error handling meant for the app's own client,
 * and this is a page a stranger's browser loads. It also gives the
 * deployment a path prefix it can treat differently at the proxy (no
 * caching, its own rate limit) without pattern-matching inside /api.
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
 * One response for expired, revoked and never-existed.
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
  const openLimiter = createRateLimitMiddleware({
    keyPrefix: 'passport:open',
    windowMs: 60_000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
    keyResolver: (req) => `${req.ip ?? 'unknown'}`,
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
    keyResolver: (req) => `${req.ip ?? 'unknown'}`,
  });

  /** Applied to every response in this router: the pages are private
   *  publications and a proxy, a history entry or a Referer carrying
   *  one onward is the leak. */
  const setPrivateHeaders = (res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'no-referrer');
  };

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
      setPrivateHeaders(res);
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
      setPrivateHeaders(res);
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
      // credential — so it must not travel onward in a Referer header
      // or sit in a shared proxy.
      setPrivateHeaders(res);

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

  return router;
};
