import type { Pool, QueryResult } from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RetrieveContext } from './base.js';
import { PatientProfileRetriever } from './patient-profile.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child() {
    return silentLogger;
  },
};

/** Restored so the day-column suite below cannot leak a timezone into
 *  whatever runs next in the same worker. */
const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const makeCtx = (overrides: Partial<RetrieveContext> = {}): RetrieveContext => ({
  userId: 'user-1',
  consentLevel: 'basic',
  requestId: 'req-1',
  logger: silentLogger as unknown as RetrieveContext['logger'],
  ...overrides,
});

const fakePool = (rows: unknown[]) =>
  ({
    query: vi.fn().mockResolvedValue({
      rows,
      rowCount: rows.length,
    } as unknown as QueryResult),
  }) as unknown as Pool;

const POPULATED_ROW = {
  id: 'profile-1',
  full_name: '张三',
  date_of_birth: '1990-04-15',
  gender: 'female',
  diagnosis_stage: 'confirmed',
  diagnosis_date: '2023-06-01',
  genetic_mutation: 'FSHD1',
  region_province: '北京',
  region_city: '北京',
  region_district: '海淀',
  baseline_payload: {
    foundation: { diagnosisYear: 2023, regionLabel: '北京 / 海淀' },
    diseaseBackground: {
      diagnosisType: 'FSHD1',
      d4z4: '3/22',
      haplotype: '4qA',
      methylation: '12%',
      onsetRegion: '肩胛带',
      familyHistory: '母亲疑似',
    },
    currentStatus: {
      // Post-022 shape. The boolean the old fixture carried is one the
      // CHECK constraint added by that migration no longer allows on
      // disk, which is why a boolean-only guard in the retriever could
      // drop the field for every real profile and stay green here.
      independentlyAmbulatory: 'independent',
      assistiveDevices: ['AFO'],
    },
  },
  notes: null,
};

describe('PatientProfileRetriever', () => {
  it('short-circuits when there is no user in context', async () => {
    const pool = fakePool([]);
    const retriever = new PatientProfileRetriever(pool);
    const result = await retriever.search({ question: 'x' }, makeCtx({ userId: null }));
    expect(result.metadata.reason).toBe('no_user_in_scope');
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('refuses to read when consent level is none', async () => {
    const pool = fakePool([]);
    const retriever = new PatientProfileRetriever(pool);
    const result = await retriever.search({ question: 'x' }, makeCtx({ consentLevel: 'none' }));
    expect(result.metadata.reason).toBe('consent_not_granted');
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('returns empty when the user has no profile yet', async () => {
    const pool = fakePool([]);
    const retriever = new PatientProfileRetriever(pool);
    const result = await retriever.search({ question: 'x' }, makeCtx());
    expect(result.metadata.reason).toBe('profile_not_found');
  });

  it('returns a single chunk with placeholder content and raw structured fields', async () => {
    const pool = fakePool([POPULATED_ROW]);
    const retriever = new PatientProfileRetriever(pool);
    const result = await retriever.search({ question: 'tell me about me' }, makeCtx());

    expect(result.chunks).toHaveLength(1);
    const chunk = result.chunks[0];

    // content + snippet must NOT contain raw patient data.
    expect(chunk.content).toMatch(/^【患者基础档案/);
    expect(chunk.content).not.toContain('张三');
    expect(chunk.content).not.toContain('3/22');
    expect(chunk.content).not.toContain('12%');
    expect(chunk.content).not.toContain('4qA');
    expect(chunk.content).not.toContain('1990');
    expect(chunk.content).not.toContain('2023-06-01');
    expect(chunk.content).not.toContain('海淀');
    expect(result.citations[0].snippet).toBe('你的患者档案');
    expect(result.citations[0].snippet).not.toContain('张三');

    // metadata.fields carries the raw values for the redactor to handle.
    const fields = (chunk.metadata.fields as Record<string, unknown>) ?? {};
    expect(fields.fullName).toBe('张三');
    expect(fields.dateOfBirth).toBe('1990-04-15');
    expect(fields.regionDistrict).toBe('海淀');
    expect(fields.diagnosisDate).toBe('2023-06-01');
    expect(fields.d4z4).toBe('3/22');
    expect(fields.haplotype).toBe('4qA');
    expect(fields.methylation).toBe('12%');
    expect(fields.diagnosisType).toBe('FSHD1');
    expect(fields.onsetRegion).toBe('肩胛带');
    expect(fields.independentlyAmbulatory).toBe('independent');
    expect(fields.assistiveDevices).toEqual(['AFO']);
  });

  // The state the boolean could not express, and the one whose absence
  // costs the most: without it the model answers 「我适合做哪些家庭
  // 训练」 for a wheelchair user with standing exercises.
  it.each(['independent', 'assisted', 'unable'])(
    'forwards ambulation state %s to metadata.fields',
    async (state) => {
      const pool = fakePool([
        {
          ...POPULATED_ROW,
          baseline_payload: {
            ...POPULATED_ROW.baseline_payload,
            currentStatus: { independentlyAmbulatory: state },
          },
        },
      ]);
      const result = await new PatientProfileRetriever(pool).search(
        { question: '我适合做哪些家庭训练' },
        makeCtx(),
      );
      const fields = (result.chunks[0].metadata.fields as Record<string, unknown>) ?? {};
      expect(fields.independentlyAmbulatory).toBe(state);
    },
  );

  it('drops an ambulation value that is not one of the states', async () => {
    const pool = fakePool([
      {
        ...POPULATED_ROW,
        baseline_payload: {
          ...POPULATED_ROW.baseline_payload,
          currentStatus: { independentlyAmbulatory: true },
        },
      },
    ]);
    const result = await new PatientProfileRetriever(pool).search({ question: 'x' }, makeCtx());
    const fields = (result.chunks[0].metadata.fields as Record<string, unknown>) ?? {};
    expect(fields).not.toHaveProperty('independentlyAmbulatory');
  });

  it('still emits a chunk when baseline_payload is missing', async () => {
    const pool = fakePool([
      {
        id: 'profile-2',
        full_name: null,
        date_of_birth: null,
        gender: null,
        diagnosis_stage: null,
        diagnosis_date: null,
        genetic_mutation: null,
        region_province: null,
        region_city: null,
        region_district: null,
        baseline_payload: null,
        notes: null,
      },
    ]);
    const retriever = new PatientProfileRetriever(pool);
    const result = await retriever.search({ question: 'x' }, makeCtx());
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].metadata.hasBaseline).toBe(false);
    expect((result.chunks[0].metadata.fields as Record<string, unknown>) ?? {}).toEqual({});
  });
});

/**
 * WHERE AN ARCHIVED GENETICS CELL CAME FROM.
 *
 * The redactor decides what the assistant may say about
 * `diseaseBackground.d4z4` / `.haplotype`, and it had nothing to decide
 * with: it passed `fromLaboratoryReport: false` as a constant. So the
 * prompt asserted `not_read_off_a_laboratory_report` about every
 * archived genetics cell — including the ones the read-time autofill
 * copied out of a parsed genetics report, whose provenance the passport
 * resolves to 「报告读取」 and whose TREAT-NMD sentence ends 「所以这个值是
 * 基因报告的解析结果」 in the same run.
 */
describe('the genetics cells carry where they came from', () => {
  const sequencedPool = (profileRows: unknown[], documentRows: unknown[]) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: profileRows, rowCount: profileRows.length })
      .mockResolvedValueOnce({ rows: documentRows, rowCount: documentRows.length });
    return { query } as unknown as Pool;
  };

  const geneticsDocument = (fields: Record<string, unknown>, documentType = 'genetic_report') => ({
    id: 'doc-1',
    document_type: documentType,
    status: 'parsed',
    uploaded_at: '2026-01-05T00:00:00Z',
    // The uploader's declaration stamped into the blob beside the
    // parser's classification, which is what every OCR provider writes
    // and what `isLaboratoryGeneticReport` reads for its last question.
    ocr_payload: { fields: { classifiedType: documentType, documentType, ...fields } },
  });

  const flagsFor = async (documentRows: unknown[]) => {
    const result = await new PatientProfileRetriever(
      sequencedPool([POPULATED_ROW], documentRows),
    ).search({ question: '' }, makeCtx());
    const fields = result.chunks[0].metadata.fields as Record<string, unknown>;
    return {
      d4z4: fields.d4z4FromLaboratoryReport,
      haplotype: fields.haplotypeFromLaboratoryReport,
    };
  };

  it('says so when the archived cells match the laboratory report they were read off', async () => {
    expect(await flagsFor([geneticsDocument({ d4z4Repeats: '3/22', haplotype: '4qA' })])).toEqual({
      d4z4: true,
      haplotype: true,
    });
  });

  it('refuses per cell when only one of them matches', async () => {
    // A patient hand-corrected one box, or the report was re-parsed.
    // The cell that no longer matches is not a value this platform
    // read off anything.
    expect(await flagsFor([geneticsDocument({ d4z4Repeats: '5', haplotype: '4qA' })])).toEqual({
      d4z4: false,
      haplotype: true,
    });
  });

  it('refuses both when the evidence document is a transcription', async () => {
    // `pickGeneticEvidenceDocument` takes a 病历摘要 quoting a result
    // when no genetics report read anything out — for display. It is
    // not a measurement, and nothing may be graded off it.
    expect(
      await flagsFor([
        geneticsDocument({ d4z4Repeats: '3/22', haplotype: '4qA' }, 'medical_summary'),
      ]),
    ).toEqual({ d4z4: false, haplotype: false });
  });

  it('refuses both when there is no document at all', async () => {
    expect(await flagsFor([])).toEqual({ d4z4: false, haplotype: false });
  });
});

/**
 * THE READ-TIME PROJECTION, WHICH THIS RETRIEVER DID NOT RUN.
 *
 * `applyGeneticReportAutofill` fills an EMPTY 分型 / D4Z4 重复数 /
 * 单倍型 / 甲基化 box, and an empty 确诊年份 and `diagnosis_date`, out of
 * the report `pickGeneticEvidenceDocument` names. `getProfileByUserId`
 * and `getBaselineByUserId` both apply it, so the passport, the share
 * page, the referral pack, the PDF, the three registry exports and the
 * patient's own questionnaire screen are all built on its output. This
 * retriever read `baseline_payload` straight out of SQL, so for a
 * patient whose genetics came off a report rather than out of the form
 * the passport printed the count with 「报告读取」 beside it while
 * `get_my_profile` returned a profile with no genetics in it at all.
 */
describe('the assistant reads the profile the platform serves', () => {
  const sequencedPool = (profileRows: unknown[], documentRows: unknown[]) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: profileRows, rowCount: profileRows.length })
      .mockResolvedValueOnce({ rows: documentRows, rowCount: documentRows.length });
    return { query } as unknown as Pool;
  };

  /** A profile whose registration form was never filled in. */
  const EMPTY_FORM_ROW = {
    ...POPULATED_ROW,
    id: 'profile-report-derived',
    diagnosis_date: null,
    genetic_mutation: null,
    baseline_payload: { foundation: {}, diseaseBackground: {}, currentStatus: {} },
  };

  const REPORT_FIELDS = {
    diagnosisType: 'FSHD1',
    d4z4Repeats: '4',
    haplotype: '4qA',
    methylationValue: '28%',
    diagnosisDate: '2021-03-08',
    geneticTestMethod: 'Southern blot',
  };

  const document = (
    over: {
      id?: string;
      classifiedType?: string;
      declaredType?: string;
      uploadedAt?: string;
      page?: string;
      fields?: Record<string, unknown>;
    } = {},
  ) => ({
    id: over.id ?? 'doc-lab',
    document_type: over.classifiedType ?? 'genetic_report',
    status: 'parsed',
    uploaded_at: new Date(over.uploadedAt ?? '2026-02-01T09:00:00.000Z'),
    ocr_payload: {
      fields: {
        classifiedType: over.classifiedType ?? 'genetic_report',
        documentType: over.declaredType ?? over.classifiedType ?? 'genetic_report',
        ...(over.fields ?? REPORT_FIELDS),
      },
      extractedText:
        over.page ?? '基因检测报告\n检测机构：合成实验室\n检测方法：Southern blot\n检测结论：见上',
    },
  });

  const TRANSCRIPTION_PAGE = '门诊病历摘要\n主诉：双肩无力\n现病史：进行性加重';

  const fieldsFor = async (row: unknown, documentRows: unknown[]) => {
    const result = await new PatientProfileRetriever(sequencedPool([row], documentRows)).search(
      { question: '我的基因结果是什么' },
      makeCtx(),
    );
    return (result.chunks[0].metadata.fields as Record<string, unknown>) ?? {};
  };

  it('fills the empty genetics boxes from the report, as every other surface does', async () => {
    const fields = await fieldsFor(EMPTY_FORM_ROW, [document()]);
    expect(fields.diagnosisType).toBe('FSHD1');
    expect(fields.d4z4).toBe('4');
    expect(fields.haplotype).toBe('4qA');
    expect(fields.methylation).toBe('28%');
    // The report's own 诊断日期, and the year the autofill derives from
    // it into `foundation.diagnosisYear`.
    expect(fields.diagnosisDate).toBe('2021-03-08');
    expect(fields.diagnosisYear).toBe(2021);
  });

  /**
   * AND THE CONFIRMATION GUARD IS FED THE RIGHT FACTS BY IT.
   *
   * `geneticCellsFromLaboratoryReport` asks whether an archived cell IS
   * the line read off the laboratory's own report. Asked of an EMPTY
   * cell it answered `false` for every report-derived profile — which
   * is the state the redactor turns into
   * `not_read_off_a_laboratory_report`, on the profile whose passport
   * says 报告读取.
   */
  it('grades those cells as the laboratory reading the passport calls them', async () => {
    const fields = await fieldsFor(EMPTY_FORM_ROW, [document()]);
    expect(fields.diagnosisTypeFromLaboratoryReport).toBe(true);
    expect(fields.d4z4FromLaboratoryReport).toBe(true);
    expect(fields.haplotypeFromLaboratoryReport).toBe(true);
    expect(fields.methylationFromLaboratoryReport).toBe(true);
  });

  /**
   * THE PROJECTION MUST NOT WIDEN WHAT MAY BE GRADED.
   *
   * A 病历摘要 quoting the result is picked for DISPLAY when no genetics
   * report read anything out, and the autofill fills the same empty
   * boxes off it. The value reaches the assistant — for some patients
   * it is the only copy that exists — and every flag stays false, which
   * is 「转录自非基因报告文件」 on the passport and a refusal to grade
   * everywhere else.
   */
  it('shows a transcribed value and grades none of it', async () => {
    const fields = await fieldsFor(EMPTY_FORM_ROW, [
      document({
        id: 'doc-summary',
        classifiedType: 'medical_summary',
        declaredType: 'other',
        page: TRANSCRIPTION_PAGE,
      }),
    ]);
    expect(fields.d4z4).toBe('4');
    expect(fields.haplotype).toBe('4qA');
    expect(fields.diagnosisTypeFromLaboratoryReport).toBe(false);
    expect(fields.d4z4FromLaboratoryReport).toBe(false);
    expect(fields.haplotypeFromLaboratoryReport).toBe(false);
    expect(fields.methylationFromLaboratoryReport).toBe(false);
  });

  it('reads the laboratory report and not the transcription when a profile has both', async () => {
    const fields = await fieldsFor(EMPTY_FORM_ROW, [
      document({
        id: 'doc-summary',
        classifiedType: 'medical_summary',
        declaredType: 'other',
        page: TRANSCRIPTION_PAGE,
        uploadedAt: '2026-03-01T09:00:00.000Z',
        fields: { ...REPORT_FIELDS, d4z4Repeats: '9' },
      }),
      document(),
    ]);
    expect(fields.d4z4).toBe('4');
    expect(fields.d4z4FromLaboratoryReport).toBe(true);
  });

  it('never overwrites a box the patient filled in', async () => {
    const fields = await fieldsFor(POPULATED_ROW, [document()]);
    expect(fields.d4z4).toBe('3/22');
    expect(fields.d4z4FromLaboratoryReport).toBe(false);
    expect(fields.methylation).toBe('12%');
    expect(fields.methylationFromLaboratoryReport).toBe(false);
    // The one box this fixture agrees with the report on keeps its
    // laboratory flag: the archived string IS the report's line.
    expect(fields.haplotype).toBe('4qA');
    expect(fields.haplotypeFromLaboratoryReport).toBe(true);
  });

  it('emits nothing for a profile with no form and no documents', async () => {
    const fields = await fieldsFor({ ...EMPTY_FORM_ROW, baseline_payload: null }, []);
    expect(fields).not.toHaveProperty('d4z4');
    expect(fields).not.toHaveProperty('haplotype');
    expect(fields).not.toHaveProperty('diagnosisYear');
  });
});

/**
 * A `date` COLUMN IS A DAY, AND `toISOString` IS NOT HOW YOU READ ONE.
 *
 * node-postgres decodes `date` (OID 1082) as `new Date(y, m - 1, d)` —
 * midnight in the SERVER PROCESS'S ZONE — and this retriever re-read
 * that instant in UTC. This product runs `TZ=Asia/Shanghai`
 * (apps/api/Dockerfile), where midnight local is the PREVIOUS DAY in
 * UTC. The questionnaire's 确诊年份 is mirrored into
 * `patient_profiles.diagnosis_date` as `${year}-01-01` (`upsertBaseline`)
 * and the redactor reduces the cell to a YEAR, so a year start shifted
 * one day back is the PREVIOUS YEAR: a patient who answered 2023 was
 * told by the assistant they were diagnosed in 2022, in the same
 * request whose passport, PDF and registry exports all said 2023.
 */
describe.each(['Asia/Shanghai', 'America/Los_Angeles'])('day columns in %s', (timeZone) => {
  /**
   * `process.env.TZ` is honoured by Node for every `Date` created after
   * it is assigned, which is what lets one suite render the same column
   * east and west of Greenwich — the defect only appears east, and the
   * western run is what pins that the fix did not trade one shift for
   * another. Restored afterwards so this file cannot leak a timezone
   * into whatever runs next in the same worker. Same harness as
   * profile.passport.dates.test.ts.
   */
  beforeEach(() => {
    process.env.TZ = timeZone;
  });

  /** A `date` column as node-postgres decodes it: midnight in the
   *  server process's own zone. */
  const dayColumn = (year: number, month: number, day: number) => new Date(year, month - 1, day);

  const fieldsFor = async (row: Record<string, unknown>) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await new PatientProfileRetriever({ query } as unknown as Pool).search(
      { question: 'x' },
      makeCtx(),
    );
    return (result.chunks[0].metadata.fields as Record<string, unknown>) ?? {};
  };

  it('keeps the 1 January a questionnaire year is stored as', async () => {
    const fields = await fieldsFor({
      ...POPULATED_ROW,
      diagnosis_date: dayColumn(2023, 1, 1),
      baseline_payload: { foundation: {}, diseaseBackground: {} },
    });
    expect(fields.diagnosisDate).toBe('2023-01-01');
  });

  it('keeps the day of a date of birth', async () => {
    const fields = await fieldsFor({
      ...POPULATED_ROW,
      date_of_birth: dayColumn(1990, 4, 15),
    });
    expect(fields.dateOfBirth).toBe('1990-04-15');
  });

  /**
   * AND `uploaded_at` IS AN INSTANT, NOT A DAY. It was read through the
   * same day formatter, which threw away the time — and the time is
   * what `pickGeneticEvidenceDocument` orders two otherwise-equal
   * candidates by. Truncated, two reports uploaded the same afternoon
   * tie and fall through to the id comparator, so this retriever could
   * pick the other report from the one the passport and the exports
   * read.
   */
  it('picks the later of two same-day reports, as the picker on every other path does', async () => {
    const report = (id: string, at: string, d4z4: string) => ({
      id,
      document_type: 'genetic_report',
      status: 'parsed',
      uploaded_at: new Date(at),
      ocr_payload: {
        fields: {
          classifiedType: 'genetic_report',
          documentType: 'genetic_report',
          d4z4Repeats: d4z4,
          haplotype: '4qA',
          geneticTestMethod: 'Southern blot',
        },
        extractedText: '基因检测报告\n检测方法：Southern blot',
      },
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            ...POPULATED_ROW,
            baseline_payload: { foundation: {}, diseaseBackground: {} },
          },
        ],
        rowCount: 1,
      })
      // The ids are chosen so the two answers differ: the picker's last
      // tie-break is ascending `id`, so a `time` collapsed to a day
      // takes `aa-earlier` and its 9, while the real instants take
      // `zz-later` and its 4.
      .mockResolvedValueOnce({
        rows: [
          report('zz-later', '2026-02-01T18:00:00.000Z', '4'),
          report('aa-earlier', '2026-02-01T09:00:00.000Z', '9'),
        ],
        rowCount: 2,
      });
    const result = await new PatientProfileRetriever({ query } as unknown as Pool).search(
      { question: 'x' },
      makeCtx(),
    );
    const fields = result.chunks[0].metadata.fields as Record<string, unknown>;
    expect(fields.d4z4).toBe('4');
  });
});
