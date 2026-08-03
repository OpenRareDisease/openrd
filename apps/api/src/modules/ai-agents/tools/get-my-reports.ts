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

/** What the patient picks at upload — DOCUMENT_TYPES in
 *  profile.constants.ts. */
const UPLOAD_DOCUMENT_TYPES = ['mri', 'genetic_report', 'blood_panel', 'other'] as const;

/** What the FSHD OCR classifier concludes, written into
 *  `ocr_payload.fields.classifiedType`. The retriever matches a filter
 *  against either column, so both vocabularies are accepted. */
const CLASSIFIED_REPORT_TYPES = [
  'biochemistry',
  'blood_routine',
  'coagulation',
  'ecg',
  'infection_screening',
  'muscle_enzyme',
  'muscle_mri',
  'pulmonary_function',
  'stool_test',
  'thyroid_function',
] as const;

const KNOWN_DOCUMENT_TYPES: ReadonlySet<string> = new Set<string>([
  ...UPLOAD_DOCUMENT_TYPES,
  ...CLASSIFIED_REPORT_TYPES,
]);

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
      enum: [...UPLOAD_DOCUMENT_TYPES, ...CLASSIFIED_REPORT_TYPES],
      description:
        'Optional filter, matched against BOTH the type the patient chose at upload (`mri`, `genetic_report`, `blood_panel`, `other`) and the type OCR concluded (`coagulation`, `blood_routine`, `biochemistry`, `muscle_enzyme`, `muscle_mri`, `pulmonary_function`, `thyroid_function`, `infection_screening`, `stool_test`, `ecg`, `genetic_report`). Prefer omitting it: the default already returns the most recent readable reports, and a filter that matches nothing yields an empty result you cannot recover from in this turn.',
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

export class GetMyReportsTool implements ITool {
  readonly name = 'get_my_reports';
  readonly description =
    'Retrieve the authenticated user\'s recent uploaded medical reports (most recent first). Each report carries a classified type, document type, report year (or full date in precise mode), and structured OCR fields. Use this when the user asks about their own past tests or reports ("my MRI", "我之前的基因检测", etc.).';
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
