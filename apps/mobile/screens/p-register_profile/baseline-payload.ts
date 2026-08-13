import type { BaselineProfilePayload } from '../../lib/api';

/**
 * Does this baseline payload actually carry 敏感个人信息?
 *
 * WHY THIS QUESTION HAS TO BE ASKED AT ALL
 * ----------------------------------------
 * `PUT /profiles/me/baseline` sits behind `requireSensitiveDataConsent`
 * (see apps/api/src/modules/patient-profile/profile.routes.ts), because
 * the baseline is where diagnosis type, D4Z4 repeat count, haplotype
 * and methylation live — the exact fields the privacy policy names as
 * 敏感个人信息 needing PIPL Art. 29 单独同意.
 *
 * But onboarding mode renders only 姓名 / 出生日期 / 性别; the whole
 * FSHD-background section is hidden. It still assembled and sent a
 * baseline whose every clinical field was null, which meant a
 * brand-new user was shown the genetic-data consent document — and
 * blocked from creating a profile at all if they declined — in order
 * to store nothing. The root layout's onboarding gate bounces a
 * profile-less user back to that form, so 「暂不同意」 was not a
 * decision a first-run user could survive: it left them permanently
 * outside the app.
 *
 * The gate's own docstring says the ask should land「at the point where
 * the question is concrete rather than hypothetical」. This function is
 * how the registration form honours that: ask when the payload really
 * contains health data, and skip both the ask and the write when it
 * does not. Filling in the FSHD-background section, or uploading a
 * report, still asks — those *are* concrete.
 *
 * FAIL-CLOSED BY CONSTRUCTION
 * ---------------------------
 * Only the five identity fields below are treated as non-clinical.
 * Everything else in the payload — including any field added to
 * `BaselineProfilePayload` later — counts as health data, so a new
 * field cannot quietly slip past the consent ask by being unlisted.
 * `false` and `0` count as present: 「不能独立行走」is an answer, not a
 * blank.
 */
const NON_CLINICAL_FOUNDATION_KEYS = new Set([
  'fullName',
  'preferredName',
  'birthYear',
  'ageBand',
  'regionLabel',
]);

const isPresent = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isPresent);
  if (typeof value === 'object') return Object.values(value).some(isPresent);
  // Numbers and booleans — including 0 and false — are answers.
  return true;
};

export const baselineCarriesHealthData = (payload: BaselineProfilePayload): boolean => {
  const { foundation, ...rest } = payload;

  if (foundation) {
    for (const [key, value] of Object.entries(foundation)) {
      if (NON_CLINICAL_FOUNDATION_KEYS.has(key)) continue;
      if (isPresent(value)) return true;
    }
  }

  return isPresent(rest);
};
