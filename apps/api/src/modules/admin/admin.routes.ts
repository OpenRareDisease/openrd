import { Router } from 'express';

import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { getPool } from '../../db/pool.js';
import { createRateLimitMiddleware } from '../../middleware/rate-limit.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import type { AuthenticatedRequest } from '../../middleware/require-auth.js';
import type { HealthSummary, RouteContext } from '../../routes/index.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { FallsService } from '../patient-profile/falls/falls.service.js';
import { InstrumentsService } from '../patient-profile/instruments/instruments.service.js';
import { OCR_STUCK_AFTER_MINUTES } from '../patient-profile/profile.controller.js';
import { PatientProfileService } from '../patient-profile/profile.service.js';

export interface AdminRouterDeps {
  /** `getHealthSummary` bound to the app context. Passed in from
   *  routes/index.ts, which owns it, so that this module does not
   *  import the module that mounts it. */
  healthSummary: () => Promise<HealthSummary>;
}

/**
 * The back-office.
 *
 * EVERY route here goes through `requireAdmin`, spread rather than
 * passed as one handler, which is what makes it impossible to mount the
 * role gate without `requireAuth` in front of it. Each route names its
 * own audit event and, when it is about one patient, the route
 * parameter carrying that patient's `app_users.id` — there is no
 * derivation from the method and the path, so a route added later has
 * to make the choice explicitly.
 *
 * WHY EVERY PATIENT-SCOPED ROUTE IS KEYED ON `app_users.id`, and not on
 * the patient code or the profile id: `requireAdmin` refuses a request
 * whose `targetParam` does not resolve to a UUID, because an audit row
 * that has forgotten who was looked at while still looking is worse
 * than no route. So the list hands out `userId` and every deeper route
 * takes it back.
 *
 * There is no `router.use(requireAuth)` above these lines even though
 * every route needs it. A router-level guard would sit above the layer
 * that parses `:userId`, so `requireAdmin`'s target lookup would find
 * an empty `req.params` and refuse every patient-scoped request with a
 * 500.
 */
export const createAdminRouter = (context: RouteContext, deps: AdminRouterDeps) => {
  const router = Router();
  const pool = getPool();

  const admin = new AdminService({ pool });
  const profiles = new PatientProfileService({ pool, logger: context.logger });
  const falls = new FallsService({ pool, logger: context.logger });
  const instruments = new InstrumentsService({ pool, logger: context.logger });

  const controller = new AdminController({
    admin,
    profiles,
    falls,
    instruments,
    healthSummary: deps.healthSummary,
    ocrStuckAfterMinutes: OCR_STUCK_AFTER_MINUTES,
    logger: context.logger,
  });

  /**
   * Per-administrator budget on the full-database export.
   *
   * Not a defence against a hostile administrator — one who wants the
   * file gets it, and the audit rows are what that case is answered
   * with. This bounds the DB load a scripted loop can put on an
   * instance that is also serving patients: each confirmed call reads
   * every profile plus ten grouped aggregates. 10/min leaves room for
   * the two-request confirm dance several times over and stops a loop
   * cold. Keyed by user id (requireAdmin runs first) rather than IP, so
   * two operators in one office do not share a budget.
   *
   * It sits BEHIND `requireAdmin`, so a throttled request has already
   * written its audit row. That is the right way round twice over: the
   * key it throttles on only exists once `requireAuth` has run, and the
   * row `requireAdmin` writes records an ATTEMPT rather than a
   * completed export — which is what a burst of them is.
   */
  const fullExportLimiter = createRateLimitMiddleware({
    keyPrefix: 'admin:full-export',
    windowMs: 60_000,
    maxRequests: 10,
    message: '全量导出过于频繁，请稍后再试',
    keyResolver: (req) => (req as AuthenticatedRequest).user?.id ?? req.ip ?? 'unknown',
  });

  // ------------------------------------------------------------ patients

  router.get(
    '/patients',
    ...requireAdmin(context, { event: 'admin.list' }),
    asyncHandler(controller.listPatients),
  );

  router.get(
    '/patients/:userId',
    ...requireAdmin(context, { event: 'admin.record_read', targetParam: 'userId' }),
    asyncHandler(controller.getPatientRecord),
  );

  router.put(
    '/patients/:userId/baseline',
    ...requireAdmin(context, { event: 'admin.record_write', targetParam: 'userId' }),
    asyncHandler(controller.updatePatientBaseline),
  );

  router.get(
    '/patients/:userId/export',
    ...requireAdmin(context, { event: 'admin.export', targetParam: 'userId' }),
    asyncHandler(controller.exportPatient),
  );

  // ------------------------------------------------------------ full export
  //
  // POST, not GET, and that is load-bearing rather than REST pedantry:
  // a GET is what a browser prefetches, a crawler follows, a chat client
  // unfurls and a bookmark replays. The confirmation phrase travels in
  // the body for the same reason — a query string ends up in proxy logs
  // and browser history, and this one names the cohort size.
  //
  // No `targetParam`: this request is about every patient, so there is
  // no single `targetUserId` to record. The row that says how many
  // there were is the second one, written by the handler.
  router.post(
    '/exports/patients.csv',
    ...requireAdmin(context, { event: 'admin.export' }),
    fullExportLimiter,
    asyncHandler(controller.exportAllPatientsCsv),
  );

  // ------------------------------------------------------------ operations
  //
  // `admin.list` for all four: they are reads with no single patient as
  // their subject, which is exactly what separates `admin.list` from
  // `admin.record_read` in ADMIN_AUDIT_EVENTS. The parse-failure queue
  // does name patients (it has to — the point is to go and look at the
  // failing document), and it is still not a record read: it discloses
  // that a document failed to parse, not what is in it.
  router.get(
    '/ops/corpus',
    ...requireAdmin(context, { event: 'admin.list' }),
    asyncHandler(controller.getCorpusStatus),
  );
  router.get(
    '/ops/parse-failures',
    ...requireAdmin(context, { event: 'admin.list' }),
    asyncHandler(controller.getParseFailures),
  );
  router.get(
    '/ops/ai-usage',
    ...requireAdmin(context, { event: 'admin.list' }),
    asyncHandler(controller.getAiUsage),
  );
  router.get(
    '/ops/health',
    ...requireAdmin(context, { event: 'admin.list' }),
    asyncHandler(controller.getOpsHealth),
  );

  return router;
};
