import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';

import { requireAuth, type AuthenticatedRequest } from './require-auth.js';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';
import { getPool } from '../db/pool.js';
import { AppError } from '../utils/app-error.js';

/**
 * The gate on the admin back-office, and the thing that makes every
 * pass through it visible afterwards.
 *
 * Two properties this middleware exists to provide, both of which were
 * easy to lose if the audit write lived in the handlers:
 *
 * 1. EVERY admin request writes an audit row, INCLUDING READS. 「谁在
 *    什么时候看了谁的档案」 is itself a fact worth keeping — a patient
 *    handed us a decade of reports on the understanding that we would
 *    be able to answer that question, and a back-office that only logs
 *    writes answers it for the one case where the record already
 *    changed underneath them. The row is written here, before the
 *    handler runs, so a route added next month cannot forget to call
 *    anything.
 *
 * 2. THE ROLE COMES FROM THE DATABASE, NOT FROM THE TOKEN. The JWT
 *    carries `role` (see require-auth.ts) and it is a snapshot from
 *    sign-in time. Reading it here would mean `npm run admin:revoke`
 *    does nothing until the revoked admin's token expires on its own —
 *    a revocation that is not a revocation, at the exact moment
 *    somebody is revoking access in a hurry. One extra SELECT per
 *    admin request is the price, and admin traffic is a handful of
 *    operators, not patients.
 */

/**
 * The `audit_logs.event_type` vocabulary for the back-office.
 *
 * `admin.grant` / `admin.revoke` are NOT reachable through this
 * middleware — role changes require database access, i.e. a human on
 * the host running scripts/admin-role.mjs, and that script writes its
 * own rows. They live in this list because the list is what a query
 * like `WHERE event_type LIKE 'admin.%'` is read against, and because
 * admin-role.mjs (a .mjs file, which cannot import a TypeScript
 * constant) hard-codes the two strings. require-admin.test.ts asserts
 * the strings in that file are members of this list, so a typo there
 * cannot quietly drop the grant trail out of every admin query.
 */
export const ADMIN_AUDIT_EVENTS = [
  'admin.list',
  'admin.record_read',
  'admin.record_write',
  'admin.export',
  'admin.grant',
  'admin.revoke',
] as const;

export type AdminAuditEvent = (typeof ADMIN_AUDIT_EVENTS)[number];

/** The subset an HTTP route can declare. See the note above. */
export type AdminRequestAuditEvent = Exclude<AdminAuditEvent, 'admin.grant' | 'admin.revoke'>;

export interface AdminAuditSpec {
  /**
   * What this route does, chosen by the route rather than guessed from
   * the method and the path. A required field: a derived default would
   * have to decide, silently and per request, whether a GET with an id
   * in it is a record read or a filtered list, and be wrong for some
   * route nobody thought about.
   */
  event: AdminRequestAuditEvent;
  /**
   * The name of the route parameter carrying the patient's
   * `app_users.id`, for routes that are about one patient. Omit it (or
   * pass null) for routes that are about none — the patient list, the
   * full-database export, the ops dashboards.
   *
   * The parameter MUST resolve to a UUID at request time, and a
   * request where it does not is refused rather than audited with a
   * null target — an audit trail that has forgotten who was looked at
   * while still looking is the one failure this file must not degrade
   * quietly into. WHICH refusal depends on whose mistake it is:
   *
   *   - the parameter is absent from `req.params` → 500. A route that
   *     mis-spelt the parameter name, or a guard mounted with
   *     `router.use(...)` above the layer that parses it. Ours to fix,
   *     and logged at error level.
   *   - the parameter is present and is not a UUID → 400. An operator
   *     pasted a patient code or truncated an id. Not logged: it is
   *     not a fault, and a log line any authenticated administrator
   *     can produce on demand is a log line somebody can flood.
   *
   * The practical consequence for admin routes: a patient-scoped admin
   * route has to be keyed on `app_users.id`, not on a patient code or
   * a profile id.
   */
  targetParam?: string | null;
}

export interface RequireAdminDeps {
  /**
   * Injection point for tests. Resolved per request rather than at
   * factory time so that building a router does not require an
   * initialised pool.
   */
  pool?: Pick<Pool, 'query'>;
}

export interface RequireAdminContext {
  env: AppEnv;
  logger: AppLogger;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The path as it will be stored, WITHOUT the query string.
 *
 * Exported for the test. Dropping the query is deliberate and not
 * tidiness: the patient list is searchable, so `?q=张三` is a patient's
 * name (or phone number) typed by an operator, and audit_logs is the
 * table whose own masking module exists to keep exactly those values
 * out of it (services/audit/identity-masking.ts). The path that
 * remains still carries the target id, which is the part the trail is
 * read for.
 */
export const _auditPathOf = (originalUrl: string): string => {
  const cut = originalUrl.indexOf('?');
  return cut === -1 ? originalUrl : originalUrl.slice(0, cut);
};

/**
 * `requireAuth` + the admin gate + the audit write, as one array so a
 * route cannot mount the second without the first.
 *
 * Usage:
 *   router.get('/patients', ...requireAdmin(context, { event: 'admin.list' }), handler);
 *   router.get(
 *     '/patients/:userId',
 *     ...requireAdmin(context, { event: 'admin.record_read', targetParam: 'userId' }),
 *     handler,
 *   );
 */
export const requireAdmin = (
  context: RequireAdminContext,
  spec: AdminAuditSpec,
  deps: RequireAdminDeps = {},
): RequestHandler[] => {
  const { env, logger } = context;

  const gate = async (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;

    // requireAuth is the element in front of this one in the array the
    // factory returns, so reaching here without a user means somebody
    // pulled this handler out of that array. Refuse rather than read
    // `undefined.id`.
    if (!user?.id) {
      return next(new AppError('Authentication required', 401));
    }

    const pool = deps.pool ?? getPool();

    let account: { role: string; is_active: boolean } | undefined;
    try {
      const result = await pool.query<{ role: string; is_active: boolean }>(
        'SELECT role, is_active FROM app_users WHERE id = $1',
        [user.id],
      );
      account = result.rows[0];
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'Could not read the role for an admin request');
      return next(new AppError('Administrator check unavailable', 503));
    }

    // `is_active` is honoured here and, as of this file, NOWHERE ELSE
    // in the API — `grep -rn is_active apps/api/src` returned nothing
    // before this line existed, so a deactivated account can still log
    // in and use the patient app. Do not read this as deactivation
    // being enforced product-wide; it is not, and this comment is here
    // so nobody later assumes it is. It is honoured on this one
    // surface because this is the surface whose blast radius is every
    // patient's record. The mechanism that actually takes admin away
    // is `npm run admin:revoke`.
    //
    // A missing row, an inactive account and a non-admin role all
    // answer 403 with the same message: which of the three it was is a
    // fact about someone else's account, and it goes to the log rather
    // than to the caller.
    if (!account || !account.is_active || account.role !== 'admin') {
      logger.warn(
        {
          userId: user.id,
          reason: !account ? 'no_account' : !account.is_active ? 'inactive' : 'not_admin',
          method: req.method,
          path: _auditPathOf(req.originalUrl),
        },
        'Refused a request to an admin route',
      );
      // Deliberately NOT audited. audit_logs rows under `admin.*` mean
      // 「an administrator saw this」, and a 403 means nobody saw
      // anything. Auditing the refusal would also let any authenticated
      // user append rows to audit_logs at will by curling /api/admin/*,
      // which turns the trail into something an attacker can flood
      // ahead of the rows they want buried.
      return next(new AppError('Administrator access required', 403));
    }

    let targetUserId: string | null = null;
    if (spec.targetParam) {
      const raw = req.params[spec.targetParam];
      // THE PARAMETER IS NOT THERE AT ALL: our bug, and a 500. The two
      // ways it happens are a mis-spelt `targetParam` and a guard
      // mounted with `router.use(...)` above the layer that parses the
      // parameter; both would audit a look with nobody being looked at,
      // which is the one failure this file must not degrade quietly
      // into.
      if (typeof raw !== 'string') {
        logger.error(
          { userId: user.id, targetParam: spec.targetParam, params: Object.keys(req.params) },
          'An admin route declared a target parameter that is not in its path',
        );
        return next(
          new AppError(`Admin route misconfigured: no route parameter '${spec.targetParam}'`, 500),
        );
      }
      // THE PARAMETER IS THERE AND IS NOT A USER ID: the caller's typo,
      // and a 400. This branch used to answer 500 「Admin route
      // misconfigured」 — an operator who pasted a patient code out of a
      // spreadsheet was told OUR route was broken, and every one of
      // those wrote a `logger.error`, which made the error log
      // something any authenticated administrator could fill at will.
      // No audit row either way: a request that never named a patient
      // is not somebody seeing a patient.
      if (!UUID_PATTERN.test(raw)) {
        return next(
          new AppError('链接里的患者 ID 不是一个合法的用户 ID，请从患者列表里再点一次。', 400),
        );
      }
      targetUserId = raw;
    }

    // WRITTEN BEFORE THE HANDLER RUNS, AND THE REQUEST DOES NOT PROCEED
    // IF IT FAILS.
    //
    // Both halves of that are decisions, so both are written down.
    //
    // Before: the row records an ATTEMPTED access, not a completed one.
    // An admin who opens a record and gets a 500 out of the handler
    // still had the record's existence and the patient's id in front of
    // them, and a trail that only recorded successful responses would
    // be missing exactly the requests that went wrong. It also means
    // the row survives a handler that crashes the process.
    //
    // Fail closed: if the INSERT fails, the request is refused with a
    // 503 and the handler never runs. The alternative — serve the
    // record and log a warning — is a patient record read with no trace
    // of the read, which is the single thing this middleware exists to
    // make impossible. An operator retries; the patient does not get an
    // invisible visitor. The refusal is loud on our side too: a 503
    // AppError is non-operational, so the error handler logs it.
    //
    // The payload is exactly the four fields §B2 asks for and carries
    // no identifier — two opaque UUIDs, a path and a method. If a
    // future field here ever holds an IP, a user agent, a phone or an
    // email, it must go through maskAuditPayload from
    // services/audit/identity-masking.ts first; it is not called now
    // because there is nothing in this payload for it to mask, and a
    // call that does nothing is a call somebody deletes.
    //
    // `audit_logs.user_id` is left NULL, matching every other insert
    // site in this repo (account-deletion.ts:256 documents that no
    // insert site populates it). One consequence to know about: the
    // account-deletion tombstone matches rows on
    // `event_payload->>'userId'`, so these rows — which use
    // `adminUserId` / `targetUserId` — are not stamped with
    // `subjectPurgedAt` when the patient deletes their account. Nothing
    // in them needs stripping (the tombstone's own note explains why a
    // bare UUID is kept even for the rows it does match), but the
    // marker will be absent.
    const payload = {
      adminUserId: user.id,
      targetUserId,
      path: _auditPathOf(req.originalUrl),
      method: req.method,
    };

    try {
      await pool.query(
        `INSERT INTO audit_logs (event_type, event_payload)
         VALUES ($1, $2::jsonb)`,
        [spec.event, JSON.stringify(payload)],
      );
    } catch (error) {
      logger.error(
        { err: error, event: spec.event, ...payload },
        'Refusing an admin request because its audit row could not be written',
      );
      return next(new AppError('Admin access is unavailable: audit write failed', 503));
    }

    return next();
  };

  return [
    requireAuth(env, logger),
    (req, res, next) => {
      gate(req, res, next).catch(next);
    },
  ];
};
