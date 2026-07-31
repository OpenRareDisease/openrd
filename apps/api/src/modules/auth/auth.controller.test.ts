import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller.js';
import {
  loginSchema,
  otpLoginSchema,
  passwordResetSchema,
  registerSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from './auth.schema.js';
import type { AuthService } from './auth.service.js';
import type { OtpService } from '../../services/otp/otp.service.js';
import { AppError } from '../../utils/app-error.js';

const mockResponse = () => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('AuthController.sendOtp response contract', () => {
  // This envelope was previously patched for a security bug (the dev
  // provider's mockCode leaking onto the wire), so its exact shape is
  // a security-sensitive surface — lock it down.
  it('returns exactly {requestId, sentTo, provider, retryAfterSeconds} and never the code', async () => {
    const otpService = {
      sendCode: vi.fn().mockResolvedValue({
        provider: 'mock',
        requestId: 'req-123',
        sentTo: '+8613800000000',
        // Adversarial input: the provider result DOES carry the code.
        // The controller must not forward it.
        mockCode: '113355',
      }),
      resendIntervalSeconds: 90,
    } as unknown as OtpService;
    const controller = new AuthController({} as AuthService, otpService);
    const res = mockResponse();

    await controller.sendOtp(
      {
        body: { phoneNumber: '+8613800000000', scene: 'register' },
        ip: '127.0.0.1',
        headers: {},
      } as unknown as Request,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledTimes(1);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body).toEqual({
      requestId: 'req-123',
      sentTo: '+8613800000000',
      provider: 'mock',
      retryAfterSeconds: 90,
    });
    expect(Object.keys(body)).not.toContain('mockCode');
  });
});

describe('OTP login / password reset — verification precedes the privileged action', () => {
  const baseRequest = {
    ip: '127.0.0.1',
    headers: {},
  };

  it('loginWithOtp NEVER issues a session when the code is invalid', async () => {
    const otpService = {
      verifyCode: vi.fn().mockRejectedValue(new AppError('OTP code invalid', 400)),
    } as unknown as OtpService;
    const authService = {
      loginWithOtp: vi.fn(),
    } as unknown as AuthService;
    const controller = new AuthController(authService, otpService);
    const res = mockResponse();

    await expect(
      controller.loginWithOtp(
        {
          ...baseRequest,
          body: { phoneNumber: '+8613800000000', code: '000000' },
        } as unknown as Request,
        res,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(authService.loginWithOtp).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('loginWithOtp verifies with scene "login" then returns the session', async () => {
    const otpService = {
      verifyCode: vi.fn().mockResolvedValue({ requestId: 'req-1' }),
    } as unknown as OtpService;
    const session = { user: { id: 'u1' }, token: 'jwt' };
    const authService = {
      loginWithOtp: vi.fn().mockResolvedValue(session),
    } as unknown as AuthService;
    const controller = new AuthController(authService, otpService);
    const res = mockResponse();

    await controller.loginWithOtp(
      {
        ...baseRequest,
        body: { phoneNumber: '+8613800000000', code: '123456' },
      } as unknown as Request,
      res,
    );

    expect(otpService.verifyCode).toHaveBeenCalledWith(
      expect.objectContaining({ scene: 'login', phoneNumber: '+8613800000000' }),
    );
    expect(res.json).toHaveBeenCalledWith(session);
  });

  it('resetPassword NEVER touches the account when the code is invalid', async () => {
    const otpService = {
      verifyCode: vi.fn().mockRejectedValue(new AppError('OTP code invalid', 400)),
    } as unknown as OtpService;
    const authService = {
      resetPassword: vi.fn(),
    } as unknown as AuthService;
    const controller = new AuthController(authService, otpService);
    const res = mockResponse();

    await expect(
      controller.resetPassword(
        {
          ...baseRequest,
          body: {
            phoneNumber: '+8613800000000',
            code: '000000',
            newPassword: 'newpass123',
          },
        } as unknown as Request,
        res,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(authService.resetPassword).not.toHaveBeenCalled();
  });

  it('resetPassword verifies with scene "reset" then replaces the password', async () => {
    const otpService = {
      verifyCode: vi.fn().mockResolvedValue({ requestId: 'req-2' }),
    } as unknown as OtpService;
    const authService = {
      resetPassword: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthService;
    const controller = new AuthController(authService, otpService);
    const res = mockResponse();

    await controller.resetPassword(
      {
        ...baseRequest,
        body: {
          phoneNumber: '+8613800000000',
          code: '123456',
          newPassword: 'newpass123',
        },
      } as unknown as Request,
      res,
    );

    expect(otpService.verifyCode).toHaveBeenCalledWith(expect.objectContaining({ scene: 'reset' }));
    expect(authService.resetPassword).toHaveBeenCalledWith(
      '+8613800000000',
      'newpass123',
      expect.any(Object),
    );
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('rejects a short newPassword before any verification happens', async () => {
    const otpService = { verifyCode: vi.fn() } as unknown as OtpService;
    const authService = { resetPassword: vi.fn() } as unknown as AuthService;
    const controller = new AuthController(authService, otpService);
    const res = mockResponse();

    await expect(
      controller.resetPassword(
        {
          ...baseRequest,
          body: { phoneNumber: '+8613800000000', code: '123456', newPassword: 'short' },
        } as unknown as Request,
        res,
      ),
    ).rejects.toThrow();
    expect(otpService.verifyCode).not.toHaveBeenCalled();
  });
});

describe('phone number normalisation (schema boundary)', () => {
  // One human phone number must reach one account regardless of how it
  // was typed. Before the schema transform, `13900000001` and
  // `+8613900000001` created and matched *different* rows, because
  // every lookup in auth.service is an exact string compare. In a test
  // database that produced two profiles for the same person, each
  // holding a different half of the record.
  const BARE = '13900000001';
  const E164 = '+8613900000001';

  it('canonicalises every phone-bearing schema to +86 form', () => {
    expect(
      registerSchema.parse({
        phoneNumber: BARE,
        otpCode: '1234',
        password: 'Passw0rd!',
      }).phoneNumber,
    ).toBe(E164);

    expect(loginSchema.parse({ phoneNumber: BARE, password: 'Passw0rd!' }).phoneNumber).toBe(E164);
    expect(sendOtpSchema.parse({ phoneNumber: BARE }).phoneNumber).toBe(E164);
    expect(verifyOtpSchema.parse({ phoneNumber: BARE, code: '1234' }).phoneNumber).toBe(E164);
    expect(otpLoginSchema.parse({ phoneNumber: BARE, code: '1234' }).phoneNumber).toBe(E164);
    expect(
      passwordResetSchema.parse({
        phoneNumber: BARE,
        code: '1234',
        newPassword: 'Passw0rd!',
      }).phoneNumber,
    ).toBe(E164);
  });

  it('leaves an already-canonical number untouched', () => {
    expect(sendOtpSchema.parse({ phoneNumber: E164 }).phoneNumber).toBe(E164);
  });

  it('keeps a non-mainland country code as given', () => {
    // The rule is "assume +86 when no country code", not "always +86".
    expect(sendOtpSchema.parse({ phoneNumber: '+14155550123' }).phoneNumber).toBe('+14155550123');
  });
});
