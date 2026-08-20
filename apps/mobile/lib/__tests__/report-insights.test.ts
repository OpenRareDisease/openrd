import {
  buildReportInsights,
  getSystemPanelHeroMetrics,
  getSystemPanelSectionTabs,
  type SystemInsightPanel,
} from '../report-insights';

const buildBloodPanel = (sections: SystemInsightPanel['sections']): SystemInsightPanel => ({
  key: 'blood',
  title: '实验室检查',
  summary: 'summary',
  latestDate: '2026-03-31',
  metrics: sections.flatMap((section) => section.metrics),
  state: 'updated',
  stateLabel: '已覆盖',
  coverage: ['肌酶', '血常规'],
  sourceCount: 2,
  sections,
});

describe('report insights blood section tabs', () => {
  it('keeps an all subtab when multiple blood sections are visible so users can return to the combined view', () => {
    const panel = buildBloodPanel([
      {
        key: 'fshd_core',
        title: '肌损伤',
        priority: 'core',
        groupKey: 'fshd_related',
        metrics: [{ label: 'CK', value: '100' }],
      },
      {
        key: 'blood_routine',
        title: '血常规',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'WBC', value: '5.2' }],
      },
    ]);

    expect(getSystemPanelSectionTabs(panel, 'all')).toEqual([
      { key: 'all', label: '全部' },
      { key: 'fshd_core', label: '肌损伤' },
      { key: 'blood_routine', label: '血常规' },
    ]);
  });

  it('keeps FSHD subcategory chips visible even when only one child section has data', () => {
    const panel = buildBloodPanel([
      {
        key: 'fshd_core',
        title: '肌损伤',
        priority: 'core',
        groupKey: 'fshd_related',
        metrics: [{ label: 'CK', value: '100' }],
      },
      {
        key: 'metabolic',
        title: '代谢/肾功能',
        priority: 'secondary',
        groupKey: 'fshd_related',
        metrics: [],
      },
      {
        key: 'blood_routine',
        title: '血常规',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'WBC', value: '5.2' }],
      },
    ]);

    expect(getSystemPanelSectionTabs(panel, 'group:fshd_related')).toEqual([
      { key: 'fshd_core', label: '肌损伤' },
    ]);
  });

  it('limits hero metrics to the selected FSHD subcategory', () => {
    const panel = buildBloodPanel([
      {
        key: 'fshd_core',
        title: '肌损伤',
        priority: 'core',
        groupKey: 'fshd_related',
        metrics: [
          { label: 'CK', value: '100' },
          { label: 'Mb', value: '80' },
        ],
      },
      {
        key: 'blood_routine',
        title: '血常规',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'WBC', value: '5.2' }],
      },
    ]);

    expect(getSystemPanelHeroMetrics(panel, 'all', 'fshd_core')).toEqual([
      { label: 'CK', value: '100' },
      { label: 'Mb', value: '80' },
    ]);
  });

  it('does not promote non-FSHD metrics into the all-view hero area when no core section exists', () => {
    const panel = buildBloodPanel([
      {
        key: 'blood_routine',
        title: '血常规',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'WBC', value: '5.2' }],
      },
      {
        key: 'thyroid_function',
        title: '甲功',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'FT3', value: '6' }],
      },
    ]);

    expect(getSystemPanelHeroMetrics(panel, 'all', 'all')).toEqual([]);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════
 * 化验室自己标的异常，和它自己印的参考区间。
 * ══════════════════════════════════════════════════════════════════════
 *
 * `ReportInsightMetric` was `{ label, value, date }`, so the flag and
 * the interval the payload had been carrying for two rounds had nowhere
 * to land: 报告详情, 我的档案 and 病程 all rendered a CK at 2.2× its
 * stated upper limit in the same words and the same weight as a normal
 * one, while 临床护照 — one tap away, built by the API off the same
 * payload — printed the bracket.
 *
 * WHAT THIS SURFACE SHOWS AND WHY. The reader is the PATIENT. On this
 * disease an out-of-range CK is the ordinary finding, so a screen that
 * escalates every flagged row teaches fear of a baseline; one that hides
 * the flag leaves the patient unable to see what a clinician will react
 * to. So: exactly what the laboratory printed, in its own register
 * (偏高 / 偏低 / 异常) and its interval verbatim, and nothing this
 * platform derived. The interval prints WITHOUT a flag too — that is
 * the case where a patient gains most, because they can see for
 * themselves that the number is inside it.
 *
 * SYNTHETIC. Payloads shaped like the ones the API bridge writes; no
 * real report was read.
 */
describe('化验数值带上报告自己写的标记和区间', () => {
  const labReport = (fields: Record<string, unknown>) => ({
    id: 'doc-lab',
    documentType: 'muscle_enzyme',
    status: 'parsed',
    uploadedAt: '2026-03-05T00:00:00.000Z',
    ocrPayload: { fields: { reportTime: '2026-03-04', ...fields } },
  });

  const insights = (fields: Record<string, unknown>) =>
    buildReportInsights([labReport(fields)] as never, null);

  const metric = (fields: Record<string, unknown>, label: string) =>
    insights(fields)
      .systemPanels.flatMap((panel) => panel.sections)
      .flatMap((section) => section.metrics)
      .find((item) => item.label === label);

  it('印出偏高和参考区间，并把两半也留成可读的字段', () => {
    expect(metric({ ck: '693U/L', ckFlag: 'high', ckReference: '50-310' }, 'CK')).toEqual({
      label: 'CK',
      value: '693U/L（偏高，参考区间 50-310）',
      flag: 'high',
      reference: '50-310',
      date: '2026-03-04',
    });
  });

  it('只有标记没有区间时也照说', () => {
    expect(metric({ ck: '693U/L', ckFlag: 'high' }, 'CK')?.value).toBe('693U/L（偏高）');
  });

  it('只有区间没有标记时印出区间 —— 这是患者能自己核对的那一格', () => {
    expect(metric({ ck: '120U/L', ckReference: '50-310' }, 'CK')?.value).toBe(
      '120U/L（参考区间 50-310）',
    );
  });

  it('两样都没有的行和以前一模一样', () => {
    const item = metric({ ck: '120U/L' }, 'CK');
    expect(item?.value).toBe('120U/L');
    expect(item?.flag).toBeNull();
    expect(item?.reference).toBeNull();
  });

  it('读不懂的标记不印 —— 不替化验室改写它的判断', () => {
    expect(metric({ ck: '693U/L', ckFlag: 'critically_elevated' }, 'CK')?.value).toBe('693U/L');
  });

  /** The archive: `creatineKinase` is a value-only twin the API bridge
   *  minted for the whole life of this deployment, and it is the head of
   *  this list, so the marker has to be recovered from the parser's own
   *  spelling. Nothing reparses those documents. */
  it('归档载荷：值在 creatineKinase 上、标记在 ckFlag 上，也要印出来', () => {
    expect(
      metric(
        { ck: '693U/L', ckFlag: 'high', ckReference: '50-310', creatineKinase: '693U/L' },
        'CK',
      )?.value,
    ).toBe('693U/L（偏高，参考区间 50-310）');
  });

  it('两个拼写的数不一样时不跨拼写取标记', () => {
    expect(metric({ ck: '693U/L', ckFlag: 'high', creatineKinase: '96U/L' }, 'CK')?.value).toBe(
      '96U/L',
    );
  });

  it('病程的血检摘要也带上括号 —— 它和护照读的是同一份载荷', () => {
    expect(insights({ ck: '693U/L', ckFlag: 'high', ckReference: '50-310' }).bloodSummary).toBe(
      'CK 693U/L（偏高，参考区间 50-310）',
    );
  });
});

/**
 * 通气模式 IS A WIRE TOKEN AND WAS REACHING THE PATIENT AS ONE.
 *
 * `cardio_respiratory_panel.ventilatory_pattern` is `restrictive` — a
 * value this platform minted, not anything a Chinese 肺功能报告 prints.
 * It surfaced as the 通气模式 metric on 报告详情 and on 临床护照, and
 * inside `respiratorySummary`, which read 「restrictive / 61% / 74%」 on
 * 病程. The API's passport has localised it since it was written.
 */
describe('通气模式 用中文印给患者', () => {
  const pft = (fields: Record<string, unknown>) => ({
    id: 'doc-pft',
    documentType: 'pulmonary_function',
    status: 'parsed',
    uploadedAt: '2026-03-07T00:00:00.000Z',
    ocrPayload: { fields: { reportTime: '2026-03-06', ...fields } },
  });

  it('把 restrictive 印成限制性通气功能障碍', () => {
    const out = buildReportInsights([pft({ ventilatoryPattern: 'restrictive' })] as never, null);
    const item = out.systemPanels
      .flatMap((panel) => panel.sections)
      .flatMap((section) => section.metrics)
      .find((metric) => metric.label === '通气模式');
    expect(item?.value).toBe('限制性通气功能障碍');
    expect(out.respiratorySummary).toContain('限制性通气功能障碍');
    expect(out.respiratorySummary).not.toContain('restrictive');
  });

  /** An unknown pattern falls through to the report's own reading rather
   *  than being dropped: a blank row is a worse answer than an
   *  untranslated one. */
  it('读不懂的模式原样保留，而不是空掉这一行', () => {
    const out = buildReportInsights(
      [pft({ ventilatoryPattern: 'small_airway_disease' })] as never,
      null,
    );
    expect(out.respiratorySummary).toContain('small_airway_disease');
  });
});

describe('诊断与分型 面板不把档案里的分型说成报告读出来的', () => {
  // The panel prints its summary directly under `latestDate`, which is
  // the genetic report's upload date. `geneticType` falls back to
  // `profile.geneticMutation` — free text the patient maintains — so
  // without a marker that fallback reads as a value the report carried.
  const geneticReport = (fields: Record<string, unknown>) => ({
    id: 'doc-genetic',
    documentType: 'genetic_report',
    status: 'parsed',
    uploadedAt: '2026-03-01T00:00:00.000Z',
    ocrPayload: { fields },
  });

  const diagnosisPanel = (docs: unknown[], profile: unknown) =>
    buildReportInsights(docs as never, profile as never).diagnosisPanel;

  it('marks a 分型 that came from the profile column', () => {
    const panel = diagnosisPanel([geneticReport({ d4z4Repeats: '4' })], {
      geneticMutation: '我猜是 FSHD1',
    });
    expect(panel?.summary).toContain('我猜是 FSHD1');
    expect(panel?.summary).toContain('不是从这份文件里读出来的');
  });

  it('does not mark a 分型 the report itself carried', () => {
    const panel = diagnosisPanel([geneticReport({ diagnosisType: 'FSHD1', d4z4Repeats: '4' })], {
      geneticMutation: '我猜是 FSHD2',
    });
    expect(panel?.summary).toContain('FSHD1');
    expect(panel?.summary).not.toContain('FSHD2');
    expect(panel?.summary).not.toContain('不是从这份文件里读出来的');
  });

  /**
   * A 病历摘要 IS NOT A LABORATORY, AND THE PANEL HAS TO SAY SO.
   *
   * `pickGeneticEvidenceDocument` takes a clinic's summary quoting a
   * repeat count when the genetics report read out nothing, on purpose:
   * for some patients it is the only copy of the number in existence.
   * 检查结果 then printed 分型 / D4Z4 / 单倍型 / 甲基化 in the same panel,
   * under the same title and the same date line, that a laboratory's
   * numbers get — with nothing on the tab saying a clinic had written
   * the page. 临床护照, one tap away, brackets each value with
   * 「转录自非基因报告文件」.
   */
  const medicalRecord = (fields: Record<string, unknown>) => ({
    id: 'doc-summary',
    documentType: 'medical_record',
    status: 'parsed',
    uploadedAt: '2026-03-01T00:00:00.000Z',
    ocrPayload: { fields: { classifiedType: 'medical_record', ...fields } },
  });

  it('转录来的基因值印在面板上时，面板说明它是从哪种文件上读到的', () => {
    const panel = diagnosisPanel(
      [medicalRecord({ diagnosisType: 'FSHD1', d4z4Repeats: '3', haplotype: '4qA' })],
      null,
    );

    // The values still print — dropping them loses the patient's only
    // copy of the number.
    expect(panel?.summary).toContain('FSHD1');
    expect(panel?.metrics.map((metric) => metric.value)).toContain('3');
    // And the panel says whose page they are on, in the API's phrase.
    expect(panel?.summary).toContain('转录自非基因报告文件');
    expect(panel?.summary).toContain('不是实验室出的结论');
  });

  it('实验室自己的报告不带那句话', () => {
    const panel = diagnosisPanel(
      [
        geneticReport({
          classifiedType: 'genetic_report',
          // The uploader's declaration the OCR provider stamps beside the
          // classification, which is what the laboratory gate reads last.
          documentType: 'genetic_report',
          diagnosisType: 'FSHD1',
          d4z4Repeats: '3',
        }),
      ],
      null,
    );
    expect(panel?.summary).toContain('FSHD1');
    expect(panel?.summary).not.toContain('转录自非基因报告文件');
  });

  /**
   * THE NOTE MAY NOT BE THE PART THAT GETS CUT.
   *
   * The summary is truncated at 88 characters. Both notes used to be
   * concatenated onto the joined values BEFORE that cut, so the profiles
   * that carry the most values — the ones whose panel looks most like a
   * laboratory's — were the ones whose caveat disappeared.
   */
  it('值多到要截断时，被截断的是值，不是那句来源说明', () => {
    const panel = diagnosisPanel(
      [
        medicalRecord({
          diagnosisType:
            '面肩肱型肌营养不良症 1 型（临床表现结合基因结果，门诊病历上原样抄下来的一长串描述，连同当时的送检医院一起）',
          d4z4Repeats: '3 个重复单元（EcoRI/BlnI 双酶切）',
          haplotype: '4qA161 permissive',
        }),
      ],
      null,
    );

    expect(panel?.summary).toContain('...');
    expect(panel?.summary).toContain('转录自非基因报告文件');
  });
});

/**
 * WHICH DOCUMENT THE GENETIC VALUES COME OFF.
 *
 * `buildReportInsights` used to answer this itself — newest document
 * typed `genetic_report`, else newest document carrying any genetic
 * key — and 我的档案 prints its answer ahead of the clinical passport's.
 * The API answers it in one place now, and this reader is on that
 * answer; the cases below are the API's own, restated against the
 * surface a patient actually reads, because a rule agreed with in a
 * comment is the arrangement that produced the drift.
 *
 * Every status the pipeline can leave on a row appears here, because
 * the status is half the rule: a report whose parse has not come back
 * has said nothing, and its silence is not a measurement.
 */
describe('基因数值只从一份文档上读，而且是同一份', () => {
  const doc = (over: Record<string, unknown>) => ({
    id: 'doc',
    documentType: 'genetic_report',
    status: 'parsed',
    uploadedAt: '2020-01-01T00:00:00.000Z',
    ocrPayload: null,
    ...over,
  });

  const insights = (docs: unknown[]) => buildReportInsights(docs as never);

  const RICH_OLD = doc({
    id: 'lab-rich-old',
    uploadedAt: '2019-05-01T00:00:00.000Z',
    ocrPayload: {
      fields: {
        diagnosisType: 'FSHD1',
        d4z4Repeats: '4',
        haplotype: '4qA',
        methylationValue: '8%',
      },
    },
  });

  it.each([
    ['processing', 'processing', null],
    ['parse_failed', 'parse_failed', null],
    ['uploaded 且没有任何 payload', 'uploaded', null],
  ])('更新的一份 %s：不许它把已经读出来的值清空', (_name, status, ocrPayload) => {
    // The row sits empty for as long as the parse takes, a raise
    // leaves it in parse_failed for good, and on a date order both of
    // those outranked the report that had actually parsed — so the
    // patient's own numbers left the page while they were doing the
    // one thing the app asks of them.
    const result = insights([
      RICH_OLD,
      doc({ id: 'lab-new-silent', status, ocrPayload, uploadedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(result.d4z4Repeats).toBe('4');
    expect(result.geneticType).toBe('FSHD1');
  });

  it('更新但更薄的一份：它对重复数的沉默不是一次测量', () => {
    const result = insights([
      RICH_OLD,
      doc({
        id: 'lab-thin-new',
        uploadedAt: '2026-01-01T00:00:00.000Z',
        ocrPayload: { fields: { methylationValue: '12%' } },
      }),
    ]);
    expect(result.d4z4Repeats).toBe('4');
    // And the value shown is not stitched together from both reports:
    // 甲基化 comes off the same document as the repeat count.
    expect(result.methylationValue).toBe('8%');
  });

  it('两份都报了重复数时，晚的那一份说了算 —— 哪怕它读出来的格数更少', () => {
    // 复检正是因为它是现在这一份才被传上来的。「读出来几格」是抽取管线
    // 的属性，不是报告的属性 —— 同样两份报告会因为 OCR 变好或变坏而重新
    // 排序，患者身上什么都没变。这一条要和 API 的
    // genetic-evidence.test.ts 保持同一个答案。
    const result = insights([
      RICH_OLD,
      doc({
        id: 'lab-retest-2025',
        uploadedAt: '2025-11-20T00:00:00.000Z',
        ocrPayload: { fields: { d4z4Repeats: '6', geneticTestMethod: 'optical_genome_mapping' } },
      }),
    ]);
    expect(result.d4z4Repeats).toBe('6');
    // 旧报告上的 单倍型 / 甲基化 不会被借来填补 —— 那是把两份报告拼成
    // 一份。它们照旧留在各自的报告详情页上。
    expect(result.haplotype).toBe('—');
    expect(result.methylationValue).toBe('—');
  });

  it('没报重复数的新报告，压不过报了的旧报告 —— 短读长测序测不了这一段', () => {
    // 指南原文：D4Z4 的长度与单倍型「cannot be determined by short read
    // WES- or WGS-like technologies」。让它凭更新顶掉 Southern blot，
    // 患者会从 基因确诊 掉成 未确诊。
    const result = insights([
      RICH_OLD,
      doc({
        id: 'wes-2026',
        uploadedAt: '2026-09-01T00:00:00.000Z',
        ocrPayload: {
          fields: { haplotype: '4qA', geneticTestMethod: 'short_read_sequencing' },
        },
      }),
    ]);
    expect(result.d4z4Repeats).toBe('4');
  });

  it('只读出检测方法的基因报告，算什么都没说 —— 记账不是结果', () => {
    // 检测方法与诊断日期是记账，不是关于这位患者的结论。这一条曾经让
    // 那份报告压过唯一抄着重复数的病历摘要，数字从每一个界面上消失。
    const result = insights([
      doc({
        id: 'lab-method-only',
        uploadedAt: '2026-09-01T00:00:00.000Z',
        ocrPayload: { fields: { geneticTestMethod: 'southern_blot' } },
      }),
      doc({
        id: 'summary-with-count',
        documentType: 'medical_summary',
        uploadedAt: '2020-01-01T00:00:00.000Z',
        ocrPayload: {
          extractedText: '门诊病历摘要\n主诉：双上肢无力5年',
          fields: { classifiedType: 'medical_summary', documentType: 'other', d4z4Repeats: '7' },
        },
      }),
    ]);
    expect(result.d4z4Repeats).toBe('7');
  });

  it('病历摘要抄下来的重复数：抄写不是化验，压不过实验室自己的报告', () => {
    const result = insights([
      doc({
        id: 'summary',
        documentType: 'medical_summary',
        uploadedAt: '2026-01-01T00:00:00.000Z',
        ocrPayload: { fields: { d4z4Repeats: '7', haplotype: '4qB' } },
      }),
      doc({
        id: 'lab-thin',
        uploadedAt: '2019-01-01T00:00:00.000Z',
        ocrPayload: { fields: { d4z4Repeats: '4' } },
      }),
    ]);
    expect(result.d4z4Repeats).toBe('4');
    // The haplotype the 病历摘要 carried is not borrowed to fill the
    // laboratory's silence — that would grade one report as holding
    // both readings.
    expect(result.haplotype).toBe('—');
  });

  it('基因报告一个值都没读出来时：病历摘要上的那个数就是仅有的一份', () => {
    // The one place the type rule yields. A report we have read
    // nothing off is not the laboratory speaking, it is a file we have
    // not read, and ranking it over the only copy of the count is the
    // same erasure the picker exists to stop.
    const result = insights([
      doc({ id: 'lab-empty', ocrPayload: { fields: { fieldCount: '0' } } }),
      doc({
        id: 'summary',
        documentType: 'medical_summary',
        ocrPayload: { fields: { d4z4Repeats: '7' } },
      }),
    ]);
    expect(result.d4z4Repeats).toBe('7');
  });

  it('都还没读过的时候：一份沉默的文档不假装读出了什么', () => {
    const result = insights([doc({ id: 'lab', status: 'processing', ocrPayload: null })]);
    expect(result.d4z4Repeats).toBe('—');
    expect(result.geneticType).toBe('—');
    expect(result.geneEvidence).toBe('暂无可直接展示的基因证据');
  });

  it('needs_review 和 parsed 一样按它带的内容排，待核对不等于没读到', () => {
    const result = insights([
      doc({ id: 'lab-parsed-thin', ocrPayload: { fields: { d4z4Repeats: '4' } } }),
      doc({
        id: 'lab-review-rich',
        status: 'needs_review',
        ocrPayload: { fields: { d4z4Repeats: '3', haplotype: '4qA', methylationValue: '9%' } },
      }),
    ]);
    expect(result.d4z4Repeats).toBe('3');
  });

  it('同样的内容、同样的时间：跑完的那次赢过从没跑完的那次', () => {
    const fields = { d4z4Repeats: '4' };
    const result = insights([
      doc({ id: 'a-legacy', status: 'uploaded', ocrPayload: { fields } }),
      doc({ id: 'b-parsed', status: 'parsed', ocrPayload: { fields: { d4z4Repeats: '5' } } }),
    ]);
    expect(result.d4z4Repeats).toBe('5');
  });

  it('完全打平时按 id 定序，所以同一份档案两次渲染是同一个结果', () => {
    const pair = [
      doc({ id: 'bbb', ocrPayload: { fields: { d4z4Repeats: '9' } } }),
      doc({ id: 'aaa', ocrPayload: { fields: { d4z4Repeats: '2' } } }),
    ];
    expect(insights(pair).d4z4Repeats).toBe('2');
    expect(insights([...pair].reverse()).d4z4Repeats).toBe('2');
  });

  it('面板上那个日期，是这些值真正来自的那一份的上传日期', () => {
    // It used to be the newest typed report's date regardless of which
    // document supplied the values — a date printed under a number it
    // had nothing to do with.
    const result = insights([
      RICH_OLD,
      doc({
        id: 'lab-thin-new',
        uploadedAt: '2026-01-01T00:00:00.000Z',
        ocrPayload: { fields: { methylationValue: '12%' } },
      }),
    ]);
    // Asserted by year rather than by day: `formatDate` renders in the
    // runner's own zone, and the claim here is about WHICH document
    // supplied the date, not about how a UTC instant lands locally.
    expect(result.diagnosisPanel.latestDate).toContain('2019');
    expect(result.diagnosisPanel.latestDate).not.toContain('2026');
    expect(result.diagnosisPanel.metrics.length).toBeGreaterThan(0);
    for (const metric of result.diagnosisPanel.metrics) {
      expect(metric.date).toBe(result.diagnosisPanel.latestDate);
    }
  });
});
