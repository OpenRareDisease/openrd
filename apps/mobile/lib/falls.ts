/**
 * 跌倒记录 — types and everything worth asserting.
 *
 * Split from the network calls following this repo's convention: a lib
 * module that imports `./api` at runtime drags in AsyncStorage and
 * cannot be unit-tested (jest-expo has no native module for it, and
 * there is no setup file mocking one). See lib/passport-share.ts, which
 * is split for the same reason. So every branch that decides what this
 * feature is allowed to SAY lives here, and falls-api.ts stays a thin
 * wrapper with nothing in it to get wrong.
 *
 * The API side is apps/api/src/modules/patient-profile/falls/. Read
 * falls.summary.ts there before changing any sentence below — it states
 * the three things the count is not allowed to claim, and this file is
 * the client half of the same promise:
 *
 *   1. NULL MEANS 「没填」, NEVER 「没有」. Every detail field is
 *      optional so a patient who has just been on the floor can save
 *      after one tap. A blank `injured` is not an uninjured fall, and
 *      nothing here may render it as one — which is why
 *      `describeFallDetails` emits nothing at all for a null rather
 *      than a 「否」.
 *   2. NO RECORDS IS NOT NO FALLS. `total === 0` means the diary is
 *      empty. It does not mean the patient has not fallen, and the copy
 *      below says so rather than printing a reassuring zero.
 *   3. A TRUNCATED LIST CANNOT BE COMPARED. `atCap` means the server
 *      hit its row ceiling and the OLDEST falls in the window were
 *      never read, so `total` is a floor and no quarter-to-quarter
 *      claim is honest. The copy switches to 「至少」 and drops the
 *      per-quarter number.
 *
 * AND ONE THING THIS FILE IS ABOUT AS MUCH AS HONESTY: a fall diary
 * that greets someone with a running total and a trend line is a
 * progression alert. `summarizeFallsForCourse` therefore returns ONE
 * number and its caveat — never a comparison between quarters. The
 * comparison exists on the API for the assistant to reason over; it is
 * not something to put in front of a patient who opened 病程 to see
 * how they are doing.
 */

/* ------------------------------------------------------------------ */
/* The two closed enums                                                */
/* ------------------------------------------------------------------ */

/**
 * Mirrors FALL_ACTIVITIES in the API's profile.constants.ts, in the
 * same order — the order is the tie-break the server's 「最多的是」
 * uses, and it is also the order these appear on screen.
 *
 * 'unknown' (记不清) is a real answer and NOT the same as leaving the
 * question alone. A patient who cannot remember has told us something;
 * a patient who skipped the question has not.
 */
export const FALL_ACTIVITIES = [
  'walking',
  'stairs',
  'standing_up',
  'turning',
  'reaching',
  'dressing_or_washing',
  'uneven_or_slippery',
  'other',
  'unknown',
] as const;
export type FallActivity = (typeof FALL_ACTIVITIES)[number];

export const FALL_LOCATIONS = ['indoor', 'outdoor', 'unknown'] as const;
export type FallLocation = (typeof FALL_LOCATIONS)[number];

/**
 * Character-identical to FALL_ACTIVITY_LABELS_ZH / FALL_LOCATION_
 * LABELS_ZH in the API's falls.summary.ts, deliberately.
 *
 * Those labels are what the assistant says back to the patient
 * (「已记录当时情形的 3 次中，最多的是「上下楼梯时」」). If the option
 * the patient tapped were worded differently from the words that come
 * back, the record would look like it had been paraphrased by someone.
 * The form question is phrased to fit these labels rather than the
 * other way round — see FALL_ACTIVITY_QUESTION_ZH.
 */
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

/** Phrased so every option in FALL_ACTIVITY_LABELS_ZH completes it. */
export const FALL_ACTIVITY_QUESTION_ZH = '跌倒发生在';

/* ------------------------------------------------------------------ */
/* What the API hands back                                             */
/* ------------------------------------------------------------------ */

export interface FallRecord {
  id: string;
  /** `YYYY-MM-DD`. A date, never a timestamp — a fall is remembered as
   *  a day, and a synthesised midnight moves it across the date line.
   *  See the API's migration 023. */
  occurredOn: string;
  /** Whole days, as the server computed it in Asia/Shanghai. */
  daysAgo: number;
  activity: FallActivity | null;
  location: FallLocation | null;
  handsFull: boolean | null;
  gotUpUnaided: boolean | null;
  injured: boolean | null;
}

export interface FallQuarterCount {
  /** 0 is the most recent bucket. */
  index: number;
  /** Inclusive age bounds in days, most recent first: index 0 is 0–89. */
  startDaysAgo: number;
  endDaysAgo: number;
  count: number;
}

/**
 * The subset of the API's `FallsSummary` this app renders.
 *
 * The server also returns per-column tallies (location, activity,
 * handsFull, neededHelpUp, injured), and they are deliberately NOT
 * carried here. Every one of them is only sayable together with the
 * denominator it was computed over — 「5 次跌倒，2 次受伤」 asserts three
 * injury-free falls the record does not contain — and this screen has
 * no place that says them. A field parsed and never rendered is a field
 * that drifts into being rendered wrong later.
 */
export interface FallsSummary {
  /** Distinct falls inside the window, counting the ones logged through
   *  the old followup-event route. A FLOOR, not a total, when `atCap`. */
  total: number;
  atCap: boolean;
  /** Most recent first, truncated at the bucket holding the oldest
   *  recorded fall. Empty when there are no falls: a quarter with no
   *  record is not a quiet quarter. */
  quarters: FallQuarterCount[];
  oldestDaysAgo: number | null;
}

export interface FallsListResult {
  falls: FallRecord[];
  summary: FallsSummary;
  windowDays: number;
}

/**
 * How far back this app asks for, in days.
 *
 * Mirrors DEFAULT_FALLS_WINDOW_DAYS in the API's falls.service.ts, and
 * is sent EXPLICITLY on every request rather than left to the server's
 * default. The number ends up inside a sentence the patient reads
 * (「最近 180 天里…」), so the client must not be printing one window
 * while the server counted over another — a drift that would be
 * invisible until the two disagreed.
 */
export const FALLS_WINDOW_DAYS = 180;

/* ------------------------------------------------------------------ */
/* The draft the form holds                                            */
/* ------------------------------------------------------------------ */

/**
 * Everything except `occurredOn` starts null and may stay null. That is
 * the whole shape of this feature: the patient recording a fall is
 * sore, one-handed and an hour late, and a form that costs six answers
 * produces no record at all.
 */
export interface FallDraft {
  occurredOn: string;
  activity: FallActivity | null;
  location: FallLocation | null;
  handsFull: boolean | null;
  gotUpUnaided: boolean | null;
  injured: boolean | null;
}

export const createFallDraft = (now: Date = new Date()): FallDraft => ({
  occurredOn: toLocalIsoDate(now),
  activity: null,
  location: null,
  handsFull: null,
  gotUpUnaided: null,
  injured: null,
});

/**
 * The POST body.
 *
 * Unanswered fields are OMITTED rather than sent as explicit nulls. The
 * schema accepts both, but the request should say what happened: the
 * patient did not answer, so the key is not there. It also keeps the
 * body one tap wide in the common case, which is the case this feature
 * is built for.
 */
export const toCreateFallPayload = (draft: FallDraft): Record<string, unknown> => {
  const payload: Record<string, unknown> = { occurredOn: draft.occurredOn.trim() };
  if (draft.activity !== null) payload.activity = draft.activity;
  if (draft.location !== null) payload.location = draft.location;
  if (draft.handsFull !== null) payload.handsFull = draft.handsFull;
  if (draft.gotUpUnaided !== null) payload.gotUpUnaided = draft.gotUpUnaided;
  if (draft.injured !== null) payload.injured = draft.injured;
  return payload;
};

/* ------------------------------------------------------------------ */
/* Dates, in the patient's own timezone                                */
/* ------------------------------------------------------------------ */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Parse `YYYY-MM-DD` at LOCAL midnight.
 *
 * Deliberately not `new Date(value)`: a bare date string parses as UTC,
 * which in UTC+8 is the previous calendar day for the first eight hours
 * of every day. A patient recording a 07:00 fall would get 昨天 on the
 * chip they tapped 今天 for.
 *
 * Returns null for a date the calendar does not have. The Date
 * constructor rolls 2026-02-31 forward to March 3rd rather than
 * refusing, which would file a fall in the wrong month.
 */
export const parseLocalIsoDate = (value: string): Date | null => {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
};

export const toLocalIsoDate = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** `YYYY-MM-DD` for N days before the device's local today. Drives the
 *  今天 / 昨天 / 前天 chips, which are the whole reason this form can be
 *  completed with one tap. */
export const isoDateDaysAgo = (daysAgo: number, now: Date = new Date()): string => {
  const day = startOfLocalDay(now);
  day.setDate(day.getDate() - daysAgo);
  return toLocalIsoDate(day);
};

/** Whole days between the device's local today and `occurredOn`.
 *  Negative for a future date; null when the string is not a real
 *  calendar date. */
export const localDaysAgo = (occurredOn: string, now: Date = new Date()): number | null => {
  const date = parseLocalIsoDate(occurredOn);
  if (!date) return null;
  return Math.round((startOfLocalDay(now).getTime() - date.getTime()) / MS_PER_DAY);
};

/** The quick-pick chips, and the only date entry most records need. */
export const FALL_DATE_QUICK_PICKS = [
  { daysAgo: 0, label: '今天' },
  { daysAgo: 1, label: '昨天' },
  { daysAgo: 2, label: '前天' },
] as const;

/**
 * Refuse a date this app cannot honestly file, and say why in a
 * sentence the patient can act on.
 *
 * STRICTER THAN THE SERVER, ON PURPOSE. The API accepts one day past
 * its own clock (falls.schema.ts) because the server's clock is not the
 * patient's and a legitimate save must not fail on skew. Here we ARE
 * the patient's clock, so there is no skew to tolerate: the failure
 * this guard is for is a mistyped year sitting in the record forever as
 * a fall that never happened.
 */
export const validateFallDate = (value: string, now: Date = new Date()): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return '请填一下是哪一天。';
  if (!ISO_DATE.test(trimmed)) return '日期写成 2026-08-06 这样的「年-月-日」。';
  const age = localDaysAgo(trimmed, now);
  if (age === null) return '日历上没有这一天，看看月份和日号。';
  if (age < 0) return '这一天还没到。跌倒的日期只能是今天或更早。';
  return null;
};

/**
 * 今天 / 昨天 / 前天 / 4 天前 / the date itself.
 *
 * Computed from `occurredOn` against the DEVICE's local today, not from
 * the server's `daysAgo`. The two agree for everyone in China, and when
 * they do not, the label must match the date printed beside it rather
 * than a different timezone's arithmetic.
 *
 * Past a week it falls back to the raw date: 「23 天前」 is a number the
 * reader has to convert, and by then the date is what they are actually
 * scanning for.
 */
export const describeFallDay = (occurredOn: string, now: Date = new Date()): string => {
  const age = localDaysAgo(occurredOn, now);
  if (age === null || age < 0) return occurredOn;
  if (age === 0) return '今天';
  if (age === 1) return '昨天';
  if (age === 2) return '前天';
  if (age <= 6) return `${age} 天前`;
  return occurredOn;
};

/* ------------------------------------------------------------------ */
/* Saying what one record contains — and only what it contains         */
/* ------------------------------------------------------------------ */

/**
 * The chips under one diary entry.
 *
 * A null field produces NOTHING. Not 「未受伤」, not 「双手空着」, not a
 * greyed-out placeholder: the record does not say, so the screen does
 * not either. This is the client half of refusal (1) in the API's
 * falls.summary.ts, and it is the single easiest thing to get wrong
 * here — every one of these is a boolean, and rendering `false` and
 * `null` through the same ternary is how a blank becomes a 「否」.
 */
export const describeFallDetails = (fall: FallRecord): string[] => {
  const chips: string[] = [];
  if (fall.location !== null) chips.push(FALL_LOCATION_LABELS_ZH[fall.location]);
  if (fall.activity !== null) chips.push(FALL_ACTIVITY_LABELS_ZH[fall.activity]);
  if (fall.handsFull !== null) chips.push(fall.handsFull ? '双手拿着东西' : '双手是空的');
  if (fall.gotUpUnaided !== null) {
    chips.push(fall.gotUpUnaided ? '自己起来的' : '需要人扶才起来');
  }
  if (fall.injured !== null) chips.push(fall.injured ? '受了伤' : '没受伤');
  return chips;
};

/**
 * What to say after a save lands.
 *
 * The interesting case is a fall further back than the diary's
 * look-back window. It saved — and the API wrote its 病程时间线 twin in
 * the same transaction (falls.service.ts `recordFall`), so it is not
 * lost — but both the list and the count below clamp to `windowDays`,
 * so it will not appear there. Without this sentence the patient types
 * a date from two years ago, sees 「已保存」, and then sees nothing.
 */
export const describeSaveOutcome = (
  fall: FallRecord,
  windowDays: number,
  now: Date = new Date(),
): string => {
  const saved = `已经记下 ${fall.occurredOn} 这一次。`;
  const age = localDaysAgo(fall.occurredOn, now) ?? fall.daysAgo;
  if (age > windowDays) {
    return (
      `${saved}下面的列表只回看最近 ${windowDays} 天，所以这一条不会出现在里面；` +
      '它已经记在你的病程时间线上了。'
    );
  }
  return saved;
};

/* ------------------------------------------------------------------ */
/* The count, where the patient already reads their own course         */
/* ------------------------------------------------------------------ */

export interface FallsCourseNote {
  headline: string;
  /** The sentence that keeps the number from being read as more than it
   *  is. Null when there is nothing to qualify. */
  caveat: string | null;
}

/**
 * One number for 病程, and the caveat that keeps it honest.
 *
 * DELIBERATELY NOT A TREND. `summary.quarters` carries every bucket and
 * the API composes a quarter-by-quarter clause from them, but that
 * clause exists for the assistant to reason over when asked. Rendering
 * it here would put 「2 次、1 次、4 次」 on the screen a patient opens to
 * see how they are doing, which is a progression alert wearing a
 * statistic. One quarter, one number, no arrow.
 *
 * The empty case says what a blank means rather than printing a zero.
 * A patient who fell twice last month and has not opened this feature
 * yet must not be shown 「0 次跌倒」 by their own record.
 */
export const summarizeFallsForCourse = (
  summary: FallsSummary,
  windowDays: number,
): FallsCourseNote => {
  if (summary.total <= 0) {
    return {
      headline: '还没有跌倒记录。',
      // About the blank, not about the person. Nothing here implies
      // they were supposed to have filled something in.
      caveat: '空白只代表这里没有记录，不代表没有跌倒过。',
    };
  }

  if (summary.atCap) {
    // The server stopped reading at its row ceiling and the OLDEST
    // falls are the ones it never got to, so `total` is a floor and no
    // per-quarter number is safe. Refusal (3) in falls.summary.ts.
    return {
      headline: `最近 ${windowDays} 天里，至少记录到 ${summary.total} 次跌倒。`,
      caveat: '记录条数超过了一次能读取的上限，实际次数可能更多。',
    };
  }

  const recent = summary.quarters[0] ?? null;
  const recentDays = recent ? recent.endDaysAgo + 1 : windowDays;
  const headline =
    recent && recent.count > 0
      ? `最近 ${recentDays} 天记录到 ${recent.count} 次跌倒` +
        (summary.total > recent.count ? `，${windowDays} 天内一共 ${summary.total} 次。` : '。')
      : `最近 ${recentDays} 天没有新的跌倒记录；再往前，${windowDays} 天内记录到 ${summary.total} 次。`;

  // The API's own refusal (2), said to the patient: buckets stop at the
  // oldest fall on record, and the quiet stretch before it is
  // unobserved rather than fall-free.
  const caveat =
    summary.oldestDaysAgo !== null
      ? `最早的一条记录在 ${summary.oldestDaysAgo} 天前，更早的时段没有记录，不能当作没有跌倒。`
      : null;

  return { headline, caveat };
};

/**
 * Falls the count knows about that the list cannot show.
 *
 * `summary.total` is computed over the full history — diary entries
 * PLUS falls logged through the original followup-event route, which
 * have no diary row. So the two numbers legitimately differ, and a
 * screen showing the shorter list as if it were everything would be
 * telling a patient their earlier falls are gone.
 */
export const describeUnlistedFalls = (
  summary: FallsSummary,
  listedCount: number,
): string | null => {
  const missing = summary.total - listedCount;
  if (missing <= 0) return null;
  if (summary.atCap) {
    return `还有 ${missing} 次或更多跌倒不在下面的列表里 —— 一次能读取的条数已经到上限了。`;
  }
  return `还有 ${missing} 次跌倒是以前用别的方式记下的，只有日期，所以不在下面的列表里。`;
};
