import { describe, expect, it } from 'vitest';

import {
  AUDIT_IDENTITY_KEYS,
  maskAuditEmail,
  maskAuditIdentifier,
  maskAuditIp,
  maskAuditPayload,
  maskAuditPhone,
} from './identity-masking.js';

describe('maskAuditPhone', () => {
  it('keeps the head and tail of an app-stored +86 number', () => {
    expect(maskAuditPhone('+8613922220001')).toBe('+86****0001');
  });

  it('handles the bare-digit form a user might type', () => {
    expect(maskAuditPhone('13922220001')).toBe('139****0001');
  });

  it('is idempotent, so masking an already-masked value is harmless', () => {
    // OtpService masks at the call site AND at the write boundary; if
    // this were not idempotent that double pass would corrupt the value.
    expect(maskAuditPhone(maskAuditPhone('+8613922220001'))).toBe('+86****0001');
    expect(maskAuditPhone(maskAuditPhone('13922220001'))).toBe('139****0001');
  });

  it('does not leak a short value through unmasked', () => {
    expect(maskAuditPhone('1234')).toBe('****');
  });

  it('maps empty and missing values to null rather than a fake mask', () => {
    expect(maskAuditPhone(null)).toBeNull();
    expect(maskAuditPhone(undefined)).toBeNull();
    expect(maskAuditPhone('   ')).toBeNull();
  });
});

describe('maskAuditEmail', () => {
  it('keeps one initial and the domain', () => {
    expect(maskAuditEmail('zhangsan@example.com')).toBe('z***@example.com');
  });

  it('masks anything that is not a parseable address wholesale', () => {
    // The failure mode this guards: a phone number or a full name
    // landing in the email field and being passed through untouched.
    expect(maskAuditEmail('13922220001')).toBe('****');
    expect(maskAuditEmail('@example.com')).toBe('****');
    expect(maskAuditEmail('user@')).toBe('****');
  });
});

describe('maskAuditIdentifier', () => {
  it('picks the mask by shape, since the login form accepts either', () => {
    expect(maskAuditIdentifier('zhangsan@example.com')).toBe('z***@example.com');
    expect(maskAuditIdentifier('+8613922220001')).toBe('+86****0001');
  });
});

describe('maskAuditIp', () => {
  it('truncates IPv4 to a /24 so brute-force correlation still works', () => {
    expect(maskAuditIp('203.0.113.47')).toBe('203.0.113.0/24');
  });

  it('unwraps the ::ffff: form Node reports on a dual-stack socket', () => {
    expect(maskAuditIp('::ffff:203.0.113.47')).toBe('203.0.113.0/24');
  });

  it('truncates IPv6 to a /48', () => {
    expect(maskAuditIp('2001:db8:1:2::5')).toBe('2001:db8:1::/48');
  });

  it('masks an unrecognised value rather than passing it through', () => {
    expect(maskAuditIp('not-an-ip')).toBe('****');
    expect(maskAuditIp(null)).toBeNull();
  });
});

describe('maskAuditPayload', () => {
  it('masks every identifier key and leaves the rest alone', () => {
    expect(
      maskAuditPayload({
        userId: 'u-1',
        phoneNumber: '+8613922220001',
        email: 'zhangsan@example.com',
        identifier: '+8613922220001',
        ip: '203.0.113.47',
        reason: 'invalid_password',
      }),
    ).toEqual({
      userId: 'u-1',
      phoneNumber: '+86****0001',
      email: 'z***@example.com',
      identifier: '+86****0001',
      ip: '203.0.113.0/24',
      reason: 'invalid_password',
    });
  });

  it('never widens the payload with keys the caller did not send', () => {
    expect(maskAuditPayload({ reason: 'exists' })).toEqual({ reason: 'exists' });
  });

  it('does not mutate the caller-supplied object', () => {
    const original = { phoneNumber: '+8613922220001' };
    maskAuditPayload(original);
    expect(original.phoneNumber).toBe('+8613922220001');
  });
});

describe('AUDIT_IDENTITY_KEYS', () => {
  it('covers every key maskAuditPayload rewrites, plus userAgent', () => {
    // The account-deletion tombstone strips exactly this list. A key
    // masked at write time but missing here would survive the erasure
    // the deletion ledger claims happened.
    expect([...AUDIT_IDENTITY_KEYS]).toEqual([
      'phoneNumber',
      'email',
      'identifier',
      'ip',
      'userAgent',
    ]);
  });
});
