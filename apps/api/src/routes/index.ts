import type { Express } from 'express';
import { Router } from 'express';
import type { AppEnv } from '../config/env';
import type { AppLogger } from '../config/logger';
import { asyncHandler } from '../utils/async-handler';
import { createAuthRouter } from '../modules/auth/auth.routes';
import { getPool } from '../db/pool';

export interface RouteContext {
  env: AppEnv;
  logger: AppLogger;
}

export const registerRoutes = (app: Express, context: RouteContext) => {
  const apiRouter = Router();

  apiRouter.get(
    '/healthz',
    asyncHandler(async (_req, res) => {
      try {
        await getPool().query('SELECT 1');
        res.status(200).json({ status: 'ok', database: 'connected' });
      } catch (error) {
        context.logger.error({ error }, 'Database health check failed');
        res.status(503).json({ status: 'degraded', database: 'unreachable' });
      }
    })
  );

  apiRouter.use('/auth', createAuthRouter(context));

  app.use('/api', apiRouter);
};
