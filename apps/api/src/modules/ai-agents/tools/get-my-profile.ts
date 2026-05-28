/**
 * Tool wrapper for the patient profile retriever.
 *
 * Advertised only when the user has at least `basic` consent. Takes
 * no arguments — the profile is identified by the authenticated user
 * id carried in `ToolContext`.
 *
 * The underlying retriever also gates on consent + user-in-scope and
 * returns an empty result with `metadata.reason` if either is
 * missing; this wrapper relies on that as the second layer of
 * defence.
 */

import type { ITool, ToolContext, ToolExecutionResult } from './base.js';
import { isPlainObject, safeParseJson } from './base.js';
import type { ConsentLevel } from '../retrievers/base.js';
import type { PatientProfileRetriever } from '../retrievers/patient-profile.js';

const PARAMETERS_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

export class GetMyProfileTool implements ITool {
  readonly name = 'get_my_profile';
  readonly description =
    'Retrieve the authenticated user\'s own patient profile: age band, gender, diagnosis stage / year / type, D4Z4 / haplotype / methylation (clinicalised or raw depending on consent), onset region, family history, ambulatory status, assistive devices, symptom categories. Use this when the user asks about themselves ("my", "我的", "我目前") or when their personal context is required to give a useful answer.';
  readonly parametersSchema: Record<string, unknown> = PARAMETERS_SCHEMA;
  readonly minConsent: ConsentLevel = 'basic';

  constructor(private readonly retriever: PatientProfileRetriever) {}

  parseArgs(rawJson: string): Record<string, unknown> {
    const raw = safeParseJson(rawJson);
    // Tolerate the model passing an empty object, null, or unknown
    // keys — none of them matter for this tool.
    return isPlainObject(raw) ? raw : {};
  }

  async execute(_args: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
    const retrieval = await this.retriever.search(
      { question: '' },
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
        ? `patient_profile: empty (${retrieval.metadata?.reason ?? 'no_data'})`
        : 'patient_profile: 1 chunk';
    return { retrieval, display };
  }
}
