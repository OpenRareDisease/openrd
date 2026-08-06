import { describe, expect, it } from 'vitest';

import {
  buildFallsSummary,
  composeFallClausesZh,
  composeFallDetailClauseZh,
  composeFallQuarterClauseZh,
  fallDayAge,
  FALL_QUARTER_DAYS,
  type FallSummaryRow,
} from './falls.summary.js';

/**
 * The three refusals in falls.summary.ts, each with a test that goes
 * red without it.
 *
 * These are not style assertions. Every one of them is a sentence the
 * assistant would otherwise say to a patient about their own falls,
 * and each would be false in a different way: a proportion computed
 * over rows that never answered, a quiet quarter invented out of a
 * period with no records, and a comparison drawn across a list whose
 * older half was cut.
 */

const fall = (over: Partial<FallSummaryRow> & { fall_day_age: number }): FallSummaryRow => ({
  occurred_at: new Date(Date.now() - over.fall_day_age * 24 * 60 * 60 * 1000).toISOString(),
  fall_activity: null,
  fall_location: null,
  fall_hands_full: null,
  fall_got_up_unaided: null,
  fall_injured: null,
  ...over,
});

describe('fallDayAge', () => {
  it('prefers the age SQL computed over the midnight timestamp', () => {
    // The DATE column comes back as midnight; deriving the age from it
    // in JS ages every fall by up to a day for anyone east of
    // Greenwich, which quietly moves a fall between quarters.
    const row: FallSummaryRow = {
      occurred_at: '2026-08-05T00:00:00.000Z',
      fall_day_age: 0,
    };
    expect(fallDayAge(row, Date.parse('2026-08-05T22:00:00.000Z'))).toBe(0);
  });

  it('falls back to the timestamp when SQL did not supply an age', () => {
    const row: FallSummaryRow = { occurred_at: '2026-08-01T12:00:00.000Z' };
    expect(fallDayAge(row, Date.parse('2026-08-04T12:00:00.000Z'))).toBe(3);
  });

  it('returns null for a date it cannot read rather than calling it today', () => {
    // Bucketing an unreadable date at zero would drop it into the most
    // recent quarter — the one the「更频繁了」comparison reads.
    expect(fallDayAge({ occurred_at: 'not a date' }, Date.now())).toBeNull();
  });
});

describe('buildFallsSummary — denominators', () => {
  const rows = [
    fall({ fall_day_age: 3, fall_injured: true, fall_location: 'outdoor' }),
    fall({ fall_day_age: 10, fall_injured: true, fall_location: 'indoor' }),
    fall({ fall_day_age: 20, fall_injured: false }),
    fall({ fall_day_age: 30 }),
    fall({ fall_day_age: 40 }),
  ];

  it('counts only the rows that answered a question', () => {
    const summary = buildFallsSummary(rows, { atCap: false });
    expect(summary.total).toBe(5);
    // Three rows answered「是否受伤」, two of them yes. The other two
    // said nothing, and must not be counted as "not injured".
    expect(summary.injured).toEqual({ answered: 3, yes: 2 });
    expect(summary.location.answered).toBe(2);
    expect(summary.detailed).toBe(3);
  });

  it('never states a count without the count it was computed over', () => {
    const clause = composeFallDetailClauseZh(buildFallsSummary(rows, { atCap: false }));
    expect(clause).toContain('已记录是否受伤的 3 次中，2 次受伤');
    // The failure this guards: 「5 次跌倒，2 次受伤」 tells the patient
    // three of their falls were injury-free, which the record does not
    // say.
    expect(clause).not.toContain('5 次中，2 次受伤');
    expect(clause).toContain('其余 2 次只有日期');
  });

  it('counts the direction that matters for getting up', () => {
    const summary = buildFallsSummary(
      [
        fall({ fall_day_age: 1, fall_got_up_unaided: false }),
        fall({ fall_day_age: 2, fall_got_up_unaided: true }),
        fall({ fall_day_age: 3, fall_got_up_unaided: true }),
      ],
      { atCap: false },
    );
    // The column says「自己起来了」; the clinically load-bearing count is
    // the one that could not.
    expect(summary.neededHelpUp).toEqual({ answered: 3, yes: 1 });
    expect(composeFallDetailClauseZh(summary)).toContain(
      '已记录能否自行起身的 3 次中，1 次无法自行起身',
    );
  });

  it('keeps 「记不清」 apart from 「没填」', () => {
    const summary = buildFallsSummary(
      [
        fall({ fall_day_age: 1, fall_location: 'unknown' }),
        fall({ fall_day_age: 2, fall_location: 'indoor' }),
        fall({ fall_day_age: 3 }),
      ],
      { atCap: false },
    );
    expect(summary.location).toEqual({ answered: 2, indoor: 1, outdoor: 0, unknown: 1 });
    expect(composeFallDetailClauseZh(summary)).toContain(
      '已记录地点的 2 次中，室内 1 次、记不清 1 次',
    );
  });

  it('drops a value the CHECK constraint should have made impossible', () => {
    // A row written by a support script or surviving a rolled-back
    // constraint must not reach a prompt under a label nothing defines.
    const summary = buildFallsSummary(
      [fall({ fall_day_age: 1, fall_location: 'in the kitchen', fall_activity: '搬东西' })],
      { atCap: false },
    );
    expect(summary.location.answered).toBe(0);
    expect(summary.activity.answered).toBe(0);
    expect(summary.activity.top).toBeNull();
  });

  it('names the commonest circumstance with its own count', () => {
    const summary = buildFallsSummary(
      [
        fall({ fall_day_age: 1, fall_activity: 'stairs' }),
        fall({ fall_day_age: 2, fall_activity: 'stairs' }),
        fall({ fall_day_age: 3, fall_activity: 'walking' }),
      ],
      { atCap: false },
    );
    expect(summary.activity.top).toEqual({ key: 'stairs', count: 2 });
    expect(composeFallDetailClauseZh(summary)).toContain(
      '已记录当时情形的 3 次中，最多的是「上下楼梯时」2 次',
    );
  });

  it('says nothing about detail when every fall is date-only', () => {
    const summary = buildFallsSummary([fall({ fall_day_age: 3 }), fall({ fall_day_age: 9 })], {
      atCap: false,
    });
    expect(summary.detailed).toBe(0);
    expect(composeFallDetailClauseZh(summary)).toBeNull();
  });
});

describe('buildFallsSummary — quarters', () => {
  it('stops at the bucket holding the oldest recorded fall', () => {
    // The refusal: a patient who started recording 100 days ago has no
    // falls in the 181-270 day bucket because they were not using the
    // app, not because they did not fall. Emitting that bucket as
    // 「0 次」 manufactures an improvement out of an install date.
    const summary = buildFallsSummary([fall({ fall_day_age: 5 }), fall({ fall_day_age: 100 })], {
      atCap: false,
    });
    expect(summary.quarters.map((q) => q.count)).toEqual([1, 1]);
    expect(summary.quarters[1].startDaysAgo).toBe(FALL_QUARTER_DAYS);
    expect(summary.oldestDaysAgo).toBe(100);
  });

  it('says where the record starts so the last bucket is not read as a boundary', () => {
    const clause = composeFallQuarterClauseZh(
      buildFallsSummary([fall({ fall_day_age: 5 }), fall({ fall_day_age: 100 })], {
        atCap: false,
      }),
    );
    expect(clause).toContain('跌倒频率（每 90 天一段，由近及远）：1 次、1 次');
    expect(clause).toContain('最早一次跌倒记录在 100 天前');
    expect(clause).toContain('不能当作没有跌倒');
  });

  it('refuses to compare when the whole history fits in one bucket', () => {
    // 「最近 90 天 2 次」 with nothing to compare against is an invitation
    // to supply the missing half.
    const summary = buildFallsSummary([fall({ fall_day_age: 3 }), fall({ fall_day_age: 20 })], {
      atCap: false,
    });
    expect(summary.quarters).toHaveLength(1);
    expect(composeFallQuarterClauseZh(summary)).toBeNull();
    expect(composeFallClausesZh(summary)).toEqual([]);
  });

  it('refuses to compare across a truncated list', () => {
    // The list is read most-recent-first, so the ceiling cuts the OLD
    // end — the exact half the comparison rests on. Every comparison
    // over a capped list is biased toward「更频繁了」.
    const rows = [fall({ fall_day_age: 5 }), fall({ fall_day_age: 200 })];
    expect(composeFallQuarterClauseZh(buildFallsSummary(rows, { atCap: false }))).not.toBeNull();
    expect(composeFallQuarterClauseZh(buildFallsSummary(rows, { atCap: true }))).toBeNull();
  });

  it('reports an empty quarter between two recorded ones', () => {
    // This one IS evidence: the record demonstrably spans the gap.
    const summary = buildFallsSummary([fall({ fall_day_age: 2 }), fall({ fall_day_age: 200 })], {
      atCap: false,
    });
    expect(summary.quarters.map((q) => q.count)).toEqual([1, 0, 1]);
  });

  it('produces nothing at all for a patient with no falls on record', () => {
    // Deliberately not 「0 次」. No rows in a window is evidence of no
    // records, not of no falls, and the caller must not be handed a
    // zero it can render as 「今年没摔过」.
    const summary = buildFallsSummary([], { atCap: false });
    expect(summary.total).toBe(0);
    expect(summary.quarters).toEqual([]);
    expect(composeFallClausesZh(summary)).toEqual([]);
  });

  it('drops a row whose date cannot be read instead of dating it today', () => {
    const summary = buildFallsSummary([fall({ fall_day_age: 5 }), { occurred_at: 'garbage' }], {
      atCap: false,
    });
    expect(summary.total).toBe(1);
  });
});
