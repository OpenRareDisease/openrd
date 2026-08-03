import { Router } from 'express';

import { LegalController } from './legal.controller.js';
import { getPool } from '../../db/pool.js';
import { createRateLimitMiddleware } from '../../middleware/rate-limit.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/require-auth.js';
import type { RouteContext } from '../../routes/index.js';
import { asyncHandler } from '../../utils/async-handler.js';

/**
 * /api/legal — the agreement-acceptance ledger.
 *
 * Authenticated only. Registration itself is anonymous, so the
 * acceptance recorded at sign-up is written by the client immediately
 * after the token comes back rather than inside the register call: an
 * anonymous write endpoint here would be an unauthenticated INSERT into
 * a table keyed by user id, and the ledger's whole value is that its
 * rows are attributable.
 *
 * The client not reaching this endpoint after registering is the one
 * failure mode that leaves an account with no recorded acceptance, and
 * it self-heals: requireSensitiveDataConsent reads this table in front
 * of every route that stores health or genetic data, so a user whose
 * registration write was lost is refused — and asked — before any
 * sensitive data lands.
 *
 * That sentence was written here once while the only gate was a modal
 * in the mobile bundle, which made it false. The self-heal is a
 * property of require-consent.ts, not of this file; if that middleware
 * stops being wired onto the write routes, this paragraph becomes a
 * lie again.
 */
export const createLegalRouter = (context: RouteContext) => {
  const router = Router();
  const controller = new LegalController(getPool());

  // `version` is a client-supplied string, so distinct values create
  // distinct rows (the unique index only collapses exact repeats). Left
  // unbounded, a misbehaving or malicious client could walk the version
  // space and grow the table without limit under one account. Keyed by
  // user id — requireAuth has already run — so one patient cannot spend
  // another's budget, and 30/min is orders of magnitude above the real
  // pattern (two writes at registration, one before the first upload).
  const acceptanceLimiter = createRateLimitMiddleware({
    keyPrefix: 'legal:acceptance',
    windowMs: 60_000,
    maxRequests: 30,
    message: '操作过于频繁，请稍后再试',
    keyResolver: (req) => (req as AuthenticatedRequest).user?.id ?? req.ip ?? 'unknown',
  });

  router.use(requireAuth(context.env, context.logger));

  router.get('/acceptances', asyncHandler(controller.getMyAcceptances));
  router.post('/acceptances', acceptanceLimiter, asyncHandler(controller.recordMyAcceptance));
  // Same limiter: withdrawal is an UPDATE keyed by (user, document), so
  // it cannot grow the table, but it can still be spammed.
  router.post(
    '/acceptances/withdraw',
    acceptanceLimiter,
    asyncHandler(controller.withdrawMyAcceptance),
  );

  return router;
};
