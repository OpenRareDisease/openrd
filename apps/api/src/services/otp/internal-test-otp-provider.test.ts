import { describe, expect, it } from 'vitest';

import { InternalTestOtpProvider } from './internal-test-otp-provider.js';
import { AppError } from '../../utils/app-error.js';

describe('InternalTestOtpProvider', () => {
  const allowlist = new Set(['+8613800000000', '+8613900000001']);
  const provider = new InternalTestOtpProvider(allowlist);

  it('accepts an allowlisted number and never echoes the code', async () => {
    const result = await provider.sendCode({
      phoneNumber: '+8613800000000',
      code: '123456',
      ttlMinutes: 10,
      requestId: 'req-1',
    });
    expect(result.provider).toBe('internal_test');
    expect(result.sentTo).toBe('+8613800000000');
    expect(result.requestId).toBe('req-1');
    // The code must NEVER be echoed back over the wire.
    expect(result.mockCode).toBeUndefined();
  });

  it('rejects a non-allowlisted number with 403 (no blanket bypass)', async () => {
    await expect(
      provider.sendCode({
        phoneNumber: '+8613700000099',
        code: '123456',
        ttlMinutes: 10,
        requestId: 'req-2',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects every number when the allowlist is empty', async () => {
    const empty = new InternalTestOtpProvider(new Set());
    await expect(
      empty.sendCode({
        phoneNumber: '+8613800000000',
        code: '123456',
        ttlMinutes: 10,
        requestId: 'req-3',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
