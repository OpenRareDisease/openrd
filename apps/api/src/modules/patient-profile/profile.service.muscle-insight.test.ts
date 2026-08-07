import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PatientProfileService } from './profile.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    expect(cohort?.sql).toContain('profile_id <> $2');
    expect(cohort?.params).toEqual(['deltoid', 'profile-1']);

    // 只把 COUNT(*) 换成 COUNT(DISTINCT profile_id) 是不够的，而且那一版
    // 上线过：人数按人算，中位数却还按行算，于是「N 人」和它旁边的中位数
    // 讲的不是同一群东西。每一个统计量都必须落在「每人一行」这张表上。
    expect(cohort?.sql).toContain('DISTINCT ON (profile_id)');
    expect(cohort?.sql).toMatch(/ORDER BY profile_id, recorded_at DESC/);
    expect(cohort?.sql).toMatch(/percentile_cont[\s\S]*FROM per_patient/);
    expect(cohort?.sql).toMatch(/MIN\(strength_score\)[\s\S]*FROM per_patient/);
    // per_patient 已经是每人一行，COUNT(*) 就是分母本身。
    expect(cohort?.sql).toContain('COUNT(*) AS sample_count');
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

/**
 * The assertions above are on the SQL text, which is all a mocked pool can
 * see — and a text assertion cannot tell 「群体中位」 apart from a number
 * that merely looks like one. So take the string the service actually
 * builds and run it on Postgres against the skew the defect is about.
 *
 * Shadowing patient_measurements with a TEMP table of the same name is
 * what lets the production SQL run verbatim: pg_temp precedes public on
 * the search path, so the query hits the fixture and never the real table.
 * Everything is inside a transaction that rolls back regardless.
 *
 * Skipped without DATABASE_URL — `vitest run` sets no env file, so this is
 * opt-in for a machine with a database and never a red CI on a machine
 * without one. Run it with:
 *   set -a; . ./.env; set +a
 *   npm run test --workspace @openrd/api -- profile.service.muscle-insight
 */
const CONNECTION_STRING = process.env.DATABASE_URL;
const describeWithPostgres = CONNECTION_STRING ? describe : describe.skip;

/** The cohort SQL exactly as getMuscleInsight issues it. */
const cohortSqlFromService = async () => {
  const { pool, calls } = makePool();
  await serviceFor(pool).getMuscleInsight('user-1', 'deltoid');
  const cohort = calls.find((call) => call.sql.includes('percentile_cont'));
  if (!cohort) throw new Error('no cohort query was issued');
  return cohort.sql;
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describeWithPostgres('群体中位数必须是「每人一个数」的中位数（真库）', () => {
  it('一个每天自测的人不能替十一个人决定中位数', async () => {
    const sql = await cohortSqlFromService();
    const client = new Client({ connectionString: CONNECTION_STRING });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TEMP TABLE patient_measurements (
          id             UUID PRIMARY KEY,
          profile_id     UUID NOT NULL,
          recorded_at    TIMESTAMPTZ NOT NULL,
          muscle_group   TEXT NOT NULL,
          strength_score SMALLINT NOT NULL
        ) ON COMMIT DROP
      `);

      // Eleven people who tested deltoid once and scored 5.
      for (let person = 1; person <= 11; person += 1) {
        await client.query(
          `INSERT INTO patient_measurements VALUES ($1, $2, '2026-01-01', 'deltoid', 5)`,
          [uuid(person), uuid(person)],
        );
      }
      // A twelfth who tests every day and scores 1 — 200 rows, one person.
      for (let day = 0; day < 200; day += 1) {
        await client.query(
          `INSERT INTO patient_measurements
           VALUES ($1, $2, TIMESTAMPTZ '2026-01-01' + ($3 || ' days')::interval, 'deltoid', 1)`,
          [uuid(1000 + day), uuid(12), day],
        );
      }
      // The viewer's own rows, which must not reach their own cohort.
      await client.query(
        `INSERT INTO patient_measurements VALUES ($1, $2, '2026-02-01', 'deltoid', 0)`,
        [uuid(2001), uuid(99)],
      );
      // Another muscle group, to prove the filter is doing something.
      await client.query(
        `INSERT INTO patient_measurements VALUES ($1, $2, '2026-02-01', 'biceps', 0)`,
        [uuid(2002), uuid(50)],
      );

      const { rows } = await client.query(sql, ['deltoid', uuid(99)]);

      // Twelve people, eleven of whom score 5. Aggregating the 211 raw
      // rows instead answers 1 — 「群体中位 1 分 · 12 人」 to a patient
      // scoring 3, who is then told they are above a group that is
      // almost entirely above them.
      expect(Number(rows[0].sample_count)).toBe(12);
      expect(Number(rows[0].median_score)).toBe(5);
      expect(Number(rows[0].quartile_25)).toBe(5);
      expect(Number(rows[0].quartile_75)).toBe(5);
      // MIN/MAX describe the same twelve people, not the 211 rows.
      expect(Number(rows[0].min_score)).toBe(1);
      // 0 would mean the viewer's own row leaked into their own cohort.
      expect(Number(rows[0].max_score)).toBe(5);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  it('每人取的是最新那次，和界面上「你 X 分」同一个统计量', async () => {
    const sql = await cohortSqlFromService();
    const client = new Client({ connectionString: CONNECTION_STRING });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TEMP TABLE patient_measurements (
          id             UUID PRIMARY KEY,
          profile_id     UUID NOT NULL,
          recorded_at    TIMESTAMPTZ NOT NULL,
          muscle_group   TEXT NOT NULL,
          strength_score SMALLINT NOT NULL
        ) ON COMMIT DROP
      `);

      // Ten people who each started at 5 and have since declined to 2.
      // The cohort has to read 2 — a patient watching their own number
      // fall is comparing against where other people are now, not
      // against where they were when they joined.
      for (let person = 1; person <= 10; person += 1) {
        await client.query(
          `INSERT INTO patient_measurements VALUES ($1, $2, '2024-01-01', 'deltoid', 5)`,
          [uuid(person), uuid(person)],
        );
        await client.query(
          `INSERT INTO patient_measurements VALUES ($1, $2, '2026-01-01', 'deltoid', 2)`,
          [uuid(100 + person), uuid(person)],
        );
      }

      const { rows } = await client.query(sql, ['deltoid', uuid(99)]);
      expect(Number(rows[0].sample_count)).toBe(10);
      expect(Number(rows[0].median_score)).toBe(2);
      expect(Number(rows[0].max_score)).toBe(2);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});

/**
 * Migration 018 shipped (muscle_group, strength_score) and recorded that
 * the cohort query planned as an Index Only Scan. Then the query grew a
 * `profile_id <> $2` predicate and a per-patient collapse, and the index
 * carried neither profile_id nor recorded_at — so the plan quietly became
 * a heap scan plus a full sort on a query that runs four times per 我的
 * 档案 open and whose cost grows with the user base, not with one
 * patient's history. Nothing failed; it just got slower as more patients
 * joined, which is the failure mode 018 was written to prevent.
 *
 * So pin the plan, not the file. The DDL is read out of 025 rather than
 * repeated here: an edit to the migration that stops covering the query
 * has to show up as a red test, and a copy in the test would just agree
 * with itself.
 */
describeWithPostgres('队列查询的索引必须还能覆盖它（真库 EXPLAIN）', () => {
  const cohortIndexDdl = () => {
    const file = path.resolve(
      __dirname,
      '../../../../../db/migrations/025_measurement_cohort_index_per_patient.sql',
    );
    const match = /^CREATE INDEX[\s\S]*?;/m.exec(fs.readFileSync(file, 'utf8'));
    if (!match) throw new Error(`no CREATE INDEX found in ${file}`);
    return match[0];
  };

  /**
   * `search_path = pg_temp` is load-bearing, not tidiness: every DDL here
   * names `patient_measurements` and `idx_patient_measurements_cohort`,
   * and with public on the path a CREATE INDEX would resolve to the real
   * table and take a lock on it.
   */
  const planFor = async (indexDdl: string) => {
    const sql = await cohortSqlFromService();
    const client = new Client({ connectionString: CONNECTION_STRING });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path = pg_temp');
      await client.query(`
        CREATE TEMP TABLE patient_measurements (
          id             UUID PRIMARY KEY,
          profile_id     UUID NOT NULL,
          recorded_at    TIMESTAMPTZ NOT NULL,
          muscle_group   TEXT NOT NULL,
          strength_score SMALLINT NOT NULL
        ) ON COMMIT DROP
      `);
      await client.query(`
        INSERT INTO patient_measurements
        SELECT gen_random_uuid(),
               ('00000000-0000-4000-8000-' || lpad(p::text, 12, '0'))::uuid,
               TIMESTAMPTZ '2026-01-01' + (r || ' days')::interval,
               (ARRAY['deltoid','biceps','tibialis','quadriceps'])[1 + (m % 4)],
               (p + r) % 6
        FROM generate_series(1, 400) p,
             generate_series(0, 3) m,
             generate_series(1, 6) r
      `);
      await client.query(indexDdl);
      await client.query('ANALYZE patient_measurements');
      // 018's own note says the planner is right to prefer a sequential
      // scan at dev scale, and it is right here too — 9,600 rows fits in
      // a handful of pages. Force it off, the way 018 verified its claim.
      await client.query('SET LOCAL enable_seqscan = off');
      await client.query('SET LOCAL enable_bitmapscan = off');
      const explained = await client.query(`EXPLAIN ${sql}`, [
        'deltoid',
        '00000000-0000-4000-8000-000000000001',
      ]);
      return explained.rows.map((row) => String(row['QUERY PLAN'])).join('\n');
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  };

  it('025 的索引让查询走 Index Only Scan，且不需要排序', async () => {
    const plan = await planFor(cohortIndexDdl());
    expect(plan).toContain('Index Only Scan using idx_patient_measurements_cohort');
    // The Sort is the part that scales badly: it is the whole cohort in
    // work_mem, four of them at once, spilling to disk as patients join.
    expect(plan).not.toContain('Sort');
  });

  it('018 的索引已经不够了 —— 记录一下差别，免得有人把它改回去', async () => {
    const plan = await planFor(
      'CREATE INDEX idx_patient_measurements_cohort ON patient_measurements (muscle_group, strength_score)',
    );
    expect(plan).toContain('Sort');
    expect(plan).not.toContain('Index Only Scan using idx_patient_measurements_cohort');
  });
});
