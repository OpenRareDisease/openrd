import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { getPool } from '../../db/pool.js';
import { createRateLimitMiddleware } from '../../middleware/rate-limit.js';
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
  const authLimiter = createRateLimitMiddleware({
    keyPrefix: 'auth',
    windowMs: context.env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
    maxRequests: context.env.AUTH_RATE_LIMIT_MAX_REQUESTS,
    message: '认证请求过于频繁，请稍后再试',
  });
  const otpSendLimiter = createRateLimitMiddleware({
    keyPrefix: 'auth:otp-send',
    windowMs: context.env.OTP_SEND_RATE_LIMIT_WINDOW_SECONDS * 1000,
    maxRequests: context.env.OTP_SEND_RATE_LIMIT_MAX_REQUESTS,
    message: '验证码发送过于频繁，请稍后再试',
  });

  router.post('/otp/send', otpSendLimiter, asyncHandler(controller.sendOtp));
  router.post('/otp/verify', authLimiter, asyncHandler(controller.verifyOtp));
  router.post('/register', authLimiter, asyncHandler(controller.register));
  router.post('/login', authLimiter, asyncHandler(controller.login));

  return router;
};
