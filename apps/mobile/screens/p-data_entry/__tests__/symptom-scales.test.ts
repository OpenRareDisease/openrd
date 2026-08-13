/**
 * 疼痛 / 疲劳 bands and stepper.
 *
 * Two failure modes are pinned here, both of which put a number the
 * patient never gave into a clinical trend:
 *
 *  1. **Unanswered becoming 0.** These fields start empty. 0 on this
 *     scale means「一点都不疼」, which is a strong claim; an empty field
 *     that normalizes to 0 makes it silently, at scale, on every
 *     followup nobody filled in.
 *  2. **The direction inverting.** Sleep on the same screen runs
 *     0=很差→10=很好 and these run 0=没有→10=最重. A band table that
 *     labelled 8 as「轻微」would collect「今天很疼」as a good day.
 */

import {
  FATIGUE_SCALE,
  PAIN_BUCKETS,
  PAIN_SCALE,
  SYMPTOM_GUIDELINE_NOTE,
  SYMPTOM_SCORE_MAX,
  SYMPTOM_SCORE_MIN,
  bucketForScoreIn,
  normalizeSymptomScore,
  stepSymptomScore,
} from '../symptom-scales';

describe('unanswered stays unanswered', () => {
  it('normalizes empty, null, undefined and junk to the empty string', () => {
    for (const value of ['', null, undefined, '   ', 'abc', {}, []]) {
      expect(normalizeSymptomScore(value)).toBe('');
    }
  });

  it('does not turn an unanswered field into 0', () => {
    // The whole point: '' is not 0. 0 is「一点都不疼」.
    expect(normalizeSymptomScore('')).not.toBe('0');
  });

  it('keeps a real 0 as 0', () => {
    expect(normalizeSymptomScore(0)).toBe('0');
    expect(normalizeSymptomScore('0')).toBe('0');
  });

  it('clamps out-of-range values into 0-10', () => {
    expect(normalizeSymptomScore(99)).toBe('10');
    expect(normalizeSymptomScore(-4)).toBe('0');
    expect(normalizeSymptomScore(7.4)).toBe('7');
  });
});

describe('the stepper', () => {
  it('lands on 0 from unanswered in either direction', () => {
    // Not 1: the first + press must be able to record「一点都不疼」,
    // which is the most common honest answer and the one a stepper
    // starting at 1 makes unreachable without a - press.
    expect(stepSymptomScore('', 1)).toBe('0');
    expect(stepSymptomScore('', -1)).toBe('0');
  });

  it('stays inside 0-10', () => {
    expect(stepSymptomScore('10', 1)).toBe(String(SYMPTOM_SCORE_MAX));
    expect(stepSymptomScore('0', -1)).toBe(String(SYMPTOM_SCORE_MIN));
  });

  it('steps by one', () => {
    expect(stepSymptomScore('5', 1)).toBe('6');
    expect(stepSymptomScore('5', -1)).toBe('4');
  });
});

describe('the bands run the right way', () => {
  it('labels 0 as 没有 and 10 as 最重 for pain', () => {
    expect(bucketForScoreIn(PAIN_BUCKETS, 0)!.label).toBe('没有');
    expect(bucketForScoreIn(PAIN_BUCKETS, 10)!.label).toBe('最重');
  });

  it('covers every integer 0-10 exactly once, for both scales', () => {
    for (const scale of [PAIN_SCALE, FATIGUE_SCALE]) {
      for (let score = 0; score <= 10; score += 1) {
        const matches = scale.buckets.filter(
          (bucket) => score >= bucket.min && score <= bucket.max,
        );
        expect(matches).toHaveLength(1);
      }
      // Each band's `pick` lands inside its own band, or tapping a band
      // would immediately relabel itself as a different one.
      for (const bucket of scale.buckets) {
        expect(bucket.pick).toBeGreaterThanOrEqual(bucket.min);
        expect(bucket.pick).toBeLessThanOrEqual(bucket.max);
      }
    }
  });

  it('clamps rather than blanking mid-edit', () => {
    expect(bucketForScoreIn(PAIN_BUCKETS, 999)!.label).toBe('最重');
    expect(bucketForScoreIn(PAIN_BUCKETS, -3)!.label).toBe('没有');
    expect(bucketForScoreIn(PAIN_BUCKETS, Number.NaN)!.label).toBe('没有');
    expect(bucketForScoreIn([], 3)).toBeNull();
  });
});

describe('what gets written down beside the number', () => {
  it('stores the direction on every row, the way the sleep row does', () => {
    expect(PAIN_SCALE.storedNote).toContain('0=');
    expect(PAIN_SCALE.storedNote).toContain('10=');
    expect(FATIGUE_SCALE.storedNote).toContain('0=');
    expect(FATIGUE_SCALE.storedNote).toContain('10=');
  });

  it('uses the API symptom keys these rows have always had', () => {
    expect(PAIN_SCALE.key).toBe('pain');
    expect(FATIGUE_SCALE.key).toBe('fatigue');
  });

  it('cites the guideline that says to ask every visit', () => {
    expect(SYMPTOM_GUIDELINE_NOTE).toContain('ENMC');
    expect(SYMPTOM_GUIDELINE_NOTE).toContain('2010');
  });
});
