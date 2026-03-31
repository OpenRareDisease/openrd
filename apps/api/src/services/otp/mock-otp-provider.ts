import type { OtpProvider, OtpSendResult } from './otp-provider.js';

export class MockOtpProvider implements OtpProvider {
  async sendCode(input: {
    phoneNumber: string;
    code: string;
    ttlMinutes: number;
    requestId: string;
  }): Promise<OtpSendResult> {
    return {
      provider: 'mock',
      requestId: input.requestId,
      sentTo: input.phoneNumber,
      mockCode: input.code,
    };
  }
}
