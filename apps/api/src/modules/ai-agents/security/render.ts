/**
 * Chunk renderer used by the orchestrator's Context Builder.
 *
 * Every retrieved chunk goes through this function on its way into a
 * prompt. It is the single integration point where redaction happens
 * and the only path that produces user-facing prompt text from a
 * `RetrievedChunk`. This guarantees that the chunk fields-only design
 * adopted in PR #23 cannot be bypassed: the retrievers expose raw
 * patient data in `metadata.fields`, this renderer applies
 * `redactFields(...)` before composing the text.
 *
 * Behaviour by source:
 *   - `medical_kb`   : public medical knowledge. No PII to redact;
 *                     `chunk.content` passes through unchanged.
 *   - `platform_docs`: same.
 *   - `patient_*`    : structured fields in `metadata.fields` flow
 *                     through `redactFields(scope, mode)` and are
 *                     rendered to text by the scope-specific
 *                     renderer below. `chunk.content` is ignored.
 *
 * The renderer also reports which field names actually made it into
 * the prompt so the AuditLogger can record a concrete list.
 */

import type { RedactionMode, RedactionScope } from './allowlist.js';
import type { RedactionStats } from './pii-redactor.js';
import { redactFields } from './pii-redactor.js';
import type { AppLogger } from '../../../config/logger.js';
import type { RetrievedChunk } from '../retrievers/base.js';

export interface RenderedChunk {
  /** Prompt-ready text for this chunk. Empty string means the chunk
   *  contributed nothing (e.g. a no-op stub retriever). */
  content: string;
  /** Field names from the redacted output, in stable order. Empty
   *  for non-patient sources. Used by the AuditLogger. */
  fieldsUsed: string[];
  /** Stats from the redactor for this chunk. `null` when the chunk
   *  is from a non-patient source. */
  stats: RedactionStats | null;
}

export interface RenderOptions {
  mode: RedactionMode;
  logger?: AppLogger;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const scopeForSource = (source: string): RedactionScope | null => {
  switch (source) {
    case 'patient_profile':
      return 'profile';
    case 'patient_reports':
      return 'reports';
    default:
      return null;
  }
};

const formatScalar = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value))
    return value
      .map((v) => formatScalar(v))
      .filter(Boolean)
      .join('、');
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, null, 0);
  }
  return value === null || value === undefined ? '' : String(value);
};

const PROFILE_FIELD_LABELS: Record<string, string> = {
  ageGroup: '年龄段',
  gender: '性别',
  diagnosisStage: '诊断阶段',
  diagnosisYear: '确诊年份',
  diagnosisType: '分型/诊断方式',
  d4z4: 'D4Z4 重复数',
  d4z4_clinical: 'D4Z4 临床分级',
  haplotype: '单倍型',
  haplotype_clinical: '单倍型临床分级',
  methylation: '甲基化值',
  methylation_clinical: '甲基化临床分级',
  onsetRegion: '首发部位',
  familyHistory: '家族史',
  independentlyAmbulatory: '独立行走',
  assistiveDevices: '辅具',
  symptomCategories: '症状分类',
};

const REPORT_FIELD_LABELS: Record<string, string> = {
  classifiedType: '报告类型',
  documentType: '文档类型',
  reportDate: '报告日期',
  reportDate_year: '报告年份',
  status: '处理状态',
  title: '报告标题',
  findings_summary: '影像/报告印象',
};

const renderFieldsByScope = (fields: Record<string, unknown>, scope: RedactionScope): string => {
  const header = scope === 'profile' ? '【患者基础档案】' : '【患者报告】';
  const labels = scope === 'profile' ? PROFILE_FIELD_LABELS : REPORT_FIELD_LABELS;
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    return `${header}\n（无可用字段）`;
  }

  const lines: string[] = [header];

  for (const [key, value] of entries) {
    if (value === null || value === undefined || value === '') continue;
    if (key === 'fields' && isPlainObject(value)) {
      // Precise-mode raw OCR fields.
      lines.push('OCR 字段:');
      for (const [innerKey, innerValue] of Object.entries(value)) {
        if (innerValue === null || innerValue === undefined || innerValue === '') continue;
        lines.push(`  - ${innerKey}: ${formatScalar(innerValue)}`);
      }
      continue;
    }
    if (key === 'fields_clinical' && isPlainObject(value)) {
      // Strict-mode clinicalised OCR fields.
      if (Object.keys(value).length === 0) continue;
      lines.push('OCR 字段（临床化）:');
      for (const [innerKey, innerValue] of Object.entries(value)) {
        if (innerValue === null || innerValue === undefined || innerValue === '') continue;
        lines.push(`  - ${innerKey}: ${formatScalar(innerValue)}`);
      }
      continue;
    }
    const label = labels[key] ?? key;
    lines.push(`${label}: ${formatScalar(value)}`);
  }

  return lines.join('\n');
};

const passthrough = (chunk: RetrievedChunk): RenderedChunk => ({
  content: chunk.content,
  fieldsUsed: [],
  stats: null,
});

/**
 * Turn a `RetrievedChunk` into prompt-ready text for the active
 * consent / redaction mode. **This is the only function the
 * orchestrator should call** when composing prompt context — anything
 * that bypasses it risks leaking raw patient data.
 */
export const renderChunkForPrompt = (
  chunk: RetrievedChunk,
  options: RenderOptions,
): RenderedChunk => {
  const scope = scopeForSource(chunk.source);
  if (scope === null) {
    return passthrough(chunk);
  }

  const rawFields = isPlainObject(chunk.metadata?.fields)
    ? (chunk.metadata.fields as Record<string, unknown>)
    : {};

  const { fields, stats } = redactFields(rawFields, {
    scope,
    mode: options.mode,
    logger: options.logger,
  });

  return {
    content: renderFieldsByScope(fields, scope),
    fieldsUsed: Object.keys(fields),
    stats,
  };
};
