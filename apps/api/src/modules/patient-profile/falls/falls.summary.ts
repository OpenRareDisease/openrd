/**
 * Turning a list of falls into something that can be said out loud
 * without lying.
 *
 * This module is pure. It takes the rows FALL_HISTORY_SQL returns and
 * produces (a) a quarterly count, which is what the 跌倒记录 block on
 * 病程管理 shows（最近 90 天记录到 N 次跌倒, via the mobile
 * `summarizeFallsForCourse`), and (b) one Chinese sentence, which is
 * what the AI retriever hands to the model. Both come from the same
 * numbers, computed once, because 病程管理 and the assistant answering
 *「我最近跌倒是不是更频繁了」are the same question asked twice.
 *
 * The clinical passport does NOT render a fall count. Comments in this
 * module used to say it did, in five files, and none of it was ever
 * true — profile.passport.ts has no falls reader at all. Putting one
 * there is a product decision and a disclosure decision (the passport
 * is the artefact a patient forwards to a clinician by link, and what a
 * share exposes is governed by sharing-preferences.ts), so it is not
 * something to assert in a doc comment ahead of making it.
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
 *    THE OLDEST FALL IS ONLY HALF OF THAT TEST. The other half is the
 *    QUERY WINDOW, and this module used not to be told it. The
 *    retriever's window is chosen by the model through
 *    `get_my_records` and may be any value from 1 to 730 days, while
 *    the bucket width here is a fixed 90 — so whenever the window is
 *    not a multiple of 90 the oldest emitted bucket spanned 90 days of
 *    which only a fraction was ever fetched, and it was printed as a
 *    full quarter next to the others. At `windowDays: 100` a patient
 *    with two falls last month and one at day 95 got 「2 次、1 次」,
 *    and the model read a DOUBLING — against a comparison quarter that
 *    had been observed for 11 of its 90 days. Buckets now stop at the
 *    last one FULLY inside the window as well as at the oldest fall,
 *    whichever comes first, and any falls left outside them are
 *    counted and said out loud rather than dropped or folded in.
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
 *    AND IT SUPPRESSED IT IN SILENCE, WHICH IS ONLY HALF THE REFUSAL.
 *    Every denominator refusal (1) is so careful to state —
 *    「已记录是否受伤的 3 次中，2 次受伤」,「其余 5 次只有日期」— is
 *    counted over the truncated list, so at the cap they are floors
 *    printed in the grammar of totals, and the one clause that would
 *    have hinted the list was cut is exactly the clause `atCap`
 *    removes. A reader was left with more confident numbers than
 *    before, not fewer. `composeFallCapClauseZh` says it instead.
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
 *  a routine neurology follow-up works in — the patient is asked「上次
 *  见面之后摔过几次」, and a bucket that does not line up with the
 *  appointment cannot answer it. */
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
   * Most recent first, and truncated at whichever comes first: the
   * bucket holding the oldest recorded fall, or the last bucket the
   * query window covers in full. Empty when there are no falls, and
   * ALSO empty when the window is shorter than one bucket — which is
   * why `quartersCoverDays` exists rather than leaving a consumer to
   * multiply. See refusal (2).
   */
  quarters: FallQuarterCount[];
  /** Days the emitted buckets account for: `quarters.length * 90`, and
   *  0 when there are none. Never larger than the query window. */
  quartersCoverDays: number;
  /** The window the caller said it queried, echoed back, or null when
   *  it did not say. Null is what makes the coverage sentence below
   *  disappear: a module that was not told the window cannot claim the
   *  buckets were observed end to end, only that they run back to the
   *  oldest fall. */
  windowDays: number | null;
  /** Falls inside the window but older than the last emitted bucket.
   *  They are in `total` and in every detail tally; they are simply not
   *  in a quarter, because the quarter they fall in was not observed
   *  end to end. */
  unbucketedOlder: number;
  location: { answered: number; indoor: number; outdoor: number; unknown: number };
  activity: {
    answered: number;
    top: { key: FallActivity; count: number } | null;
    /**
     * Every answered situation with its count, most frequent first and
     * ties broken by the order in `profile.constants.ts`.
     *
     * `top` alone cannot tell 「最多的是走路时 3 次」 from a two-way tie
     * at one apiece, and the clause built from it said 「最多的是」 for
     * both — a superlative asserted over a single answered row. The
     * caller needs the shape of the distribution to know whether there
     * is a most-common one at all.
     */
    counts: Array<{ key: FallActivity; count: number }>;
  };
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
  /**
   * How many days back the caller's query actually looked.
   *
   * Optional only because omitting it has to mean something safe for a
   * caller that has not been updated: `undefined` disables the
   * window truncation and leaves refusal (2) resting on the oldest
   * fall alone, which is where it was before. EVERY caller that runs a
   * bounded query should pass this — a 90-day bucket built from a
   * window that covered 11 of its days is the defect described in
   * refusal (2), and this module cannot detect it on its own.
   */
  windowDays?: number;
}

export const buildFallsSummary = (
  rows: readonly FallSummaryRow[],
  options: BuildFallsSummaryOptions,
): FallsSummary => {
  const now = options.now ?? Date.now();
  const knownWindowDays =
    typeof options.windowDays === 'number' && Number.isFinite(options.windowDays)
      ? options.windowDays
      : null;
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
    quartersCoverDays: 0,
    windowDays: knownWindowDays,
    unbucketedOlder: 0,
    location: { answered: 0, indoor: 0, outdoor: 0, unknown: 0 },
    activity: { answered: 0, top: null, counts: [] },
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
  const oldestFallIndex = Math.floor(oldestDaysAgo / FALL_QUARTER_DAYS);
  // ...and no further than the window actually reached. Bucket `i`
  // covers ages i*90 through (i+1)*90-1, so it is fully inside a
  // window of W days only when (i+1)*90 <= W. W=90 leaves one bucket
  // (nothing to compare, so refusal (2) suppresses the clause below);
  // W=100 still leaves one, because the 90–179 bucket was observed for
  // 11 of its 90 days and a partial quarter printed beside a full one
  // is read as a rate. A caller that passes no window keeps the old
  // behaviour and is bounded by the oldest fall alone.
  const lastWindowIndex =
    knownWindowDays === null
      ? oldestFallIndex
      : Math.floor(knownWindowDays / FALL_QUARTER_DAYS) - 1;
  const lastIndex = Math.min(oldestFallIndex, lastWindowIndex);
  const quarters: FallQuarterCount[] = [];
  for (let index = 0; index <= lastIndex; index += 1) {
    quarters.push({
      index,
      startDaysAgo: index * FALL_QUARTER_DAYS,
      endDaysAgo: (index + 1) * FALL_QUARTER_DAYS - 1,
      count: 0,
    });
  }
  let unbucketedOlder = 0;
  for (const age of ages) {
    const index = Math.floor(age / FALL_QUARTER_DAYS);
    // The clamp the oldest-fall bound alone did not need. A fall can
    // now sit inside the window and outside the last FULL bucket, and
    // it must not be folded into the last bucket (that would inflate
    // the comparison quarter) nor dropped (that would lose it from a
    // total this module promises is every fall it was handed).
    if (index > lastIndex) {
      unbucketedOlder += 1;
      continue;
    }
    quarters[index].count += 1;
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
  // Stable for the same reason `top` is: the Map was filled in row
  // order, so a plain descending sort on count would leave ties to the
  // rows' arrival order. Sorting only on count, on an array built from
  // the Map, keeps ties in insertion order.
  const activityCountsSorted = [...activityCounts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
  const activityAnswered = [...activityCounts.values()].reduce((sum, n) => sum + n, 0);

  return {
    total: dated.length,
    atCap: options.atCap,
    detailed: usable.filter(hasAnyDetail).length,
    latestDaysAgo,
    oldestDaysAgo,
    quarters,
    quartersCoverDays: quarters.length * FALL_QUARTER_DAYS,
    windowDays: knownWindowDays,
    unbucketedOlder,
    location,
    activity: { answered: activityAnswered, top, counts: activityCountsSorted },
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
 * Suppressed when the list was truncated (refusal 3) or when fewer than
 * two buckets survive — a patient whose whole fall history sits inside
 * the last 90 days has nothing to be compared against, and 「最近 90 天
 * 2 次」 alone invites the model to supply the missing half. That same
 * test now also catches the short-window case from refusal (2): a
 * 100-day query leaves exactly one full bucket, so it produces no
 * comparison at all instead of a doubling measured against 11 observed
 * days.
 */
export const composeFallQuarterClauseZh = (summary: FallsSummary): string | null => {
  if (summary.atCap) return null;
  if (summary.quarters.length < 2) return null;

  const counts = summary.quarters.map((quarter) => `${quarter.count} 次`).join('、');
  // Said out loud, because `oldestDaysAgo` can now sit OUTSIDE the last
  // bucket: the window reached that fall but did not cover its quarter
  // end to end. Without this the reader would take the bucket list as
  // running all the way back to the oldest record, and read the last
  // bucket as a quarter that contained one fall when it contained one
  // of several.
  const outside =
    summary.unbucketedOlder > 0
      ? `；更早还有 ${summary.unbucketedOlder} 次跌倒，落在查询窗口没有完整覆盖的时段里，没有计入上面的分段`
      : '';
  // Only claimed when the caller named its window. Without one this
  // module knows the buckets reach back to the oldest fall and nothing
  // about whether the days in between were ever queried, so it says
  // the smaller thing.
  const coverage =
    summary.windowDays === null ? '' : `，只统计被完整覆盖的最近 ${summary.quartersCoverDays} 天`;
  return (
    `跌倒频率（每 ${FALL_QUARTER_DAYS} 天一段，由近及远${coverage}）：${counts}${outside}；` +
    `最早一次跌倒记录在 ${summary.oldestDaysAgo} 天前，` +
    `更早的时段没有记录，不能当作没有跌倒`
  );
};

/**
 * The truncation clause, or null when nothing was truncated.
 *
 * Refusal (3) used to be discharged entirely by DELETING the quarterly
 * clause, which leaves a reader with `total`, a set of denominators and
 * no reason to doubt any of them. This is the sentence that says the
 * list is a floor. It goes FIRST among the clauses, before the numbers
 * it qualifies.
 *
 * `total` is named rather than the caller's row limit because this
 * module is not told what that limit was, and because the falls are
 * only part of what filled it — the retriever's ceiling counts every
 * event type. What is true either way is that these are the most
 * recent N and there are older ones nobody read.
 */
export const composeFallCapClauseZh = (summary: FallsSummary): string | null => {
  if (!summary.atCap) return null;
  const detailNote = summary.detailed > 0 ? '下面的跌倒详情只统计这部分，分母不是全部跌倒；' : '';
  return (
    `跌倒记录未读全：查询已达条数上限，只读取到最近 ${summary.total} 次跌倒，更早的没有读到；` +
    `${detailNote}因此不做每 ${FALL_QUARTER_DAYS} 天的频率比较`
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
    /**
     * 「最多的是」 IS A COMPARISON, AND IT WAS BEING MADE AGAINST
     * NOTHING.
     *
     * The clause used to read the top entry and print 「最多的是」
     * unconditionally. With one answered row that is a superlative over
     * a set of one — a patient who filled in the situation for a single
     * fall was told 「已记录当时情形的 1 次中，最多的是「走路时」1 次」,
     * which invites a fall-prevention answer aimed at the one activity
     * that happens to have been written down. With a two-way tie it is
     * worse: 「走路时」1 次 and 「上下楼梯时」1 次 came out as 走路时
     * being the most common, decided by which row arrived first.
     *
     * So the superlative is earned, not assumed: it needs a strict
     * winner over at least one rival. Everything else states the counts
     * and lets the reader see there is no mode.
     */
    const [first, second] = summary.activity.counts;
    const listed = summary.activity.counts
      .map(({ key, count }) => `「${FALL_ACTIVITY_LABELS_ZH[key]}」${count} 次`)
      .join('、');
    const head = `已记录当时情形的 ${summary.activity.answered} 次中，`;
    if (second === undefined) {
      // One situation covering every answered row. Worth saying as
      // such — it is the strongest thing this tally ever supports —
      // and the count is dropped because the denominator in `head`
      // already is it.
      parts.push(`${head}全部都是「${FALL_ACTIVITY_LABELS_ZH[first.key]}」`);
    } else if (first.count > second.count) {
      parts.push(`${head}最多的是「${FALL_ACTIVITY_LABELS_ZH[first.key]}」${first.count} 次`);
    } else {
      parts.push(`${head}${listed}，次数相同，没有更常见的一种`);
    }
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
  return [
    // First, because it is the caveat on everything after it.
    composeFallCapClauseZh(summary),
    composeFallDetailClauseZh(summary),
    composeFallQuarterClauseZh(summary),
  ].filter((clause): clause is string => clause !== null);
};
