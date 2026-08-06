/**
 * Turning a list of falls into something that can be said out loud
 * without lying.
 *
 * This module is pure. It takes the rows FALL_HISTORY_SQL returns and
 * produces (a) a quarterly count, which is what the clinical passport
 * shows, and (b) one Chinese sentence, which is what the AI retriever
 * hands to the model. Both come from the same numbers, computed once,
 * because the passport and the assistant answering「我最近跌倒是不是更
 * 频繁了」are the same question asked twice.
 *
 *
 * THE THREE THINGS THIS FILE REFUSES TO DO
 *
 * 1. Report a proportion without its denominator.
 *
 *    Every detail column on a fall is optional, by design: a patient
 *    recording a fall an hour later, one-handed, must be able to save
 *    after one tap. So NULL means 「没填」 and never 「没有」. Saying
 *    「5 次跌倒，2 次受伤」 when only 3 rows answered the injury
 *    question tells the patient that 3 of their falls were
 *    injury-free — a fact the record does not contain. Every clause
 *    below therefore carries the count it was computed over:
 *    「已记录是否受伤的 3 次中，2 次受伤」.
 *
 * 2. Report a quarter it has no evidence was observed.
 *
 *    A patient who started using the app 100 days ago has zero falls
 *    in the 91–180 day bucket. That is not a quiet quarter, it is a
 *    quarter with no record, and treating the two the same manufactures
 *    「你跌倒变频繁了」out of the act of installing the app. Buckets
 *    are therefore emitted only up to and including the one holding
 *    the OLDEST fall on record, and the sentence states where that
 *    oldest record is so the model cannot read the last bucket as a
 *    boundary of the patient's history.
 *
 *    This is still an inference — a quarter between two recorded falls
 *    is assumed observed — and it is the weakest claim that lets the
 *    feature exist. It is not a claim that the earlier period was
 *    fall-free.
 *
 * 3. Compare across a truncated list.
 *
 *    The caller reads the most recent N falls. If it hit that ceiling,
 *    the OLDEST bucket is the one that got cut, so every comparison is
 *    biased toward「更频繁了」. `atCap` suppresses the quarterly clause
 *    entirely rather than shading it — the same call MAX_ROWS_PER_SERIES
 *    forced on the measurement series, where under-reporting `count`
 *    was allowed but claiming a total was not.
 *
 * The sentence this file builds lands in the retriever's `eventSummary`
 * field, which is on the prompt allowlist in BOTH strict and precise
 * modes. That is only safe because every value in it is either a count
 * this file computed or a label from FALL_ACTIVITY_LABELS_ZH /
 * FALL_LOCATION_LABELS_ZH below. Nothing the patient typed passes
 * through here, and nothing may be added that does.
 */

import { isFallActivity, isFallLocation } from './falls.sql.js';
import type { FallActivity, FallLocation } from '../profile.constants.js';

/**
 * What this module needs from a row, and nothing more.
 *
 * `FallHistoryRow` (falls.sql.ts) satisfies it structurally, and so
 * does the retriever's event row, whose fall columns are OPTIONAL
 * because the same query also returns rows that are not falls. Every
 * fall column is therefore read with `!= null`, which treats an absent
 * property and a NULL column identically — both mean「没填」, and both
 * must stay out of the denominators.
 */
export interface FallSummaryRow {
  occurred_at: string | Date;
  fall_day_age?: number | null;
  fall_activity?: string | null;
  fall_location?: string | null;
  fall_hands_full?: boolean | null;
  fall_got_up_unaided?: boolean | null;
  fall_injured?: boolean | null;
}

/** Days per reporting bucket. A quarter, because that is the interval
 *  the passport and a routine neurology follow-up both work in. */
export const FALL_QUARTER_DAYS = 90;

export const FALL_ACTIVITY_LABELS_ZH: Record<FallActivity, string> = {
  walking: '走路时',
  stairs: '上下楼梯时',
  standing_up: '起身时',
  turning: '转身时',
  reaching: '伸手取物时',
  dressing_or_washing: '穿衣或洗漱时',
  uneven_or_slippery: '地面不平或湿滑',
  other: '其他情形',
  unknown: '记不清',
};

export const FALL_LOCATION_LABELS_ZH: Record<FallLocation, string> = {
  indoor: '室内',
  outdoor: '室外',
  unknown: '记不清',
};

export interface FallQuarterCount {
  /** 0 is the most recent FALL_QUARTER_DAYS days. */
  index: number;
  /** Inclusive age bounds in days, oldest first: index 0 is 0–89. */
  startDaysAgo: number;
  endDaysAgo: number;
  count: number;
}

/** A yes/no column: how many rows answered it, and how many said yes. */
export interface FallAnswerTally {
  answered: number;
  yes: number;
}

export interface FallsSummary {
  /** Distinct falls inside the window. A floor, not a total, when
   *  `atCap` is true. */
  total: number;
  atCap: boolean;
  /** Rows carrying at least one answered detail column. The rest are
   *  date-only — every back-filled fall, and every fall logged through
   *  the original event route. */
  detailed: number;
  latestDaysAgo: number | null;
  oldestDaysAgo: number | null;
  /**
   * Most recent first, and truncated at the bucket holding the oldest
   * recorded fall. Empty when there are no falls. See refusal (2).
   */
  quarters: FallQuarterCount[];
  location: { answered: number; indoor: number; outdoor: number; unknown: number };
  activity: { answered: number; top: { key: FallActivity; count: number } | null };
  handsFull: FallAnswerTally;
  /** `yes` counts falls the patient could NOT get up from unaided —
   *  the clinically load-bearing direction, and the opposite of the
   *  column's name. Named for what it counts so no caller has to
   *  remember which way round the boolean ran. */
  neededHelpUp: FallAnswerTally;
  injured: FallAnswerTally;
}

/**
 * Age in whole days for one row.
 *
 * `fall_day_age` is what SQL computed in Asia/Shanghai and is always
 * preferred. The fallback exists for rows that reach this function
 * without it — the retriever also feeds this module event rows that
 * came back from a driver shape it does not control — and it is
 * deliberately `Math.round` on the timestamp, matching the ageing the
 * rest of the retriever does, rather than a second convention.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export const fallDayAge = (row: FallSummaryRow, now: number): number | null => {
  if (typeof row.fall_day_age === 'number' && Number.isFinite(row.fall_day_age)) {
    return Math.max(0, Math.round(row.fall_day_age));
  }
  const raw = row.occurred_at;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / DAY_MS));
};

const hasAnyDetail = (row: FallSummaryRow): boolean =>
  row.fall_activity != null ||
  row.fall_location != null ||
  row.fall_hands_full != null ||
  row.fall_got_up_unaided != null ||
  row.fall_injured != null;

const tallyBoolean = (
  rows: FallSummaryRow[],
  pick: (row: FallSummaryRow) => boolean | null | undefined,
  countsAsYes: (value: boolean) => boolean,
): FallAnswerTally => {
  let answered = 0;
  let yes = 0;
  for (const row of rows) {
    const value = pick(row);
    if (typeof value !== 'boolean') continue;
    answered += 1;
    if (countsAsYes(value)) yes += 1;
  }
  return { answered, yes };
};

export interface BuildFallsSummaryOptions {
  /** True when the caller's row limit was reached, so the oldest falls
   *  in the window were never read. Suppresses the quarterly clause. */
  atCap: boolean;
  /** Epoch millis, for the timestamp fallback in `fallDayAge`. */
  now?: number;
}

export const buildFallsSummary = (
  rows: readonly FallSummaryRow[],
  options: BuildFallsSummaryOptions,
): FallsSummary => {
  const now = options.now ?? Date.now();
  // A row whose date cannot be read is dropped rather than bucketed at
  // zero. Bucketing it at zero would move an unreadable fall into the
  // most recent quarter, which is the one the「更频繁了」comparison
  // reads.
  const dated = rows
    .map((row) => ({ row, age: fallDayAge(row, now) }))
    .filter((entry): entry is { row: FallSummaryRow; age: number } => entry.age !== null);

  const usable = dated.map((entry) => entry.row);

  const empty: FallsSummary = {
    total: 0,
    atCap: options.atCap,
    detailed: 0,
    latestDaysAgo: null,
    oldestDaysAgo: null,
    quarters: [],
    location: { answered: 0, indoor: 0, outdoor: 0, unknown: 0 },
    activity: { answered: 0, top: null },
    handsFull: { answered: 0, yes: 0 },
    neededHelpUp: { answered: 0, yes: 0 },
    injured: { answered: 0, yes: 0 },
  };
  if (dated.length === 0) return empty;

  const ages = dated.map((entry) => entry.age);
  const latestDaysAgo = Math.min(...ages);
  const oldestDaysAgo = Math.max(...ages);

  // Buckets run to the one holding the oldest recorded fall and stop.
  // Anything beyond it is unobserved, not quiet — refusal (2).
  const lastIndex = Math.floor(oldestDaysAgo / FALL_QUARTER_DAYS);
  const quarters: FallQuarterCount[] = [];
  for (let index = 0; index <= lastIndex; index += 1) {
    quarters.push({
      index,
      startDaysAgo: index * FALL_QUARTER_DAYS,
      endDaysAgo: (index + 1) * FALL_QUARTER_DAYS - 1,
      count: 0,
    });
  }
  for (const age of ages) {
    // Safe without a clamp: lastIndex is derived from the largest age,
    // so no row can land past the last bucket.
    quarters[Math.floor(age / FALL_QUARTER_DAYS)].count += 1;
  }

  const location = { answered: 0, indoor: 0, outdoor: 0, unknown: 0 };
  for (const row of usable) {
    if (!isFallLocation(row.fall_location)) continue;
    location.answered += 1;
    location[row.fall_location] += 1;
  }

  const activityCounts = new Map<FallActivity, number>();
  for (const row of usable) {
    if (!isFallActivity(row.fall_activity)) continue;
    activityCounts.set(row.fall_activity, (activityCounts.get(row.fall_activity) ?? 0) + 1);
  }
  let top: { key: FallActivity; count: number } | null = null;
  for (const [key, count] of activityCounts) {
    // Strictly greater, so a tie keeps the first — the enum order in
    // profile.constants.ts — instead of depending on Map iteration
    // order the way a >= would.
    if (top === null || count > top.count) top = { key, count };
  }
  const activityAnswered = [...activityCounts.values()].reduce((sum, n) => sum + n, 0);

  return {
    total: dated.length,
    atCap: options.atCap,
    detailed: usable.filter(hasAnyDetail).length,
    latestDaysAgo,
    oldestDaysAgo,
    quarters,
    location,
    activity: { answered: activityAnswered, top },
    handsFull: tallyBoolean(
      usable,
      (row) => row.fall_hands_full,
      (value) => value,
    ),
    // The column is `got_up_unaided`; what matters clinically is the
    // false case.
    neededHelpUp: tallyBoolean(
      usable,
      (row) => row.fall_got_up_unaided,
      (value) => !value,
    ),
    injured: tallyBoolean(
      usable,
      (row) => row.fall_injured,
      (value) => value,
    ),
  };
};

/**
 * The quarterly clause, or null when there is no honest one to write.
 *
 * Suppressed when the list was truncated (refusal 3) or when there is
 * only one bucket — a patient whose whole fall history sits inside the
 * last 90 days has nothing to be compared against, and 「最近 90 天
 * 2 次」 alone invites the model to supply the missing half.
 */
export const composeFallQuarterClauseZh = (summary: FallsSummary): string | null => {
  if (summary.atCap) return null;
  if (summary.quarters.length < 2) return null;

  const counts = summary.quarters.map((quarter) => `${quarter.count} 次`).join('、');
  return (
    `跌倒频率（每 ${FALL_QUARTER_DAYS} 天一段，由近及远）：${counts}；` +
    `最早一次跌倒记录在 ${summary.oldestDaysAgo} 天前，` +
    `更早的时段没有记录，不能当作没有跌倒`
  );
};

/**
 * The detail clause, or null when no fall has any detail filled in.
 *
 * Every sub-clause states its denominator. See refusal (1) — this is
 * the whole reason the function is this verbose.
 */
export const composeFallDetailClauseZh = (summary: FallsSummary): string | null => {
  if (summary.detailed === 0) return null;

  const parts: string[] = [];

  if (summary.location.answered > 0) {
    // Outdoor first: it is the one that carries an environmental
    // explanation a patient can act on. A zero is omitted rather than
    // printed — nobody answered「室内」zero times, the answers simply
    // went elsewhere, and the denominator already says how many there
    // were.
    const seen = (['outdoor', 'indoor', 'unknown'] as const)
      .filter((key) => summary.location[key] > 0)
      .map((key) => `${FALL_LOCATION_LABELS_ZH[key]} ${summary.location[key]} 次`);
    parts.push(`已记录地点的 ${summary.location.answered} 次中，${seen.join('、')}`);
  }

  if (summary.activity.answered > 0 && summary.activity.top) {
    const label = FALL_ACTIVITY_LABELS_ZH[summary.activity.top.key];
    parts.push(
      `已记录当时情形的 ${summary.activity.answered} 次中，` +
        `最多的是「${label}」${summary.activity.top.count} 次`,
    );
  }

  if (summary.handsFull.answered > 0) {
    parts.push(
      `已记录当时双手是否拿着东西的 ${summary.handsFull.answered} 次中，` +
        `${summary.handsFull.yes} 次拿着东西`,
    );
  }

  if (summary.neededHelpUp.answered > 0) {
    parts.push(
      `已记录能否自行起身的 ${summary.neededHelpUp.answered} 次中，` +
        `${summary.neededHelpUp.yes} 次无法自行起身`,
    );
  }

  if (summary.injured.answered > 0) {
    parts.push(`已记录是否受伤的 ${summary.injured.answered} 次中，${summary.injured.yes} 次受伤`);
  }

  if (parts.length === 0) return null;

  const dateOnly = summary.total - summary.detailed;
  // Said explicitly rather than left to arithmetic. Without it the
  // model sees 「已记录地点的 3 次」 beside a total of 5 and has to
  // guess whether the other two were indoors.
  const tail = dateOnly > 0 ? `；其余 ${dateOnly} 次只有日期，没有填写详情` : '';
  return `跌倒详情：${parts.join('；')}${tail}`;
};

/**
 * Everything this module has to say about falls, as clauses the caller
 * joins into its own summary field. Empty array when there are no
 * falls — the caller must not turn that into 「0 次」, because no rows
 * in a window is not evidence of no falls in that window, only of no
 * records.
 */
export const composeFallClausesZh = (summary: FallsSummary): string[] => {
  if (summary.total === 0) return [];
  return [composeFallDetailClauseZh(summary), composeFallQuarterClauseZh(summary)].filter(
    (clause): clause is string => clause !== null,
  );
};
