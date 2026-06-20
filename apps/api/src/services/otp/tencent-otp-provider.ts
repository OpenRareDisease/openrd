import { sms } from 'tencentcloud-sdk-nodejs-sms';

import type { OtpProvider, OtpSendResult } from './otp-provider.js';
import type { AppLogger } from '../../config/logger.js';
import { AppError } from '../../utils/app-error.js';
import { normalizePhone } from '../../utils/phone.js';

const SmsClient = sms.v20210111.Client;

export interface TencentOtpConfig {
  secretId: string;
  secretKey: string;
  sdkAppId: string;
  signName: string;
  templateId: string;
  region: string;
}

/**
 * Real OTP delivery via the Tencent Cloud SendSms API (v2021-01-11),
 * activated by OTP_PROVIDER=tencent. `env.ts#validateProductionEnv`
 * guarantees every credential below is present before this is
 * constructed, so the constructor can assume them non-empty.
 *
 * The approved SMS template MUST have exactly two variables:
 *   {1} = the verification code
 *   {2} = the TTL in minutes
 * matching the `TemplateParamSet: [code, String(ttlMinutes)]` sent
 * below. A template with a different number of variables is rejected by
 * Tencent with `FailedOperation.TemplateParamSetNotMatchApprovedTemplate`.
 */
export class TencentOtpProvider implements OtpProvider {
  private readonly client: InstanceType<typeof SmsClient>;
  private readonly sdkAppId: string;
  private readonly signName: string;
  private readonly templateId: string;
  private readonly logger?: AppLogger;

  constructor(config: TencentOtpConfig, logger?: AppLogger) {
    this.client = new SmsClient({
      credential: { secretId: config.secretId, secretKey: config.secretKey },
      region: config.region,
      profile: {
        httpProfile: {
          endpoint: 'sms.tencentcloudapi.com',
          // Bound the call (seconds) so a stuck SendSms can't hang the
          // login request indefinitely. 10s is generous for one SMS.
          reqTimeout: 10,
        },
      },
    });
    this.sdkAppId = config.sdkAppId;
    this.signName = config.signName;
    this.templateId = config.templateId;
    this.logger = logger;
  }

  async sendCode(input: {
    phoneNumber: string;
    code: string;
    ttlMinutes: number;
    requestId: string;
  }): Promise<OtpSendResult> {
    // Tencent wants E.164 (+8613…). normalizePhone yields the same
    // canonical form the rest of the system uses (and the mobile client
    // already sends), so a bare 11-digit number also works.
    const phoneNumber = normalizePhone(input.phoneNumber);

    let response: Awaited<ReturnType<InstanceType<typeof SmsClient>['SendSms']>>;
    try {
      response = await this.client.SendSms({
        PhoneNumberSet: [phoneNumber],
        SmsSdkAppId: this.sdkAppId,
        SignName: this.signName,
        TemplateId: this.templateId,
        // Template variables, in order: {1} = code, {2} = TTL minutes.
        TemplateParamSet: [input.code, String(input.ttlMinutes)],
      });
    } catch (error) {
      // SDK-level failure: never reached Tencent, signature error, or a
      // top-level API error. Log internally; never surface the raw error
      // (it can carry credentials / internals) to the caller.
      this.logger?.error({ error, requestId: input.requestId }, 'Tencent SendSms call failed');
      throw new AppError('短信发送失败，请稍后重试', 502);
    }

    // A 200-level call can still report a PER-NUMBER failure
    // (Code !== 'Ok') — blacklist, rate limit, template mismatch, etc.
    // Treat anything but 'Ok' as a failed send.
    const status = response?.SendStatusSet?.[0];
    if (!status || status.Code !== 'Ok') {
      this.logger?.error(
        {
          requestId: input.requestId,
          tencentCode: status?.Code,
          tencentMessage: status?.Message,
          tencentRequestId: response?.RequestId,
        },
        'Tencent SendSms rejected the message',
      );
      throw new AppError('短信发送失败，请稍后重试', 502);
    }

    return {
      provider: 'tencent',
      requestId: input.requestId,
      sentTo: phoneNumber,
      // Deliberately NOT echoing the code back over the wire.
    };
  }
}
