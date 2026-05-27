/**
 * Integration tests for the privacy boundary fix landed in PR #23
 * review.
 *
 * These tests compose a real `PatientProfileRetriever` /
 * `PatientReportsRetriever` (with a mocked pool) and run their output
 * through `renderChunkForPrompt`, then assert that strict-mode prompt
 * text cannot contain raw patient values. This is the **regression
 * fence** for the "raw values land in the prompt via chunk.content"
 * bug that the reviewer flagged.
 */

import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { renderChunkForPrompt } from './render.js';
import type { RetrieveContext, RetrievedChunk } from '../retrievers/base.js';
import { PatientProfileRetriever } from '../retrievers/patient-profile.js';
import { PatientReportsRetriever } from '../retrievers/patient-reports.js';

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

const PROFILE_ROW = {
  id: 'profile-1',
  full_name: '张三',
  date_of_birth: '1990-04-15',
  gender: 'female',
  diagnosis_stage: 'confirmed',
  diagnosis_date: '2023-06-01',
  genetic_mutation: 'FSHD1 inferred from D4Z4 contraction at 4q35',
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
  notes: '私人备注：联系医生李四，电话 13812345678',
};

const REPORT_ROWS = [
  {
    id: 'doc-1',
    document_type: 'genetic_report',
    title: '张三的基因检测报告 - 2023年6月',
    uploaded_at: '2026-04-01T08:00:00Z',
    status: 'processed',
    ocr_payload: {
      fields: {
        classifiedType: 'genetic_report',
        diagnosisType: 'FSHD1',
        d4z4Repeats: '3/22',
        haplotype: '4qA',
        methylationValue: '12%',
        patientName: '张三',
        patientId: '11010119900520XXXX',
        reportIssueDate: '2023-06-01',
        rawFreeText: '患者张三，男，身份证 110101199005203XXX，电话 138-1234-5678',
      },
    },
    classified_type: 'genetic_report',
  },
  {
    id: 'doc-2',
    document_type: 'mri',
    title: '大腿 MRI - 张三',
    uploaded_at: '2026-03-15T10:00:00Z',
    status: 'processed',
    ocr_payload: {
      fields: {
        classifiedType: 'mri',
        findings:
          '受检者张三，右大腿后群 STIR 信号显著增高，左大腿后群轻度增高。患者电话 13812345678。',
      },
    },
    classified_type: 'mri',
  },
];

const RAW_LEAK_PROBES = [
  '张三', // patient name
  '3/22', // raw D4Z4 repeat count
  '12%', // raw methylation percentage
  '4qA', // raw haplotype
  '2023-06-01', // raw exact date
  '1990-04-15', // raw DOB
  '13812345678', // phone number
  '110101199005203', // ID card prefix
  '110101199005203XXX', // ID card
  'STIR', // free-text OCR finding excerpt
  '海淀', // district-level address
  '李四', // free-text inside notes
  '张三的基因检测报告', // user-named report title
  'FSHD1 inferred from D4Z4 contraction at 4q35', // free-text genetic_mutation
];

const assertNoLeak = (text: string): void => {
  for (const probe of RAW_LEAK_PROBES) {
    expect(text).not.toContain(probe);
  }
};

describe('renderChunkForPrompt — patient profile, strict mode (regression fence)', () => {
  it('strips raw D4Z4 / methylation / haplotype / dates / names from prompt text', async () => {
    const retriever = new PatientProfileRetriever(fakePool([PROFILE_ROW]));
    const result = await retriever.search({ question: 'tell me about me' }, makeCtx());
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'strict' });

    assertNoLeak(rendered.content);

    // Clinicalised forms should be present so the LLM still has
    // something clinical to talk about.
    expect(rendered.content).toContain('low_repeat_severe');
    expect(rendered.content).toContain('hypomethylated_severe');
    expect(rendered.content).toContain('pathogenic_haplotype_permissive');
    expect(rendered.content).toContain('2023'); // diagnosisYear from foundation is allowed.

    // fieldsUsed feeds the audit log; sanity check it does not name
    // any hard-deleted key.
    expect(rendered.fieldsUsed).not.toContain('fullName');
    expect(rendered.fieldsUsed).not.toContain('regionDistrict');
    expect(rendered.fieldsUsed).not.toContain('notes');
    expect(rendered.fieldsUsed).not.toContain('d4z4');
    expect(rendered.fieldsUsed).toContain('d4z4_clinical');
  });

  it('keeps raw values when the user has opted into precise mode', async () => {
    const retriever = new PatientProfileRetriever(fakePool([PROFILE_ROW]));
    const result = await retriever.search(
      { question: 'detail' },
      makeCtx({ consentLevel: 'precise' }),
    );
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'precise' });

    expect(rendered.content).toContain('3/22');
    expect(rendered.content).toContain('12%');
    expect(rendered.content).toContain('4qA');
    // Hard-delete keys still gone even in precise mode.
    expect(rendered.content).not.toContain('张三');
    expect(rendered.content).not.toContain('13812345678');
    expect(rendered.content).not.toContain('海淀');
  });
});

describe('renderChunkForPrompt — patient reports, strict mode (regression fence)', () => {
  it('strips raw OCR values, user-named titles, and exact dates from every chunk', async () => {
    const retriever = new PatientReportsRetriever(fakePool(REPORT_ROWS));
    const result = await retriever.search({ question: 'recent reports' }, makeCtx());
    expect(result.chunks).toHaveLength(2);

    for (const chunk of result.chunks) {
      const rendered = renderChunkForPrompt(chunk, { mode: 'strict' });
      assertNoLeak(rendered.content);
      // Strict mode must drop the raw OCR `fields` blob entirely.
      expect(rendered.content).not.toContain('rawFreeText');
      expect(rendered.content).not.toContain('patientName');
      expect(rendered.fieldsUsed).not.toContain('title');
      expect(rendered.fieldsUsed).not.toContain('fields');
    }
  });

  it('keeps clinically useful raw OCR values in precise mode', async () => {
    const retriever = new PatientReportsRetriever(fakePool([REPORT_ROWS[0]]));
    const result = await retriever.search(
      { question: 'reports' },
      makeCtx({ consentLevel: 'precise' }),
    );
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'precise' });

    expect(rendered.content).toContain('3/22');
    expect(rendered.content).toContain('4qA');
    expect(rendered.content).toContain('12%');
    // PR #23 follow-up: title is no longer in the precise allowlist
    // because it is user-supplied free text and routinely contains
    // the patient's name. The clinical report type still passes.
    expect(rendered.content).not.toContain('张三的基因检测报告');
    expect(rendered.content).toContain('genetic_report');
  });

  // Regression for the bot's PR #23 follow-up review:
  // precise mode must scrub identifier-like keys nested inside the
  // OCR `fields` blob, and reject free-form OCR keys whose values
  // routinely carry PII.
  it('precise mode strips nested identifier keys and free-form OCR fields', async () => {
    const retriever = new PatientReportsRetriever(fakePool(REPORT_ROWS));
    const result = await retriever.search(
      { question: 'reports' },
      makeCtx({ consentLevel: 'precise' }),
    );

    for (const chunk of result.chunks) {
      const rendered = renderChunkForPrompt(chunk, { mode: 'precise' });

      // Nested hard-delete key NAMES must be gone.
      expect(rendered.content).not.toContain('patientName');
      expect(rendered.content).not.toContain('patientId');

      // And their VALUES must not survive via any other path.
      expect(rendered.content).not.toContain('张三'); // also catches rawFreeText leak
      expect(rendered.content).not.toContain('11010119900520XXXX');
      expect(rendered.content).not.toContain('110101199005203XXX');
      expect(rendered.content).not.toContain('13812345678');
      expect(rendered.content).not.toContain('138-1234-5678');

      // Free-form OCR keys with prose values must be dropped entirely
      // — including the MRI `findings` and the catch-all rawFreeText.
      expect(rendered.content).not.toContain('rawFreeText');
      expect(rendered.content).not.toContain('受检者');
      expect(rendered.content).not.toContain('STIR');
    }

    // Clinically useful raw values still come through for the
    // genetic report so precise mode is not gutted.
    const genetic = renderChunkForPrompt(result.chunks[0], { mode: 'precise' });
    expect(genetic.content).toContain('3/22'); // d4z4Repeats raw
    expect(genetic.content).toContain('4qA'); // haplotype raw
    expect(genetic.content).toContain('12%'); // methylationValue raw
    expect(genetic.content).toContain('FSHD1'); // diagnosisType raw label
    // Exact issue date is also stripped to year-only.
    expect(genetic.content).not.toContain('2023-06-01');
    expect(genetic.content).toContain('2023');
  });
});

describe('renderChunkForPrompt — non-patient sources', () => {
  it('passes medical_kb chunks through unchanged in both modes', () => {
    const kbChunk: RetrievedChunk = {
      id: 'k-1',
      source: 'medical_kb',
      content: 'FSHD1 由 4 号染色体 D4Z4 重复减少导致 DUX4 表达失调。',
      metadata: {},
      distance: 0.1,
      sourceFile: 'fshd/02-genetics-d4z4.md',
      chunkIndex: 0,
    };
    for (const mode of ['strict', 'precise'] as const) {
      const rendered = renderChunkForPrompt(kbChunk, { mode });
      expect(rendered.content).toBe(kbChunk.content);
      expect(rendered.fieldsUsed).toEqual([]);
      expect(rendered.stats).toBeNull();
    }
  });

  it('returns empty content for stub platform_docs chunks (none expected)', () => {
    const stubChunk: RetrievedChunk = {
      id: 'p-1',
      source: 'platform_docs',
      content: '',
      metadata: {},
      distance: null,
      sourceFile: null,
      chunkIndex: null,
    };
    const rendered = renderChunkForPrompt(stubChunk, { mode: 'strict' });
    expect(rendered.content).toBe('');
    expect(rendered.fieldsUsed).toEqual([]);
  });
});
