import { describe, expect, it, vi } from 'vitest';

import { PatientProfileService } from './profile.service.js';

/**
 * The trend query used to read a patient's whole history for one muscle
 * group and `.slice(-limit)` the surplus away in memory — so its cost
 * grew with how long someone had been using the app, for a chart that
 * only ever draws `limit` points. It now bounds in SQL and reverses.
 *
 * Reversing is the part worth pinning: the rows arrive newest-first and
 * the chart plots oldest-left, so an off-by-one in that flip would draw
 * every patient's decline backwards as improvement.
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

/** Six measurements, newest first, as `ORDER BY recorded_at DESC` hands
 *  them back. Scores descend with time so direction is unambiguous. */
const newestFirst = [
  { recorded_at: new Date('2026-06-01T00:00:00Z'), strength_score: '1' },
  { recorded_at: new Date('2026-05-01T00:00:00Z'), strength_score: '2' },
  { recorded_at: new Date('2026-04-01T00:00:00Z'), strength_score: '3' },
  { recorded_at: new Date('2026-03-01T00:00:00Z'), strength_score: '4' },
  { recorded_at: new Date('2026-02-01T00:00:00Z'), strength_score: '5' },
  { recorded_at: new Date('2026-01-01T00:00:00Z'), strength_score: '5' },
];

const makePool = (over: { sampleCount?: string } = {}) => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT id FROM patient_profiles')) {
      return { rowCount: 1, rows: [{ id: 'profile-1' }] };
    }
    if (sql.includes('percentile_cont')) {
      return {
        rowCount: 1,
        rows: [
          {
            min_score: '1',
            max_score: '5',
            median_score: '3',
            quartile_25: '2',
            quartile_75: '4',
            sample_count: over.sampleCount ?? '40',
          },
        ],
      };
    }
    if (sql.includes('LIMIT 1')) {
      return { rowCount: 1, rows: [{ strength_score: '1' }] };
    }
    // The trend query. Honour the LIMIT the service passes, the way
    // Postgres would — a mock that ignores it could not catch the bug
    // this test exists for.
    const limit = Number(params[2]);
    return { rowCount: 1, rows: newestFirst.slice(0, limit) };
  });
  return { pool: { query } as never, calls };
};

const serviceFor = (pool: never) =>
  new PatientProfileService({ pool, logger: silentLogger as never });

describe('getMuscleInsight trend', () => {
  it('bounds the trend in SQL rather than in memory', async () => {
    const { pool, calls } = makePool();
    await serviceFor(pool).getMuscleInsight('user-1', 'deltoid', 3);

    const trendCall = calls.find(
      (call) => call.sql.includes('recorded_at, strength_score') && !call.sql.includes('LIMIT 1'),
    );
    expect(trendCall?.sql).toContain('LIMIT $3');
    expect(trendCall?.params[2]).toBe(3);
  });

  it('returns the newest points, oldest first', async () => {
    const { pool } = makePool();
    const insight = await serviceFor(pool).getMuscleInsight('user-1', 'deltoid', 3);

    expect(insight.trend.map((point) => point.strengthScore)).toEqual([3, 2, 1]);
    expect(insight.trend[0].recordedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(insight.trend[2].recordedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('keeps the cohort distribution unscoped to the patient', async () => {
    const { pool, calls } = makePool();
    const insight = await serviceFor(pool).getMuscleInsight('user-1', 'deltoid');

    // The comparison only means anything if it is against everyone.
    // A profile_id filter creeping in here would quietly turn「和其他
    // 患者比」into a comparison with oneself.
    //
    // This used to assert the SQL never mentions profile_id at all,
    // which was the wrong instrument: it also forbade `profile_id <>`,
    // the one filter the row's own framing requires — 「群体中位 X 分」
    // beside 「你 Y 分」 says the two numbers came from different people.
    // Assert what the test is actually for: no scoping TO the patient.
    const cohortCall = calls.find((call) => call.sql.includes('percentile_cont'));
    expect(cohortCall?.sql).not.toMatch(/profile_id\s*=/);
    expect(insight.distribution?.sampleCount).toBe(40);
  });
});

describe('群体对比不得凭空造出一个群体', () => {
  /**
   * 三个缺陷叠在一起，让这个界面对患者说了关于自己病情的假话：
   * 查询不排除自己、COUNT(*) 数的是测量行数而界面写「人」、没有下限。
   * 第一个做肌力自测的患者左右手各测五次 = 10 行 = 界面「10 人」，
   * 而那 10 行全是他自己。
   */
  it('查询排除本人，并按人数而不是行数计', async () => {
    const { pool, calls } = makePool();
    await serviceFor(pool).getMuscleInsight('user-1', 'deltoid');
    const cohort = calls.find((c) => c.sql.includes('percentile_cont'));
    expect(cohort?.sql).toContain('COUNT(DISTINCT profile_id)');
    expect(cohort?.sql).toContain('profile_id <> $2');
    expect(cohort?.params).toEqual(['deltoid', 'profile-1']);
  });

  it('人数不足下限时整块不给，而不是给一个带注脚的数', async () => {
    // 中位数配一句「样本较少」不会阻止那个数被读到，而被读到的是
    //「我比别人差多少」。
    const { pool } = makePool({ sampleCount: '3' });
    const insight = await serviceFor(pool).getMuscleInsight('user-1', 'deltoid');
    expect(insight.distribution).toBeNull();
  });

  it('达到下限才给', async () => {
    const { pool } = makePool({ sampleCount: '10' });
    const insight = await serviceFor(pool).getMuscleInsight('user-1', 'deltoid');
    expect(insight.distribution?.sampleCount).toBe(10);
  });
});
