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
  /** Authority tier + label derived from the chunk's corpus path.
   *  Emitted by knowledge.py's `resolve_authority`. */
  authority_tier?: string | null;
  authority_label?: string | null;
}

interface KbServiceResponse {
  answer?: string;
  chunks?: Array<KbServiceChunk | string>;
  metadata?: Record<string, unknown>;
}

/**
 * Reason reported when the KB was searched successfully and every
 * candidate was further away than the relevance floor.
 *
 * Deliberately NOT in `RETRIEVAL_FAILURE_REASONS`. That set means "the
 * retrieval could not run", and the answer layer turns it into 「检索
 * 失败…资料暂时取不到」. This is the opposite fact: the corpus WAS
 * consulted and genuinely has nothing on the subject. Telling a patient
 * the system is broken when the honest answer is 「我在知识库里没找到」
 * is its own kind of untrue.
 *
 * The floor itself lives on the Python side (knowledge.py,
 * `DEFAULT_RELEVANCE_FLOOR`, configurable via KB_RELEVANCE_FLOOR) — one
 * place, one measured number. This retriever only relays the verdict.
 * Re-applying a floor here against a second copy of the env var would
 * give two processes two different opinions about the same threshold.
 */
export const NO_RELEVANT_RESULTS = 'no_relevant_results';

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

/**
 * WeChat article furniture — the navigation and credits around a piece
 * rather than the piece.
 *
 * Judged by DENSITY, not by presence, for the same reason
 * `apparatusScore` and `DAMAGED_RATIO` below are: a paragraph that
 * mentions 目录 is a paragraph. This filter used to test presence
 * anywhere in the chunk and it cost real content — measured against
 * the 9,594-chunk corpus, presence-testing dropped 112 chunks across
 * 40 files and emptied four completely (see stripIngestLabel above for
 * the other half of that story). Switching to density recovers 72 of
 * them; the label strip recovers the rest.
 *
 * It also took 4 of 6 chunks out of each part of the patient
 * autobiography《不管如何，你得长大》连载1-4. Three of the patterns
 * were not
 * boilerplate at all — 连载, 社区简介 and 康复医师网络 are the TITLES
 * of documents someone curated on purpose. They are gone from this
 * list; a filter must never be able to name a document out of the
 * corpus.
 *
 * What remains is genuine furniture, and it only wins when it
 * dominates: these markers appear on their own short lines, so a chunk
 * that is mostly them is a navigation block, and a chunk that mentions
 * one in a sentence is prose.
 */
const FURNITURE_PATTERN =
  /^\s*(目录|上一篇|下一篇|排版|撰文|责任编辑|点击阅读|更多内容|阅读原文|扫码关注)\s*[:：]?\s*.{0,24}$/;

/** Scraped ClinicalTrials.gov result pages — list chrome, never prose,
 *  so presence is the right test for these two. */
const SCRAPE_PATTERN = /List Results \| ClinicalTrials|Search for:.*Recruiting studies/;

/** Majority of non-empty lines being furniture. A navigation block is
 *  almost entirely furniture; an article that ends with one credit
 *  line is not. */
const FURNITURE_RATIO = 0.5;

export const isNavigationBoilerplate = (text: string): boolean => {
  if (SCRAPE_PATTERN.test(text)) return true;
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return true;
  const furniture = lines.filter((line) => FURNITURE_PATTERN.test(line)).length;
  return furniture / lines.length > FURNITURE_RATIO;
};

/**
 * Citation apparatus — the machinery *around* a paper rather than what
 * it says. Reference entries, author/affiliation runs, DOIs, submission
 * dates, grant numbers, and the `(cid:N)` residue of a bad PDF text
 * extraction.
 *
 * Why this matters here and not just as tidiness
 * ----------------------------------------------
 * The corpus is mostly academic PDFs, and their bibliography and title
 * pages are dense in exactly the words a short query matches: the
 * disease name, the topic, and a lot of author surnames. Observed: a
 * patient asked「FSHD 患者运动需要注意什么」and 6 of the 8 chunks cited
 * back were reference lists, cover pages and author affiliation blocks
 * — after which the model wrote「据 Voet 等人 2014 年随机对照试验」,
 * having lifted an author-year off a numbered reference list and
 * presented it to a patient as evidence. A citation that looks
 * authoritative and points at a bibliography is worse than no citation.
 *
 * Threshold is 2, tuned against 400 real chunks: 85% score 0, 3% score
 * 1 (a paragraph that happens to cite one source — kept), and
 * everything from 2 up was junk on inspection (grant-number blocks,
 * a ClinicalTrials.gov results header, single reference entries).
 */
const APPARATUS_PATTERNS: readonly RegExp[] = [
  /DOI[:：]\s*10\.|doi\.org\/10\./g,
  /\b(?:Received|Revised|Accepted)\s*:/g,
  // Journal volume(issue):pages — `2016;98(5):1020-1029`, incl. fullwidth.
  /\d{4}\s*[;；]\s*\d+\s*[（(]\d+[）)]\s*[:：]\s*\d+/g,
  // A numbered reference entry: `12. Surname AB,`
  /^\s*\d{1,2}\.\s+[A-Z][a-zA-Z-]+\s+[A-Z]{1,3}[,，]/gm,
  /Grant\/Award Number/g,
  // NOTE: `(cid:N)` residue is deliberately NOT counted here. Presence
  // alone says nothing about readability — 164 of the 184 chunks
  // carrying it are under 5% artifact, i.e. an ordinary paragraph with
  // a couple of unmapped glyphs, including methods sections worth
  // retrieving. `isDamagedExtraction` below judges it by weight.

  // Two or more `Surname AB,` in a row — an author list.
  /[A-Z][a-z]+\s+[A-Z]{1,2}[,，]\s*[A-Z][a-z]+\s+[A-Z]{1,2}[,，]/g,
  // `| Name X` affiliation bars from two-column PDF headers.
  /\|\s*[A-Z][a-zé]+\s+[A-Z]/g,
  // Machine-translated bibliographies, which most of this corpus is:
  // 「Voet，N. B.等人（2013年）」. The English patterns above expect
  // `Surname AB,` and miss this entirely — which is why the very
  // reference list the model mined for its fake「据 Voet 等人 2014 年
  // 随机对照试验」scored below the threshold on the first pass.
  /等人\s*[（(]\s*\d{4}/g,
  // `Surname，A.` — the translated author form, comma before initials.
  /[A-Z][a-zA-Z-]{2,}\s*[，,]\s*[A-Z]\.(?:\s*[A-Z]\.)?/g,
  // Transliterated author lists with superscript affiliation digits:
  // 「劳伦斯J.海沃德1，爱德华多·安德拉德1，本·里德特2」. The Latin
  // patterns above cannot see these, so a conference-poster title page
  // was still being cited as a source on exercise.
  /[\u4e00-\u9fa5·.A-Z]{3,}\d\s*[，,]\s*[\u4e00-\u9fa5·.A-Z]{3,}\d/g,
  // Cover pages: a title plus a copyright line and nothing to read.
  /©\s*\d{4}/g,
];

const APPARATUS_LIMIT = 2;

/** How much to over-request so the post-filter yield still lands on
 *  the caller's target. 1.8 covers the measured ~18% junk rate with
 *  headroom for a query that happens to land in a bibliography-heavy
 *  document. */
const OVER_FETCH = 1.8;

export const apparatusScore = (text: string): number =>
  APPARATUS_PATTERNS.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);

/**
 * A title, heading or cover line rather than something to read.
 *
 * Distinct from `apparatusScore`, which measures citation machinery:
 * 「面肩肱型肌营养不良（FSHD）指南 ©2018年荷兰斯皮尔齐克特」 is a cover
 * page carrying exactly one apparatus marker, so density can never
 * catch it. What marks it is the absence of a sentence — short, and
 * nothing that terminates a clause.
 *
 * The 120-char ceiling keeps this away from real prose: a genuine
 * passage that long always closes at least one sentence, while titles
 * and running heads do not.
 */
const isTitleFragment = (text: string): boolean =>
  text.trim().length < 120 && !/[。．.！!？?；;]/.test(text);

/**
 * A PDF text layer with no usable font encoding leaves `(cid:N)` where
 * the glyphs should be. Judged by weight rather than presence: a
 * paragraph carrying two of them is a paragraph, and dropping it lost
 * real methods text, while one that is a third artifact is unreadable
 * to a person and to a model alike.
 */
const CID_RESIDUE = /\(cid:\d*\)/g;
const DAMAGED_RATIO = 0.15;

export const isDamagedExtraction = (text: string): boolean => {
  if (!text) return false;
  const artifacts = text.match(CID_RESIDUE);
  if (!artifacts) return false;
  const artifactChars = artifacts.reduce((sum, a) => sum + a.length, 0);
  return artifactChars / text.length >= DAMAGED_RATIO;
};

/**
 * Remove the `[label]` line the ingest pipeline prepends to every chunk
 * (scripts/kb-ingest.py:328 — `tagged = f"[{section.label}]\n{...}"`).
 *
 * 7,448 of the corpus's 9,594 chunks carry one. It is the pipeline's own
 * annotation — usually `[page 92]`, sometimes the source page's title —
 * and nothing downstream should judge content by it. Every filter below
 * was reading it as though the document itself said it, which is how a
 * single unlucky section label could empty a whole file out of the
 * corpus:《中国康复辅助器具目录》lost every chunk to the word 目录 in
 * its own heading, and the ClinicalTrials listing lost all 40 to the
 * scrape banner prepended to each one — including the chunks carrying
 * real NCT numbers, sponsors and recruiting status.
 *
 * Strip it once, here, before any judgement. A filter that can name a
 * document out of the corpus by its label is not a filter, it is a
 * delete button with bad aim.
 */
const INGEST_LABEL = /^\s*\[[^\]\n]{0,120}\]\s*\n?/;

export const stripIngestLabel = (text: string): string => (text ?? '').replace(INGEST_LABEL, '');

const isJunk = (raw: string): boolean => {
  const text = stripIngestLabel(raw);
  return (
    !text ||
    text.trim().length < 30 ||
    isNavigationBoilerplate(text) ||
    isTitleFragment(text) ||
    isDamagedExtraction(text) ||
    apparatusScore(text) >= APPARATUS_LIMIT
  );
};

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

    const wanted = input.limit ?? this.opts.defaults?.finalN ?? 8;
    const payload = {
      question: input.question,
      queries: queries.length > 0 ? queries : [input.question],
      // Ask for more than we need. Roughly a fifth of this corpus is
      // reference lists, cover pages and site navigation (measured:
      // 18% of 400 sampled chunks), all of which `isJunk` drops after
      // the service has already picked its top_k — so requesting
      // exactly the target left the model with two or three chunks and,
      // on one observed query, too little to answer from at all. We
      // over-fetch and trim back to `wanted` below.
      top_k: Math.ceil(wanted * OVER_FETCH),
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

    // The vector store returned nothing at all. Over a populated table a
    // nearest-neighbour search cannot do that, so this is an empty (or
    // fully filtered-out) corpus rather than an answer about it. Only
    // claim it when we sent no `where` filter — with a filter, zero hits
    // just means the filter matched nothing.
    const backendHits = parsed.metadata?.backend_hits;
    if (typeof backendHits === 'number' && backendHits === 0 && !payload.where) {
      ctx.logger.error(
        { kbServiceMetadata: parsed.metadata ?? null },
        'medical_kb retriever: KB service returned zero candidates for an unfiltered ' +
          'search — the corpus is empty. Run `npm run kb:ingest` or restore it.',
      );
      return emptyResult(this.id, 'kb_empty_corpus', {
        kbServiceMetadata: parsed.metadata ?? null,
        queriesUsed: payload.queries,
      });
    }

    // The service applied its relevance floor and nothing survived.
    // Surface that as its own reason rather than as a bare empty
    // result: `chunks: []` with no reason renders as 「（无内容）」,
    // which reads to the model exactly like a corpus that has no
    // opinion, and it improvises from priors instead of saying so.
    if (parsed.metadata?.below_relevance_floor === true) {
      ctx.logger.info(
        {
          relevanceFloor: parsed.metadata?.relevance_floor ?? null,
          bestDistance: parsed.metadata?.best_distance ?? null,
          candidatesConsidered: parsed.metadata?.candidates_considered ?? null,
        },
        'medical_kb retriever: every candidate was below the relevance floor',
      );
      return emptyResult(this.id, NO_RELEVANT_RESULTS, {
        kbServiceMetadata: parsed.metadata ?? null,
        queriesUsed: payload.queries,
        relevanceFloor: parsed.metadata?.relevance_floor ?? null,
        bestDistance: parsed.metadata?.best_distance ?? null,
      });
    }

    const rawChunks = Array.isArray(parsed.chunks) ? parsed.chunks : [];
    const chunks: RetrievedChunk[] = [];
    const citations: Citation[] = [];
    let dropped = 0;
    let duplicates = 0;
    // The corpus carries the same text under multiple rows — 12,352
    // rows for 9,596 distinct contents when this was measured, i.e.
    // 22% redundancy from repeated ingests. Retrieval surfaced them as
    // separate hits: one observed query returned 12 chunks that were
    // only 9 distinct texts, so a quarter of both the context budget
    // and the citation list was spent restating the same paragraph.
    // Deduping here fixes the symptom for every caller; the corpus
    // itself still wants a pass on the ingest side.
    const seenContent = new Set<string>();

    rawChunks.forEach((raw, idx) => {
      const content = typeof raw === 'string' ? raw : (raw?.content ?? '');
      const metadata =
        typeof raw === 'string' ? {} : ((raw?.metadata ?? {}) as Record<string, unknown>);

      if (isJunk(content)) {
        dropped += 1;
        return;
      }

      const fingerprint = content.replace(/\s+/g, ' ').trim();
      if (seenContent.has(fingerprint)) {
        duplicates += 1;
        return;
      }
      seenContent.add(fingerprint);

      const chunkId = randomUUID();
      const sourceFile = extractSourceFile(metadata);
      const chunkIndex = extractChunkIndex(metadata);
      const distance = coerceDistance(typeof raw === 'string' ? null : raw?.distance);
      // Top-level on the service payload, with the chunk's own metadata
      // as the fallback: the backfill writes it into metadata, and
      // knowledge.py lifts it to the top level for every hit including
      // rows the backfill hasn't reached.
      const authorityTier =
        pickString(typeof raw === 'string' ? null : raw?.authority_tier) ??
        pickString(metadata.authority_tier);
      const authorityLabel =
        pickString(typeof raw === 'string' ? null : raw?.authority_label) ??
        pickString(metadata.authority_label);

      chunks.push({
        id: chunkId,
        source: this.id,
        content,
        metadata,
        distance,
        sourceFile,
        chunkIndex,
        authorityTier,
        authorityLabel,
      });
      citations.push({
        chunkId,
        source: this.id,
        sourceFile,
        chunkIndex,
        snippet: buildSnippet(content),
        authorityLabel,
      });

      // idx referenced so we don't drop position info if we later
      // want to preserve ranking. Currently unused on purpose.
      void idx;
    });

    // Trimmed here rather than at the service: the junk and duplicate
    // filters run above, so cutting earlier would have discarded good
    // chunks to keep bad ones.
    const kept = chunks.slice(0, wanted);
    const keptIds = new Set(kept.map((c) => c.id));

    return {
      retrieverId: this.id,
      chunks: kept,
      citations: citations.filter((c) => keptIds.has(c.chunkId)),
      metadata: {
        kbServiceMetadata: parsed.metadata ?? null,
        queriesUsed: payload.queries,
        droppedJunk: dropped,
        droppedDuplicates: duplicates,
        previewAnswer: parsed.answer ?? null,
      },
    };
  }
}
