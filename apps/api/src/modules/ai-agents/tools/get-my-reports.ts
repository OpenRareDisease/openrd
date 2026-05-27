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
      description:
        'Optional filter by report category, e.g. `genetic_report`, `mri`, `lab`, `clinical_visit`. Omit to consider all types.',
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
    out.documentType = raw.documentType.trim();
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

    const retrieval = await this.retriever.search(
      {
        question: '',
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        limit: parsed.limit,
      },
      {
        userId: ctx.userId,
        consentLevel: ctx.consentLevel,
        requestId: ctx.requestId,
        logger: ctx.logger,
      },
    );

    const display =
      retrieval.chunks.length === 0
        ? `patient_reports: empty (${retrieval.metadata?.reason ?? 'no_data'})`
        : `patient_reports: ${retrieval.chunks.length} chunks`;
    return { retrieval, display };
  }
}
