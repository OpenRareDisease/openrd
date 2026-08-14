import { z } from 'zod';

import { AUDIT_RETENTION_DAYS } from '../../services/audit/retention.js';
import { PORTABLE_EXPORT_FORMATS } from '../patient-profile/export/index.js';

/**
 * Every admin route parameter and query string, parsed before it
 * reaches a query.
 *
 * `userId` is a UUID here as well as in `requireAdmin`, which also
 * checks it — and the middleware runs FIRST, so for the three routes
 * that declare `targetParam: 'userId'` today (`GET /patients/:userId`,
 * `PUT /patients/:userId/baseline`, `GET /patients/:userId/export` —
 * `grep -n targetParam apps/api/src/modules/admin/admin.routes.ts` on
 * 2026-08-13 returns those three plus two comment lines) it is the
 * middleware's 400 that a mistyped id gets, and this parse never sees
 * one. Measured through the real router:
 * `GET /api/admin/patients/not-a-uuid` → 400, asserted in
 * admin.routes.test.ts.
 *
 * It is kept because `targetParam` is OPTIONAL. A route added later
 * that takes a `:userId` and omits it — a read that is deliberately
 * not patient-scoped in the trail, say — gets no check from the
 * middleware at all, and this parse is then the only thing between a
 * pasted string and a query.
 */
export const adminUserIdParamsSchema = z.object({
  userId: z.string().uuid(),
});

export const ADMIN_PATIENT_LIST_MAX_PAGE_SIZE = 50;

/**
 * `page` is capped so that `OFFSET` is bounded. Without the cap,
 * `?page=100000000` is a request for an offset scan the database will
 * genuinely attempt.
 */
export const patientListQuerySchema = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(ADMIN_PATIENT_LIST_MAX_PAGE_SIZE).default(20),
});

/**
 * `format` is REQUIRED, and that is the design.
 *
 * There is no default「just give me the JSON」: the record endpoint
 * already returns this patient in our own shape, so a formatless export
 * would be the same bytes with a filename on them. Asking for a format
 * makes the endpoint mean one thing — a document in somebody else's
 * schema, with that schema's own conformance statement and omission
 * list attached — and a missing format answers 400 naming the three
 * rather than silently picking one.
 *
 * `required_error` is what makes the second half of that true. Without
 * it a formatless request answered `{"format":["Required"]}`, which
 * names nothing; an INVALID format has always named the three, because
 * that is Zod's own enum message. Both are asserted in
 * admin.routes.test.ts.
 */
export const patientExportQuerySchema = z.object({
  format: z.enum(PORTABLE_EXPORT_FORMATS, {
    required_error: `format 是必填的，取值：${PORTABLE_EXPORT_FORMATS.join(' / ')}`,
  }),
});

/**
 * The typed confirmation for the full-database export.
 *
 * Optional in the schema and required in the handler: a request without
 * it is the FIRST half of the two-step, and it is answered with the
 * exact phrase to send back plus the row count and the caveats. Making
 * it required here would turn that step into a validation error with no
 * room to carry any of it.
 */
export const fullExportBodySchema = z.object({
  confirm: z.string().max(200).optional(),
});

/**
 * The window is bounded by the retention sweep rather than clamped to
 * it. `ai_prompt_audit` is deleted past AUDIT_RETENTION_DAYS
 * (services/audit/retention.ts), so a 365-day request cannot be
 * answered — and answering it with 180 days of data under a `365` label
 * is exactly the silent degradation this repository keeps paying for.
 * 400 instead, naming the bound.
 */
export const aiUsageQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(AUDIT_RETENTION_DAYS).default(7),
});

export const parseFailureQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
