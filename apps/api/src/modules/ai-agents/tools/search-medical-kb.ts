/**
 * Tool wrapper for the medical knowledge retriever.
 *
 * Always advertised — the FSHD KB is public information, no consent
 * gate. The planner is expected to call this for anything that looks
 * like a "what / why / how" question about the disease, treatment, or
 * mechanism, regardless of whether patient data is also requested.
 */

import type { ITool, ToolContext, ToolExecutionResult } from './base.js';
import { ToolValidationError, isPlainObject, safeParseJson } from './base.js';
import type { MedicalKbRetriever } from '../retrievers/medical-kb.js';

interface SearchMedicalKbArgs {
  query: string;
  queries?: string[];
  limit?: number;
}

const PARAMETERS_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: "The user's question, rephrased into a single concise search query. Required.",
    },
    queries: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional extra phrasings of the same question (synonyms, medical terms, English/Chinese variants). 3-5 entries work well.',
      maxItems: 6,
    },
    limit: {
      type: 'integer',
      description: 'Max chunks to return. Defaults to 8.',
      minimum: 1,
      maximum: 20,
    },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

const validate = (raw: unknown): SearchMedicalKbArgs => {
  if (!isPlainObject(raw)) {
    throw new ToolValidationError('Arguments must be an object.');
  }
  const query = raw.query;
  if (typeof query !== 'string' || !query.trim()) {
    throw new ToolValidationError('`query` must be a non-empty string.');
  }

  let queries: string[] | undefined;
  if (raw.queries !== undefined) {
    if (!Array.isArray(raw.queries)) {
      throw new ToolValidationError('`queries` must be an array of strings.');
    }
    queries = raw.queries
      .map((q) => (typeof q === 'string' ? q.trim() : ''))
      .filter((q) => q.length > 0)
      .slice(0, 6);
    if (queries.length === 0) queries = undefined;
  }

  let limit: number | undefined;
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== 'number' || !Number.isFinite(raw.limit)) {
      throw new ToolValidationError('`limit` must be a number.');
    }
    limit = Math.min(20, Math.max(1, Math.floor(raw.limit)));
  }

  return { query: query.trim(), queries, limit };
};

export class SearchMedicalKbTool implements ITool {
  readonly name = 'search_medical_kb';
  readonly description =
    'Search the FSHD medical knowledge base for general medical/clinical information about FSHD: genetics (DUX4, D4Z4, 4q35, haplotype, methylation), symptoms, progression, management, treatment options, and patient-experience guidance. Use this whenever the user asks about the disease itself rather than their personal records.';
  readonly parametersSchema: Record<string, unknown> = PARAMETERS_SCHEMA;

  constructor(private readonly retriever: MedicalKbRetriever) {}

  parseArgs(rawJson: string): SearchMedicalKbArgs {
    return validate(safeParseJson(rawJson));
  }

  async execute(args: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
    const parsed = args as SearchMedicalKbArgs;
    const retrieval = await this.retriever.search(
      {
        question: parsed.query,
        queries: parsed.queries,
        limit: parsed.limit,
      },
      {
        userId: ctx.userId,
        consentLevel: ctx.consentLevel,
        requestId: ctx.requestId,
        logger: ctx.logger,
      },
    );
    return {
      retrieval,
      display: `medical_kb: ${retrieval.chunks.length} chunks`,
    };
  }
}
