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
      independentlyAmbulatory: true,
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
    expect(fields.independentlyAmbulatory).toBe(true);
    expect(fields.assistiveDevices).toEqual(['AFO']);
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
