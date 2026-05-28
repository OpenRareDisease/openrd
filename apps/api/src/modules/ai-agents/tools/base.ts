/**
 * Tool contract used by the orchestrator's planner / executor.
 *
 * A `Tool` is the orchestrator-facing wrapper around an `IRetriever`.
 * The planner advertises tools to the LLM as OpenAI-style function
 * definitions; the executor parses the model's tool call arguments,
 * validates them, and runs the underlying retriever. The result is
 * always shaped as a `RetrieveResult` so the context-builder can
 * treat every tool's output uniformly when it renders chunks through
 * the redactor.
 *
 * Tools never read DB rows themselves and never format prompts.
 * That keeps the surface honest: the only privacy-relevant code path
 * remains retriever -> redactor -> renderer, and tools are a routing
 * shim on top.
 */

import type { AppLogger } from '../../../config/logger.js';
import type { ConsentLevel, RetrieveResult } from '../retrievers/base.js';

/** Ordering for consent levels. Used to test whether the user's
 *  current consent dominates a tool's required minimum. */
export const CONSENT_RANK: Record<ConsentLevel, number> = {
  none: 0,
  basic: 1,
  precise: 2,
};

/** Returns true if `have` is at least `need` (or `need` is unset).
 *  Shared between the registry (filters what the planner sees) and
 *  the executor (defence-in-depth before actually running a tool). */
export const meetsConsent = (have: ConsentLevel, need: ConsentLevel | undefined): boolean => {
  if (!need) return true;
  return CONSENT_RANK[have] >= CONSENT_RANK[need];
};

export interface ToolContext {
  /** Authenticated user id. `null` means anonymous — patient-scoped
   *  tools must refuse. */
  userId: string | null;
  consentLevel: ConsentLevel;
  /** Correlation id (mirrors the orchestrator's request id). */
  requestId?: string;
  logger: AppLogger;
  /** Caller-driven cancellation. Forwarded from the route's
   *  `res.on('close')` through orchestrator → executor → tool. When
   *  this fires, retrievers SHOULD stop in-flight work (cancel fetch,
   *  cancel pg query). Without this, a dropped phone keeps holding
   *  pool connections and HTTP sockets until the per-tool 30s timer
   *  fires. */
  signal?: AbortSignal;
}

export interface ToolExecutionResult {
  /** Raw retriever output; the orchestrator runs each chunk through
   *  `renderChunkForPrompt` before composing the LLM context. */
  retrieval: RetrieveResult;
  /** Short human-readable status that may be surfaced in the
   *  `tool` message back to the model (e.g. "3 chunks retrieved").
   *  Never contains PII because no retriever output is interpolated. */
  display: string;
}

export interface ITool {
  /** Tool name advertised to the model. Must match `/^[a-z][a-z0-9_]*$/`. */
  readonly name: string;
  readonly description: string;
  /** JSON Schema describing this tool's call signature. */
  readonly parametersSchema: Record<string, unknown>;
  /** Minimum consent level required for the planner to advertise this
   *  tool. Omitted = always advertised (e.g. medical_kb). */
  readonly minConsent?: ConsentLevel;
  /** Parse + validate raw JSON arguments from the model. Throws
   *  `ToolValidationError` on invalid input. */
  parseArgs(rawJson: string): unknown;
  execute(args: unknown, ctx: ToolContext): Promise<ToolExecutionResult>;
}

/**
 * Thrown by `parseArgs` (or `execute`) when the model's arguments
 * cannot be honoured. The orchestrator catches this and feeds the
 * message back to the model as a `tool` result so it can recover
 * (re-call with corrected args) rather than failing the request.
 */
export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

/** Helper: parse JSON, surfacing a `ToolValidationError` on failure. */
export const safeParseJson = (raw: string): unknown => {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ToolValidationError(
      `Arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
