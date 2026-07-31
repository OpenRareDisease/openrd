import { describe, expect, it } from 'vitest';

import { withCompanionToolCalls } from './companion-tools.js';
import type { LlmToolCall } from '../llm/base.js';

const call = (name: string, argumentsJson = '{}'): LlmToolCall => ({
  id: `c-${name}`,
  name,
  argumentsJson,
});
const AVAILABLE = new Set([
  'search_medical_kb',
  'get_my_reports',
  'get_my_profile',
  'get_my_records',
]);

describe('withCompanionToolCalls', () => {
  // The observed failure: a question naming both halves —「结合 fshd 知识库
  // 分析我的报告」— planned one tool, and the answer footer read
  //「本次回答仅基于公共 FSHD 知识资料，未读取你的个人数据」.
  it('adds the kb lookup when the plan reads reports without it', () => {
    const { toolCalls, added } = withCompanionToolCalls(
      [call('get_my_reports')],
      '结合 fshd 知识库分析我的报告',
      AVAILABLE,
    );
    expect(added).toEqual(['search_medical_kb']);
    expect(toolCalls.map((c) => c.name)).toEqual(['get_my_reports', 'search_medical_kb']);
    expect(JSON.parse(toolCalls[1].argumentsJson)).toEqual({
      query: '结合 fshd 知识库分析我的报告',
    });
  });

  it('leaves a plan that already consults the kb alone', () => {
    const planned = [call('get_my_reports'), call('search_medical_kb')];
    const { toolCalls, added } = withCompanionToolCalls(planned, '我的报告说明什么', AVAILABLE);
    expect(added).toEqual([]);
    expect(toolCalls).toBe(planned);
  });

  // Only report reads trigger it. A profile or records question is not
  // a question about what an analyte means.
  it('does not fire for a plan that reads no reports', () => {
    const { added } = withCompanionToolCalls([call('get_my_profile')], '我的分型是什么', AVAILABLE);
    expect(added).toEqual([]);
  });

  it('does not fire when the kb tool is not advertised', () => {
    const { added } = withCompanionToolCalls(
      [call('get_my_reports')],
      '我的报告说明什么',
      new Set(['get_my_reports']),
    );
    expect(added).toEqual([]);
  });

  // A long multi-turn question dilutes the embedding the retriever
  // builds from it.
  it('caps the query it hands the retriever', () => {
    const question = '我'.repeat(400);
    const { toolCalls } = withCompanionToolCalls([call('get_my_reports')], question, AVAILABLE);
    expect(JSON.parse(toolCalls[1].argumentsJson).query.length).toBe(120);
  });

  it('never removes or rewrites what the model asked for', () => {
    const planned = [call('get_my_reports', '{"documentType":"mri"}')];
    const { toolCalls } = withCompanionToolCalls(planned, '我的 MRI', AVAILABLE);
    expect(toolCalls[0]).toBe(planned[0]);
  });

  it('skips a blank question rather than embedding an empty query', () => {
    const { added } = withCompanionToolCalls([call('get_my_reports')], '   ', AVAILABLE);
    expect(added).toEqual([]);
  });
});
