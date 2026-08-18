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
import type { GeneticEvidenceDocumentLike } from '../../patient-profile/genetic-evidence.js';
import { readGeneticEvidence } from '../../patient-profile/genetic-evidence.js';
import { AMBULATION_STATES } from '../../patient-profile/profile.constants.js';
import type { AmbulationState } from '../../patient-profile/profile.constants.js';

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

/** The columns `readGeneticEvidence` reads off a document row. Narrow
 *  on purpose — this retriever needs the provenance answer, not the
 *  documents. */
interface DocumentRow {
  id: string;
  document_type: string | null;
  status: string | null;
  uploaded_at: string | Date | null;
  ocr_payload: unknown;
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

const isAmbulationState = (v: unknown): v is AmbulationState =>
  typeof v === 'string' && (AMBULATION_STATES as readonly string[]).includes(v);

const baselineSection = (
  payload: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null => {
  if (!payload) return null;
  const section = (payload as Record<string, unknown>)[key];
  return isPlainObject(section) ? section : null;
};

/**
 * WHETHER AN ARCHIVED GENETICS CELL IS A VALUE THIS PLATFORM READ OFF
 * THE GENETICS LABORATORY'S OWN REPORT.
 *
 * The redactor has to decide what the assistant may say about
 * `diseaseBackground.d4z4` and `.haplotype`, and it had no way to ask:
 * it passed `fromLaboratoryReport: false` as a constant, so the prompt
 * asserted `not_read_off_a_laboratory_report` about EVERY archived
 * genetics cell — including the cells the read-time autofill copied out
 * of a parsed genetics report. For the same profile in the same run the
 * passport resolved those cells to `kind: 'report'` / 「报告读取」 and the
 * TREAT-NMD provenance sentence ended 「所以这个值是基因报告的解析结果」.
 * A patient whose genetics report this platform DID read could be told
 * by the assistant the opposite of what their passport, share page,
 * referral pack, PDF and registry export all say — and the assistant is
 * the surface that generates advice off the answer.
 *
 * THE TEST IS THE ONE `geneticResultValue` ALREADY PERFORMS for the
 * TREAT-NMD document: the archived string equals the line this
 * platform reads off the ONE document `pickGeneticEvidenceDocument`
 * names, AND that document is the laboratory's own report
 * (`readGeneticEvidence(...).laboratory`). Asked through
 * `readGeneticEvidence` rather than restated here, so the assistant
 * cannot answer 「where did this value come from」 differently from the
 * exports built off the same profile in the same request.
 *
 * FALSE IS STILL THE DEFAULT, and it stays the honest one: a value the
 * patient typed, a value quoted off a 病历摘要, and a value that no
 * longer matches the report it was autofilled from are all cells this
 * platform did not read off a laboratory report, and the redactor's
 * refusal is correct for every one of them.
 *
 * EVERY CELL THE AUTOFILL WRITES IS ANSWERED FOR, AND IT USED TO BE
 * TWO OF FOUR. `applyGeneticReportAutofill` copies 分型, D4Z4 重复数,
 * 单倍型 and 甲基化 out of the picked report into the registration
 * form's empty boxes; this function computed the answer for `d4z4` and
 * `haplotype` alone. So `buildProfileFields` wrote `fields.methylation`
 * with no flag beside it and the redactor, reading an absent flag as
 * `false`, asserted `not_read_off_a_laboratory_report` about a value
 * the passport, the share page, the referral pack, the PDF and the
 * registry export were all attributing to the laboratory report in the
 * same request — printed inside the same profile block as two sibling
 * readings that can only be minted when the flag is TRUE. A prompt
 * contradicting itself about one document is worse than either answer
 * alone, because nothing in it says the other exists. 分型 was the same
 * gap one cell further on, and it had no refusal at all.
 */
type GeneticCellOrigins = {
  diagnosisType: boolean;
  d4z4: boolean;
  haplotype: boolean;
  methylation: boolean;
};

const NO_LABORATORY_ORIGIN: GeneticCellOrigins = {
  diagnosisType: false,
  d4z4: false,
  haplotype: false,
  methylation: false,
};

const geneticCellsFromLaboratoryReport = (
  disease: Record<string, unknown> | null,
  documents: readonly GeneticEvidenceDocumentLike[],
): GeneticCellOrigins => {
  const evidence = readGeneticEvidence(documents);
  if (!evidence.laboratory) return NO_LABORATORY_ORIGIN;
  const matches = (archived: unknown, line: string | null): boolean =>
    line !== null &&
    archived !== null &&
    archived !== undefined &&
    String(archived).trim() === line;
  return {
    diagnosisType: matches(disease?.diagnosisType, evidence.diagnosisType),
    d4z4: matches(disease?.d4z4, evidence.d4z4),
    haplotype: matches(disease?.haplotype, evidence.haplotype),
    methylation: matches(disease?.methylation, evidence.methylation),
  };
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
const buildProfileFields = (
  row: ProfileRow,
  fromLaboratoryReport: GeneticCellOrigins,
): Record<string, unknown> => {
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
      fields.diagnosisTypeFromLaboratoryReport = fromLaboratoryReport.diagnosisType;
    }
    // Each genetics cell travels with the answer to 「did this platform
    // read this off a laboratory's own report」. No flag reaches a
    // prompt — the redactor consumes them and drops them all (see
    // `clinicalise`) — they exist so the reading beside the cell can be
    // this platform's real position rather than a hardcoded refusal.
    // ALL FOUR CELLS THE AUTOFILL WRITES CARRY ONE; 分型 and 甲基化 used
    // to travel bare, and an absent flag reads as `false`.
    // See `geneticCellsFromLaboratoryReport`.
    if (disease.d4z4 !== undefined && disease.d4z4 !== null && disease.d4z4 !== '') {
      fields.d4z4 = disease.d4z4;
      fields.d4z4FromLaboratoryReport = fromLaboratoryReport.d4z4;
    }
    if (typeof disease.haplotype === 'string' && disease.haplotype) {
      fields.haplotype = disease.haplotype;
      fields.haplotypeFromLaboratoryReport = fromLaboratoryReport.haplotype;
    }
    if (
      disease.methylation !== undefined &&
      disease.methylation !== null &&
      disease.methylation !== ''
    ) {
      fields.methylation = disease.methylation;
      fields.methylationFromLaboratoryReport = fromLaboratoryReport.methylation;
    }
    if (typeof disease.onsetRegion === 'string' && disease.onsetRegion) {
      fields.onsetRegion = disease.onsetRegion;
    }
    if (typeof disease.familyHistory === 'string' && disease.familyHistory) {
      fields.familyHistory = disease.familyHistory;
    }
  }

  if (current) {
    // Migration 022 back-filled this column to AMBULATION_STATES and
    // added a CHECK that rejects booleans, so the `typeof ===
    // 'boolean'` guard that used to be here stopped matching anything
    // the day it ran: the field silently left every prompt, including
    // the 'unable' of a wheelchair user asking which home exercises
    // suit them. baseline_payload is read as raw JSONB with no Zod
    // parse, so the value is checked against the state list here
    // rather than trusted.
    if (isAmbulationState(current.independentlyAmbulatory)) {
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

    // The documents this profile's genetics cells could have been
    // autofilled out of. Read with the same reader the passport and the
    // exports use, so all three answer 「where did this value come
    // from」 the same way for one profile in one request. A read that
    // returns nothing leaves both flags false, which is the refusal the
    // redactor already defaults to.
    const documents = await this.pool.query<DocumentRow>(
      `SELECT id, document_type, status, uploaded_at, ocr_payload
       FROM patient_documents
       WHERE profile_id = $1`,
      [row.id],
    );
    const disease = baselineSection(row.baseline_payload, 'diseaseBackground');
    const fromLaboratoryReport = geneticCellsFromLaboratoryReport(
      disease,
      documents.rows.map((doc) => ({
        id: doc.id,
        documentType: doc.document_type,
        status: doc.status,
        uploadedAt: formatDate(doc.uploaded_at),
        ocrPayload: doc.ocr_payload,
      })),
    );

    const fields = buildProfileFields(row, fromLaboratoryReport);
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
