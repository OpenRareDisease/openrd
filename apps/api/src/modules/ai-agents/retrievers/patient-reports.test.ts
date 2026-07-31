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

describe('findings_summary', () => {
  const rowWith = (ocrFields: Record<string, unknown>) => ({
    id: 'doc-1',
    document_type: 'mri',
    title: null,
    uploaded_at: '2026-07-30T00:00:00.000Z',
    status: 'parsed',
    ocr_payload: { fields: ocrFields },
    classified_type: 'muscle_mri',
  });

  const fieldsFor = async (ocrFields: Record<string, unknown>) => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [rowWith(ocrFields)], rowCount: 1 }),
    } as unknown as Pool;
    const result = await new PatientReportsRetriever(pool).search(
      { question: '' },
      {
        userId: 'u1',
        consentLevel: 'precise',
        logger: silentLogger as unknown as RetrieveContext['logger'],
      },
    );
    return result.chunks[0].metadata.fields as Record<string, unknown>;
  };

  it('surfaces the clinical substance of an impression', async () => {
    // The allowlist has had a slot for this since PR #23; nothing
    // filled it, so「这份报告说明什么」was unanswerable.
    const f = await fieldsFor({
      reportImpression: '以上改变，符合肌营养不良改变，请结合临床。',
    });
    expect(f.findings_summary).toBe('肌营养不良改变');
  });

  it('cannot leak a name, because only vocabulary terms are emitted', async () => {
    // The exact shape the render.test.ts fence rejected: a name the
    // OCR never filed under a key of its own, so nothing could strip
    // it by. A vocabulary match cannot carry it either way.
    const f = await fieldsFor({
      reportImpression: '受检者张三，右大腿后群脂肪浸润，符合肌营养不良改变，请结合临床。李晶',
    });
    const s = String(f.findings_summary);
    expect(s).not.toContain('张三');
    expect(s).not.toContain('李晶');
    expect(s).toContain('肌营养不良改变');
    expect(s).toContain('脂肪浸润');
  });

  it('emits the longer term and drops the substring it covers', async () => {
    const f = await fieldsFor({ reportImpression: '符合肌营养不良改变' });
    expect(f.findings_summary).toBe('肌营养不良改变');
  });

  it('reads a genetic report conclusion too', async () => {
    const f = await fieldsFor({
      interpretationSummary: '检出 4qA 单倍型，D4Z4 重复单元缩短，符合 FSHD1。',
    });
    const s = String(f.findings_summary);
    expect(s).toContain('FSHD1');
    expect(s).toContain('4qA');
    expect(s).toContain('D4Z4');
  });

  it('emits nothing when the narrative contains no recognised finding', async () => {
    // Deny-by-default: unrecognised prose yields nothing at all,
    // rather than a best-effort excerpt.
    const f = await fieldsFor({
      reportImpression: '受检者张三于门诊完成检查，报告已交由主管医师王五。',
    });
    expect(f.findings_summary).toBeUndefined();
  });

  it('does not report a finding the radiologist ruled out', async () => {
    // Substring matching alone inverted these. The raw impression is
    // dropped by the redactor, so whatever this emits is the only
    // version of the report the model ever sees.
    const f = await fieldsFor({
      reportImpression: '双侧大腿肌群未见明显脂肪浸润，未见肌肉萎缩。',
    });
    expect(f.findings_summary).toBeUndefined();
  });

  it('tells a negative genetic result apart from a positive one', async () => {
    const f = await fieldsFor({
      interpretationSummary: '排除 FSHD1，未检出 D4Z4 重复单元缩短。',
    });
    expect(f.findings_summary).toBeUndefined();
  });

  it('keeps asserted findings when a later clause negates something else', async () => {
    // Negation scopes to its own clause — it must not swallow the
    // finding the report actually does assert.
    const f = await fieldsFor({
      reportImpression: '双侧大腿见脂肪浸润，未见肌肉萎缩。',
    });
    expect(f.findings_summary).toBe('脂肪浸润');
  });

  it('handles the mixed case across several clauses', async () => {
    const f = await fieldsFor({
      reportImpression: '右侧腓肠肌脂肪浸润；左侧胫骨前肌炎性改变；未见明显水肿。',
    });
    const s = String(f.findings_summary);
    expect(s).toContain('脂肪浸润');
    expect(s).toContain('炎性改变');
    expect(s).not.toContain('水肿');
  });

  it('emits nothing when there is no impression', async () => {
    const f = await fieldsFor({ classifiedType: 'muscle_mri' });
    expect(f.findings_summary).toBeUndefined();
  });
});
