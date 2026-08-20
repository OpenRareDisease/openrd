import { buildCitationSummary, humanizeFieldKeys, humanizeToolName } from '../humanize';
import type { AiToolCallSummary } from '../../../lib/api';

const call = (name: string): AiToolCallSummary => ({
  name,
  toolCallId: `id-${name}`,
  status: 'ok',
  chunkCount: 1,
  latencyMs: 10,
});

describe('humanizeToolName', () => {
  it('maps every registered tool to a plain action', () => {
    expect(humanizeToolName('search_medical_kb')).toBe('检索 FSHD 知识库');
    expect(humanizeToolName('get_my_profile')).toBe('读取你的健康档案');
    expect(humanizeToolName('get_my_reports')).toBe('查阅你的检查报告');
    // Both of these were registered on the live route with no label
    // here, so the trace chip printed the raw tool id at the patient.
    expect(humanizeToolName('get_my_records')).toBe('读取你的随访记录');
    expect(humanizeToolName('list_clinical_trials')).toBe('查询临床试验登记信息');
  });

  it('passes unknown tool names through verbatim', () => {
    expect(humanizeToolName('future_tool')).toBe('future_tool');
  });
});

describe('humanizeFieldKeys', () => {
  it('maps allowlist keys to plain labels', () => {
    expect(humanizeFieldKeys(['gender', 'diagnosisType', 'reportImpression'])).toEqual([
      '性别',
      '诊断分型',
      '报告原文结论',
    ]);
  });

  it('collapses derived variants onto the same label and dedupes', () => {
    // `_withheld` as well as `_clinical`: an unmapped key is printed to
    // the patient verbatim, so a strict-mode methylation measurement
    // would have read 「其他（methylation_withheld）」 on the answer.
    expect(
      humanizeFieldKeys(['d4z4_clinical', 'd4z4', 'methylation_withheld', 'methylation']),
    ).toEqual(['D4Z4 基因结果', '甲基化结果']);
  });

  it('unknown keys fall through verbatim instead of vanishing', () => {
    expect(humanizeFieldKeys(['brandNewKey'])).toEqual(['brandNewKey']);
  });

  it('_origin is a statement about a cell, not a second cell', () => {
    // `methylation_origin` says where the methylation cell came from —
    // the same asset to the patient as the cell itself. Without the
    // suffix it read 「methylation_origin」 on the answer.
    expect(humanizeFieldKeys(['methylation', 'methylation_origin'])).toEqual(['甲基化结果']);
  });

  it('maps the followups keys the 随访记录 tool contributes', () => {
    // Every one of these fell to the verbatim fallback: this file had
    // no entry for the `followups` scope at all.
    expect(
      humanizeFieldKeys(['metricLabel', 'spanDays', 'latestValue', 'series', 'eventSummary']),
    ).toEqual(['记录项目', '记录时间跨度', '最近一次数值', '历次数值', '随访事件']);
  });

  it('keys that are one datum to the patient print once', () => {
    expect(humanizeFieldKeys(['metricKey', 'metricLabel'])).toEqual(['记录项目']);
    expect(humanizeFieldKeys(['count', 'countAtCap'])).toEqual(['记录次数']);
    expect(humanizeFieldKeys(['changeDirection', 'latestBand'])).toEqual(['变化趋势']);
    expect(humanizeFieldKeys(['eventSummary', 'eventCount'])).toEqual(['随访事件']);
  });

  // THE IMPRESSION CHANNEL. Every key set below was read off
  // `renderChunkForPrompt(...).fieldsUsed` for a real report chunk
  // driven through the redactor, not composed by hand — the report
  // cells that travel beside the impression are dropped here because
  // this describe is about the impression labels.
  it('a withheld impression does not claim the conclusion was read', () => {
    // The whole reason these five keys stopped sharing one label. With
    // 报告原文结论 on `reportImpressionWithheld`, a 病历摘要 refused by
    // Gate 0 printed 「本次引用了你的：检查报告（…、报告原文结论）」 — the
    // conclusion named as cited in the one case where nothing of it was.
    expect(humanizeFieldKeys(['reportImpressionWithheld'])).toEqual(['报告原文结论未共享的原因']);
    expect(humanizeFieldKeys(['reportImpressionWithheld'])).not.toContain('报告原文结论');
  });

  it('all four refusals are one key, so all four print the one line', () => {
    // narrative / kind-not-established / identifiers-not-removable /
    // number-not-classifiable are four VALUES of
    // `reportImpressionWithheld`; `fieldsUsed` is `Object.keys(fields)`,
    // so only the key crosses the wire. The label has to be true of all
    // four rather than describe one of them.
    const line = buildCitationSummary({
      usedPersonalData: true,
      fieldsUsed: [
        'classifiedType',
        'documentType',
        'status',
        'fields',
        'reportImpressionWithheld',
      ],
    });
    expect(line).toBe(
      '本次引用了你的：检查报告（报告类型、文档类型、报告状态、报告识别指标、报告原文结论未共享的原因）',
    );
  });

  it('what was removed from a published conclusion is said, not folded away', () => {
    // Each counter is emitted only beside a published sentence — a
    // refusal zeroes all three and `put()` drops a zero — so the label
    // may say 结论 and rely on 报告原文结论 standing next to it.
    expect(humanizeFieldKeys(['reportImpression', 'reportImpressionValuesMasked'])).toEqual([
      '报告原文结论',
      '结论中已隐去的数值个数',
    ]);
    expect(humanizeFieldKeys(['reportImpression', 'reportImpressionIdentifiersRemoved'])).toEqual([
      '报告原文结论',
      '结论中已去除的身份信息处数',
    ]);
    expect(humanizeFieldKeys(['reportImpression', 'reportImpressionCharactersCut'])).toEqual([
      '报告原文结论',
      '结论因过长被截去的字数',
    ]);
  });

  it('the five impression keys are five labels, not one', () => {
    const labels = humanizeFieldKeys([
      'reportImpression',
      'reportImpressionWithheld',
      'reportImpressionValuesMasked',
      'reportImpressionIdentifiersRemoved',
      'reportImpressionCharactersCut',
    ]);
    // `humanizeFieldKeys` dedupes by label, so five surviving entries
    // IS the assertion that no two of them share one.
    expect(labels).toHaveLength(5);
  });

  it('上传年份 and 报告年份 stay two labels, because they are two cells', () => {
    // The API conflated them once and dated a 2019 report to 2026.
    expect(humanizeFieldKeys(['reportDate_year', 'uploadYear'])).toEqual(['报告年份', '上传年份']);
  });
});

describe('buildCitationSummary', () => {
  it('groups personal fields by asset in plain language', () => {
    const line = buildCitationSummary({
      usedPersonalData: true,
      fieldsUsed: ['gender', 'd4z4_clinical', 'classifiedType', 'reportImpression'],
    });
    expect(line).toBe(
      '本次引用了你的：健康档案（性别、D4Z4 基因结果）、检查报告（报告类型、报告原文结论）',
    );
  });

  it('a published impression and what was cut out of it read as two things', () => {
    // Exactly the key list `renderChunkForPrompt` returned in strict
    // mode for a muscle MRI whose impression read
    // 「双侧大腿脂肪浸润约 35%，肩胛带肌未见异常。」 — one measurement
    // masked, the sentence published.
    const line = buildCitationSummary({
      usedPersonalData: true,
      fieldsUsed: [
        'classifiedType',
        'documentType',
        'status',
        'fields_clinical',
        'reportImpression',
        'reportImpressionValuesMasked',
      ],
    });
    expect(line).toBe(
      '本次引用了你的：检查报告（报告类型、文档类型、报告状态、报告识别指标、报告原文结论、结论中已隐去的数值个数）',
    );
  });

  it('personal data with no field detail still says so', () => {
    expect(buildCitationSummary({ usedPersonalData: true, fieldsUsed: [] })).toBe(
      '本次引用了你的个人健康数据。',
    );
  });

  it('unmapped keys group under 其他数据, not under 检查报告', () => {
    const line = buildCitationSummary({
      usedPersonalData: true,
      fieldsUsed: ['gender', 'brandNewKey'],
    });
    expect(line).toBe('本次引用了你的：健康档案（性别）、其他数据（brandNewKey）');
  });

  it('随访记录 is its own group, not 其他数据', () => {
    // What this printed before: 「本次引用了你的：健康档案（诊断分型）、
    // 其他数据（metricLabel、spanDays、changeDirection、eventSummary）」
    // — the engineering vocabulary this module exists to remove, under
    // a group name that calls the patient's own follow-up record 其他.
    const line = buildCitationSummary({
      usedPersonalData: true,
      fieldsUsed: ['diagnosisType', 'metricLabel', 'spanDays', 'changeDirection', 'eventSummary'],
    });
    expect(line).toBe(
      '本次引用了你的：健康档案（诊断分型）、随访记录（记录项目、记录时间跨度、变化趋势、随访事件）',
    );
  });

  it('all three scopes at once, each under its own heading', () => {
    const line = buildCitationSummary({
      usedPersonalData: true,
      fieldsUsed: ['d4z4_clinical', 'classifiedType', 'uploadYear', 'metricLabel', 'latestBand'],
    });
    expect(line).toBe(
      '本次引用了你的：健康档案（D4Z4 基因结果）、检查报告（报告类型、上传年份）、随访记录（记录项目、变化趋势）',
    );
  });

  it('KB-only answers state the negative explicitly', () => {
    const line = buildCitationSummary({
      usedPersonalData: false,
      toolCalls: [call('search_medical_kb')],
    });
    expect(line).toBe('本次回答仅基于公共 FSHD 知识资料，未读取你的个人数据。');
  });

  it('no tools and no personal data → null (legacy / plain answers)', () => {
    expect(buildCitationSummary({ usedPersonalData: false, toolCalls: [] })).toBeNull();
    expect(buildCitationSummary({})).toBeNull();
  });
});
