import { describe, expect, it, vi } from 'vitest';

import { PatientProfileService } from './profile.service.js';

/**
 * THE RISK CHIP, AND WHAT IT SAYS ABOUT A PATIENT IT HAS NEVER SEEN.
 *
 * `getRiskSummary` grades two axes and shows the worse of them as one
 * coloured chip. Both axes used to grade an EMPTY record: a profile with
 * no activity log at all was scored `high` — the red 高关注 band, the
 * same one a fortnight-stale log earns — and one with no measurements
 * was scored `medium`. So an account that registered five minutes ago
 * and has typed nothing opened to the strongest warning the product can
 * show, indistinguishable from a patient it is genuinely worried about.
 *
 * Every fixture below is invented.
 */

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
};

/**
 * `patient_activity_logs.log_date` is a `date` column, and node-postgres
 * decodes those as LOCAL midnight — `new Date(y, m - 1, d)` — not as a
 * UTC instant. The fixtures build them the same way, because the day
 * that comes back east of Greenwich is exactly what these tests are
 * about.
 */
const localMidnight = (year: number, month: number, day: number) => new Date(year, month - 1, day);

const daysAgo = (days: number) => {
  const now = new Date();
  return localMidnight(now.getFullYear(), now.getMonth() + 1, now.getDate() - days);
};

const makeService = (options: { measurements?: unknown[]; activity?: unknown[] } = {}) => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('patient_measurements')) {
      const rows = options.measurements ?? [];
      return { rowCount: rows.length, rows };
    }
    if (sql.includes('patient_activity_logs')) {
      const rows = options.activity ?? [];
      return { rowCount: rows.length, rows };
    }
    // ensureProfileForUser
    return { rowCount: 1, rows: [{ id: 'profile-1' }] };
  });
  return new PatientProfileService({
    pool: { query, connect: vi.fn() } as never,
    logger: silentLogger as never,
  });
};

const measurement = (score: number) => ({
  id: `m-${score}`,
  muscle_group: 'deltoid',
  strength_score: score,
  recorded_at: new Date('2026-08-01T02:00:00Z'),
});

describe('getRiskSummary reads an empty record as unknown, not as bad', () => {
  it('grades a brand-new profile unknown on both axes and overall', async () => {
    const summary = await makeService().getRiskSummary('user-new');

    expect(summary.strengthLevel).toBe('unknown');
    expect(summary.activityLevel).toBe('unknown');
    expect(summary.overallLevel).toBe('unknown');
    expect(summary.lastActivityAt).toBeNull();
    expect(summary.latestMeasurement).toBeUndefined();
  });

  it('says the platform has no record rather than that the record is recent and empty', async () => {
    const summary = await makeService().getRiskSummary('user-new');

    // 「暂无」/「近期没有」 read as a verdict on a recent stretch of
    // time. Nothing has been looked at; there is no file.
    expect(summary.notes).toEqual(['本平台还没有你的肌力评估记录', '本平台还没有你的活动记录']);
  });

  it('does not soften a real signal on the axis that does have a reading', async () => {
    // Weak measurements and no activity log at all. The measurements are
    // an observation and must still surface; only the empty axis abstains.
    const summary = await makeService({
      measurements: [measurement(2), measurement(2)],
    }).getRiskSummary('user-weak');

    expect(summary.strengthLevel).toBe('high');
    expect(summary.activityLevel).toBe('unknown');
    expect(summary.overallLevel).toBe('high');
  });

  it('still surfaces a stale log when there are no measurements to weigh it against', async () => {
    const summary = await makeService({
      activity: [{ log_date: daysAgo(30) }],
    }).getRiskSummary('user-stale');

    expect(summary.strengthLevel).toBe('unknown');
    expect(summary.activityLevel).toBe('high');
    expect(summary.overallLevel).toBe('high');
  });

  it('separates a brand-new profile from a genuinely concerning one', async () => {
    const brandNew = await makeService().getRiskSummary('user-new');
    const concerning = await makeService({
      measurements: [measurement(2), measurement(2)],
      activity: [{ log_date: daysAgo(30) }],
    }).getRiskSummary('user-concerning');

    expect(brandNew.overallLevel).toBe('unknown');
    expect(concerning.overallLevel).toBe('high');
    // The defect was that these two were the same string.
    expect(brandNew.overallLevel).not.toBe(concerning.overallLevel);
  });

  it('keeps the three graded bands for a record that has readings', async () => {
    const fresh = await makeService({
      measurements: [measurement(5), measurement(4)],
      activity: [{ log_date: daysAgo(1) }],
    }).getRiskSummary('user-fresh');
    expect(fresh.strengthLevel).toBe('low');
    expect(fresh.activityLevel).toBe('low');
    expect(fresh.overallLevel).toBe('low');

    const middling = await makeService({
      measurements: [measurement(4), measurement(3)],
      activity: [{ log_date: daysAgo(10) }],
    }).getRiskSummary('user-middling');
    expect(middling.strengthLevel).toBe('medium');
    expect(middling.activityLevel).toBe('medium');
    expect(middling.overallLevel).toBe('medium');
  });
});

/**
 * The day a `date` column holds, read back as that day.
 *
 * `toISOString` on a local-midnight Date crosses back over the date line
 * east of Greenwich, so under the zone this product runs in every one of
 * these values used to come out one day early — and carrying a
 * 16:00:00.000Z the column has never held.
 */
describe('getRiskSummary reports the activity day as stored', () => {
  /**
   * The assertion holds in EVERY zone, which is the point: the fixture
   * is built from local Y/M/D exactly as node-postgres builds it, and
   * the reader takes local Y/M/D back out, so no zone can move the day.
   * The old `toISOString` path could not satisfy it anywhere — it
   * returned a timestamp — and east of Greenwich it also returned the
   * previous day.
   */
  it('prints and returns the log_date, not the UTC instant beneath it', async () => {
    const summary = await makeService({
      activity: [{ log_date: localMidnight(2026, 8, 19) }],
    }).getRiskSummary('user-day');

    expect(summary.lastActivityAt).toBe('2026-08-19');
    expect(summary.notes).toContain('最近活动记录：2026-08-19');
    expect(summary.lastActivityAt).not.toContain('T');
  });
});

/**
 * `addActivityLog` echoes the row it just wrote, and the two list paths
 * read the same column. All three used to answer
 * `row.log_date.toISOString()`.
 */
describe('activity log dates round-trip as days', () => {
  it('returns the day the patient posted', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO patient_activity_logs')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'log-1',
              submission_id: null,
              log_date: localMidnight(2026, 8, 19),
              source: 'self_report',
              content: '合成活动记录',
              mood_score: null,
              created_at: new Date('2026-08-19T01:00:00Z'),
            },
          ],
        };
      }
      return { rowCount: 1, rows: [{ id: 'profile-1' }] };
    });
    const service = new PatientProfileService({
      pool: { query, connect: vi.fn() } as never,
      logger: silentLogger as never,
    });

    const created = await service.addActivityLog('user-1', {
      logDate: '2026-08-19',
      source: 'self_report',
      content: '合成活动记录',
    } as never);

    expect(created.logDate).toBe('2026-08-19');
  });
});
