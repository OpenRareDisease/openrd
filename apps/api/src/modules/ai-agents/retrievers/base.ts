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
   *  recognise (e.g. `documentType` for patient_reports).
   *
   *  Scalar equality only, and only on keys the service allowlists
   *  (`knowledge_service._WHERE_ALLOWED_KEYS`: source_file,
   *  source_fingerprint, folder_path, category, file_type, language).
   *  Anything else is dropped there without an error, so a retriever
   *  must not treat「I sent a filter」as「the filter was honoured」.
   *  `search_medical_kb`'s `category` is the only caller today. */
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
  /** How authoritative the source is, derived from its position in the
   *  corpus (`guideline` | `literature` | `reference` | `community` |
   *  `unknown`). Vector retrievers over the medical KB set it; `null`
   *  everywhere the concept doesn't apply (a patient's own report is
   *  not more or less "authoritative", it is simply theirs). */
  authorityTier?: string | null;
  /** Patient-facing rendering of `authorityTier` —「指南/共识」/「文献」/
   *  「资料」/「病友经验」. Chinese because it is shown to the reader. */
  authorityLabel?: string | null;
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
  /** Patient-facing authority label for this citation —「指南/共识」,
   *  「文献」,「资料」,「病友经验」— or `null` when the source has no
   *  authority ranking. A citation chip that says 病友经验 and one that
   *  says 指南/共识 are claims of very different strength, and until now
   *  the UI could only show a filename, so they looked identical. */
  authorityLabel?: string | null;
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
/**
 * Reasons that mean the retrieval **could not run**, as opposed to
 * running and finding nothing.
 *
 * The distinction was invisible to everything downstream. When the
 * Python KB service is unreachable, `medical-kb.ts` returns
 * `emptyResult(..., 'kb_service_unreachable')` — but the tool wrapper
 * only reads `chunks.length`, so the call was reported to the audit as
 * `status: 'ok'` and to the model as「0 chunks」. The model, whose
 * system prompt requires it to consult the KB before answering
 * anything about FSHD, saw a successful-but-empty search and did the
 * only sensible thing: announced it would search again. That is the
 * whole of the observed「让我再用其他关键词搜索一下：」failure — with
 * the service down, EVERY knowledge question hit this path.
 *
 * `no_reports_found` and friends are NOT here: those are true answers
 * about the patient's data ("you have no reports"), and the model
 * should say so rather than report a malfunction.
 */
export const RETRIEVAL_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'kb_service_unreachable',
  'kb_service_error',
  // An empty corpus belongs here, not in the "searched and found
  // nothing" bucket. The KB service already refuses readiness on a
  // confirmed-zero `kb_chunks` (knowledge_service._readiness), but
  // `/multi` itself answers 200 with zero chunks, so a stack that is up
  // with an un-ingested corpus — a fresh environment, a restore that
  // half-finished — answered every question about the disease with
  // 「（无内容）」 and let the model fill the gap from its priors. There
  // is nothing to be found in an empty corpus; saying「知识库里没有」
  // would be a statement about a corpus that does not exist yet.
  'kb_empty_corpus',
  'not_implemented',
]);

/** The failure reason when the retrieval could not run, else null. */
export const retrievalFailureReason = (result: RetrieveResult): string | null => {
  const reason = result.metadata?.reason;
  return typeof reason === 'string' && RETRIEVAL_FAILURE_REASONS.has(reason) ? reason : null;
};

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
