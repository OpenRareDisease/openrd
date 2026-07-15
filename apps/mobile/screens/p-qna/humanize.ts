/**
 * Citation transparency: translate the answer metadata's engineering
 * vocabulary (tool ids, allowlist field keys) into the plain language
 * the rest of the app speaks, and compose the one-line「本次引用了…」
 * summary. Pure functions so jest covers the mapping and the
 * composition rules without rendering the screen.
 *
 * Field keys mirror the backend prompt allowlist
 * (apps/api/src/modules/ai-agents/security/allowlist.ts). Unknown
 * keys fall through verbatim rather than being hidden — transparency
 * beats polish, and a missing mapping shows up in the UI as a to-do
 * instead of silently vanishing.
 */

import type { AiToolCallSummary } from '../../lib/api';

const TOOL_LABELS: Record<string, string> = {
  search_medical_kb: '检索 FSHD 知识库',
  get_my_profile: '读取你的健康档案',
  get_my_reports: '查阅你的检查报告',
};

export const humanizeToolName = (name: string): string => TOOL_LABELS[name] ?? name;

/** Allowlist key → plain label. `_clinical` variants collapse onto
 *  their base key before lookup (strict mode surfaces d4z4_clinical
 *  where precise mode surfaces d4z4 — same asset to the patient). */
const FIELD_LABELS: Record<string, string> = {
  // profile scope
  ageGroup: '年龄段',
  gender: '性别',
  diagnosisStage: '诊断分期',
  diagnosisYear: '诊断年份',
  diagnosisType: '诊断分型',
  d4z4: 'D4Z4 基因结果',
  haplotype: '单倍型结果',
  methylation: '甲基化结果',
  onsetRegion: '起病部位',
  familyHistory: '家族史',
  independentlyAmbulatory: '行走能力',
  assistiveDevices: '辅助器具',
  symptomCategories: '症状类型',
  // reports scope
  classifiedType: '报告类型',
  documentType: '文档类型',
  reportDate_year: '报告年份',
  status: '报告状态',
  fields: '报告识别指标',
  findings_summary: '报告要点',
};

const PROFILE_KEYS = new Set([
  'ageGroup',
  'gender',
  'diagnosisStage',
  'diagnosisYear',
  'diagnosisType',
  'd4z4',
  'haplotype',
  'methylation',
  'onsetRegion',
  'familyHistory',
  'independentlyAmbulatory',
  'assistiveDevices',
  'symptomCategories',
]);

const baseKey = (key: string): string =>
  key.endsWith('_clinical') ? key.slice(0, -'_clinical'.length) : key;

/** Map allowlist keys to deduped plain labels, preserving order of
 *  first appearance. Unknown keys pass through verbatim. */
export const humanizeFieldKeys = (keys: readonly string[]): string[] => {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const key of keys) {
    const label = FIELD_LABELS[baseKey(key)] ?? key;
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
};

export interface CitationSummaryInput {
  usedPersonalData?: boolean;
  fieldsUsed?: readonly string[];
  toolCalls?: readonly AiToolCallSummary[];
}

/**
 * The headline transparency line for an assistant answer.
 *
 * - Personal data used → 「本次引用了你的：健康档案（年龄段、诊断分型）、
 *   检查报告（报告要点）」 grouped by asset, in plain labels.
 * - Tools ran but nothing personal was read →「本次回答仅基于公共
 *   FSHD 知识资料，未读取你的个人数据。」— the negative case is
 *   transparency too, and today it renders as nothing at all.
 * - No metadata signal (legacy messages) → null, render nothing.
 */
export const buildCitationSummary = (input: CitationSummaryInput): string | null => {
  if (input.usedPersonalData === true) {
    const labels = humanizeFieldKeys(input.fieldsUsed ?? []);
    if (labels.length === 0) {
      return '本次引用了你的个人健康数据。';
    }
    // Three buckets: profile keys, known report keys, and unmapped
    // keys. Unknown keys get their own bucket instead of being
    // mislabeled as report data — verbatim but honestly grouped.
    const profileLabels: string[] = [];
    const reportLabels: string[] = [];
    const otherLabels: string[] = [];
    for (const key of input.fieldsUsed ?? []) {
      const base = baseKey(key);
      const known = FIELD_LABELS[base];
      const bucket = PROFILE_KEYS.has(base) ? profileLabels : known ? reportLabels : otherLabels;
      const label = known ?? key;
      if (!bucket.includes(label)) bucket.push(label);
    }
    const parts: string[] = [];
    if (profileLabels.length > 0) {
      parts.push(`健康档案（${profileLabels.join('、')}）`);
    }
    if (reportLabels.length > 0) {
      parts.push(`检查报告（${reportLabels.join('、')}）`);
    }
    if (otherLabels.length > 0) {
      parts.push(`其他数据（${otherLabels.join('、')}）`);
    }
    return `本次引用了你的：${parts.join('、')}`;
  }
  if (input.usedPersonalData === false && (input.toolCalls?.length ?? 0) > 0) {
    return '本次回答仅基于公共 FSHD 知识资料，未读取你的个人数据。';
  }
  return null;
};
