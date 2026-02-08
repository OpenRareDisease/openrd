import type { OtpProvider, OtpSendResult } from './otp-provider.js';
import { AppError } from '../../utils/app-error.js';

export class TencentOtpProvider implements OtpProvider {
  async sendCode(): Promise<OtpSendResult> {
    throw new AppError('Tencent SMS provider is not configured', 501);
  }
}
