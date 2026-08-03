import { GUARDIAN_CONSENT_AGE } from './legal.constants.js';

/**
 * Whether a date of birth puts the patient under 14, computed HERE.
 *
 * The mobile app has its own copy of this rule, and that is fine as a
 * UX affordance — but it reads `new Date()` from the handset, and a
 * device clock is user-settable. A patient (or a parent avoiding a
 * consent step) who sets the date forward walks past the client gate
 * with nothing recorded. The API therefore recomputes from its own
 * clock and refuses; the client's copy exists to ask the question
 * politely, this one exists to make the answer binding.
 *
 * Counted in whole years, the way 周岁 works: a child turns 14 on their
 * birthday, not at any point before it. Done on calendar fields rather
 * than by dividing a millisecond difference, which is off by a day for
 * anyone whose life span crosses a different number of leap days than
 * the average.
 */
export const ageInYearsUtc = (dateOfBirth: string, now: Date = new Date()): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Round-trip to reject 2026-02-30, which would otherwise roll forward
  // into March and age the patient by a day.
  const born = new Date(Date.UTC(year, month - 1, day));
  if (
    born.getUTCFullYear() !== year ||
    born.getUTCMonth() !== month - 1 ||
    born.getUTCDate() !== day
  ) {
    return null;
  }

  let age = now.getUTCFullYear() - year;
  const hadBirthday =
    now.getUTCMonth() > month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  if (!hadBirthday) age -= 1;
  return age;
};

/**
 * Returns false for an unparseable date rather than true.
 *
 * The schema validates the format before this runs, so an unparseable
 * value here means a request that will be rejected anyway — and
 * demanding guardian consent for a malformed date would produce a 403
 * that no amount of consenting could clear. A FUTURE date yields a
 * negative age and so does require consent: that is not a real birth
 * date, and asking is the safe side of the mistake.
 */
export const requiresGuardianConsent = (dateOfBirth: string, now?: Date): boolean => {
  const age = ageInYearsUtc(dateOfBirth, now);
  if (age === null) return false;
  return age < GUARDIAN_CONSENT_AGE;
};
