import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { getPool } from '../../db/pool.js';
import type { RouteContext } from '../../routes/index.js';
import { OtpService } from '../../services/otp/otp.service.js';
import { asyncHandler } from '../../utils/async-handler.js';

export const createAuthRouter = (context: RouteContext) => {
  const router = Router();
  const otpService = new OtpService({
    env: context.env,
    logger: context.logger,
    pool: getPool(),
  });
  const service = new AuthService({
    env: context.env,
    logger: context.logger,
    pool: getPool(),
  });
  const controller = new AuthController(service, otpService);

  router.post('/otp/send', asyncHandler(controller.sendOtp));
  router.post('/otp/verify', asyncHandler(controller.verifyOtp));
  router.post('/register', asyncHandler(controller.register));
  router.post('/login', asyncHandler(controller.login));

  return router;
};
