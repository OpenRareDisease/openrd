import type { OtpProvider, OtpSendResult } from './otp-provider.js';
import { AppError } from '../../utils/app-error.js';
import { normalizePhone } from '../../utils/phone.js';

/**
 * Temporary OTP provider for INTERNAL TESTING ONLY, until the real
 * Tencent SMS provider is wired (TencentOtpProvider is currently a
 * stub that throws 501). Gated by OTP_PROVIDER=internal_test.
 *
 * Behaviour:
 *   - Phone numbers on the allowlist: accepted. No SMS is sent — the
 *     service uses the fixed OTP_TEST_FIXED_CODE for allowlisted
 *     numbers (see OtpService.generateCode), which testers already
 *     know, so there is nothing to deliver.
 *   - Any other number: REJECTED with 403. Real users cannot log in
 *     through this provider — that is the entire point. It is NOT a
 *     blanket mock; only the explicitly listed test phones work.
 *
 * Guard rails (enforced in env.ts validateProductionEnv): the
 * allowlist must be non-empty and the fixed code must match
 * OTP_CODE_LENGTH, so a misconfigured prod can't silently degrade
 * into "anyone logs in" or "nobody logs in".
 *
 * Switch back to real SMS by setting OTP_PROVIDER=tencent once the
 * Tencent provider is implemented + credentialed.
 */
export class InternalTestOtpProvider implements OtpProvider {
  constructor(private readonly allowlist: ReadonlySet<string>) {}

  async sendCode(input: {
    phoneNumber: string;
    code: string;
    ttlMinutes: number;
    requestId: string;
  }): Promise<OtpSendResult> {
    // Compare in canonical form: the allowlist handed in by OtpService
    // is already normalized, and the inbound number may arrive bare or
    // +86 — normalizePhone collapses both to the same key so config and
    // client format can't silently disagree.
    if (!this.allowlist.has(normalizePhone(input.phoneNumber))) {
      // Reject non-allowlisted numbers outright so this provider can
      // never be used as a blanket login bypass for real users.
      throw new AppError('该手机号不在内部测试白名单内，暂未开放短信登录', 403);
    }
    return {
      provider: 'internal_test',
      requestId: input.requestId,
      sentTo: input.phoneNumber,
      // Deliberately NOT echoing the code back over the wire.
      // Allowlisted testers use the agreed fixed code
      // (OTP_TEST_FIXED_CODE).
    };
  }
}
