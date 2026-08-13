import { describe, expect, it } from 'vitest';

import {
  VIGNOS_ITEM_CODE,
  VIGNOS_SCORING_METHOD,
  ambulationStateFromVignosGrade,
  scoreVignosV1,
  vignosGradeImpliesWheelchair,
  vignosLowerExtremityV1,
} from './vignos.js';

const answer = (
  value: number | null,
  flags: { skipped?: boolean; notApplicable?: boolean } = {},
) => [
  {
    itemCode: VIGNOS_ITEM_CODE,
    responseValue: value,
    skipped: flags.skipped ?? false,
    notApplicable: flags.notApplicable ?? false,
  },
];

/**
 * GOLDEN VECTORS — see the note in brooke.test.ts. The English wording
 * is asserted verbatim because it is the frozen definition of each
 * grade; changing it silently reinterprets every score already stored
 * against v1.
 */
const GOLDEN: ReadonlyArray<{ grade: number; sourceEn: string }> = [
  { grade: 1, sourceEn: 'Walks and climbs stairs without assistance' },
  { grade: 2, sourceEn: 'Walks and climbs stair with aid of railing' },
  {
    grade: 3,
    sourceEn:
      'Walks and climbs stairs slowly with aid of railing (over 25 seconds for eight standard steps)',
  },
  { grade: 4, sourceEn: 'Walks unassisted and rises from chair but cannot climb stairs' },
  { grade: 5, sourceEn: 'Walks unassisted but cannot rise from chair or climb stairs' },
  {
    grade: 6,
    sourceEn: 'Walks only with assistance or walks independently with long leg braces',
  },
  { grade: 7, sourceEn: 'Walks in long leg braces but requires assistance for balance' },
  { grade: 8, sourceEn: 'Stands in long leg braces but unable to walk even with assistance' },
  { grade: 9, sourceEn: 'Is in a wheelchair' },
  { grade: 10, sourceEn: 'Is confined to a bed' },
];

describe('Vignos v1 — frozen anchors', () => {
  it('has exactly ten levels, 1 through 10', () => {
    const values = vignosLowerExtremityV1.items[0].levels.map((level) => level.value);
    expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it.each(GOLDEN)('grade $grade keeps its published wording verbatim', ({ grade, sourceEn }) => {
    const level = vignosLowerExtremityV1.items[0].levels.find(
      (candidate) => candidate.value === grade,
    );
    expect(level?.sourceEn).toBe(sourceEn);
  });

  it('keeps the long-leg-brace wording in grades 6-8 instead of softening it', () => {
    // Softening 「戴长腿支具」 to a generic 「使用辅具」 would read
    // better and would no longer be Vignos: this app's grade 7 has to
    // mean what a clinic's grade 7 means. The gap is disclosed in
    // limitationsZh instead.
    for (const grade of [6, 7, 8]) {
      const level = vignosLowerExtremityV1.items[0].levels.find(
        (candidate) => candidate.value === grade,
      );
      expect(level?.sourceEn).toContain('long leg braces');
      expect(level?.labelZh).toContain('长腿支具');
    }
  });

  it('tells the patient that grades 6-8 may not fit them, and why', () => {
    const limitations = vignosLowerExtremityV1.limitationsZh.join('');
    expect(limitations).toContain('长腿支具');
    expect(limitations).toContain('地板效应');
  });

  it('carries its citation and the 0.86 self-report figure', () => {
    expect(vignosLowerExtremityV1.sourceCitation).toContain('JAMA. 1963;184:89-96');
    expect(vignosLowerExtremityV1.selfReportEvidenceZh).toContain('0.86');
  });

  it('declares the direction of the scale — higher means less function', () => {
    expect(vignosLowerExtremityV1.higherIsWorse).toBe(true);
    expect(vignosLowerExtremityV1.scoreMin).toBe(1);
    expect(vignosLowerExtremityV1.scoreMax).toBe(10);
  });
});

describe('scoreVignosV1 — golden vectors', () => {
  it.each(GOLDEN)('grade $grade scores to $grade', ({ grade }) => {
    expect(scoreVignosV1(answer(grade))).toEqual({
      ok: true,
      score: {
        rawScore: grade,
        scoredValue: grade,
        completeness: 1,
        scoringMethod: VIGNOS_SCORING_METHOD,
      },
    });
  });

  it('pins the scoring method name', () => {
    expect(VIGNOS_SCORING_METHOD).toBe('vignos_v1_single_grade');
  });

  it('refuses grade 11 and grade 0', () => {
    expect(scoreVignosV1(answer(11)).ok).toBe(false);
    expect(scoreVignosV1(answer(0)).ok).toBe(false);
  });

  it('refuses a not-applicable answer rather than scoring it', () => {
    const outcome = scoreVignosV1(answer(null, { notApplicable: true }));
    expect(outcome.ok === false && outcome.reasonCode).toBe('unanswered_item');
  });
});

/**
 * The wiring to AMBULATION_STATES. Every expectation below is read
 * straight off the published anchor text; none of it is a clinical
 * inference this module is entitled to make.
 */
describe('ambulationStateFromVignosGrade', () => {
  it.each([1, 2, 3, 4, 5])(
    'grade %i is independent — every one of these anchors says the patient walks',
    (grade) => {
      expect(ambulationStateFromVignosGrade(grade)).toBe('independent');
    },
  );

  it.each([6, 7])('grade %i is assisted — the anchor says assistance is required', (grade) => {
    expect(ambulationStateFromVignosGrade(grade)).toBe('assisted');
  });

  it.each([8, 9, 10])('grade %i is unable — no walking in the anchor at all', (grade) => {
    expect(ambulationStateFromVignosGrade(grade)).toBe('unable');
  });

  it('returns null for anything outside the scale instead of guessing', () => {
    expect(ambulationStateFromVignosGrade(0)).toBeNull();
    expect(ambulationStateFromVignosGrade(11)).toBeNull();
    expect(ambulationStateFromVignosGrade(4.5)).toBeNull();
    expect(ambulationStateFromVignosGrade(Number.NaN)).toBeNull();
  });
});

describe('vignosGradeImpliesWheelchair', () => {
  it('is true for grade 9 alone — its published wording is "Is in a wheelchair"', () => {
    expect(vignosGradeImpliesWheelchair(9)).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 10])('is false for grade %i', (grade) => {
    // 8 is standing in braces and says nothing about a wheelchair; 10
    // is bed confinement, which is past the wheelchair rather than the
    // moment of reaching it. Widening this predicate would have the
    // app log a clinical event the patient never reported.
    expect(vignosGradeImpliesWheelchair(grade)).toBe(false);
  });
});
