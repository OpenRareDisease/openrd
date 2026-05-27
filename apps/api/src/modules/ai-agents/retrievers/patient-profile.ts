/**
 * Patient profile retriever.
 *
 * Pulls the authenticated user's profile + baseline_payload via SQL
 * and returns a single chunk summarising the fields relevant to a
 * medical Q&A: demographics, FSHD background, current functional
 * status. PII redaction is **not** done here — the orchestrator
 * passes the chunk through PIIRedactor before it ever lands in a
 * prompt.
 *
 * The retriever refuses to read when:
 *   - `ctx.userId` is null (no user in scope)
 *   - `ctx.consentLevel` is 'none' (user hasn't agreed to personal
 *     data use yet)
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type {
  Citation,
  IRetriever,
  RetrieveContext,
  RetrieveInput,
  RetrieveResult,
  RetrievedChunk,
} from './base.js';
import { buildSnippet, emptyResult } from './base.js';

interface ProfileRow {
  id: string;
  full_name: string | null;
  date_of_birth: string | Date | null;
  gender: string | null;
  diagnosis_stage: string | null;
  diagnosis_date: string | Date | null;
  genetic_mutation: string | null;
  region_province: string | null;
  region_city: string | null;
  region_district: string | null;
  baseline_payload: Record<string, unknown> | null;
  notes: string | null;
}

const formatDate = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
};

const ageGroupFromDate = (value: string | Date | null | undefined): string | null => {
  const iso = formatDate(value);
  if (!iso) return null;
  const year = Number(iso.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  const age = new Date().getUTCFullYear() - year;
  if (age < 0 || age > 120) return null;
  if (age < 18) return 'under_18';
  if (age < 30) return '18_29';
  if (age < 40) return '30_39';
  if (age < 50) return '40_49';
  if (age < 60) return '50_59';
  if (age < 70) return '60_69';
  return '70_plus';
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const baselineSection = (
  payload: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null => {
  if (!payload) return null;
  const section = (payload as Record<string, unknown>)[key];
  return isPlainObject(section) ? section : null;
};

/**
 * Build the text body the retriever emits as a "chunk". The format
 * is a compact key/value list that LLMs read reliably without us
 * having to teach them a custom DSL. Intentionally keeps **all**
 * fields available — Layer 1/2/3 redaction happens downstream.
 */
const renderProfileChunk = (row: ProfileRow): string => {
  const lines: string[] = ['【患者基础档案】'];

  const ageGroup = ageGroupFromDate(row.date_of_birth);
  if (ageGroup) lines.push(`年龄段: ${ageGroup}`);
  if (row.gender) lines.push(`性别: ${row.gender}`);
  if (row.diagnosis_stage) lines.push(`诊断阶段: ${row.diagnosis_stage}`);

  const diagnosisDate = formatDate(row.diagnosis_date);
  if (diagnosisDate) lines.push(`确诊日期: ${diagnosisDate}`);
  if (row.genetic_mutation) lines.push(`基因突变描述: ${row.genetic_mutation}`);

  if (row.region_province || row.region_city) {
    lines.push(`地区: ${[row.region_province, row.region_city].filter(Boolean).join(' / ')}`);
  }

  const baseline = row.baseline_payload;
  const foundation = baselineSection(baseline, 'foundation');
  const disease = baselineSection(baseline, 'diseaseBackground');
  const current = baselineSection(baseline, 'currentStatus');

  if (foundation) {
    if (foundation.diagnosisYear !== undefined && foundation.diagnosisYear !== null) {
      lines.push(`确诊年份: ${foundation.diagnosisYear}`);
    }
    if (typeof foundation.regionLabel === 'string' && foundation.regionLabel) {
      lines.push(`地区标签: ${foundation.regionLabel}`);
    }
  }

  if (disease) {
    if (typeof disease.diagnosisType === 'string' && disease.diagnosisType) {
      lines.push(`分型/诊断方式: ${disease.diagnosisType}`);
    }
    if (disease.d4z4 !== undefined && disease.d4z4 !== null && disease.d4z4 !== '') {
      lines.push(`D4Z4 重复数: ${disease.d4z4}`);
    }
    if (typeof disease.haplotype === 'string' && disease.haplotype) {
      lines.push(`单倍型: ${disease.haplotype}`);
    }
    if (
      disease.methylation !== undefined &&
      disease.methylation !== null &&
      disease.methylation !== ''
    ) {
      lines.push(`甲基化值: ${disease.methylation}`);
    }
    if (typeof disease.onsetRegion === 'string' && disease.onsetRegion) {
      lines.push(`首发部位: ${disease.onsetRegion}`);
    }
    if (typeof disease.familyHistory === 'string' && disease.familyHistory) {
      lines.push(`家族史: ${disease.familyHistory}`);
    }
  }

  if (current) {
    if (typeof current.independentlyAmbulatory === 'boolean') {
      lines.push(`独立行走: ${current.independentlyAmbulatory ? '是' : '否'}`);
    }
    if (Array.isArray(current.assistiveDevices) && current.assistiveDevices.length > 0) {
      lines.push(`辅具: ${current.assistiveDevices.filter(Boolean).join('、')}`);
    }
  }

  if (lines.length === 1) {
    lines.push('（暂无可用字段）');
  }
  return lines.join('\n');
};

export class PatientProfileRetriever implements IRetriever {
  readonly id = 'patient_profile';
  readonly kind = 'sql' as const;

  constructor(private readonly pool: Pool) {}

  async search(_input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult> {
    if (!ctx.userId) {
      return emptyResult(this.id, 'no_user_in_scope');
    }
    if (ctx.consentLevel === 'none' || ctx.consentLevel === undefined) {
      return emptyResult(this.id, 'consent_not_granted');
    }

    const result = await this.pool.query<ProfileRow>(
      `SELECT id, full_name, date_of_birth, gender, diagnosis_stage,
              diagnosis_date, genetic_mutation, region_province,
              region_city, region_district, baseline_payload, notes
       FROM patient_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [ctx.userId],
    );

    if (result.rowCount === 0) {
      return emptyResult(this.id, 'profile_not_found');
    }

    const row = result.rows[0];
    const content = renderProfileChunk(row);
    const chunkId = randomUUID();

    const chunk: RetrievedChunk = {
      id: chunkId,
      source: this.id,
      content,
      metadata: {
        profileId: row.id,
        hasBaseline: row.baseline_payload != null,
      },
      distance: null,
      sourceFile: 'patient_profile',
      chunkIndex: 0,
    };
    const citation: Citation = {
      chunkId,
      source: this.id,
      sourceFile: 'patient_profile',
      chunkIndex: 0,
      snippet: buildSnippet(content),
    };

    return {
      retrieverId: this.id,
      chunks: [chunk],
      citations: [citation],
      metadata: {
        profileId: row.id,
      },
    };
  }
}
