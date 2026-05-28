/**
 * Vector retriever backed by the Python knowledge service.
 *
 * Translates a `RetrieveInput` into the `/multi` payload the
 * knowledge service expects, parses its response into the unified
 * `RetrievedChunk` shape, and produces user-facing citations. The
 * Python side handles the actual vector lookup (pgvector or
 * Chroma Cloud depending on `KB_BACKEND`); from the orchestrator's
 * perspective this retriever just speaks `IRetriever`.
 */

import { randomUUID } from 'node:crypto';

import type {
  Citation,
  IRetriever,
  RetrieveContext,
  RetrieveInput,
  RetrieveResult,
  RetrievedChunk,
} from './base.js';
import { buildSnippet, emptyResult } from './base.js';

interface KbServiceChunk {
  content?: string;
  metadata?: Record<string, unknown>;
  distance?: number | null;
}

interface KbServiceResponse {
  answer?: string;
  chunks?: Array<KbServiceChunk | string>;
  metadata?: Record<string, unknown>;
}

export interface MedicalKbRetrieverOptions {
  /** Base URL for the Python KB service, e.g. `http://kb-service:5010`. */
  kbServiceUrl: string;
  /** Bearer token the KB service expects on every /multi request.
   *  Required when the service is bound to anything other than
   *  loopback. Omit for dev environments where the service runs
   *  without auth. */
  serviceToken?: string;
  /** Overall network timeout per request. Defaults to 30s. */
  timeoutMs?: number;
  /** Defaults forwarded to the knowledge service. Match Phase 1
   *  `DEFAULT_*` constants so behaviour matches the legacy code. */
  defaults?: {
    finalN?: number;
    fetchK?: number;
    maxPerSource?: number;
  };
}

/** Patterns the legacy retrieval flow used to drop boilerplate
 *  chunks coming from public-channel scrapes. We keep an extra
 *  defence here so any chunks the KB service does forward stay out
 *  of the orchestrator's context. */
const JUNK_PATTERN =
  /目录|上一篇|下一篇|连载|排版|撰文|责任编辑|点击阅读|更多内容|病友故事\s*·\s*目录|社区简介|康复医师网络/;

const isJunk = (text: string): boolean =>
  !text || text.trim().length < 30 || JUNK_PATTERN.test(text);

const coerceDistance = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
};

const pickString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const extractSourceFile = (metadata: Record<string, unknown>): string | null =>
  pickString(metadata.source_file) ??
  pickString(metadata.source) ??
  pickString(metadata.file) ??
  pickString(metadata.path) ??
  pickString(metadata.folder_path);

const extractChunkIndex = (metadata: Record<string, unknown>): number | null => {
  const raw = metadata.chunk_index ?? metadata.chunkIndex;
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
};

export class MedicalKbRetriever implements IRetriever {
  readonly id = 'medical_kb';
  readonly kind = 'vector' as const;

  constructor(private readonly opts: MedicalKbRetrieverOptions) {}

  async search(input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult> {
    const queries = (input.queries ?? [input.question])
      .map((q) => (q ?? '').trim())
      .filter(Boolean);

    if (queries.length === 0 && !input.question.trim()) {
      return emptyResult(this.id, 'empty_question');
    }

    const payload = {
      question: input.question,
      queries: queries.length > 0 ? queries : [input.question],
      top_k: input.limit ?? this.opts.defaults?.finalN ?? 8,
      fetch_k: this.opts.defaults?.fetchK ?? 80,
      max_per_source: this.opts.defaults?.maxPerSource ?? 4,
      where: input.filter ?? null,
      keep_debug_fields: false,
    };

    const controller = new AbortController();
    const timeoutMs = this.opts.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Merge the caller's cancellation signal in too — a route-level
    // res.on('close') should immediately abort the KB fetch, not wait
    // for the 30s timer.
    const onCallerAbort = () => controller.abort();
    if (ctx.signal) {
      if (ctx.signal.aborted) {
        controller.abort();
      } else {
        ctx.signal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.opts.serviceToken) {
      headers.Authorization = `Bearer ${this.opts.serviceToken}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.opts.kbServiceUrl}/multi`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      ctx.logger.warn({ error }, 'medical_kb retriever: fetch failed');
      return emptyResult(this.id, 'kb_service_unreachable', {
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
      if (ctx.signal) {
        ctx.signal.removeEventListener('abort', onCallerAbort);
      }
    }

    const text = await response.text();
    let parsed: KbServiceResponse | null = null;
    try {
      parsed = text ? (JSON.parse(text) as KbServiceResponse) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok || !parsed) {
      ctx.logger.warn(
        { status: response.status, bodyPreview: text.slice(0, 200) },
        'medical_kb retriever: non-ok response from KB service',
      );
      return emptyResult(this.id, 'kb_service_error', {
        status: response.status,
        answer: parsed?.answer ?? null,
      });
    }

    const rawChunks = Array.isArray(parsed.chunks) ? parsed.chunks : [];
    const chunks: RetrievedChunk[] = [];
    const citations: Citation[] = [];
    let dropped = 0;

    rawChunks.forEach((raw, idx) => {
      const content = typeof raw === 'string' ? raw : (raw?.content ?? '');
      const metadata =
        typeof raw === 'string' ? {} : ((raw?.metadata ?? {}) as Record<string, unknown>);

      if (isJunk(content)) {
        dropped += 1;
        return;
      }

      const chunkId = randomUUID();
      const sourceFile = extractSourceFile(metadata);
      const chunkIndex = extractChunkIndex(metadata);
      const distance = coerceDistance(typeof raw === 'string' ? null : raw?.distance);

      chunks.push({
        id: chunkId,
        source: this.id,
        content,
        metadata,
        distance,
        sourceFile,
        chunkIndex,
      });
      citations.push({
        chunkId,
        source: this.id,
        sourceFile,
        chunkIndex,
        snippet: buildSnippet(content),
      });

      // idx referenced so we don't drop position info if we later
      // want to preserve ranking. Currently unused on purpose.
      void idx;
    });

    return {
      retrieverId: this.id,
      chunks,
      citations,
      metadata: {
        kbServiceMetadata: parsed.metadata ?? null,
        queriesUsed: payload.queries,
        droppedJunk: dropped,
        previewAnswer: parsed.answer ?? null,
      },
    };
  }
}
