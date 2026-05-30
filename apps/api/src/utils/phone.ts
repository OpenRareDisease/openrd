/**
 * Normalize a phone number to the system's canonical form, so the
 * internal-test allowlist (operator config) and inbound numbers compare
 * equal regardless of whether the +86 country code was typed.
 *
 * This MUST mirror the mobile client's `formatPhoneNumber`
 * (apps/mobile/screens/p-login_register/index.tsx). The app sends every
 * number with a leading `+86` (or an explicit `+<cc>`); the bare digits
 * an operator naturally writes in OTP_TEST_PHONE_ALLOWLIST would never
 * string-equal that. If the two rules ever drift, the allowlist
 * silently stops matching real logins — exactly the bug this fixes
 * (operator set `13922220001`, the client sent `+8613922220001`, and
 * the strict Set.has() in the internal-test provider rejected it as
 * "not on the allowlist").
 *
 * Rules (identical to the client):
 *   - empty / whitespace-only -> '' (callers guard; never allowlisted)
 *   - already starts with '+' (explicit country code) -> kept as-is
 *   - otherwise -> assume mainland China, prepend '+86'
 */
export const normalizePhone = (phone: string): string => {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed;
  return `+86${trimmed}`;
};
