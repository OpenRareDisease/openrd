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
}

export interface OrchestratorRunResult {
  answer: string;
  citations: Citation[];
  /** Tool names the planner chose to call (in order). */
  toolsCalled: string[];
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
