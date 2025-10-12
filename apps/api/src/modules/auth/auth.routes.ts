import { Router } from 'express';
import type { RouteContext } from '../../routes';
import { asyncHandler } from '../../utils/async-handler';
import { getPool } from '../../db/pool';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

export const createAuthRouter = (context: RouteContext) => {
  const router = Router();
  const service = new AuthService({ env: context.env, logger: context.logger, pool: getPool() });
  const controller = new AuthController(service);

  router.post('/register', asyncHandler(controller.register));
  router.post('/login', asyncHandler(controller.login));

  return router;
};
