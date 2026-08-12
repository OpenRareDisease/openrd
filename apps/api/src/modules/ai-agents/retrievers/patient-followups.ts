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

/**
 * Metric keys the record can actually contain, mapped to the label
 * used in the prompt.
 *
 * Derived from `FUNCTION_TEST_TYPES` and `SYMPTOM_KEYS` — the same
 * enums the write path validates against (`profile.schema.ts` z.enum
 * + DB CHECK). An earlier version of this table invented
 * `grip_strength` / `arm_raise` / `walk_6min`, none of which can exist
 * in the database, while omitting the ones that can: a patient asking
 * 「我抬臂是不是变弱了」was answered「你还没有记录过这项」because the
 * tool advertised a key the retriever could never match, and the real
 * self-test data lives under `muscle_deltoid`.
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
  muscle_deltoid: '肌力·三角肌',
  muscle_biceps: '肌力·肱二头肌',
  muscle_triceps: '肌力·肱三头肌',
  muscle_tibialis: '肌力·胫前肌',
  muscle_quadriceps: '肌力·股四头肌',
  muscle_hamstrings: '肌力·腘绳肌',
  muscle_gluteus: '肌力·臀肌',
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

const daysAgo = (value: string | Date, now: number): number | null => {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(t)) return null;
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
  if (earliest === 0) return latest === 0 ? 'flat' : 'up';
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
        { count: r.unable_count, mostRecentDays: r.most_recent_days },
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
        .map((row) => ({ value: toNumber(row.value), age: daysAgo(row.recorded_at, now) }))
        .filter((p): p is { value: number; age: number } => p.value !== null && p.age !== null);
      if (allPoints.length === 0) continue;

      const earliest = allPoints[0];
      const latest = allPoints[allPoints.length - 1];
      // First unit we recognise, not first unit present: a row whose
      // unit fails the allowlist contributes nothing rather than
      // poisoning the whole series' suffix.
      const unit = rows.map((row) => canonicalUnit(row.unit)).find((u) => u !== null) ?? null;
      const direction = describeDirection(earliest.value, latest.value);

      // The point list is what costs tokens, so that is what gets cut.
      const shownPoints = allPoints.slice(-MAX_POINTS_PER_SERIES);
      const truncated = shownPoints.length < allPoints.length;
      // SQL handed back a full page, so there are older readings we
      // never saw. Say「以上」rather than quoting a total that is only
      // the cap looking back at us.
      const atRowCap = rows.length >= MAX_ROWS_PER_SERIES;
      const totalLabel = atRowCap ? `${allPoints.length} 次以上` : `${allPoints.length} 次`;

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
            // answer reads `count: 200` as an exact total. Booleans
            // carry no patient data, so it goes in both lists too.
            countAtCap: atRowCap,
            spanDays: earliest.age - latest.age,
            changeDirection: direction,
            // strict-mode band: direction without the raw numbers
            latestBand:
              direction === 'up' ? '较前升高' : direction === 'down' ? '较前降低' : '基本持平',
            // precise-mode raw values
            unit,
            latestValue: latest.value,
            // Say so when the list is a tail, otherwise the model reads
            // `count: 20` next to 12 points and reconciles the gap by
            // inventing something.
            series: truncated
              ? `（仅列出最近 ${shownPoints.length} 次，共 ${totalLabel}）` +
                shownPoints.map((p) => `${p.value}${unit ?? ''}(${p.age}天前)`).join('、')
              : shownPoints.map((p) => `${p.value}${unit ?? ''}(${p.age}天前)`).join('、'),
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
            spanDays: 0,
            changeDirection: 'flat',
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
    if (eventRowCount > 0 && !metricFilter) {
      // Counted by (type, severity) rather than listed: the patient's
      // own description of each event is free text we don't ship, and
      // "跌倒（轻）×2，最近 3 天前" is the clinically useful residue.
      const tally = new Map<string, { count: number; mostRecentAge: number }>();
      const fallRows: EventRow[] = [];
      for (const row of eventsResult.rows) {
        // Falls carry a day-precision age computed in SQL, because
        // their date column is a DATE and a JS-side midnight would age
        // every one of them by an extra day east of Greenwich. Every
        // other event has a real timestamp and keeps the old path.
        const age =
          row.event_type === 'fall' ? fallDayAge(row, now) : daysAgo(row.occurred_at, now);
        if (age === null) continue;
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
        const fallsSummary = buildFallsSummary(fallRows, {
          atCap: eventRowCount >= MAX_EVENT_ROWS,
          now,
        });
        const summary = [
          [...tally.entries()]
            .map(([label, v]) => `${label}×${v.count}，最近 ${v.mostRecentAge} 天前`)
            .join('；'),
          ...composeFallClausesZh(fallsSummary),
        ].join('；');
        chunks.push({
          id: chunkId,
          source: this.id,
          content: '',
          metadata: { fields: { eventSummary: summary, eventCount: eventRowCount } },
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
        eventCount: eventRowCount,
      },
    };
  }
}
