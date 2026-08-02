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
 * Every `event_payload` key that can hold a direct identifier.
 *
 * `purgeDueAccountDeletions` strips exactly these when it tombstones a
 * deleted account's audit rows, so a new identifying field added to an
 * audit payload MUST be added here in the same change — otherwise it
 * silently survives the erasure the deletion ledger claims happened.
 * Deliberately excludes `userId`: after `app_users` is gone that UUID
 * resolves to nothing, and keeping it is what lets an auditor still see
 * that N failed logins belonged to one account rather than N.
 */
export const AUDIT_IDENTITY_KEYS = [
  'phoneNumber',
  'email',
  'identifier',
  'ip',
  'userAgent',
] as const;

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
  if ('phoneNumber' in masked) {
    masked.phoneNumber = maskAuditPhone(masked.phoneNumber as string | null | undefined);
  }
  if ('email' in masked) {
    masked.email = maskAuditEmail(masked.email as string | null | undefined);
  }
  if ('identifier' in masked) {
    masked.identifier = maskAuditIdentifier(masked.identifier as string | null | undefined);
  }
  if ('ip' in masked) {
    masked.ip = maskAuditIp(masked.ip as string | null | undefined);
  }
  return masked;
};
