import { SLEEP_BUCKETS, bucketForScore, stepSleepScore } from '../sleep-score';

describe('SLEEP_BUCKETS', () => {
  it('covers 0-10 with no gap and no overlap', () => {
    // A gap would leave a score with no label; an overlap would make
    // the highlighted bucket depend on array order.
    const covered = new Set<number>();
    SLEEP_BUCKETS.forEach((bucket) => {
      for (let n = bucket.min; n <= bucket.max; n += 1) {
        expect(covered.has(n)).toBe(false);
        covered.add(n);
      }
    });
    expect([...covered].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('picks a value inside its own band', () => {
    // Otherwise tapping a bucket would highlight a different one.
    SLEEP_BUCKETS.forEach((bucket) => {
      expect(bucket.pick).toBeGreaterThanOrEqual(bucket.min);
      expect(bucket.pick).toBeLessThanOrEqual(bucket.max);
    });
  });

  it('picks the floor midpoint of its band', () => {
    // The header comment used to promise「±1 仍在同一档」, which held
    // for 很差 alone: a two-wide band has no interior point, so no
    // choice of pick can deliver it. The floor midpoint is the rule
    // that does hold for all five, so it is the one under test.
    SLEEP_BUCKETS.forEach((bucket) => {
      expect(bucket.pick).toBe(Math.floor((bucket.min + bucket.max) / 2));
    });
  });

  it('keeps a +1 nudge inside the band that was tapped', () => {
    SLEEP_BUCKETS.forEach((bucket) => {
      const stepped = Number(stepSleepScore(String(bucket.pick), 1));
      expect(bucketForScore(stepped).label).toBe(bucket.label);
    });
  });

  it('steps −1 down a band from every pick except 很差', () => {
    // Documented rather than fixed: from the bottom of a two-wide
    // band,「再低一点」genuinely means the band below, and the label
    // beside the stepper updates on every change so the crossing is
    // visible.
    expect(bucketForScore(Number(stepSleepScore('1', -1))).label).toBe('很差');
    expect(bucketForScore(Number(stepSleepScore('3', -1))).label).toBe('很差');
    expect(bucketForScore(Number(stepSleepScore('5', -1))).label).toBe('较差');
    expect(bucketForScore(Number(stepSleepScore('7', -1))).label).toBe('一般');
    expect(bucketForScore(Number(stepSleepScore('9', -1))).label).toBe('较好');
  });
});

describe('bucketForScore', () => {
  it('labels each score with its band', () => {
    expect(bucketForScore(0).label).toBe('很差');
    expect(bucketForScore(2).label).toBe('很差');
    expect(bucketForScore(3).label).toBe('较差');
    expect(bucketForScore(6).label).toBe('一般');
    expect(bucketForScore(7).label).toBe('较好');
    expect(bucketForScore(10).label).toBe('很好');
  });

  it('clamps rather than losing the label mid-typing', () => {
    expect(bucketForScore(-3).label).toBe('很差');
    expect(bucketForScore(99).label).toBe('很好');
    expect(bucketForScore(Number.NaN).label).toBe('很差');
  });
});

describe('stepSleepScore', () => {
  it('steps within range', () => {
    expect(stepSleepScore('6', 1)).toBe('7');
    expect(stepSleepScore('6', -1)).toBe('5');
  });

  it('stops at both ends', () => {
    expect(stepSleepScore('10', 1)).toBe('10');
    expect(stepSleepScore('0', -1)).toBe('0');
  });

  it('treats an empty or junk field as 0 instead of producing NaN', () => {
    expect(stepSleepScore('', 1)).toBe('1');
    expect(stepSleepScore('abc', 1)).toBe('1');
    expect(stepSleepScore('', -1)).toBe('0');
  });
});
