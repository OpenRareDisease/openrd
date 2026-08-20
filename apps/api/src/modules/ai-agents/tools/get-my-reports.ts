/**
 * Tool wrapper for the patient reports retriever.
 *
 * Advertised only when the user has at least `basic` consent. Accepts
 * an optional document-type filter, an optional `since` ISO date, and
 * a `limit`. The retriever caps `limit` at 20 internally.
 */

import type { ITool, ToolContext, ToolExecutionResult } from './base.js';
import { ToolValidationError, isPlainObject, safeParseJson } from './base.js';
import type { ConsentLevel } from '../retrievers/base.js';
import type { PatientReportsRetriever } from '../retrievers/patient-reports.js';
import { REPORT_IMPRESSION_CHANNEL_ENABLED } from '../security/allowlist.js';

/** What the patient picks at upload — DOCUMENT_TYPES in
 *  profile.constants.ts. */
export const UPLOAD_DOCUMENT_TYPES = ['mri', 'genetic_report', 'blood_panel', 'other'] as const;

/**
 * What the FSHD OCR classifier concludes, written into
 * `ocr_payload.fields.classifiedType`. The retriever matches a filter
 * against either column, so both vocabularies are accepted.
 *
 * THE WRITER OF THESE STRINGS IS `_classify_report` IN
 * apps/report-manager/app/services/fshd_report_service.py — a Python
 * table in another workspace, with no import, no generated file and no
 * type between it and this list. So the two drifted: the classifier
 * had grown 病历摘要, 肌力/体格检查, 膈肌超声, 心脏超声, 尿常规 and 腹部超声
 * while this schema had never heard of them, and a filter the model
 * cannot name is a report the patient cannot ask about. The other
 * direction is worse in a different way — a type advertised here and
 * never written there is a filter the model will reach for and get an
 * empty result from, which reads to the patient as「你没有这份报告」.
 *
 * get-my-reports.test.ts reads that Python table and fails when this
 * list stops matching it, so the next classifier type cannot land
 * one-sided.
 */
export const CLASSIFIED_REPORT_TYPES = [
  'abdominal_ultrasound',
  'biochemistry',
  'blood_routine',
  'coagulation',
  'diaphragm_ultrasound',
  'ecg',
  'echocardiography',
  'genetic_report',
  'infection_screening',
  'medical_summary',
  'muscle_enzyme',
  'muscle_mri',
  'other',
  'physical_exam',
  'pulmonary_function',
  'stool_test',
  'thyroid_function',
  'urinalysis',
] as const;

const KNOWN_DOCUMENT_TYPES: ReadonlySet<string> = new Set<string>([
  ...UPLOAD_DOCUMENT_TYPES,
  ...CLASSIFIED_REPORT_TYPES,
]);

/** The vocabularies overlap — `genetic_report` and `other` are picked
 *  at upload AND concluded by OCR — and a JSON-Schema enum listing a
 *  value twice is not a valid enum. */
export const DOCUMENT_TYPE_ENUM: readonly string[] = [...KNOWN_DOCUMENT_TYPES];

const backticked = (types: readonly string[]) => types.map((type) => '`' + type + '`').join(', ');

interface GetMyReportsArgs {
  documentType?: string;
  since?: string;
  limit?: number;
}

const PARAMETERS_SCHEMA = {
  type: 'object',
  properties: {
    documentType: {
      type: 'string',
      enum: DOCUMENT_TYPE_ENUM,
      description:
        'Optional filter, matched against BOTH the type the patient chose at upload (' +
        backticked(UPLOAD_DOCUMENT_TYPES) +
        ') and the type OCR concluded (' +
        backticked(CLASSIFIED_REPORT_TYPES) +
        '). Prefer omitting it: the default already returns the most recent readable reports, and a filter that matches nothing yields an empty result you cannot recover from in this turn.',
    },
    since: {
      type: 'string',
      description:
        'Optional ISO date (YYYY-MM-DD) — only reports uploaded on/after this date are returned.',
    },
    limit: {
      type: 'integer',
      description: 'Max reports to return. Defaults to 5, hard cap 20.',
      minimum: 1,
      maximum: 20,
    },
  },
  additionalProperties: false,
} as const;

const validate = (raw: unknown): GetMyReportsArgs => {
  if (!isPlainObject(raw)) {
    throw new ToolValidationError('Arguments must be an object.');
  }
  const out: GetMyReportsArgs = {};

  if (raw.documentType !== undefined) {
    if (typeof raw.documentType !== 'string' || !raw.documentType.trim()) {
      throw new ToolValidationError('`documentType` must be a non-empty string when provided.');
    }
    const type = raw.documentType.trim();
    // Reject an unknown value rather than filtering every row away.
    // The schema used to advertise `lab` and `clinical_visit`, neither
    // of which exists in either vocabulary, and a free-string filter
    // invites the model to invent the report's own wording (「凝血」,
    // `coagulation_panel`). Every miss looked identical to having no
    // reports at all — and with a fixed two-round orchestrator there
    // is no retry, so「还没有查到你的凝血报告」was the final answer
    // about a report sitting in the account fully parsed.
    if (!KNOWN_DOCUMENT_TYPES.has(type)) {
      throw new ToolValidationError(
        `Unknown documentType \`${type}\`. Valid: ${[...KNOWN_DOCUMENT_TYPES].join(', ')}. ` +
          'Omit documentType to search every report.',
      );
    }
    out.documentType = type;
  }

  if (raw.since !== undefined) {
    if (typeof raw.since !== 'string') {
      throw new ToolValidationError('`since` must be an ISO date string.');
    }
    const parsed = new Date(raw.since);
    if (Number.isNaN(parsed.getTime())) {
      throw new ToolValidationError(`\`since\` is not a valid date: ${raw.since}`);
    }
    out.since = raw.since;
  }

  if (raw.limit !== undefined) {
    if (typeof raw.limit !== 'number' || !Number.isFinite(raw.limit)) {
      throw new ToolValidationError('`limit` must be a number.');
    }
    out.limit = Math.min(20, Math.max(1, Math.floor(raw.limit)));
  }

  return out;
};

/**
 * THE DESCRIPTION, IN TWO HALVES, BECAUSE THE SECOND ONE IS SWITCHED.
 *
 * A tool description is an instruction, so it may not name a field the
 * result cannot carry — `tool-descriptions.test.ts` checks exactly that
 * against the allowlist, clause by clause. The report's own impression
 * is behind `REPORT_IMPRESSION_CHANNEL_ENABLED` (declared and argued in
 * security/allowlist.ts), so the clauses describing it are behind the
 * same constant. With the switch off the sentence describes the
 * structured cells and stops, which is the truth about what the model
 * will get.
 */
const DESCRIPTION_STRUCTURED =
  "Retrieve the authenticated user's recent uploaded medical reports (most recent first). Each report carries a classified type, document type, the report year when the report itself states one — otherwise the year it was uploaded, which is not the same thing — and structured OCR fields.";

/** What the impression channel adds, when it is switched on. Each
 *  semicolon-separated clause names a key the handler emits; the test
 *  above matches them verbatim. */
const DESCRIPTION_IMPRESSION =
  " From a result report only (an imaging, genetics, laboratory, pulmonary-function or cardiac report — never a 病历摘要, 门诊病历, 出院小结 or 入院记录), it also carries the report's own impression exactly as the report printed it, which is the report's wording and not this platform's reading of it or a summary of it; identifiers are removed from that text and the count of removals is reported; without precise-value consent every measurement in it is masked as [数值未共享] and the count of masked values is reported; if the text was too long the number of characters cut is reported. When any of those steps refuses, the impression is not sent and a reason is given in its place — that reason never means the report had no impression.";

const DESCRIPTION_USAGE =
  ' Use this when the user asks about their own past tests or reports ("my MRI", "我之前的基因检测", etc.).';

const DESCRIPTION = REPORT_IMPRESSION_CHANNEL_ENABLED
  ? DESCRIPTION_STRUCTURED + DESCRIPTION_IMPRESSION + DESCRIPTION_USAGE
  : DESCRIPTION_STRUCTURED + DESCRIPTION_USAGE;

export class GetMyReportsTool implements ITool {
  readonly name = 'get_my_reports';
  /**
   * A tool description is an instruction, so it may not name a field
   * the result cannot carry.
   *
   * It promised the full report date to a precise-consent reader. The
   * day never leaves in either mode — `clinicalise` drops `reportDate`
   * unconditionally and `reportDate_year` is the only form either
   * allowlist carries — so that clause was an instruction to answer
   * 「你这份报告是 X 月 X 日的」 out of a field that had already gone.
   *
   * AND 「report year」 WAS THE UPLOAD YEAR. The retriever filed
   * `uploaded_at` under `reportDate`, so this sentence told the model
   * it had the report's own year when what it had was the year the
   * patient uploaded the file — for a genetics report that can be
   * seven years apart, and the gap decides whether a clinician
   * re-tests. The two are separate keys now (`reportDate_year` and
   * `uploadYear`, see `resolveReportDate` in patient-reports.ts), so
   * the sentence names them separately and says which is which.
   *
   * AND THE REPORT'S OWN WORDS ARE NAMED ONLY WHILE THEY TRAVEL. What
   * used to reach the model under 影像/报告印象 was a summary this
   * PLATFORM composed out of a fixed vocabulary, and the description
   * named none of that — so the model asserted a platform artefact as
   * the radiologist's conclusion. The impression channel that replaced
   * it is switched off by default, and the sentence follows the switch
   * rather than describing a field the result cannot carry. See
   * `DESCRIPTION` above.
   */
  readonly description = DESCRIPTION;
  readonly parametersSchema: Record<string, unknown> = PARAMETERS_SCHEMA;
  readonly minConsent: ConsentLevel = 'basic';

  constructor(private readonly retriever: PatientReportsRetriever) {}

  parseArgs(rawJson: string): GetMyReportsArgs {
    return validate(safeParseJson(rawJson));
  }

  async execute(args: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
    const parsed = args as GetMyReportsArgs;
    const filter: Record<string, unknown> = {};
    if (parsed.documentType) filter.documentType = parsed.documentType;
    if (parsed.since) filter.since = parsed.since;

    // A drawer opened on one report wins over whatever the model asked
    // for. The model cannot see this id and cannot widen past it: the
    // patient pointed at a specific document, and the other filters
    // would only ever subtract from that one row anyway. Dropping them
    // keeps「这份报告说明什么」from returning nothing because the model
    // guessed `blood_panel` for a report OCR classified `coagulation`.
    if (ctx.scope?.documentId) {
      return this.run({ documentId: ctx.scope.documentId }, 1, ctx);
    }

    return this.run(Object.keys(filter).length > 0 ? filter : undefined, parsed.limit, ctx);
  }

  private async run(
    filter: Record<string, unknown> | undefined,
    limit: number | undefined,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> {
    const retrieval = await this.retriever.search(
      { question: '', filter, limit },
      {
        userId: ctx.userId,
        consentLevel: ctx.consentLevel,
        requestId: ctx.requestId,
        logger: ctx.logger,
        signal: ctx.signal,
      },
    );

    const display =
      retrieval.chunks.length === 0
        ? `patient_reports: empty (${retrieval.metadata?.reason ?? 'no_data'})`
        : `patient_reports: ${retrieval.chunks.length} chunks`;
    return { retrieval, display };
  }
}
