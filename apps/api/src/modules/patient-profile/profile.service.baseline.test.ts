import { describe, expect, it, vi } from 'vitest';

import { PatientProfileService } from './profile.service.js';

/**
 * `getBaselineByUserId` used to call `getProfileByUserId`, which reads
 * eight tables, and then throw away everything but four fields. It now
 * queries directly — so these tests pin the two things that rewrite
 * could break: that it still reads the documents (the genetic report
 * fills a baseline the patient never typed), and that it does not read
 * anything else.
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

const geneticDocument = {
  id: 'doc-1',
  document_type: 'genetic_report',
  status: 'parsed',
  uploaded_at: new Date('2026-03-02T00:00:00Z'),
  ocr_payload: {
    fields: {
      classifiedType: 'genetic_report',
      d4z4Repeats: '6',
      haplotype4q: '4qA',
    },
  },
};

const makePool = (
  profileRows: Record<string, unknown>[],
  documentRows: Record<string, unknown>[] = [geneticDocument],
) => {
  const sqls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    sqls.push(sql);
    if (sql.includes('patient_documents')) {
      return { rowCount: documentRows.length, rows: documentRows };
    }
    return { rowCount: profileRows.length, rows: profileRows };
  });
  return { pool: { query, connect: vi.fn() } as never, sqls };
};

const profileRow = {
  id: 'profile-1',
  full_name: '测试患者',
  preferred_name: '小测',
  diagnosis_date: new Date('2024-01-05T00:00:00Z'),
  genetic_mutation: null,
  baseline_payload: { foundation: { heightCm: 170 } },
  updated_at: new Date('2026-05-05T10:00:00Z'),
};

const serviceFor = (pool: never) =>
  new PatientProfileService({ pool, logger: silentLogger as never });

describe('getBaselineByUserId', () => {
  it('returns null without touching documents when there is no profile', async () => {
    const { pool, sqls } = makePool([]);
    expect(await serviceFor(pool).getBaselineByUserId('user-1')).toBeNull();
    expect(sqls.some((sql) => sql.includes('patient_documents'))).toBe(false);
  });

  it('reads only patient_profiles and patient_documents', async () => {
    const { pool, sqls } = makePool([profileRow]);
    await serviceFor(pool).getBaselineByUserId('user-1');

    const joined = sqls.join('\n');
    for (const table of [
      'patient_measurements',
      'patient_function_tests',
      'patient_symptom_scores',
      'patient_daily_impacts',
      'patient_followup_events',
      'patient_activity_logs',
      'patient_medications',
    ]) {
      expect(joined).not.toContain(table);
    }
  });

  it('still autofills the baseline off the report the picker names', async () => {
    const { pool } = makePool([profileRow]);
    const baseline = await serviceFor(pool).getBaselineByUserId('user-1');

    // The patient never typed these; they come off the OCR fields, and
    // dropping the documents query would silently blank them.
    const background = (baseline?.baseline as Record<string, Record<string, unknown>>)
      ?.diseaseBackground;
    expect(background?.d4z4).toBe('6');
    expect(background?.haplotype).toBe('4qA');
    // Values the patient did type must survive the merge.
    const foundation = (baseline?.baseline as Record<string, Record<string, unknown>>)?.foundation;
    expect(foundation?.heightCm).toBe(170);
  });

  it('carries the profile scalars through', async () => {
    const { pool } = makePool([profileRow]);
    const baseline = await serviceFor(pool).getBaselineByUserId('user-1');
    expect(baseline?.profileId).toBe('profile-1');
    expect(baseline?.fullName).toBe('测试患者');
    expect(baseline?.preferredName).toBe('小测');
    expect(baseline?.updatedAt).toBe('2026-05-05T10:00:00.000Z');
  });

  it('asks the database for a projected payload, not the whole blob', async () => {
    const { pool, sqls } = makePool([profileRow]);
    await serviceFor(pool).getBaselineByUserId('user-1');

    const documentSql = sqls.find((sql) => sql.includes('patient_documents')) ?? '';
    // The projection is what keeps `aiExtraction` — the largest key,
    // read by nothing here — off the wire.
    expect(documentSql).toContain('jsonb_build_object');
    expect(documentSql).toContain("'fields'");
    expect(documentSql).toContain("'extractedText'");
    // NOT 「the word aiExtraction never appears」, which is what stood
    // here and is a stricter promise than the one that matters. The
    // reading guard needs the reference interval the report printed
    // beside each analyte, and that interval lives in `aiExtraction`
    // — so the projection now reaches INTO the blob for two numbers
    // per analyte. What must not happen is the blob being selected as
    // a key and serialised to the phone, and that is what this asserts:
    // no `'aiExtraction'` key on the built object.
    expect(documentSql).not.toMatch(/'aiExtraction'\s*,/);
    expect(documentSql).toContain("'analyteReferences'");
    expect(documentSql).toContain('reference_low');
    expect(documentSql).toContain('reference_high');
  });

  it('selects the columns the picker needs, id and status included', async () => {
    // `pickGeneticEvidenceDocument` will not take a document whose
    // parse has not landed over one that has, and it breaks ties on
    // `id`. A projection that dropped either would have this screen
    // filling from a report the passport does not read — silently, and
    // only for a patient with more than one upload.
    const { pool, sqls } = makePool([profileRow]);
    await serviceFor(pool).getBaselineByUserId('user-1');

    const documentSql = sqls.find((sql) => sql.includes('patient_documents')) ?? '';
    expect(documentSql).toContain('status');
    expect(documentSql).toMatch(/SELECT id,/);
  });
});

/**
 * The four columns `upsertBaseline` mirrors out of `foundation`.
 *
 * These pin the UPDATE's PARAMETERS, not its effect — there is no
 * database in this suite, so what is asserted is that a present-and-
 * null key is sent as an erase and an absent key is sent as「this write
 * says nothing about the column」. The two used to be indistinguishable
 * (COALESCE), which made the back office's 「会被清空」 confirmation
 * false for `full_name` / `preferred_name` / `diagnosis_date` /
 * `region_city`: only `baseline_payload` was actually cleared.
 */
describe('upsertBaseline mirrors the foundation fields', () => {
  const captureWrite = async (foundation: Record<string, unknown>) => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('patient_documents')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [profileRow] };
    });
    const service = serviceFor({ query, connect: vi.fn() } as never);
    await service.upsertBaseline('user-1', { foundation } as never);
    const update = calls.find((call) => call.sql.includes('UPDATE patient_profiles'));
    if (!update) throw new Error('no UPDATE was issued');
    return update;
  };

  it('sends an explicit null as an erase', async () => {
    const { sql, params } = await captureWrite({
      fullName: null,
      preferredName: null,
      diagnosisYear: null,
      regionLabel: null,
    });
    // [payload, setsFullName, fullName, setsPreferredName, preferredName,
    //  setsDiagnosisYear, diagnosisYear, setsRegionLabel, regionLabel, id]
    expect(params[1]).toBe(true);
    expect(params[2]).toBeNull();
    expect(params[3]).toBe(true);
    expect(params[4]).toBeNull();
    expect(params[5]).toBe(true);
    expect(params[6]).toBeNull();
    expect(params[7]).toBe(true);
    // NULLIF turns the empty string into NULL inside the statement.
    expect(params[8]).toBe('');
    expect(sql).not.toContain('COALESCE');
  });

  it('leaves a column alone when the write does not mention it', async () => {
    const { params } = await captureWrite({ fullName: '张三' });
    expect(params[1]).toBe(true);
    expect(params[2]).toBe('张三');
    expect(params[3]).toBe(false);
    expect(params[5]).toBe(false);
    expect(params[7]).toBe(false);
  });

  /**
   * 确诊年份 REFINES `diagnosis_date`; IT DOES NOT REPLACE IT.
   *
   * The mirror wrote `${year}-01-01` into the column on every save, so a
   * profile holding a real 2019-05-03 came out of the next questionnaire
   * submit holding 2019-01-01 — even when the year saved was 2019, which
   * is what `applyGeneticReportAutofill` puts back in the box at read
   * time, i.e. even when the save said nothing new about the diagnosis
   * time at all. The day is not recoverable and the exports read the
   * column.
   *
   * There is no database in this suite, so the shape of the decision is
   * what is pinned here — that the statement asks the column what year
   * it is already in before overwriting it, and that the parameter
   * positions the tests above depend on are unchanged. The four
   * behaviours themselves are exercised against a real Postgres.
   */
  it('keeps a stored day when the saved year is the year that day is in', async () => {
    const { sql, params } = await captureWrite({ diagnosisYear: 2019 });

    // The column is consulted, not merely overwritten.
    expect(sql).toContain("date_part('year', diagnosis_date)");
    expect(sql).toContain("date_part('year', $7::date)");
    // And on a match the column keeps what it has.
    expect(sql).toMatch(/date_part\('year', \$7::date\)\s*\n?\s*THEN diagnosis_date/);
    // Same slots as before, so the erase / silence flags still land.
    expect(params[5]).toBe(true);
    expect(params[6]).toBe('2019-01-01');
  });

  it('still carries an explicit clear and an absent key through the new branch', async () => {
    const cleared = await captureWrite({ diagnosisYear: null });
    expect(cleared.params[5]).toBe(true);
    expect(cleared.params[6]).toBeNull();
    expect(cleared.sql).toContain('WHEN $7::date IS NULL THEN NULL');

    const untouched = await captureWrite({ fullName: '李四' });
    expect(untouched.params[5]).toBe(false);
    expect(untouched.sql).toContain('WHEN NOT $6::boolean THEN diagnosis_date');
  });
});
