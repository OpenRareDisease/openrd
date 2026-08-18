/**
 * Patient followup retriever — the longitudinal half of the record.
 *
 * Why this exists
 * ---------------
 * `patient_profile` returns who someone is; `patient_reports` returns
 * what a lab said. Neither returns what the patient has been recording
 * week after week — stair-climb times, sleep scores, falls. So the one
 * question this product is organised around,「我最近是不是变差了」,
 * had no data path to the model at all: the planner would call
 * get_my_profile, receive demographics, and answer with a stall.
 *
 * This retriever closes that gap. It reads the three tables the daily
 * followup form writes (function tests, symptom scores, followup
 * events) and returns them as *trends* rather than rows, because a
 * trend is the thing being asked about and because shipping thirty raw
 * rows would burn tokens to say what one line says better.
 *
 * Privacy contract
 * ----------------
 * Same shape as the sibling retrievers: nothing goes in `content`
 * (which the renderer ignores for patient sources); everything lands
 * in `metadata.fields` and passes through the redactor's allowlist for
 * the `followups` scope before it can reach a prompt.
 *
 * Two deliberate exclusions, both free text the patient typed:
 *   - `notes` on tests and scores
 *   - `description` on events (e.g.「在厨房差点摔了」)
 * They routinely carry names, places and other identifiers, and no
 * static rule can prove otherwise — same reasoning that keeps report
 * titles off the allowlist. Events still surface as counts by type and
 * severity, which is the clinically useful part.
 *
 * Falls
 * -----
 * That exclusion had a cost, and migration 023 is the repair. A fall
 * was one event row with everything worth knowing about it typed into
 * `description`, so the retriever could count falls and could say
 * nothing else about them — the assistant meant to help a patient
 * think about「我最近跌倒是不是更频繁了」saw a number and a severity
 * band. The falls diary replaces that free text with closed columns
 * (what they were doing, indoor or outdoor, hands full, could they get
 * up, were they hurt), and closed columns can be summarised safely
 * because the value set was chosen here rather than typed by a
 * patient.
 *
 * Those falls ride the event query rather than getting their own, and
 * the whole reason is stated at `eventsSql`: a fall exists in two
 * tables, and two queries would put two different fall counts in one
 * prompt. The summary they feed is composed in
 * patient-profile/falls/falls.summary.ts, which is also what the 跌倒
 * 记录 block on 病程管理 reads — one set of numbers, two renderings.
 * (Not the clinical passport: it renders no falls at all.)
 *
 * `unit` is the third patient-writable column, and it is not excluded
 * because it is the one whose value set is small enough to enumerate.
 * It is mapped through a fixed table on the way out (UNIT_ALIASES) so
 * that what reaches the prompt is chosen here rather than typed by the
 * patient; anything unrecognised is dropped. The exclusions above and
 * this mapping are the same rule applied to columns of different
 * shapes — never forward text we cannot vouch for.
 *
 * A UNIT IS PART OF WHICH CURVE A READING BELONGS TO, NOT A SUFFIX ON
 * THE NUMBERS. The series used to take the FIRST recognised unit in the
 * group and stamp it on every point, and `describeDirection` compared
 * the raw numbers underneath as if they were commensurable.
 * FUNCTION_TEST_UNITS admits both `sec` and `m/s` for the same
 * `test_type`, so a patient who switched their 10-metre walk from a
 * stopwatch to a gait-speed readout got 0.9 m/s — which is 11.1 s, and
 * slightly WORSE than their previous 10 s — rendered as 「0.9sec」 and
 * banded 「较前降低」. A fabricated improvement, on the one metric this
 * product exists to track, produced by the rendering rather than by the
 * record.
 *
 * The muscle branch of the UNION already makes this argument for
 * `side`（「side belongs to the series identity, not to a note」）; a
 * unit is the same kind of thing. So: each point carries its own
 * canonical unit and is rendered with it, the series-level `unit` is
 * emitted only when every point agrees, and a series holding more than
 * one recognised unit reports `count` / `spanDays` and refuses to
 * assert a direction, a band, a latest value or a point list at all.
 *
 * Soft deletes
 * -------------
 * The three tables above carry `deleted_at` (migration 016). Every
 * query here filters on it, and that is load-bearing rather than
 * routine: retracting a record exists precisely because a mistyped
 * 185-second stair climb otherwise becomes a permanent spike that the
 * home brief narrates as deterioration and this retriever hands to the
 * model as fact. A read path that skips the predicate un-deletes the
 * row in the one place the patient cannot see it.
 *
 * Dates follow the established strict/precise split: strict mode gets
 * relative age in days (`spanDays`) and a coarse band; precise mode
 * additionally gets the exact series. Relative days are arguably the
 * more useful form for trend reasoning anyway.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type {
  Citation,
  IRetriever,
  RetrieveContext,
  RetrieveInput,
  RetrieveResult,
  RetrievedChunk,
} from './base.js';
import { emptyResult } from './base.js';
import { labelFor, MUSCLE_GROUP_LABELS } from '../../patient-profile/export/labels.js';
import {
  FALL_HISTORY_COLUMNS,
  FALL_HISTORY_SQL,
  type FallHistoryRow,
} from '../../patient-profile/falls/falls.sql.js';
import {
  buildFallsSummary,
  composeFallClausesZh,
  fallDayAge,
} from '../../patient-profile/falls/falls.summary.js';
import { MUSCLE_GROUPS } from '../../patient-profile/profile.constants.js';

/**
 * Metric keys the record can actually contain, mapped to the label
 * used in the prompt.
 *
 * Derived from `FUNCTION_TEST_TYPES`, `SYMPTOM_KEYS` and
 * `MUSCLE_GROUPS` — the same enums the write path validates against
 * (`profile.schema.ts` z.enum + DB CHECK). An earlier version of this
 * table invented `grip_strength` / `arm_raise` / `walk_6min`, none of
 * which can exist in the database, while omitting the ones that can: a
 * patient asking 「我抬臂是不是变弱了」was answered「你还没有记录过这项」
 * because the tool advertised a key the retriever could never match,
 * and the real self-test data lives under `muscle_deltoid`.
 *
 * THE MUSCLE HALF IS BUILT FROM THE ENUM RATHER THAN COPIED FROM IT.
 * Copied, it went stale the way that comment predicts: `face` and
 * `abdominal` were appended to `MUSCLE_GROUPS` — regions the FSHD
 * Clinical Score grades, one of them the region the disease is named
 * after — and this table stopped short of both. Everything built
 * on it stopped there too, so `get_my_records` REJECTED
 * `muscle_face`, and a patient who had recorded facial weakness could
 * be told the tool call failed. Appending a group now extends this map
 * on its own; the labels are the ones the export writes for the same
 * enum, so a group has one Chinese name across the product.
 *
 * A key absent from here still surfaces under its raw name rather than
 * being dropped.
 */
const METRIC_LABELS: Record<string, string> = {
  // patient_function_tests.test_type — FUNCTION_TEST_TYPES
  stair_climb: '上楼计时',
  ten_meter_walk: '10 米步行',
  sit_to_stand: '坐立测试',
  six_minute_walk: '6 分钟步行',
  timed_up_and_go: '起立行走计时',
  custom: '自定义测试',
  // patient_symptom_scores.symptom_key — SYMPTOM_KEYS
  fatigue: '疲劳',
  pain: '疼痛',
  dyspnea: '呼吸困难',
  sleep_quality: '睡眠质量',
  anxiety_about_progression: '对进展的担忧',
  // patient_measurements — muscle self-test, MUSCLE_GROUPS, scored 0-5
  ...Object.fromEntries(
    MUSCLE_GROUPS.map((group) => [
      `muscle_${group}`,
      `肌力·${labelFor(MUSCLE_GROUP_LABELS, group)}`,
    ]),
  ),
};

/**
 * Is this a metric key the record can actually contain?
 *
 * Accepts the enum-derived keys above plus the `_left` / `_right`
 * sided variants the measurement query produces.
 */
export const isKnownMetricKey = (key: string): boolean => {
  if (Object.prototype.hasOwnProperty.call(METRIC_LABELS, key)) return true;
  for (const suffix of ['_left', '_right']) {
    if (key.endsWith(suffix)) {
      const base = key.slice(0, -suffix.length);
      if (Object.prototype.hasOwnProperty.call(METRIC_LABELS, base)) return true;
    }
  }
  return false;
};

const SIDE_SUFFIX_LABELS: Record<string, string> = {
  _left: '（左）',
  _right: '（右）',
};

/**
 * Human label for a metric key, including the `_left` / `_right`
 * suffix the measurement query appends. An unknown key falls back to
 * itself rather than being dropped — a measurement the patient took
 * the trouble to record is worth showing under a clumsy name.
 */
const labelForMetric = (metricKey: string): string => {
  for (const [suffix, sideLabel] of Object.entries(SIDE_SUFFIX_LABELS)) {
    if (metricKey.endsWith(suffix)) {
      const base = metricKey.slice(0, -suffix.length);
      return `${METRIC_LABELS[base] ?? base}${sideLabel}`;
    }
  }
  return METRIC_LABELS[metricKey] ?? metricKey;
};

const EVENT_LABELS: Record<string, string> = {
  fall: '跌倒',
  new_foot_drop: '新出现足下垂',
  new_arm_raise_difficulty: '新出现抬臂困难',
  new_breathing_discomfort: '新出现呼吸不适',
  started_afo: '开始使用踝足矫形器',
  started_wheelchair: '开始使用轮椅',
  started_niv: '开始无创通气',
  uploaded_report: '上传报告',
  other: '其他',
};

const SEVERITY_LABELS: Record<string, string> = {
  mild: '轻',
  moderate: '中',
  severe: '重',
};

const DEFAULT_WINDOW_DAYS = 180;
const MAX_WINDOW_DAYS = 730;
/** Points kept per series. Enough to show a direction without paying
 *  for a year of weekly readings. */
const MAX_POINTS_PER_SERIES = 12;

/**
 * Rows fetched per series, enforced in SQL.
 *
 * The query used to be unbounded while the event query took `LIMIT
 * 50`: over the 730-day ceiling, across three tables, a patient who
 * records daily pulls ~9k rows into Node purely to throw all but 12
 * of them away per metric.
 *
 * A bare `LIMIT` cannot fix it — the union is ordered ascending, so a
 * top-level cut keeps the *oldest* rows and would answer the trend
 * question backwards. The cap is therefore per series, on the most
 * recent rows, applied before the ordering the caller relies on.
 *
 * Sized far above MAX_POINTS_PER_SERIES on purpose. Every statistic
 * here (count, spanDays, changeDirection) describes the whole fetched
 * series — see the comment at the grouping loop for the bug that
 * caused — so the cap is the real baseline the trend rests on, not
 * just what gets rendered. 200 is ~16x the rendered window: weekly
 * recording never reaches it inside 730 days, and daily recording
 * still leaves ~7 months of baseline, which is a longer view than any
 * "我最近是不是变差了" needs. When it does bite, `count` under-reports;
 * the rendered banner says 「以上」rather than claiming a total it
 * cannot see.
 */
const MAX_ROWS_PER_SERIES = 200;

/**
 * Rows kept by the event query.
 *
 * Was 50, and 50 was sized when a fall was one line in a tally. The
 * falls diary now rides this query (see eventsSql), and the population
 * this is built for falls a lot: about 30% of adults with FSHD fall at
 * least monthly, so a 730-day window can legitimately hold two dozen
 * falls before any other event type is counted.
 *
 * The ceiling still matters, and it matters asymmetrically: the query
 * orders DESC, so what gets cut is always the OLDEST end — which is
 * the half the「上一个 90 天」comparison rests on. Truncating there
 * biases every quarterly comparison toward「更频繁了」, so hitting this
 * cap suppresses that comparison outright rather than shading it. See
 * refusal (3) in falls.summary.ts.
 */
const MAX_EVENT_ROWS = 200;

/**
 * Recorded units we are willing to forward, keyed by their lowercased
 * raw form.
 *
 * `patient_function_tests.unit` is patient-supplied and was for a long
 * time unconstrained free text (`z.string().max(32)`, TEXT with no
 * CHECK). It reaches the model twice — as its own `unit` field on the
 * precise allowlist and concatenated into `series` — with no escaping
 * and no length limit. That is exactly the shape this file's header
 * refuses for `notes` and event descriptions, and the reasoning
 * transfers unchanged: nothing static can prove a column the patient
 * types into is free of names or places.
 *
 * The enum in profile.schema.ts and the CHECK in migration 015 close
 * the write path, and 015 back-fills the legacy rows rather than
 * following 012's NOT VALID convention — deliberately, because a
 * NOT VALID constraint here would have made exactly the rows most
 * likely to hold a free-text unit undeletable under 016's soft delete.
 * Read that migration's header for the argument.
 *
 * So after 015 the column really is canonical-or-null. This table stays
 * anyway, for the window where the code is deployed and the migration
 * has not run yet, and because it costs one lookup: mapping through it
 * makes what we emit a function of this file rather than of the column,
 * and an unrecognised unit becomes null, which costs a suffix on the
 * numbers and nothing else.
 */
const UNIT_ALIASES: Record<string, string> = {
  sec: 'sec',
  s: 'sec',
  秒: 'sec',
  m: 'm',
  米: 'm',
  'm/s': 'm/s',
  reps: 'reps',
  次: 'reps',
  kg: 'kg',
  score: 'score',
  // Synthesised by the measurement branch of the UNION as a SQL
  // literal, never read from a patient-writable column — listed so it
  // survives the same filter the others go through.
  mrc: 'MRC',
};

const canonicalUnit = (raw: string | null): string | null => {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  // hasOwnProperty rather than a bare lookup: the key is a column the
  // patient can type into, and a legacy row holding "constructor" or
  // "toString" would otherwise resolve up the prototype chain and put
  // a function — stringified in full — into the rendered series. The
  // allowlist has to be closed on the way out, not just on the way in.
  return Object.prototype.hasOwnProperty.call(UNIT_ALIASES, key) ? UNIT_ALIASES[key] : null;
};

/**
 * Fixed snippet for every citation this retriever emits, matching
 * `patient_profile` and `patient_reports`.
 *
 * The snippets here used to be built from the record — metric label
 * plus reading count, event count. Both are a strict subset of what
 * the strict allowlist already permits, so nothing extra was exposed;
 * the problem is that citations are the one channel that bypasses the
 * redactor entirely, and the sibling retrievers hold the line that
 * nothing derived from patient rows travels down it. One retriever
 * quietly interpolating record content means the contract can only be
 * checked by reading all three files, and the next edit to the
 * snippet has no allowlist to answer to.
 */
const PLACEHOLDER_SNIPPET = '你的随访记录';

interface SeriesRow {
  metric_key: string;
  unit: string | null;
  value: string | number;
  recorded_at: string | Date;
}

/**
 * One row of the event query.
 *
 * The fall-specific columns are the falls diary joining this query
 * (migration 023). They are null on every row that is not a fall, and
 * on legacy fall rows that only ever carried a date — which is why
 * every consumer of them in falls.summary.ts states the denominator it
 * counted over instead of dividing by the event count.
 */
type EventRow = {
  event_type: string;
  severity: string | null;
  occurred_at: string | Date;
} & Partial<Omit<FallHistoryRow, 'event_type' | 'severity' | 'occurred_at'>>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant a row was recorded, or null when the driver handed back
 *  something that does not parse as a date. */
const toTime = (value: string | Date): number | null => {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * How old a row is, in whole days, FOR DISPLAY.
 *
 * Rounded, because「16 小时前」reads better as「1天前」than as「0天前」,
 * and clamped at zero because `performedAt` is caller-supplied
 * (`z.string().datetime()`, no upper bound) so a row dated tomorrow
 * must not come back as a negative age.
 *
 * THIS IS A BIN INDEX RELATIVE TO NOW, NOT A DURATION, AND NOTHING MAY
 * SUBTRACT TWO OF THEM TO GET AN INTERVAL. Rounding puts the bin
 * boundary at 12 hours, so two readings ONE MINUTE apart that straddle
 * it differ by 1 — see `spanDays` at the grouping loop for what that
 * produced and what replaced it.
 */
const daysAgo = (value: string | Date, now: number): number | null => {
  const t = toTime(value);
  if (t === null) return null;
  return Math.max(0, Math.round((now - t) / DAY_MS));
};

const toNumber = (value: string | number): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Coarse direction over the series. Deliberately not a slope: the
 *  model gets the points in precise mode and a word in strict mode,
 *  and a fake-precise regression on four self-timed readings would
 *  read as more certain than the data supports. */
const describeDirection = (earliest: number, latest: number): 'up' | 'down' | 'flat' => {
  // A relative delta has no denominator at zero, so the sign of the
  // later reading is the whole answer — and it is asked for rather
  // than assumed, because `measuredValue` is
  // `z.coerce.number().finite()` with no lower bound and a series
  // running 0 → −5 is not「较前升高」.
  if (earliest === 0) return latest === 0 ? 'flat' : latest > 0 ? 'up' : 'down';
  const delta = (latest - earliest) / Math.abs(earliest);
  if (delta > 0.1) return 'up';
  if (delta < -0.1) return 'down';
  return 'flat';
};

export class PatientFollowupRetriever implements IRetriever {
  readonly id = 'patient_followups';
  readonly kind = 'sql' as const;

  constructor(private readonly pool: Pool) {}

  async search(input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult> {
    if (!ctx.userId) {
      return emptyResult(this.id, 'no_user_in_scope');
    }
    if (ctx.consentLevel === 'none' || ctx.consentLevel === undefined) {
      return emptyResult(this.id, 'consent_not_granted');
    }

    const requestedWindow = Number(input.filter?.windowDays);
    const windowDays = Number.isFinite(requestedWindow)
      ? Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.floor(requestedWindow)))
      : DEFAULT_WINDOW_DAYS;

    const metricFilter =
      typeof input.filter?.metricKey === 'string' && input.filter.metricKey.trim()
        ? input.filter.metricKey.trim()
        : null;

    // Function tests and symptom scores are shaped alike once
    // projected, so one UNION keeps the trend logic in a single place.
    //
    // The union is wrapped so the row cap can be applied per series
    // (see MAX_ROWS_PER_SERIES): the window function partitions on the
    // same computed metric_key the grouping loop below keys on, so
    // each curve keeps its own most-recent rows instead of the three
    // tables competing for one global budget. Ordering ascending has
    // to happen after the cut, not before it.
    const seriesSql = `
      WITH series AS (
      SELECT ft.test_type AS metric_key,
             ft.unit      AS unit,
             ft.measured_value AS value,
             ft.performed_at   AS recorded_at
        FROM patient_function_tests ft
        JOIN patient_profiles pp ON pp.id = ft.profile_id
       WHERE pp.user_id = $1
         AND ft.deleted_at IS NULL
         AND ft.not_applicable = FALSE
         AND ft.measured_value IS NOT NULL
         AND ft.performed_at >= NOW() - ($2 || ' days')::interval
      UNION ALL
      SELECT ss.symptom_key AS metric_key,
             NULL           AS unit,
             ss.score       AS value,
             ss.recorded_at AS recorded_at
        FROM patient_symptom_scores ss
        JOIN patient_profiles pp ON pp.id = ss.profile_id
       WHERE pp.user_id = $1
         AND ss.deleted_at IS NULL
         AND ss.recorded_at >= NOW() - ($2 || ' days')::interval
      UNION ALL
      -- side belongs to the series identity, not to a note. FSHD is
      -- defined by asymmetric involvement, so folding left and right
      -- into one curve manufactures trends: 「左三角肌 2 分」30 天前
      -- plus「右三角肌 4 分」today reads as a 2→4 improvement of a
      -- single muscle. The schema already treats side as identity
      -- (NOT NULL + CHECK + it is in the covering index); only this
      -- retriever dropped it.
      SELECT 'muscle_' || COALESCE(pm.metric_key, pm.muscle_group)
               || CASE WHEN pm.side IN ('left', 'right') THEN '_' || pm.side ELSE '' END
                                          AS metric_key,
             'MRC'                        AS unit,
             pm.strength_score            AS value,
             pm.recorded_at               AS recorded_at
        FROM patient_measurements pm
        JOIN patient_profiles pp ON pp.id = pm.profile_id
       WHERE pp.user_id = $1
         AND pm.recorded_at >= NOW() - ($2 || ' days')::interval
      ), ranked AS (
        SELECT metric_key, unit, value, recorded_at,
               ROW_NUMBER() OVER (
                 PARTITION BY metric_key ORDER BY recorded_at DESC
               ) AS rn
          FROM series
      )
      SELECT metric_key, unit, value, recorded_at
        FROM ranked
       WHERE rn <= ${MAX_ROWS_PER_SERIES}
       ORDER BY recorded_at ASC`;

    /**
     * The event tally, plus the falls diary joined into it.
     *
     * WHY FALLS RIDE THIS QUERY RATHER THAN GETTING THEIR OWN
     *
     * A fall can live in two tables (migration 023: the diary row and
     * its patient_followup_events twin), and the one thing that must
     * never happen is two different fall counts reaching the same
     * prompt. Two queries producing two numbers is exactly how that
     * happens — the model picks one, and the patient asking「我最近跌倒
     * 是不是更频繁了」gets an answer whose provenance nobody can
     * reconstruct. One query, one set of rows, one count.
     *
     * The first branch is every non-fall event, unchanged, padded out
     * to the falls column list. The second is FALL_HISTORY_SQL, which
     * owns the de-duplication between the two tables and is shared with
     * the falls endpoints so 病程管理 and the assistant cannot
     * disagree.
     */
    const eventsSql = `
      SELECT ${FALL_HISTORY_COLUMNS.join(', ')}
        FROM (
      SELECT fe.event_type                  AS event_type,
             fe.severity                    AS severity,
             fe.occurred_at                 AS occurred_at,
             NULL::int                      AS fall_day_age,
             NULL::text                     AS fall_activity,
             NULL::text                     AS fall_location,
             NULL::boolean                  AS fall_hands_full,
             NULL::boolean                  AS fall_got_up_unaided,
             NULL::boolean                  AS fall_injured
        FROM patient_followup_events fe
        JOIN patient_profiles pp ON pp.id = fe.profile_id
       WHERE pp.user_id = $1
         AND fe.deleted_at IS NULL
         AND fe.event_type <> 'fall'
         AND fe.occurred_at >= NOW() - ($2 || ' days')::interval
      UNION ALL
${FALL_HISTORY_SQL}
        ) events
       ORDER BY occurred_at DESC
       LIMIT ${MAX_EVENT_ROWS}`;

    /**
     * Days the patient recorded「今天做不了」.
     *
     * Kept out of the series above on purpose: an unable day is not a
     * slow reading, and averaging it in — or dropping it, as a plain
     * `measured_value IS NOT NULL` filter would — both misreport the
     * course. Counting them separately is what lets an answer say
     * 「最近 30 天里有 6 天记录为做不到」rather than falling back to
     * 「你还没有记录过这项」, which is what the patient saw before the
     * column existed.
     */
    const unableSql = `
      SELECT ft.test_type AS metric_key,
             COUNT(*)::int AS unable_count,
             MIN(EXTRACT(EPOCH FROM (NOW() - ft.performed_at)) / 86400)::int AS most_recent_days
        FROM patient_function_tests ft
        JOIN patient_profiles pp ON pp.id = ft.profile_id
       WHERE pp.user_id = $1
         AND ft.deleted_at IS NULL
         AND ft.not_applicable = TRUE
         AND ft.performed_at >= NOW() - ($2 || ' days')::interval
       GROUP BY ft.test_type`;

    const [seriesResult, eventsResult, unableResult] = await Promise.all([
      this.pool.query<SeriesRow>(seriesSql, [ctx.userId, String(windowDays)]),
      this.pool.query<EventRow>(eventsSql, [ctx.userId, String(windowDays)]),
      this.pool.query<{ metric_key: string; unable_count: number; most_recent_days: number }>(
        unableSql,
        [ctx.userId, String(windowDays)],
      ),
    ]);

    // Indexed by metric so a series can carry its own unable count,
    // and so a metric with nothing BUT unable days still produces a
    // chunk rather than vanishing.
    const unableByMetric = new Map(
      (unableResult.rows ?? []).map((r) => [
        r.metric_key,
        {
          count: r.unable_count,
          // CLAMPED THE WAY `daysAgo` IS, AND IT WAS THE ONE AGE ON
          // THIS FILE THAT WAS NOT. `performedAt` is caller-supplied
          // with no upper bound, so a row dated tomorrow makes SQL
          // return a negative and the sentence below reached both
          // modes as「最近一次 -3 天前」— driven through the retriever
          // and read off the rendered prompt.
          mostRecentDays: Number.isFinite(r.most_recent_days)
            ? Math.max(0, Math.round(r.most_recent_days))
            : 0,
        },
      ]),
    );

    const now = Date.now();
    const chunks: RetrievedChunk[] = [];
    const citations: Citation[] = [];

    // Group the union into one series per metric.
    const byMetric = new Map<string, SeriesRow[]>();
    for (const row of seriesResult.rows) {
      if (metricFilter && row.metric_key !== metricFilter) continue;
      const list = byMetric.get(row.metric_key) ?? [];
      list.push(row);
      byMetric.set(row.metric_key, list);
    }

    for (const [metricKey, rows] of byMetric) {
      // Every statistic describes the WHOLE series; only the rendered
      // point list is truncated. Slicing first made count, spanDays and
      // the trend describe an arbitrary tail: a patient who genuinely
      // improved 33% over 20 readings was told 「基本持平」 because the
      // first 8 readings — the ones that established the baseline —
      // were cut before describeDirection ever saw them. The more
      // diligently someone recorded, the more wrong the answer got.
      const allPoints = rows
        .map((row) => ({
          value: toNumber(row.value),
          age: daysAgo(row.recorded_at, now),
          // The reading's own instant, carried beside its rounded age
          // because an INTERVAL may only ever be computed from these.
          // See `spanDays` below.
          at: toTime(row.recorded_at),
          // Per point, not per series. See UNIT IS PART OF WHICH CURVE
          // in the header: a row whose unit fails the allowlist keeps
          // its own null instead of inheriting a neighbour's suffix.
          unit: canonicalUnit(row.unit),
        }))
        .filter(
          (p): p is { value: number; age: number; at: number; unit: string | null } =>
            p.value !== null && p.age !== null && p.at !== null,
        );
      if (allPoints.length === 0) continue;

      const earliest = allPoints[0];
      const latest = allPoints[allPoints.length - 1];
      /**
       * ONE SERIES IS ONE UNIT, OR IT IS NOT A SERIES.
       *
       * Insertion-ordered, so the message below names the units in the
       * order the patient recorded them.
       *
       * The test is on RECOGNISED units, and a point with none does
       * not trigger it. Migration 015 NULLs every legacy unit its
       * alias table cannot read, so a live series really can hold a
       * NULL from 2024 beside a 「sec」 from today — and suppressing
       * those would cost a true trend to defend against a
       * contradiction that is not there: the NULL row asserts no unit,
       * so nothing disagrees with it. What the NULL must not do is
       * borrow the neighbour's suffix, which is why the point carries
       * its own and `unit` below stays absent unless every point
       * agrees. `m/s` and the other five are recognised, so the case
       * this whole block exists for — a stopwatch series continued
       * with a gait-speed readout — is caught here and not by this
       * softer half.
       */
      const unitsPresent = new Set<string>();
      for (const point of allPoints) if (point.unit !== null) unitsPresent.add(point.unit);
      const mixedUnits = unitsPresent.size > 1;
      // Emitted only when EVERY point carries the same recognised unit.
      // 「单位: sec」 beside a point that recorded no unit is the same
      // stamping this block exists to stop, moved up one level: the
      // model reads the field and applies it to the whole list.
      const unit =
        !mixedUnits && allPoints.every((p) => p.unit !== null) ? allPoints[0].unit : null;
      /**
       * REAL ELAPSED TIME BETWEEN THE OLDEST AND NEWEST READING, IN
       * WHOLE DAYS — AND IT USED TO BE THE DIFFERENCE OF TWO ROUNDED
       * AGES, WHICH IS NOT A DURATION.
       *
       * `earliest.age - latest.age` subtracted two `daysAgo` bin
       * indices. `daysAgo` rounds, so the bin boundary sits at 12
       * hours and TWO READINGS ONE MINUTE APART that straddle it come
       * out 1 apart. Driven through this retriever with 10sec at
       * now−12h−30s and 16sec at now−12h+30s, both modes rendered
       * 「跨度(天): 1」and「最近变化: 较前升高」— a fabricated
       * deterioration from a single sitting, with the 跨度(天): 0 that
       * used to sit beside it and refute it now reading 1 instead.
       *
       * So the span comes off the timestamps, and off the whole series
       * rather than the two array ends, which also stops it depending
       * on the ORDER BY. FLOORED, so a 20-hour gap is never rounded up
       * into a day the record does not contain and `spanDays >= 1`
       * means exactly「a full day of real time passed」.
       *
       * At the row cap this is a floor the same way `count` is: the
       * rows that were cut are the OLDEST, so the real series is both
       * longer and older than either number says. `countAtCap` is the
       * flag for both.
       */
      let firstAt = allPoints[0].at;
      let lastAt = allPoints[0].at;
      for (const point of allPoints) {
        if (point.at < firstAt) firstAt = point.at;
        if (point.at > lastAt) lastAt = point.at;
      }
      const spanDays = Math.floor((lastAt - firstAt) / DAY_MS);
      /**
       * A DIRECTION NEEDS TWO POINTS AND SOME TIME BETWEEN THEM, AND
       * THIS ONE WAS ASSERTED OFF ONE POINT, THEN OFF ZERO DAYS, THEN
       * OFF A DAY THAT WAS A ROUNDING ARTEFACT.
       *
       * `describeDirection(earliest.value, latest.value)` was applied
       * unconditionally, and on a one-reading series earliest IS
       * latest: delta 0, 「flat」, and the strict-mode band came out
       * 「最近变化: 基本持平」. That is a statement about CHANGE made
       * from a data point that contains none — under a tool whose
       * description promises 「which direction they moved」 and which
       * that description tells the model to call for 「我最近是不是变差
       * 了」. A patient who has recorded once was told their trend is
       * 基本持平.
       *
       * Counting points closed the first half. The second is that a
       * zero-day span contains no change either: 上楼计时 is routinely
       * done twice in a sitting, a practice attempt and then the real
       * one, and those two rows were being read as a trend. 10 秒 then
       * 16 秒 on the same afternoon came out as 「最近变化: 较前升高」.
       *
       * `spanDays >= 1` was the fix for that and it did not hold,
       * because the span it tested was two rounded ages subtracted —
       * see `spanDays` above. Now that the span is real elapsed time,
       * this test is what it always claimed to be: a full day has to
       * have passed between the first reading and the last. Which of
       * two same-sitting rows counts as「earliest」is decided by an
       * arbitrary ORDER BY tiebreak, so nothing stable was ever being
       * asserted.
       *
       * So a direction needs a second point AND a real elapsed day,
       * and a mixed-unit series gets none at all.
       */
      const direction =
        !mixedUnits && allPoints.length >= 2 && spanDays >= 1
          ? describeDirection(earliest.value, latest.value)
          : null;
      /**
       * ...AND THE REFUSAL IS SAID OUT LOUD RATHER THAN LEFT AS A HOLE.
       *
       * Silence is what let the same-sitting pair keep doing damage
       * after the direction went: the model still sees two readings
       * that got slower, and「the failure mode of a model handed a hole
       * is that it fills it」(see the mixed-unit band below). The point
       * ages are bins relative to now, so the pair can still render as
       * 「1天前」and「0天前」beside 跨度(天): 0 — this is the sentence
       * that tells the reader which of the two to believe.
       *
       * `latestBand` is where this file puts its refusals, and it is on
       * BOTH allowlists for that reason. Not emitted for a single
       * reading: 记录次数: 1 explains that chunk on its own.
       */
      const sameSittingBand =
        !mixedUnits && direction === null && allPoints.length >= 2
          ? '本期这些记录都落在不到一天之内，时间跨度不足一天，不能据此判断变化方向'
          : null;

      // The point list is what costs tokens, so that is what gets cut.
      const shownPoints = allPoints.slice(-MAX_POINTS_PER_SERIES);
      const truncated = shownPoints.length < allPoints.length;
      // SQL handed back a full page, so there are older readings we
      // never saw. Say「以上」rather than quoting a total that is only
      // the cap looking back at us.
      const atRowCap = rows.length >= MAX_ROWS_PER_SERIES;
      const totalLabel = atRowCap ? `${allPoints.length} 次以上` : `${allPoints.length} 次`;
      const renderPoint = (p: { value: number; age: number; unit: string | null }) =>
        `${p.value}${p.unit ?? ''}(${p.age}天前)`;

      const chunkId = randomUUID();
      chunks.push({
        id: chunkId,
        source: this.id,
        content: '',
        metadata: {
          fields: {
            metricKey,
            metricLabel: labelForMetric(metricKey),
            count: allPoints.length,
            // 「做不到」days for this metric. Non-identifying (a count
            // and an age), so it passes in both redaction modes — a
            // basic-consent answer needs this as much as a precise one.
            // Composed here rather than shipped as two bare numbers.
            // Run against a real model, `unableCount: 1` sitting beside
            // `series` was read as「最近一次（16秒这次）标记的是做不到」
            // — it assumed the unable day was one of the listed
            // readings, then flagged its own conclusion as odd because
            // an unable attempt has no time. The two sets are disjoint
            // by construction (the series query filters
            // `not_applicable = FALSE`), so the text has to say so.
            ...(unableByMetric.has(metricKey)
              ? {
                  unableSummary:
                    `另有 ${unableByMetric.get(metricKey)!.count} 次记录为「做不到」` +
                    `（这些次没有数值，不在上面的历次记录里），` +
                    `最近一次 ${unableByMetric.get(metricKey)!.mostRecentDays} 天前`,
                }
              : {}),
            // `count` and `spanDays` are on BOTH allowlists, but the
            // 「以上」banner that admits truncation lives in `series`,
            // which is precise-only. Without this flag a strict-mode
            // answer reads `count: 200` as an exact total — and
            // `spanDays` with it, because the rows the cap cut are the
            // OLDEST ones, so the real series is longer AND older than
            // either number says. One flag covers both. Booleans carry
            // no patient data, so it goes in both lists too.
            countAtCap: atRowCap,
            spanDays,
            // Both of these describe a change, so both are absent from
            // a series that records none. See `direction` above.
            ...(direction === null
              ? {}
              : {
                  changeDirection: direction,
                  // strict-mode band: direction without the raw numbers
                  latestBand:
                    direction === 'up'
                      ? '较前升高'
                      : direction === 'down'
                        ? '较前降低'
                        : '基本持平',
                }),
            // The other half of that absence, in the same field. A
            // mixed-unit series overwrites it below with its own
            // reason, which is why this one tests `!mixedUnits`.
            ...(sameSittingBand === null ? {} : { latestBand: sameSittingBand }),
            // A MIXED-UNIT SERIES SAYS WHY IT IS EMPTY RATHER THAN
            // GOING QUIET.
            //
            // `latestBand` is the field that carries this file's
            // refusals — 「本期均记录为做不到」 is the other one, and it
            // is on BOTH allowlists for exactly this reason: a
            // statement that no series is being read is the platform
            // declining to read one, not a value withheld for consent.
            // Left silent, the model would see three readings over 60
            // days with no direction, no unit and no point list, and
            // the failure mode of a model handed a hole is that it
            // fills it. The unit names come from UNIT_ALIASES — chosen
            // in this file, never the patient's own string.
            ...(mixedUnits
              ? {
                  latestBand:
                    `本期记录混用了 ${[...unitsPresent].join(' / ')} 等不同单位，` +
                    `不能当作同一条曲线比较，因此不给出变化方向和历次数值`,
                }
              : {}),
            // precise-mode raw values. All three describe the curve as
            // one comparable thing, so all three go when it is not one.
            ...(mixedUnits
              ? {}
              : {
                  unit,
                  latestValue: latest.value,
                  // Say so when the list is a tail, otherwise the model
                  // reads `count: 20` next to 12 points and reconciles
                  // the gap by inventing something.
                  series: truncated
                    ? `（仅列出最近 ${shownPoints.length} 次，共 ${totalLabel}）` +
                      shownPoints.map(renderPoint).join('、')
                    : shownPoints.map(renderPoint).join('、'),
                }),
          },
        },
        distance: null,
        sourceFile: `patient_followups/${metricKey}`,
        chunkIndex: 0,
      });
      citations.push({
        chunkId,
        source: this.id,
        sourceFile: `patient_followups/${metricKey}`,
        chunkIndex: 0,
        snippet: PLACEHOLDER_SNIPPET,
      });
    }

    // A metric whose only rows are「做不到」produces no series above,
    // and silently dropping it recreates the exact failure this column
    // was added to fix: the patient records「今天做不了」six times and
    // is then told they have never recorded this.
    for (const [metricKey, unable] of unableByMetric) {
      if (byMetric.has(metricKey)) continue;
      if (metricFilter && metricKey !== metricFilter) continue;
      const chunkId = randomUUID();
      chunks.push({
        id: chunkId,
        source: this.id,
        content: '',
        metadata: {
          fields: {
            metricKey,
            metricLabel: labelForMetric(metricKey),
            count: 0,
            // NO `spanDays` EITHER, AND 「0」 WAS NOT A HARMLESS ONE.
            //
            // There is no series in this branch, so there is no span
            // to report — and 「跨度(天): 0」 printed beside 「本期共 6
            // 次记录为「做不到」…最近一次 2 天前」 reads as six attempts
            // on one day, which is the opposite of what six 做不到
            // records spread over the window mean. The days these rows
            // actually cover are not queried (the unable query returns
            // a count and a MIN age, nothing else), so the honest
            // value is no field, the same call `changeDirection` gets
            // immediately below.
            // NO `changeDirection` HERE EITHER, AND 「flat」 WAS THE
            // WORST POSSIBLE VALUE FOR IT.
            //
            // Every row in this branch is 「做不到」 — a patient who has
            // LOST the ability to perform the test — and the field said
            // their measurement is unchanged. There is no measurement.
            // `latestBand` is the one string that explains the chunk,
            // and it is on BOTH allowlists now: a statement that there
            // are no numbers is this platform refusing to read a
            // series, not a value withheld for consent, so a
            // precise-consent reader was getting the bare 「flat」 with
            // the sentence that explains it stripped by layer 3.
            latestBand: '本期均记录为做不到',
            unableSummary:
              `本期共 ${unable.count} 次记录为「做不到」，没有任何可用数值；` +
              `最近一次 ${unable.mostRecentDays} 天前`,
          },
        },
        distance: null,
        sourceFile: `patient_followups/${metricKey}`,
        chunkIndex: 0,
      });
      citations.push({
        chunkId,
        source: this.id,
        sourceFile: `patient_followups/${metricKey}`,
        chunkIndex: 0,
        snippet: PLACEHOLDER_SNIPPET,
      });
    }

    const eventRowCount = eventsResult.rowCount ?? 0;
    /**
     * The event query came back full, so the OLDEST events in the
     * window were never read and EVERY count below is a floor.
     *
     * Computed once and used for all three of the things that depend
     * on it — the falls comparison, the tally, and the count field —
     * because it was already being computed inline for the first of
     * them while the other two shipped as exact totals. See the
     * `eventSummary` note below.
     */
    const eventsAtCap = eventRowCount >= MAX_EVENT_ROWS;
    if (eventRowCount > 0 && !metricFilter) {
      // Counted by (type, severity) rather than listed: the patient's
      // own description of each event is free text we don't ship, and
      // "跌倒（轻）×2，最近 3 天前" is the clinically useful residue.
      const tally = new Map<string, { count: number; mostRecentAge: number }>();
      const fallRows: EventRow[] = [];
      // Rows that made it into the tally. NOT `eventRowCount`: a row
      // whose date does not parse is skipped below, and `eventCount:
      // 2` printed beside 「跌倒（轻）×1」 in the same chunk left the
      // model to reconcile a missing event by inventing one.
      let countedEvents = 0;
      for (const row of eventsResult.rows) {
        // Falls carry a day-precision age computed in SQL, because
        // their date column is a DATE and a JS-side midnight would age
        // every one of them by an extra day east of Greenwich. Every
        // other event has a real timestamp and keeps the old path.
        const age =
          row.event_type === 'fall' ? fallDayAge(row, now) : daysAgo(row.occurred_at, now);
        if (age === null) continue;
        countedEvents += 1;
        // Falls stay IN the tally as well as feeding the summary below.
        // Pulling them out would leave 跌倒 off the event line it has
        // always appeared on, and the standing rule this release is
        // built under is that nothing gets demoted.
        if (row.event_type === 'fall') fallRows.push(row);
        const label = `${EVENT_LABELS[row.event_type] ?? row.event_type}${
          row.severity ? `（${SEVERITY_LABELS[row.severity] ?? row.severity}）` : ''
        }`;
        const prev = tally.get(label);
        tally.set(label, {
          count: (prev?.count ?? 0) + 1,
          mostRecentAge: Math.min(prev?.mostRecentAge ?? age, age),
        });
      }

      if (tally.size > 0) {
        const chunkId = randomUUID();
        // The falls clauses are appended, never interleaved: the tally
        // is the sentence every other event type shares, and the falls
        // detail is a rider on it. Both come out of one row set, so the
        // count in the tally and the counts inside the clauses are the
        // same falls counted once.
        //
        // `atCap` is the row ceiling of THIS query, not of the falls
        // branch alone — a window crowded with other events truncates
        // the oldest falls just as effectively as a window crowded with
        // falls, and the quarterly comparison has to be suppressed
        // either way.
        //
        // `windowDays` IS THE OTHER HALF OF THAT SUPPRESSION AND WAS
        // NOT BEING PASSED. It is chosen by the model — `windowDays` on
        // get_my_records, anything from 1 to 730 — while the bucket
        // width over there is a fixed 90, so an arbitrary window was
        // being sliced by a fixed ruler and the leftover was printed as
        // a whole quarter. At `windowDays: 100` the model read 「2 次、
        // 1 次」 as a doubling; the comparison quarter had been observed
        // for 11 of its 90 days. falls.summary.ts cannot see the
        // window, so refusal (2) could only look at the oldest fall
        // until it was told.
        const fallsSummary = buildFallsSummary(fallRows, {
          atCap: eventsAtCap,
          now,
          windowDays,
        });
        /**
         * THE TALLY IS A FLOOR AT THE CAP AND WAS PRINTED AS A TOTAL.
         *
         * The measurement series got `countAtCap` for exactly this —
         * 「Without this flag a strict-mode answer reads count: 200 as
         * an exact total」— and this chunk carried no equivalent even
         * though `eventsAtCap` is the same expression the falls
         * comparison is already suppressed on three lines above. So
         * the code KNEW the list was truncated, dropped the quarterly
         * clause without saying why, and still handed the model
         * 「跌倒（轻）×200」and「事件条数: 200」under a label that reads
         * as a total. Driven through the retriever with 200 falls over
         * a 730-day window, that is verbatim what both modes rendered
         * — and this population reaches that ceiling: about 30% of
         * adults with FSHD fall at least monthly.
         *
         * Said in `eventSummary` because that field is on BOTH
         * allowlists, so the admission travels with the numbers in
         * every consent mode. The machine-readable half — an
         * `eventCountAtCap` boolean to match `countAtCap` — needs an
         * allowlist entry this lane may not write; see the note on the
         * chunk's `fields` below.
         */
        // Counted off the rows actually described rather than off
        // MAX_EVENT_ROWS, so the number in this sentence is the same
        // number as `eventCount` and as the tally beside it. The
        // constant would be right in production (the LIMIT is what
        // produced the cap) and wrong the moment anything else feeds
        // this function a longer list.
        const capNote = eventsAtCap
          ? `本次只读取到最近 ${countedEvents} 条随访事件（已达查询上限），更早的没有读到，` +
            `所以下面每一类的次数都只是下限，不是总数`
          : null;
        const summary = [
          ...(capNote === null ? [] : [capNote]),
          [...tally.entries()]
            .map(
              ([label, v]) =>
                `${label}×${v.count}${eventsAtCap ? ' 以上' : ''}，最近 ${v.mostRecentAge} 天前`,
            )
            .join('；'),
          ...composeFallClausesZh(fallsSummary),
        ].join('；');
        chunks.push({
          id: chunkId,
          source: this.id,
          content: '',
          /**
           * NO `eventCountAtCap` BOOLEAN HERE, AND ITS ABSENCE IS A
           * DEPENDENCY RATHER THAN A JUDGEMENT.
           *
           * `eventCount` has exactly the defect `countAtCap` exists to
           * stop on the series chunk, so the twin field is the shape
           * this wants. It cannot be added from here: layer 3 drops
           * any key off PROMPT_ALLOWLIST, and it does so with a
           * `logger.warn` per call — so emitting one ahead of its
           * allowlist entry buys a field that reaches nobody and a
           * warning on every answer that mentions an event, which is
           * how the warning that exists to catch real leaks stops
           * being read.
           *
           * TO ADD IT: `eventCountAtCap` on PROMPT_ALLOWLIST.followups
           * under BOTH `strict` and `precise` (a boolean carries no
           * patient data — the same argument `countAtCap` is listed
           * under), a FOLLOWUP_FIELD_LABELS entry in render.ts, and
           * this field emitted here. All three together, or
           * tool-descriptions.test.ts fails on the dead key.
           *
           * Until then the truncation reaches the prompt through the
           * words in `eventSummary`, which is on both allowlists and
           * is where the patient-facing half of this fix lives anyway.
           */
          metadata: { fields: { eventSummary: summary, eventCount: countedEvents } },
          distance: null,
          sourceFile: 'patient_followups/events',
          chunkIndex: 0,
        });
        citations.push({
          chunkId,
          source: this.id,
          sourceFile: 'patient_followups/events',
          chunkIndex: 0,
          snippet: PLACEHOLDER_SNIPPET,
        });
      }
    }

    if (chunks.length === 0) {
      return emptyResult(this.id, 'no_followups_found', {
        windowDays,
        metricKey: metricFilter,
      });
    }

    return {
      retrieverId: this.id,
      chunks,
      citations,
      metadata: {
        windowDays,
        metricKey: metricFilter,
        seriesCount: byMetric.size,
        // Rows the event query returned, which is telemetry rather
        // than prompt content — only `reason` is read off result
        // metadata. The prompt-facing count is the `eventCount` FIELD
        // above, and it counts only the rows that could be dated.
        eventRowCount,
      },
    };
  }
}
