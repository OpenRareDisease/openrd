import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../utils/app-error.js';

// Hoisted so the vi.mock factory below can reference it (vi.mock is
// itself hoisted above the imports).
const { mockSendSms } = vi.hoisted(() => ({ mockSendSms: vi.fn() }));

vi.mock('tencentcloud-sdk-nodejs-sms', () => ({
  sms: {
    v20210111: {
      Client: vi.fn(() => ({ SendSms: mockSendSms })),
    },
  },
}));

const { TencentOtpProvider } = await import('./tencent-otp-provider.js');

const config = {
  secretId: 'test-secret-id',
  secretKey: 'test-secret-key',
  sdkAppId: '1400006666',
  signName: '测试签名',
  templateId: '1110',
  region: 'ap-guangzhou',
};

describe('TencentOtpProvider', () => {
  beforeEach(() => {
    mockSendSms.mockReset();
  });

  it('sends with [code, ttlMinutes] params and returns tencent without echoing the code', async () => {
    mockSendSms.mockResolvedValue({
      SendStatusSet: [{ Code: 'Ok', Message: 'send success', SerialNo: '5000:1' }],
      RequestId: 'tc-req-1',
    });
    const provider = new TencentOtpProvider(config);

    const result = await provider.sendCode({
      phoneNumber: '13922220001',
      code: '113355',
      ttlMinutes: 10,
      requestId: 'req-1',
    });

    // The template has exactly 2 variables: {1}=code, {2}=ttl minutes.
    expect(mockSendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        PhoneNumberSet: ['+8613922220001'],
        SmsSdkAppId: '1400006666',
        SignName: '测试签名',
        TemplateId: '1110',
        TemplateParamSet: ['113355', '10'],
      }),
    );
    expect(result.provider).toBe('tencent');
    expect(result.sentTo).toBe('+8613922220001');
    expect(result.requestId).toBe('req-1');
    // The code must NEVER be echoed back over the wire.
    expect(result.mockCode).toBeUndefined();
  });

  it('throws 502 when the SendSms call rejects (network / SDK / signature error)', async () => {
    mockSendSms.mockRejectedValue(new Error('network unreachable'));
    const provider = new TencentOtpProvider(config);

    await expect(
      provider.sendCode({
        phoneNumber: '+8613922220001',
        code: '113355',
        ttlMinutes: 10,
        requestId: 'req-2',
      }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws 502 when a per-number status is not Ok (blacklist / rate-limit / template mismatch)', async () => {
    mockSendSms.mockResolvedValue({
      SendStatusSet: [
        {
          Code: 'FailedOperation.TemplateParamSetNotMatchApprovedTemplate',
          Message: 'request content does not match the template content',
        },
      ],
      RequestId: 'tc-req-3',
    });
    const provider = new TencentOtpProvider(config);

    await expect(
      provider.sendCode({
        phoneNumber: '+8613922220001',
        code: '113355',
        ttlMinutes: 10,
        requestId: 'req-3',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('normalizes a bare 11-digit number to +86 E.164 before sending', async () => {
    mockSendSms.mockResolvedValue({ SendStatusSet: [{ Code: 'Ok' }], RequestId: 'tc-req-4' });
    const provider = new TencentOtpProvider(config);

    const result = await provider.sendCode({
      phoneNumber: '13800000000',
      code: '123456',
      ttlMinutes: 5,
      requestId: 'req-4',
    });

    expect(result.sentTo).toBe('+8613800000000');
    expect(mockSendSms).toHaveBeenCalledWith(
      expect.objectContaining({ PhoneNumberSet: ['+8613800000000'] }),
    );
  });
});
