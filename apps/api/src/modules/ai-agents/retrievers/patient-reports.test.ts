import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { RetrieveContext } from './base.js';
import { PatientReportsRetriever } from './patient-reports.js';

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

const fakePool = (rows: unknown[]) => {
  const query = vi.fn().mockResolvedValue({
    rows,
    rowCount: rows.length,
  } as unknown as QueryResult);
  return {
    pool: { query } as unknown as Pool,
    query,
  };
};

describe('PatientReportsRetriever', () => {
  it('short-circuits without a user in context', async () => {
    const { pool, query } = fakePool([]);
    const retriever = new PatientReportsRetriever(pool);
    const result = await retriever.search({ question: 'x' }, makeCtx({ userId: null }));
    expect(result.metadata.reason).toBe('no_user_in_scope');
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses to read when consent is none', async () => {
    const { pool, query } = fakePool([]);
    const retriever = new PatientReportsRetriever(pool);
    const result = await retriever.search({ question: 'x' }, makeCtx({ consentLevel: 'none' }));
    expect(result.metadata.reason).toBe('consent_not_granted');
    expect(query).not.toHaveBeenCalled();
  });

  it('returns empty with reason when no rows match', async () => {
    const { pool } = fakePool([]);
    const retriever = new PatientReportsRetriever(pool);
    const result = await retriever.search({ question: 'x' }, makeCtx());
    expect(result.metadata.reason).toBe('no_reports_found');
  });

  it('renders chunks with placeholder content and raw structured fields', async () => {
    const { pool } = fakePool([
      {
        id: 'doc-1',
        document_type: 'genetic_report',
        title: '张三的基因检测报告',
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
          },
        },
        classified_type: 'genetic_report',
      },
      {
        id: 'doc-2',
        document_type: 'mri',
        title: '大腿 MRI',
        uploaded_at: '2026-03-15T10:00:00Z',
        status: 'processed',
        ocr_payload: {
          fields: {
            classifiedType: 'mri',
            findings: '右大腿后群 STIR 信号显著增高',
          },
        },
        classified_type: 'mri',
      },
    ]);

    const retriever = new PatientReportsRetriever(pool);
    const result = await retriever.search({ question: 'recent reports' }, makeCtx());

    expect(result.chunks).toHaveLength(2);

    // Neither chunk content nor citation snippet may carry raw values.
    for (const chunk of result.chunks) {
      expect(chunk.content).toMatch(/^【患者报告占位/);
      expect(chunk.content).not.toContain('张三');
      expect(chunk.content).not.toContain('3/22');
      expect(chunk.content).not.toContain('12%');
      expect(chunk.content).not.toContain('2026-04-01');
      expect(chunk.content).not.toContain('STIR');
    }
    for (const citation of result.citations) {
      expect(citation.snippet).toBe('你的患者报告');
    }

    // metadata.fields carries the raw OCR map for the redactor.
    const f0 = result.chunks[0].metadata.fields as Record<string, unknown>;
    expect(f0.classifiedType).toBe('genetic_report');
    expect(f0.title).toBe('张三的基因检测报告');
    expect(f0.reportDate).toBe('2026-04-01T08:00:00.000Z');
    const inner = f0.fields as Record<string, unknown>;
    expect(inner.d4z4Repeats).toBe('3/22');
    expect(inner.haplotype).toBe('4qA');
    expect(inner.patientName).toBe('张三');

    const f1 = result.chunks[1].metadata.fields as Record<string, unknown>;
    expect((f1.fields as Record<string, unknown>).findings).toContain('STIR');
  });

  it('honours documentType and since filters in the SQL params', async () => {
    const { pool, query } = fakePool([]);
    const retriever = new PatientReportsRetriever(pool);
    await retriever.search(
      {
        question: 'x',
        filter: { documentType: 'mri', since: '2026-01-01' },
        limit: 3,
      },
      makeCtx(),
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0];
    expect(params[0]).toBe('user-1');
    expect(params).toContain('mri');
    expect(params.at(-1)).toBe(3);
  });

  it('clamps the limit at the safety ceiling', async () => {
    const { pool, query } = fakePool([]);
    const retriever = new PatientReportsRetriever(pool);
    await retriever.search({ question: 'x', limit: 999 }, makeCtx());
    const [, params] = query.mock.calls[0];
    const limit = params.at(-1) as number;
    expect(limit).toBeLessThanOrEqual(20);
  });
});
