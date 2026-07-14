import type { Request, Response } from 'express';
import { loginSchema, registerSchema, sendOtpSchema, verifyOtpSchema } from './auth.schema.js';
import type { AuthService } from './auth.service.js';
import type { OtpService } from '../../services/otp/otp.service.js';

export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly otpService: OtpService,
  ) {}

  register = async (req: Request, res: Response) => {
    const payload = registerSchema.parse(req.body);
    await this.otpService.verifyCode({
      phoneNumber: payload.phoneNumber,
      code: payload.otpCode,
      scene: 'register',
      requestId: payload.otpRequestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const result = await this.service.register(payload, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(201).json(result);
  };

  login = async (req: Request, res: Response) => {
    const payload = loginSchema.parse(req.body);
    const result = await this.service.login(payload, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(200).json(result);
  };

  sendOtp = async (req: Request, res: Response) => {
    const payload = sendOtpSchema.parse(req.body);
    const result = await this.otpService.sendCode({
      phoneNumber: payload.phoneNumber,
      scene: payload.scene,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    // Only surface the non-sensitive envelope. The OTP itself
    // (OtpSendResult.mockCode, set by the dev mock provider) must
    // never reach the wire — returning `result` wholesale would leak
    // it. Dev reads the code from the server log instead.
    res.status(200).json({
      requestId: result.requestId,
      sentTo: result.sentTo,
      provider: result.provider,
      // Drive the client's resend countdown from the server's actual
      // OTP_RESEND_INTERVAL_SECONDS instead of a hard-coded 60 — the
      // two drift whenever the env is tuned.
      retryAfterSeconds: this.otpService.resendIntervalSeconds,
    });
  };

  verifyOtp = async (req: Request, res: Response) => {
    const payload = verifyOtpSchema.parse(req.body);
    const result = await this.otpService.verifyCode({
      phoneNumber: payload.phoneNumber,
      code: payload.code,
      scene: payload.scene,
      requestId: payload.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(200).json(result);
  };
}
