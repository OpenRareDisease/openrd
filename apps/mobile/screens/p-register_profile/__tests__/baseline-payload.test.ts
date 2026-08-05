import { baselineCarriesHealthData } from '../baseline-payload';
import type { BaselineProfilePayload } from '../../../lib/api';

/**
 * The payload onboarding mode actually builds: name/birth/region from
 * the three visible fields, and a null for every clinical field
 * because the FSHD-background section is not rendered there.
 */
const onboardingPayload = (): BaselineProfilePayload => ({
  foundation: {
    fullName: '张三',
    birthYear: 1988,
    diagnosisYear: null,
    regionLabel: null,
  },
  diseaseBackground: {
    diagnosisType: null,
    d4z4: null,
    onsetRegion: null,
    familyHistory: null,
  },
  currentStatus: {
    independentlyAmbulatory: null,
    assistiveDevices: [],
  },
});

describe('baselineCarriesHealthData', () => {
  it('says no for the all-null baseline onboarding builds', () => {
    // This is the whole point: PUT /me/baseline is behind
    // requireSensitiveDataConsent, so sending this made a first-run
    // user accept the genetic-data document to store nothing — and the
    // onboarding gate meant declining locked them out of the app.
    expect(baselineCarriesHealthData(onboardingPayload())).toBe(false);
  });

  it('says no when the region label is filled in but nothing clinical is', () => {
    const payload = onboardingPayload();
    payload.foundation!.regionLabel = '上海市 浦东新区';
    expect(baselineCarriesHealthData(payload)).toBe(false);
  });

  it.each([
    ['diagnosisType', { diseaseBackground: { diagnosisType: 'FSHD1' } }],
    ['d4z4', { diseaseBackground: { d4z4: '3/22' } }],
    ['onsetRegion', { diseaseBackground: { onsetRegion: '肩胛带' } }],
    ['familyHistory', { diseaseBackground: { familyHistory: '母亲疑似' } }],
    ['haplotype', { diseaseBackground: { haplotype: '4qA' } }],
    ['assistiveDevices', { currentStatus: { assistiveDevices: ['AFO'] } }],
    ['currentChallenges', { currentChallenges: { fatigue: 3 } }],
    ['notes', { notes: '最近爬楼很吃力' }],
  ])('says yes as soon as %s is present', (_label, patch) => {
    const payload = { ...onboardingPayload(), ...(patch as BaselineProfilePayload) };
    expect(baselineCarriesHealthData(payload)).toBe(true);
  });

  it('treats a diagnosis year as clinical even though it lives under foundation', () => {
    const payload = onboardingPayload();
    payload.foundation!.diagnosisYear = 2022;
    expect(baselineCarriesHealthData(payload)).toBe(true);
  });

  it('counts false and 0 as answers, not as blanks', () => {
    // 「不能独立行走」is the most consequential thing this form
    // records. A truthiness check would have read it as unanswered and
    // written it without ever asking.
    const cannotWalk = onboardingPayload();
    cannotWalk.currentStatus!.independentlyAmbulatory = false;
    expect(baselineCarriesHealthData(cannotWalk)).toBe(true);

    const noPain: BaselineProfilePayload = {
      ...onboardingPayload(),
      currentChallenges: { pain: 0 },
    };
    expect(baselineCarriesHealthData(noPain)).toBe(true);
  });

  it('says yes for a field it has never heard of', () => {
    // Fail-closed: only the five identity keys are exempt, so a field
    // added to BaselineProfilePayload later cannot slip past the
    // consent ask by not being listed anywhere.
    const withFutureField = {
      ...onboardingPayload(),
      someFutureClinicalSection: { value: 'x' },
    } as BaselineProfilePayload;
    expect(baselineCarriesHealthData(withFutureField)).toBe(true);
  });

  it('says no for an empty payload', () => {
    expect(baselineCarriesHealthData({})).toBe(false);
  });
});
