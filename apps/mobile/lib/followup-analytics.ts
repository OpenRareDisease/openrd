import type { PatientFunctionTest, PatientProfile, ProgressionSummary } from './api';
import { ambulationLabel } from './profile-baseline-options';
import {
  decodeProtocolField,
  findTimedTest,
  gradeOption,
  shouldExcludeFromTrend,
} from './timed-test-protocols';

export type DomainTrendKey = 'upper_limb' | 'lower_limb' | 'face' | 'breathing' | 'symptoms';

export interface DomainTrendPoint {
  date: string;
  timestamp: string;
  value: number;
}

export interface DomainTrendCard {
  key: DomainTrendKey;
  label: string;
  currentValue: number | null;
  previousValue: number | null;
  delta: number | null;
  trend: 'better' | 'stable' | 'worse' | 'new';
  summary: string;
  points: DomainTrendPoint[];
  hasData: boolean;
}

export interface DiseaseBackgroundFact {
  label: string;
  value: string;
}

export type PatientVisualizationKey = 'sleep_quality' | 'stair_climb' | 'fall_count';

export interface PatientVisualizationCard {
  key: PatientVisualizationKey;
  label: string;
  latestDisplay: string;
  latestValue: number | null;
  previousValue: number | null;
  trend: 'better' | 'stable' | 'worse' | 'new';
  summary: string;
  helperText: string;
  points: DomainTrendPoint[];
  unit?: string;
  chartColor: string;
}

export interface ProgressionTimelineItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  tag: '事件' | '报告' | '功能测试' | '日常记录';
  documentId?: string | null;
}

const upperLimbKeys = new Set([
  'deltoid',
  'biceps',
  'triceps',
  'shoulder_abduction',
  'shoulder_abduction_mrc',
  'arm_raise_over_head',
  'elbow_flexion',
]);

const lowerLimbKeys = new Set([
  'tibialis',
  'quadriceps',
  'hamstrings',
  'gluteus',
  'ankle_dorsiflexion',
  'knee_extension',
]);

const faceKeys = new Set(['eye_closure', 'lip_pursing']);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Asia/Shanghai, the value `PRODUCT_TIME_ZONE` in ./clinical-visuals
 * declares, as the fixed offset that file's comment explains it has to
 * be: this runs on Hermes, where a full ICU timezone database is not
 * something to depend on, and China has been one UTC+8 zone with no
 * daylight saving since 1991. The test file pins the two together so
 * this constant cannot drift away from the declaration.
 */
const PRODUCT_UTC_OFFSET_MINUTES = 8 * 60;

/**
 * THE CALENDAR DAY AN INSTANT FALLS ON, ON THE PRODUCT'S CALENDAR.
 *
 * Every bucket in this file is keyed by this function, and every chart
 * built on those buckets labels its x axis with `formatDateLabel`
 * (./clinical-visuals), which resolves the same instant on
 * Asia/Shanghai. Slicing `toISOString()` here cut the day at 08:00
 * Beijing instead, so the axis and the bucketing disagreed for every
 * record filed between midnight and breakfast.
 *
 * WHAT THAT DID TO THE CARDS. Two submissions on ONE Beijing morning —
 * 00:30 and 09:00, the practice attempt and the real one — landed in
 * two different buckets. `pushLatestValue` never got to collapse them,
 * so 上楼计时 printed 「比上次更快」 and 睡眠质量 printed 「比上次更差」
 * out of a pair of readings two hours apart, which is the exact
 * rendering `pushLatestValue` exists to prevent; and 跌倒次数 called
 * that single day 「连续 2 天有日常记录」.
 *
 * A BARE 「YYYY-MM-DD」 IS NOT SHIFTED. A calendar date has no zone to
 * convert between — the digits are the answer, the same rule
 * ./clinical-visuals states for `DATE_ONLY`. `followup_events`
 * `occurredAt` arrives as a bare date from the daily form, and this
 * branch keeps the offset out of it whatever the offset later becomes.
 */
const toIsoDate = (value: string) => {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    return trimmed;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return trimmed.slice(0, 10);
  }
  // Shift onto the product calendar, then read it back with the UTC
  // accessors — the only ones on `Date` that do not consult whatever
  // zone this handset happens to be set to.
  return new Date(date.getTime() + PRODUCT_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
};

const roundOne = (value: number) => Number(value.toFixed(1));

const average = (values: number[]) => {
  if (!values.length) {
    return null;
  }

  return roundOne(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const pushBucketValue = (
  buckets: Map<string, { timestamp: string; values: number[] }>,
  timestamp: string,
  value: number,
) => {
  const key = toIsoDate(timestamp);
  const current = buckets.get(key);
  if (current) {
    current.values.push(value);
    if (new Date(timestamp).getTime() > new Date(current.timestamp).getTime()) {
      current.timestamp = timestamp;
    }
    return;
  }

  buckets.set(key, { timestamp, values: [value] });
};

/**
 * A DAY BUCKET THAT KEEPS THE DAY'S LATEST READING, AND NOT AN AVERAGE
 * OF THE DAY'S READINGS.
 *
 * WHAT THIS REPLACED, AND WHY IT HAD TO BE REPLACED. 睡眠质量 and 上楼
 * 计时 went through `pushBucketValue` above and came back out of
 * `finalizeTrendPoints` as a per-day MEAN, and then `getSleepSummary`
 * and `getStairSummary` put 「最近一次」 in front of it. Two submissions
 * on one day is not an edge case here: 上楼计时 is routinely done twice
 * in a sitting, a practice attempt and then the real one — the pattern
 * the AI retriever's own note (patient-followups.ts) describes, and
 * refuses to read as a trend for exactly this reason. A 30 秒 practice
 * run and a 12 秒 real one came out as 「最近一次 10 级台阶用时 21.0
 * 秒」, a number the patient never recorded, on the tracked functional
 * metric; sleep scores of 8 and 2 came out as 「最近一次睡眠评分一般」
 * when the reading that actually happened last was a 2. 我的随访计划
 * reads the same rows straight off `symptomScores` and told the same
 * patient 「你最近一次睡眠评分是 2/10」 in the same session.
 *
 * 最近一次 HAS TO BE A READING THAT HAPPENED, so the bucket keeps the
 * latest one instead of averaging. The chart still shows one point per
 * day — its x labels are formatted days and two points on one day
 * collide — but every point on it is now a number someone wrote down.
 *
 * ON AN EXACT TIMESTAMP TIE the first row seen wins, and no ordering of
 * the two is defensible: the retriever's note records that the tiebreak
 * between same-instant rows lives inside an ORDER BY and is arbitrary.
 * First-seen at least keeps this function's answer stable for one
 * payload instead of depending on which arm of a sort ran.
 *
 * GENERIC IN THE VALUE because the stair series' reading is not a
 * number: 「今天做不了」 is a reading too, and it has to be able to win
 * the day against an earlier climb that does carry seconds. See
 * `StairReading`.
 *
 * NOT FOR THE DOMAIN TREND CARDS — see `finalizeTrendPoints` below.
 */
const pushLatestValue = <T>(
  buckets: Map<string, { timestamp: string; value: T }>,
  timestamp: string,
  value: T,
) => {
  const key = toIsoDate(timestamp);
  const current = buckets.get(key);
  if (current && new Date(timestamp).getTime() <= new Date(current.timestamp).getTime()) {
    return;
  }

  buckets.set(key, { timestamp, value });
};

/** How many points a trend chart shows. */
const CHART_POINT_LIMIT = 6;

/**
 * The averaging finalizer, and it still averages ON PURPOSE.
 *
 * Its only callers are the domain trend cards, where one day's bucket
 * holds several DIFFERENT metrics — deltoid, biceps and triceps all
 * land in 上肢 — and the mean across them is the composite the card is
 * about. Nothing built on it claims to be one observation:
 * `formatTrendSummary` says 「上肢目前影响较明显」, a level, never
 * 「最近一次」. The patient visualization cards used to share this
 * function and did make that claim; they use `pushLatestValue` /
 * `finalizeScalarPoints` now.
 */
const finalizeTrendPoints = (
  buckets: Map<string, { timestamp: string; values: number[] }>,
  limit = CHART_POINT_LIMIT,
): DomainTrendPoint[] =>
  Array.from(buckets.entries())
    .map(([date, item]) => ({
      date,
      timestamp: item.timestamp,
      value: average(item.values) ?? 0,
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-limit);

/**
 * The finalizer for a bucket that already holds ONE number per day —
 * the day's total for 跌倒次数, the day's latest reading for 睡眠质量.
 * Nothing here reduces anything; the reduction happened on the way in,
 * where the caller could still say what it meant.
 *
 * 上楼计时 no longer comes through here: its day value can be 「no
 * seconds, and that is the reading」, which is not a number. See
 * `StairReading`.
 *
 * One function rather than a per-card copy: the twin of this that this
 * file used to keep (`finalizeSummedPoints`, byte for byte the same
 * body) is the shape a later change gets applied to only one of.
 */
const finalizeScalarPoints = (
  buckets: Map<string, { timestamp: string; value: number }>,
  limit = CHART_POINT_LIMIT,
): DomainTrendPoint[] =>
  Array.from(buckets.entries())
    .map(([date, item]) => ({
      date,
      timestamp: item.timestamp,
      value: roundOne(item.value),
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-limit);

const toBurdenFromStrength = (score: number) => roundOne((5 - score) * 2);

const formatTrendSummary = (label: string, current: number | null, delta: number | null) => {
  if (current === null) {
    return `${label}还没有足够记录。`;
  }

  const level = current >= 7 ? '较明显' : current >= 4 ? '中等' : '较轻';
  if (delta === null) {
    return `${label}目前影响${level}，已建立第一条趋势记录。`;
  }

  if (delta === 0) {
    return `${label}目前影响${level}，和上次相比变化不大。`;
  }

  return delta > 0
    ? `${label}目前影响${level}，比上次更明显。`
    : `${label}目前影响${level}，比上次减轻。`;
};

const buildTrendCard = (
  key: DomainTrendKey,
  label: string,
  points: DomainTrendPoint[],
): DomainTrendCard => {
  const currentValue = points.length ? points[points.length - 1].value : null;
  const previousValue = points.length > 1 ? points[points.length - 2].value : null;
  const delta =
    currentValue !== null && previousValue !== null ? roundOne(currentValue - previousValue) : null;
  const trend: DomainTrendCard['trend'] =
    currentValue === null
      ? 'stable'
      : previousValue === null
        ? 'new'
        : delta === 0
          ? 'stable'
          : delta !== null && delta > 0
            ? 'worse'
            : 'better';

  return {
    key,
    label,
    currentValue,
    previousValue,
    delta,
    trend,
    summary: formatTrendSummary(label, currentValue, delta),
    points,
    hasData: currentValue !== null,
  };
};

const resolveComparisonTrend = (
  currentValue: number | null,
  previousValue: number | null,
  direction: 'higher_better' | 'lower_better',
): PatientVisualizationCard['trend'] => {
  if (currentValue === null) {
    return 'stable';
  }

  if (previousValue === null) {
    return 'new';
  }

  if (currentValue === previousValue) {
    return 'stable';
  }

  if (direction === 'higher_better') {
    return currentValue > previousValue ? 'better' : 'worse';
  }

  return currentValue < previousValue ? 'better' : 'worse';
};

/**
 * 「最近一次」 IS A PROMISE ABOUT WHAT `currentValue` IS, and the two
 * summaries below are the only place this file makes it. It holds only
 * because the caller now hands them the day's latest reading rather
 * than the day's mean — see `pushLatestValue`. A future caller that
 * goes back to averaging has to change this wording with it.
 */
const getSleepSummary = (
  currentValue: number | null,
  previousValue: number | null,
): Pick<PatientVisualizationCard, 'latestDisplay' | 'summary' | 'helperText'> => {
  if (currentValue === null) {
    return {
      latestDisplay: '未记录',
      summary: '最近还没有新的睡眠评分。',
      helperText: '0-2 很差，3-4 较差，5-6 一般，7-8 较好，9-10 很好。',
    };
  }

  const level =
    currentValue >= 9
      ? '睡得很好'
      : currentValue >= 7
        ? '整体较好'
        : currentValue >= 5
          ? '一般'
          : currentValue >= 3
            ? '偏差'
            : '很差';
  const comparison =
    previousValue === null
      ? '已建立第一条睡眠记录。'
      : currentValue === previousValue
        ? '和上次相比变化不大。'
        : currentValue > previousValue
          ? '比上次更好。'
          : '比上次更差。';

  return {
    latestDisplay: `${Math.round(currentValue)}/10`,
    summary: `最近一次睡眠评分${level}，${comparison}`,
    helperText: '0-2 很差，3-4 较差，5-6 一般，7-8 较好，9-10 很好。',
  };
};

/** The `protocol` string the daily record's stair row carries, written
 *  by p-data_entry `handleFollowupSubmit` and by nothing else, on every
 *  submission since that form existed. */
const DAILY_RECORD_STAIR_PROTOCOL = '连续上 10 级台阶';

/** The one timed-test protocol that also files under `stair_climb`. */
const TIMED_STAIR_TEST_ID = 'stair_four_step';

/**
 * 「今天做不了」 — attempted and could not be completed.
 *
 * Three different things arrive on a stair row and only two of them
 * used to be distinguishable here: a completed climb (seconds), an
 * attempt that could not be completed (this), and no record at all
 * (no row). `not_applicable` is the typed carrier for the middle one
 * (migration 017; before it the meaning lived in `notes`, which the AI
 * retriever deliberately never reads), and the server sends it as
 * `notApplicable` on every function test it serialises.
 *
 * READ STRUCTURALLY because `PatientFunctionTest` in ./api does not
 * declare the field yet — see the note in the lane report; the field
 * belongs on that interface and this cast should go when it lands.
 *
 * A NULL MEASUREMENT IS NOT USED AS THE SIGNAL. A row with no value and
 * no flag is a row that carries no reading, for whatever reason its
 * writer had; rendering that as 「上不了 10 级台阶」 would put a
 * clinical claim on the patient's screen that nobody entered.
 */
const isUnableRecord = (item: PatientFunctionTest): boolean =>
  (item as PatientFunctionTest & { notApplicable?: boolean | null }).notApplicable === true;

/**
 * One day's stair reading.
 *
 * `seconds: null` is NOT missing data — it is the record the patient
 * made when they marked 今天做不了, and the screen that writes it tells
 * them 「这是一条数据，不是空白——趋势里看得到」. A day the patient did
 * not record has no `StairReading` at all.
 */
interface StairReading {
  date: string;
  timestamp: string;
  seconds: number | null;
}

/**
 * The one stair measurement this card is currently showing.
 *
 * TWO DIFFERENT MEASUREMENTS FILE UNDER `testType: 'stair_climb'`, and
 * this card used to plot both on one line: the daily record's 连续上
 * 10 级台阶, and the timed-test card's 四级台阶上下, which is four
 * steps UP AND BACK DOWN. Subtracting one from the other is the
 * furniture-moved-not-the-disease error lib/timed-test-protocols was
 * written to stop. Run over a patient with one 12 秒 ten-step record
 * and two four-step runs, the merged line printed 「最近一次 10 级台阶
 * 用时25.0 秒，整体偏慢，比上次更慢」 — the 25 秒 being a 自由记录
 * four-step attempt, and 「比上次」 being that attempt against a per
 * protocol one.
 *
 * So the series names its measurement and carries only that one.
 * 连续上 10 级台阶 wins whenever the patient has any of it, because it
 * is the one the daily record asks for at every followup and the one
 * the card's helper text names. The 四级台阶 series is the fallback for
 * a patient who only ever uses the timed-test card — without it, a
 * patient who ran that test per protocol would see no trend line at
 * all, while the grade picker had just told them 「只有这一档会画进趋
 * 势线」.
 */
interface StairSeries {
  /** What the seconds measure, in the words the capturing screen uses. */
  measurementZh: string;
  /** How the patient's own screen words 做不了 for this measurement. */
  unableZh: string;
  /**
   * Whether the 较轻松 / 尚可 / 偏慢 / 较慢 wording below may be applied.
   * Those cut-offs were written for ten steps up. Four steps up and
   * back down is a different distance, and grading it against them
   * would be a made-up threshold — the one thing
   * lib/timed-test-protocols says this repo must never ship.
   */
  gradedAgainstTenStep: boolean;
  /** One reading per day, oldest first, over the whole history. */
  readings: StairReading[];
  /** The patient has 四级台阶 records that are deliberately not on this
   *  line, so the helper text can say where they went. */
  hasSeparateTimedStairRecords: boolean;
}

const collectStairReadings = (tests: PatientFunctionTest[]): StairReading[] => {
  const buckets = new Map<string, { timestamp: string; value: number | null }>();

  tests.forEach((item) => {
    if (isUnableRecord(item)) {
      pushLatestValue(buckets, item.performedAt, null);
      return;
    }
    const value = Number(item.measuredValue);
    if (
      item.measuredValue === null ||
      item.measuredValue === undefined ||
      !Number.isFinite(value)
    ) {
      // No reading of either kind on this row. Not a day.
      return;
    }
    pushLatestValue(buckets, item.performedAt, value);
  });

  return Array.from(buckets.entries())
    .map(([date, item]) => ({
      date,
      timestamp: item.timestamp,
      seconds: item.value === null ? null : roundOne(item.value),
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
};

const buildStairSeries = (profile: PatientProfile | null): StairSeries => {
  const stairTests = profile?.functionTests.filter((item) => item.testType === 'stair_climb') ?? [];
  const dailyTests = stairTests.filter((item) => item.protocol === DAILY_RECORD_STAIR_PROTOCOL);
  const timedTests = stairTests.filter(
    (item) => decodeProtocolField(item.protocol)?.testId === TIMED_STAIR_TEST_ID,
  );
  // The grade gate, and its only production caller. The patient is told
  // on the grade picker that 按方案完成 is the one grade that gets
  // plotted, and that 条件不完整 / 自由记录 「会存下来，也会显示，但不会
  // 和别的次数放在一条趋势线上比」 — 显示 being the progression
  // timeline `buildProgressionTimeline` builds further down this file
  // (the 时间轴 tab), which titles such a record by its protocol and
  // prints the grade that is keeping it off this line.
  const timedOnTrend = timedTests.filter((item) => !shouldExcludeFromTrend(item.protocol));
  const dailyReadings = collectStairReadings(dailyTests);
  const timedReadings = dailyReadings.length > 0 ? [] : collectStairReadings(timedOnTrend);

  if (timedReadings.length === 0) {
    return {
      measurementZh: '连续上 10 级台阶',
      unableZh: '上不了 10 级台阶',
      gradedAgainstTenStep: true,
      readings: dailyReadings,
      hasSeparateTimedStairRecords: timedTests.length > 0,
    };
  }

  const timedName = findTimedTest(TIMED_STAIR_TEST_ID)?.nameZh ?? '四级台阶上下';
  return {
    measurementZh: timedName,
    unableZh: `做不了${timedName}`,
    gradedAgainstTenStep: false,
    readings: timedReadings,
    hasSeparateTimedStairRecords: false,
  };
};

/** The most recent readings, and what came before them. */
interface StairState {
  current: StairReading | null;
  previous: StairReading | null;
  /** How many of the most recent days in a row came back 做不了.
   *  Counted over the full history, like the fall-card streak. */
  unableDayStreak: number;
  /** The newest reading that actually carries seconds, if any. */
  lastMeasuredSeconds: number | null;
}

const resolveStairState = (readings: StairReading[]): StairState => {
  const current = readings.length ? readings[readings.length - 1] : null;
  const previous = readings.length > 1 ? readings[readings.length - 2] : null;

  let unableDayStreak = 0;
  for (let index = readings.length - 1; index >= 0; index -= 1) {
    if (readings[index].seconds !== null) {
      break;
    }
    unableDayStreak += 1;
  }

  let lastMeasuredSeconds: number | null = null;
  for (let index = readings.length - 1; index >= 0; index -= 1) {
    const seconds = readings[index].seconds;
    if (seconds !== null) {
      lastMeasuredSeconds = seconds;
      break;
    }
  }

  return { current, previous, unableDayStreak, lastMeasuredSeconds };
};

/**
 * 能做 → 做不了 is the largest change this card can carry and the only
 * one with no numeric delta to threshold — the same judgement the
 * daily form makes when it decides a submission 有变化. It cannot go
 * through `resolveComparisonTrend`, which reads a null current value as
 * 「no data」 and answers 平稳.
 */
const resolveStairTrend = (state: StairState): PatientVisualizationCard['trend'] => {
  if (!state.current) {
    return 'stable';
  }
  if (!state.previous) {
    return 'new';
  }
  if (state.current.seconds === null) {
    return state.previous.seconds === null ? 'stable' : 'worse';
  }
  if (state.previous.seconds === null) {
    return 'better';
  }
  return resolveComparisonTrend(state.current.seconds, state.previous.seconds, 'lower_better');
};

const stairHelperText = (series: StairSeries) => {
  if (!series.gradedAgainstTenStep) {
    return `只有标记为“按方案完成”的「${series.measurementZh}」会画进这条线；台阶高度各家不同，这个秒数只和你自己同一段楼梯比。`;
  }
  const base = '统一按“连续上 10 级台阶”填写用时，越短通常表示完成越轻松。';
  return series.hasSeparateTimedStairRecords
    ? `${base}你记录的「四级台阶上下」是另一项测试，秒数不能和这条线放在一起比，它在“时间轴”里。`
    : base;
};

/**
 * THE 上楼计时 CARD'S WORDS, AND WHAT EACH OF THEM PROMISES.
 *
 * 「最近一次」 — the newest reading that happened, never a mean; see
 * `pushLatestValue`.
 *
 * 「上不了 10 级台阶」 — a 今天做不了 record, which this card used to
 * drop on the floor. The stair series filtered on `measuredValue !==
 * null`, so a patient who could climb in 12 秒 three weeks ago and has
 * recorded 做不了 three times since was shown 「最近一次 10 级台阶用时
 * 12.0 秒，整体尚可，已建立第一条上楼计时。」 with a 新增 badge — a
 * three-week-old number presented as the latest one, and presented as
 * the ONLY one, on the screen that had promised them 「这是一条数据，
 * 不是空白——趋势里看得到」.
 *
 * 整体较轻松 / 尚可 / 偏慢 / 较慢 — a level for TEN STEPS UP, and only
 * ever printed for that measurement. See `StairSeries`.
 */
const getStairSummary = (
  series: StairSeries,
  state: StairState,
  hasLegacyImpact: boolean,
): Pick<PatientVisualizationCard, 'latestDisplay' | 'summary' | 'helperText'> => {
  const helperText = stairHelperText(series);

  // Always the 连续上 10 级台阶 series here, which is why this branch may
  // name it: `buildStairSeries` only returns the 四级台阶 fallback when
  // that fallback has readings, so an empty series is the ten-step one.
  if (!state.current) {
    return {
      latestDisplay: hasLegacyImpact ? '待量化' : '未记录',
      summary: hasLegacyImpact
        ? '已记录上楼变化，但还没有“连续上 10 级台阶”的标准化秒数。'
        : '最近还没有新的标准化上楼计时。',
      helperText,
    };
  }

  if (state.current.seconds === null) {
    const head =
      state.unableDayStreak > 1
        ? `最近连续 ${state.unableDayStreak} 天的记录都是「${series.unableZh}」。`
        : `最近一次记录是「${series.unableZh}」，这是一条记录，不是空白。`;
    const tail =
      state.lastMeasuredSeconds === null
        ? '目前还没有过带秒数的记录。'
        : `在这之前，最近一次有秒数的记录是 ${state.lastMeasuredSeconds.toFixed(1)} 秒。`;

    return { latestDisplay: '无法完成', summary: `${head}${tail}`, helperText };
  }

  const currentValue = state.current.seconds;
  const previousSeconds = state.previous?.seconds ?? null;
  const level = series.gradedAgainstTenStep
    ? currentValue <= 10
      ? '整体较轻松，'
      : currentValue <= 20
        ? '整体尚可，'
        : currentValue <= 30
          ? '整体偏慢，'
          : '整体较慢，'
    : '';
  const comparison = !state.previous
    ? `已建立第一条${series.measurementZh}记录。`
    : previousSeconds === null
      ? `上一个有记录的日子是「${series.unableZh}」，这次做到了。`
      : currentValue === previousSeconds
        ? '和上次差不多。'
        : currentValue < previousSeconds
          ? '比上次更快。'
          : '比上次更慢。';

  return {
    latestDisplay: `${currentValue.toFixed(1)} 秒`,
    summary: `最近一次${series.measurementZh}用时 ${currentValue.toFixed(1)} 秒，${level}${comparison}`,
    helperText,
  };
};

const FALL_HELPER_TEXT = '每次日常记录都会问“最近跌倒次数”，答 0 次同样是记录。';

/**
 * THIS CARD COUNTS DAYS, AND IT USED TO SAY IT COUNTED RECORDS.
 *
 * `fallBuckets` is keyed by calendar day on purpose — the seeded zero
 * and the `fall` events that land on top of it have to meet somewhere,
 * and the event's `occurred_at` is written as a bare date by the daily
 * form, so a day is the only key the two share. That is not the defect.
 * The defect was the wording built on it: a day total was printed as
 * 「最近一次记录跌倒 N 次」 and a run of days as 「已经连续 N 次日常
 * 记录没有跌倒」.
 *
 * Both are false the moment a patient files twice in one day, which the
 * form invites — it pre-fills 跌倒次数 from the previous event, so the
 * second submission of an afternoon re-sends the same answer. Two
 * records each reporting 「最近跌倒 2 次」 rendered as 「最近一次记录
 * 跌倒 4 次」: a count no record holds, attributed to one record. Three
 * daily records over two days rendered as 「连续 2 次日常记录」 when
 * there were three.
 *
 * So the sentences say day, because a day is what the number is. The
 * sleep and stair cards took the other road offered — they kept their
 * 「最近一次」 wording and take the day's actual latest reading instead
 * (see `pushLatestValue`) — and that road is closed here: the seeded
 * zero carries the daily record's real timestamp while the fall event
 * carries a bare date, so 「latest wins」 would keep every zero and
 * throw away every fall reported on the same day.
 *
 * WHICH DAY a fall lands on is decided by the submission it was filed
 * with rather than by that bare date, which the write side stamps in
 * the device's UTC — see the comment at the `fallBuckets` event loop.
 *
 * WHAT IS STILL WRONG AND IS NOT THIS FILE'S TO FIX: 「最近跌倒 N 次」
 * is a standing answer about a period, not an increment, and summing
 * two of them in a day double-counts. Deciding that belongs with the
 * write side that composes the description.
 */
const getFallSummary = (
  currentValue: number | null,
  previousValue: number | null,
  zeroRecordDayStreak: number,
): Pick<PatientVisualizationCard, 'latestDisplay' | 'summary' | 'helperText'> => {
  // Only "no daily record has ever been made" lands here. A record
  // that answered 0 is a result, and is handled below.
  if (currentValue === null) {
    return {
      latestDisplay: '未记录',
      summary: '还没有可以统计跌倒次数的日常记录。',
      helperText: FALL_HELPER_TEXT,
    };
  }

  if (currentValue === 0) {
    return {
      latestDisplay: '0 次',
      summary:
        zeroRecordDayStreak > 1
          ? `最近连续 ${zeroRecordDayStreak} 天有日常记录，都没有跌倒。`
          : previousValue === null
            ? '最近一天的日常记录没有跌倒。'
            : // A streak of 1 means the day before it wasn't zero.
              '最近一天的日常记录没有跌倒，比上一个有记录的日子更少。',
      helperText: FALL_HELPER_TEXT,
    };
  }

  const comparison =
    previousValue === null
      ? '已建立第一条跌倒记录。'
      : currentValue === previousValue
        ? '和上一个有记录的日子相比次数接近。'
        : currentValue < previousValue
          ? '比上一个有记录的日子更少。'
          : '比上一个有记录的日子更多。';

  return {
    latestDisplay: `${Math.round(currentValue)} 次`,
    summary: `最近一天的记录里一共跌倒 ${Math.round(currentValue)} 次，${comparison}`,
    helperText: FALL_HELPER_TEXT,
  };
};

interface FollowupRecordDays {
  /** Calendar day → the latest daily-record timestamp on it. */
  days: Map<string, string>;
  /** Submission id → the calendar day its daily record belongs to. */
  daysBySubmission: Map<string, string>;
}

/**
 * Days on which the patient completed a daily record.
 *
 * WHAT COUNTS AS EVIDENCE. The daily form (p-data_entry
 * `handleFollowupSubmit`) always asks 跌倒次数, and it always writes one
 * stair-climb row stamped `protocol: '连续上 10 级台阶'` — including
 * when the patient marks 今天做不了, which posts the row with a null
 * measurement precisely so the day is not blank. That row is the mark
 * of 「this submission asked about falls」, and it is what this function
 * looks for.
 *
 * WHAT IT USED TO LOOK FOR, AND WHY THAT STOPPED BEING TRUE. It
 * required a sleep_quality row AND a stair row under one submission,
 * and its comment asserted that a daily record writes both. That was a
 * true description of the form once. It is not now: a patient who marks
 * 睡眠：本次未评价 gets NO sleep row at all — the 0-10 scale has no
 * 「未评价」 value, so the form writes nothing rather than the default 6
 * nobody chose. Such a patient filed a record, answered 跌倒次数 0, and
 * their day was missing from this map, so the fall card told them
 * 「还没有可以统计跌倒次数的日常记录」 on a day they had just made one.
 *
 * A STAIR ROW ON ITS OWN IS STILL NOT ENOUGH, which is what the
 * protocol match is for — it is the same distinction the old sleep
 * pairing was reaching for, made against the thing that actually
 * identifies the form. The timed-test card writes 四级台阶上下 under the
 * same `stair_climb` testType and never asks about falls; its rows
 * carry an encoded 「tt1|…」 protocol. Reading one of those as a daily
 * record would invent a 「0 falls」 answer nobody gave.
 */
const collectFollowupRecordDays = (profile: PatientProfile | null): FollowupRecordDays => {
  const days = new Map<string, string>();
  const daysBySubmission = new Map<string, string>();

  profile?.functionTests.forEach((item) => {
    if (item.testType !== 'stair_climb' || item.protocol !== DAILY_RECORD_STAIR_PROTOCOL) {
      return;
    }

    const key = toIsoDate(item.performedAt);
    const current = days.get(key);
    if (!current || new Date(item.performedAt).getTime() > new Date(current).getTime()) {
      days.set(key, item.performedAt);
    }
    if (item.submissionId) {
      daysBySubmission.set(item.submissionId, key);
    }
  });

  return { days, daysBySubmission };
};

/** How many of the most recent DAYS in a row came back zero. Counted
 *  over the full history, not the charted window, so a patient who has
 *  gone twenty days without a fall gets told twenty.
 *
 *  It said 「records」 and it has always counted points, and a point is
 *  a day: two daily records filed the same afternoon are one bucket.
 *  The sentence it feeds says 天 for the same reason — see
 *  `getFallSummary`. */
const countTrailingZeroDays = (points: DomainTrendPoint[]): number => {
  let streak = 0;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].value !== 0) {
      break;
    }
    streak += 1;
  }
  return streak;
};

export const buildDomainTrendCards = (profile: PatientProfile | null): DomainTrendCard[] => {
  const empty = [
    buildTrendCard('upper_limb', '上肢', []),
    buildTrendCard('lower_limb', '下肢/步态', []),
    buildTrendCard('face', '面部', []),
    buildTrendCard('breathing', '呼吸', []),
    buildTrendCard('symptoms', '疲劳/疼痛', []),
  ];

  if (!profile) {
    return empty;
  }

  const upperBuckets = new Map<string, { timestamp: string; values: number[] }>();
  const lowerBuckets = new Map<string, { timestamp: string; values: number[] }>();
  const faceBuckets = new Map<string, { timestamp: string; values: number[] }>();
  const breathingBuckets = new Map<string, { timestamp: string; values: number[] }>();
  const symptomBuckets = new Map<string, { timestamp: string; values: number[] }>();

  profile.measurements.forEach((item) => {
    const key = item.metricKey ?? item.muscleGroup;
    const burden = toBurdenFromStrength(Number(item.strengthScore));
    if (upperLimbKeys.has(key)) {
      pushBucketValue(upperBuckets, item.recordedAt, burden);
    }
    if (lowerLimbKeys.has(key)) {
      pushBucketValue(lowerBuckets, item.recordedAt, burden);
    }
    if (faceKeys.has(key)) {
      pushBucketValue(faceBuckets, item.recordedAt, burden);
    }
  });

  profile.dailyImpacts.forEach((item) => {
    const burden = roundOne(item.difficultyLevel * 2);
    if (['reaching_up', 'dressing', 'hair_washing'].includes(item.adlKey)) {
      pushBucketValue(upperBuckets, item.recordedAt, burden);
    }
    if (['stairs', 'walking_outdoors'].includes(item.adlKey)) {
      pushBucketValue(lowerBuckets, item.recordedAt, burden);
    }
  });

  profile.symptomScores.forEach((item) => {
    if (item.symptomKey === 'dyspnea') {
      pushBucketValue(breathingBuckets, item.recordedAt, Number(item.score));
    }

    if (item.symptomKey === 'fatigue' || item.symptomKey === 'pain') {
      pushBucketValue(symptomBuckets, item.recordedAt, Number(item.score));
    }

    if (item.symptomKey === 'sleep_quality') {
      pushBucketValue(symptomBuckets, item.recordedAt, roundOne(10 - Number(item.score)));
    }
  });

  profile.followupEvents.forEach((item) => {
    if (item.eventType === 'new_breathing_discomfort') {
      pushBucketValue(breathingBuckets, item.occurredAt, 7);
    }
    if (item.eventType === 'new_foot_drop') {
      pushBucketValue(lowerBuckets, item.occurredAt, 7);
    }
    if (item.eventType === 'new_arm_raise_difficulty') {
      pushBucketValue(upperBuckets, item.occurredAt, 7);
    }
  });

  return [
    buildTrendCard('upper_limb', '上肢', finalizeTrendPoints(upperBuckets)),
    buildTrendCard('lower_limb', '下肢/步态', finalizeTrendPoints(lowerBuckets)),
    buildTrendCard('face', '面部', finalizeTrendPoints(faceBuckets)),
    buildTrendCard('breathing', '呼吸', finalizeTrendPoints(breathingBuckets)),
    buildTrendCard('symptoms', '疲劳/疼痛', finalizeTrendPoints(symptomBuckets)),
  ];
};

export const buildPatientVisualizationCards = (
  profile: PatientProfile | null,
): PatientVisualizationCard[] => {
  // 睡眠质量: `pushLatestValue`, not `pushBucketValue` — this card
  // presents its newest point as 「最近一次」, so a day that carries two
  // submissions has to resolve to one of them and not to their mean.
  // (跌倒次数 below sums instead, and says 天 rather than 最近一次
  // because of it; see `getFallSummary`.)
  const sleepBuckets = new Map<string, { timestamp: string; value: number }>();
  const fallBuckets = new Map<string, { timestamp: string; value: number }>();

  profile?.symptomScores.forEach((item) => {
    if (item.symptomKey === 'sleep_quality') {
      pushLatestValue(sleepBuckets, item.recordedAt, Number(item.score));
    }
  });

  // The stair card cannot be built from a plain number bucket: 今天做不了
  // is a reading with no number, and which measurement a `stair_climb`
  // row belongs to depends on its `protocol`. See `buildStairSeries`.
  const stairSeries = buildStairSeries(profile);
  const stairState = resolveStairState(stairSeries.readings);

  // "Had a followup, logged no fall" means zero falls — not missing
  // data. The write side only posts a `fall` event when the count is
  // above zero, so a patient who has honestly answered 0 at twenty
  // records in a row had nothing at all in this bucket, and the card
  // answered 未记录 — reading the best news he has to report as an
  // omission on his part. Seed every day that carries a daily record
  // with 0 and let the events below add on top. A day with neither
  // stays absent, and *that* is what never-recorded looks like.
  const recordDays = collectFollowupRecordDays(profile);
  recordDays.days.forEach((timestamp, date) => {
    fallBuckets.set(date, { timestamp, value: 0 });
  });

  profile?.followupEvents.forEach((item) => {
    if (item.eventType !== 'fall') {
      return;
    }

    const countMatch = item.description?.match(/(\d+(?:\.\d+)?)/);
    const count =
      countMatch?.[1] !== undefined
        ? Number(countMatch[1])
        : item.severity === 'severe'
          ? 3
          : item.severity === 'moderate'
            ? 2
            : 1;

    // THE DAY OF THE RECORD IT WAS FILED WITH, when it came from one.
    // The daily form stamps `occurredAt` with the DEVICE's UTC date
    // (`new Date().toISOString().slice(0, 10)`), which is yesterday for
    // anything filed before 08:00 Beijing — the same window `toIsoDate`
    // is about, and it would land this fall on a day the seeded zero is
    // not on: a phantom fall day beside a record day still reading 0.
    // The submission it belongs to is exact and needs no date string at
    // all. Events filed from the standalone 事件 form carry a date the
    // patient picked and no daily record, and keep that date.
    const key =
      (item.submissionId ? recordDays.daysBySubmission.get(item.submissionId) : undefined) ??
      toIsoDate(item.occurredAt);
    const current = fallBuckets.get(key);
    if (current) {
      current.value += count;
      if (new Date(item.occurredAt).getTime() > new Date(current.timestamp).getTime()) {
        current.timestamp = item.occurredAt;
      }
      return;
    }

    fallBuckets.set(key, {
      timestamp: item.occurredAt,
      value: count,
    });
  });

  const sleepPoints = finalizeScalarPoints(sleepBuckets);
  // The plotted line is the days that produced SECONDS. A 今天做不了 day
  // has no number to plot and no honest stand-in for one — 0 秒 on a
  // lower-is-better axis would draw the patient's worst day as their
  // best — so it is carried by `latestDisplay` / `summary` / `trend`
  // instead, which is where `stairState` comes in.
  const stairPoints = stairSeries.readings
    .filter((reading): reading is StairReading & { seconds: number } => reading.seconds !== null)
    .map((reading) => ({
      date: reading.date,
      timestamp: reading.timestamp,
      value: reading.seconds,
    }))
    .slice(-CHART_POINT_LIMIT);
  // The streak sentence reads the full history; the chart still shows
  // the same window as every other card.
  const fallHistory = finalizeScalarPoints(fallBuckets, fallBuckets.size);
  const fallPoints = fallHistory.slice(-CHART_POINT_LIMIT);
  const latestLegacyStairs = profile?.dailyImpacts.find((item) => item.adlKey === 'stairs') ?? null;

  const sleepCurrent = sleepPoints.length ? sleepPoints[sleepPoints.length - 1].value : null;
  const sleepPrevious = sleepPoints.length > 1 ? sleepPoints[sleepPoints.length - 2].value : null;
  const fallCurrent = fallPoints.length ? fallPoints[fallPoints.length - 1].value : null;
  const fallPrevious = fallPoints.length > 1 ? fallPoints[fallPoints.length - 2].value : null;

  const sleepText = getSleepSummary(sleepCurrent, sleepPrevious);
  const stairText = getStairSummary(stairSeries, stairState, Boolean(latestLegacyStairs));
  const fallText = getFallSummary(fallCurrent, fallPrevious, countTrailingZeroDays(fallHistory));

  return [
    {
      key: 'sleep_quality',
      label: '睡眠质量',
      latestValue: sleepCurrent,
      previousValue: sleepPrevious,
      trend: resolveComparisonTrend(sleepCurrent, sleepPrevious, 'higher_better'),
      points: sleepPoints,
      unit: '/10',
      chartColor: '#3F7A70',
      ...sleepText,
    },
    {
      key: 'stair_climb',
      label: '上楼计时',
      // null here is 「no seconds」, which is either 今天做不了 or no
      // record at all; `latestDisplay` and `summary` are what tell the
      // two apart, and `trend` distinguishes them too.
      latestValue: stairState.current?.seconds ?? null,
      previousValue: stairState.previous?.seconds ?? null,
      trend: resolveStairTrend(stairState),
      points: stairPoints,
      unit: '秒',
      chartColor: '#C98A33',
      ...stairText,
    },
    {
      key: 'fall_count',
      label: '跌倒次数',
      latestValue: fallCurrent,
      previousValue: fallPrevious,
      trend: resolveComparisonTrend(fallCurrent, fallPrevious, 'lower_better'),
      points: fallPoints,
      unit: '次',
      chartColor: '#D46A54',
      ...fallText,
    },
  ];
};

export const buildDiseaseBackgroundFacts = (
  profile: PatientProfile | null,
): DiseaseBackgroundFact[] => {
  if (!profile) {
    return [];
  }

  const foundation = profile.baseline?.foundation;
  const diseaseBackground = profile.baseline?.diseaseBackground;
  const currentStatus = profile.baseline?.currentStatus;
  const currentChallenges = profile.baseline?.currentChallenges;
  const assistiveDevices = currentStatus?.assistiveDevices?.filter(Boolean).join('、') || '未记录';

  return [
    { label: '姓名/昵称', value: foundation?.fullName ?? profile.fullName ?? '未填写' },
    {
      label: '确诊时间',
      value:
        foundation?.diagnosisYear !== null && foundation?.diagnosisYear !== undefined
          ? String(foundation.diagnosisYear)
          : (profile.diagnosisDate?.slice(0, 10) ?? '未填写'),
    },
    { label: '所在地区', value: foundation?.regionLabel ?? profile.regionCity ?? '未填写' },
    { label: '分型', value: diseaseBackground?.diagnosisType ?? '未填写' },
    { label: '首发部位', value: diseaseBackground?.onsetRegion ?? '未填写' },
    {
      label: '当前行走',
      value: ambulationLabel(currentStatus?.independentlyAmbulatory) ?? '未填写',
    },
    {
      label: '呼吸状态',
      value:
        currentStatus?.breathingSymptoms === true
          ? '有气短或睡眠呼吸问题'
          : currentStatus?.breathingSymptoms === false
            ? '目前未记录呼吸问题'
            : '未填写',
    },
    { label: '辅具', value: assistiveDevices },
    {
      label: '当前困扰',
      value: currentChallenges
        ? ['fatigue', 'pain', 'stairs', 'reachingUp']
            .map((key) => {
              const value = currentChallenges[key as keyof typeof currentChallenges];
              if (typeof value !== 'number') {
                return null;
              }
              const labels: Record<string, string> = {
                fatigue: '疲劳',
                pain: '疼痛',
                stairs: '上下楼',
                reachingUp: '抬手',
              };
              return `${labels[key]} ${value}/5`;
            })
            .filter(Boolean)
            .join('，') || '未填写'
        : '未填写',
    },
  ];
};

export const buildProgressionTimeline = (
  profile: PatientProfile | null,
  summary?: ProgressionSummary | null,
  limit = 12,
): ProgressionTimelineItem[] => {
  if (!profile) {
    return [];
  }

  const items: ProgressionTimelineItem[] = [];

  profile.followupEvents.forEach((item) => {
    const eventLabels: Record<string, string> = {
      fall: '跌倒',
      new_foot_drop: '新增足下垂',
      new_arm_raise_difficulty: '新增抬手困难',
      new_breathing_discomfort: '新增呼吸不适',
      started_afo: '开始使用 AFO',
      started_wheelchair: '开始使用轮椅',
      started_niv: '开始无创通气',
      uploaded_report: '上传新报告',
      other: '病程事件',
    };
    items.push({
      id: item.id,
      title: eventLabels[item.eventType] ?? item.eventType,
      description: item.description?.trim() || '已记录新的病程事件。',
      timestamp: item.occurredAt,
      tag: '事件',
    });
  });

  profile.documents.forEach((item) => {
    const labels: Record<string, string> = {
      mri: 'MRI 报告',
      muscle_mri: 'MRI 报告',
      genetic_report: '基因报告',
      medical_summary: '病历摘要',
      physical_exam: '肌力/体格检查',
      pulmonary_function: '肺功能报告',
      diaphragm_ultrasound: '膈肌超声',
      ecg: '心电图',
      echocardiography: '心脏超声',
      biochemistry: '生化报告',
      muscle_enzyme: '肌酶报告',
      blood_routine: '血常规',
      thyroid_function: '甲功报告',
      coagulation: '凝血报告',
      urinalysis: '尿常规',
      infection_screening: '感染筛查',
      stool_test: '粪便/幽门检测',
      abdominal_ultrasound: '腹部超声',
      blood_panel: '血检/肺功能报告',
      other: '医学报告',
    };
    const payload = item.ocrPayload?.fields ?? {};
    const reportTypeLabel =
      (typeof payload.reportTypeLabel === 'string' && payload.reportTypeLabel.trim()) ||
      (typeof payload.report_type_label === 'string' && payload.report_type_label.trim()) ||
      null;
    const classifiedType =
      (typeof payload.classifiedType === 'string' && payload.classifiedType) ||
      (typeof payload.classified_type === 'string' && payload.classified_type) ||
      item.documentType;
    const aiSummary = typeof payload.aiSummary === 'string' ? payload.aiSummary.trim() : undefined;
    items.push({
      id: item.id,
      title: reportTypeLabel || labels[classifiedType] || item.title?.trim() || '新报告',
      description: aiSummary || '已上传新报告，可查看患者版摘要。',
      timestamp: item.uploadedAt,
      tag: '报告',
      documentId: item.id,
    });
  });

  profile.functionTests.forEach((item) => {
    const labels: Record<string, string> = {
      stair_climb: '上楼测试',
      ten_meter_walk: '10 米步行',
      sit_to_stand: '坐站转换',
      timed_up_and_go: '起立行走',
      six_minute_walk: '六分钟步行',
      custom: '功能测试',
    };
    // A `testType` is not a test. Several protocols share each one —
    // 四级台阶上下 and 连续上 10 级台阶 are both `stair_climb`, and the
    // timeline used to title both 「上楼测试」 and print a bare number
    // under it, so two incomparable seconds sat one above the other
    // looking like the same measurement getting worse.
    const decoded = decodeProtocolField(item.protocol);
    const timedTest = decoded ? findTimedTest(decoded.testId) : null;
    // The grade the patient chose, on the records it excludes from the
    // trend line — this is the 「会存下来，也会显示」 half of what the
    // grade picker promises them.
    const gradeNote =
      decoded && !gradeOption(decoded.grade).trendEligible
        ? `（${gradeOption(decoded.grade).labelZh}，不进趋势线）`
        : '';
    const valueText = isUnableRecord(item)
      ? '本次记录为「做不了」'
      : item.measuredValue !== null && item.measuredValue !== undefined
        ? `${item.measuredValue}${item.unit ? ` ${item.unit}` : ''}`
        : '已记录';
    items.push({
      id: item.id,
      title: timedTest?.nameZh ?? labels[item.testType] ?? item.testType,
      description: `${valueText}${gradeNote}`,
      timestamp: item.performedAt,
      tag: '功能测试',
    });
  });

  summary?.changeCards?.forEach((item) => {
    if (!item.evidenceAt) {
      return;
    }
    items.push({
      id: `change-${item.id}`,
      title: item.title,
      description: item.detail,
      timestamp: item.evidenceAt,
      tag: '日常记录',
    });
  });

  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .filter((item, index, array) => {
      const firstIndex = array.findIndex((candidate) => candidate.id === item.id);
      return firstIndex === index;
    })
    .slice(0, limit);
};

export const buildMedicationHighlights = (profile: PatientProfile | null) => {
  if (!profile?.medications?.length) {
    return [];
  }

  return profile.medications.slice(0, 4).map((item) => ({
    id: item.id,
    title: item.medicationName,
    status: item.status ?? 'active',
  }));
};
