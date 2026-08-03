/**
 * Identifier masking for `audit_logs` payloads.
 *
 * Two things made this its own module rather than a private helper.
 *
 * 1. The codebase was already half-doing it. `otp.service.ts` wrote
 *    `maskPhone(phoneNumber)` into audit_logs while `auth.service.ts`
 *    wrote the raw number into the same table, so whether a patient's
 *    phone number was stored in the clear depended on which endpoint
 *    they touched. One implementation, imported by both, is the only
 *    way that stays true.
 *
 * 2. Erasure has to agree with it. `purgeDueAccountDeletions` tombstones
 *    audit rows on account deletion, and it needs to know exactly which
 *    keys hold identifiers — see AUDIT_IDENTITY_KEYS below.
 *
 * These are *masks*, not hashes: they are deliberately not reversible
 * and deliberately not a lookup key. Recovering "which account was
 * this" from an audit row is not a capability this table should have.
 */

/**
 * `+8613922220001` → `+86****0001`, `13922220001` → `139****0001`.
 *
 * Keeps enough to correlate rows within one incident (the same masked
 * value means the same number) and to answer a support ticket where the
 * user reads their own number out, without leaving a dialable number in
 * a table that has no retention limit and no access control beyond
 * `psql`.
 */
export const maskAuditPhone = (phone: string | null | undefined): string | null => {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= 4) return '****';
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
};

/**
 * `zhangsan@example.com` → `z***@example.com`.
 *
 * The domain survives on purpose: it is what makes a burst of
 * registrations from one throwaway mail provider visible, and a domain
 * on its own identifies nobody. Anything that does not parse as an
 * address is masked wholesale rather than passed through — a malformed
 * value is exactly the case where an unexpected string (a pasted phone
 * number, a full name) ends up in the email field.
 */
export const maskAuditEmail = (email: string | null | undefined): string | null => {
  if (!email) return null;
  const trimmed = email.trim();
  if (trimmed.length === 0) return null;
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return '****';
  return `${trimmed.slice(0, 1)}***${trimmed.slice(at)}`;
};

/**
 * The login/registration audit rows accept either a phone number or an
 * email in the same `identifier` field, so mask on shape.
 */
export const maskAuditIdentifier = (identifier: string | null | undefined): string | null => {
  if (!identifier) return null;
  return identifier.includes('@') ? maskAuditEmail(identifier) : maskAuditPhone(identifier);
};

/**
 * `203.0.113.47` → `203.0.113.0/24`, `2001:db8:1:2::5` → `2001:db8:1::/48`.
 *
 * Truncated rather than dropped. The reason these rows record an IP at
 * all is credential-stuffing detection —「40 failed logins, same
 * source」 — and a network prefix answers that question just as well as
 * a host address while no longer being a personal identifier under
 * PIPL. A full client IP in an unbounded audit table is a location
 * history nobody asked for.
 */
export const maskAuditIp = (ip: string | null | undefined): string | null => {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (trimmed.length === 0) return null;
  // Node reports IPv4 peers over a dual-stack socket as ::ffff:a.b.c.d.
  const v4 = trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
  const v4Parts = v4.split('.');
  if (v4Parts.length === 4 && v4Parts.every((part) => /^\d{1,3}$/.test(part))) {
    return `${v4Parts[0]}.${v4Parts[1]}.${v4Parts[2]}.0/24`;
  }
  if (trimmed.includes(':')) {
    const groups = trimmed.split(':').slice(0, 3);
    if (groups.length === 3 && groups.every((group) => group.length > 0)) {
      return `${groups.join(':')}::/48`;
    }
  }
  return '****';
};

/**
 * Browser and platform families, longest-specific first.
 *
 * Order is load-bearing twice over. Every Chromium browser ships
 * Chrome's *and* Safari's tokens, so Edge/Opera/Samsung/WeChat have to
 * be tested before Chrome and Chrome before Safari; and an Android UA
 * carries `Linux`, so Android has to be tested before it. Getting that
 * backwards does not throw — it just quietly relabels every Edge user
 * as Chrome, which is the kind of wrong that is never noticed.
 *
 * Each entry matches its raw token OR the label itself, which is what
 * makes the mask idempotent: `maskAuditUserAgent('Chrome on Android')`
 * has to come back 「Chrome on Android」, because OtpService already
 * masks at the call site AND at the write boundary and the same double
 * pass will eventually be applied here.
 */
const UA_BROWSER_FAMILIES: ReadonlyArray<readonly [token: string, label: string]> = [
  ['Edg', 'Edge'],
  ['OPR', 'Opera'],
  ['SamsungBrowser', 'Samsung Internet'],
  ['MicroMessenger', 'WeChat'],
  ['QQBrowser', 'QQ Browser'],
  ['UCBrowser', 'UC Browser'],
  ['Firefox', 'Firefox'],
  ['Chrome', 'Chrome'],
  ['Safari', 'Safari'],
];

const UA_PLATFORM_FAMILIES: ReadonlyArray<readonly [tokens: readonly string[], label: string]> = [
  [['Windows'], 'Windows'],
  [['Android'], 'Android'],
  [['iPhone', 'iPad', 'iPod', 'iOS'], 'iOS'],
  [['Macintosh', 'Mac OS X', 'macOS'], 'macOS'],
  [['Linux'], 'Linux'],
];

/** A product token we are willing to keep verbatim for a non-browser
 *  client: a name, not a build string. Capped so a caller cannot use
 *  the field as free storage. */
const UA_PRODUCT_PATTERN = /^[A-Za-z][A-Za-z0-9 ._-]{0,31}$/;

/**
 * `Mozilla/5.0 (Linux; Android 13; SM-G991B) … Chrome/126.0.0.0 …` →
 * `Chrome on Android`. `okhttp/4.9.0` → `okhttp`.
 *
 * A full User-Agent is a device fingerprint: the build number, the
 * exact patch version and — on Android — the phone model (`SM-G991B`)
 * are together narrow enough to single out one person's handset across
 * unrelated rows. Two families and nothing else answers the question
 * these rows exist to answer (「这些失败登录来自同一种客户端吗」)
 * without carrying that.
 *
 * This one matters beyond its own merits. `purgeDueAccountDeletions`
 * can only tombstone audit rows it can match back to the account, and
 * the OTP and failed-login rows carry no `userId` and only a masked
 * phone — so they are never matched, and account-deletion.ts justifies
 * that with 「rows written after that carry only a masked value, which
 * is already pseudonymous」. That sentence was false for as long as
 * `userAgent` sat in the payload raw: a deleted account's exact device
 * string survived its own erasure for the rest of the 180-day
 * retention window. Masking here is what makes the erasure argument
 * true, which is why it is not optional.
 */
export const maskAuditUserAgent = (userAgent: string | null | undefined): string | null => {
  if (!userAgent) return null;
  const trimmed = userAgent.trim();
  if (trimmed.length === 0) return null;

  const browser = UA_BROWSER_FAMILIES.find(
    ([token, label]) => trimmed.includes(token) || trimmed.includes(label),
  )?.[1];
  const platform = UA_PLATFORM_FAMILIES.find(
    ([tokens, label]) => tokens.some((token) => trimmed.includes(token)) || trimmed.includes(label),
  )?.[1];

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;

  // Non-browser callers — okhttp, curl, python-requests, a health
  // prober — keep their product name and lose the version, because
  // 「forty failed logins, all from python-requests」 is exactly the
  // shape this table is read for. Anything that does not look like a
  // product name is masked wholesale rather than passed through.
  const product = trimmed.split('/')[0].trim();
  return UA_PRODUCT_PATTERN.test(product) ? product : '****';
};

/**
 * Every `event_payload` key that can hold a direct identifier.
 *
 * `purgeDueAccountDeletions` strips exactly these when it tombstones a
 * deleted account's audit rows, so a new identifying field added to an
 * audit payload MUST be added here in the same change — otherwise it
 * silently survives the erasure the deletion ledger claims happened.
 * Deliberately excludes `userId`: after `app_users` is gone that UUID
 * resolves to nothing, and keeping it is what lets an auditor still see
 * that N failed logins belonged to one account rather than N.
 *
 * Stays a literal `as const` tuple because account-deletion.ts
 * interpolates it straight into the jsonb `-` operator, which takes a
 * key literal and not a bind slot.
 */
export const AUDIT_IDENTITY_KEYS = [
  'phoneNumber',
  'email',
  'identifier',
  'ip',
  'userAgent',
] as const;

export type AuditIdentityKey = (typeof AUDIT_IDENTITY_KEYS)[number];

/**
 * The mask each declared identity key is rewritten by.
 *
 * `Record<AuditIdentityKey, …>` is the whole point of this table. As
 * first written, AUDIT_IDENTITY_KEYS listed `userAgent` and
 * `maskAuditPayload` had a hand-written `if` chain that did not — so
 * the list claimed a key was masked while every audit row stored the
 * raw device string, and the two sat fifteen lines apart in this file,
 * each looking complete. Now adding a key to the tuple without adding
 * its mask here is a compile error, and dropping the mask without
 * dropping the key is one too.
 */
const AUDIT_IDENTITY_MASKS: Record<
  AuditIdentityKey,
  (value: string | null | undefined) => string | null
> = {
  phoneNumber: maskAuditPhone,
  email: maskAuditEmail,
  identifier: maskAuditIdentifier,
  ip: maskAuditIp,
  userAgent: maskAuditUserAgent,
};

/**
 * Mask the identifier-bearing keys of an `audit_logs` payload, leaving
 * everything else untouched.
 *
 * Every INSERT into audit_logs goes through this — both AuthService and
 * OtpService call it from their own `logAudit`. Applying it at the
 * write boundary rather than at each of the dozen call sites is the
 * point: a new audit row added next year is masked without its author
 * having to know that it should be.
 *
 * A key that is absent stays absent (rather than becoming an explicit
 * null), so this never widens a payload.
 */
export const maskAuditPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
  const masked: Record<string, unknown> = { ...payload };
  for (const key of AUDIT_IDENTITY_KEYS) {
    if (key in masked) {
      masked[key] = AUDIT_IDENTITY_MASKS[key](masked[key] as string | null | undefined);
    }
  }
  return masked;
};
