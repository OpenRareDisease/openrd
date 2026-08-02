/**
 * Is this patient young enough that PIPL Art. 31 applies?
 *
 * Pure and separately tested because the failure is silent in both
 * directions and neither is acceptable: a rule that runs late asks a
 * 15-year-old's parent for consent they do not owe, and a rule that
 * runs early lets a 13-year-old's record be created with nobody having
 * consented for them. Neither shows up as an error at runtime.
 *
 * "Under 14" is counted in whole years elapsed, the way 周岁 works —
 * a child turns 14 on their birthday, not at any point before it.
 * Computed on calendar fields rather than by dividing a millisecond
 * difference, which is off by a day for anyone whose life span crosses
 * a different number of leap days than the average, and which a DST
 * transition can push over a boundary.
 */
export const GUARDIAN_CONSENT_AGE = 14;

/** `YYYY-MM-DD` -> whole years elapsed, or null if unparseable. */
export const ageInYears = (dateOfBirth: string, now: Date = new Date()): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Round-trip through Date to reject 2026-02-30 and friends, which
  // would otherwise roll forward into March and quietly age the patient
  // by a day.
  const born = new Date(year, month - 1, day);
  if (born.getFullYear() !== year || born.getMonth() !== month - 1 || born.getDate() !== day) {
    return null;
  }

  let age = now.getFullYear() - year;
  const hasHadBirthday =
    now.getMonth() > month - 1 || (now.getMonth() === month - 1 && now.getDate() >= day);
  if (!hasHadBirthday) age -= 1;
  return age;
};

/**
 * Whether the registration form must collect a guardian's consent.
 *
 * Returns false for an unparseable date on purpose: the form validates
 * the format before it gets here, and a gate that fired on every
 * half-typed date would flash the guardian document at an adult mid-
 * keystroke. A future date yields a negative age and so returns true —
 * whoever typed 2030 has not entered a real birth date, and asking is
 * the safe side of that mistake.
 */
export const requiresGuardianConsent = (dateOfBirth: string, now: Date = new Date()): boolean => {
  const age = ageInYears(dateOfBirth, now);
  if (age === null) return false;
  return age < GUARDIAN_CONSENT_AGE;
};
