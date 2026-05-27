/**
 * Patient profile retriever.
 *
 * Pulls the authenticated user's profile + baseline_payload via SQL and
 * exposes the result as **structured fields** under `chunk.metadata.fields`.
 *
 * Privacy contract (see PR #23 review):
 *   - `chunk.content` and `citation.snippet` are deliberately generic
 *     placeholders. They never contain raw patient data, raw dates,
 *     names, or any other identifier. Anything an LLM might quote has
 *     to travel through `security/render.ts → renderChunkForPrompt`
 *     so the redactor + allowlist get a chance to filter it first.
 *   - The retriever still surfaces raw values in `metadata.fields`;
 *     it is the orchestrator's job (Phase 2B) to call the renderer
 *     before injecting anything into a prompt.
 *
 * Refuses to read when:
 *   - `ctx.userId` is null (no user in scope)
 *   - `ctx.consentLevel` is 'none' or missing (user hasn't agreed
 *     to personal data use yet)
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
import { emptyResult } from './base.js';

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
 * Project a profile row into the raw structured-field map that the
 * PIIRedactor consumes. The keys here intentionally mirror the
 * allowlist + hard-delete entries in `security/allowlist.ts` so the
 * redactor can decide field-by-field what reaches the prompt.
 *
 * **Raw values are kept on purpose.** Hard-delete strips the obvious
 * identifiers (fullName, DOB, district, notes), and strict-mode
 * clinicalisation collapses D4Z4 / haplotype / methylation / dates.
 * The renderer (security/render.ts) is what produces the user-facing
 * text — this function only assembles the input.
 */
const buildProfileFields = (row: ProfileRow): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};

  // Hard-delete keys are included so the redactor visibly removes
  // them. Listing them keeps the audit trail honest ("this field
  // was in scope but stripped at layer 1").
  if (row.full_name) fields.fullName = row.full_name;
  if (row.date_of_birth) fields.dateOfBirth = formatDate(row.date_of_birth);
  if (row.region_district) fields.regionDistrict = row.region_district;
  if (row.notes) fields.notes = row.notes;

  // Strict-mode clinicalisation candidates.
  if (row.diagnosis_date) fields.diagnosisDate = formatDate(row.diagnosis_date);

  // Pass-through (subject to allowlist).
  if (row.gender) fields.gender = row.gender;
  if (row.diagnosis_stage) fields.diagnosisStage = row.diagnosis_stage;

  const baseline = row.baseline_payload;
  const foundation = baselineSection(baseline, 'foundation');
  const disease = baselineSection(baseline, 'diseaseBackground');
  const current = baselineSection(baseline, 'currentStatus');

  if (foundation) {
    if (foundation.diagnosisYear !== undefined && foundation.diagnosisYear !== null) {
      fields.diagnosisYear = foundation.diagnosisYear;
    }
  }

  if (disease) {
    if (typeof disease.diagnosisType === 'string' && disease.diagnosisType) {
      fields.diagnosisType = disease.diagnosisType;
    }
    if (disease.d4z4 !== undefined && disease.d4z4 !== null && disease.d4z4 !== '') {
      fields.d4z4 = disease.d4z4;
    }
    if (typeof disease.haplotype === 'string' && disease.haplotype) {
      fields.haplotype = disease.haplotype;
    }
    if (
      disease.methylation !== undefined &&
      disease.methylation !== null &&
      disease.methylation !== ''
    ) {
      fields.methylation = disease.methylation;
    }
    if (typeof disease.onsetRegion === 'string' && disease.onsetRegion) {
      fields.onsetRegion = disease.onsetRegion;
    }
    if (typeof disease.familyHistory === 'string' && disease.familyHistory) {
      fields.familyHistory = disease.familyHistory;
    }
  }

  if (current) {
    if (typeof current.independentlyAmbulatory === 'boolean') {
      fields.independentlyAmbulatory = current.independentlyAmbulatory;
    }
    if (Array.isArray(current.assistiveDevices) && current.assistiveDevices.length > 0) {
      fields.assistiveDevices = current.assistiveDevices.filter(Boolean);
    }
  }

  return fields;
};

/** Generic placeholder content for chunks that carry patient PII in
 *  metadata. Used in both `chunk.content` and `citation.snippet` so
 *  no raw value leaks via the citation UI either. */
const PLACEHOLDER_CONTENT = '【患者基础档案 — 字段经 PIIRedactor 处理后由 ContextBuilder 渲染】';
const PLACEHOLDER_SNIPPET = '你的患者档案';

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
    const fields = buildProfileFields(row);
    const chunkId = randomUUID();

    const chunk: RetrievedChunk = {
      id: chunkId,
      source: this.id,
      content: PLACEHOLDER_CONTENT,
      metadata: {
        profileId: row.id,
        hasBaseline: row.baseline_payload != null,
        fields,
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
      snippet: PLACEHOLDER_SNIPPET,
    };

    return {
      retrieverId: this.id,
      chunks: [chunk],
      citations: [citation],
      metadata: {
        profileId: row.id,
        fieldCount: Object.keys(fields).length,
      },
    };
  }
}
