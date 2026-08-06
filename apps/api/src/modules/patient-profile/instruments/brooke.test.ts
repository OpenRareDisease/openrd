import { describe, expect, it } from 'vitest';

import {
  BROOKE_ITEM_CODE,
  BROOKE_SCORING_METHOD,
  brookeUpperExtremityV1,
  scoreBrookeV1,
} from './brooke.js';

const answer = (
  value: number | null,
  flags: { skipped?: boolean; notApplicable?: boolean } = {},
) => [
  {
    itemCode: BROOKE_ITEM_CODE,
    responseValue: value,
    skipped: flags.skipped ?? false,
    notApplicable: flags.notApplicable ?? false,
  },
];

/**
 * GOLDEN VECTORS.
 *
 * Every grade, its exact stored score, and its exact published English
 * wording. The English is asserted character-for-character on purpose:
 * it is the freeze that the comment at the top of brooke.ts describes,
 * and a comment claiming the anchors are frozen with nothing enforcing
 * it is the pattern this repo keeps getting bitten by. Reword an
 * anchor and this table goes red before the reword can silently
 * reinterpret every score already in the database.
 */
const GOLDEN: ReadonlyArray<{ grade: number; sourceEn: string }> = [
  {
    grade: 1,
    sourceEn:
      'Starting with arms at the sides, the patient can abduct the arms in a full circle until they touch above the head',
  },
  {
    grade: 2,
    sourceEn:
      'Can raise arms above head only by flexing the elbow (shortening the circumference of the movement) or using accessory muscles',
  },
  {
    grade: 3,
    sourceEn: 'Cannot raise hands above head, but can raise an 8-oz glass of water to the mouth',
  },
  {
    grade: 4,
    sourceEn: 'Can raise hands to the mouth, but cannot raise an 8-oz glass of water to the mouth',
  },
  {
    grade: 5,
    sourceEn:
      'Cannot raise hands to the mouth, but can use hands to hold a pen or pick up pennies from the table',
  },
  { grade: 6, sourceEn: 'Cannot raise hands to the mouth and has no useful function of hands' },
];

describe('Brooke v1 — frozen anchors', () => {
  it('has exactly six levels, 1 through 6', () => {
    const values = brookeUpperExtremityV1.items[0].levels.map((level) => level.value);
    expect(values).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each(GOLDEN)('grade $grade keeps its published wording verbatim', ({ grade, sourceEn }) => {
    const level = brookeUpperExtremityV1.items[0].levels.find(
      (candidate) => candidate.value === grade,
    );
    expect(level?.sourceEn).toBe(sourceEn);
  });

  it('has a non-empty Chinese anchor for every level', () => {
    for (const level of brookeUpperExtremityV1.items[0].levels) {
      expect(level.labelZh.length).toBeGreaterThan(0);
    }
  });

  it('declares the direction of the scale — higher means less function', () => {
    expect(brookeUpperExtremityV1.higherIsWorse).toBe(true);
    expect(brookeUpperExtremityV1.scoreMin).toBe(1);
    expect(brookeUpperExtremityV1.scoreMax).toBe(6);
  });

  it('carries its citation and its FSHD limitations to the patient', () => {
    // 0.66 is moderate agreement, not "validated", and the floor
    // effect means a flat score is not a stable disease. Shipping the
    // scale without either statement would be presenting a guess in
    // the same register as evidence.
    expect(brookeUpperExtremityV1.sourceCitation).toContain('Muscle Nerve. 1981;4(3):186-97');
    expect(brookeUpperExtremityV1.selfReportEvidenceZh).toContain('0.66');
    expect(brookeUpperExtremityV1.limitationsZh.length).toBeGreaterThan(0);
    expect(brookeUpperExtremityV1.limitationsZh.join('')).toContain('地板效应');
  });
});

describe('scoreBrookeV1 — golden vectors', () => {
  it.each(GOLDEN)('grade $grade scores to $grade', ({ grade }) => {
    const outcome = scoreBrookeV1(answer(grade));
    expect(outcome).toEqual({
      ok: true,
      score: {
        rawScore: grade,
        scoredValue: grade,
        completeness: 1,
        scoringMethod: BROOKE_SCORING_METHOD,
      },
    });
  });

  it('pins the scoring method name — it is stored on every row and re-scoring selects on it', () => {
    expect(BROOKE_SCORING_METHOD).toBe('brooke_v1_single_grade');
  });
});

describe('scoreBrookeV1 — refusals', () => {
  it('refuses a grade above the scale', () => {
    const outcome = scoreBrookeV1(answer(7));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reasonCode).toBe('value_out_of_range');
  });

  it('refuses a grade below the scale (0 is not a Brooke grade)', () => {
    const outcome = scoreBrookeV1(answer(0));
    expect(outcome.ok === false && outcome.reasonCode).toBe('value_out_of_range');
  });

  it('refuses a non-integer grade rather than rounding it', () => {
    const outcome = scoreBrookeV1(answer(3.5));
    expect(outcome.ok === false && outcome.reasonCode).toBe('value_out_of_range');
  });

  it('refuses an empty submission', () => {
    const outcome = scoreBrookeV1([]);
    expect(outcome.ok === false && outcome.reasonCode).toBe('missing_item');
  });

  it('refuses a skipped item instead of inventing a score', () => {
    const outcome = scoreBrookeV1(answer(null, { skipped: true }));
    expect(outcome.ok === false && outcome.reasonCode).toBe('unanswered_item');
  });

  it('refuses a not-applicable item', () => {
    const outcome = scoreBrookeV1(answer(null, { notApplicable: true }));
    expect(outcome.ok === false && outcome.reasonCode).toBe('unanswered_item');
  });

  it('refuses an answer to an item this instrument does not have', () => {
    const outcome = scoreBrookeV1([
      { itemCode: 'vignos_grade', responseValue: 4, skipped: false, notApplicable: false },
    ]);
    expect(outcome.ok === false && outcome.reasonCode).toBe('unknown_item');
  });

  it('refuses two answers to the same item rather than picking one', () => {
    const outcome = scoreBrookeV1([...answer(2), ...answer(5)]);
    expect(outcome.ok === false && outcome.reasonCode).toBe('duplicate_item');
  });

  it('is pure — the same input scores identically twice', () => {
    expect(scoreBrookeV1(answer(4))).toEqual(scoreBrookeV1(answer(4)));
  });
});
