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
 * `unit` and `protocol` are the two patient-writable columns this file
 * does read, and neither is excluded because neither has to be
 * forwarded to be useful: both are mapped through fixed tables on the
 * way out (UNIT_ALIASES; TIMED_TEST_LABELS / QUALITY_GRADES /
 * LITERAL_PROTOCOL_LABELS) so that what reaches the prompt is chosen
 * here rather than typed by the patient, and an unrecognised value
 * becomes an absence or an unnamed curve rather than a string we
 * forward. The exclusions above and these mappings are the same rule
 * applied to columns of different shapes — never forward text we
 * cannot vouch for.
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
 * A `test_type` is not a test
 * ---------------------------
 * AND THE SENTENCE ABOVE WAS THE ONLY HALF OF THAT RULE THIS FILE
 * ENFORCED. The series query keyed a curve on `test_type` alone, so
 * every measurement that files under one type was one curve — and
 * `patient_function_tests.protocol`, the column whose entire job is to
 * say which measurement a row is, was not selected at all.
 *
 * What that produced, read off the rendered prompt: the daily record's
 * 连续上 10 级台阶 and the timed-test card's 四级台阶上下 — four steps UP
 * AND BACK DOWN, a different distance, both `stair_climb`, both `sec`,
 * so the unit guard above cannot see it — came out as one 上楼计时
 * series 「12sec(30天前)、13sec(20天前)、8.2sec(10天前)、25sec(2天前)」
 * with 「变化方向: up」、「最近变化: 较前升高」 and 「最近数值: 25」. The 25
 * is a 自由记录 four-step attempt. THE MOBILE CARD BUILT FROM THOSE SAME
 * FOUR ROWS SAYS 「最近一次连续上 10 级台阶用时 13.0 秒」 and prints,
 * on screen, 「你记录的「四级台阶上下」是另一项测试，秒数不能和这条线
 * 放在一起比」. The platform refused it to the patient's face and
 * asserted it to the model in the same breath.
 *
 * The quality grade is the other half. `protocol` also carries which of
 * 按方案完成 / 条件不完整 / 自由记录 the patient chose, and the grade
 * picker promises them that only 按方案完成 is plotted and that the
 * other two 「会存下来，也会显示，但不会和别的次数放在一条趋势线上比」.
 * They were being averaged into the direction anyway.
 *
 * So a function-test curve is identified by (test_type, protocol
 * identity, quality grade, side), not by `test_type`. See
 * `resolveSeriesIdentity`. Two consequences worth stating because they
 * are what the code now guarantees rather than what it hopes:
 *
 *   - The row cap partitions on the same four things, so a patient with
 *     200 daily stair records no longer starves their four-step series
 *     of every row it has.
 *   - `unableSql` groups on them too. It grouped on `test_type`, so
 *     after this split one 「做不到」 tally would otherwise have been
 *     stamped onto every sub-series of that type — the same count
 *     printed two and three times over.
 *
 * `side` was the third thing dropped, on the branch that argues hardest
 * for keeping it. `patient_function_tests.side` is written for 握力,
 * and left and right grip were one `custom` curve: 28kg → 20kg → 27kg,
 * rendered 「基本持平」, where the readings are a left hand, a right hand
 * and a left hand. FSHD is defined by asymmetric involvement.
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

const hasOwn = (table: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, key);

/* ------------------------------------------------------------------ */
/* Which test a function-test row is, and whether it may be plotted    */
/* ------------------------------------------------------------------ */

/**
 * ALL FOUR TABLES BELOW ARE A HAND COPY OF
 * `apps/mobile/lib/timed-test-protocols.ts`, AND THERE IS NOWHERE
 * SHARED TO PUT THE ORIGINAL.
 *
 * That file owns the encoding: it writes `protocol`, it defines the
 * quality grades, it defines `trendEligible`, and `shouldExcludeFromTrend`
 * is the predicate this retriever has to apply if the prompt and the
 * patient's own screen are to say the same thing. It cannot be imported
 * from here. The workspaces are `apps/*` with no shared package, and
 * `apps/mobile` is an Expo/React-Native app the API build must not pull
 * in.
 *
 * WHERE IT SHOULD LIVE (a decision for a lane that owns both sides):
 * the repo already has a convention for exactly this — mobile mirrors
 * `FUNCTION_TEST_UNITS` and `MUSCLE_GROUPS` out of the API's
 * `profile.schema.ts` / `profile.constants.ts` by hand, with a comment
 * on each copy naming the original（「Same two-place discipline」）. The
 * `protocol` encoding belongs on the same footing and in the same
 * direction, because it is the API's column and the API is the side
 * that must not trust it: a new
 * `apps/api/src/modules/patient-profile/function-test-protocol.ts`
 * holding the prefix, the test-id labels, the grade table and
 * `decodeProtocolField`, imported by `profile.schema.ts` to CHECK the
 * column on write, imported here to read it, and mirrored by
 * `timed-test-protocols.ts` under the comment that convention already
 * uses. Until then: a grade added there and not here silently becomes
 * trend-eligible on this side, which is the failure this block is a
 * copy of.
 *
 * Nothing below is ever emitted from the patient's string. `protocol`
 * is `z.string().max(120)` over a TEXT column with no CHECK — the same
 * unvouched-for free text as `unit`, `notes` and event descriptions —
 * so it is mapped through these tables on the way out exactly the way
 * `UNIT_ALIASES` maps a unit, and an unrecognised value becomes a
 * series we decline to name rather than a string we forward.
 */
const TIMED_TEST_PREFIX = 'tt1';

/** `TIMED_TESTS[].id` → `nameZh`. */
const TIMED_TEST_LABELS: Record<string, string> = {
  sit_to_stand_30s: '30 秒坐站',
  sit_to_stand_5x: '5 次起坐',
  ten_meter_walk: '10 米步行',
  timed_up_and_go: '起立行走计时（TUG，3 米）',
  stair_four_step: '四级台阶上下',
  anti_gravity_four: '四项抗重力',
  two_minute_walk: '2 分钟步行',
  six_minute_walk: '6 分钟步行（有条件时）',
  grip_strength: '握力（选做）',
};

/**
 * Timed tests whose rows are NOT all the same measurement even after
 * the identity above is resolved.
 *
 * 四项抗重力 is four separate movements — 坐→站, 站→坐, 上一级台阶,
 * 下一级台阶 — each graded 0-2, and all four share one `testType`, one
 * `protocol` string and one unit. The only thing telling them apart is
 * a line the write path puts in `notes`（「抗重力项目：坐 → 站」）, and
 * `notes` is the free-text column this file's header refuses to read.
 *
 * So this is a series whose points are known to be incommensurable and
 * whose discriminator is unreachable. Two rows scored 2 then 0 are as
 * likely to be two different movements as one movement that got worse,
 * and 「变化方向: down」 over them says a patient has lost something.
 * Listed rather than inferred, because the property is a fact about the
 * protocol card, not about any row.
 */
const MULTI_ITEM_TIMED_TESTS: ReadonlySet<string> = new Set(['anti_gravity_four']);

/** `QUALITY_GRADES` — the label and the one flag consumers plot on. */
const QUALITY_GRADES: Record<string, { label: string; trendEligible: boolean }> = {
  per_protocol: { label: '按方案完成', trendEligible: true },
  partial: { label: '条件不完整', trendEligible: false },
  free: { label: '自由记录', trendEligible: false },
};

/**
 * Protocol strings that are a fixed literal rather than an encoding.
 *
 * One entry, and it is the important one: the daily record form writes
 * this exact string on every stair row it has ever posted, which is
 * what makes 连续上 10 级台阶 identifiable at all. Keyed on the raw
 * value and answered with a label chosen here, same contract as
 * `UNIT_ALIASES`.
 *
 * `slug` exists so the matched string is not echoed back into the
 * series key. It would be safe — only an exact allowlist hit gets here,
 * so the value is one of ours — but the key becomes a `sourceFile`, and
 * `sourceFile` rides the citation channel, which is the one channel
 * that bypasses the redactor entirely. A key built from an ascii
 * constant cannot become an exfiltration path the day someone widens
 * this table by pattern instead of by literal.
 */
const LITERAL_PROTOCOL_LABELS: Record<string, { slug: string; label: string }> = {
  '连续上 10 级台阶': { slug: 'daily_ten_step', label: '连续上 10 级台阶' },
};

interface DecodedProtocol {
  testId: string;
  grade: string;
}

/**
 * `decodeProtocolField` — null for anything this encoding did not
 * write, including the 连续上 10 级台阶 literal above and every legacy
 * row.
 *
 * The trailing human-readable segment is deliberately ignored. It is
 * the half of the string that can be truncated (the writer caps the
 * whole field at 120), and it is the half a hand-written row could put
 * anything into; the identity is the first three segments or it is
 * nothing.
 */
const decodeProtocolField = (value: string | null): DecodedProtocol | null => {
  if (!value) return null;
  const parts = value.split('|');
  if (parts.length < 3 || parts[0] !== TIMED_TEST_PREFIX) return null;
  const [, testId, grade] = parts;
  if (!hasOwn(TIMED_TEST_LABELS, testId) || !hasOwn(QUALITY_GRADES, grade)) return null;
  return { testId, grade };
};

/**
 * One curve, and everything that decides it is one.
 *
 * `key` is the grouping key AND the `sourceFile` discriminator, so it
 * is built only from values chosen in this file. An unrecognised
 * protocol contributes an ordinal, never its own text: citations are
 * the one channel that bypasses the redactor (see
 * `PLACEHOLDER_SNIPPET`), and a `sourceFile` is a citation field.
 *
 * `metricKey` stays the bare `test_type` even when the curve is a
 * sub-series of it, because it is also the `metricKey` filter surface —
 * `get_my_records` documents the enum, and the ask-context drawer aims
 * at 「stair_climb」 when the patient taps the 上楼计时 card. Splitting
 * that key would make the drawer's own filter return nothing. What
 * distinguishes the chunks is `metricLabel`.
 */
interface SeriesIdentity {
  key: string;
  metricKey: string;
  label: string;
  /**
   * The band to print INSTEAD of a direction, or null when this curve
   * is comparable with itself. Non-null means no `changeDirection`, no
   * trend band and no `latestValue` — the points still ship, because
   * 「会存下来，也会显示」 is a promise the grade picker makes to the
   * patient and the timeline keeps.
   */
  notComparableReason: string | null;
}

/** Only `left` / `right` split a curve, matching the muscle branch of
 *  the UNION, which folds `none` and `bilateral` together. */
const SIDE_KEYS: Record<string, string> = { left: '_left', right: '_right' };

/**
 * Resolve one row's curve. Stateful in one respect only: unrecognised
 * protocol strings are numbered in encounter order, so that two of them
 * under the same metric stay two curves without either string being
 * repeated back.
 *
 * ONE RESOLVER SERVES BOTH THE SERIES QUERY AND THE 「做不到」 QUERY.
 * They must agree on the key or an unable tally lands on the wrong
 * curve — or on a curve of its own, which reads as a metric the patient
 * has only ever failed.
 */
const makeSeriesIdentityResolver = () => {
  const unnamed = new Map<string, number>();

  return (metricKey: string, protocol: string | null, side: string | null): SeriesIdentity => {
    const sideKey = side !== null && hasOwn(SIDE_KEYS, side) ? SIDE_KEYS[side] : '';
    const sideLabel = sideKey ? SIDE_SUFFIX_LABELS[sideKey] : '';
    const baseLabel = labelForMetric(metricKey);
    const raw = protocol === null ? '' : protocol.trim();

    const identity = (suffix: string, label: string, reason: string | null): SeriesIdentity => ({
      key: `${metricKey}${suffix}${sideKey}`,
      metricKey,
      label: `${label}${sideLabel}`,
      notComparableReason: reason,
    });

    // No protocol at all: the row says nothing about which measurement
    // it is, so it keeps the pre-existing key and label. Every symptom
    // score and every muscle measurement lands here, as does a legacy
    // function test written before the column was used.
    if (raw === '') return identity('', baseLabel, null);

    if (hasOwn(LITERAL_PROTOCOL_LABELS, raw)) {
      const literal = LITERAL_PROTOCOL_LABELS[raw];
      return identity(`@lit:${literal.slug}`, `${baseLabel}·${literal.label}`, null);
    }

    const decoded = decodeProtocolField(raw);
    if (decoded) {
      const grade = QUALITY_GRADES[decoded.grade];
      const testLabel = TIMED_TEST_LABELS[decoded.testId];
      // `shouldExcludeFromTrend`, restated. The grade is named in the
      // label as well as in the reason, because two chunks under one
      // `metricKey` are told apart by the label alone.
      const label = grade.trendEligible
        ? `${baseLabel}·${testLabel}`
        : `${baseLabel}·${testLabel}（${grade.label}）`;
      const reason = !grade.trendEligible
        ? `本期这些记录在填写时标记为「${grade.label}」，按记录时的约定不与其他次数放在同一条趋势线上比较，` +
          '所以这里只列出各次记录，不给出变化方向'
        : MULTI_ITEM_TIMED_TESTS.has(decoded.testId)
          ? `「${testLabel}」包含多个动作项，它们共用同一条记录标识，` +
            '本平台读不到每次记录的是哪一项，所以这些数值可能来自不同动作，不能当作同一条曲线比较'
          : null;
      return identity(`@tt:${decoded.testId}:${decoded.grade}`, label, reason);
    }

    // A protocol string nothing in this file wrote. It is still an
    // identity — merging it into the no-protocol curve is the same
    // merge this whole block exists to stop — but it is one we cannot
    // name, so it gets an ordinal and a label that says only that.
    const unnamedKey = `${metricKey} ${raw}`;
    let ordinal = unnamed.get(unnamedKey);
    if (ordinal === undefined) {
      ordinal = unnamed.size + 1;
      unnamed.set(unnamedKey, ordinal);
    }
    return identity(
      `@other:${ordinal}`,
      `${baseLabel}·其他记录方式 ${ordinal}`,
      '这些记录标注了本平台无法识别的做法，不能确定它们和其他次数是同一种测量，' +
        '所以只列出各次记录，不给出变化方向',
    );
  };
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
  /** Which measurement this row is. Never forwarded; see
   *  `resolveSeriesIdentity`. */
  protocol: string | null;
  side: string | null;
}

interface UnableRow {
  metric_key: string;
  protocol: string | null;
  side: string | null;
  unable_count: number;
  most_recent_days: number;
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
    // same columns the grouping loop below keys on, so each curve keeps
    // its own most-recent rows instead of the three tables competing
    // for one global budget. Ordering ascending has to happen after the
    // cut, not before it.
    //
    // THE PARTITION IS ON THE RAW `protocol`, WHILE THE GROUPING LOOP
    // KEYS ON THE IDENTITY IT DECODES TO, AND THAT ASYMMETRY IS THE
    // SAFE DIRECTION. Two raw strings can decode to one identity (the
    // human tail is truncated at 120 and ignored on read), so the SQL
    // partition is never coarser than the JS one — it can only fetch a
    // curve MORE rows than the cap, never fewer. `atRowCap` below is
    // therefore computed per raw partition rather than off the merged
    // group, or a curve assembled from two partitions would claim
    // truncation it never hit.
    const seriesSql = `
      WITH series AS (
      SELECT ft.test_type AS metric_key,
             ft.unit      AS unit,
             ft.measured_value AS value,
             ft.performed_at   AS recorded_at,
             ft.protocol       AS protocol,
             ft.side           AS side
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
             ss.recorded_at AS recorded_at,
             NULL::text     AS protocol,
             NULL::text     AS side
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
             pm.recorded_at               AS recorded_at,
             -- Side is already folded into metric_key three lines up,
             -- so it must NOT come out again here: the identity
             -- resolver would append a second（左）to the label.
             NULL::text                   AS protocol,
             NULL::text                   AS side
        FROM patient_measurements pm
        JOIN patient_profiles pp ON pp.id = pm.profile_id
       WHERE pp.user_id = $1
         AND pm.recorded_at >= NOW() - ($2 || ' days')::interval
      ), ranked AS (
        SELECT metric_key, unit, value, recorded_at, protocol, side,
               ROW_NUMBER() OVER (
                 PARTITION BY metric_key, COALESCE(protocol, ''), COALESCE(side, '')
                 ORDER BY recorded_at DESC
               ) AS rn
          FROM series
      )
      SELECT metric_key, unit, value, recorded_at, protocol, side
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
     *
     * GROUPED ON THE SAME THREE COLUMNS THE SERIES IS, AND IT USED TO
     * GROUP ON `test_type` ALONE. A 「做不到」 is a failed attempt at ONE
     * test, and once `stair_climb` stopped being one curve a single
     * tally keyed on `stair_climb` would have been stamped onto the
     * 连续上 10 级台阶 chunk AND the 四级台阶上下 chunk —
     * 「另有 6 次记录为做不到」 printed twice, in two chunks, in one
     * prompt, off six rows. That is this file's own defect running the
     * other way.
     */
    const unableSql = `
      SELECT ft.test_type AS metric_key,
             ft.protocol   AS protocol,
             ft.side       AS side,
             COUNT(*)::int AS unable_count,
             MIN(EXTRACT(EPOCH FROM (NOW() - ft.performed_at)) / 86400)::int AS most_recent_days
        FROM patient_function_tests ft
        JOIN patient_profiles pp ON pp.id = ft.profile_id
       WHERE pp.user_id = $1
         AND ft.deleted_at IS NULL
         AND ft.not_applicable = TRUE
         AND ft.performed_at >= NOW() - ($2 || ' days')::interval
       GROUP BY ft.test_type, ft.protocol, ft.side`;

    const [seriesResult, eventsResult, unableResult] = await Promise.all([
      this.pool.query<SeriesRow>(seriesSql, [ctx.userId, String(windowDays)]),
      this.pool.query<EventRow>(eventsSql, [ctx.userId, String(windowDays)]),
      this.pool.query<UnableRow>(unableSql, [ctx.userId, String(windowDays)]),
    ]);

    // ONE RESOLVER FOR BOTH QUERIES. See `makeSeriesIdentityResolver`:
    // an unrecognised protocol is numbered in encounter order, and two
    // resolvers would number the same string differently and put a
    // 「做不到」 tally on a curve it did not come from.
    const resolveSeriesIdentity = makeSeriesIdentityResolver();

    // Indexed by SERIES, not by metric, so a curve carries its own
    // unable count — and so a curve with nothing BUT unable days still
    // produces a chunk rather than vanishing.
    const unableBySeries = new Map<
      string,
      { identity: SeriesIdentity; count: number; mostRecentDays: number }
    >();
    for (const r of unableResult.rows ?? []) {
      const identity = resolveSeriesIdentity(r.metric_key, r.protocol ?? null, r.side ?? null);
      const prev = unableBySeries.get(identity.key);
      // Two SQL groups can decode to one identity — see the note on the
      // series partition. Summing rather than overwriting keeps the
      // count equal to the number of rows, and the age the newest of
      // them.
      const mostRecentDays =
        // CLAMPED THE WAY `daysAgo` IS, AND IT WAS THE ONE AGE ON THIS
        // FILE THAT WAS NOT. `performedAt` is caller-supplied with no
        // upper bound, so a row dated tomorrow makes SQL return a
        // negative and the sentence below reached both modes as
        // 「最近一次 -3 天前」— driven through the retriever and read off
        // the rendered prompt.
        Number.isFinite(r.most_recent_days) ? Math.max(0, Math.round(r.most_recent_days)) : 0;
      unableBySeries.set(identity.key, {
        identity,
        count: (prev?.count ?? 0) + r.unable_count,
        mostRecentDays: Math.min(prev?.mostRecentDays ?? mostRecentDays, mostRecentDays),
      });
    }

    const now = Date.now();
    const chunks: RetrievedChunk[] = [];
    const citations: Citation[] = [];

    /**
     * Group the union into one series per CURVE.
     *
     * `rawCounts` is per SQL partition rather than per curve, because
     * that is the only thing `MAX_ROWS_PER_SERIES` actually bounds —
     * see the note on `seriesSql`. A curve assembled from two raw
     * partitions would otherwise sum its way past 200 and claim a
     * truncation that never happened, in a field labelled
     * 「记录次数已达上限(实际更多)」.
     */
    const byMetric = new Map<
      string,
      { identity: SeriesIdentity; rows: SeriesRow[]; rawCounts: Map<string, number> }
    >();
    for (const row of seriesResult.rows) {
      const identity = resolveSeriesIdentity(
        row.metric_key,
        row.protocol ?? null,
        row.side ?? null,
      );
      // The filter is on the metric key the tool documents, not on the
      // curve: `get_my_records(metricKey: "stair_climb")` — which is
      // what the ask-context drawer sends when the patient taps the
      // 上楼计时 card — has to keep returning every stair curve.
      if (metricFilter && identity.metricKey !== metricFilter) continue;
      const group = byMetric.get(identity.key) ?? {
        identity,
        rows: [],
        rawCounts: new Map<string, number>(),
      };
      group.rows.push(row);
      const rawKey = `${row.metric_key} ${row.protocol ?? ''} ${row.side ?? ''}`;
      group.rawCounts.set(rawKey, (group.rawCounts.get(rawKey) ?? 0) + 1);
      byMetric.set(identity.key, group);
    }

    for (const [, { identity, rows, rawCounts }] of byMetric) {
      const metricKey = identity.metricKey;
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
       *
       * `comparable` IS THE FOURTH CONDITION AND THE ONE THIS FILE WAS
       * MISSING ENTIRELY. Points can be two per day, a full day apart
       * and all in `sec`, and still not be a curve — because they are
       * two different tests, or a grade the patient was promised would
       * never be compared, or four movements sharing one row shape. See
       * `SeriesIdentity.notComparableReason`.
       */
      const comparable = !mixedUnits && identity.notComparableReason === null;
      const direction =
        comparable && allPoints.length >= 2 && spanDays >= 1
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
        comparable && direction === null && allPoints.length >= 2
          ? '本期这些记录都落在不到一天之内，时间跨度不足一天，不能据此判断变化方向'
          : null;
      /**
       * THE ONE FIELD THIS FILE PUTS ITS REFUSALS IN, RESOLVED ONCE
       * INSTEAD OF BY SPREAD ORDER.
       *
       * There are four things that can claim `latestBand` and they used
       * to be four conditional spreads in the object literal below,
       * where precedence was whatever order the keys happened to appear
       * in and each one needed a comment explaining which of the others
       * it was allowed to overwrite. That is an invariant asserted in
       * prose. Resolved here it is an invariant the code has: the
       * strongest refusal present wins, and only one of them can be
       * non-null at a time anyway, because each later condition is
       * gated on the earlier ones being absent.
       */
      const directionBand =
        direction === null
          ? null
          : direction === 'up'
            ? '较前升高'
            : direction === 'down'
              ? '较前降低'
              : '基本持平';
      const mixedUnitBand = mixedUnits
        ? `本期记录混用了 ${[...unitsPresent].join(' / ')} 等不同单位，` +
          '不能当作同一条曲线比较，因此不给出变化方向和历次数值'
        : null;
      const latestBand =
        mixedUnitBand ?? identity.notComparableReason ?? sameSittingBand ?? directionBand;

      // The point list is what costs tokens, so that is what gets cut.
      const shownPoints = allPoints.slice(-MAX_POINTS_PER_SERIES);
      const truncated = shownPoints.length < allPoints.length;
      // SQL handed back a full page for at least one of the raw
      // partitions feeding this curve, so there are older readings we
      // never saw. Say「以上」rather than quoting a total that is only
      // the cap looking back at us.
      const atRowCap = [...rawCounts.values()].some((n) => n >= MAX_ROWS_PER_SERIES);
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
            // Names the CURVE, not the test_type: two chunks can share
            // one `metricKey` now, and this is the only field that
            // tells the reader 连续上 10 级台阶 from 四级台阶上下. Built
            // from the fixed tables above; no part of it is the
            // patient's own protocol string.
            metricLabel: identity.label,
            count: allPoints.length,
            // 「做不到」days for THIS CURVE — keyed on the series
            // identity, not the metric, so a failed 四级台阶上下 is not
            // reported against 连续上 10 级台阶. Non-identifying (a
            // count and an age), so it passes in both redaction modes —
            // a basic-consent answer needs this as much as a precise
            // one. Composed here rather than shipped as two bare
            // numbers. Run against a real model, `unableCount: 1`
            // sitting beside `series` was read as
            // 「最近一次（16秒这次）标记的是做不到」— it assumed the unable
            // day was one of the listed readings, then flagged its own
            // conclusion as odd because an unable attempt has no time.
            // The two sets are disjoint by construction (the series
            // query filters `not_applicable = FALSE`), so the text has
            // to say so.
            ...(unableBySeries.has(identity.key)
              ? {
                  unableSummary:
                    `另有 ${unableBySeries.get(identity.key)!.count} 次记录为「做不到」` +
                    `（这些次没有数值，不在上面的历次记录里），` +
                    `最近一次 ${unableBySeries.get(identity.key)!.mostRecentDays} 天前`,
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
            // A direction is a claim about change, so it is absent from
            // every series that records none — one reading, one
            // sitting, mixed units, or rows that are not comparable in
            // the first place. See `direction` above.
            ...(direction === null ? {} : { changeDirection: direction }),
            // WHERE THIS FILE PUTS ITS REFUSALS, AND WHY IT NEVER GOES
            // QUIET INSTEAD.
            //
            // `latestBand` carries either a direction as a phrase or
            // the reason there is none, and it is on BOTH allowlists
            // for the second of those: a statement that no series is
            // being read is the platform declining to read one, not a
            // value withheld for consent. Left silent, the model would
            // see three readings over 60 days with no direction, no
            // unit and no point list, and the failure mode of a model
            // handed a hole is that it fills it. Every word of every
            // reason is chosen in this file — the unit names come from
            // UNIT_ALIASES, the test and grade names from the tables at
            // the top; never the patient's own string.
            ...(latestBand === null ? {} : { latestBand }),
            // Mixed units means the numbers are not even in the same
            // measure, so the whole curve goes. A curve that is merely
            // NOT COMPARABLE WITH ITSELF keeps its points and loses
            // only `latestValue`: 「会存下来，也会显示」 is what the grade
            // picker promises the patient, and the 时间轴 keeps it by
            // listing each such record with its grade. What that screen
            // does NOT do is offer one of them as 「最近数值」, which
            // reads as a current level, so neither does this.
            ...(mixedUnits
              ? {}
              : {
                  unit,
                  ...(comparable ? { latestValue: latest.value } : {}),
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
        sourceFile: `patient_followups/${identity.key}`,
        chunkIndex: 0,
      });
      citations.push({
        chunkId,
        source: this.id,
        sourceFile: `patient_followups/${identity.key}`,
        chunkIndex: 0,
        snippet: PLACEHOLDER_SNIPPET,
      });
    }

    // A CURVE whose only rows are「做不到」produces no series above,
    // and silently dropping it recreates the exact failure this column
    // was added to fix: the patient records「今天做不了」six times and
    // is then told they have never recorded this. Keyed on the series
    // identity like everything else, so a patient who can still manage
    // 连续上 10 级台阶 but has stopped being able to do 四级台阶上下
    // gets both facts, under their own names, instead of one of them
    // deciding for the other.
    for (const [seriesKey, unable] of unableBySeries) {
      if (byMetric.has(seriesKey)) continue;
      if (metricFilter && unable.identity.metricKey !== metricFilter) continue;
      const chunkId = randomUUID();
      chunks.push({
        id: chunkId,
        source: this.id,
        content: '',
        metadata: {
          fields: {
            metricKey: unable.identity.metricKey,
            metricLabel: unable.identity.label,
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
        sourceFile: `patient_followups/${seriesKey}`,
        chunkIndex: 0,
      });
      citations.push({
        chunkId,
        source: this.id,
        sourceFile: `patient_followups/${seriesKey}`,
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
