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
    // No `reportTime` on this payload, so the row carries only the
    // moment it arrived — under the key that says so. `reportDate` is
    // the laboratory's own date and this row has none.
    expect(f0.reportDate).toBeUndefined();
    expect(f0.uploadDate).toBe('2026-04-01T08:00:00.000Z');
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

  it('says nothing about genetics, whatever the narrative asserts', async () => {
    // This used to emit 「FSHD1、4qA、D4Z4、重复单元缩短」 off a substring
    // match with no laboratory gate and no haplotype reader. The
    // structured cells on the same report reach the same prompt block
    // through `projectOcrFields`, which reads them with the passport's
    // own readers and applies both gates, so the narrative channel has
    // nothing to add here and could only ever contradict them.
    const f = await fieldsFor({
      interpretationSummary: '检出 4qA 单倍型，D4Z4 重复单元缩短，符合 FSHD1。',
    });
    expect(f.findings_summary).toBeUndefined();
  });

  it('does not turn a sentence naming the probes into a haplotype finding', async () => {
    // Observed: 「采用4qA/4qB探针…」 came out as 「4qA、4qB、D4Z4、重复单元
    // 缩短」 while the structured haplotype cell on the same report,
    // read by `parsePermissiveHaplotype`, said `unspecified_haplotype`.
    const f = await fieldsFor({
      reportImpression: '采用4qA/4qB探针进行D4Z4重复单元缩短检测',
    });
    expect(f.findings_summary).toBeUndefined();
  });

  it('does not assert genetics off a 病历摘要', async () => {
    // Every structured genetics cell on a transcription is stamped
    // `not_read_off_a_laboratory_report`. The narrative was asserting
    // the same values as fact two lines above them.
    const f = await fieldsFor({
      classifiedType: 'medical_summary',
      reportImpression: '外院基因检测提示FSHD1，4qA，D4Z4重复单元缩短',
    });
    expect(f.findings_summary).toBeUndefined();
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

  /**
   * One fixture per negation FORM, not per clause.
   *
   * The clause-level marker scan answered 「does this clause contain a
   * negating word」, and the two commonest forms in these reports
   * contain none: a bare 未 glued to the front of the term, and a
   * qualifier glued to the back. Both were asserted as present, and
   * the redactor drops the raw impression — so this line was the only
   * version of the report the model ever saw.
   */
  describe('negation forms', () => {
    it('未 prefixed straight onto the term (未受累)', async () => {
      // Was: 「影像/报告印象: 受累」 — the ruled-out finding, asserted.
      const f = await fieldsFor({
        reportImpression: '双侧股四头肌未受累，肩胛带肌未见异常',
      });
      expect(f.findings_summary).toBeUndefined();
    });

    it('不明显 following the term', async () => {
      // Was: 「影像/报告印象: 脂肪浸润」. NEGATION_MARKERS carried 无明显
      // and not 不明显.
      const f = await fieldsFor({ reportImpression: '大腿后群脂肪浸润不明显' });
      expect(f.findings_summary).toBeUndefined();
    });

    it('未累及 / 未及 carrying the term after them', async () => {
      // Was: 「影像/报告印象: 肌肉萎缩」.
      const f = await fieldsFor({ reportImpression: '腓肠肌未累及；胫前肌未及肌肉萎缩' });
      expect(f.findings_summary).toBeUndefined();
    });

    it('阴性 / 正常 following the term', async () => {
      const f = await fieldsFor({ reportImpression: '水肿阴性 信号增高正常' });
      expect(f.findings_summary).toBeUndefined();
    });

    it('非 / 无 prefixed onto the term', async () => {
      const f = await fieldsFor({ reportImpression: '非对称 无水肿' });
      expect(f.findings_summary).toBeUndefined();
    });

    it('still asserts a term negated somewhere else in the same clause', async () => {
      // The new test is per OCCURRENCE, not per clause: 无水肿 in the
      // first half must not silence the asserted 水肿 in the second.
      // (A clause carrying a listed marker — 未见, 无明显 — is still
      // discarded whole, which is the older and more conservative
      // rule; this fixture deliberately uses a bare 无 prefix, which
      // is not a marker, so the match-site test is what answers.)
      const f = await fieldsFor({ reportImpression: '左侧无水肿 右侧水肿明显' });
      expect(f.findings_summary).toBe('水肿');
    });
  });
});

describe('report date vs upload date', () => {
  const rowWith = (fields: Record<string, unknown>) => ({
    id: 'doc-1',
    document_type: 'genetic_report',
    title: null,
    uploaded_at: '2026-08-18T00:00:00.000Z',
    status: 'parsed',
    ocr_payload: { fields },
    classified_type: 'genetic_report',
    report_type_label: '基因检测报告',
  });

  const searchWith = async (fields: Record<string, unknown>) => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [rowWith(fields)], rowCount: 1 }),
    } as unknown as Pool;
    return new PatientReportsRetriever(pool).search({ question: '' }, makeCtx());
  };

  it('files the laboratory own date under reportDate, and the chip agrees', async () => {
    // One turn used to carry both answers: the 依据 chip said 2019-03
    // and the prompt said 报告年份: 2026. How old a D4Z4 result is
    // decides whether a clinician re-tests it.
    const result = await searchWith({ classifiedType: 'genetic_report', reportTime: '2019-03-14' });
    const f = result.chunks[0].metadata.fields as Record<string, unknown>;
    expect(f.reportDate).toBe('2019-03-14T00:00:00.000Z');
    expect(f.uploadDate).toBeUndefined();
    expect(result.citations[0].sourceFile).toBe('基因检测报告 · 2019-03');
  });

  it('reads the legacy report_time spelling too', async () => {
    const result = await searchWith({
      classifiedType: 'genetic_report',
      report_time: '2019-03-14',
    });
    const f = result.chunks[0].metadata.fields as Record<string, unknown>;
    expect(f.reportDate).toBe('2019-03-14T00:00:00.000Z');
  });

  it('never calls a bare upload timestamp the report date', async () => {
    const result = await searchWith({ classifiedType: 'genetic_report' });
    const f = result.chunks[0].metadata.fields as Record<string, unknown>;
    expect(f.reportDate).toBeUndefined();
    expect(f.uploadDate).toBe('2026-08-18T00:00:00.000Z');
    expect(result.citations[0].sourceFile).toBe('基因检测报告 · 2026-08');
  });
});
