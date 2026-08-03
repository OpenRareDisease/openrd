/**
 * Reading side of the interrupted-registration draft.
 *
 * This lives here rather than inline in p-login_register for one
 * reason: the rules below are the only thing bounding how long an
 * abandoned registration keeps a phone number on the device, and a rule
 * that can only be exercised by rendering the whole auth screen is a
 * rule nobody will notice breaking. The key itself and the window are
 * in draft-keys.ts, beside every other patient-scoped key.
 *
 * The three cases that matter, in order of how they actually happen:
 *
 *  - Expired. Nothing runs while the app is closed, so expiry is
 *    enforced on read. `parseRegisterDraft` returns null and the caller
 *    deletes the key — the draft is not merely hidden, it is gone.
 *  - No `savedAt` at all. That is a draft written by a build from
 *    before the window existed, i.e. exactly the devices already
 *    carrying an unbounded number. Treated as expired, not as fresh,
 *    so the fix reaches them on the next open instead of grandfathering
 *    the leak forever.
 *  - Pre-slim shape. Early drafts carried the removed profile fields
 *    (fullName, region…). Fields are picked explicitly rather than
 *    spread, or those would be smuggled back into state and re-persisted
 *    for ever.
 *
 * Nothing secret is ever in here to begin with: the persist side strips
 * password / confirmPassword / code / otpRequestId before writing. A
 * mobile number is still 个人信息 on its own, which is what the window
 * is for.
 */

export type RegisterDraftIdentity = 'doctor' | 'patient_family' | 'other';

export interface RegisterDraft {
  phone: string;
  identity: RegisterDraftIdentity | null;
  /** When the number was first typed — see draft-keys.ts. */
  savedAt: number;
}

const isIdentity = (value: unknown): value is RegisterDraftIdentity =>
  value === 'doctor' || value === 'patient_family' || value === 'other';

/**
 * Parse a stored draft, or null if there is nothing usable to restore.
 *
 * A null return always means「delete the key」, never「leave it and try
 * again later」: a draft we refuse to show is a draft with no owner.
 * `now` and `maxAgeMs` are parameters rather than reads of Date.now()
 * so the window is testable without faking the clock.
 */
export const parseRegisterDraft = (
  raw: string | null,
  { now, maxAgeMs }: { now: number; maxAgeMs: number },
): RegisterDraft | null => {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A broken draft must never block registration.
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const draft = parsed as Record<string, unknown>;

  const savedAt =
    typeof draft.savedAt === 'number' && Number.isFinite(draft.savedAt) ? draft.savedAt : null;
  if (savedAt === null || now - savedAt > maxAgeMs) return null;

  const phone = typeof draft.phone === 'string' ? draft.phone.trim() : '';
  // A draft with no number has nothing to restore. `identity` is a
  // three-value enum and is not worth keeping a storage entry alive on
  // its own.
  if (!phone) return null;

  return {
    phone,
    identity: isIdentity(draft.identity) ? draft.identity : null,
    savedAt,
  };
};
