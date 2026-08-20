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
 *
 * THAT SENTENCE STOPPED BEING TRUE ONCE, AND A TEST NOW HOLDS IT TO IT.
 * The allowlist grew a third scope — `followups`, everything
 * `get_my_records` contributes — and this file had no entry for a single
 * one of its thirteen keys, so an answer built from the patient's own
 * 随访记录 printed 「其他数据（metricKey、metricLabel、count…）」: the
 * engineering vocabulary this module exists to remove, under a group
 * name that calls the patient's own follow-up record 其他. `uploadYear`
 * was in the same state on the reports side while its sibling
 * `reportDate_year` had a label, and `get_my_records` /
 * `list_clinical_trials` — both registered on the live route — printed
 * their raw tool ids in the trace chips. The fallback did its job
 * (nothing vanished); what it could not do is notice.
 *
 * `humanize-allowlist-parity.test.ts` now reads PROMPT_ALLOWLIST and the
 * route's registry out of the API source and fails when a key or a tool
 * id has no label here, so the next scope cannot land silently.
 */

import type { AiToolCallSummary } from '../../lib/api';

/** Tool id → the action, in the words a patient would use. Every tool
 *  the live route registers (`new ToolRegistry()` in
 *  apps/api/src/routes/ai-chat.routes.ts) needs one; the parity test
 *  reads that chain and fails when one is missing. */
const TOOL_LABELS: Record<string, string> = {
  search_medical_kb: '检索 FSHD 知识库',
  get_my_profile: '读取你的健康档案',
  get_my_reports: '查阅你的检查报告',
  get_my_records: '读取你的随访记录',
  // Public registry data, not the patient's — the label says which
  // thing was looked up rather than 「查阅你的…」, which every other
  // patient-scoped tool above says.
  list_clinical_trials: '查询临床试验登记信息',
};

export const humanizeToolName = (name: string): string => TOOL_LABELS[name] ?? name;

/** Allowlist key → plain label. `_clinical`, `_withheld` and `_origin`
 *  variants collapse onto their base key before lookup: strict mode
 *  surfaces d4z4_clinical where precise mode surfaces d4z4, a
 *  methylation measurement surfaces methylation_withheld where a
 *  laboratory word surfaces methylation, and methylation_origin says
 *  where that same cell came from — the same asset to the patient in
 *  every case, and an unmapped key is printed to them verbatim.
 *
 *  No 年龄段 and no 症状类型: both are off the API's allowlists, so
 *  neither key can arrive and a label here is one this screen can
 *  never use. See PROMPT_ALLOWLIST. THAT SENTENCE IS NOW CHECKED
 *  RATHER THAN REMEMBERED — `labelledFieldKeys` below exists so
 *  humanize-allowlist-parity.test.ts can read this table back against
 *  the API's lists in the other direction, and adding 年龄段 here fails
 *  it. */
const FIELD_LABELS: Record<string, string> = {
  // profile scope
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
  // reports scope
  classifiedType: '报告类型',
  documentType: '文档类型',
  reportDate_year: '报告年份',
  // NOT the same cell as `reportDate_year`, and it gets its own label
  // for that reason. The API's own note says they were one key once —
  // 报告年份 was derived from the upload time and the prompt dated a
  // 2019 report to 2026. One label for both would put that conflation
  // back on the patient's side of the wire.
  uploadYear: '上传年份',
  status: '报告状态',
  fields: '报告识别指标',
  // THE REPORT'S OWN CONCLUSION, AND THE FOUR CELLS THAT SAY WHAT WAS
  // DONE TO IT. FIVE KEYS, FIVE LABELS, AND THAT IS THE POINT.
  //
  // The followup pairs below share one label because each pair is one
  // datum spelled two ways. These five are not that. One of them is the
  // report's sentence; the other four are statements ABOUT that
  // sentence — and in `reportImpressionWithheld`'s case, a statement
  // that the sentence never travelled at all.
  //
  // Giving all five the single label 报告原文结论 printed
  // 「本次引用了你的：检查报告（…、报告原文结论）」 for a 病历摘要 whose
  // impression Gate 0 refused: a citation line claiming the patient's
  // own conclusion had been read, in the one case where nothing of it
  // was. The frame is 「本次引用了你的」, so every label inside it is a
  // claim that the thing was read, and a label may not be true of one
  // key and false of the next.
  //
  // WHAT THIS SCREEN CANNOT SAY, stated rather than left to be found.
  // The four refusals — narrative document, kind not established,
  // identifiers not removable, a number not classifiable — are four
  // VALUES of one key, and `fieldsUsed` is `Object.keys(fields)`
  // (security/render.ts). Only the key crosses the wire, so all four
  // render the line below. It is worded to be true of every one of them
  // rather than to guess which one happened.
  //
  // The three counters are only ever emitted BESIDE a published
  // sentence — `put()` in pii-redactor.ts drops a zero, and a refusal
  // zeroes all three — so 结论 in the last three labels always has
  // 报告原文结论 standing beside it in the same group.
  //
  // 报告原文结论 replaces 报告要点, the label this file carried over
  // `findings_summary`; 要点 was the wrong word even for that key,
  // because what travelled then was a summary the PLATFORM composed out
  // of a fixed vocabulary rather than anything the report had said.
  // What travels now is the report's own wording, so the label says
  // 原文.
  reportImpression: '报告原文结论',
  reportImpressionWithheld: '报告原文结论未共享的原因',
  reportImpressionValuesMasked: '结论中已隐去的数值个数',
  reportImpressionIdentifiersRemoved: '结论中已去除的身份信息处数',
  reportImpressionCharactersCut: '结论因过长被截去的字数',
  // followups scope — everything `get_my_records` contributes.
  //
  // SEVERAL KEYS SHARE A LABEL ON PURPOSE, the same way `d4z4` and
  // `d4z4_clinical` do above: this line names WHICH of the patient's
  // data was read, not how the retriever spells it. `metricKey` and
  // `metricLabel` are one datum (which measurement); `count` and
  // `countAtCap` are one (how many readings, and whether that number is
  // a floor); `changeDirection` and `latestBand` are one (which way it
  // moved, or that it could not be measured this period); `eventSummary`
  // and `eventCount` are one (the logged events). `humanizeFieldKeys`
  // dedupes by label, so each pair prints once.
  metricKey: '记录项目',
  metricLabel: '记录项目',
  count: '记录次数',
  countAtCap: '记录次数',
  spanDays: '记录时间跨度',
  unableSummary: '记录为「做不到」的次数',
  changeDirection: '变化趋势',
  latestBand: '变化趋势',
  unit: '测量单位',
  latestValue: '最近一次数值',
  series: '历次数值',
  eventSummary: '随访事件',
  eventCount: '随访事件',
};

/**
 * THE OTHER DIRECTION OF THE PARITY CHECK, WHICH HAD NO READER.
 *
 * `humanize-allowlist-parity.test.ts` reads PROMPT_ALLOWLIST and fails
 * when a key on it has no label here. Nothing asked the reverse
 * question — whether a label here names a key the API can actually send
 * — and the answer was kept by hand, in the 年龄段 / 症状类型 note on
 * FIELD_LABELS above. A hand-kept claim about the API's lists is
 * exactly what let the whole `followups` scope arrive unlabelled, and a
 * label for an unreachable key is the same defect pointing the other
 * way: a line this screen can never print, and a maintainer reading it
 * as evidence that the key still exists.
 *
 * KEYS RATHER THAN THE TABLE, AND A FUNCTION RATHER THAN THE OBJECT, so
 * the only thing this export can do is answer that question. Nothing
 * outside this module can reach a label without going through
 * `humanizeFieldKeys`, which is where the suffix collapsing and the
 * dedupe live.
 */
export const labelledFieldKeys = (): readonly string[] => Object.keys(FIELD_LABELS);

/** Same question, asked of the tool chips. See `labelledFieldKeys`. */
export const labelledToolIds = (): readonly string[] => Object.keys(TOOL_LABELS);

/** The three scopes, as the allowlist declares them. Membership decides
 *  which group a label is printed under, so these are checked against
 *  PROMPT_ALLOWLIST by the parity test rather than kept by hand — a key
 *  in the wrong set puts the patient's follow-up record under 检查报告
 *  without changing a single label. */
const PROFILE_KEYS = new Set([
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
]);

const REPORT_KEYS = new Set([
  'classifiedType',
  'documentType',
  'reportDate_year',
  'uploadYear',
  'status',
  'fields',
  'reportImpression',
  'reportImpressionWithheld',
  'reportImpressionValuesMasked',
  'reportImpressionIdentifiersRemoved',
  'reportImpressionCharactersCut',
]);

const FOLLOWUP_KEYS = new Set([
  'metricKey',
  'metricLabel',
  'count',
  'countAtCap',
  'spanDays',
  'unableSummary',
  'changeDirection',
  'latestBand',
  'unit',
  'latestValue',
  'series',
  'eventSummary',
  'eventCount',
]);

/**
 * Suffixes that mark a statement ABOUT a cell rather than a second
 * cell. All three name the same asset to the patient, so all three
 * resolve to the base key's label and to the base key's scope.
 *
 * `_origin` was added because the parity test caught it arriving:
 * `methylation_origin` is on the profile allowlist — it says where the
 * methylation cell came from, on the same footing as `d4z4_clinical` —
 * and with only two suffixes here it resolved to nothing, so an answer
 * that read the patient's methylation origin printed 「其他数据
 * （methylation_origin）」. Nothing in this app would have noticed; the
 * test that reads the API's list did, which is the whole reason it
 * exists.
 */
const DERIVED_SUFFIXES = ['_clinical', '_withheld', '_origin'] as const;

const baseKey = (key: string): string => {
  for (const suffix of DERIVED_SUFFIXES) {
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return key;
};

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
 * - Personal data used → 「本次引用了你的：健康档案（诊断分型、甲基化
 *   结果）、检查报告（报告原文结论）」 grouped by asset, in plain labels.
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
    // One bucket per allowlist scope, plus one for keys this bundle has
    // no mapping for. Unknown keys get their own bucket instead of being
    // mislabeled as report data — verbatim but honestly grouped.
    //
    // 其他数据 IS FOR KEYS WE DO NOT KNOW, AND NOTHING ELSE. It used to
    // catch a whole scope: the bucket was chosen as 「profile, else
    // anything with a label, else other」, so every `followups` key —
    // none of which had a label — landed in 其他数据 and the patient's
    // own 随访记录 was filed under 其他. Each scope now names itself.
    const profileLabels: string[] = [];
    const reportLabels: string[] = [];
    const followupLabels: string[] = [];
    const otherLabels: string[] = [];
    for (const key of input.fieldsUsed ?? []) {
      const base = baseKey(key);
      const known = FIELD_LABELS[base];
      const bucket = PROFILE_KEYS.has(base)
        ? profileLabels
        : REPORT_KEYS.has(base)
          ? reportLabels
          : FOLLOWUP_KEYS.has(base)
            ? followupLabels
            : otherLabels;
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
    if (followupLabels.length > 0) {
      parts.push(`随访记录（${followupLabels.join('、')}）`);
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
