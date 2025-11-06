import { Router } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { getPool } from '../../db/pool';
import type { RouteContext } from '../../routes';
import { asyncHandler } from '../../utils/async-handler';

export const createAuthRouter = (context: RouteContext) => {
  const router = Router();
  const service = new AuthService({ env: context.env, logger: context.logger, pool: getPool() });
  const controller = new AuthController(service);

  router.post('/register', asyncHandler(controller.register));
  router.post('/login', asyncHandler(controller.login));

  return router;
};
