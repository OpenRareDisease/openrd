import type { Express, Request, Response } from 'express';
import { Router } from 'express';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';
import { getPool } from '../db/pool.js';
import { createAuthRouter } from '../modules/auth/auth.routes.js';
import { aiChatRoutes } from './ai-chat.routes.js'; 
import profileRoutes from './profiles.js'; // 添加这行 - 导入 profiles 路由
import { asyncHandler } from '../utils/async-handler.js';

export interface RouteContext {
  env: AppEnv;
  logger: AppLogger;
}

export const registerRoutes = (app: Express, context: RouteContext) => {
  const apiRouter = Router();

  apiRouter.get(
    '/healthz',
    asyncHandler(async (_req: Request, res: Response) => {
      try {
        await getPool().query('SELECT 1');
        res.status(200).json({ status: 'ok', database: 'connected' });
      } catch (error) {
        context.logger.error({ error }, 'Database health check failed');
        res.status(503).json({ status: 'degraded', database: 'unreachable' });
      }
    }),
  );

  apiRouter.use('/auth', createAuthRouter(context));
  apiRouter.use('/ai', aiChatRoutes);
  apiRouter.use('/profiles', profileRoutes); // 添加这行 - 注册 profiles 路由

  app.use('/api', apiRouter);
};