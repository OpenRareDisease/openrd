// The builder reads `readPassportValueOrigins` out of api.ts, which
// pulls in AsyncStorage through session-storage, and that has no native
// module under jest. Same stub api-transport.test.ts uses.
jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

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

  it('第四种来源的警示条只说「确诊年份」那一个字段', () => {
    // `confirmation` is derived from `foundation.diagnosisYear`'s
    // provenance entry alone (profile.passport.ts), so 「本节内容由管理员
    // 代为录入」 was a claim about rows an administrator has no way to
    // write — 分型 on this same sheet can be OCR off an uploaded report.
    const html = buildClinicalPassportPdfHtml(
      withDiagnosis({
        diagnosis: {
          ...(withDiagnosis({}) as { diagnosis: Record<string, unknown> }).diagnosis,
          confirmation: 'admin_entered',
        },
        fieldOrigins: [],
      }),
    );
    expect(html).toContain('档案里的「确诊年份」不是患者本人填写的');
    expect(html).not.toContain('本节内容由患者本人填写');
    expect(html).not.toContain('本节内容由「肌愈通」管理员根据患者电话或消息代为录入');
  });

  it('未经基因确诊的警示条不再宣称本节是患者本人填的', () => {
    // A report parsed to `diagnosisType` alone lands in
    // `self_reported`, and the 基因类型 card then shows a value OCR
    // read off that report — under a banner that said the patient
    // wrote this section.
    const html = buildClinicalPassportPdfHtml(withDiagnosis({}));
    expect(html).toContain('⚠ 未经基因确诊');
    expect(html).not.toContain('本节内容由患者本人填写');
    // A report that parsed to 分型 alone is on file in that state, so
    // the banner may not say none was received either.
    expect(html).not.toContain('尚未收到该患者的基因检测报告');
  });

  it('单倍型非允许型的警示条说的是那个结果，不是「没有结果」', () => {
    // The report is on file, it was read, and 4qB is what it said —
    // printed on the same sheet with 报告读取 in its bracket. The three
    // sibling banners deny a reading, so this state may not take one of
    // them; and the doctor holding this page must not read it as an
    // exclusion either.
    const html = buildClinicalPassportPdfHtml(
      withDiagnosis({
        diagnosis: {
          ...(withDiagnosis({}) as { diagnosis: Record<string, unknown> }).diagnosis,
          confirmation: 'genetic_non_permissive',
          d4z4Repeats: '3',
        },
      }),
    );
    expect(html).toContain('⚠ 未构成基因确诊');
    expect(html).toContain('4q 单倍型不是允许型 4qA');
    expect(html).toContain('这不是排除诊断');
    expect(html).not.toContain('没有从基因报告里读出来的');
  });

  it('尚无诊断依据的警示条不说「本节为空」', () => {
    // 甲基化 is in none of the three tests that earn 基因确诊 and is
    // neither 分型 nor 诊断日期, so a report parsed to a methylation
    // value alone reaches this state with that card filled in.
    const html = buildClinicalPassportPdfHtml(
      withDiagnosis({
        diagnosis: {
          ...(withDiagnosis({}) as { diagnosis: Record<string, unknown> }).diagnosis,
          confirmation: 'none',
          geneticType: '—',
          diagnosisDate: '—',
          methylationValue: '32%',
        },
      }),
    );
    expect(html).toContain('⚠ 尚无诊断依据');
    expect(html).not.toContain('本节为空');
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

/**
 * 这张纸上各个诊断值的来源各不相同，横幅一句话说不了。
 *
 * A clinician who scrolled past the banner, or who kept only the page
 * the values are on, still has to be able to tell a laboratory's number
 * from a patient's account of themselves.
 */
describe('逐项来源印在值下面', () => {
  const origin = (kind: string, labelZh: string) => ({
    kind,
    labelZh,
    documentId: null,
    adminUserId: null,
    at: null,
    detail: null,
  });

  const withOrigins = (over: Record<string, unknown>) =>
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
        geneEvidence: 'FSHD1',
        valueOrigins: {
          geneticType: origin('report', '报告读取'),
          d4z4Repeats: origin('absent', '未填'),
          methylationValue: origin('absent', '未填'),
          diagnosisDate: origin('indeterminate', '来源无法确定'),
        },
        // 证据摘要的来源不在上面那张表里。给它一个只有它会印的措辞，
        // 这样断言不会和四张卡片的来源混起来。
        geneEvidenceOrigin: origin('patient', '本人填写'),
        ...((over.diagnosis as Record<string, unknown>) ?? {}),
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
      fieldOrigins: [],
      nextSteps: [],
      timeline: [],
    }) as unknown as Parameters<typeof buildClinicalPassportPdfHtml>[0];

  it('每个值下面印着自己的来源，同一节里可以是三种不同的来源', () => {
    const html = buildClinicalPassportPdfHtml(withOrigins({}));
    expect(html).toContain('<p class="value-origin">报告读取</p>');
    expect(html).toContain('<p class="value-origin">来源无法确定</p>');
  });

  it('没有来源可归的值不印「未填」—— 「—（未填）」是同一件事说两遍', () => {
    expect(buildClinicalPassportPdfHtml(withOrigins({}))).not.toContain('未填');
  });

  it('来源那一行有自己的样式，不跟着读数的字号走', () => {
    expect(buildClinicalPassportPdfHtml(withOrigins({}))).toMatch(
      /\.value-origin\s*\{[^}]*font-size/,
    );
  });

  it('证据摘要那一行也印着自己的来源', () => {
    // 一句 self_reported 的档案里，基因类型下面印着来源、证据摘要下面
    // 空着，是同一页纸上两种待遇：读者学会「有小字＝有来源」之后，那句
    // 空着的摘要就被读成从报告里读出来的。
    const html = buildClinicalPassportPdfHtml(withOrigins({}));
    expect(html).toContain('<p class="value-origin">本人填写</p>');
  });

  it('服务端没给逐项来源时说没给，不读成「都是报告读出来的」', () => {
    const html = buildClinicalPassportPdfHtml(
      withOrigins({ diagnosis: { valueOrigins: null, geneEvidenceOrigin: null } }),
    );
    expect(html).toContain('服务端这一版没有把本节的逐项来源发全');
    expect(html).not.toContain('class="value-origin"');
  });

  it('少一项就整块不认 —— 印三个来源、第四个空着，读者会把空着的当成报告读取', () => {
    const html = buildClinicalPassportPdfHtml(
      withOrigins({
        diagnosis: {
          valueOrigins: {
            geneticType: origin('report', '报告读取'),
            d4z4Repeats: origin('absent', '未填'),
            methylationValue: origin('absent', '未填'),
          },
          geneEvidenceOrigin: null,
        },
      }),
    );
    expect(html).toContain('服务端这一版没有把本节的逐项来源发全');
    expect(html).not.toContain('class="value-origin"');
  });

  it('只漏了证据摘要的来源时也说没发全 —— 那一行不能空着装成报告读取', () => {
    const html = buildClinicalPassportPdfHtml(
      withOrigins({ diagnosis: { geneEvidenceOrigin: null } }),
    );
    expect(html).toContain('服务端这一版没有把本节的逐项来源发全');
    // 那张表是给了的，所以四个值的小字照印。
    expect(html).toContain('<p class="value-origin">报告读取</p>');
    expect(html).not.toContain('本人填写');
  });

  it('证据摘要没有来源可归时不印小字，也不说服务端没发', () => {
    // `absent` 是服务端给出的答复，不是没答复。
    const html = buildClinicalPassportPdfHtml(
      withOrigins({ diagnosis: { geneEvidenceOrigin: origin('absent', '未填') } }),
    );
    expect(html).not.toContain('服务端这一版没有把本节的逐项来源发全');
    expect(html).not.toContain('未填');
  });

  it('认不出来的 kind 不把整块作废 —— 服务端确实给了，就照它的措辞印', () => {
    // The cache cuts both ways: a newer API adding a kind this bundle
    // has never heard of must not make this page claim the server sent
    // nothing.
    const html = buildClinicalPassportPdfHtml(
      withOrigins({
        diagnosis: {
          valueOrigins: {
            geneticType: origin('registry_import', '登记处导入'),
            d4z4Repeats: origin('absent', '未填'),
            methylationValue: origin('absent', '未填'),
            diagnosisDate: origin('absent', '未填'),
          },
        },
      }),
    );
    expect(html).not.toContain('服务端这一版没有把本节的逐项来源发全');
    expect(html).toContain('<p class="value-origin">登记处导入</p>');
  });

  it('只解析出甲基化值时，那个值下面照样印着「报告读取」', () => {
    const html = buildClinicalPassportPdfHtml(
      withOrigins({
        diagnosis: {
          confirmation: 'none',
          geneticType: '—',
          diagnosisDate: '—',
          methylationValue: '32%',
          valueOrigins: {
            geneticType: origin('absent', '未填'),
            d4z4Repeats: origin('absent', '未填'),
            methylationValue: origin('report', '报告读取'),
            diagnosisDate: origin('absent', '未填'),
          },
        },
      }),
    );
    expect(html).toContain('32%');
    expect(html).toContain('<p class="value-origin">报告读取</p>');
  });
});
