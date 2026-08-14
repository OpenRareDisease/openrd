import { _renderVisitPrepHtml, buildClinicalPassportPdfHtml } from '../clinical-passport-pdf';

// The exported PDF is the one artefact that leaves the app and reaches
// a clinician. It used to `escapeHtml` the AI note, which is exactly
// the wrong transform: escaping guarantees every `**`, `#` and `|`
// survives onto the printout.
describe('renderVisitPrepHtml', () => {
  it('turns markdown into structure instead of preserving it', () => {
    const html = _renderVisitPrepHtml(
      [
        '## 这段时间的变化',
        '- **上楼计时**：12 秒 → 15 秒',
        '1. 是否需要复查 MRI',
        '| 项目 | 结果 |',
        '|---|---|',
        '| FVC | 78% |',
      ].join('\n'),
    );

    expect(html).toContain('<h3 class="visit-prep-heading">这段时间的变化</h3>');
    expect(html).toContain('<strong>上楼计时</strong>');
    // The ordinal survives: 建议问医生 is a numbered list of things to
    // raise in the appointment, and a <ul> would flatten it to bullets.
    expect(html).toContain('<span class="visit-prep-marker">1.</span>');
    expect(html).toContain('FVC');
    expect(html).not.toContain('**');
    expect(html).not.toContain('##');
    expect(html).not.toMatch(/\|-+\|/);
  });

  it('still escapes html from the model', () => {
    const html = _renderVisitPrepHtml('注意 <script>alert(1)</script> 这段');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  // A model can put any string inside `(...)`.
  it('drops a non-http link target rather than emitting it', () => {
    const html = _renderVisitPrepHtml('[点这里](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('点这里');
  });
});

/**
 * The printout is what a neurologist actually holds, and most of them
 * meet FSHD through DMD and myotonic dystrophy, where an annual echo
 * is correct. An empty 心脏检查 box with no explanation reads to that
 * reader as a test the patient is overdue for — so the note saying it
 * is not indicated has to survive onto paper, not just onto the phone.
 */
describe('监测槽位的适应症说明进 PDF', () => {
  const summary = {
    generatedAt: '2026-08-05T00:00:00.000Z',
    passportId: 'FSHD-TEST',
    patientName: '测试',
    hasRecordedData: true,
    latestUpdatedAt: null,
    completion: { completed: 1, total: 4 },
    metrics: [],
    summaryCards: [],
    diagnosis: {
      ready: false,
      confirmation: 'none',
      latestSourceDate: null,
      latestDocumentId: null,
      freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
      geneticType: '—',
      d4z4Repeats: '—',
      methylationValue: '—',
      diagnosisDate: '—',
      geneEvidence: '—',
    },
    motor: {
      ready: false,
      average: '—',
      latestMeasurementAt: null,
      latestActivityAt: null,
      summary: '—',
      highlights: [],
      bodyRegions: {},
      activitySummary: '—',
    },
    imaging: {
      ready: false,
      latestMriDate: null,
      latestDocumentId: null,
      freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
      summary: '—',
      highlights: [],
      bodyRegions: {},
    },
    monitoring: {
      ready: false,
      items: [
        {
          key: 'cardiac',
          title: '心脏检查',
          available: false,
          summary: '暂无心脏检查数据',
          latestDate: null,
          latestDocumentId: null,
          freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
          note: '没有症状的 FSHD 患者不需要常规做心电图或心脏超声。',
        },
      ],
    },
    nextSteps: [],
    timeline: [],
  } as unknown as Parameters<typeof buildClinicalPassportPdfHtml>[0];

  it('渲染出来并且和读数分开', () => {
    const html = buildClinicalPassportPdfHtml(summary);
    expect(html).toContain('不需要常规做心电图');
    expect(html).toContain('class="monitor-note"');
    // Ruled off, or it reads as more measurement text.
    expect(html).toMatch(/\.monitor-card p\.monitor-note\s*\{[^}]*border-top/);
  });

  it('没有说明的槽位不渲染空节点', () => {
    const bare = JSON.parse(JSON.stringify(summary));
    delete bare.monitoring.items[0].note;
    expect(buildClinicalPassportPdfHtml(bare)).not.toContain('monitor-note"');
  });
});

/**
 * §B3 on paper. The PDF is the artefact a clinician actually reads, so
 * a value our own back office typed must not reach it wearing the
 * patient's name.
 */
describe('管理员代填的字段要印在 PDF 上', () => {
  const withDiagnosis = (over: Record<string, unknown>) =>
    ({
      generatedAt: '2026-08-05T00:00:00.000Z',
      passportId: 'FSHD-TEST',
      patientName: '测试',
      hasRecordedData: true,
      latestUpdatedAt: null,
      completion: { completed: 1, total: 4 },
      metrics: [],
      summaryCards: [],
      diagnosis: {
        ready: false,
        confirmation: 'self_reported',
        latestSourceDate: null,
        latestDocumentId: null,
        freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
        geneticType: 'FSHD1',
        d4z4Repeats: '—',
        methylationValue: '—',
        diagnosisDate: '2014-01-01',
        geneEvidence: '—',
      },
      motor: {
        ready: false,
        average: '—',
        latestMeasurementAt: null,
        latestActivityAt: null,
        summary: '—',
        highlights: [],
        bodyRegions: {},
        activitySummary: '—',
      },
      imaging: {
        ready: false,
        latestMriDate: null,
        latestDocumentId: null,
        freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
        summary: '—',
        highlights: [],
        bodyRegions: {},
      },
      monitoring: { ready: false, items: [] },
      nextSteps: [],
      timeline: [],
      ...over,
    }) as unknown as Parameters<typeof buildClinicalPassportPdfHtml>[0];

  it('第四种来源有自己的警示条，不写成「患者本人填写」', () => {
    const html = buildClinicalPassportPdfHtml(
      withDiagnosis({
        diagnosis: {
          ...(withDiagnosis({}) as { diagnosis: Record<string, unknown> }).diagnosis,
          confirmation: 'admin_entered',
        },
        fieldOrigins: [],
      }),
    );
    expect(html).toContain('不是患者本人填写');
    expect(html).not.toContain('本节内容由患者本人填写');
  });

  it('逐条列出代填的字段，带日期', () => {
    const html = buildClinicalPassportPdfHtml(
      withDiagnosis({
        fieldOrigins: [
          {
            path: 'diseaseBackground.diagnosisType',
            labelZh: 'FSHD 分型',
            state: 'admin_entered',
            adminUserId: '11111111-2222-3333-4444-555555555555',
            at: '2026-08-13T04:11:07.912Z',
            detail: null,
          },
        ],
      }),
    );
    expect(html).toContain('这些字段不是患者本人填的');
    expect(html).toContain('FSHD 分型');
  });

  it('没有标记就不印这一节', () => {
    expect(buildClinicalPassportPdfHtml(withDiagnosis({ fieldOrigins: [] }))).not.toContain(
      '这些字段不是患者本人填的',
    );
  });

  it('服务端没回这一项时说没回，不当成「都是本人填的」', () => {
    // 新前端 + 还没升级的后端。默认成空数组正好是这一整块要防的假话。
    const html = buildClinicalPassportPdfHtml(withDiagnosis({}));
    expect(html).toContain('服务端这一版没有返回字段来源');
  });
});
