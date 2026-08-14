import { Router } from 'express';
import type { Response } from 'express';

import { readTrialSnapshot } from './trials.service.js';
import { getPool } from '../../db/pool.js';
import { createRateLimitMiddleware } from '../../middleware/rate-limit.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/require-auth.js';
import type { RouteContext } from '../../routes/index.js';
import { asyncHandler } from '../../utils/async-handler.js';

/**
 * /api/trials — the cached trial list plus its freshness.
 *
 * ONE ENDPOINT, ONE ROUND TRIP. The page has to render 「拉取于 X」 and
 * 「国内这部分现在取不到」 beside the list, so the freshness facts ship
 * with the list rather than behind a second call. A client that has the
 * rows but not the dates has, for one paint, a list of trials with no
 * date on it — which is the one thing this feature must never put in
 * front of a patient.
 *
 * WHAT IS NOT IN THE PAYLOAD
 *
 *   `raw`             What the fetcher kept, not the whole registry
 *                     response: for ctgov the study object cut to the
 *                     nine pinned `CTGOV_FIELDS` (ctgov.fetcher.ts),
 *                     for chinadrugtrials an allowlist of the labelled
 *                     values that fetcher pulled out. Not something to
 *                     ship to a phone; what it holds and why is on the
 *                     column in migration 026.
 *
 *   `trial_fetch_runs.error`
 *                     The failure state reaches the client; the error
 *                     STRING does not. It is whatever the fetch threw —
 *                     a URL with our egress proxy in it, a DNS name, a
 *                     driver message — and /api/trials is a route any
 *                     logged-in patient can call. Same discipline as
 *                     routes/index.ts's `projectPublicSummary`, which
 *                     exists because /healthz was handing out the pg
 *                     connection detail. Nothing reads the column back
 *                     out: the back office's ops endpoints
 *                     (admin.routes.ts, /api/admin/ops/*) have no
 *                     trials block, and `SOURCE_STATUS_SQL` in
 *                     trials.service.ts — the only request-path read of
 *                     that table — takes `started_at`, `finished_at`
 *                     and `ok` from it and nothing else. An operator
 *                     gets the reason from the refresh job instead —
 *                     untruncated on its stderr (refresh.cli.ts) — or
 *                     out of psql.
 *
 * NO PAGINATION. The whole table is read and the whole table is
 * returned. That is the shape migration 026 was designed for — it gives
 * `trial_records` no secondary index precisely because the page reads
 * every row — and the size is set by the registry rather than by our
 * users. Measured against the dev database on 2026-08-13, after
 * `npm run trials:refresh` had filled it from ClinicalTrials.gov:
 *
 *   92 rows, readTrialSnapshot(pool) 27 ms including the pool connect,
 *   JSON.stringify(snapshot) 37,748 bytes
 *
 * — one screen of an ordinary phone photo, over a link that is about to
 * load a list of trials. Reproduce it by calling `readTrialSnapshot`
 * against a filled `trial_records` and measuring the serialised result.
 * If the registry's answer ever grows by an order of magnitude, this
 * paragraph is where to notice.
 *
 * NO PATIENT-FACING BOILERPLATE. §A5 requires two fixed sentences on
 * the 试验 page — this list is ClinicalTrials.gov only and does not
 * include trials registered solely in China, and talk to your own
 * doctor before joining anything. They are the page's to render and
 * this endpoint does not return them: a string that travels over the
 * wire and is also hardcoded in the client is a string that will
 * eventually exist in two versions, and the API cannot tell which one
 * was on screen. The AI answer carries its own copy of the same two
 * rules for the same reason it carries the dates — see
 * ../ai-agents/tools/list-clinical-trials.ts.
 */
export const createTrialsRouter = (context: RouteContext) => {
  const router = Router();

  // Per user, not per IP: Chinese mobile carriers put very large
  // subscriber pools behind a handful of CGNAT egress addresses, so an
  // IP-keyed budget is shared by strangers (the reasoning is spelled
  // out on ai-chat.routes.ts's `authenticatedUserKey`). requireAuth runs
  // first on every route in this router, so `req.user.id` is always
  // there; the `?? req.ip` fallback is unreachable today and is the safe
  // answer if this router ever gains an anonymous route.
  //
  // The budget exists because each request takes a pooled connection and
  // holds a transaction across two queries — microseconds of work, and
  // still a connection. 60/min is a ceiling on how much of the pool one
  // account can hold at once, not a tuned number: it is two orders of
  // magnitude above opening a page, and low enough that a client stuck
  // in a reload loop cannot starve everyone else's login.
  const trialsLimiter = createRateLimitMiddleware({
    keyPrefix: 'trials:list',
    windowMs: 60_000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
    keyResolver: (req) => (req as AuthenticatedRequest).user?.id ?? req.ip ?? 'unknown',
  });

  router.use(requireAuth(context.env, context.logger));

  router.get(
    '/',
    trialsLimiter,
    asyncHandler(async (_req, res: Response) => {
      // No try/catch. A database that cannot answer must surface as a
      // 500 through the shared error handler, because the alternative —
      // catching and answering `{ trials: [], sources: [] }` — puts an
      // empty trial list on the patient's screen and calls it the
      // registry's answer.
      const snapshot = await readTrialSnapshot(getPool());
      res.status(200).json(snapshot);
    }),
  );

  return router;
};
