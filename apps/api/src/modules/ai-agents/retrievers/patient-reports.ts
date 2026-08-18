/**
 * Patient reports retriever.
 *
 * Joins `patient_documents` to the authenticated user's profile and
 * exposes the most recent reports as **structured fields** under each
 * chunk's `metadata.fields`.
 *
 * Privacy contract (see PR #23 review):
 *   - `chunk.content` and `citation.snippet` are deliberately generic
 *     placeholders. Raw OCR values, report titles (which can contain
 *     the patient's name), and exact upload dates never make it into
 *     a citation or a chunk body. The orchestrator must route the
 *     data through `security/render.ts → renderChunkForPrompt`.
 *   - The retriever still surfaces the raw OCR `fields` blob in
 *     `metadata.fields.fields` so the redactor can apply the
 *     strict-mode clinicalisation + allowlist before anything reaches
 *     the prompt.
 *
 * Optional filter keys:
 *   - `documentType`: filter to a specific report type
 *     (e.g. `genetic_report`, `mri`, `lab`).
 *   - `since`: ISO date string; only reports uploaded on/after this
 *     date are returned.
 *
 * Refuses to read when there's no user in scope or consent is `none`.
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

interface ReportRow {
  id: string;
  document_type: string;
  title: string | null;
  uploaded_at: string | Date;
  status: string;
  ocr_payload: Record<string, unknown> | null;
  classified_type: string | null;
  report_type_label: string | null;
}

const RECENT_LIMIT_DEFAULT = 5;
const RECENT_LIMIT_MAX = 20;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const formatTimestamp = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

/**
 * Keys the OCR pipeline files a report's narrative conclusion under.
 */
const IMPRESSION_KEYS = [
  'reportImpression',
  'report_impression',
  'impressionText',
  'impression',
  'interpretationSummary',
  'interpretation_summary',
  'findings',
  'conclusion',
];

/**
 * Clinical findings vocabulary — the ONLY things allowed out of a
 * report's narrative.
 *
 * Why a vocabulary and not a scrubber
 * -----------------------------------
 * The allowlist has had a `findings_summary` slot since PR #23 and
 * nothing filled it, so the model could learn a report's *type* but
 * never its *conclusion* —「这份报告说明什么」was unanswerable by
 * construction. Filling it is worth doing; the question is how.
 *
 * The first attempt scrubbed the impression: strip identifiers by
 * pattern, then strip any name the same payload had extracted. The
 * render.test.ts regression fence rejected it, correctly. Its fixture
 * reads「受检者张三，右大腿后群 STIR 信号显著增高」— a name the OCR
 * never filed under a key of its own, so there was nothing to strip it
 * by. Chinese names have no reliable pattern; a scrubber over
 * free-form prose is allow-by-default wearing a safety costume, and
 * this codebase is deny-by-default everywhere else for good reason.
 *
 * So nothing passes unless it is a phrase we already recognise. A name
 * cannot survive a vocabulary match, because a name is never in the
 * vocabulary. The cost is expressiveness — we emit
 * 「肌营养不良改变、脂肪浸润」rather than the radiologist's sentence —
 * and that is the right trade: it carries the clinical substance the
 * patient asked about while making leakage structurally impossible
 * rather than probabilistically unlikely.
 *
 * Extending this list is a deliberate, reviewable act. Add the phrase,
 * not a pattern that might match one.
 */
const CLINICAL_FINDING_TERMS: readonly string[] = [
  // Muscular dystrophy / FSHD core
  '肌营养不良改变',
  '肌营养不良',
  '脂肪浸润',
  '脂肪化',
  '肌肉萎缩',
  '肌萎缩',
  '炎性改变',
  '水肿',
  '信号增高',
  '信号异常',
  '不对称',
  '受累',
  // Common qualifiers
  // NOTE: '未见明显异常' / '未见异常' were here, but they are
  // negation-shaped by construction and can never survive the clause
  // filter below. A report that asserts normality says so via the
  // absence of positive findings — findings_summary returning null.
  '大致正常',
  '轻度',
  '中度',
  '重度',
  '弥漫性',
  '局灶性',
  // Genetics
  'FSHD1',
  'FSHD2',
  '4qA',
  '4qB',
  'D4Z4',
  '重复单元缩短',
  '甲基化降低',
  // Cardiopulmonary — the other systems this cohort is monitored for
  '限制性通气功能障碍',
  '通气功能障碍',
  '弥散功能',
  '射血分数',
  '心律不齐',
  '传导阻滞',
  '膈肌',
];

/** Cap on the assembled summary. Matched terms are short; a long
 *  result means the vocabulary matched too broadly. */
const FINDINGS_SUMMARY_MAX = 120;

/**
 * Negation markers. A term appearing after one of these inside the
 * same clause means the report is ruling the finding OUT.
 *
 * Substring matching alone inverts exactly the reports that matter
 * most: 「双侧大腿肌群未见明显脂肪浸润」would emit「脂肪浸润」, and
 * 「排除 FSHD1，未检出 D4Z4 重复单元缩短」would tell a patient who
 * just received a negative genetic result that they have FSHD1. The
 * raw impression is dropped by the redactor, so the model has nothing
 * to correct itself against — whatever this function says is the only
 * version of the report it will ever see.
 */
const NEGATION_MARKERS = [
  '未见',
  '未检出',
  '未发现',
  '未提示',
  '无明显',
  '排除',
  '阴性',
  '否认',
  '不支持',
];

/** Clause boundaries. Negation scopes to its own clause: in
 *  「见脂肪浸润，未见肌肉萎缩」the negation must not swallow the first
 *  half. */
const CLAUSE_SPLIT = /[，,。.；;、\n]/;

/**
 * Extract the recognised clinical findings a report actually asserts.
 *
 * Deny-by-default twice over: the output is assembled from
 * `CLINICAL_FINDING_TERMS`, never from the text (so no name can pass),
 * and a term is only kept when its own clause is not negated (so no
 * ruled-out finding is reported as present).
 */
const buildFindingsSummary = (ocrFields: Record<string, unknown>): string | null => {
  const raw = IMPRESSION_KEYS.map((key) => ocrFields[key]).find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  if (!raw) return null;

  // Only clauses that assert something contribute terms.
  const assertedClauses = raw
    .split(CLAUSE_SPLIT)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
    .filter((clause) => !NEGATION_MARKERS.some((marker) => clause.includes(marker)));

  const matched: string[] = [];
  for (const term of CLINICAL_FINDING_TERMS) {
    if (!assertedClauses.some((clause) => clause.includes(term))) continue;
    // Skip a term already covered by a longer match ('肌营养不良' when
    // '肌营养不良改变' is present) so the summary reads cleanly.
    if (matched.some((kept) => kept.includes(term))) continue;
    matched.push(term);
  }
  if (matched.length === 0) return null;

  const summary = matched.join('、');
  return summary.length > FINDINGS_SUMMARY_MAX
    ? `${summary.slice(0, FINDINGS_SUMMARY_MAX)}…`
    : summary;
};

const buildReportFields = (row: ReportRow): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};

  if (row.classified_type) fields.classifiedType = row.classified_type;
  if (row.document_type) fields.documentType = row.document_type;
  if (row.status) fields.status = row.status;

  // `title` is a user-named field on the document upload and can
  // contain the patient's name, so it is on NEITHER allowlist and
  // reaches no prompt in either mode. Exposed raw here anyway so the
  // redactor sees it and drops it where the audit row can show that it
  // did, rather than the retriever silently never offering it.
  if (row.title) fields.title = row.title;

  // `reportDate` is the raw upload timestamp string. Both modes
  // collapse it to `reportDate_year` — the day never leaves, because
  // the precise consent is to a clinical value and not to a calendar
  // date, and the year is the only form either allowlist carries.
  const uploadedAt = formatTimestamp(row.uploaded_at);
  if (uploadedAt) fields.reportDate = uploadedAt;

  // The OCR payload itself. `projectOcrFields` runs over it in BOTH
  // modes and is deny-by-default in both: strict emits
  // `fields_clinical` with this platform's reading of each key it
  // recognises, precise emits `fields` with the raw value beside that
  // reading and only for the keys named on
  // OCR_FIELDS_SAFE_KEYS_PRECISE. Nothing passes here verbatim.
  if (isPlainObject(row.ocr_payload?.fields)) {
    fields.fields = row.ocr_payload.fields;

    // The report's conclusion, name-scrubbed. Allowed in BOTH strict
    // and precise mode — a clinical impression is the least
    // identifying and most useful thing on the page, once the names
    // are off it.
    const summary = buildFindingsSummary(row.ocr_payload.fields);
    if (summary) fields.findings_summary = summary;
  }

  return fields;
};

const coerceSince = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || !raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const coerceDocumentType = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;

const PLACEHOLDER_CONTENT_PREFIX = '【患者报告占位';
const PLACEHOLDER_SNIPPET = '你的患者报告';

/** Generic content for a chunk. Includes the report-type label
 *  (already non-PII because it's a classification) so the orchestrator
 *  can route by kind without inspecting metadata, but never includes a
 *  title, date, or any OCR value. */
const placeholderContent = (reportType: string | null): string =>
  `${PLACEHOLDER_CONTENT_PREFIX} / ${reportType ?? 'unknown'} — 字段经 PIIRedactor 处理后由 ContextBuilder 渲染】`;

/** `2023-12-22` → `2023-12`. Enough to tell two reports of the same
 *  kind apart in a citation chip without turning the chip into a date
 *  field. */
const reportDateLabel = (row: ReportRow): string => {
  const raw = row.ocr_payload as { fields?: Record<string, unknown> } | null;
  const reported = raw?.fields?.reportTime ?? raw?.fields?.report_time;
  const source = typeof reported === 'string' && reported.trim() ? reported : row.uploaded_at;
  const date = new Date(source as string | Date);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export class PatientReportsRetriever implements IRetriever {
  readonly id = 'patient_reports';
  readonly kind = 'sql' as const;

  constructor(private readonly pool: Pool) {}

  async search(input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult> {
    if (!ctx.userId) {
      return emptyResult(this.id, 'no_user_in_scope');
    }
    if (ctx.consentLevel === 'none' || ctx.consentLevel === undefined) {
      return emptyResult(this.id, 'consent_not_granted');
    }

    const requestedLimit = input.limit ?? RECENT_LIMIT_DEFAULT;
    const limit = Math.min(Math.max(1, requestedLimit), RECENT_LIMIT_MAX);

    const documentType = coerceDocumentType(input.filter?.documentType);
    const since = coerceSince(input.filter?.since);
    const documentId = coerceDocumentType(input.filter?.documentId);

    const conditions: string[] = ['pp.user_id = $1', 'pd.ocr_payload IS NOT NULL'];
    const params: unknown[] = [ctx.userId];
    // A single-document scope. The `pp.user_id = $1` clause above still
    // applies, so an id belonging to someone else returns zero rows
    // rather than their report — the scope narrows, it never widens.
    if (documentId) {
      params.push(documentId);
      conditions.push(`pd.id = $${params.length}`);
    }
    if (documentType) {
      params.push(documentType);
      // Match either column. `document_type` is what the uploader
      // picked (blood_panel, mri, genetic_report …); `classifiedType`
      // is what OCR concluded (coagulation, stool_test,
      // infection_screening …). The model naturally filters by the
      // second — it is the vocabulary the report itself uses, and the
      // one the tool's own description advertises — so filtering only
      // on the first made a perfectly ordinary question
      // (「我的凝血报告数值是多少」) return nothing, and the answer
      // became「还没有查到你的凝血报告」about a report sitting in the
      // account fully parsed.
      conditions.push(
        `(pd.document_type = $${params.length}` +
          ` OR pd.ocr_payload->'fields'->>'classifiedType' = $${params.length})`,
      );
    }
    if (since) {
      params.push(since);
      conditions.push(`pd.uploaded_at >= $${params.length}`);
    }
    params.push(limit);
    const limitParam = `$${params.length}`;

    // Readable reports rank ahead of unreadable ones, then most
    // recent.
    //
    // Ordering by arrival alone meant a failed parse — which carries
    // nothing but a type and a status — could occupy every one of the
    // five slots. And failures cluster: a batch upload queues together,
    // so when one times out several do. A patient whose last batch
    // failed got "I can't read any of your reports" about an account
    // whose genetic report had parsed correctly an hour earlier.
    const result = await this.pool.query<ReportRow>(
      `SELECT pd.id,
              pd.document_type,
              pd.title,
              pd.uploaded_at,
              pd.status,
              pd.ocr_payload,
              (pd.ocr_payload->'fields'->>'classifiedType') AS classified_type,
              (pd.ocr_payload->'fields'->>'reportTypeLabel') AS report_type_label
       FROM patient_documents pd
       JOIN patient_profiles pp ON pp.id = pd.profile_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY (pd.status = 'parsed') DESC, pd.uploaded_at DESC
       LIMIT ${limitParam}`,
      params,
    );

    if (result.rowCount === 0) {
      return emptyResult(this.id, 'no_reports_found', {
        documentType: documentType ?? null,
        since: since ?? null,
        documentId: documentId ?? null,
      });
    }

    const chunks: RetrievedChunk[] = [];
    const citations: Citation[] = [];

    result.rows.forEach((row, idx) => {
      const chunkId = randomUUID();
      const sourceFile = `patient_reports/${row.id}`;
      // What the「依据」chip shows the patient. `sourceFile` stays the
      // stable id — the prompt and the audit trail key off it — but a
      // uuid is not a source anyone can check, and a citation nobody
      // can read is indistinguishable from no citation at all.
      // `reportTypeLabel` is written by the OCR classifier
      // (「感染筛查报告」,「肌肉 MRI 报告」), so it is a classification
      // rather than report content, the same reasoning that already
      // lets `classifiedType` into the chunk body.
      // Two reports of the same kind produce two identical chips —
      // observed:「引用 2 条：粪便/幽门检测报告、粪便/幽门检测报告」,
      // which tells the patient no more than one chip would have. The
      // report date separates them. It is the patient's own data going
      // to their own client, not to the prompt — the redactor still
      // governs everything the model sees.
      const reportYear = reportDateLabel(row);
      const citationLabel = [row.report_type_label?.trim() || '你上传的检查报告', reportYear]
        .filter(Boolean)
        .join(' · ');
      const fields = buildReportFields(row);
      const reportType = row.classified_type ?? row.document_type ?? null;

      chunks.push({
        id: chunkId,
        source: this.id,
        content: placeholderContent(reportType),
        metadata: {
          documentId: row.id,
          documentType: row.document_type,
          classifiedType: row.classified_type,
          // `uploadedAt` stays in metadata for ordering / audit but
          // never reaches the prompt (the renderer reads
          // `metadata.fields` only).
          uploadedAt: formatTimestamp(row.uploaded_at),
          status: row.status,
          fields,
        },
        distance: null,
        sourceFile,
        chunkIndex: idx,
      });
      citations.push({
        chunkId,
        source: this.id,
        sourceFile: citationLabel,
        chunkIndex: idx,
        snippet: PLACEHOLDER_SNIPPET,
      });
    });

    return {
      retrieverId: this.id,
      chunks,
      citations,
      metadata: {
        documentCount: result.rowCount,
        documentType: documentType ?? null,
        since: since ?? null,
      },
    };
  }
}
