/**
 * Shared types for the orchestrator.
 *
 * Kept in their own file so the run loop, planner, executor, context
 * builder and stream wrapper can all import from one place without
 * pulling each other in.
 */

import type { LlmUsage } from '../llm/base.js';
import type { Citation, ConsentLevel } from '../retrievers/base.js';
import type { RedactionMode } from '../security/allowlist.js';

export interface OrchestratorRunInput {
  /** Authenticated user id. Null = anonymous; patient-scoped tools
   *  will refuse to run. */
  userId: string | null;
  question: string;
  /** Correlation id (mirrors `/api/ai/ask` progressId). Surfaced in
   *  logs + audit. */
  requestId: string;
  consentLevel: ConsentLevel;
  /** Optional non-PII hint from the caller, e.g. "user is browsing
   *  the FAQ page". Appended to the user prompt. Never include raw
   *  patient identifiers here. */
  userContextHint?: string;
  /**
   * Abort signal forwarded to the underlying LLM provider. When the
   * SSE route detects a client disconnect it fires this signal so the
   * upstream completion request is cancelled — otherwise we keep
   * paying for tokens, tool calls keep running, and the per-key
   * concurrency budget stays held open until the model finishes by
   * itself. Wired into every LLM call (planner, tool-following round
   * 2, streamed final answer).
   */
  signal?: AbortSignal;
}

/**
 * Per-tool execution record — what the planner asked for, how the
 * executor fared. Powers the mobile "AI 思考过程" expandable section
 * and the richer audit-row payload (see migration 008's `tools_called`
 * jsonb column).
 *
 * Status is derived from whether the executor surfaced an error:
 *   - `ok` — call completed (chunk count may still be 0 if the
 *            retriever found nothing; that's not an error)
 *   - `error` — call raised; `errorDetail` carries the short reason,
 *               truncated upstream so the row stays bounded.
 */
export interface ToolCallSummary {
  /** Registered tool name, e.g. `search_medical_kb`. */
  name: string;
  /** Synthetic id assigned by the LLM. Lets the UI thread back to
   *  the `tool_start` / `tool_complete` events if it cares. */
  toolCallId: string;
  status: 'ok' | 'error';
  /** Number of retrieval chunks the tool returned. 0 is fine; we
   *  surface it so the UI can render "found no matches" honestly. */
  chunkCount: number;
  /** End-to-end latency for this tool call (executor only — does not
   *  include LLM round trips). Null when timing couldn't be captured. */
  latencyMs: number | null;
  /** Short error string when `status === 'error'`. Truncated to keep
   *  the audit row bounded. Never contains PII. */
  errorDetail?: string;
}

export interface OrchestratorRunResult {
  answer: string;
  citations: Citation[];
  /** Per-tool execution summary in the order the planner emitted
   *  them. Empty when the planner answered directly without calling
   *  any retriever.
   *
   *  Stored as jsonb in `ai_prompt_audit.tools_called`. Pre-existing
   *  audit rows persisted before this field landed are plain
   *  `string[]` of tool names; the audit decoder folds them into
   *  `ToolCallSummary[]` with null timings + unknown status so the
   *  UI doesn't need a separate code path. */
  toolCalls: ToolCallSummary[];
  /** Redacted patient fields that actually reached the final prompt. */
  fieldsUsed: string[];
  /** True iff any patient-scoped retriever contributed content. */
  usedPersonalData: boolean;
  redactionMode: RedactionMode;
  consentLevel: ConsentLevel;
  /** Final round system + user prompts (post-render). Useful for
   *  audit hashing + debug; tools' rendered output lives separately. */
  finalPrompt: {
    system: string;
    user: string;
  };
  /** sha256 hex of the rendered final prompt (system + user +
   *  rendered tool content). Recorded in audit so a row can be
   *  matched to a known prompt without storing the prompt itself. */
  redactedPromptHash: string;
  /** Total char count of the messages submitted on the final LLM
   *  call (system + user + all tool message bodies). */
  promptCharLength: number;
  llmUsage?: LlmUsage;
  latencyMs: number;
}

/**
 * Stage events emitted by `runStream`. The route maps these onto SSE
 * frames or onto the existing progressStore. Always terminates with
 * `done` (success) or `error` (failure); no further events follow.
 *
 * `answer_delta` is emitted only by the streaming code path
 * ({@link Orchestrator.runStreaming}); the legacy non-streaming
 * `run()` never produces it. Consumers should treat it as additive:
 * concatenate `text` segments in arrival order; the final answer
 * comes through the `done` event's `result.answer` regardless of
 * whether `answer_delta` fired (so the audit row + UI both have a
 * canonical body to refer to).
 */
export type OrchestratorEvent =
  | { type: 'planning' }
  | { type: 'plan_complete'; toolsPlanned: string[] }
  | { type: 'tool_start'; tool: string; toolCallId: string }
  | {
      type: 'tool_complete';
      tool: string;
      toolCallId: string;
      chunkCount: number;
      error?: string;
    }
  | {
      type: 'context_built';
      citationCount: number;
      fieldsUsed: string[];
      usedPersonalData: boolean;
    }
  | { type: 'answering' }
  | { type: 'answer_delta'; text: string }
  | { type: 'done'; result: OrchestratorRunResult }
  | { type: 'error'; message: string };

export class OrchestratorConsentDenied extends Error {
  constructor(message = 'Consent not granted for AI features') {
    super(message);
    this.name = 'OrchestratorConsentDenied';
  }
}

export class OrchestratorLlmUnavailable extends Error {
  constructor(message = 'LLM provider is not configured') {
    super(message);
    this.name = 'OrchestratorLlmUnavailable';
  }
}
