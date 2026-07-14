import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import type { OtpService } from '../../services/otp/otp.service.js';

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
