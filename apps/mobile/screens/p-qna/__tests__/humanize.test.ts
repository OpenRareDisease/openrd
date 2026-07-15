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
  it('maps the three registered tools to plain actions', () => {
    expect(humanizeToolName('search_medical_kb')).toBe('检索 FSHD 知识库');
    expect(humanizeToolName('get_my_profile')).toBe('读取你的健康档案');
    expect(humanizeToolName('get_my_reports')).toBe('查阅你的检查报告');
  });

  it('passes unknown tool names through verbatim', () => {
    expect(humanizeToolName('future_tool')).toBe('future_tool');
  });
});

describe('humanizeFieldKeys', () => {
  it('maps allowlist keys to plain labels', () => {
    expect(humanizeFieldKeys(['ageGroup', 'diagnosisType', 'findings_summary'])).toEqual([
      '年龄段',
      '诊断分型',
      '报告要点',
    ]);
  });

  it('collapses _clinical variants onto the same label and dedupes', () => {
    expect(humanizeFieldKeys(['d4z4_clinical', 'd4z4', 'methylation_clinical'])).toEqual([
      'D4Z4 基因结果',
      '甲基化结果',
    ]);
  });

  it('unknown keys fall through verbatim instead of vanishing', () => {
    expect(humanizeFieldKeys(['brandNewKey'])).toEqual(['brandNewKey']);
  });
});

describe('buildCitationSummary', () => {
  it('groups personal fields by asset in plain language', () => {
    const line = buildCitationSummary({
      usedPersonalData: true,
      fieldsUsed: ['ageGroup', 'd4z4_clinical', 'classifiedType', 'findings_summary'],
    });
    expect(line).toBe(
      '本次引用了你的：健康档案（年龄段、D4Z4 基因结果）、检查报告（报告类型、报告要点）',
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
      fieldsUsed: ['ageGroup', 'brandNewKey'],
    });
    expect(line).toBe('本次引用了你的：健康档案（年龄段）、其他数据（brandNewKey）');
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
