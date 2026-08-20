/**
 * Tool wrapper for the patient followup retriever.
 *
 * Kept separate from `get_my_profile` rather than folded into it: the
 * planner's choice between "who is this person" and "how have they
 * been trending" is a real one, and a single tool returning both would
 * make every demographic question pay for a trend query.
 *
 * `metricKey` lets the ask-context drawer aim the call at the exact
 * curve the patient is looking at.
 */

import type { ITool, ToolContext, ToolExecutionResult } from './base.js';
import { ToolValidationError, isPlainObject, safeParseJson } from './base.js';
import { MUSCLE_GROUPS } from '../../patient-profile/profile.constants.js';
import type { ConsentLevel } from '../retrievers/base.js';
import {
  isKnownMetricKey,
  type PatientFollowupRetriever,
} from '../retrievers/patient-followups.js';

interface GetMyRecordsArgs {
  metricKey?: string;
  windowDays?: number;
}

const PARAMETERS_SCHEMA = {
  type: 'object',
  properties: {
    metricKey: {
      type: 'string',
      // The group list is the enum itself, not a copy of it: a group the
      // schema does not name is a curve the model cannot ask for, and
      // `face` and `abdominal` sat in the database unasked-for while
      // this sentence listed only the groups that predated them.
      description: `Optional filter to a single tracked metric. Function tests: \`stair_climb\`, \`ten_meter_walk\`, \`sit_to_stand\`, \`six_minute_walk\`, \`timed_up_and_go\`, \`custom\`. Symptom scores: \`fatigue\`, \`pain\`, \`dyspnea\`, \`sleep_quality\`, \`anxiety_about_progression\`. Muscle self-test: \`muscle_<group>\` optionally suffixed \`_left\` / \`_right\` (groups: ${MUSCLE_GROUPS.join(', ')}). Omit to get every series plus the event tally — that is the right choice for falls and for any "how am I doing overall" question.`,
    },
    windowDays: {
      type: 'integer',
      description: 'How far back to look, in days. Defaults to 180, hard cap 730.',
      minimum: 1,
      maximum: 730,
    },
  },
  additionalProperties: false,
} as const;

const validate = (raw: unknown): GetMyRecordsArgs => {
  if (!isPlainObject(raw)) {
    throw new ToolValidationError('Arguments must be an object.');
  }
  const out: GetMyRecordsArgs = {};

  if (raw.metricKey !== undefined) {
    if (typeof raw.metricKey !== 'string' || !raw.metricKey.trim()) {
      throw new ToolValidationError('`metricKey` must be a non-empty string when provided.');
    }
    const key = raw.metricKey.trim();
    // Reject unknown keys instead of filtering every row away. The
    // orchestrator runs a fixed two rounds with no retry, so a silent
    // empty retrieval is terminal: the model reports "you have not
    // recorded this yet" about data the patient definitely recorded.
    // A ToolValidationError at least reaches the model as a failed
    // call it can reason about.
    if (!isKnownMetricKey(key)) {
      throw new ToolValidationError(
        `Unknown metricKey \`${key}\`. Omit metricKey to retrieve every series.`,
      );
    }
    out.metricKey = key;
  }

  if (raw.windowDays !== undefined) {
    if (typeof raw.windowDays !== 'number' || !Number.isFinite(raw.windowDays)) {
      throw new ToolValidationError('`windowDays` must be a number.');
    }
    out.windowDays = Math.min(730, Math.max(1, Math.floor(raw.windowDays)));
  }

  return out;
};

export class GetMyRecordsTool implements ITool {
  readonly name = 'get_my_records';
  /**
   * A tool description is an instruction, so it may not name a field
   * the result cannot carry.
   *
   * It opened on 「stair-climb times, sleep scores」. The readings
   * themselves — `latestValue`, `series`, `unit` — are on the precise
   * allowlist only, so at basic consent that sentence promised a model
   * numbers it was never going to be handed, over a patient who had
   * recorded them. What survives both modes is which metric, how many
   * readings, over how many days and which way they moved, so that is
   * what the sentence claims; the raw points are in front of the model
   * when consent allows them and need no promise.
   */
  readonly description =
    "Retrieve the authenticated user's own followup records as trends: tracked metrics such as stair climb and sleep quality, each with how many readings, over how many days, and which direction they moved, plus a tally of logged events such as falls. Use this for any question about how the user has been doing over time — 「我最近是不是变差了」, 「我的上楼速度有变化吗」, 「最近摔过几次」 — and before drafting anything that summarises recent change.";
  readonly parametersSchema: Record<string, unknown> = PARAMETERS_SCHEMA;
  readonly minConsent: ConsentLevel = 'basic';

  constructor(private readonly retriever: PatientFollowupRetriever) {}

  parseArgs(rawJson: string): GetMyRecordsArgs {
    return validate(safeParseJson(rawJson));
  }

  async execute(args: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
    const parsed = args as GetMyRecordsArgs;
    const filter: Record<string, unknown> = {};
    if (parsed.metricKey) filter.metricKey = parsed.metricKey;
    if (parsed.windowDays) filter.windowDays = parsed.windowDays;

    const retrieval = await this.retriever.search(
      {
        question: '',
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      },
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
        ? `patient_followups: empty (${retrieval.metadata?.reason ?? 'no_data'})`
        : `patient_followups: ${retrieval.chunks.length} chunks`;
    return { retrieval, display };
  }
}
