/**
 * Shapes carried in and out of ai_prompt_audit. See
 * db/migrations/008_ai_consent_and_audit.sql for the table.
 */

import type { ToolCallSummary } from '../orchestrator/types.js';
import type { ConsentLevel } from '../retrievers/base.js';
import type { RedactionMode } from '../security/allowlist.js';

export type { ToolCallSummary };

export type AuditStatus = 'success' | 'error' | 'consent_denied';

/**
 * Input to {@link AuditLogger.record}. All fields except optional
 * timestamps are mandatory so the audit row carries every dimension
 * support / compliance need to reconstruct a call.
 */
export interface AuditEntryInput {
  /** Authenticated user id at call time. Nullable so anonymous /
   *  system calls still record. */
  userId: string | null;
  /** Optional caller-provided correlation id (mirrors the progress
   *  id used by the existing /api/ai/ask flow). */
  requestId?: string | null;
  llmProvider: string;
  llmModel: string;
  consentLevel: ConsentLevel;
  redactionMode: RedactionMode;
  /** sha256 hash of the **redacted** prompt that was actually sent
   *  to the LLM, hex-encoded. Hashing keeps audit small + private:
   *  we can prove a row corresponds to a known prompt without
   *  storing the prompt body itself. */
  redactedPromptHash?: string | null;
  /** Length (chars) of the redacted prompt, for back-of-envelope
   *  cost analysis. */
  promptCharLength?: number | null;
  /** Multi-turn: how many prior conversation turns entered this call
   *  (0 = single-turn; pre-multi-turn rows default to 0, which is
   *  literally true for them). */
  historyMessageCount?: number;
  /** Multi-turn: total chars of the normalized history. Null on rows
   *  that predate the feature (distinct from a true 0). */
  historyCharLength?: number | null;
  /** Whether any patient-scoped retriever contributed to the prompt
   *  (drives the "本回答用到了你的..." UI hint). */
  usedPersonalData: boolean;
  /** Concrete field names the orchestrator emitted to the prompt
   *  (after redaction). Empty for non-personal calls. */
  fieldsUsed: string[];
  /** Per-tool execution summary (name + status + chunkCount + latency).
   *  Persisted as jsonb under `ai_prompt_audit.tools_called`. Legacy
   *  rows persisted before this field landed are plain `string[]` of
   *  tool names; the read-side decoder folds them into
   *  `ToolCallSummary[]` with `status='ok'` + `latencyMs=null` so
   *  every UI surface sees the same shape. */
  toolsCalled: ToolCallSummary[];
  /** Wall time spent inside the orchestrator, end to end. */
  latencyMs?: number | null;
  status: AuditStatus;
  errorDetail?: string | null;
}

/**
 * Shape returned by list queries — adds the server-generated id +
 * created_at and replaces the JSONB columns with their parsed JS
 * representations.
 */
export interface AuditEntry extends AuditEntryInput {
  id: string;
  createdAt: string;
}

export interface ListAuditOptions {
  /** Cap rows per call. Defaults to 50, hard cap 200. */
  limit?: number;
  offset?: number;
  /** Filter to one or more statuses. */
  status?: AuditStatus | AuditStatus[];
}
