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
import { buildSnippet, emptyResult, retrievalFailureReason } from './base.js';

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
 * anywhere in the chunk and it cost real content. Replaying master's
 * pattern over the live 10,241-chunk corpus (2026-08-11) drops 114
 * chunks across 41 files and empties four completely; over the
 * pre-2026-08-07 snapshot this was first measured against — 7,800
 * chunks, before the re-chunk — it was 112 / 40 / the same four. Of the
 * 114, switching to density recovers 74 on its own and the label strip
 * recovers another 39 (see stripIngestLabel above for that half of the
 * story). One is still dropped, and correctly: chunk 0 of the
 * ClinicalTrials listing carries the scrape banner in its body, not
 * only in its ingest label.
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
 * (_chunk_sections in scripts/kb-ingest.py —
 * `tagged = f"[{section.label}]\n{...}"`).
 *
 * 7,524 of the corpus's 10,241 chunks carry one (measured 2026-08-11).
 * It is the pipeline's own annotation — usually `[page 92]`, sometimes
 * the source page's title — and nothing downstream should judge content
 * by it. Every filter below was reading it as though the document itself
 * said it, which is how a single unlucky section label could empty a
 * whole file out of the corpus:《中国康复辅助器具目录（2023年版）》修订
 * 说明.docx is 2 chunks long and lost both to the word 目录 in its own
 * heading, and the ClinicalTrials listing lost all 40 to the scrape
 * banner prepended to each one — including the chunks carrying real NCT
 * numbers, sponsors and recruiting status.
 *
 * Spell that first filename out in full, because the short form collides
 * with a different document and a different bug. The 110-page catalogue
 * proper — 08.无障碍生活/…/A.中国康复辅助器具目录（2023年版）.docx, 534
 * chunks — was never emptied by this filter: master's pattern matches 2
 * of its 534 and the density-gated version matches 0. It was invisible
 * for an unrelated reason (a legacy .doc wearing a .docx extension, so
 * the parser skipped it silently until 4d27900) and it was not even in
 * the index when this measurement was taken. Two causes, one abbreviated
 * name; do not let the next operator diagnose one as the other.
 *
 * Strip it once, here, before any judgement. A filter that can name a
 * document out of the corpus by its label is not a filter, it is a
 * delete button with bad aim.
 */
const INGEST_LABEL = /^\s*\[[^\]\n]{0,120}\]\s*\n?/;

export const stripIngestLabel = (text: string): string => (text ?? '').replace(INGEST_LABEL, '');

/**
 * The identity of a chunk's TEXT, for deciding whether two hits are the
 * same passage.
 *
 * WHY THIS IS NOT `content.replace(/\s+/g, ' ').trim()`
 *
 * Because that key called every row in this corpus distinct. Replaying
 * both over the live `kb_chunks` (2026-08-19) puts 406 chunks into 190
 * duplicate groups that the collapsing key had called distinct, 168 of
 * the groups spanning more than one source file — while the collapsing
 * key finds 10,241 distinct texts in 10,241 rows, i.e. it drops nothing
 * at all. The dedup below was a no-op on the corpus it was written for.
 *
 * The 22% exact-duplicate redundancy that motivated it was real and is
 * gone (kb-prune, and the re-chunk). What is left is the same paragraph
 * reaching the index through two DIFFERENT converters, and two things
 * make those copies differ in bytes while being the same text:
 *
 *   1. The ingest label. `[page 5]` is on the .pdf copy and not on the
 *      .docx copy of the same document — the pipeline's own annotation,
 *      which `stripIngestLabel` above exists to keep out of every
 *      judgement, and which this one key was still reading as though the
 *      document had said it.
 *   2. Where the spaces went. The .docx extraction of 文献/the road to
 *      the target road-2023 says 「of FSHD」 as `ofFSHD` and 「in
 *      patients」 as `inpatients`; the .pdf of the same document keeps
 *      both spaces. Collapsing RUNS of whitespace cannot reconcile that,
 *      because the run on one side is length zero.
 *
 * So: strip the label, then ignore whitespace entirely rather than
 * normalising it. Two passages that differ only in where the spaces
 * fall are one passage — that is the whole claim, and it is the case
 * being caught. Nothing else can collide: removing whitespace never
 * merges texts whose other characters differ, and `isJunk` has already
 * dropped anything under 30 characters, where a coincidence would have
 * to live.
 *
 * WHAT IT COST TO GET THIS WRONG
 *
 * Asked 「FSHD 的 D4Z4 重复单元数和病情严重程度是什么关系？」 against
 * the live service, the top two hits were the .docx and .pdf copies of
 * one paragraph — identical at 939 characters once normalised the way
 * this function does it. That paragraph is the only place in the corpus
 * that lays out severity by repeat band (1–3 more severe and faster
 * progressing, 7–10 generally milder), so the model was handed the
 * ladder twice, in the two highest-ranked slots, and two of the eight
 * citation cards pointed at the same sentences in two files. The band
 * numbers are the corpus's; being shown them twice is this key's.
 */
export const contentFingerprint = (text: string): string =>
  stripIngestLabel(text).replace(/\s+/g, '');

/**
 * A saved registry results page, and the day it was saved.
 *
 * WHAT IS WRONG WITH THESE CHUNKS
 *
 * The corpus contains one of them today:
 * `05.相关研究/第一批：2025年3月31日/A.全球范围内FSHD药物研究进展汇总.htm`,
 * a ClinicalTrials.gov search-results page saved as HTML. Measured
 * against the live `kb_chunks` table on 2026-08-13:
 *
 *   SELECT count(*) FROM kb_chunks
 *    WHERE source_file ILIKE '%全球范围内FSHD药物研究进展%';   -- 40
 *
 * Chunks 0–36 are the site's GLOSSARY, not the results. Chunks 37–39
 * are the results table, and they are Google-translated: 「NCT04635891
 * 招聘」 for Recruiting, 「面肩关节疾病」 for facioscapulohumeral, and
 * 「查看 24 项研究中的 1-10 项」 — ten of twenty-four studies, because
 * that is what fit on page one. 39 of the 40 survive `isJunk` (replayed
 * the exported predicates above over the stored contents; only chunk 0
 * is dropped, on the scrape banner in its body).
 *
 * So a patient asking 「哪些试验在招募」 could be shown NCT numbers with
 * a status word that was true on one day in 2025, mistranslated, and
 * incomplete. And nothing in the text says when: the ONLY date attached
 * to that document is the 第一批：2025年3月31日 in its folder name,
 * which reaches neither the prompt (context-builder renders the chunk's
 * `source_file`, not its folder) nor the citation card.
 *
 * WHAT THIS DOES ABOUT IT
 *
 * Stamps the date onto the text, so the date travels wherever the text
 * travels — into the prompt and into the snippet the patient opens. It
 * does NOT drop the chunk: the page is a real record of what was
 * registered in March 2025 and that is a legitimate thing to retrieve;
 * what it is not is a statement about today. The live answer comes from
 * `list_clinical_trials` (tools/list-clinical-trials.ts), which
 * companion-tools.ts adds to any trial-shaped question.
 *
 * DETECTION is on the RAW chunk text — the ingest label included — and
 * on `html_title`, because the label IS the saved page's title and the
 * body of a middle-of-the-document chunk says nothing about where it
 * came from. `SCRAPE_PATTERN` is reused rather than re-spelled: the
 * same two literals that make `isNavigationBoilerplate` call the banner
 * furniture are what identify the document here.
 */
const SCRAPE_TITLE_KEYS = ['html_title', 'source_file', 'folder_path'] as const;

/** `第一批：2025年3月31日` and `2025-03-31`, in that order of
 *  preference. Nothing else is guessed at — a document whose path
 *  carries no date is stamped as undated, which is a true statement
 *  about it and a warning in its own right. */
const SNAPSHOT_DATE_PATTERNS: readonly RegExp[] = [
  /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
  /(\d{4})-(\d{2})-(\d{2})/,
];

const pad2 = (value: string): string => value.padStart(2, '0');

/** `YYYY-MM-DD` from the first date-looking run in the chunk's path
 *  metadata, or `null`. */
export const registrySnapshotDate = (metadata: Record<string, unknown>): string | null => {
  for (const key of ['folder_path', 'source_file'] as const) {
    const value = metadata[key];
    if (typeof value !== 'string') continue;
    for (const pattern of SNAPSHOT_DATE_PATTERNS) {
      const match = pattern.exec(value);
      if (match) return `${match[1]}-${pad2(match[2] as string)}-${pad2(match[3] as string)}`;
    }
  }
  return null;
};

/** True when this chunk came out of a saved registry results page.
 *  `rawContent` must be the text as the service returned it, before
 *  `stripIngestLabel` — the label is where the page title lives. */
export const isRegistrySnapshotChunk = (
  rawContent: string,
  metadata: Record<string, unknown>,
): boolean => {
  if (SCRAPE_PATTERN.test(rawContent ?? '')) return true;
  return SCRAPE_TITLE_KEYS.some((key) => {
    const value = metadata[key];
    return typeof value === 'string' && SCRAPE_PATTERN.test(value);
  });
};

/** Prompt-side stamp. Chinese because the model answers in Chinese and
 *  routinely paraphrases this kind of line into the answer. */
export const registrySnapshotNote = (scrapedOn: string | null): string =>
  [
    '【平台标注·这不是当前状态】',
    scrapedOn
      ? `以下内容来自 ${scrapedOn} 保存的 ClinicalTrials.gov 网页，是那一天的静态快照。`
      : '以下内容来自一次保存的 ClinicalTrials.gov 网页，静态快照，而且保存日期没有记录下来。',
    '里面的招募状态只在保存那天成立，现在很可能已经变了；页面上的中文是网页机器翻译，状态词可能是错的（例如 Recruiting 被译成「招聘」）。',
    '要回答「现在还在不在招募」，必须用 list_clinical_trials 工具返回的数据，并把它给出的读取时间一起告诉用户。',
    '这一段只能用来说明当时登记过哪些研究。',
  ].join('');

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

/**
 * A metadata filter with nothing in it is not a filter.
 *
 * `{}` is truthy in JavaScript, and the empty-corpus guard below asks
 * exactly「was a filter sent?」 to decide whether zero hits means the
 * corpus is gone. A caller that builds `{ category: undefined }` from an
 * absent argument would therefore have silenced the outage alarm for
 * every request it made. Collapse those to `null` once, here.
 *
 * `null`/`undefined` VALUES are dropped; an empty string is not, because
 * `category: ''` is a real filter over this corpus (the 1,746 chunks
 * whose files sit at the corpus root carry exactly that, measured
 * 2026-08-11).
 */
const normalizeFilter = (filter?: Record<string, unknown>): Record<string, unknown> | null => {
  if (!filter) return null;
  const entries = Object.entries(filter).filter(([, v]) => v !== undefined && v !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

export class MedicalKbRetriever implements IRetriever {
  readonly id = 'medical_kb';
  readonly kind = 'vector' as const;

  constructor(private readonly opts: MedicalKbRetrieverOptions) {}

  /**
   * Run the search, and when a metadata filter found nothing, run it
   * again over the whole corpus.
   *
   * Why widening rather than reporting an empty category
   * ----------------------------------------------------
   * A filtered search that comes back empty has three possible honest
   * readings —「this category has no chunks」,「nothing in it was within
   * the relevance floor」,「everything in it was junk」— and the answer
   * layer has vocabulary for none of them. It branches on exactly two
   * things: `RETRIEVAL_FAILURE_REASONS` (which renders「资料库检索没有跑
   * 成功」 — a malfunction the search did not have) and
   * `NO_RELEVANT_RESULTS` (which renders「这个问题在平台的资料库里没有
   * 找到相关资料」 — a claim about the WHOLE corpus that a
   * category-scoped miss does not support). Anything else renders as
   *「（无内容）」, which base.ts documents as the shape that makes the
   * model fill the gap from its own priors.
   *
   * And it is not a hypothetical. Measured against the live service
   * (10,241 chunks, re-run 2026-08-11),「确诊 FSHD 之后心理上怎么调整」
   * returns 8 chunks unfiltered (best distance 0.3100) but ZERO under
   * `category: 10.心理支持` — that folder's closest chunk is 0.4135, just
   * past the 0.40 floor. Reporting that as「资料库里没有」would be a flat
   * untruth about a question the corpus answers well.
   *
   * So the filter is treated as what it actually is: a ranking
   * preference, not a promise about coverage. If the category has the
   * answer the patient gets it without competing against the 5,009
   * chunks of molecular biology in 文献/; if it does not, they get the
   * corpus-wide answer they would have got before this parameter
   * existed. Nothing is
   * hidden, and every downstream claim stays true. `filterFellBack` in
   * the metadata says which of the two happened, and the tool wrapper
   * puts it in front of the model so it cannot present a widened result
   * as material from the category it asked for.
   */
  async search(input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult> {
    const queries = (input.queries ?? [input.question])
      .map((q) => (q ?? '').trim())
      .filter(Boolean);

    if (queries.length === 0 && !input.question.trim()) {
      return emptyResult(this.id, 'empty_question');
    }

    const filter = normalizeFilter(input.filter);
    const filtered = await this.searchOnce(input, ctx, filter);
    if (!filter) return filtered;

    const stayFiltered = (): RetrieveResult => ({
      ...filtered,
      metadata: { ...filtered.metadata, filterApplied: filter, filterFellBack: false },
    });

    if (filtered.chunks.length > 0) return stayFiltered();
    // The search could not RUN (service down, 5xx). A second request
    // without the filter cannot fix that and would double the wait a
    // patient sits through before being told so.
    if (retrievalFailureReason(filtered)) return stayFiltered();
    // The caller hung up (dropped SSE client). Retrying would only
    // abort again.
    if (ctx.signal?.aborted) return stayFiltered();

    ctx.logger.info(
      { filter, filteredReason: filtered.metadata?.reason ?? null },
      'medical_kb retriever: category-filtered search returned nothing — widening to the whole corpus',
    );

    const widened = await this.searchOnce(input, ctx, null);
    return {
      ...widened,
      metadata: {
        ...widened.metadata,
        filterApplied: filter,
        filterFellBack: true,
        filteredAttempt: {
          reason: filtered.metadata?.reason ?? null,
          kbServiceMetadata: filtered.metadata?.kbServiceMetadata ?? null,
        },
      },
    };
  }

  /**
   * One round trip to the KB service. `filter` is already normalised —
   * `null` means no filter was sent, and the empty-corpus guard below
   * depends on that being exact.
   */
  private async searchOnce(
    input: RetrieveInput,
    ctx: RetrieveContext,
    filter: Record<string, unknown> | null,
  ): Promise<RetrieveResult> {
    const queries = (input.queries ?? [input.question])
      .map((q) => (q ?? '').trim())
      .filter(Boolean);

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
      where: filter,
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
    // just means the filter matched nothing, and「资料库尚未装载」routes
    // to a hard-failure instruction that tells the patient the platform
    // is broken. `filter` is the normalised value, so an empty object
    // can never masquerade as a real filter and suppress this.
    const backendHits = parsed.metadata?.backend_hits;
    if (typeof backendHits === 'number' && backendHits === 0 && !filter) {
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
    /** chunkId -> the scrape date stamped on it (`null` when the path
     *  carried none), for every chunk identified as a saved registry
     *  page. Keyed by chunk so the counts reported below can be taken
     *  over the chunks that survive the trim rather than over every
     *  candidate — the model is told about the ones it can see. */
    const registrySnapshots = new Map<string, string | null>();
    // The corpus carries the same text under multiple rows. It was
    // 12,352 rows for 9,596 distinct contents when this was first
    // measured — 22% redundancy from repeated ingests, and one observed
    // query returned 12 chunks that were only 9 distinct texts, so a
    // quarter of both the context budget and the citation list was spent
    // restating the same paragraph. Those exact duplicates are gone from
    // the index now, but the redundancy is not: the same document is
    // ingested as both .docx and .pdf, and the two converters disagree
    // about the ingest label and about where the spaces go. See
    // `contentFingerprint` for what that costs and why the key ignores
    // both. Deduping here fixes the symptom for every caller; the corpus
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

      const fingerprint = contentFingerprint(content);
      if (seenContent.has(fingerprint)) {
        duplicates += 1;
        return;
      }
      seenContent.add(fingerprint);

      const chunkId = randomUUID();

      // Stamped AFTER the dedup fingerprint above, so two copies of the
      // same scraped page still collapse to one chunk, and before
      // anything reads `content` — the whole point is that no consumer
      // can see this text without its date.
      let promptContent = content;
      let snippetSource = content;
      if (isRegistrySnapshotChunk(content, metadata)) {
        const scrapedOn = registrySnapshotDate(metadata);
        registrySnapshots.set(chunkId, scrapedOn);
        promptContent = `${registrySnapshotNote(scrapedOn)}\n${content}`;
        // The card gets a short marker rather than the whole note: the
        // snippet is capped at 180 characters and the note is longer
        // than that, so pasting it in full would replace the preview
        // with the warning and the patient would open a card that shows
        // nothing about the source it points at.
        snippetSource = `（${scrapedOn ?? '日期不详'}的网页快照）${content}`;
      }

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
        content: promptContent,
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
        snippet: buildSnippet(snippetSource),
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

    // Over `kept`, not over every candidate: a stamped chunk that the
    // trim discarded is not in the prompt, and telling the model 「其中
    // 一段是 2025 年的快照」 about a chunk it cannot see would send it
    // looking for a caveat that has nothing to attach to.
    const keptSnapshots = kept
      .filter((chunk) => registrySnapshots.has(chunk.id))
      .map((chunk) => registrySnapshots.get(chunk.id) ?? null);

    return {
      retrieverId: this.id,
      chunks: kept,
      citations: citations.filter((c) => keptIds.has(c.chunkId)),
      metadata: {
        kbServiceMetadata: parsed.metadata ?? null,
        queriesUsed: payload.queries,
        droppedJunk: dropped,
        droppedDuplicates: duplicates,
        registrySnapshotChunks: keptSnapshots.length,
        /** Distinct scrape dates among them, sorted. A stamped chunk
         *  whose path carried no date contributes nothing here, which
         *  is why the count above is the one the wrapper branches on. */
        registrySnapshotDates: [
          ...new Set(keptSnapshots.filter((d): d is string => d !== null)),
        ].sort(),
        previewAnswer: parsed.answer ?? null,
      },
    };
  }
}
