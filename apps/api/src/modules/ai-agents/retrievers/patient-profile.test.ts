import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

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
    ocr_payload: { fields: { classifiedType: documentType, ...fields } },
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
