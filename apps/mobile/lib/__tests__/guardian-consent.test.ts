import { ageInYears, requiresGuardianConsent } from '../guardian-consent';

/**
 * The boundary is a legal one, so it is tested as a boundary rather
 * than sampled: the day before the 14th birthday, the birthday itself,
 * and the day after.
 */

const on = (iso: string) => new Date(`${iso}T12:00:00`);

describe('ageInYears', () => {
  it('counts whole years, 周岁-style', () => {
    expect(ageInYears('2012-06-15', on('2026-06-14'))).toBe(13);
    expect(ageInYears('2012-06-15', on('2026-06-15'))).toBe(14);
    expect(ageInYears('2012-06-15', on('2026-06-16'))).toBe(14);
  });

  it('handles a 29 February birth date in a non-leap year', () => {
    // Born on a leap day; in 2026 (not a leap year) the 14th birthday
    // is reached on 1 March by the 周岁 reading used here.
    expect(ageInYears('2012-02-29', on('2026-02-28'))).toBe(13);
    expect(ageInYears('2012-02-29', on('2026-03-01'))).toBe(14);
  });

  it('rejects dates that do not exist rather than rolling them forward', () => {
    expect(ageInYears('2026-02-30')).toBeNull();
    expect(ageInYears('2026-13-01')).toBeNull();
    expect(ageInYears('2026-00-10')).toBeNull();
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(ageInYears('')).toBeNull();
    expect(ageInYears('2012/06/15')).toBeNull();
    expect(ageInYears('2012-6-5')).toBeNull();
    expect(ageInYears('yesterday')).toBeNull();
  });
});

describe('requiresGuardianConsent', () => {
  it('is true up to and excluding the 14th birthday', () => {
    expect(requiresGuardianConsent('2012-06-15', on('2026-06-14'))).toBe(true);
    expect(requiresGuardianConsent('2012-06-15', on('2026-06-15'))).toBe(false);
  });

  it('is true for an infant — FSHD has infantile-onset forms', () => {
    expect(requiresGuardianConsent('2025-01-01', on('2026-08-02'))).toBe(true);
  });

  it('is false for an adult', () => {
    expect(requiresGuardianConsent('1985-03-20', on('2026-08-02'))).toBe(false);
  });

  it('asks when the date is in the future, which is a typo either way', () => {
    expect(requiresGuardianConsent('2030-01-01', on('2026-08-02'))).toBe(true);
  });

  it('does not fire on a half-typed date', () => {
    // The form validates the format first; flashing the guardian
    // document mid-keystroke at an adult would be worse than waiting.
    expect(requiresGuardianConsent('20', on('2026-08-02'))).toBe(false);
    expect(requiresGuardianConsent('', on('2026-08-02'))).toBe(false);
  });
});
