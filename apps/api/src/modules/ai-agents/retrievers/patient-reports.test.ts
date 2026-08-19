import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { RetrieveContext } from './base.js';
import { PatientReportsRetriever } from './patient-reports.js';
import { REPORT_IMPRESSION_CHANNEL_ENABLED } from '../security/allowlist.js';
import { gateReportImpression } from '../security/pii-redactor.js';
import { REPORT_IMPRESSION_LABELS, renderChunkForPrompt } from '../security/render.js';

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

describe('the report own impression', () => {
  const rowWith = (
    ocrFields: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 'doc-1',
    document_type: 'mri',
    title: null,
    uploaded_at: '2026-07-30T00:00:00.000Z',
    status: 'parsed',
    ocr_payload: { fields: ocrFields },
    classified_type: 'muscle_mri',
    ...overrides,
  });

  const searchFor = async (
    ocrFields: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [rowWith(ocrFields, overrides)], rowCount: 1 }),
    } as unknown as Pool;
    return new PatientReportsRetriever(pool).search(
      { question: '' },
      {
        userId: 'u1',
        consentLevel: 'precise',
        logger: silentLogger as unknown as RetrieveContext['logger'],
      },
    );
  };

  const fieldsFor = async (
    ocrFields: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) => {
    const result = await searchFor(ocrFields, overrides);
    return result.chunks[0].metadata.fields as Record<string, unknown>;
  };

  /**
   * THE ROWS THE THREE GATES PRODUCE FOR A CHUNK, PRINTED THE WAY
   * `render.ts` PRINTS THEM.
   *
   * Only reached while the channel is switched off. The labels come
   * from the renderer's own table rather than being spelled again here,
   * and the zero-and-null rule is the one `put()` applies in
   * pii-redactor.ts, so a row appears here exactly when it would appear
   * in a prompt.
   */
  const gatedRows = (fields: Record<string, unknown>, mode: 'strict' | 'precise'): string[] => {
    const outcome = gateReportImpression(fields, { mode });
    if (!outcome) return [];
    const rows: string[] = [];
    const put = (label: string, value: string | number | null) => {
      if (value === null || value === 0) return;
      rows.push(`${label}: ${value}`);
    };
    put(REPORT_IMPRESSION_LABELS.reportImpression, outcome.text);
    put(REPORT_IMPRESSION_LABELS.reportImpressionWithheld, outcome.withheld);
    // Strict-only, exactly as the allowlist carries it: precise consent
    // masks nothing, so the count there is always zero.
    if (mode === 'strict') {
      put(REPORT_IMPRESSION_LABELS.reportImpressionValuesMasked, outcome.valuesMasked);
    }
    put(REPORT_IMPRESSION_LABELS.reportImpressionIdentifiersRemoved, outcome.identifiersRemoved);
    put(REPORT_IMPRESSION_LABELS.reportImpressionCharactersCut, outcome.charactersCut);
    return rows;
  };

  /**
   * WHAT THE MODEL ACTUALLY READS, in one mode — PLUS, WHILE THE
   * CHANNEL IS SWITCHED OFF, THE ROWS IT WOULD HAVE CONTRIBUTED.
   *
   * Nothing here asserts on `metadata.fields`, which is the retriever's
   * raw offering and is on neither allowlist: what the model gets is
   * whatever survives the three gates, and only the renderer can say
   * what that is.
   *
   * AND THE CHANNEL IS BEHIND A SWITCH, DEFAULT OFF
   * (`REPORT_IMPRESSION_CHANNEL_ENABLED`, argued in
   * security/allowlist.ts). This suite is about what the GATES make of
   * a report's own sentence — sixty-odd cases of Chinese negation,
   * hedging, attribution and identifier shapes that took two rounds of
   * red-teaming to assemble — and none of that stops being true when
   * the rows stop being wired to a prompt. Skipping it with the switch
   * off would leave the corpus unexercised on every CI run, which is
   * how the built thing rots; asserting `undefined` sixty times would
   * be worse, because it would look like coverage.
   *
   * So with the switch ON this returns the block exactly as the model
   * reads it, rows included, and asserts on those bytes. With the
   * switch OFF it returns the block — which by then carries no
   * impression row, and 「the block carries none」 is pinned separately
   * in 「the switch」 below — followed by the rows `gateReportImpression`
   * answered with. Same gates, same labels, same zero rule; the only
   * thing the switch changes is whether they are in the prompt.
   */
  const renderedFor = async (
    ocrFields: Record<string, unknown>,
    mode: 'strict' | 'precise' = 'strict',
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const result = await searchFor(ocrFields, overrides);
    const chunk = result.chunks[0];
    const block = renderChunkForPrompt(chunk, {
      mode,
      logger: silentLogger as unknown as RetrieveContext['logger'],
    }).content;
    if (REPORT_IMPRESSION_CHANNEL_ENABLED) return block;
    const fields = chunk.metadata.fields as Record<string, unknown>;
    return [block, ...gatedRows(fields, mode)].join('\n');
  };

  const bothModes = async (
    ocrFields: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ): Promise<[string, string]> => [
    await renderedFor(ocrFields, 'strict', overrides),
    await renderedFor(ocrFields, 'precise', overrides),
  ];

  const IMPRESSION_LABEL = '报告原文结论（';
  const WITHHELD_LABEL = '报告原文结论未共享的原因（';

  /** Just the impression's VALUE. The label itself names the markers it
   *  can print, so an assertion over the whole block would find
   *  「[数值未共享]」 in the label of a report that had nothing masked. */
  const impressionValue = (rendered: string): string => {
    const line = rendered
      .split('\n')
      .find((l) => l.startsWith(IMPRESSION_LABEL) && !l.startsWith(WITHHELD_LABEL));
    if (!line) return '';
    return line.slice(line.indexOf('）: ') + 3);
  };

  it('carries the report own words, not this platform reading of them', async () => {
    // The whole change, in one assertion. The allowlist has had a slot
    // for the report's conclusion since PR #23; what filled it was a
    // vocabulary summary this PLATFORM composed, and six rounds of
    // review found the same family of defects in it. The report's own
    // sentence travels now.
    for (const rendered of await bothModes({
      classifiedType: 'muscle_mri',
      reportImpression: '以上改变，符合肌营养不良改变，请结合临床。',
    })) {
      expect(rendered).toContain(IMPRESSION_LABEL);
      expect(rendered).toContain('以上改变，符合肌营养不良改变，请结合临床。');
    }
  });

  it('offers the text top-level so the eligibility gate can read it', async () => {
    // The retriever's half of the contract: the text as printed, under
    // its own key, with nothing done to it. On neither allowlist — the
    // gated form is what reaches a prompt.
    const f = await fieldsFor({ reportImpression: '双侧大腿脂肪浸润。' });
    expect(f.reportImpressionAsPrinted).toBe('双侧大腿脂肪浸润。');
    expect(f.findings_summary).toBeUndefined();
  });

  it('says nothing at all when the report states no impression', async () => {
    // The one case with no marker: there is nothing to say was
    // withheld, because there was nothing.
    const rendered = await renderedFor({ classifiedType: 'muscle_mri' });
    expect(rendered).not.toContain(IMPRESSION_LABEL);
    expect(rendered).not.toContain(WITHHELD_LABEL);
  });

  describe('the switch — what the prompt carries, as opposed to what the gates answer', () => {
    /** The block the model reads, with nothing appended. */
    const blockFor = async (
      ocrFields: Record<string, unknown>,
      mode: 'strict' | 'precise',
      overrides: Record<string, unknown> = {},
    ): Promise<string> => {
      const result = await searchFor(ocrFields, overrides);
      return renderChunkForPrompt(result.chunks[0], {
        mode,
        logger: silentLogger as unknown as RetrieveContext['logger'],
      }).content;
    };

    it.each(['strict', 'precise'] as const)(
      'in %s mode, a published impression is in the block only while the switch is on',
      async (mode) => {
        const block = await blockFor(
          { classifiedType: 'muscle_mri', reportImpression: '双侧大腿后群肌肉脂肪浸润。' },
          mode,
        );
        if (REPORT_IMPRESSION_CHANNEL_ENABLED) {
          expect(block).toContain(IMPRESSION_LABEL);
          expect(block).toContain('双侧大腿后群肌肉脂肪浸润。');
        } else {
          expect(block).not.toContain(IMPRESSION_LABEL);
          expect(block).not.toContain('双侧大腿后群肌肉脂肪浸润。');
        }
      },
    );

    it.each(['strict', 'precise'] as const)(
      'in %s mode, a REFUSED impression leaves no marker either',
      async (mode) => {
        // The refusal is the case a marker exists for, so it is the one
        // most likely to survive a switch that only suppressed the text.
        const fields = {
          classifiedType: 'medical_summary',
          reportImpression: '双侧大腿肌肉脂肪浸润。',
        };
        const block = await blockFor(fields, mode, {
          ocr_payload: { fields, extractedText: '病历摘要\n主诉：双下肢无力3年' },
        });
        if (REPORT_IMPRESSION_CHANNEL_ENABLED) {
          expect(block).toContain(WITHHELD_LABEL);
        } else {
          expect(block).not.toContain(WITHHELD_LABEL);
          expect(block).not.toContain('报告原文结论');
        }
      },
    );

    it('still offers the raw text to the gates, so gate 0 is not weakened', async () => {
      // The retriever's contract does not change with the switch: it
      // finds the report's words and judges none of them. What changes
      // is whether the gated form is wired to a prompt.
      const f = await fieldsFor({
        classifiedType: 'muscle_mri',
        reportImpression: '双侧大腿脂肪浸润。',
      });
      expect(f.reportImpressionAsPrinted).toBe('双侧大腿脂肪浸润。');
      expect(gateReportImpression(f, { mode: 'strict' })?.text).toBe('双侧大腿脂肪浸润。');
    });
  });

  describe('gate 0 — which documents may send text at all', () => {
    const NARRATIVE =
      'impression_exists_but_this_document_is_a_clinical_narrative_about_a_person_not_a_test_result';
    const UNKNOWN = 'impression_exists_but_this_platform_cannot_tell_what_kind_of_document_this_is';

    const RESULT_DOCUMENTS: readonly [string, string, string][] = [
      ['an imaging report', 'muscle_mri', '双侧大腿后群肌肉脂肪浸润，肩胛带肌未见异常。'],
      ['a genetics report', 'genetic_report', '4q35 D4Z4 重复单元缩短，单倍型 4qA，符合 FSHD1。'],
      ['a laboratory panel', 'coagulation', '凝血功能大致正常。'],
      ['a pulmonary-function report', 'pulmonary_function', '提示限制性通气功能障碍。'],
      ['a cardiac report', 'ecg', '窦性心律，心律不齐。'],
    ];

    it.each(RESULT_DOCUMENTS)('%s sends its impression', async (_label, type, impression) => {
      for (const rendered of await bothModes(
        { classifiedType: type, reportImpression: impression },
        { classified_type: type },
      )) {
        expect(rendered).toContain(impression);
        expect(rendered).not.toContain(WITHHELD_LABEL);
      }
    });

    const NARRATIVE_DOCUMENTS: readonly [string, Record<string, unknown>, string][] = [
      [
        'a 病历摘要 whose page is stored',
        { classifiedType: 'medical_summary', reportImpression: '双侧大腿肌肉脂肪浸润。' },
        '病历摘要\n主诉：双下肢无力3年\n现病史：患者3年前出现进行性无力',
      ],
      [
        'a 出院小结',
        { classifiedType: 'medical_summary', reportImpression: '双侧大腿肌肉脂肪浸润。' },
        '出院小结\n入院诊断：面肩肱型肌营养不良\n出院医嘱：门诊随访',
      ],
      [
        'a 门诊病历 the classifier could not name',
        { classifiedType: 'other', reportImpression: '双侧大腿脂肪浸润。' },
        '门诊病历\n主诉：双下肢无力\n查体：双侧翼状肩胛',
      ],
      [
        'a 入院记录',
        { classifiedType: 'genetic_report', reportImpression: '双侧大腿脂肪浸润。' },
        '入院记录\n现病史：3年前起病\n既往史：无特殊',
      ],
    ];

    it.each(NARRATIVE_DOCUMENTS)('%s sends nothing but the marker', async (_l, fields, page) => {
      for (const rendered of await bothModes(fields, {
        ocr_payload: { fields, extractedText: page },
      })) {
        expect(rendered).toContain(WITHHELD_LABEL);
        expect(rendered).toContain(NARRATIVE);
        expect(rendered).not.toContain('脂肪浸润');
      }
    });

    it('reads the narrative markers inside the impression cell itself', async () => {
      // The gap the retriever's top-level carry closes.
      // `showsClinicalNarrative` searches the stored page plus an
      // allowlist of `fields` cells, and `reportImpression` is not one
      // of them — so a 出院小结 with no page kept showed the predicate
      // nothing, and the sentence that makes it a narrative was in the
      // one cell the predicate could not see.
      for (const rendered of await bothModes({
        classifiedType: 'medical_summary',
        reportImpression: '出院小结：患者双下肢无力，既往史无特殊，出院诊断 FSHD。',
      })) {
        expect(rendered).toContain(NARRATIVE);
        expect(rendered).not.toContain('双下肢无力');
      }
    });

    it('refuses a 病历摘要 that also shows a laboratory report structure', async () => {
      // Both structures on one document. The narrative question
      // outranks the laboratory one here for the same reason it does in
      // `isLaboratoryGeneticReport`: a 病历摘要 with the whole report
      // pasted into it is still a 病历摘要.
      const fields = {
        classifiedType: 'genetic_report',
        geneticTestMethod: 'Southern blot',
        reportImpression: 'D4Z4 重复单元数缩短，单倍型 4qA。',
      };
      for (const rendered of await bothModes(fields, {
        classified_type: 'genetic_report',
        document_type: 'genetic_report',
        ocr_payload: {
          fields,
          extractedText:
            '病历摘要\n主诉：双下肢无力3年\n基因检测报告\n检测方法：Southern blot\n检测结论：D4Z4 缩短',
        },
      })) {
        expect(rendered).toContain(NARRATIVE);
        expect(rendered).not.toContain('4qA');
      }
    });

    it('sends a result document whose page was never stored', async () => {
      for (const rendered of await bothModes(
        { classifiedType: 'genetic_report', reportImpression: '符合 FSHD1。' },
        { classified_type: 'genetic_report' },
      )) {
        expect(rendered).toContain('符合 FSHD1。');
      }
    });

    it('withholds when it cannot tell what kind of document this is', async () => {
      // Fail closed. An unparsed row carries the uploader's word and
      // nothing else, and `mri` is not a label the classifier can
      // produce — so this platform has not named this document.
      for (const rendered of await bothModes(
        { reportImpression: '双侧大腿脂肪浸润。' },
        { classified_type: null, document_type: 'mri' },
      )) {
        expect(rendered).toContain(UNKNOWN);
        expect(rendered).not.toContain('脂肪浸润');
      }
    });

    it('withholds on a document the classifier called `other`', async () => {
      for (const rendered of await bothModes(
        { classifiedType: 'other', reportImpression: '双侧大腿脂肪浸润。' },
        { classified_type: 'other', document_type: 'other' },
      )) {
        expect(rendered).toContain(UNKNOWN);
      }
    });
  });

  describe('gate 1 — identifiers, in both modes', () => {
    const imaging = (impression: string, extra: Record<string, unknown> = {}) => ({
      classifiedType: 'muscle_mri',
      reportImpression: impression,
      ...extra,
    });

    it('takes out a name inline, in both modes', async () => {
      // The exact shape the render.test.ts fence rejected when the
      // first attempt at this channel was written: a name in prose. It
      // is reached two ways — the label in front of it, and the cell
      // the same payload filed it under.
      for (const rendered of await bothModes(
        imaging('受检者张三，右大腿后群 STIR 信号显著增高，左大腿后群轻度增高。', {
          patientName: '张三',
        }),
      )) {
        expect(rendered).not.toContain('张三');
        expect(rendered).toContain('[人名未共享]');
        expect(rendered).toContain('右大腿后群 STIR 信号显著增高');
      }
    });

    it('takes out a name after every Chinese report label', async () => {
      for (const rendered of await bothModes(
        imaging('姓名：张三 患者李四 报告医师王五 审核医师赵六 技师钱七。双侧大腿脂肪浸润。'),
      )) {
        for (const name of ['张三', '李四', '王五', '赵六', '钱七']) {
          expect(rendered).not.toContain(name);
        }
        expect(rendered).toContain('双侧大腿脂肪浸润。');
      }
    });

    it('takes out a name in parentheses that the payload also filed', async () => {
      for (const rendered of await bothModes(
        imaging('（张三）双侧大腿脂肪浸润。', { patientName: '张三' }),
      )) {
        expect(rendered).not.toContain('张三');
      }
    });

    it('takes out a name split across an OCR line wrap', async () => {
      for (const rendered of await bothModes(
        imaging('姓名：张\n三，双侧大腿脂肪浸润。', { patientName: '张三' }),
      )) {
        expect(rendered).not.toMatch(/张\s*三/);
        expect(rendered).toContain('双侧大腿脂肪浸润。');
      }
    });

    it('takes out a name that is also an ordinary word, and says what that costs', async () => {
      // 高明 is a name and 增高明显 is a radiology phrase. Nobody
      // consented to identifiers, so this gate resolves its doubt
      // toward removal and the clause is garbled rather than the name
      // leaked. Pinned in both directions so the trade is visible.
      for (const rendered of await bothModes(
        imaging('双侧股四头肌信号增高明显。', { patientName: '高明' }),
      )) {
        expect(rendered).not.toContain('高明');
        expect(rendered).toContain('双侧股四头肌信号增[人名未共享]显。');
      }
    });

    it('takes out 住院号 and its siblings in every spelling', async () => {
      for (const rendered of await bothModes(
        imaging(
          '住院号:R000000 门诊号 12345 病案号：A99887 床号 12 标本号 B7788 送检号 SJ001。双侧大腿脂肪浸润。',
        ),
      )) {
        for (const value of ['R000000', '12345', 'A99887', 'B7788', 'SJ001']) {
          expect(rendered).not.toContain(value);
        }
        expect(rendered).toContain('双侧大腿脂肪浸润。');
      }
    });

    it('takes out id-card and phone numbers in every format', async () => {
      for (const rendered of await bothModes(
        imaging(
          '身份证 110101199003074512，联系电话 13812345678，座机 010-88886666。双侧大腿脂肪浸润。',
        ),
      )) {
        for (const value of ['110101199003074512', '13812345678', '010-88886666']) {
          expect(rendered).not.toContain(value);
        }
        expect(rendered).toContain('双侧大腿脂肪浸润。');
      }
    });

    it('takes out an address', async () => {
      for (const rendered of await bothModes(
        imaging('地址：北京市海淀区中关村大街1号。双侧大腿脂肪浸润。'),
      )) {
        expect(rendered).not.toContain('海淀');
        expect(rendered).not.toContain('中关村');
        expect(rendered).toContain('双侧大腿脂肪浸润。');
      }
    });

    it('takes out a date finer than a year, and keeps the sentence around it', async () => {
      for (const rendered of await bothModes(
        imaging('2019-03-14 复查，与 2018年5月20日 比较，双侧大腿脂肪浸润较前进展。'),
      )) {
        expect(rendered).not.toContain('03-14');
        expect(rendered).not.toContain('5月20日');
        expect(rendered).toContain('[日期未共享]');
        expect(rendered).toContain('双侧大腿脂肪浸润较前进展。');
      }
    });

    it('leaves a clean impression untouched in precise mode', async () => {
      const rendered = await renderedFor(
        imaging('双侧大腿后群肌肉脂肪浸润，肩胛带肌未见异常，请结合临床。'),
        'precise',
      );
      expect(impressionValue(rendered)).toBe(
        '双侧大腿后群肌肉脂肪浸润，肩胛带肌未见异常，请结合临床。',
      );
    });

    it('withholds the whole field when the scrub cannot make it safe', async () => {
      // FAIL CLOSED, and this is the shape that trips it: a
      // record-number label whose value is not a value. The scrub takes
      // a label WITH the characters after it, and 「住院号：无」 has none
      // it recognises — so the label is still standing when the
      // residual check re-asks the identifier question, and a string
      // this module cannot account for is not published at all.
      for (const rendered of await bothModes(imaging('住院号：无。双侧大腿脂肪浸润。'))) {
        expect(rendered).toContain(WITHHELD_LABEL);
        expect(rendered).toContain('impression_exists_but_identifiers_in_it_could_not_be_removed');
        expect(rendered).not.toContain('双侧大腿脂肪浸润。');
      }
    });

    it('takes out an age and a date of birth, in both modes', async () => {
      // This platform hard-deletes the birthday, keeps `patientAge` off
      // the safe-key list and states in the redactor that there is no
      // age band in either mode. An age printed inside an impression is
      // the same value arriving by another door.
      for (const rendered of await bothModes(
        imaging('年龄 43 岁，出生日期 1983-02-11。双侧大腿脂肪浸润。'),
      )) {
        expect(rendered).not.toContain('43');
        expect(rendered).not.toContain('1983');
        expect(rendered).toContain('双侧大腿脂肪浸润。');
      }
    });

    it('CANNOT take out an unlabelled name this document never filed', async () => {
      // THE LARGEST RESIDUAL RISK ON THIS CHANNEL, PINNED SO IT IS NOT
      // MISTAKEN FOR COVERED.
      //
      // 张三 in parentheses, with no 姓名 / 受检者 label in front of it
      // and no `patientName` cell on the payload, is two characters of
      // Chinese. No pattern tells them from any other two. This is why
      // gate 0 exists: on a narrative document, where a relative's or a
      // physician's name appears unlabelled as a matter of course,
      // nothing travels at all.
      //
      // Change the scrub so this passes and this test tells you; leave
      // it, and this test is the record that it was known.
      for (const rendered of await bothModes(imaging('（张三）双侧大腿脂肪浸润。'))) {
        expect(rendered).toContain('（张三）双侧大腿脂肪浸润。');
      }
    });

    it('CANNOT take out a name after 患者 whose surname is a rare one', async () => {
      // `CHINESE_SURNAMES` is the common hundred and cannot be
      // complete: after an ordinary NOUN rather than a dedicated label,
      // the surname is the only second witness there is.
      for (const rendered of await bothModes(imaging('患者郗小明，双侧大腿脂肪浸润。'))) {
        expect(rendered).toContain('患者郗小明');
      }
      // The same sentence with a common surname is taken.
      for (const rendered of await bothModes(imaging('患者李小明，双侧大腿脂肪浸润。'))) {
        expect(rendered).not.toContain('李小明');
      }
    });

    it('leaves an institution name standing, on purpose', async () => {
      // A hospital identifies a hospital. It is also what tells the
      // model an outside laboratory issued this report, which is a
      // clinically load-bearing fact on a referral.
      for (const rendered of await bothModes(imaging('北京协和医院会诊意见：双侧大腿脂肪浸润。'))) {
        expect(rendered).toContain('北京协和医院');
      }
    });

    it('reports how many identifiers it removed', async () => {
      const rendered = await renderedFor(imaging('姓名：张三 报告医师王五。双侧大腿脂肪浸润。'));
      expect(rendered).toContain('报告原文结论中被去除的身份信息处数: 2');
    });
  });

  describe('gate 2 — measurements, under strict consent only', () => {
    const imaging = (impression: string) => ({
      classifiedType: 'muscle_mri',
      reportImpression: impression,
    });

    it('masks a measurement in strict and prints it in precise', async () => {
      const source = '双侧大腿脂肪浸润约 60%，肩胛带肌未见异常。';
      expect(await renderedFor(imaging(source), 'strict')).toContain(
        '双侧大腿脂肪浸润约 [数值未共享]，肩胛带肌未见异常。',
      );
      expect(await renderedFor(imaging(source), 'precise')).toContain(source);
    });

    it('masks measurements of every shape', async () => {
      const strict = await renderedFor(
        imaging('CK 890 U/L，病程 18.5 年，滴度 1:8，重复数 3/22，范围 8-10，脂肪浸润 60%。'),
        'strict',
      );
      for (const value of ['890', '18.5', '1:8', '3/22', '8-10', '60%']) {
        expect(strict).not.toContain(value);
      }
      expect(strict).toContain('CK [数值未共享] U/L');
      expect(strict).toContain('报告原文结论中被遮蔽的数值个数: 6');
    });

    it('keeps the digits that are part of a NAME', async () => {
      // The direction that costs clinical meaning. 「T2 高信号」 with its
      // 2 masked is not a radiology finding any more.
      const source =
        'T1 等信号，T2 高信号，STIR 信号增高；4q35 D4Z4 缩短，单倍型 4qA/4qB，符合 FSHD1，除外 FSHD2；' +
        'C5-C6 椎间盘突出，L4 椎体；Ⅲ级肌力；10 号染色体未见异常。';
      for (const rendered of await bothModes(imaging(source))) {
        expect(impressionValue(rendered)).toBe(source);
      }
    });

    it('keeps a negation intact around the number it masks', async () => {
      expect(await renderedFor(imaging('未检出3个重复单元。'), 'strict')).toContain(
        '未检出[数值未共享]个重复单元。',
      );
      expect(await renderedFor(imaging('未检出3个重复单元。'), 'precise')).toContain(
        '未检出3个重复单元。',
      );
    });

    it('masks a value welded to an analyte this repo has no key for', async () => {
      // THE DOUBT RESOLVES TOWARD MASKING NOW. This test used to assert
      // the opposite — that `LDL2.6` reached the model under strict
      // consent because `ldl` is not on `OCR_FIELDS_SAFE_KEYS_PRECISE`
      // and the token therefore 「read as a name」. That rule made the
      // absence of a key into a licence to publish a measurement to the
      // patient who withheld 「精确数值」, and it is inverted in
      // `maskMeasurements`: a token carrying a digit is a measurement
      // unless it is POSITIVELY recognised as a name.
      expect(await renderedFor(imaging('CK890 U/L。'), 'strict')).toContain('[数值未共享] U/L');
      expect(await renderedFor(imaging('LDL2.6 mmol/L。'), 'strict')).not.toContain('LDL2.6');
    });

    it('does not report a masked-value count under precise consent', async () => {
      const rendered = await renderedFor(imaging('脂肪浸润约 60%。'), 'precise');
      expect(rendered).not.toContain('被遮蔽的数值个数');
    });
  });

  describe('the cap', () => {
    it('says how much it cut rather than cutting silently', async () => {
      const long = '双侧大腿后群肌肉脂肪浸润伴轻度水肿。'.repeat(12);
      for (const rendered of await bothModes({
        classifiedType: 'muscle_mri',
        reportImpression: long,
      })) {
        expect(rendered).toContain('[后续未列出]');
        expect(rendered).toContain('报告原文结论因超长被截断的字数: 16');
      }
    });
  });

  /**
   * THE CORPUS THE DELETED EXTRACTOR WAS PINNED AGAINST.
   *
   * Every Chinese sentence the extractor's tests carried, kept, and
   * turned into an assertion on the new behaviour. Six rounds of review
   * built this list one defect at a time: a finding the report RULED
   * OUT emitted as present, a hedged finding rendered as definite, a
   * relative's diagnosis rendered as the patient's own, a resolved
   * finding rendered as current, a prior study's finding rendered as
   * this one's, two severities swapped by position, an enumerated
   * negative half-suppressed by a 、.
   *
   * WHAT THEY ASSERT NOW IS THAT THE SENTENCE ARRIVES. Every one of
   * these reaches the model byte-for-byte, in BOTH modes — which is why
   * the negation, the hedge, the attribution, the tense, the severity
   * and the enumeration all survive: nothing is reading them any more.
   * They carry no measurement, so strict mode changes none of them; the
   * digits they do carry (4qA, D4Z4, FSHD1) are names, and gate 2
   * keeping them is asserted here on every line that has one.
   *
   * They fail two ways on purpose. Anything that starts transforming
   * this text fails them, and so does anything that stops sending it.
   */
  describe('the corpus', () => {
    const CORPUS: readonly string[] = [
      '以上改变，符合肌营养不良改变，请结合临床。',
      '符合肌营养不良改变',
      '检出 4qA 单倍型，D4Z4 重复单元缩短，符合 FSHD1。',
      '采用4qA/4qB探针进行D4Z4重复单元缩短检测',
      '外院基因检测提示FSHD1，4qA，D4Z4重复单元缩短',
      '双侧大腿肌群未见明显脂肪浸润，未见肌肉萎缩。',
      '排除 FSHD1，未检出 D4Z4 重复单元缩短。',
      '双侧大腿见脂肪浸润，未见肌肉萎缩。',
      '右侧腓肠肌脂肪浸润；左侧胫骨前肌炎性改变；未见明显水肿。',
      '双侧股四头肌未受累，肩胛带肌未见异常',
      '大腿后群脂肪浸润不明显',
      '腓肠肌未累及；胫前肌未及肌肉萎缩',
      '水肿阴性 信号增高正常',
      '非对称 无水肿',
      '左侧无水肿而右侧水肿明显',
      '双侧大腿脂肪浸润明显 未见肌肉萎缩',
      '右侧腓肠肌炎性改变　未见水肿',
      '右侧腓肠肌炎性改变\t未见水肿',
      '未见脂肪浸润 右侧脂肪浸润明显',
      '患者母亲确诊肌营养不良，本人双侧大腿未见脂肪浸润。',
      '家族史：父亲有肌肉萎缩；本次检查未见明显异常。',
      '既往水肿，现已吸收。',
      '双侧大腿水肿已基本吸收',
      '前次报告示脂肪浸润，本次复查未见脂肪浸润。',
      '原有资料示脂肪浸润，本次未见脂肪浸润。',
      '原发性肌营养不良改变',
      '外院MRI示肌营养不良改变，本院复查大致正常。',
      '脂肪浸润待排',
      '双侧大腿脂肪浸润明显',
      '可疑炎性改变，建议随访。',
      '不除外肌营养不良改变',
      '双侧大腿肌群改变不考虑肌营养不良',
      '暂不考虑炎性改变',
      '未考虑肌营养不良改变',
      '脂肪浸润可能性不大',
      '双侧大腿脂肪浸润明显；炎性改变可能性极小。',
      '不倾向于炎性改变',
      '不可能为肌营养不良改变',
      '考虑肌营养不良改变',
      '未除外水肿',
      '倾向于脂肪浸润',
      '排除 FSHD1，未检出 D4Z4 重复单元缩短',
      '没有脂肪浸润及肌肉萎缩',
      '未出现脂肪浸润或肌肉萎缩',
      '没有水肿但双侧大腿肌群脂肪浸润明显',
      '双侧大腿脂肪浸润明显伴可疑炎性改变',
      '考虑双侧大腿肌营养不良改变',
      '可疑重度脂肪浸润',
      '脂肪浸润明显待排',
      '双侧大腿脂肪浸润轻度；肩胛带肌肉萎缩重度。',
      '弥漫性脂肪浸润；局灶性水肿。',
      '病变程度重度。',
      '肩胛带肌重度萎缩，余大致正常。',
      '双侧大腿肌群大致正常。',
      '肩胛带肌未萎缩 大腿萎缩不明显',
      '甲基化水平中度降低。',
      'D4Z4 Methylation 轻度降低',
      '甲基化水平中度降低；双侧大腿重度脂肪浸润。',
      '双侧大腿肌群未见\n明显脂肪浸润',
      '双侧大腿肌群未\n见明显脂肪浸润',
      '其母\n确诊肌营养不良',
      '既往\n水肿，现已吸收',
      '甲基化\n水平中度降低',
      '原\n发性肌营养不良改变',
      '原\n有资料示脂肪浸润',
      '基因检测阴性 双侧大腿脂肪浸润',
      '腓肠肌未累及 双侧大腿重度脂肪浸润',
      '大腿萎缩不明显 肩胛带肌重度萎缩',
      '双侧大腿肌群没有明显\n脂肪浸润',
      '双侧大腿脂肪浸润明显\n不伴\n水肿',
      '双侧大腿肌群未受累 双侧肩胛带肌脂肪浸润',
      '左侧无水肿而右侧 水肿明显',
      '肌营养不良改变 双侧大腿脂肪浸润',
      '心律不齐 双侧大腿脂肪浸润',
      '双侧大腿肌群不同程度 脂肪浸润',
      '其兄确诊肌营养不良，本人双侧大腿未见脂肪浸润。',
      '双侧大腿水肿已消失',
      '双侧大腿水肿明显缓解',
      '心律不齐已纠正',
      '双侧大腿水肿明显',
      '肩胛带重度肌肉萎缩',
      '重度肌萎缩',
      '重度限制性通气功能障碍',
      '肌营养不良改变重度',
      '弥漫性肌营养不良改变',
      '右侧轻度脂肪浸润；左侧重度脂肪浸润。',
      '肩胛带重度肌肉萎缩；大腿重度肌肉萎缩。',
      '右侧轻度脂肪浸润伴左侧重度脂肪浸润',
      '肩胛带肌重度萎缩伴大腿轻度萎缩',
      '右侧重度脂肪浸润伴左侧重度脂肪浸润',
      '肌营养不良；双侧大腿肌营养不良改变。',
      '肩胛带萎缩；大腿肌肉萎缩。',
      '双侧大腿肌营养不良改变；肌营养不良。',
      '肌营养不良；重度水肿；肌营养不良改变。',
      '肌营养不良；重度肌营养不良改变。',
      '肌营养不良；可疑肌营养不良改变。',
      '双侧大腿水肿伴脂肪浸润',
      '肩胛带肌重度萎缩伴轻度脂肪浸润',
      '双侧大腿脂肪浸润；肩胛带肌肉萎缩。',
      '射血分数降低',
      '射血分数升高',
      '射血分数轻度降低',
      '弥散功能中度下降',
      '射血分数明显下降',
      '膈肌运动度正常范围',
      '膈肌形态可',
      '射血分数正常',
      '射血分数未降低',
      '射血分数降低待排',
      '射血分数可能降低',
      '弥散功能可疑减退',
      '双侧膈肌抬高',
      '膈肌运动受限',
      '心律不齐',
    ];

    it.each(CORPUS)('reaches the model as printed: %s', async (impression) => {
      const [strict, precise] = await bothModes({
        classifiedType: 'muscle_mri',
        reportImpression: impression,
      });
      expect(precise).toContain(impression);
      expect(strict).toContain(impression);
    });

    /**
     * The morphemes six rounds of review were spent on. Each is a word
     * whose loss inverted, hardened, re-attributed or resurrected a
     * finding; each is asserted present in the rendered bytes wherever
     * the source sentence carries it.
     */
    const LOAD_BEARING: readonly string[] = [
      '未见',
      '未受累',
      '未累及',
      '未及',
      '未出现',
      '未检出',
      '未萎缩',
      '未考虑',
      '没有',
      '无水肿',
      '不明显',
      '不伴',
      '不同程度',
      '非对称',
      '排除',
      '除外',
      '不除外',
      '未除外',
      '不考虑',
      '暂不考虑',
      '可能性不大',
      '可能性极小',
      '不倾向于',
      '不可能',
      '待排',
      '可疑',
      '疑似',
      '考虑',
      '可能',
      '倾向于',
      '建议随访',
      '其母',
      '其兄',
      '母亲',
      '父亲',
      '家族史',
      '既往',
      '前次',
      '上次',
      '外院',
      '原有',
      '原发',
      '已基本吸收',
      '已消失',
      '明显缓解',
      '已纠正',
      '阴性',
      '正常',
      '轻度',
      '中度',
      '重度',
      '弥漫性',
      '局灶性',
      '甲基化',
    ];

    it.each(CORPUS)('keeps every load-bearing morpheme in: %s', async (impression) => {
      const [strict, precise] = await bothModes({
        classifiedType: 'muscle_mri',
        reportImpression: impression,
      });
      const carried = LOAD_BEARING.filter((word) => impression.includes(word));
      for (const word of carried) {
        expect(precise).toContain(word);
        expect(strict).toContain(word);
      }
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
    // Was: 「基因检测报告 · 2026-08」 — the upload month printed where a
    // patient reads the date of the result. See the chip fence below.
    expect(result.citations[0].sourceFile).toBe('基因检测报告 · 上传 2026-08');
  });

  /**
   * THE CHIP MUST NOT CLAIM A REPORT DATE THIS PLATFORM DOES NOT HAVE.
   *
   * `resolveReportDate` returns `fromReport` so the caller can label the
   * upload fallback honestly, and `reportDateLabel` dropped the flag and
   * joined the value straight onto the report-type label. The prompt
   * side of this same row already refuses the claim — `uploadDate`
   * renders as 上传年份 and never as 报告年份 — so in one turn the
   * assistant said 上传年份 and the 依据 chip beside its answer asserted
   * a report date anyway.
   */
  describe('the 依据 chip states which date it is showing', () => {
    it('marks the upload fallback and leaves the laboratory date bare', async () => {
      const uploaded = await searchWith({ classifiedType: 'genetic_report' });
      const reported = await searchWith({
        classifiedType: 'genetic_report',
        reportTime: '2019-03-14',
      });
      expect(uploaded.citations[0].sourceFile).toBe('基因检测报告 · 上传 2026-08');
      expect(reported.citations[0].sourceFile).toBe('基因检测报告 · 2019-03');
      // The two origins are distinguishable, which is the whole point.
      expect(uploaded.citations[0].sourceFile).not.toBe(reported.citations[0].sourceFile);
    });

    it('agrees with the prompt line rendered from the same row', async () => {
      // 报告年份 and 上传年份 are two cells (see allowlist.ts); the chip
      // must not answer 报告 where the prompt answers 上传.
      const uploaded = await searchWith({ classifiedType: 'genetic_report' });
      const f = uploaded.chunks[0].metadata.fields as Record<string, unknown>;
      expect(f.reportDate).toBeUndefined();
      expect(uploaded.citations[0].sourceFile).toContain('上传');

      const reported = await searchWith({
        classifiedType: 'genetic_report',
        report_time: '2019-03-14',
      });
      const g = reported.chunks[0].metadata.fields as Record<string, unknown>;
      expect(g.reportDate).toBe('2019-03-14T00:00:00.000Z');
      expect(reported.citations[0].sourceFile).not.toContain('上传');
    });
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

/**
 * THE EXCLUSION FAMILY, EVERY SPELLING, THROUGH THE RENDERER.
 *
 * 除外 / 排除 flip meaning on what is written in front of them, and the
 * three places that had to agree about which prefixes flip them —
 * EXCLUSION_PATTERN's lookbehind, HEDGE_MARKERS' literals and
 * NEGATION_ROOT_HEDGING — were three hand-kept copies of one set. They
 * disagreed in both directions, and both directions reached the model:
 *
 *   「未能排除脂肪浸润」     → 「影像/报告印象: 脂肪浸润」, byte-identical
 *                            to a definite finding. Exempted by the
 *                            lookbehind, missing from the literals.
 *   「不能完全排除脂肪浸润」 → no 影像/报告印象 line at all. This is how
 *   「不能完全除外脂肪浸润」    a Chinese radiologist writes 「cannot be
 *   「不可除外脂肪浸润」        fully excluded」 — a finding kept ON the
 *   「无法除外脂肪浸润」        table — and one word between the negation
 *   「脂肪浸润待除外」          and the verb put it outside all three.
 *
 * The three are derived from EXCLUSION_HEDGE_PREFIXES now, so this
 * table is the fence on the derivation rather than on any one list: a
 * prefix added there has to produce a hedged line here, and a prefix
 * NOT there has to keep producing no line at all.
 */
/**
 * 除外 / 排除 — THE FAMILY THE EXTRACTOR SPLIT FOUR WAYS.
 *
 * The negated spellings are hedges (「I cannot rule this out」) and the
 * bare verb is a rule-out, and the extractor kept three hand-written
 * copies of that set which disagreed with each other in both
 * directions: 未能排除 reached the model with no hedge at all, 不可除外
 * was killed by a lookbehind one copy knew and another did not, and
 * 不能完全排除 was known to none of them.
 *
 * Every spelling is kept here, and the assertion is that the report's
 * own wording arrives — which is what makes the distinction the three
 * copies existed to draw a distinction the MODEL now draws, off the
 * words the radiologist actually wrote.
 */
describe('除外 / 排除 — negated is a hedge, bare is a rule-out', () => {
  const renderedFor = async (impression: string, mode: 'strict' | 'precise'): Promise<string> => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'doc-1',
            document_type: 'mri',
            title: null,
            uploaded_at: '2026-07-30T00:00:00.000Z',
            status: 'parsed',
            ocr_payload: {
              fields: { classifiedType: 'muscle_mri', reportImpression: impression },
            },
            classified_type: 'muscle_mri',
          },
        ],
        rowCount: 1,
      }),
    } as unknown as Pool;
    const result = await new PatientReportsRetriever(pool).search(
      { question: '' },
      {
        userId: 'u1',
        consentLevel: 'precise',
        logger: silentLogger as unknown as RetrieveContext['logger'],
      },
    );
    const chunk = result.chunks[0];
    const block = renderChunkForPrompt(chunk, {
      mode,
      logger: silentLogger as unknown as RetrieveContext['logger'],
    }).content;
    // The channel is behind a switch, default off. This table is the
    // fence on the derivation of EXCLUSION_HEDGE_PREFIXES and it has to
    // keep running either way — see the note on `renderedFor` in
    // 「the report own impression」 above for why, and for what this
    // returns in each position of the switch.
    if (REPORT_IMPRESSION_CHANNEL_ENABLED) return block;
    const gated = gateReportImpression(chunk.metadata.fields as Record<string, unknown>, { mode });
    return gated?.text === null || gated === null ? block : `${block}\n${gated.text}`;
  };

  // Every negated spelling, with the word that makes it equivocal.
  it.each([
    ['不除外脂肪浸润。', '不除外'],
    ['未除外脂肪浸润。', '未除外'],
    ['不排除脂肪浸润。', '不排除'],
    ['未排除脂肪浸润。', '未排除'],
    ['不能除外脂肪浸润。', '不能除外'],
    ['不能排除脂肪浸润。', '不能排除'],
    ['未能除外脂肪浸润。', '未能除外'],
    ['未能排除脂肪浸润。', '未能排除'],
    ['不可除外脂肪浸润。', '不可除外'],
    ['不可排除脂肪浸润。', '不可排除'],
    ['无法除外脂肪浸润。', '无法除外'],
    ['无法排除脂肪浸润。', '无法排除'],
    ['不完全排除脂肪浸润。', '不完全排除'],
    ['不能完全除外脂肪浸润。', '不能完全除外'],
    ['不能完全排除脂肪浸润。', '不能完全排除'],
    ['未能完全排除脂肪浸润。', '未能完全排除'],
    ['待除外脂肪浸润。', '待除外'],
    ['脂肪浸润待除外。', '待除外'],
    ['脂肪浸润待排除。', '待排除'],
    ['脂肪浸润待排。', '待排'],
    ['双侧大腿肌群改变，不能完全排除脂肪浸润。', '不能完全排除'],
  ])('keeps %s on the table, with its hedge', async (impression, hedge) => {
    for (const mode of ['strict', 'precise'] as const) {
      const rendered = await renderedFor(impression, mode);
      expect(rendered).toContain(impression);
      expect(rendered).toContain(hedge);
      expect(rendered).toContain('脂肪浸润');
    }
  });

  // The bare verb really is a rule-out, and 已 / 可 / 基本 in front of
  // it do not negate it. The finding and the verb both arrive; nothing
  // here reads either.
  it.each([
    '除外脂肪浸润。',
    '排除脂肪浸润。',
    '基本除外脂肪浸润。',
    '已除外脂肪浸润。',
    '可除外脂肪浸润。',
  ])('sends the rule-out %s with its verb attached', async (impression) => {
    for (const mode of ['strict', 'precise'] as const) {
      const rendered = await renderedFor(impression, mode);
      expect(rendered).toContain(impression);
    }
  });
});
