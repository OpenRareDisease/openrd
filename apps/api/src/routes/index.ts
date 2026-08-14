import { Router } from 'express';
import type { Express, Request, Response } from 'express';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createAiChatRoutes } from './ai-chat.routes.js';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';
import { getPool } from '../db/pool.js';
import { isShuttingDown } from '../lifecycle.js';
import { createAdminRouter } from '../modules/admin/admin.routes.js';
import { createAuthRouter } from '../modules/auth/auth.routes.js';
import { createLegalRouter } from '../modules/legal/legal.routes.js';
import {
  createPassportShareRouter,
  createPublicPassportRouter,
} from '../modules/patient-profile/passport-share.routes.js';
import { createPatientProfileRouter } from '../modules/patient-profile/profile.routes.js';
import { createTrialsRouter } from '../modules/trials/trials.routes.js';
import { OCR_PROCESSOR_DISCLOSURES } from '../services/ocr/ocr-provider.js';
import { asyncHandler } from '../utils/async-handler.js';

export interface RouteContext {
  env: AppEnv;
  logger: AppLogger;
}

const execFileAsync = promisify(execFile);

const resolveEmbeddedParserPath = () => {
  const candidates = [
    path.resolve(process.cwd(), 'apps/report-manager/embedded_parser.py'),
    path.resolve(process.cwd(), '../report-manager/embedded_parser.py'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

const fetchJsonWithTimeout = async (url: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
};

const checkDatabase = async (context: RouteContext) => {
  try {
    await getPool().query('SELECT 1');
    return { status: 'ok' as const };
  } catch (error) {
    context.logger.error({ error }, 'Database health check failed');
    return {
      status: 'error' as const,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

const checkKbService = async (context: RouteContext) => {
  const url = `${context.env.kbServiceUrl}/health/ready`;
  try {
    const kb = await fetchJsonWithTimeout(url, context.env.HEALTHCHECK_TIMEOUT_MS);
    const payload = kb.payload as {
      status?: string;
      state?: Record<string, unknown> | null;
    } | null;
    // `empty_corpus` is carried through as its own component status
    // rather than being folded into the generic 'error' bucket. The KB
    // service returns it (with a 503) when the embedding model is warm
    // but `kb_chunks` has zero rows — a fresh environment nobody ran
    // `npm run kb:ingest` on. That reads as an ordinary KB outage in a
    // generic error, and the operator goes looking at the network and
    // the container logs for a service that is in fact perfectly
    // healthy and simply has nothing to retrieve.
    const status =
      kb.ok && payload?.status === 'ready'
        ? ('ok' as const)
        : payload?.status === 'warming'
          ? ('warming' as const)
          : payload?.status === 'empty_corpus'
            ? ('empty_corpus' as const)
            : ('error' as const);
    return {
      status,
      url,
      httpStatus: kb.status,
      state: payload?.state ?? null,
    };
  } catch (error) {
    return {
      status: 'error' as const,
      url,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Object-storage reachability, for the STORAGE_PROVIDER=minio case only.
 *
 * validateStorageEnv asserts that MINIO_ENDPOINT / ACCESS_KEY /
 * SECRET_KEY are *present*, which always passes because compose
 * supplies a default endpoint — so a prod stack brought up without the
 * minio container (its compose profile is separately selectable) boots
 * green and then 500s on the first patient document upload, with the
 * upload path having no fallback (RoutedStorageProvider.save always
 * goes to `primary`). This probe is the difference between finding that
 * out at boot and finding it out from a patient failing to upload an
 * MRI report.
 *
 * ANY HTTP answer counts as reachable, including 403/404. The signal we
 * want is "something is listening at MINIO_ENDPOINT", and a managed
 * S3-compatible endpoint (which docs/cloud-tencent-docker.md explicitly
 * supports keeping) does not serve MinIO's own health path — treating a
 * 404 as down would report a working object store as broken.
 */
const checkStorage = async (context: RouteContext) => {
  if (context.env.STORAGE_PROVIDER !== 'minio') {
    return { status: 'ok' as const, provider: context.env.STORAGE_PROVIDER };
  }

  const endpoint = context.env.MINIO_ENDPOINT ?? '';
  const base = endpoint.includes('://')
    ? endpoint
    : `${context.env.MINIO_USE_HTTPS ? 'https' : 'http'}://${endpoint}`;
  let url: string;
  try {
    url = new URL('/minio/health/live', base).toString();
  } catch (error) {
    return {
      status: 'error' as const,
      provider: 'minio' as const,
      detail: `MINIO_ENDPOINT is not a usable host: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.env.HEALTHCHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return {
      status: 'ok' as const,
      provider: 'minio' as const,
      endpoint,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      status: 'error' as const,
      provider: 'minio' as const,
      endpoint,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * OCR runtime, plus where the document bytes go.
 *
 * The residency half is not diagnostics. 隐私政策 §3(三) promises
 * patients that OCR happens on our own servers, and `OCR_PROVIDER=baidu`
 * silently makes that false by POSTing the MRI to aip.baidubce.com —
 * with this probe previously reporting a flat `ok` for it, because a
 * non-embedded mode has no local runtime to fail. So an operator had no
 * way to see, from anywhere at runtime, that the deploy in front of
 * them was shipping reports to a vendor. `dataResidency` / `processor` /
 * `processorEndpointHost` come from OCR_PROCESSOR_DISCLOSURES, the same
 * table the stored document is stamped from, so the per-deploy and
 * per-document answers cannot disagree.
 *
 * Only the `embedded` mode is probed, and only it can fail readiness:
 * it is a local process check that cannot flap. `baidu` is deliberately
 * NOT probed — a reachability call to a third-party OCR endpoint on
 * every 15s health poll would make our readiness follow their uptime,
 * and would put us on their access log once every fifteen seconds.
 */
const checkOcr = async (context: RouteContext) => {
  const disclosure = OCR_PROCESSOR_DISCLOSURES[context.env.OCR_PROVIDER];
  const residency = {
    dataResidency: disclosure.residency,
    ...(disclosure.processor ? { processor: disclosure.processor } : {}),
    ...(disclosure.endpointHost ? { processorEndpointHost: disclosure.endpointHost } : {}),
  };

  if (context.env.OCR_PROVIDER !== 'embedded') {
    return {
      status: 'ok' as const,
      provider: context.env.OCR_PROVIDER,
      ...residency,
    };
  }

  const parserPath = resolveEmbeddedParserPath();
  try {
    const versionResult = await execFileAsync(context.env.OCR_PYTHON_BIN, ['--version'], {
      timeout: context.env.HEALTHCHECK_TIMEOUT_MS,
    });
    if (!parserPath) {
      throw new Error('embedded_parser.py not found');
    }
    return {
      status: 'ok' as const,
      provider: context.env.OCR_PROVIDER,
      ...residency,
      pythonBin: context.env.OCR_PYTHON_BIN,
      pythonVersion: (versionResult.stdout || versionResult.stderr || '').trim(),
      parserPath,
    };
  } catch (error) {
    return {
      status: 'error' as const,
      provider: context.env.OCR_PROVIDER,
      ...residency,
      pythonBin: context.env.OCR_PYTHON_BIN,
      parserPath,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

export interface HealthSummary {
  status: 'ok' | 'degraded' | 'error';
  ready: boolean;
  draining?: true;
  /** Present only on a redacted (public) payload — the correlation key
   *  for the full summary in the server log. */
  requestId?: string;
  components: Record<string, unknown>;
}

/** Exported for tests: the readiness contract a load balancer reads
 *  during a deploy is worth asserting on directly. */
export const getHealthSummary = async (context: RouteContext): Promise<HealthSummary> => {
  const [database, kbService, ocr, storage] = await Promise.all([
    checkDatabase(context),
    checkKbService(context),
    checkOcr(context),
    checkStorage(context),
  ]);

  // An unset AI_API_KEY is the one misconfiguration that leaves the
  // headline feature dead while every probe above stays green: every
  // patient question comes back 「AI 服务未配置（缺少 AI_API_KEY）」 and
  // the deploy watchlist reads it as low usage rather than a broken
  // deploy. Reported here as a component so it shows up in the same
  // place an operator already looks.
  const aiConfigured = Boolean(context.env.AI_API_KEY || context.env.OPENAI_API_KEY);
  const components: Record<string, unknown> = {
    database,
    kbService,
    ocr,
    storage,
    ai: {
      status: aiConfigured ? 'configured' : 'not_configured',
      model: context.env.AI_API_MODEL,
    },
  };

  const hasCriticalFailure = database.status !== 'ok' || ocr.status !== 'ok';
  // A process on its way out reports NOT ready even while every
  // component is still healthy — that is the whole signal a load
  // balancer has for taking an instance out of rotation before its
  // listener closes. `status` stays truthful about the components
  // themselves so the human-facing /healthz does not cry error over an
  // ordinary deploy.
  const draining = isShuttingDown();

  // WHAT IS AND IS NOT A READINESS FAILURE
  //
  // `ready` answers exactly one question: should traffic be routed to
  // this instance? Only the components without which NO request can be
  // served belong here — the database (every authenticated route reads
  // it) and the OCR runtime (its absence means uploads fail at parse
  // time, and it is a pure local-process check that cannot flap).
  //
  // The KB deliberately does NOT gate readiness, and it used to. Auth,
  // profile, measurement entry and document upload all work with the KB
  // down, so a warming or restarting KB was taking the whole API out of
  // rotation for a feature-scoped dependency — and because compose
  // gates `web` on the api healthcheck, a KB that missed its warm-up
  // budget meant the public site never came up at all. The KB is also
  // the one dependency that flaps: its server answers one request at a
  // time, so an in-flight /multi search queues ahead of our 2.5s health
  // probe and the api's readiness follows KB *load*, not KB health.
  // Same reasoning for object storage: MinIO being unreachable breaks
  // uploads, which is bad and now visible as `degraded`, but taking the
  // API out of rotation over it breaks everything else too.
  //
  // Both still make `status` 'degraded', which is what an operator
  // reads, and both stay in `components` with their own status string.
  const isReady = !hasCriticalFailure && !draining;
  const hasDegradedComponent =
    kbService.status !== 'ok' || storage.status !== 'ok' || !aiConfigured;
  const status = hasCriticalFailure
    ? 'error'
    : isReady && !hasDegradedComponent
      ? 'ok'
      : 'degraded';

  return {
    status,
    ready: isReady,
    ...(draining ? { draining: true } : {}),
    components,
  };
};

/**
 * Loopback = the request arrived on this container's own interface:
 * the compose HEALTHCHECK curl, an operator on the host via
 * `docker exec`, or an SSH tunnel. Deliberately reads
 * `socket.remoteAddress` and NOT `req.ip`: `trust proxy` makes `req.ip`
 * the X-Forwarded-For client address, which is exactly the field a
 * remote caller controls, so trusting it here would hand the full
 * diagnostic payload to anyone who sends `X-Forwarded-For: 127.0.0.1`.
 * The TCP peer address cannot be forged that way — behind Caddy it is
 * always the compose bridge address, never loopback.
 */
const isLoopbackRequest = (req: Request) => {
  const peer = req.socket.remoteAddress ?? '';
  return peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
};

/**
 * Public projection of the health summary.
 *
 * /healthz is anonymous on the public domain (Caddy proxies all of
 * /api/* straight through, and no auth middleware runs before the route
 * is registered), and the full summary carries `detail` = the raw pg
 * error string (which names host, port and DB user), `url` =
 * http://kb-service:5010, `parserPath` = an absolute in-container path,
 * the Python version, and the KB's `state.lastError` — which the KB's
 * own code documents as potentially carrying connection strings with
 * passwords and bearer tokens. That is why knowledge_service.py returns
 * a bare `{error, request_id}` envelope on /multi; this route is the
 * one place in the stack that never adopted the same discipline.
 *
 * The diagnostics are not thrown away. They are logged in full against
 * a `requestId` that is echoed to the caller, so an operator with log
 * access can still answer 「healthz says degraded, why?」 in one grep —
 * and a loopback caller (compose healthcheck, `docker exec`, SSH
 * tunnel) still gets the whole payload inline.
 */
const projectPublicSummary = (summary: HealthSummary, requestId: string): HealthSummary => ({
  status: summary.status,
  ready: summary.ready,
  ...(summary.draining ? { draining: summary.draining } : {}),
  requestId,
  components: Object.fromEntries(
    Object.entries(summary.components).map(([name, value]) => [
      name,
      { status: (value as { status?: string }).status ?? 'unknown' },
    ]),
  ),
});

/**
 * Resolve the payload actually written to the wire, and log whatever it
 * withheld. Only logs when something is off: /healthz/ready is polled
 * every 15s by the compose healthcheck, and a per-poll log line for a
 * healthy stack is how the interesting line gets buried.
 */
const respondWithHealth = (
  context: RouteContext,
  req: Request,
  summary: HealthSummary,
): HealthSummary => {
  if (!context.env.isProductionLike || isLoopbackRequest(req)) {
    return summary;
  }
  const requestId = randomUUID();
  if (summary.status !== 'ok') {
    context.logger.warn(
      { requestId, health: summary },
      'Health summary redacted for an anonymous caller; full component detail logged here',
    );
  }
  return projectPublicSummary(summary, requestId);
};

// Exported for health.test.ts. Mounting the whole apiRouter just to
// assert on what /healthz withholds would drag in multer, the OpenAI
// client and three sweep timers; production callers stay inside this
// module.
export { respondWithHealth as _respondWithHealth };

export const registerRoutes = (app: Express, context: RouteContext) => {
  // One loud line at boot when the configured OCR mode sends patient
  // reports off our servers.
  //
  // The health summary carries the same fact, but nobody reads
  // /healthz on the deploy where they flipped the env var — they read
  // it three months later while debugging something else. This is the
  // moment the decision is actually being made. It is a warn and not a
  // boot failure on purpose: refusing to start belongs in
  // validateProductionEnv next to the AI_CROSS_BORDER_ACKNOWLEDGED
  // gate, which is where an acknowledgement env var would live; this
  // module cannot reject a config it only reads.
  const ocrDisclosure = OCR_PROCESSOR_DISCLOSURES[context.env.OCR_PROVIDER];
  if (ocrDisclosure.residency === 'third_party') {
    context.logger.warn(
      {
        ocrProvider: context.env.OCR_PROVIDER,
        processor: ocrDisclosure.processor,
        endpointHost: ocrDisclosure.endpointHost,
      },
      'OCR_PROVIDER sends uploaded patient reports to a third-party processor; ' +
        '隐私政策 §3(三) states OCR does not leave our servers and §5 does not name this ' +
        'recipient — the policy text and a 委托处理协议 must be in place before this ' +
        'deploy accepts an upload',
    );
  }

  const apiRouter = Router();

  apiRouter.get(
    '/healthz/live',
    asyncHandler(async (_req: Request, res: Response) => {
      res.status(200).json({
        status: 'ok',
        service: 'api',
        timestamp: new Date().toISOString(),
      });
    }),
  );

  apiRouter.get(
    '/healthz/ready',
    asyncHandler(async (req: Request, res: Response) => {
      const summary = await getHealthSummary(context);
      res.status(summary.ready ? 200 : 503).json(respondWithHealth(context, req, summary));
    }),
  );

  apiRouter.get(
    '/healthz',
    asyncHandler(async (req: Request, res: Response) => {
      const summary = await getHealthSummary(context);
      res
        .status(summary.status === 'error' ? 503 : 200)
        .json(respondWithHealth(context, req, summary));
    }),
  );

  // The back-office. Every route inside goes through `requireAdmin`,
  // which reads the role from the database and writes one audit row per
  // request — reads included. `getHealthSummary` is handed in rather
  // than imported by that module, because it lives here and this module
  // imports that one.
  apiRouter.use(
    '/admin',
    createAdminRouter(context, { healthSummary: () => getHealthSummary(context) }),
  );
  apiRouter.use('/auth', createAuthRouter(context));
  apiRouter.use('/ai', createAiChatRoutes(context));
  apiRouter.use('/legal', createLegalRouter(context));
  apiRouter.use('/profiles', createPatientProfileRouter(context));
  apiRouter.use('/passport-shares', createPassportShareRouter(context));
  apiRouter.use('/trials', createTrialsRouter(context));

  app.use('/api', apiRouter);

  // OUTSIDE /api, and that is the point.
  //
  // This is the one route in the product a stranger's browser loads:
  // a clinician opening a link a patient forwarded them in WeChat, with
  // no account and no app. Everything under /api is shaped for our own
  // client — auth, CORS, JSON error envelopes — and none of it fits a
  // page. Keeping the prefix separate also lets the proxy give it its
  // own caching and rate-limit rules without matching paths inside the
  // API surface.
  app.use('/s/passport', createPublicPassportRouter(context));
};
