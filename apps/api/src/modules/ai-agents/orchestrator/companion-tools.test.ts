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

describe('the mirror rule — anaphoric follow-ups about own records', () => {
  const AVAILABLE = new Set(['search_medical_kb', 'get_my_reports', 'get_my_profile']);
  const kbOnly = [{ id: 'c1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' }];

  // The reported failure: the planner called only the KB because 「这些」
  // is anaphora, so the model had public material and no patient data —
  // and asked the patient to send report images it had one turn ago.
  it('adds the report lookup for a demonstrative follow-up', () => {
    const { toolCalls, added } = withCompanionToolCalls(
      kbOnly,
      '想看看这些报告的具体数值',
      AVAILABLE,
      { hasHistory: true },
    );
    expect(added).toEqual(['get_my_reports']);
    expect(toolCalls.map((c) => c.id)).toContain('server-companion-reports');
  });

  it('does not add it on the first turn — 这些 has no antecedent yet', () => {
    const { added } = withCompanionToolCalls(kbOnly, '想看看这些报告的具体数值', AVAILABLE, {
      hasHistory: false,
    });
    expect(added).toEqual([]);
  });

  // A demonstrative alone is not enough: 「这些注意事项」 points at advice
  // the assistant just gave, not at the patient's records.
  it('does not add it for a demonstrative pointing at advice', () => {
    const { added } = withCompanionToolCalls(kbOnly, '这些注意事项能展开说说吗', AVAILABLE, {
      hasHistory: true,
    });
    expect(added).toEqual([]);
  });

  it('adds nothing when the plan already reads the patient', () => {
    const { added } = withCompanionToolCalls(
      [
        { id: 'c1', name: 'get_my_reports', argumentsJson: '{}' },
        { id: 'c2', name: 'search_medical_kb', argumentsJson: '{"query":"x"}' },
      ],
      '这些报告的数值呢',
      AVAILABLE,
      { hasHistory: true },
    );
    expect(added).toEqual([]);
  });

  it('respects the consent gate — never adds a tool the registry withheld', () => {
    const { added } = withCompanionToolCalls(
      kbOnly,
      '这些报告的数值呢',
      new Set(['search_medical_kb']),
      {
        hasHistory: true,
      },
    );
    expect(added).toEqual([]);
  });

  it('still catches the explicit form without history', () => {
    const { added } = withCompanionToolCalls(kbOnly, '分析我的报告', AVAILABLE, {
      hasHistory: false,
    });
    expect(added).toEqual(['get_my_reports']);
  });
});

/**
 * §A6 — a trial question must reach the live registry cache.
 *
 * The knowledge base answers these out of one saved ClinicalTrials.gov
 * results page from 2025-03-31 whose status words are machine-translated
 * (「招聘」 for Recruiting). The retriever now dates that page wherever
 * it is quoted, but the current answer lives in `trial_records`, and
 * whether it gets read cannot depend on a single sampled completion.
 */
describe('withCompanionToolCalls — clinical trials', () => {
  const WITH_TRIALS = new Set([...AVAILABLE, 'list_clinical_trials']);

  it('adds the live lookup to a plan that only searched the corpus', () => {
    const { toolCalls, added } = withCompanionToolCalls(
      [call('search_medical_kb', '{"query":"FSHD 临床试验"}')],
      '现在有哪些 FSHD 临床试验在招募',
      WITH_TRIALS,
    );
    expect(added).toEqual(['list_clinical_trials']);
    expect(toolCalls.at(-1)).toEqual({
      id: 'server-companion-trials',
      name: 'list_clinical_trials',
      argumentsJson: '{}',
    });
  });

  // The case this rule exists for. A model that answers 「哪些试验在招募」
  // with no tool call is answering from its training data, and its
  // training data has NCT numbers in it.
  it('turns an empty plan into a tool round', () => {
    const { toolCalls, added } = withCompanionToolCalls([], '哪些试验在招募', WITH_TRIALS);
    expect(added).toEqual(['list_clinical_trials']);
    expect(toolCalls).toHaveLength(1);
  });

  it('catches the shapes a patient actually types', () => {
    for (const question of [
      '哪些试验在招募',
      '有没有新的临床试验',
      'NCT04635891 现在什么情况',
      '我想报名参加试验，有推荐的吗',
      '国内有临床研究吗',
      'are there any clinical trials recruiting',
    ]) {
      const { added } = withCompanionToolCalls([], question, WITH_TRIALS);
      expect(added, question).toEqual(['list_clinical_trials']);
    }
  });

  it('stays out of the way of questions that are not about trials', () => {
    for (const question of [
      '我的实验室检查结果怎么样',
      '甲基化筛查项目怎么报名',
      '确诊之后心理上怎么调整',
      '我上次的化验数值呢',
    ]) {
      const { added } = withCompanionToolCalls([], question, WITH_TRIALS);
      // Asserted against this rule only. 「我的实验室检查结果怎么样」 does
      // legitimately trip the own-records companion above it, and that
      // is a different rule's correct behaviour.
      expect(added, question).not.toContain('list_clinical_trials');
    }
  });

  it('does not duplicate a call the model already made', () => {
    const planned = [call('list_clinical_trials', '{"status":"RECRUITING"}')];
    const { toolCalls, added } = withCompanionToolCalls(planned, '哪些试验在招募', WITH_TRIALS);
    expect(added).toEqual([]);
    // Identity preserved — callers tell 「untouched」 from 「rewritten」
    // without a deep compare.
    expect(toolCalls).toBe(planned);
  });

  it('never adds a tool the registry did not advertise', () => {
    const { added } = withCompanionToolCalls([], '哪些试验在招募', AVAILABLE);
    expect(added).toEqual([]);
  });
});
