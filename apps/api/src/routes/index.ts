import { Router } from 'express';
import type { Express, Request, Response } from 'express';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createAiChatRoutes } from './ai-chat.routes.js';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';
import { getPool } from '../db/pool.js';
import { createAuthRouter } from '../modules/auth/auth.routes.js';
import { createPatientProfileRouter } from '../modules/patient-profile/profile.routes.js';
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
    return {
      status:
        kb.ok && payload?.status === 'ready'
          ? ('ok' as const)
          : payload?.status === 'warming'
            ? ('warming' as const)
            : ('error' as const),
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

const checkEmbeddedOcr = async (context: RouteContext) => {
  if (context.env.OCR_PROVIDER !== 'embedded') {
    return {
      status: 'ok' as const,
      provider: context.env.OCR_PROVIDER,
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
      pythonBin: context.env.OCR_PYTHON_BIN,
      pythonVersion: (versionResult.stdout || versionResult.stderr || '').trim(),
      parserPath,
    };
  } catch (error) {
    return {
      status: 'error' as const,
      provider: context.env.OCR_PROVIDER,
      pythonBin: context.env.OCR_PYTHON_BIN,
      parserPath,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

const getHealthSummary = async (context: RouteContext) => {
  const [database, kbService, ocr] = await Promise.all([
    checkDatabase(context),
    checkKbService(context),
    checkEmbeddedOcr(context),
  ]);

  const components: Record<string, unknown> = {
    database,
    kbService,
    ocr,
    ai: {
      status:
        context.env.AI_API_KEY || context.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
      model: context.env.AI_API_MODEL,
    },
  };

  const hasCriticalFailure = database.status !== 'ok' || ocr.status !== 'ok';
  const isReady = !hasCriticalFailure && kbService.status === 'ok';
  const status = hasCriticalFailure ? 'error' : isReady ? 'ok' : 'degraded';

  return {
    status,
    ready: isReady,
    components,
  };
};

export const registerRoutes = (app: Express, context: RouteContext) => {
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
    asyncHandler(async (_req: Request, res: Response) => {
      const summary = await getHealthSummary(context);
      res.status(summary.ready ? 200 : 503).json(summary);
    }),
  );

  apiRouter.get(
    '/healthz',
    asyncHandler(async (_req: Request, res: Response) => {
      const summary = await getHealthSummary(context);
      res.status(summary.status === 'error' ? 503 : 200).json(summary);
    }),
  );

  apiRouter.use('/auth', createAuthRouter(context));
  apiRouter.use('/ai', createAiChatRoutes(context));
  apiRouter.use('/profiles', createPatientProfileRouter(context));

  app.use('/api', apiRouter);
};
