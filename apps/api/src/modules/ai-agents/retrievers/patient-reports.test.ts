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
      // The occurrence test is per OCCURRENCE, not per clause: 无水肿 in
      // the first half must not silence the asserted 水肿 in the second.
      //
      // NO SPACE IN THIS FIXTURE, deliberately. It used to read
      // 「左侧无水肿 右侧水肿明显」, which whitespace now splits into two
      // clauses — so it would pass without the occurrence test doing
      // any work at all and stop fencing the thing it was written for.
      // 而 keeps it one clause, and it carries no listed marker, so the
      // occurrence test is the only thing that can answer.
      const f = await fieldsFor({ reportImpression: '左侧无水肿而右侧水肿明显' });
      expect(f.findings_summary).toBe('水肿');
    });
  });

  /**
   * OCR SEPARATES CLAUSES WITH WHITESPACE, and one negated clause used
   * to take the whole impression down with it.
   */
  describe('whitespace clause boundaries', () => {
    it('keeps the asserted half of a space-separated impression', async () => {
      // Was: undefined — every real finding in the string dropped
      // because 未见肌肉萎缩 made the ONE clause a negated clause.
      const f = await fieldsFor({ reportImpression: '双侧大腿脂肪浸润明显 未见肌肉萎缩' });
      expect(f.findings_summary).toBe('脂肪浸润');
    });

    it('splits on a full-width space and on a tab too', async () => {
      const full = await fieldsFor({ reportImpression: '右侧腓肠肌炎性改变　未见水肿' });
      expect(full.findings_summary).toBe('炎性改变');
      const tab = await fieldsFor({ reportImpression: '右侧腓肠肌炎性改变\t未见水肿' });
      expect(tab.findings_summary).toBe('炎性改变');
    });

    it('asserts the second half of the string the old comment named', async () => {
      // 「未见脂肪浸润 右侧脂肪浸润明显」 was documented above
      // `assertedOccurrence` as surviving 「inside one clause」, and
      // executing it produced nothing: a LISTED marker discards its
      // clause whole, before any occurrence test runs. It survives now
      // because the space makes it two clauses — which is what the
      // comment says today.
      const f = await fieldsFor({ reportImpression: '未见脂肪浸润 右侧脂肪浸润明显' });
      expect(f.findings_summary).toBe('脂肪浸润');
    });
  });

  /**
   * WHOSE FINDING, FROM WHEN, AND HOW SURE.
   */
  describe('attribution, tense and hedging', () => {
    it('does not report a relative diagnosis as the patient impression', async () => {
      // Was: 「影像/报告印象: 肌营养不良」 — the mother's diagnosis, while
      // the patient's own negative result in the next clause was
      // correctly dropped. The only thing the model was told about this
      // report was a fact about a different person.
      const f = await fieldsFor({
        reportImpression: '患者母亲确诊肌营养不良，本人双侧大腿未见脂肪浸润。',
      });
      expect(f.findings_summary).toBeUndefined();
    });

    it('does not read a 家族史 clause as imaging', async () => {
      // Was: 「影像/报告印象: 肌肉萎缩」 for a report whose own conclusion
      // was 未见明显异常.
      const f = await fieldsFor({
        reportImpression: '家族史：父亲有肌肉萎缩；本次检查未见明显异常。',
      });
      expect(f.findings_summary).toBeUndefined();
    });

    it('does not report a resolved finding as current', async () => {
      // Was: 「影像/报告印象: 水肿」 for oedema the report says is gone.
      const f = await fieldsFor({ reportImpression: '既往水肿，现已吸收。' });
      expect(f.findings_summary).toBeUndefined();
    });

    it('reads the resolution verb at the occurrence, not just the 既往', async () => {
      const f = await fieldsFor({ reportImpression: '双侧大腿水肿已基本吸收' });
      expect(f.findings_summary).toBeUndefined();
    });

    it('does not emit a prior-study finding beside the study contradicting it', async () => {
      // Was: 「影像/报告印象: 脂肪浸润」 — the previous report's finding
      // asserted, and the current study's negative answer dropped, so
      // the model got the stale half of a contradiction and no sign
      // there had been one.
      const f = await fieldsFor({
        reportImpression: '前次报告示脂肪浸润，本次复查未见脂肪浸润。',
      });
      expect(f.findings_summary).toBeUndefined();
    });

    it('kills 原有资料 but reads 原发性, which is not the past', async () => {
      // The bare 原 marker is deliberately broad, and executing it over
      // 「原发性肌营养不良改变」 returned nothing — the FSHD conclusion
      // itself dropped by a tense marker, on a channel whose null
      // result the model reads as 「the report says nothing」.
      const past = await fieldsFor({
        reportImpression: '原有资料示脂肪浸润，本次未见脂肪浸润。',
      });
      expect(past.findings_summary).toBeUndefined();
      const primary = await fieldsFor({ reportImpression: '原发性肌营养不良改变' });
      expect(primary.findings_summary).toBe('肌营养不良改变');
    });

    it('does not restate an 外院 report as this study', async () => {
      const f = await fieldsFor({
        reportImpression: '外院MRI示肌营养不良改变，本院复查大致正常。',
      });
      expect(f.findings_summary).toBeUndefined();
    });

    it('renders a hedged finding differently from a definite one', async () => {
      // These two produced BYTE-IDENTICAL prompt lines
      // (「影像/报告印象: 脂肪浸润」), so a patient whose MRI raised a
      // question was told this platform had answered it.
      const hedged = await fieldsFor({ reportImpression: '脂肪浸润待排' });
      const definite = await fieldsFor({ reportImpression: '双侧大腿脂肪浸润明显' });
      expect(hedged.findings_summary).toBe('脂肪浸润（待排）');
      expect(definite.findings_summary).toBe('脂肪浸润');
      expect(hedged.findings_summary).not.toBe(definite.findings_summary);
    });

    it('carries 可疑 and 不除外 into the phrase as well', async () => {
      const suspected = await fieldsFor({ reportImpression: '可疑炎性改变，建议随访。' });
      expect(suspected.findings_summary).toBe('炎性改变（可疑）');
      const notExcluded = await fieldsFor({ reportImpression: '不除外肌营养不良改变' });
      expect(notExcluded.findings_summary).toBe('肌营养不良改变（不除外）');
    });
  });

  /**
   * SEVERITY BELONGS TO A FINDING, NOT TO THE SUMMARY.
   */
  describe('severity qualifiers', () => {
    it('binds each severity to the finding it qualified', async () => {
      // Was: 「脂肪浸润、肌肉萎缩、轻度、重度」 — emitted in vocabulary
      // order, so reading it by position gives 轻度脂肪浸润 and
      // 重度肌肉萎缩 exactly inverted.
      const f = await fieldsFor({
        reportImpression: '双侧大腿脂肪浸润轻度；肩胛带肌肉萎缩重度。',
      });
      expect(f.findings_summary).toBe('轻度脂肪浸润、重度肌肉萎缩');
    });

    it('reads a qualifier written in front of the finding too', async () => {
      const f = await fieldsFor({ reportImpression: '弥漫性脂肪浸润；局灶性水肿。' });
      expect(f.findings_summary).toBe('弥漫性脂肪浸润、局灶性水肿');
    });

    it('never emits a severity on its own', async () => {
      // A detached 重度 carries no information; the vocabulary no
      // longer contains one.
      const f = await fieldsFor({ reportImpression: '病变程度重度。' });
      expect(f.findings_summary).toBeUndefined();
    });
  });

  /**
   * A VOCABULARY MISS MUST NOT LEAVE 大致正常 STANDING ALONE.
   */
  describe('bare 萎缩 and the normality claim', () => {
    it('reads shoulder-girdle atrophy the compounds could not', async () => {
      // Was: 「影像/报告印象: 大致正常、重度」 — this platform telling a
      // patient their shoulder-girdle MRI was unremarkable, for the one
      // region FSHD is named after.
      const f = await fieldsFor({ reportImpression: '肩胛带肌重度萎缩，余大致正常。' });
      expect(f.findings_summary).toBe('重度萎缩');
    });

    it('says nothing at all about a normal report', async () => {
      // Normality is asserted through the ABSENCE of positive findings,
      // which is the one form of the claim a vocabulary miss cannot
      // forge. Same reasoning that removed 未见明显异常.
      const f = await fieldsFor({ reportImpression: '双侧大腿肌群大致正常。' });
      expect(f.findings_summary).toBeUndefined();
    });

    it('still rules out a negated 萎缩', async () => {
      const f = await fieldsFor({ reportImpression: '肩胛带肌未萎缩 大腿萎缩不明显' });
      expect(f.findings_summary).toBeUndefined();
    });
  });

  /**
   * NOTHING HERE GRADES A METHYLATION RESULT.
   */
  describe('methylation', () => {
    it('does not grade a methylation sentence', async () => {
      // Was: 「影像/报告印象: 中度」 — a bare grade of a methylation
      // value, on a platform that states no methylation boundary. The
      // genetics vocabulary was stripped for exactly this reason and
      // the severity qualifiers walked straight past the decision.
      const f = await fieldsFor({ reportImpression: '甲基化水平中度降低。' });
      expect(f.findings_summary).toBeUndefined();
    });

    it('kills the clause on the Latin spelling too, in any case', async () => {
      const f = await fieldsFor({ reportImpression: 'D4Z4 Methylation 轻度降低' });
      expect(f.findings_summary).toBeUndefined();
    });

    it('does not let a methylation clause silence the rest of the report', async () => {
      const f = await fieldsFor({
        reportImpression: '甲基化水平中度降低；双侧大腿重度脂肪浸润。',
      });
      expect(f.findings_summary).toBe('重度脂肪浸润');
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

  /**
   * THE CHIP MUST NOT MOVE WHEN THE SERVER DOES.
   *
   * `reportDateLabel` re-parsed the ISO instant `resolveReportDate` had
   * already produced and read it back with `getFullYear` / `getMonth`,
   * which are the process's zone. A date-only `reportTime` is UTC
   * midnight, so on any host west of Greenwich a 1 January report slid
   * back over both boundaries at once — the chip whose job is to tell
   * the patient how old a D4Z4 result is read a whole year early.
   */
  describe('under a process timezone west of UTC', () => {
    const withTz = async (tz: string, fields: Record<string, unknown>) => {
      const previous = process.env.TZ;
      process.env.TZ = tz;
      try {
        const result = await searchWith(fields);
        return result.citations[0].sourceFile;
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    };

    it('labels a 1 January report with January, in every zone', async () => {
      // Was: 「基因检测报告 · 2024-12」 under America/Los_Angeles.
      const fields = { classifiedType: 'genetic_report', reportTime: '2025-01-01' };
      expect(await withTz('America/Los_Angeles', fields)).toBe('基因检测报告 · 2025-01');
      expect(await withTz('Asia/Shanghai', fields)).toBe('基因检测报告 · 2025-01');
      expect(await withTz('UTC', fields)).toBe('基因检测报告 · 2025-01');
    });

    it('gives the same chip for a mid-month report in every zone', async () => {
      const fields = { classifiedType: 'genetic_report', reportTime: '2019-03-14' };
      expect(await withTz('America/Los_Angeles', fields)).toBe('基因检测报告 · 2019-03');
      expect(await withTz('Asia/Shanghai', fields)).toBe('基因检测报告 · 2019-03');
    });
  });
});
