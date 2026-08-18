import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { FALL_HISTORY_COLUMNS } from './falls.sql.js';
import type { RetrieveContext } from '../../ai-agents/retrievers/base.js';
import { PatientFollowupRetriever } from '../../ai-agents/retrievers/patient-followups.js';

/**
 * The falls half of the followup retriever.
 *
 * Lives here rather than beside the retriever because the behaviour
 * under test is the falls diary's, and because the retriever's own
 * suite is a fixed three-response mock that this lane deliberately did
 * not have to disturb: falls join the EXISTING event query rather than
 * adding a fourth, which is also what guarantees a fall is counted in
 * exactly one place.
 */

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

/** Series, events, unable — the retriever's three queries, in order. */
const poolWith = (eventRows: unknown[]) => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: eventRows, rowCount: eventRows.length })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 });
  return { query } as unknown as Pool;
};

const fallRow = (
  dayAge: number,
  detail: Partial<{
    fall_activity: string | null;
    fall_location: string | null;
    fall_hands_full: boolean | null;
    fall_got_up_unaided: boolean | null;
    fall_injured: boolean | null;
  }> = {},
) => ({
  event_type: 'fall',
  severity: null,
  occurred_at: daysAgoIso(dayAge),
  fall_day_age: dayAge,
  fall_activity: null,
  fall_location: null,
  fall_hands_full: null,
  fall_got_up_unaided: null,
  fall_injured: null,
  ...detail,
});

const eventFields = async (rows: unknown[], filter?: Record<string, unknown>) => {
  const result = await new PatientFollowupRetriever(poolWith(rows)).search(
    { question: '', ...(filter ? { filter } : {}) },
    ctx(),
  );
  const chunk = result.chunks.find((c) => c.sourceFile === 'patient_followups/events');
  expect(chunk).toBeDefined();
  return chunk!.metadata.fields as Record<string, unknown>;
};

describe('the falls query', () => {
  it('reads both tables in one statement so a fall has one count', async () => {
    // Two queries would put two fall counts in one prompt, and the
    // model would pick one. The de-duplication between the diary and
    // its followup-event twin has to happen inside the single query
    // that produces the number.
    const pool = poolWith([]);
    await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const statements = (pool.query as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0] as string,
    );
    expect(statements).toHaveLength(3);

    const events = statements[1];
    expect(events).toContain('FROM patient_falls pf');
    expect(events).toContain('FROM patient_followup_events fe');
    // Non-fall events come from the events table; falls come from the
    // falls branch. Reading falls from both without this exclusion
    // counts every diary entry's twin a second time.
    expect(events).toContain("fe.event_type <> 'fall'");
    // ...and a legacy fall that no diary entry mirrors is still read,
    // or falls logged on the old screen stop being counted the day
    // this ships.
    expect(events).toContain('mirror.origin_event_id = fe.id');
  });

  it('drops a fall whose timeline twin was retracted', async () => {
    // The patient can retract the event through the existing
    // /me/records/followup_event/:id path, which knows nothing about
    // patient_falls. Without this the fall stands in the diary and in
    // the count, in the one place they did not think to look.
    const pool = poolWith([]);
    await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const events = (pool.query as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(events).toContain('oe.deleted_at IS NULL');
    expect(events).toContain('pf.deleted_at IS NULL');
  });

  it('still refuses every free-text column', async () => {
    const pool = poolWith([]);
    await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0])
      .join('\n');
    expect(sql).not.toContain('description');
    expect(sql).not.toContain('notes');
  });

  it('projects the same columns in the same order on every branch', async () => {
    // A UNION whose branches agree in count and disagree in ORDER is a
    // silent data swap: indoor/outdoor arrives in the hands-full
    // column and nothing raises.
    const pool = poolWith([]);
    await new PatientFollowupRetriever(pool).search({ question: '' }, ctx());
    const events = (pool.query as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    const branches = events.split('UNION ALL');
    expect(branches).toHaveLength(3);
    for (const branch of branches) {
      const positions = FALL_HISTORY_COLUMNS.map((column) => branch.indexOf(`AS ${column}`));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });
});

describe('what the model is told about falls', () => {
  it('keeps falls on the event line and adds the detail behind it', async () => {
    const fields = await eventFields([
      fallRow(3, { fall_location: 'outdoor', fall_injured: true, fall_activity: 'stairs' }),
      fallRow(30, { fall_location: 'indoor', fall_injured: false }),
      fallRow(120, { fall_got_up_unaided: false }),
      { event_type: 'new_foot_drop', severity: 'moderate', occurred_at: daysAgoIso(40) },
    ]);

    const summary = String(fields.eventSummary);
    // The tally 跌倒 has always been on is still the first thing said.
    expect(summary.startsWith('跌倒×3，最近 3 天前')).toBe(true);
    expect(summary).toContain('新出现足下垂（中）×1');
    // Denominators, not proportions of the total.
    expect(summary).toContain('已记录地点的 2 次中，室外 1 次、室内 1 次');
    expect(summary).toContain('已记录是否受伤的 2 次中，1 次受伤');
    expect(summary).toContain('已记录能否自行起身的 1 次中，1 次无法自行起身');
    // The default window is 180 days, which is two whole buckets, so
    // both survive — and the clause now names the span it counted
    // over, because that span is the window's and not the record's.
    expect(summary).toContain(
      '跌倒频率（每 90 天一段，由近及远，只统计被完整覆盖的最近 180 天）：2 次、1 次',
    );
    expect(summary).toContain('最早一次跌倒记录在 120 天前');
    expect(fields.eventCount).toBe(4);
  });

  /**
   * THE WINDOW IS THE MODEL'S TO CHOOSE AND THE BUCKET IS FIXED AT 90.
   *
   * `get_my_records` lets the model ask for any window from 1 to 730
   * days; falls.summary.ts buckets in fixed quarters. Whenever the two
   * do not divide, the oldest bucket was only partly fetched, and it
   * used to be printed beside the full ones as though it were one.
   */
  it('will not compare a quarter against one the window only partly reached', async () => {
    const rows = [fallRow(5), fallRow(40), fallRow(95)];

    // 100 days: the 90–179 bucket was observed for 11 of its 90 days.
    // 「2 次、1 次」 read as a doubling; the honest answer is no
    // comparison at all, the same call `atCap` already forces.
    const partial = await eventFields(rows, { windowDays: 100 });
    expect(String(partial.eventSummary)).not.toContain('跌倒频率');
    // The falls themselves are still reported — only the comparison goes.
    expect(String(partial.eventSummary)).toContain('跌倒×3，最近 5 天前');

    // Exactly one bucket fits in 90 days, so there is still nothing to
    // compare against.
    const oneQuarter = await eventFields(rows, { windowDays: 90 });
    expect(String(oneQuarter.eventSummary)).not.toContain('跌倒频率');

    // 180 days is two whole buckets and the comparison is honest.
    const twoQuarters = await eventFields(rows, { windowDays: 180 });
    expect(String(twoQuarters.eventSummary)).toContain(
      '跌倒频率（每 90 天一段，由近及远，只统计被完整覆盖的最近 180 天）：2 次、1 次',
    );
  });

  it('says how many falls sit outside the buckets rather than folding them in', async () => {
    // 200 days reaches the fall at day 190 but does not cover the
    // 180–269 bucket, so that fall belongs to no quarter. Folding it
    // into the last bucket would inflate the comparison quarter;
    // dropping it would contradict the count on the same line.
    const fields = await eventFields([fallRow(5), fallRow(40), fallRow(190)], {
      windowDays: 200,
    });
    const summary = String(fields.eventSummary);
    expect(summary).toContain('跌倒×3，最近 5 天前');
    expect(summary).toContain(
      '跌倒频率（每 90 天一段，由近及远，只统计被完整覆盖的最近 180 天）：2 次、0 次',
    );
    expect(summary).toContain('更早还有 1 次跌倒，落在查询窗口没有完整覆盖的时段里');
  });

  it('says nothing extra when the falls are date-only and recent', async () => {
    // A patient whose whole fall history is inside one quarter has
    // nothing to compare against, and no detail to report. The event
    // line has to look exactly as it did before this feature existed.
    const fields = await eventFields([fallRow(3), fallRow(20)]);
    expect(fields.eventSummary).toBe('跌倒×2，最近 3 天前');
  });

  it('ages a fall by its own day count, not by a midnight timestamp', async () => {
    // `occurred_on` is a DATE. Read as midnight UTC it is up to a day
    // older than it is, which moves falls between quarters and makes
    // 「最近」 off by one for every patient in China.
    const fields = await eventFields([
      { ...fallRow(0), occurred_at: '2000-01-01T00:00:00.000Z', fall_day_age: 0 },
    ]);
    expect(fields.eventSummary).toBe('跌倒×1，最近 0 天前');
  });

  it('suppresses the quarterly comparison when the event query filled up', async () => {
    // The query orders DESC, so a full page means the OLDEST falls were
    // never read — and those are the ones the comparison rests on.
    // Every comparison over a full page reads as「更频繁了」.
    const rows = Array.from({ length: 200 }, (_, index) => fallRow(index));
    const fields = await eventFields(rows);
    expect(String(fields.eventSummary)).not.toContain('跌倒频率');
    expect(fields.eventCount).toBe(200);
  });

  it('keeps falls out of a metric-scoped retrieval', async () => {
    const result = await new PatientFollowupRetriever(
      poolWith([fallRow(3, { fall_injured: true })]),
    ).search({ question: '', filter: { metricKey: 'stair_climb' } }, ctx());
    expect(result.chunks).toHaveLength(0);
  });

  it('emits nothing at all rather than 「0 次」 for a patient with no falls', async () => {
    // No rows is evidence of no records, not of no falls. A zero here
    // is what an answer saying 「你今年没有摔过」 would be built from.
    const result = await new PatientFollowupRetriever(poolWith([])).search({ question: '' }, ctx());
    expect(result.chunks).toHaveLength(0);
    expect(result.metadata.reason).toBe('no_followups_found');
  });
});
