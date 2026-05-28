/**
 * Retriever contract used by the AI orchestrator.
 *
 * A retriever takes a search input and a request-scoped context, returns
 * a list of chunks plus the citations the orchestrator can show the
 * user. Retrievers know **nothing** about PII redaction or LLM
 * formatting — they return raw data straight from their source. The
 * orchestrator + PIIRedactor (Phase 2 follow-up modules) are responsible
 * for what actually makes it into the prompt.
 *
 * Implementing a new retriever (GraphRAG, platform-docs once content
 * lands, etc.) means:
 *   1. Pick a stable `id` (used in audit logs and citations).
 *   2. Declare the `kind` so the orchestrator can route by capability.
 *   3. Implement `search(input, ctx)` returning a `RetrieveResult`.
 * No business code needs to change.
 */

import type { AppLogger } from '../../../config/logger.js';

/** What kind of backing store a retriever talks to. Used by the
 *  orchestrator's planner so it can pick the right tool for a question
 *  (e.g. "what is D4Z4" -> vector; "my reports last month" -> sql;
 *  future "X relates to Y" -> graph).
 */
export type RetrieverKind = 'vector' | 'sql' | 'graph' | 'hybrid';

/**
 * Per-call retrieval input. Each retriever may consult a subset of
 * these fields; unsupported fields should be ignored silently.
 */
export interface RetrieveInput {
  /** Original user question. Always set so SQL retrievers can keyword
   *  match and vector retrievers can fall back when no rewritten
   *  queries are provided. */
  question: string;
  /** Pre-rewritten queries from the planner. When omitted, retrievers
   *  that need an embedding query use `question` directly. */
  queries?: string[];
  /** Backend-specific metadata filter. Currently passed through to the
   *  Python KB service; SQL retrievers may translate keys they
   *  recognise (e.g. `documentType` for patient_reports). */
  filter?: Record<string, unknown>;
  /** Maximum chunks to return. Retrievers may cap below this for
   *  cost / token reasons. */
  limit?: number;
}

/**
 * Request-scoped context shared across all retrievers in a single
 * orchestrator pass.
 *
 * `userId` is the authenticated app user. `null` means "no user in
 * scope" — patient-scoped retrievers must short-circuit to empty in
 * that case to avoid leaking cross-user data.
 *
 * `consentLevel` lets retrievers skip work that the user hasn't
 * authorised. The patient retrievers refuse to query unless the user
 * is at least at `basic`.
 *
 * `requestId` correlates a single `/api/ai/ask` call across logs and
 * the eventual ai_prompt_audit row.
 */
export interface RetrieveContext {
  userId: string | null;
  consentLevel?: ConsentLevel;
  requestId?: string;
  logger: AppLogger;
  /** Caller-driven cancellation. When set and fired, the retriever
   *  SHOULD stop in-flight work (cancel fetch, cancel pg query) so a
   *  dropped SSE client doesn't keep tying up a pool connection or
   *  an HTTP socket until the per-tool wall-clock timeout expires. */
  signal?: AbortSignal;
}

export type ConsentLevel = 'none' | 'basic' | 'precise';

/**
 * A single retrieved chunk. `content` is whatever the retriever
 * thinks the orchestrator should consider quoting; `metadata` is
 * free-form per-retriever info (source authority, report type,
 * etc.) and `distance` is filled by vector retrievers so the
 * orchestrator can rank cross-source results.
 */
export interface RetrievedChunk {
  /** Identity used by citations + audit. Stable per chunk per call. */
  id: string;
  /** Which retriever produced this. Matches `IRetriever.id`. */
  source: string;
  content: string;
  metadata: Record<string, unknown>;
  /** Cosine distance for vector retrievers (lower = closer). `null`
   *  for SQL / graph retrievers where the concept doesn't apply. */
  distance: number | null;
  /** Logical source path / filename for citation display. Optional. */
  sourceFile?: string | null;
  /** Order within the source file when applicable. Optional. */
  chunkIndex?: number | null;
}

/**
 * UI-facing citation pointing at a retrieved chunk. The orchestrator
 * may renumber `label` after merging multiple retrievers' output;
 * `chunkId` stays stable.
 */
export interface Citation {
  chunkId: string;
  source: string;
  sourceFile?: string | null;
  chunkIndex?: number | null;
  /** Short snippet shown in the UI. Retrievers should keep this under
   *  ~200 chars and stripped of newlines for compact display. */
  snippet: string;
}

export interface RetrieveResult {
  retrieverId: string;
  chunks: RetrievedChunk[];
  citations: Citation[];
  /** Anything the orchestrator may want to surface for debug /
   *  observability: queries actually used, items dropped by junk
   *  filter, source DB latency, etc. */
  metadata: Record<string, unknown>;
}

export interface IRetriever {
  readonly id: string;
  readonly kind: RetrieverKind;
  search(input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult>;
}

/** Convenience for retrievers that have nothing to return. */
export const emptyResult = (
  retrieverId: string,
  reason: string,
  extra?: Record<string, unknown>,
): RetrieveResult => ({
  retrieverId,
  chunks: [],
  citations: [],
  metadata: { reason, ...(extra ?? {}) },
});

/** Trim arbitrary text into a citation-friendly snippet. Single line
 *  collapse, ≤ `max` characters with an ellipsis when truncated. */
export const buildSnippet = (text: string, max = 180): string => {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
};
