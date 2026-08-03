import { describe, expect, it } from 'vitest';

import {
  AUDIT_IDENTITY_KEYS,
  maskAuditEmail,
  maskAuditIdentifier,
  maskAuditIp,
  maskAuditPayload,
  maskAuditPhone,
  maskAuditUserAgent,
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

const CHROME_WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

describe('maskAuditUserAgent', () => {
  it('keeps the browser and platform family and drops everything else', () => {
    expect(maskAuditUserAgent(CHROME_WINDOWS_UA)).toBe('Chrome on Windows');
    expect(
      maskAuditUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS');
  });

  it('drops the phone model, which is the part that fingerprints one handset', () => {
    // SM-G991B plus a build number is narrow enough to link a person's
    // rows across an audit table they no longer have an account in.
    const androidUa =
      'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36';
    const masked = maskAuditUserAgent(androidUa);
    expect(masked).toBe('Chrome on Android');
    expect(masked).not.toContain('SM-G991B');
    expect(masked).not.toContain('126.0');
  });

  it('tests the Chromium derivatives before Chrome, and Android before Linux', () => {
    // Every Chromium browser carries Chrome's token and Safari's, and
    // an Android UA carries `Linux` — order in the family tables is the
    // only thing keeping Edge from being logged as Chrome.
    expect(
      maskAuditUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68',
      ),
    ).toBe('Edge on Windows');
    expect(
      maskAuditUserAgent(
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Samsung Internet on Android');
  });

  it('keeps a non-browser client identifiable by name, without its version', () => {
    // 「四十次失败登录，全部来自 python-requests」 is precisely what
    // these rows get read for.
    expect(maskAuditUserAgent('okhttp/4.9.0')).toBe('okhttp');
    expect(maskAuditUserAgent('python-requests/2.31.0')).toBe('python-requests');
  });

  it('masks anything that does not look like a product name wholesale', () => {
    expect(maskAuditUserAgent('{"$ne":null}')).toBe('****');
    expect(maskAuditUserAgent('A'.repeat(4096))).toBe('****');
  });

  it('is idempotent, so a double pass at the write boundary is harmless', () => {
    // maskAuditPhone is applied both at OtpService's call site and at
    // the write boundary; the same will happen here eventually.
    for (const ua of [CHROME_WINDOWS_UA, 'okhttp/4.9.0', '{"$ne":null}']) {
      const once = maskAuditUserAgent(ua);
      expect(maskAuditUserAgent(once)).toBe(once);
    }
  });

  it('maps empty and missing values to null rather than a fake mask', () => {
    expect(maskAuditUserAgent(null)).toBeNull();
    expect(maskAuditUserAgent(undefined)).toBeNull();
    expect(maskAuditUserAgent('   ')).toBeNull();
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
        userAgent: CHROME_WINDOWS_UA,
        reason: 'invalid_password',
      }),
    ).toEqual({
      userId: 'u-1',
      phoneNumber: '+86****0001',
      email: 'z***@example.com',
      identifier: '+86****0001',
      ip: '203.0.113.0/24',
      userAgent: 'Chrome on Windows',
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
  it('is the exact list the account-deletion tombstone strips', () => {
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

  // THE TEST THAT WAS MISSING.
  //
  // `userAgent` shipped in this list while maskAuditPayload had no
  // branch for it, so the list declared the key masked and every audit
  // row held the raw device string for 180 days. The old
  // assertion above pinned the list against a hand-written copy of
  // itself and the payload test pinned four keys against four literals
  // — neither could see the gap between them, and the old spec name
  // ('…plus userAgent') even wrote the asymmetry down as expected.
  //
  // This one crosses the two: it drives the declared list through the
  // real masker and demands each key actually change. The fixture is
  // asserted to cover the list first, so adding a sixth key without a
  // sample fails here rather than skipping silently.
  it('transforms every key it declares — the declaration and the masker cannot drift apart', () => {
    const rawSamples: Record<string, string> = {
      phoneNumber: '+8613922220001',
      email: 'zhangsan@example.com',
      identifier: 'zhangsan@example.com',
      ip: '203.0.113.47',
      userAgent: CHROME_WINDOWS_UA,
    };

    expect(Object.keys(rawSamples).sort()).toEqual([...AUDIT_IDENTITY_KEYS].sort());

    for (const key of AUDIT_IDENTITY_KEYS) {
      const raw = rawSamples[key];
      const masked = maskAuditPayload({ [key]: raw })[key];
      expect(masked, `${key} is declared an identity key but reached audit_logs unmasked`).not.toBe(
        raw,
      );
      expect(String(masked)).not.toContain(raw);
    }
  });
});
