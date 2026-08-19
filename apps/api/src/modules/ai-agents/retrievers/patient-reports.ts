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
 *   - It surfaces the report's own impression, VERBATIM, under
 *     `reportImpressionAsPrinted`, for the same reason and with the
 *     same contract: this module finds the report's words and judges
 *     none of them. That key is on NEITHER allowlist. What reaches a
 *     prompt is the form the redactor mints after three gates —
 *     eligibility, identifiers, measurements — and only the redactor
 *     can mint one. See `impressionAsPrinted` below and the layer 4
 *     block in security/pii-redactor.ts.
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
import { withholdUnsafeReadings } from '../../patient-profile/profile.service.js';
import type { UnsafeReading } from '../../patient-profile/profile.service.js';

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

/**
 * THE READ GUARD, ON THE PATH THAT SPEAKS WITH THE MOST AUTHORITY.
 *
 * `withholdUnsafeReadings` is the check every OTHER reader of a stored
 * payload goes through — the profile projection, the single-document
 * endpoint, the passport, the exports. This retriever had its own raw
 * SQL and went through none of it, so a reading the guard withholds
 * everywhere else was still handed to the model here and read back to
 * the patient as their own laboratory value, in a sentence, with no
 * number on any screen to contradict it.
 *
 * That is the worst place of the lot for it to leak. A wrong figure in
 * a table is a figure a patient can compare against their paper report;
 * the same figure spoken by the assistant is an answer to a question
 * they asked because they could not read the report themselves.
 *
 * APPLIED TO THE WHOLE ROW, ONCE, BEFORE ANY READER OF IT RUNS.
 * `buildReportFields` reads `fields`, the page and the impression off
 * this object, and `resolveReportDate` reads it again for the citation
 * chip. Guarding at one of those and not the others is how this class
 * of hole gets reopened, so the row itself is replaced and there is no
 * unguarded copy left in scope.
 *
 * The guard needs the report's own page and its `aiExtraction`
 * reference intervals, and this query selects the whole `ocr_payload` —
 * so unlike the profile projection there is nothing to arrange for it
 * here.
 */
const guardReportRow = (row: ReportRow): ReportRow => ({
  ...row,
  ocr_payload: withholdUnsafeReadings(row.ocr_payload),
});

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
 * Keys the OCR pipeline files a report's own conclusion under.
 *
 * Read in preference order and carried VERBATIM. See
 * `reportImpressionAsPrinted` in `buildReportFields` for what this
 * retriever is and is not allowed to do to the text.
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
 * THE REPORT'S OWN CONCLUSION, AS THE REPORT PRINTED IT.
 *
 * No scrubbing, no masking, no summarising, no truncation, no
 * vocabulary. This retriever's job is to find the report's own words;
 * judging them belongs to the three gates in
 * `security/pii-redactor.ts`, which run at the last point before text
 * leaves the server so that every path producing free text — the ones
 * that exist today and the ones added later — passes through one
 * implementation.
 *
 * WHAT THIS REPLACED, AND WHY THE REPLACEMENT IS NOT A WIDER PRIVACY
 * POSTURE. A keyword extractor used to render this text into a
 * vocabulary-only summary (`buildFindingsSummary`, ~1500 lines,
 * deleted). Six consecutive rounds of review found the same family of
 * defects and never ran out: a finding the report RULED OUT emitted as
 * present, a hedged finding rendered as definite, a relative's
 * diagnosis rendered as the patient's own, a real finding silently
 * dropped. The last round alone produced eight, including 、 splitting
 * an enumerated negative so only its first object was suppressed,
 * 不能完全排除 killing the clause it should have hedged, and a prior
 * study cited by date read as the current impression. The redactor
 * drops the raw impression, so whatever the extractor emitted was the
 * ONLY version of the report the model ever saw. Clinical meaning
 * cannot be extracted from Chinese prose with a list of markers; a
 * model reads Chinese negation, hedging and attribution far better
 * than any regular expression this repo will write.
 */
const impressionAsPrinted = (ocrFields: Record<string, unknown>): string | null => {
  for (const key of IMPRESSION_KEYS) {
    const value = ocrFields[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
};

/**
 * WHEN IS THIS REPORT FROM, in one place.
 *
 * The laboratory's own date first — the bridge in
 * services/ocr/embedded-report-ocr.ts writes it as
 * `ocr_payload.fields.reportTime`, and the legacy extraction paths as
 * `report_time` — and the upload timestamp only as a fallback, flagged
 * as such so the caller can label it honestly rather than passing it
 * off as the report's date.
 *
 * ONE FUNCTION BECAUSE THERE IS ONE QUESTION. The citation chip and the
 * prompt each used to answer it, differently, in the same turn: the
 * chip read `reportTime` and the field map read `uploaded_at`. Two
 * answers about one document is worse than one wrong answer, because
 * nothing on either side says the other exists.
 */
const resolveReportDate = (row: ReportRow): { value: string | null; fromReport: boolean } => {
  const payload = row.ocr_payload as { fields?: Record<string, unknown> } | null;
  const reported = payload?.fields?.reportTime ?? payload?.fields?.report_time;
  if (typeof reported === 'string' && reported.trim()) {
    return { value: formatTimestamp(reported.trim()), fromReport: true };
  }
  return { value: formatTimestamp(row.uploaded_at), fromReport: false };
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

  // WHEN IS THIS REPORT FROM — asked once, by `resolveReportDate`, and
  // answered the same way for the prompt and for the citation chip.
  //
  // `reportDate` was `row.uploaded_at`, unconditionally, while the
  // laboratory's own date sat on the same row unused and
  // `reportDateLabel` was already reading it for the chip. So in ONE
  // turn the 依据 chip the patient taps said 「基因检测报告 · 2019-03」
  // and the assistant, reading 「报告年份: 2026」 off this projection,
  // said the genetics report was from 2026. How old a D4Z4 result is
  // decides whether a clinician re-tests it and whether a trial
  // screener will accept it, so the two answers are not
  // interchangeable and the wrong one was the one the model spoke.
  //
  // AND WHEN ONLY THE UPLOAD TIMESTAMP EXISTS, IT IS NOT CALLED THE
  // REPORT'S YEAR. It reaches the prompt as `uploadYear` / 上传年份 —
  // the true statement about the row — rather than as 报告年份, which
  // is a claim about a document this platform has no date for. Both
  // modes collapse either cell to its year: the day never leaves,
  // because the precise consent is to a clinical value and not to a
  // calendar date.
  const dated = resolveReportDate(row);
  if (dated.value) {
    if (dated.fromReport) fields.reportDate = dated.value;
    else fields.uploadDate = dated.value;
  }

  // The OCR payload itself. `projectOcrFields` runs over it in BOTH
  // modes and is deny-by-default in both: strict emits
  // `fields_clinical` with this platform's reading of each key it
  // recognises, precise emits `fields` with the raw value beside that
  // reading and only for the keys named on
  // OCR_FIELDS_SAFE_KEYS_PRECISE. Nothing passes here verbatim.
  // THE DOCUMENT'S OWN PAGE, CARRIED SO THE LABORATORY GATE CAN READ
  // IT — AND HARD-DELETED BEFORE ANYTHING ELSE SEES IT.
  //
  // `isLaboratoryGeneticReport` decides whether a repeat count off this
  // document may be read against the FSHD1 range, and it answers that
  // by looking at the document's own structure: a page showing 主诉 /
  // 现病史 / 出院小结 is a clinical narrative and is refused, whatever
  // label is on the row. This projection was the only one without the
  // page, so the gate fell through to the type the UPLOADER declared —
  // and an archived 病历摘要 whose uploader also picked 基因检测报告
  // from the menu was graded on the assistant path while the passport,
  // the share page, the referral pack and the exports all refused the
  // same document in the same request. The classifier that mislabelled
  // those rows is fixed; nothing re-runs the parse, so every one of
  // them is still on disk with the old label.
  //
  // `extractedText` IS ON `HARD_DELETE_KEYS`, so it is deleted in both
  // modes at any depth before layer 2 runs — the redactor asks the gate
  // of its INPUT, ahead of layer 1, precisely so that this cell can be
  // read and then removed. It is the OCR full-text dump: it carries the
  // patient's name, the physician's name and every identifier the page
  // printed, and no prompt may contain it.
  const page = row.ocr_payload?.extractedText ?? row.ocr_payload?.extracted_text;
  if (typeof page === 'string' && page.trim()) fields.extractedText = page;

  if (isPlainObject(row.ocr_payload?.fields)) {
    fields.fields = row.ocr_payload.fields;

    // THE REPORT'S OWN IMPRESSION, VERBATIM, AND JUDGED BY NOBODY HERE.
    //
    // This cell is on NEITHER allowlist, so layer 3 drops it and the
    // audit row shows that it did. What reaches a prompt is the gated
    // form the redactor mints under `reportImpression`, and the gates
    // are the only way to mint one — see `GatedFreeText` in
    // security/pii-redactor.ts.
    //
    // AND IT IS CARRIED TOP-LEVEL RATHER THAN LEFT INSIDE `fields`,
    // because the eligibility gate has to READ it. That gate is
    // `showsClinicalNarrative`, which searches the document's own page
    // plus an allowlist of `fields` cells whose contents this pipeline
    // knows (`PAGE_TEXT_FIELD_KEYS` in patient-profile/
    // genetic-evidence.ts). Of the eight keys an impression can arrive
    // under, exactly one — `interpretationSummary` — is on that list.
    // So a 病历摘要 whose `reportImpression` opens 「主诉：双下肢无力3年」
    // showed the predicate no narrative at all: the very sentence that
    // makes it a narrative was in the one cell the predicate could not
    // see. It is offered here as its own field so the gate reads the
    // text it is about to decide on.
    const impression = impressionAsPrinted(row.ocr_payload.fields);
    if (impression) fields.reportImpressionAsPrinted = impression;
  }

  // WHAT THE GUARD DID TO THIS ROW, OFFERED TO THE REDACTOR.
  //
  // `guardReportRow` has already deleted the withheld cells above, so
  // nothing here is needed to keep a bad number out of the prompt. This
  // is the other half: the readings still PRINTED but marked — outside
  // the interval the report itself carries, or duplicated on a page
  // that could not settle it — reach the model as ordinary numbers, and
  // the assistant will read one out as flatly as any other.
  //
  // It carries analyte names, `fields` spellings and dispositions. NO
  // VALUES: `UnsafeReading` has no `value` by construction, so this
  // cannot hand a withheld figure back under a second key.
  //
  // ⚠ IT REACHES NO PROMPT YET. `projectOcrFields` is deny-by-default
  // and `unsafeReadings` is on neither allowlist, so layer 3 drops it —
  // the same posture `title` is carried under, and for the same reason:
  // offered where the audit row can show it was dropped, rather than
  // silently never offered. Allowlisting it is a change to
  // ai-agents/security/allowlist.ts, which is not this module's file.
  // Until that lands the assistant can be stopped from repeating a
  // withheld reading but cannot be told to hedge a flagged one.
  const unsafeReadings = (row.ocr_payload as { unsafeReadings?: UnsafeReading[] } | null)
    ?.unsafeReadings;
  if (Array.isArray(unsafeReadings) && unsafeReadings.length) {
    fields.unsafeReadings = unsafeReadings;
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

/** Leading `YYYY-MM` of an already-resolved date. */
const YEAR_MONTH = /^(\d{4})-(\d{2})/;

/**
 * `2023-12-22` → `2023-12`. Enough to tell two reports of the same
 * kind apart in a citation chip without turning the chip into a date
 * field.
 *
 * SLICE THE DIGITS, DO NOT RE-PARSE. `resolveReportDate` has already
 * resolved the answer to an ISO instant; this used to feed that string
 * back through `new Date(...)` and read it out with `getFullYear` /
 * `getMonth`, which are the SERVER's zone. A report whose OCR
 * `reportTime` says 2025-01-01 becomes UTC midnight, and on any host
 * west of Greenwich the local accessors slide it back across both the
 * month and the year boundary — the chip read 「基因检测报告 · 2024-12」
 * for a January 2025 report, a whole year wrong on the one chip whose
 * job is to tell the patient how old the result is. profile.passport.ts,
 * referral-pack.ts and passport-share.html.ts each carry a DATE_ONLY
 * short-circuit for exactly this; this call site was the one that
 * missed it.
 *
 * AND IT SAYS WHICH DATE IT IS. `resolveReportDate` returns `fromReport`
 * precisely so the caller can 「label it honestly rather than passing it
 * off as the report's date」, and this function threw the flag away and
 * joined the value onto the report-type label with no marker either way.
 * So a genetics report whose OCR carried no `reportTime` produced the
 * chip 「基因检测报告 · 2026-08」 — the month the patient happened to
 * upload the file, sitting where a patient reads the date of the result.
 * The prompt side of this same row already refuses to make that claim:
 * `uploadDate` reaches the model as 上传年份 and never as 报告年份. In
 * one turn the assistant said 上传年份 and the 依据 chip beside its
 * answer asserted a report date anyway, and how old a D4Z4 result is
 * decides whether a clinician re-tests it.
 *
 * The upload fallback is still shown — two reports of the same kind
 * otherwise give two identical chips — but marked 上传, so the bare
 * month stays what it has always looked like: the laboratory's own date.
 */
const reportDateLabel = (row: ReportRow): string => {
  const { value, fromReport } = resolveReportDate(row);
  if (!value) return '';
  const parts = YEAR_MONTH.exec(value);
  if (!parts) return '';
  const yearMonth = `${parts[1]}-${parts[2]}`;
  return fromReport ? yearMonth : `上传 ${yearMonth}`;
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

    result.rows.forEach((rawRow, idx) => {
      // BEFORE ANYTHING READS IT. Every use of the payload below —
      // `buildReportFields`, `reportDateLabel` — takes the guarded row,
      // and `rawRow` is not referenced again.
      const row = guardReportRow(rawRow);
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
      // report date separates them — carrying its own origin marker, so
      // an upload month is never read as the date of the result. It is
      // the patient's own data going to their own client, not to the
      // prompt — the redactor still governs everything the model sees.
      const dateLabel = reportDateLabel(row);
      const citationLabel = [row.report_type_label?.trim() || '你上传的检查报告', dateLabel]
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
