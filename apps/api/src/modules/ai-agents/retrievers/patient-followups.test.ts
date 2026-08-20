import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { RetrieveContext } from './base.js';
import { isKnownMetricKey, PatientFollowupRetriever } from './patient-followups.js';
import { MUSCLE_GROUPS } from '../../patient-profile/profile.constants.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

const ctx = (over: Partial<RetrieveContext> = {}): RetrieveContext => ({
  userId: 'user-1',
  consentLevel: 'precise',
  logger: silentLogger,
  ...over,
});

const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/** First query is the metric UNION, second is the events tally. */
const poolWith = (seriesRows: unknown[], eventRows: unknown[] = [], unableRows: unknown[] = []) => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: seriesRows, rowCount: seriesRows.length })
    .mockResolvedValueOnce({ rows: eventRows, rowCount: eventRows.length })
    .mockResolvedValueOnce({ rows: unableRows, rowCount: unableRows.length });
  return { query } as unknown as Pool;
};

describe('PatientFollowupRetriever', () => {
  it('refuses without a user in scope', async () => {
    const pool = poolWith([]);
    const r = await new PatientFollowupRetriever(pool).search(
      { question: '' },
      ctx({ userId: null }),
    );
    expect(r.chunks).toHaveLength(0);
    expect(r.metadata.reason).toBe('no_user_in_scope');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('refuses without consent', async () => {
    const pool = poolWith([]);
    const r = await new PatientFollowupRetriever(pool).search(
      { question: '' },
      ctx({ consentLevel: 'none' }),
    );
    expect(r.metadata.reason).toBe('consent_not_granted');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('scopes every query to the calling user', async () => {
    const pool = poolWith([]);
    await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    for (const call of (pool.query as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).toContain('pp.user_id = $1');
      expect(call[1][0]).toBe('user-1');
    }
  });

  it('groups rows into one series per metric and reports the direction', async () => {
    const pool = poolWith([
      { metric_key: 'stair_climb', unit: 'sec', value: '12', recorded_at: daysAgoIso(14) },
      { metric_key: 'stair_climb', unit: 'sec', value: '14', recorded_at: daysAgoIso(7) },
      { metric_key: 'stair_climb', unit: 'sec', value: '16', recorded_at: daysAgoIso(0) },
    ]);
    const r = await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());

    expect(r.chunks).toHaveLength(1);
    const f = r.chunks[0].metadata.fields as Record<string, unknown>;
    expect(f.metricKey).toBe('stair_climb');
    expect(f.metricLabel).toBe('上楼计时');
    expect(f.count).toBe(3);
    expect(f.spanDays).toBe(14);
    // Climbing stairs got slower — that's "up" on this metric, and the
    // renderer/LLM decides whether up is good or bad per metric.
    expect(f.changeDirection).toBe('up');
    expect(f.latestValue).toBe(16);
    expect(f.series).toBe('12sec(14天前)、14sec(7天前)、16sec(0天前)');
  });

  it('calls a flat series flat rather than inventing a trend', async () => {
    const pool = poolWith([
      { metric_key: 'sleep_quality', unit: null, value: 6, recorded_at: daysAgoIso(7) },
      { metric_key: 'sleep_quality', unit: null, value: 6, recorded_at: daysAgoIso(0) },
    ]);
    const r = await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const f = r.chunks[0].metadata.fields as Record<string, unknown>;
    expect(f.changeDirection).toBe('flat');
    expect(f.latestBand).toBe('基本持平');
  });

  it('tallies events by type and severity, never shipping the description', async () => {
    const pool = poolWith(
      [],
      [
        { event_type: 'fall', severity: 'mild', occurred_at: daysAgoIso(3) },
        { event_type: 'fall', severity: 'mild', occurred_at: daysAgoIso(20) },
      ],
    );
    const r = await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());

    const f = r.chunks[0].metadata.fields as Record<string, unknown>;
    expect(f.eventSummary).toBe('跌倒（轻）×2，最近 3 天前');
    expect(f.eventCount).toBe(2);
    // The patient's free-text description must never reach a field.
    expect(JSON.stringify(f)).not.toContain('description');
  });

  it('counts the events it tallied, not the rows it fetched', async () => {
    // A row whose date does not parse is skipped by the tally, and
    // `eventCount` was the raw row count — so 「事件条数: 2」 sat in the
    // same chunk as 「跌倒（轻）×1」 and left the model to account for
    // an event that has no description, no type and no date, which it
    // does by inventing one.
    const pool = poolWith(
      [],
      [
        { event_type: 'fall', severity: 'mild', occurred_at: daysAgoIso(3) },
        { event_type: 'new_foot_drop', severity: null, occurred_at: 'not-a-date' },
      ],
    );
    const r = await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const f = r.chunks[0].metadata.fields as Record<string, unknown>;
    expect(f.eventSummary).toBe('跌倒（轻）×1，最近 3 天前');
    expect(f.eventCount).toBe(1);
  });

  it('excludes retracted records from every table it reads', async () => {
    // Soft delete (migration 016) exists because a mistyped 185-second
    // stair climb otherwise becomes a permanent spike. Eight read paths
    // in profile.service.ts carry this predicate; this one — the path
    // that hands the series to the model as fact — was the only one
    // that shipped without it, so it gets a fence rather than a glance.
    const pool = poolWith([]);
    await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const queries = (pool.query as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    for (const sql of queries) {
      for (const alias of ['ft', 'ss', 'fe'].filter((a) => sql.includes(`${a}.`))) {
        expect(sql).toContain(`${alias}.deleted_at IS NULL`);
      }
    }
  });

  it('does not select the free-text columns at all', async () => {
    const pool = poolWith([]);
    await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join('\n');
    expect(sql).not.toContain('notes');
    expect(sql).not.toContain('description');
  });

  it('suppresses the event chunk when filtering to one metric', async () => {
    // Otherwise a metric-scoped ask-context would drag in unrelated
    // falls alongside the curve the patient tapped.
    const pool = poolWith(
      [{ metric_key: 'stair_climb', unit: 'sec', value: 12, recorded_at: daysAgoIso(1) }],
      [{ event_type: 'fall', severity: 'mild', occurred_at: daysAgoIso(3) }],
    );
    const r = await new PatientFollowupRetriever(pool).search(
      { question: '', filter: { metricKey: 'stair_climb' } },
      ctx(),
    );
    expect(r.chunks).toHaveLength(1);
    expect((r.chunks[0].metadata.fields as Record<string, unknown>).metricKey).toBe('stair_climb');
  });

  /** Ascending rows for one metric, oldest first — the order the SQL
   *  guarantees and the grouping loop relies on. */
  const seriesRows = (points: Array<{ days: number; value: number }>) =>
    points.map(({ days, value }) => ({
      metric_key: 'stair_climb',
      unit: 'sec',
      value: String(value),
      recorded_at: daysAgoIso(days),
    }));

  const DESCENDING_DAYS_20 = [
    190, 180, 170, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0,
  ];

  it('derives count / spanDays / direction from the whole series, not the rendered tail', async () => {
    // Eight slow readings followed by twelve fast ones. Truncating
    // before computing the statistics hands describeDirection a flat
    // tail (20 → 20) and reports 「基本持平」 to someone who actually
    // improved by a third — and the more diligently they recorded, the
    // more of the baseline gets cut, so the answer gets *more* wrong.
    const pool = poolWith(
      seriesRows(DESCENDING_DAYS_20.map((days, i) => ({ days, value: i < 8 ? 30 : 20 }))),
    );
    const r = await new PatientFollowupRetriever(pool).search(
      { question: '', filter: { windowDays: 365 } },
      ctx(),
    );
    const f = r.chunks[0].metadata.fields as Record<string, unknown>;

    // Every one of these would be computed off the last 12 points if
    // the slice moved back above the statistics.
    expect(f.count).toBe(20); // not 12
    expect(f.spanDays).toBe(190); // not 110, the span of the tail
    expect(f.changeDirection).toBe('down'); // not 'flat'
    expect(f.latestBand).toBe('较前降低');
    expect(f.latestValue).toBe(20);

    // The citation snippet counts the same way the fields do.
    expect(r.citations).toHaveLength(1);
  });

  it('renders at most 12 points and says so, naming the real total', async () => {
    const pool = poolWith(
      seriesRows(DESCENDING_DAYS_20.map((days, i) => ({ days, value: i < 8 ? 30 : 20 }))),
    );
    const r = await new PatientFollowupRetriever(pool).search(
      { question: '', filter: { windowDays: 365 } },
      ctx(),
    );
    const series = (r.chunks[0].metadata.fields as Record<string, unknown>).series as string;

    // Points are joined by 、 and the banner is glued to the first one,
    // so the segment count is the point count.
    expect(series.split('、')).toHaveLength(12);
    // The eight cut readings must not survive anywhere in the string.
    expect(series).not.toContain('30sec');
    // Without the banner the model sees `count: 20` next to 12 points
    // and reconciles the gap by inventing the missing eight.
    expect(series).toContain('仅列出最近 12 次');
    expect(series).toContain('共 20 次');
    // The tail is the *recent* end, not the oldest rows.
    expect(series).toContain('20sec(110天前)');
    expect(series).toContain('20sec(0天前)');
  });

  it('does not announce truncation when the series fits exactly', async () => {
    const twelveDays = [110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];
    const pool = poolWith(seriesRows(twelveDays.map((days) => ({ days, value: 20 }))));
    const r = await new PatientFollowupRetriever(pool).search(
      { question: '', filter: { windowDays: 365 } },
      ctx(),
    );
    const f = r.chunks[0].metadata.fields as Record<string, unknown>;

    expect(f.count).toBe(12);
    expect(f.spanDays).toBe(110);
    expect(f.series as string).not.toContain('仅列出最近');
    expect((f.series as string).split('、')).toHaveLength(12);
  });

  it('clamps the window instead of trusting the caller', async () => {
    const pool = poolWith([]);
    await new PatientFollowupRetriever(pool).search(
      { question: '', filter: { windowDays: 99999 } },
      ctx(),
    );
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls[0][1][1]).toBe('730');
  });

  it('tells「做不到」apart from「没记录」', async () => {
    // The distinction migration 017 exists for. Before it, an unable
    // day was a row with a null measurement — indistinguishable from
    // the days the patient simply didn't open the app, so a patient
    // who recorded「今天做不了」six times was told they had never
    // recorded this at all.
    const pool = poolWith(
      [],
      [],
      [{ metric_key: 'stair_climb', unable_count: 6, most_recent_days: 2 }],
    );
    const r = await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());

    expect(r.chunks).toHaveLength(1);
    const f = r.chunks[0].metadata.fields as Record<string, unknown>;
    expect(f.metricKey).toBe('stair_climb');
    // One sentence, not two loose numbers: a real model read a bare
    // count beside `series` as「最近一次那个数值就是做不到的那次」.
    expect(String(f.unableSummary)).toContain('6 次');
    expect(String(f.unableSummary)).toContain('没有任何可用数值');
    // Not a measurement series — zero points, and a band that says so.
    expect(f.count).toBe(0);
    expect(f.latestBand).toBe('本期均记录为做不到');
  });

  it('hangs the unable count off a metric that also has readings', async () => {
    const pool = poolWith(
      [
        { metric_key: 'stair_climb', unit: 'sec', value: '12', recorded_at: daysAgoIso(14) },
        { metric_key: 'stair_climb', unit: 'sec', value: '16', recorded_at: daysAgoIso(7) },
      ],
      [],
      [{ metric_key: 'stair_climb', unable_count: 3, most_recent_days: 1 }],
    );
    const r = await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const f = r.chunks[0].metadata.fields as Record<string, unknown>;
    expect(f.count).toBe(2);
    expect(String(f.unableSummary)).toContain('3 次');
    expect(String(f.unableSummary)).toContain('不在上面的历次记录里');
  });

  it('excludes unable rows from the measurement series', async () => {
    // An unable day is not a slow reading; averaging it in would
    // misreport the course as badly as dropping it.
    const pool = poolWith([]);
    await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const seriesSql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(seriesSql).toContain('ft.not_applicable = FALSE');
  });

  it('reports empty rather than an empty chunk when there is nothing yet', async () => {
    const pool = poolWith([], []);
    const r = await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    expect(r.chunks).toHaveLength(0);
    expect(r.metadata.reason).toBe('no_followups_found');
  });

  /**
   * Run a self-test reading for every muscle group the write path
   * accepts, and read back what the model would see.
   *
   * DRIVEN FROM THE ENUM, NOT FROM THE RETRIEVER'S TABLE, because
   * reading the table can only confirm what is in it. `face` and
   * `abdominal` were appended to `MUSCLE_GROUPS` — two of the six
   * regions the FSHD Clinical Score grades — and the table stopped one
   * short of each, so `isKnownMetricKey` said no about a curve the
   * database can hold and `get_my_records` refused the call.
   */
  it('labels every muscle group the write path accepts, and accepts its key', async () => {
    for (const group of MUSCLE_GROUPS) {
      for (const metricKey of [`muscle_${group}`, `muscle_${group}_left`]) {
        expect(isKnownMetricKey(metricKey)).toBe(true);

        const pool = poolWith([
          { metric_key: metricKey, unit: 'MRC', value: '4', recorded_at: daysAgoIso(2) },
        ]);
        const r = await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
        const fields = r.chunks[0].metadata.fields as Record<string, unknown>;
        expect(fields.metricKey).toBe(metricKey);
        // A group with no Chinese name would reach the prompt as the
        // English key or as 「肌力·undefined」; both are checked because
        // the two ways to leave one unlabelled produce one each.
        const label = String(fields.metricLabel);
        expect(label.startsWith('肌力·')).toBe(true);
        expect(label).not.toContain(group);
        expect(label).not.toContain('undefined');
      }
    }
  });
});

/**
 * A DIRECTION IS A STATEMENT ABOUT CHANGE, AND TWO SERIES SHAPES CARRY
 * NONE.
 *
 * Both used to assert one anyway, and `get_my_records`'s own
 * description tells the model to call this tool for 「我最近是不是变差
 * 了」 and promises it 「which direction they moved」 — so whatever these
 * fields say is what the patient hears back.
 */
describe('no direction without something to compare', () => {
  const fieldsOf = async (
    seriesRows: unknown[],
    unableRows: unknown[] = [],
  ): Promise<Record<string, unknown>> => {
    const r = await new PatientFollowupRetriever(poolWith(seriesRows, [], unableRows)).search(
      { question: '' },
      ctx(),
    );
    return r.chunks[0].metadata.fields as Record<string, unknown>;
  };

  it('a one-reading series carries no direction and no band', async () => {
    // earliest === latest, delta 0, 「flat」 — and the strict-mode band
    // came out 「最近变化: 基本持平」 for a patient who has recorded once.
    const f = await fieldsOf([
      { metric_key: 'stair_climb', unit: 'sec', value: '16', recorded_at: daysAgoIso(3) },
    ]);
    expect(f.count).toBe(1);
    expect(f.spanDays).toBe(0);
    expect(f.latestValue).toBe(16);
    expect(f.series).toBe('16sec(3天前)');
    expect(f.changeDirection).toBeUndefined();
    expect(f.latestBand).toBeUndefined();
  });

  it('two readings still carry both', async () => {
    const f = await fieldsOf([
      { metric_key: 'stair_climb', unit: 'sec', value: '12', recorded_at: daysAgoIso(14) },
      { metric_key: 'stair_climb', unit: 'sec', value: '16', recorded_at: daysAgoIso(0) },
    ]);
    expect(f.changeDirection).toBe('up');
    expect(f.latestBand).toBe('较前升高');
  });

  it('two readings on ONE DAY carry neither, and say why', async () => {
    // 上楼计时 is routinely done twice in a sitting — a practice
    // attempt, then the real one — and the length >= 2 test admitted
    // that pair as a trend. 10 秒 then 16 秒 the same afternoon came
    // out as 「最近变化: 较前升高」 printed beside 「跨度(天): 0」: a
    // claim about change over a span that contains none, with the
    // refutation on the next line. Which row counted as 「earliest」
    // was decided by an arbitrary ORDER BY tiebreak, so the direction
    // was not even stable between runs.
    const f = await fieldsOf([
      { metric_key: 'stair_climb', unit: 'sec', value: '10', recorded_at: daysAgoIso(0) },
      { metric_key: 'stair_climb', unit: 'sec', value: '16', recorded_at: daysAgoIso(0) },
    ]);
    expect(f.count).toBe(2);
    expect(f.spanDays).toBe(0);
    expect(f.changeDirection).toBeUndefined();
    // Deleting the claim is not the same as answering the question.
    // The model still sees two readings that got slower, and a hole
    // is the thing it fills — so the refusal is stated, in the field
    // this file puts its refusals in, on both allowlists.
    expect(String(f.latestBand)).toContain('时间跨度不足一天');
    // The readings themselves are still there; only the claim goes.
    expect(f.series).toBe('10sec(0天前)、16sec(0天前)');
  });

  /**
   * A SPAN IS AN INTERVAL, AND IT WAS THE DIFFERENCE OF TWO ROUNDED
   * BIN INDICES.
   *
   * `daysAgo` rounds, so its boundary sits at 12 hours: two readings a
   * MINUTE apart across it come out 1 apart. The guard above tested
   * `spanDays >= 1`
   * against exactly that number, so the case its own comment was
   * written for — 上楼计时 twice in a sitting — walked straight
   * through it, and the 跨度(天): 0 that used to refute the fabricated
   * 「较前升高」 now read 1 and corroborated it instead.
   */
  describe('the span comes off the timestamps, not off the rounded ages', () => {
    /** now − `ms`, so a test can place a reading to the second. */
    const msAgoIso = (ms: number) => new Date(Date.now() - ms).toISOString();
    const HOUR = 60 * 60 * 1000;

    const pairAt = async (olderMs: number, newerMs: number) =>
      fieldsOf([
        { metric_key: 'stair_climb', unit: 'sec', value: '10', recorded_at: msAgoIso(olderMs) },
        { metric_key: 'stair_climb', unit: 'sec', value: '16', recorded_at: msAgoIso(newerMs) },
      ]);

    it('reads one minute apart as one minute, not as a day', async () => {
      // The two readings straddle the 12-hour rounding boundary, so
      // their ages round to 1 and 0 while 60 seconds separate them.
      const f = await pairAt(12 * HOUR + 30_000, 12 * HOUR - 30_000);
      expect(f.spanDays).toBe(0);
      expect(f.changeDirection).toBeUndefined();
      expect(f.latestBand).not.toBe('较前升高');
      expect(String(f.latestBand)).toContain('时间跨度不足一天');
    });

    it('reads four hours across midnight as four hours', async () => {
      // Two different calendar days is not a day of elapsed time, and
      // a stair-climb pair four hours apart is fatigue, not course.
      const f = await pairAt(26 * HOUR, 22 * HOUR);
      expect(f.spanDays).toBe(0);
      expect(f.changeDirection).toBeUndefined();
    });

    it('never rounds a twenty-hour gap up into a day', async () => {
      const f = await pairAt(21 * HOUR, HOUR);
      expect(f.spanDays).toBe(0);
      expect(f.changeDirection).toBeUndefined();
    });

    it('admits a direction as soon as a full day has really passed', async () => {
      const f = await pairAt(25 * HOUR, HOUR);
      expect(f.spanDays).toBe(1);
      expect(f.changeDirection).toBe('up');
      expect(f.latestBand).toBe('较前升高');
    });

    it('measures the span across the whole series, not the array ends', async () => {
      // Order-independent by construction, so a change to the SQL
      // ORDER BY cannot quietly turn the span negative.
      const f = await fieldsOf([
        { metric_key: 'fatigue', unit: null, value: 3, recorded_at: daysAgoIso(9) },
        { metric_key: 'fatigue', unit: null, value: 5, recorded_at: daysAgoIso(40) },
        { metric_key: 'fatigue', unit: null, value: 7, recorded_at: daysAgoIso(1) },
      ]);
      expect(f.spanDays).toBe(39);
    });
  });

  it('a metric whose every row is 做不到 asserts no direction either', async () => {
    // 「flat」 about a patient who has LOST the ability to perform the
    // test was the worst available value for this field.
    const f = await fieldsOf(
      [],
      [{ metric_key: 'stair_climb', unable_count: 6, most_recent_days: 2 }],
    );
    expect(f.count).toBe(0);
    expect(f.changeDirection).toBeUndefined();
    expect(f.latestBand).toBe('本期均记录为做不到');
  });

  it('...and asserts no span either, where 0 was not a harmless value', async () => {
    // There is no series in this branch, so there is no span. 「跨度
    // (天): 0」 printed beside 「本期共 6 次记录为「做不到」…最近一次 2
    // 天前」 reads as six attempts on one day — the opposite of six
    // 做不到 records spread across the window, which is what it is.
    // The days these rows cover are never queried, so the honest
    // value is no field at all.
    const f = await fieldsOf(
      [],
      [{ metric_key: 'stair_climb', unable_count: 6, most_recent_days: 2 }],
    );
    expect(f.spanDays).toBeUndefined();
  });

  it('never ages a future-dated 做不到 row into a negative', async () => {
    // `performedAt` is `z.string().datetime()` with no upper bound, so
    // a client can post tomorrow. `daysAgo` clamps at zero for the
    // series and the events; the unable query's SQL-side age was the
    // one that did not, and 「最近一次 -3 天前」 reached both modes.
    const f = await fieldsOf(
      [],
      [{ metric_key: 'stair_climb', unable_count: 2, most_recent_days: -3 }],
    );
    expect(String(f.unableSummary)).toContain('最近一次 0 天前');
    expect(String(f.unableSummary)).not.toContain('-');
  });
});

/**
 * A SERIES IS ONE CURVE ONLY IF EVERY POINT WAS MEASURED THE SAME WAY.
 *
 * `FUNCTION_TEST_UNITS` admits both `sec` and `m/s` for one
 * `test_type`, so a patient who moved their 10-metre walk from a
 * stopwatch to a gait-speed readout has two incommensurable numbers in
 * one metric key.
 */
describe('units belong to the series identity', () => {
  const fieldsOf = async (seriesRows: unknown[]): Promise<Record<string, unknown>> => {
    const r = await new PatientFollowupRetriever(poolWith(seriesRows)).search(
      { question: '' },
      ctx(),
    );
    return r.chunks[0].metadata.fields as Record<string, unknown>;
  };

  it('refuses a direction across two recognised units, and says why', async () => {
    // 0.9 m/s over 10 metres is 11.1 seconds — SLOWER than the 10 s
    // reading two months earlier. The retriever stamped the series'
    // first recognised unit on every point and compared the raw
    // numbers, so it rendered 「0.9sec」 and banded 「较前降低」: a
    // fabricated improvement, on the metric this product exists to
    // track, produced entirely by the rendering.
    const f = await fieldsOf([
      { metric_key: 'ten_meter_walk', unit: 'sec', value: '10', recorded_at: daysAgoIso(60) },
      { metric_key: 'ten_meter_walk', unit: 'm/s', value: '0.9', recorded_at: daysAgoIso(0) },
    ]);
    expect(f.count).toBe(2);
    expect(f.spanDays).toBe(60);
    expect(f.changeDirection).toBeUndefined();
    expect(f.latestValue).toBeUndefined();
    expect(f.unit).toBeUndefined();
    // Nothing may render the m/s reading with a seconds suffix, in any
    // field, in any mode.
    expect(JSON.stringify(f)).not.toContain('0.9sec');
    // Silence would leave the model a hole to fill. `latestBand` is
    // where this file puts its refusals — 「本期均记录为做不到」 is the
    // other one — and it is on both allowlists.
    expect(String(f.latestBand)).toContain('混用');
    expect(String(f.latestBand)).toContain('m/s');
  });

  it('renders each point in its own unit rather than a neighbour’s', async () => {
    // Migration 015 NULLs any legacy unit its alias table cannot read,
    // so a live series really can hold an unlabelled 2024 row beside a
    // 「sec」 row from today. The unlabelled row asserts no unit, so it
    // does not suppress the trend — but it must not borrow one either,
    // and the series-level `unit` field has to stay away until every
    // point agrees.
    const f = await fieldsOf([
      { metric_key: 'ten_meter_walk', unit: null, value: '10', recorded_at: daysAgoIso(30) },
      { metric_key: 'ten_meter_walk', unit: 'sec', value: '20', recorded_at: daysAgoIso(0) },
    ]);
    expect(f.series).toBe('10(30天前)、20sec(0天前)');
    // Null, and the renderer drops null fields, so no 单位 line reaches
    // the prompt to be applied to the point that has none.
    expect(f.unit).toBeNull();
    expect(f.changeDirection).toBe('up');
  });

  it('still labels a series whose every point agrees', async () => {
    const f = await fieldsOf([
      { metric_key: 'ten_meter_walk', unit: 'sec', value: '10', recorded_at: daysAgoIso(30) },
      { metric_key: 'ten_meter_walk', unit: '秒', value: '20', recorded_at: daysAgoIso(0) },
    ]);
    // 「秒」 canonicalises to the same unit, so this is one curve.
    expect(f.unit).toBe('sec');
    expect(f.series).toBe('10sec(30天前)、20sec(0天前)');
    expect(f.changeDirection).toBe('up');
  });

  it('leaves a symptom score, which never carries a unit, alone', async () => {
    const f = await fieldsOf([
      { metric_key: 'fatigue', unit: null, value: 3, recorded_at: daysAgoIso(30) },
      { metric_key: 'fatigue', unit: null, value: 7, recorded_at: daysAgoIso(0) },
    ]);
    expect(f.changeDirection).toBe('up');
    expect(f.series).toBe('3(30天前)、7(0天前)');
  });
});

/**
 * A `test_type` is not a test.
 *
 * The mobile 上楼计时 card refuses exactly these merges and prints the
 * refusal on screen; these cases are the API half saying the same
 * thing. The expected strings below were read off `renderChunkForPrompt`
 * in both modes, not off the field object.
 */
describe('a curve is (test_type, protocol, grade, side)', () => {
  const TT = (id: string, grade: string, label: string) => `tt1|${id}|${grade}|${label}`;
  const DAILY_STAIR = '连续上 10 级台阶';

  const seriesOf = async (
    seriesRows: unknown[],
    unableRows: unknown[] = [],
    filter?: Record<string, unknown>,
  ) => {
    const r = await new PatientFollowupRetriever(poolWith(seriesRows, [], unableRows)).search(
      { question: '', ...(filter ? { filter } : {}) },
      ctx(),
    );
    return r.chunks.map((c) => ({
      sourceFile: c.sourceFile,
      f: c.metadata.fields as Record<string, unknown>,
    }));
  };

  /** The four rows the mobile card was driven over: two daily
   *  ten-step records, one per-protocol four-step run, one 自由记录
   *  four-step run. All `stair_climb`, all `sec`, so the unit guard
   *  cannot see any of it. */
  const MIXED_STAIR_ROWS = [
    {
      metric_key: 'stair_climb',
      unit: 'sec',
      value: '12',
      recorded_at: daysAgoIso(30),
      protocol: DAILY_STAIR,
      side: null,
    },
    {
      metric_key: 'stair_climb',
      unit: 'sec',
      value: '13',
      recorded_at: daysAgoIso(20),
      protocol: DAILY_STAIR,
      side: null,
    },
    {
      metric_key: 'stair_climb',
      unit: 'sec',
      value: '8.2',
      recorded_at: daysAgoIso(10),
      protocol: TT('stair_four_step', 'per_protocol', '四级台阶上下·按方案完成'),
      side: null,
    },
    {
      metric_key: 'stair_climb',
      unit: 'sec',
      value: '25',
      recorded_at: daysAgoIso(2),
      protocol: TT('stair_four_step', 'free', '四级台阶上下·自由记录'),
      side: null,
    },
  ];

  it('does not merge 连续上 10 级台阶 with 四级台阶上下', async () => {
    // Merged, these four rendered as one curve: 「历次记录: 12sec(30天
    // 前)、13sec(20天前)、8.2sec(10天前)、25sec(2天前)」 with 「变化方向:
    // up」 and 「最近数值: 25」 — the 25 being a 自由记录 four-step
    // attempt offered as the patient's latest stair time. The card
    // built from the same rows says 「最近一次连续上 10 级台阶用时 13.0
    // 秒」 and prints 「你记录的「四级台阶上下」是另一项测试，秒数不能和这
    // 条线放在一起比」.
    const chunks = await seriesOf(MIXED_STAIR_ROWS);
    expect(chunks).toHaveLength(3);

    const daily = chunks.find((c) => c.f.metricLabel === '上楼计时·连续上 10 级台阶')!;
    expect(daily.f.count).toBe(2);
    expect(daily.f.series).toBe('12sec(30天前)、13sec(20天前)');
    // 13, the newest reading OF THIS MEASUREMENT — the same number the
    // card puts in `latestDisplay`. Never 25.
    expect(daily.f.latestValue).toBe(13);

    const timed = chunks.find((c) => c.f.metricLabel === '上楼计时·四级台阶上下')!;
    expect(timed.f.series).toBe('8.2sec(10天前)');

    // No chunk anywhere may put a ten-step reading and a four-step
    // reading in one list. (The 自由记录 curve does carry its own 25sec
    // — 「会存下来，也会显示」 — it just carries nothing else.)
    for (const c of chunks) {
      const rendered = String(c.f.series ?? '');
      const tenStep = /12sec|13sec/.test(rendered);
      const fourStep = /8\.2sec|25sec/.test(rendered);
      expect(tenStep && fourStep).toBe(false);
    }
  });

  it('keeps a non-trend-eligible grade out of every direction', async () => {
    const chunks = await seriesOf(MIXED_STAIR_ROWS);
    const free = chunks.find((c) => c.f.metricLabel === '上楼计时·四级台阶上下（自由记录）')!;
    // 会存下来，也会显示 — the points are still there, under a label
    // that names the grade.
    expect(free.f.series).toBe('25sec(2天前)');
    // ...但不会和别的次数放在一条趋势线上比.
    expect(free.f.changeDirection).toBeUndefined();
    // Nor offered as a current level: the 时间轴 lists such a record,
    // it never renders it as 最近数值.
    expect(free.f.latestValue).toBeUndefined();
    expect(String(free.f.latestBand)).toContain('自由记录');
    expect(String(free.f.latestBand)).toContain('不给出变化方向');
  });

  it('refuses a direction across two 自由记录 readings of one test', async () => {
    // The grade means the conditions differed, so two of them are not
    // comparable with each other either — which is what the picker
    // says: 「不会和别的次数放在一条趋势线上比」, not 「只和同评级比」.
    const chunks = await seriesOf([
      {
        metric_key: 'ten_meter_walk',
        unit: 'sec',
        value: '10',
        recorded_at: daysAgoIso(30),
        protocol: TT('ten_meter_walk', 'free', '10 米步行·自由记录'),
        side: null,
      },
      {
        metric_key: 'ten_meter_walk',
        unit: 'sec',
        value: '18',
        recorded_at: daysAgoIso(0),
        protocol: TT('ten_meter_walk', 'free', '10 米步行·自由记录'),
        side: null,
      },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].f.changeDirection).toBeUndefined();
    expect(chunks[0].f.series).toBe('10sec(30天前)、18sec(0天前)');
  });

  it('splits 条件不完整 from 按方案完成 rather than averaging them in', async () => {
    const chunks = await seriesOf([
      {
        metric_key: 'timed_up_and_go',
        unit: 'sec',
        value: '11',
        recorded_at: daysAgoIso(30),
        protocol: TT('timed_up_and_go', 'per_protocol', 'x'),
        side: null,
      },
      {
        metric_key: 'timed_up_and_go',
        unit: 'sec',
        value: '12',
        recorded_at: daysAgoIso(15),
        protocol: TT('timed_up_and_go', 'per_protocol', 'x'),
        side: null,
      },
      {
        metric_key: 'timed_up_and_go',
        unit: 'sec',
        value: '30',
        recorded_at: daysAgoIso(0),
        protocol: TT('timed_up_and_go', 'partial', 'x'),
        side: null,
      },
    ]);
    const perProtocol = chunks.find(
      (c) => c.f.metricLabel === '起立行走计时·起立行走计时（TUG，3 米）',
    )!;
    expect(perProtocol.f.count).toBe(2);
    expect(perProtocol.f.changeDirection).toBe('flat');
    const partial = chunks.find((c) => String(c.f.metricLabel).includes('条件不完整'))!;
    expect(partial.f.changeDirection).toBeUndefined();
    expect(String(partial.f.latestBand)).toContain('条件不完整');
  });

  it('keeps left and right grip apart, the way the muscle branch keeps sides apart', async () => {
    // 28kg → 20kg → 27kg came out 「基本持平」 over a left hand, a right
    // hand and a left hand. FSHD is defined by asymmetric involvement.
    const grip = TT('grip_strength', 'per_protocol', '握力（选做）·按方案完成');
    const chunks = await seriesOf([
      {
        metric_key: 'custom',
        unit: 'kg',
        value: '28',
        recorded_at: daysAgoIso(40),
        protocol: grip,
        side: 'left',
      },
      {
        metric_key: 'custom',
        unit: 'kg',
        value: '20',
        recorded_at: daysAgoIso(20),
        protocol: grip,
        side: 'right',
      },
      {
        metric_key: 'custom',
        unit: 'kg',
        value: '27',
        recorded_at: daysAgoIso(5),
        protocol: grip,
        side: 'left',
      },
    ]);
    expect(chunks).toHaveLength(2);
    const left = chunks.find((c) => String(c.f.metricLabel).includes('（左）'))!;
    expect(left.f.series).toBe('28kg(40天前)、27kg(5天前)');
    const right = chunks.find((c) => String(c.f.metricLabel).includes('（右）'))!;
    expect(right.f.series).toBe('20kg(20天前)');
  });

  it('asserts no direction over 四项抗重力, whose items it cannot tell apart', async () => {
    // Four movements share one testType, one protocol string and one
    // unit; the discriminator is a line in `notes`, which this file
    // never reads. 2 then 0 is as likely to be two different movements
    // as one that got worse — and 「变化方向: down」 says a patient has
    // lost something.
    const antiGravity = TT('anti_gravity_four', 'per_protocol', '四项抗重力·按方案完成');
    const chunks = await seriesOf([
      {
        metric_key: 'custom',
        unit: 'score',
        value: '2',
        recorded_at: daysAgoIso(30),
        protocol: antiGravity,
        side: null,
      },
      {
        metric_key: 'custom',
        unit: 'score',
        value: '0',
        recorded_at: daysAgoIso(3),
        protocol: antiGravity,
        side: null,
      },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].f.changeDirection).toBeUndefined();
    expect(chunks[0].f.latestValue).toBeUndefined();
    expect(String(chunks[0].f.latestBand)).toContain('多个动作项');
  });

  it('never forwards the protocol string, in any field or citation', async () => {
    const typed = '我家走廊只有 8 米，凑合走的';
    const r = await new PatientFollowupRetriever(
      poolWith(
        [
          {
            metric_key: 'ten_meter_walk',
            unit: 'sec',
            value: '10',
            recorded_at: daysAgoIso(30),
            protocol: typed,
            side: null,
          },
          {
            metric_key: 'ten_meter_walk',
            unit: 'sec',
            value: '11',
            recorded_at: daysAgoIso(2),
            protocol: null,
            side: null,
          },
        ],
        [],
        [],
      ),
    ).search({ question: '' }, ctx());

    // Two curves: a row carrying an unrecognised protocol is not the
    // same measurement as a row carrying none.
    expect(r.chunks).toHaveLength(2);
    // `sourceFile` rides the citation channel, which bypasses the
    // redactor entirely — so it gets an ordinal, never the string.
    expect(JSON.stringify(r.chunks)).not.toContain(typed);
    expect(JSON.stringify(r.citations)).not.toContain(typed);
    const unnamed = r.chunks.find((c) => (c.sourceFile ?? '').includes('@other'))!;
    expect((unnamed.metadata.fields as Record<string, unknown>).changeDirection).toBeUndefined();
  });

  it('hangs each 做不到 tally on the curve it came from, once', async () => {
    // Grouped on `test_type` alone, one tally of six was stamped onto
    // every stair curve: 「另有 6 次记录为「做不到」」 twice, in two
    // chunks, in one prompt, off six rows.
    const chunks = await seriesOf(
      [
        {
          metric_key: 'stair_climb',
          unit: 'sec',
          value: '12',
          recorded_at: daysAgoIso(30),
          protocol: DAILY_STAIR,
          side: null,
        },
        {
          metric_key: 'stair_climb',
          unit: 'sec',
          value: '18',
          recorded_at: daysAgoIso(2),
          protocol: DAILY_STAIR,
          side: null,
        },
        {
          metric_key: 'stair_climb',
          unit: 'sec',
          value: '9',
          recorded_at: daysAgoIso(20),
          protocol: TT('stair_four_step', 'per_protocol', 'x'),
          side: null,
        },
      ],
      [
        {
          metric_key: 'stair_climb',
          protocol: DAILY_STAIR,
          side: null,
          unable_count: 6,
          most_recent_days: 2,
        },
      ],
    );
    expect(chunks).toHaveLength(2);
    const withUnable = chunks.filter((c) => c.f.unableSummary !== undefined);
    expect(withUnable).toHaveLength(1);
    expect(withUnable[0].f.metricLabel).toBe('上楼计时·连续上 10 级台阶');
    expect(String(withUnable[0].f.unableSummary)).toContain('6 次');
  });

  it('gives a 做不到-only curve its own chunk under its own name', async () => {
    const chunks = await seriesOf(
      [
        {
          metric_key: 'stair_climb',
          unit: 'sec',
          value: '12',
          recorded_at: daysAgoIso(30),
          protocol: DAILY_STAIR,
          side: null,
        },
        {
          metric_key: 'stair_climb',
          unit: 'sec',
          value: '13',
          recorded_at: daysAgoIso(2),
          protocol: DAILY_STAIR,
          side: null,
        },
      ],
      [
        {
          metric_key: 'stair_climb',
          protocol: TT('stair_four_step', 'per_protocol', 'x'),
          side: null,
          unable_count: 3,
          most_recent_days: 4,
        },
      ],
    );
    // A patient who still manages the ten steps but has stopped being
    // able to do the four-step test gets both facts, not one of them
    // deciding for the other.
    expect(chunks).toHaveLength(2);
    const unableOnly = chunks.find((c) => c.f.count === 0)!;
    expect(unableOnly.f.metricLabel).toBe('上楼计时·四级台阶上下');
    expect(unableOnly.f.latestBand).toBe('本期均记录为做不到');
    const measured = chunks.find((c) => c.f.count === 2)!;
    expect(measured.f.unableSummary).toBeUndefined();
  });

  it('keeps `metricKey` as the filter surface the tool documents', async () => {
    // The ask-context drawer sends `metricKey: "stair_climb"` when the
    // patient taps the 上楼计时 card. Splitting the key would have made
    // that filter return nothing; splitting the LABEL is what tells the
    // curves apart.
    const chunks = await seriesOf(MIXED_STAIR_ROWS, [], { metricKey: 'stair_climb' });
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.f.metricKey).toBe('stair_climb');
    expect(new Set(chunks.map((c) => c.f.metricLabel)).size).toBe(3);
    // Distinct citations, so two curves cannot collapse into one source.
    expect(new Set(chunks.map((c) => c.sourceFile)).size).toBe(3);
  });

  it('caps rows per curve, not per test_type', async () => {
    const pool = poolWith([]);
    await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const [seriesSql, , unableSql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    // Otherwise 200 daily stair records starve the four-step curve of
    // every row it has.
    expect(seriesSql).toContain(
      "PARTITION BY metric_key, COALESCE(protocol, ''), COALESCE(side, '')",
    );
    expect(unableSql).toContain('GROUP BY ft.test_type, ft.protocol, ft.side');
  });

  it('leaves symptom scores and muscle measurements exactly as they were', async () => {
    // They carry no protocol, and the muscle branch already folds side
    // into `metric_key` — so nothing here may append a second（左）.
    const chunks = await seriesOf([
      {
        metric_key: 'muscle_deltoid_left',
        unit: 'MRC',
        value: 4,
        recorded_at: daysAgoIso(30),
        protocol: null,
        side: null,
      },
      {
        metric_key: 'muscle_deltoid_left',
        unit: 'MRC',
        value: 3,
        recorded_at: daysAgoIso(0),
        protocol: null,
        side: null,
      },
      {
        metric_key: 'fatigue',
        unit: null,
        value: 3,
        recorded_at: daysAgoIso(30),
        protocol: null,
        side: null,
      },
      {
        metric_key: 'fatigue',
        unit: null,
        value: 7,
        recorded_at: daysAgoIso(0),
        protocol: null,
        side: null,
      },
    ]);
    const muscle = chunks.find((c) => c.f.metricKey === 'muscle_deltoid_left')!;
    expect(muscle.f.metricLabel).toBe('肌力·三角肌（左）');
    expect(muscle.sourceFile).toBe('patient_followups/muscle_deltoid_left');
    expect(muscle.f.changeDirection).toBe('down');
    const fatigue = chunks.find((c) => c.f.metricKey === 'fatigue')!;
    expect(fatigue.f.metricLabel).toBe('疲劳');
    expect(fatigue.sourceFile).toBe('patient_followups/fatigue');
    expect(fatigue.f.changeDirection).toBe('up');
  });
});
