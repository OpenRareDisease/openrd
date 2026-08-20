/**
 * Patient profile retriever.
 *
 * Pulls the authenticated user's profile + baseline_payload via SQL,
 * runs the platform's READ-TIME PROJECTION over it
 * (`applyGeneticReportAutofill`, the same call `getProfileByUserId` and
 * `getBaselineByUserId` make), and exposes the result as **structured
 * fields** under `chunk.metadata.fields`.
 *
 * The projection is not optional and is not a nicety. Every other
 * surface on this platform — the passport, the share page, the referral
 * pack, the PDF, the three registry exports, the patient's own
 * questionnaire — reads the profile through it, so a retriever that
 * skips it is answering questions about a different patient record than
 * the one the patient is looking at. See `search`.
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
import { applyGeneticReportAutofill } from '../../patient-profile/profile.autofill.js';
import { AMBULATION_STATES } from '../../patient-profile/profile.constants.js';
import type { AmbulationState } from '../../patient-profile/profile.constants.js';
import { withholdUnsafeReadings } from '../../patient-profile/profile.service.js';

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

/**
 * A `date` COLUMN IS A DAY, AND `toISOString` IS NOT HOW YOU READ ONE.
 *
 * The same rule `toDateString` in profile.service.ts states, and the
 * same reading, because the two are describing one column to one
 * patient. node-postgres decodes `date` (OID 1082) as
 * `new Date(y, m - 1, d)` — midnight in the SERVER PROCESS'S ZONE — and
 * this retriever re-read that instant in UTC. East of Greenwich
 * midnight local is the PREVIOUS DAY in UTC, and this product runs
 * `TZ=Asia/Shanghai` (apps/api/Dockerfile).
 *
 * So `patient_profiles.diagnosis_date` came off this path one day
 * early, on the one date a patient is asked for at every appointment.
 * It does not stop at a day, because nothing downstream prints the day:
 * the redactor reduces this cell to `diagnosisYear` (`clinicalise` in
 * security/pii-redactor.ts), and the questionnaire's 确诊年份 is mirrored
 * into this column as `${year}-01-01` (`upsertBaseline`). A year start
 * shifted one day back is the PREVIOUS YEAR — so a patient who answered
 * 2023 was told by the assistant they were diagnosed in 2022, on the
 * same request whose passport, share page, PDF and registry exports all
 * said 2023. `date_of_birth` is the same column type and was shifted
 * the same way before hard-delete removed it.
 *
 * A string is split rather than re-parsed, for the same reason: the day
 * is already written in it.
 */
const formatDayColumn = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return value.includes('T') ? value.split('T')[0] : value;
};

/**
 * A `timestamptz` IS AN INSTANT, AND IT IS NOT A DAY EITHER.
 *
 * `patient_documents.uploaded_at` was read through the day formatter
 * above, which threw away the time — and the time is what
 * `pickGeneticEvidenceDocument` orders two otherwise-equal candidates
 * by. Truncated to a day, two reports uploaded the same afternoon tie
 * on `time` and fall through to the id comparator, so this retriever
 * could pick the OTHER report from the one the passport, the referral
 * pack and the registry exports all read — a different D4Z4 count and a
 * different 分型 for one profile in one request, with nothing on either
 * surface saying the other existed.
 *
 * The whole instant, therefore, which is what `toTimestampString` hands
 * the picker on the profile path.
 */
const formatInstant = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
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
 * THE CELL IT IS ASKED ABOUT IS THE PROJECTED ONE, and that is what
 * makes the question answerable at all. `search` runs
 * `applyGeneticReportAutofill` before calling this, so a report-derived
 * profile arrives here with the report's own line sitting in the box.
 * Asked of the RAW column it was asked of an empty cell for exactly the
 * patients whose genetics this platform did read, and answered `false`
 * about every one of them.
 *
 * FALSE IS STILL THE DEFAULT, and it stays the honest one: a value the
 * patient typed, a value quoted off a 病历摘要, and a value that no
 * longer matches the report it was autofilled from are all cells this
 * platform did not read off a laboratory report, and the redactor's
 * refusal is correct for every one of them. The autofill cannot move
 * any of the three into `true`: it fills EMPTY boxes only, so a cell it
 * wrote is the report's line by construction and a cell it left alone
 * is whatever the archive held.
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
  if (row.date_of_birth) fields.dateOfBirth = formatDayColumn(row.date_of_birth);
  if (row.region_district) fields.regionDistrict = row.region_district;
  if (row.notes) fields.notes = row.notes;

  // Strict-mode clinicalisation candidates.
  if (row.diagnosis_date) fields.diagnosisDate = formatDayColumn(row.diagnosis_date);

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
    // returns nothing leaves every flag false, which is the refusal the
    // redactor already defaults to.
    const documents = await this.pool.query<DocumentRow>(
      `SELECT id, document_type, status, uploaded_at, ocr_payload
       FROM patient_documents
       WHERE profile_id = $1`,
      [row.id],
    );

    /**
     * THE READ GUARD EVERY OTHER READER OF A STORED PAYLOAD GOES
     * THROUGH.
     *
     * `withholdUnsafeReadings` is what the profile projection, the
     * single-document endpoint and the reports retriever all apply
     * before anything reads a payload — a parser fix does not reparse,
     * so the archive holds readings the guard withholds. It cannot
     * touch a genetics cell (`resolveLabAnalyte` in profile.service.ts
     * resolves biochemistry keys only, deliberately, so a repeat count
     * of 4 beside a 4qA haplotype is never read as one row twice), and
     * it is applied here anyway for the reason it is applied there: the
     * document objects built below are the only copy of the payload in
     * this scope, and an unguarded one left standing is how this class
     * of hole gets reopened.
     */
    const evidenceDocuments: GeneticEvidenceDocumentLike[] = documents.rows.map((doc) => ({
      id: doc.id,
      documentType: doc.document_type,
      status: doc.status,
      uploadedAt: formatInstant(doc.uploaded_at),
      ocrPayload: withholdUnsafeReadings(doc.ocr_payload ?? null),
    }));

    /**
     * THE READ-TIME PROJECTION, RUN HERE TOO.
     *
     * This retriever read `baseline_payload` straight out of SQL and
     * took `diseaseBackground` off it raw, so the assistant was the one
     * surface on this platform that never saw the profile the platform
     * serves. `applyGeneticReportAutofill` fills an EMPTY 分型 / D4Z4
     * 重复数 / 单倍型 / 甲基化 box, and an empty 确诊年份 and
     * `diagnosis_date`, out of the report `pickGeneticEvidenceDocument`
     * names — `getProfileByUserId` and `getBaselineByUserId` both apply
     * it, so the passport, the share page, the referral pack, the PDF,
     * the three registry exports and the patient's own questionnaire
     * screen are all built on its output.
     *
     * For a patient whose genetics came off a report rather than out of
     * the form, that meant their passport printed the count with
     * 「报告读取」 beside it while `get_my_profile` returned a profile with
     * no genetics in it at all — and the assistant then answered
     * 「你的档案里还没有 D4Z4 重复数」 about a number on the page the
     * patient was looking at.
     *
     * IT ALSO FED THE CONFIRMATION GUARD THE WRONG FACTS.
     * `geneticCellsFromLaboratoryReport` below asks whether an archived
     * cell IS the line this platform read off the laboratory's own
     * report; asked of an EMPTY cell it answered `false` for every
     * report-derived profile, which is the state the redactor turns
     * into `not_read_off_a_laboratory_report`. The guard was refusing
     * to grade values it could not see.
     *
     * THE DIRECTION MATTERS AND IT IS NOT WIDENED HERE. The autofill
     * exists so a patient does not retype what the report already says;
     * whether a value may be GRADED is a separate question, and it is
     * still `readGeneticEvidence(...).laboratory` that answers it. A
     * cell filled from a 病历摘要 lands in the box exactly as one filled
     * from a Southern blot does, and the flag beside it stays `false` —
     * the same split the passport draws when it prints
     * 「转录自非基因报告文件」 over a value it is showing but will not
     * grade.
     */
    const projected = applyGeneticReportAutofill(
      {
        diagnosisDate: formatDayColumn(row.diagnosis_date),
        geneticMutation: row.genetic_mutation,
        baseline: row.baseline_payload,
      },
      evidenceDocuments,
    );
    const projectedRow: ProfileRow = {
      ...row,
      diagnosis_date: projected.diagnosisDate,
      genetic_mutation: projected.geneticMutation,
      baseline_payload: isPlainObject(projected.baseline) ? projected.baseline : null,
    };

    const disease = baselineSection(projectedRow.baseline_payload, 'diseaseBackground');
    const fromLaboratoryReport = geneticCellsFromLaboratoryReport(disease, evidenceDocuments);

    const fields = buildProfileFields(projectedRow, fromLaboratoryReport);
    const chunkId = randomUUID();

    const chunk: RetrievedChunk = {
      id: chunkId,
      source: this.id,
      content: PLACEHOLDER_CONTENT,
      metadata: {
        profileId: row.id,
        // THE ARCHIVE, NOT THE PROJECTION. A questionnaire the patient
        // has filled in is a different fact from a genetics cell the
        // read-time autofill topped up, and this key has always meant
        // the first one. What the projection produced is in `fields`,
        // where a reader who wants the values finds them.
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
