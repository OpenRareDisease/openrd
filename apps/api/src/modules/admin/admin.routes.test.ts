import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../config/logger.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { notFoundHandler } from '../../middleware/not-found.js';
import { AUDIT_RETENTION_DAYS } from '../../services/audit/retention.js';

/**
 * The gate, end to end through Express.
 *
 * §B2 is a property of the ROUTER, not of any handler: every admin
 * request writes an audit row, reads included, and the role comes from
 * the database rather than from the token. A handler test cannot see
 * either — the middleware runs before the handler and the handler never
 * learns it ran. So this file drives the real router with a fake pool
 * and asserts on what landed in `audit_logs`.
 *
 * The last test in the file is the one that matters most over time: it
 * walks the router's own stack and fails if a route exists that this
 * file does not cover, so a route added next month cannot quietly ship
 * with the wrong audit event or none at all.
 */

const JWT_SECRET = 'test-secret-not-a-real-one';
const ADMIN_ID = '11111111-2222-3333-4444-555555555555';
const PATIENT_ID = '99999999-8888-7777-6666-555555555555';

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

const state = {
  calls: [] as RecordedQuery[],
  account: { role: 'admin', is_active: true } as { role: string; is_active: boolean } | undefined,
};

const profileRow = {
  id: 'profile-1',
  user_id: PATIENT_ID,
  full_name: '张三',
  preferred_name: null,
  date_of_birth: null,
  gender: null,
  patient_code: null,
  diagnosis_stage: null,
  diagnosis_date: null,
  genetic_mutation: null,
  height_cm: null,
  weight_kg: null,
  blood_type: null,
  contact_phone: null,
  contact_email: null,
  primary_physician: null,
  region_province: null,
  region_city: null,
  region_district: null,
  // Carries an administrator's marker, so the export route below can
  // assert §B3 against the REAL export builders rather than a mock.
  baseline_payload: {
    foundation: { regionLabel: '浙江杭州' },
    fieldProvenance: {
      'foundation.regionLabel': {
        source: 'admin_entered',
        adminUserId: ADMIN_ID,
        at: '2026-08-01T00:00:00.000Z',
      },
    },
  },
  notes: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-02-01T00:00:00.000Z'),
};

const answer = (sql: string) => {
  // requireAdmin's role probe. Matched on its exact projection so it
  // does not collide with AdminService.getAccount, which reads the same
  // table.
  if (sql.includes('SELECT role, is_active FROM app_users')) {
    return { rows: state.account ? [state.account] : [], rowCount: state.account ? 1 : 0 };
  }
  if (sql.includes('INSERT INTO audit_logs')) return { rows: [], rowCount: 1 };
  if (sql.includes('FROM app_users')) {
    return {
      rows: [
        {
          id: PATIENT_ID,
          phone_number: '+8613900000001',
          email: null,
          role: 'patient',
          is_active: true,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes('COUNT(*)::text AS total FROM patient_profiles')) {
    return { rows: [{ total: '1' }], rowCount: 1 };
  }
  if (sql.includes('FROM patient_profiles')) return { rows: [profileRow], rowCount: 1 };
  if (sql.includes('UPDATE patient_profiles')) return { rows: [], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};

const query = vi.fn(async (sql: string, values?: unknown[]) => {
  state.calls.push({ sql, values: values ?? [] });
  return answer(sql);
});

vi.mock('../../db/pool.js', () => ({
  getPool: () => ({
    query,
    connect: async () => ({ query, release: () => undefined }),
  }),
}));

const { createAdminRouter } = await import('./admin.routes.js');

const logger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => logger,
} as unknown as AppLogger;

const context = { env: { JWT_SECRET } as unknown as AppEnv, logger };

const makeApp = () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));
  app.use(
    '/api/admin',
    createAdminRouter(context, {
      healthSummary: async () => ({ status: 'ok', ready: true, components: {} }),
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));
  return app;
};

const app = makeApp();

const bearer = (payload: Record<string, unknown>) =>
  `Bearer ${jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' })}`;

const adminToken = () => bearer({ sub: ADMIN_ID, role: 'admin' });
/** A patient whose TOKEN claims admin. The role must still come from
 *  the database, or `npm run admin:revoke` would not revoke anything
 *  until the stolen token expired on its own. */
const forgedRoleToken = () => bearer({ sub: PATIENT_ID, role: 'admin' });

const auditRows = () =>
  state.calls
    .filter((call) => call.sql.includes('INSERT INTO audit_logs'))
    .map((call) => ({
      eventType: call.values[0] as string,
      payload: JSON.parse(call.values[1] as string) as Record<string, unknown>,
    }));

/**
 * Every route in the router, with the audit event it must write and
 * whether that event names a patient. Kept as data so the coverage
 * check at the bottom can compare it against the router's own stack.
 */
const ROUTES = [
  { method: 'get', path: '/api/admin/patients', event: 'admin.list', target: null },
  {
    method: 'get',
    path: `/api/admin/patients/${PATIENT_ID}`,
    event: 'admin.record_read',
    target: PATIENT_ID,
  },
  {
    method: 'put',
    path: `/api/admin/patients/${PATIENT_ID}/baseline`,
    event: 'admin.record_write',
    target: PATIENT_ID,
    body: { foundation: { regionLabel: '江苏南京' } },
  },
  {
    method: 'get',
    path: `/api/admin/patients/${PATIENT_ID}/export?format=fhir-r4`,
    event: 'admin.export',
    target: PATIENT_ID,
  },
  {
    method: 'post',
    path: '/api/admin/exports/patients.csv',
    event: 'admin.export',
    target: null,
    body: {},
  },
  { method: 'get', path: '/api/admin/ops/corpus', event: 'admin.list', target: null },
  { method: 'get', path: '/api/admin/ops/parse-failures', event: 'admin.list', target: null },
  { method: 'get', path: '/api/admin/ops/ai-usage', event: 'admin.list', target: null },
  { method: 'get', path: '/api/admin/ops/health', event: 'admin.list', target: null },
] as const;

const call = (route: (typeof ROUTES)[number], token?: string) => {
  const agent = request(app) as unknown as Record<string, (path: string) => request.Test>;
  let test = agent[route.method](route.path);
  if (token) test = test.set('authorization', token);
  if ('body' in route && route.body) test = test.send(route.body as object);
  return test;
};

beforeEach(() => {
  state.calls = [];
  state.account = { role: 'admin', is_active: true };
});

describe('every admin route is behind requireAuth', () => {
  it.each(ROUTES)('$method $path answers 401 with no token', async (route) => {
    const response = await call(route);
    expect(response.status).toBe(401);
    // requireAuth runs first, so nothing reached the database at all.
    expect(state.calls).toHaveLength(0);
  });
});

describe('every admin route reads the role from the database', () => {
  it.each(ROUTES)('$method $path answers 403 for a non-admin', async (route) => {
    state.account = { role: 'patient', is_active: true };
    const response = await call(route, forgedRoleToken());

    expect(response.status).toBe(403);
    // Deliberately not audited: nobody saw anything, and auditing a
    // refusal would let any logged-in user append rows at will.
    expect(auditRows()).toHaveLength(0);
  });

  it.each(ROUTES)('$method $path answers 403 for a deactivated administrator', async (route) => {
    state.account = { role: 'admin', is_active: false };
    const response = await call(route, adminToken());
    expect(response.status).toBe(403);
  });
});

describe('every admin route writes its audit row before the handler runs', () => {
  it.each(ROUTES)('$method $path writes $event', async (route) => {
    const response = await call(route, adminToken());

    const rows = auditRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].eventType).toBe(route.event);
    expect(rows[0].payload.adminUserId).toBe(ADMIN_ID);
    expect(rows[0].payload.targetUserId).toBe(route.target);
    expect(rows[0].payload.method).toBe(route.method.toUpperCase());
    // The query string is stripped: the patient list's `?q=` is a
    // patient's name typed by an operator.
    expect(rows[0].payload.path).toBe(route.path.split('?')[0]);
    // A 5xx here would mean the route reached the handler and blew up,
    // which would leave the audit assertion above passing over a
    // broken endpoint.
    expect(response.status).toBeLessThan(500);
  });
});

describe('the full export is audited twice, and the second row says how much left', () => {
  it('writes only the gate row for the unconfirmed first step', async () => {
    const response = await request(app)
      .post('/api/admin/exports/patients.csv')
      .set('authorization', adminToken())
      .send({});

    expect(response.status).toBe(428);
    expect(auditRows()).toHaveLength(1);
    expect(response.body.requiredConfirmation).toEqual(expect.any(String));
  });

  it('adds the scoped row once the operator confirms', async () => {
    const probe = await request(app)
      .post('/api/admin/exports/patients.csv')
      .set('authorization', adminToken())
      .send({});
    state.calls = [];

    const response = await request(app)
      .post('/api/admin/exports/patients.csv')
      .set('authorization', adminToken())
      .send({ confirm: probe.body.requiredConfirmation });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    const rows = auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[1].payload.scope).toBe('all_patients');
    expect(rows[1].payload.fileName).toEqual(expect.stringContaining(ADMIN_ID));
  });
});

describe('the bounds on the query strings', () => {
  it('refuses a page far past the end rather than running the offset scan', async () => {
    // `?page=100000000` is a request for an OFFSET the database will
    // genuinely attempt. The cap is 10,000 pages.
    const response = await request(app)
      .get('/api/admin/patients?page=100000000')
      .set('authorization', adminToken());

    expect(response.status).toBe(400);
    expect(state.calls.some((c) => c.sql.includes('LIMIT $2 OFFSET $3'))).toBe(false);
  });

  it('refuses a window longer than the retention sweep instead of answering it short', async () => {
    // `ai_prompt_audit` is deleted past AUDIT_RETENTION_DAYS, so 365
    // days cannot be answered — and 180 days of rows under a `365`
    // label is the silent degradation the cap exists to prevent.
    const response = await request(app)
      .get('/api/admin/ops/ai-usage?windowDays=365')
      .set('authorization', adminToken());

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(String(AUDIT_RETENTION_DAYS));
    expect(state.calls.some((c) => c.sql.includes('FROM ai_prompt_audit'))).toBe(false);
  });
});

describe('the full export is rate limited per administrator', () => {
  it('answers 429 on the eleventh attempt in a minute', async () => {
    // Its own administrator id: `stores` in rate-limit.ts is a
    // module-global keyed by `admin:full-export:<user id>`, so sharing
    // ADMIN_ID would spend the budget the two tests above rely on.
    const token = bearer({ sub: '77777777-6666-5555-4444-333333333333', role: 'admin' });
    const attempt = () =>
      request(app).post('/api/admin/exports/patients.csv').set('authorization', token).send({});

    for (let i = 0; i < 10; i += 1) {
      expect((await attempt()).status).toBe(428);
    }

    const response = await attempt();
    expect(response.status).toBe(429);
    // The limiter sits BEHIND requireAdmin, so the attempt is audited
    // even though it was throttled — a burst of them is exactly what
    // the trail is for.
    expect(auditRows()).toHaveLength(11);
  });
});

describe('the single-patient export asks for a format and never picks one', () => {
  it('refuses a request with no format, naming the three', async () => {
    // Two claims in admin.schema.ts hang on this: that there is no
    // default (a `.default('fhir-r4')` here would make a formatless
    // request silently mean FHIR), and that the refusal NAMES the
    // formats. Before this test the answer was `{"format":["Required"]}`
    // — a refusal that tells an operator nothing about what to send.
    const response = await request(app)
      .get(`/api/admin/patients/${PATIENT_ID}/export`)
      .set('authorization', adminToken());

    expect(response.status).toBe(400);
    const message = JSON.stringify(response.body);
    for (const format of ['treat-nmd', 'phenopacket', 'fhir-r4']) {
      expect(message).toContain(format);
    }
  });
});

describe('§B3 end to end: the marker leaves with the document', () => {
  it('puts the origin in the bytes the export route sends', async () => {
    // The one place this property can be checked against the real
    // `buildPortableExport` — the controller test mocks it. If a
    // builder stops emitting the origin, `exportPatient` refuses with a
    // 409 rather than shipping the flattened document, so either
    // outcome fails here loudly.
    const response = await request(app)
      .get(`/api/admin/patients/${PATIENT_ID}/export?format=treat-nmd`)
      .set('authorization', adminToken());

    expect(response.status).toBe(200);
    expect(response.text).toContain('admin_entered');
  });
});

describe('a patient id that is not a user id', () => {
  it('answers 400 without blaming the route, and audits nothing', async () => {
    // Measured before this test existed: this request answered
    // `500 {"error":"Admin route misconfigured: no user id in route
    // parameter 'userId'"}`. The id is the only thing wrong, and it
    // came from the operator's clipboard.
    const response = await request(app)
      .get('/api/admin/patients/not-a-uuid')
      .set('authorization', adminToken());

    expect(response.status).toBe(400);
    expect(response.body.error).not.toContain('misconfigured');
    expect(auditRows()).toHaveLength(0);
  });
});

describe('route coverage', () => {
  it('has a case above for every route the router registers', () => {
    const router = createAdminRouter(context, {
      healthSummary: async () => ({ status: 'ok', ready: true, components: {} }),
    });
    const registered = (
      router.stack as Array<{ route?: { path: string; methods: Record<string, boolean> } }>
    )
      .filter((layer) => layer.route)
      .flatMap((layer) =>
        Object.keys(layer.route!.methods).map((method) => `${method} ${layer.route!.path}`),
      )
      .sort();

    const covered = ROUTES.map(
      (route) =>
        `${route.method} ${route.path.replace('/api/admin', '').replace(PATIENT_ID, ':userId').split('?')[0]}`,
    ).sort();

    expect(registered).toEqual(covered);
  });

  it('mounts requireAuth and the admin gate in front of every handler', () => {
    const router = createAdminRouter(context, {
      healthSummary: async () => ({ status: 'ok', ready: true, components: {} }),
    });
    for (const layer of router.stack as Array<{
      route?: { path: string; stack: Array<{ name: string }> };
    }>) {
      if (!layer.route) continue;
      // requireAdmin returns [requireAuth, gate]; the handler is last.
      // Fewer than three handlers on a route means somebody mounted it
      // with a bare `asyncHandler`.
      expect(layer.route.stack.length).toBeGreaterThanOrEqual(3);
    }
  });
});
