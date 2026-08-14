/**
 * Clinical-trials retriever — the live registry cache, as chunks.
 *
 * WHY THIS RETRIEVER EXISTS AT ALL
 *
 * The corpus already "answers" trial questions. It answers them out of
 * `05.相关研究/第一批：2025年3月31日/A.全球范围内FSHD药物研究进展汇总.htm`,
 * a saved ClinicalTrials.gov results page. Measured against the live
 * `kb_chunks` table on 2026-08-13:
 *
 *   -- 40 chunks in that file
 *   SELECT count(*) FROM kb_chunks
 *    WHERE source_file ILIKE '%全球范围内FSHD药物研究进展%';
 *
 *   -- chunks 0..36 are ClinicalTrials.gov's GLOSSARY ("手臂 A group or
 *   -- subgroup of participants...", "资格标准 The key requirements...")
 *   -- chunks 37..39 are the result table, machine-translated:
 *   --   「查看 24 项研究中的 1-10 项」   ← 10 of 24 studies, no more
 *   --   「NCT04635891 招聘 面肩关节疾病」 ← Recruiting → 招聘 (a job ad)
 *
 * and 39 of those 40 chunks survive `medical-kb.ts`'s `isJunk`
 * (measured by replaying the exported predicates over the stored
 * contents; only chunk 0 is dropped, on its scrape banner). So the
 * chunks carrying NCT numbers and the word 招聘 are retrievable today,
 * and nothing in the text they carry says what year it is — the only
 * date anywhere in that document lives in its folder name.
 *
 * This retriever is the other half of the fix. It reads what the
 * refresh actually fetched, and every trial it returns carries the date
 * we read it. medical-kb.ts stamps the snapshot with its own date so
 * the two can be told apart; companion-tools.ts makes sure a trial
 * question reaches this retriever whether or not the model thought to
 * ask.
 *
 * THE §A5 BOUNDARY IS THE SELECT LIST
 *
 * `trial_records` holds the registry's whole response in `raw`, which
 * for ClinicalTrials.gov includes `eligibilityModule.eligibilityCriteria`
 * (the inclusion/exclusion text) and, for finished studies,
 * `resultsSection`. Neither may reach a patient through this product:
 * we do not judge whether someone qualifies and we do not state what a
 * trial found. That is not enforced by asking the model nicely. It is
 * enforced by `readTrialSnapshot` never selecting `raw` at all, so
 * there is no code path from those fields to a prompt — the tool cannot
 * disclose what it never loads.
 *
 * Public data, no redaction. `renderChunkForPrompt` passes an unknown
 * source's `content` through unchanged (security/render.ts,
 * `passthrough`), which is right here: every field below is on a public
 * registry page that the `url` links to.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type {
  Citation,
  IRetriever,
  RetrieveContext,
  RetrieveInput,
  RetrieveResult,
  RetrievedChunk,
} from './base.js';
import { emptyResult } from './base.js';
import {
  readTrialSnapshot,
  TRIAL_SOURCE_LABELS,
  type TrialRecord,
  type TrialSnapshot,
} from '../../trials/trials.service.js';

/**
 * The six statuses §A4 fixes a Chinese rendering for — the same six as
 * `../../trials/status-map.ts`'s `CTGOV_STATUS_ZH`, asserted against it
 * in this file's test rather than derived from it, because the tool
 * schema that lists them needs a literal tuple and `Map.keys()` is
 * `string[]`.
 *
 * THESE ARE THE TRANSLATED WORDS, NOT THE FILTERABLE ONES. Nothing here
 * translates anything: the Chinese a patient sees comes from
 * `trial_records.status_zh`, written by the refresh from that map, and a
 * row the map did not recognise carries `status_zh = NULL` and is
 * rendered in the registry's English.
 *
 * The filter accepts ANY registry word, normalised, precisely because
 * these six do not cover the table. Measured against the dev database on
 * 2026-08-14, after `npm run trials:refresh`:
 *
 *   select status_raw, count(*) from trial_records group by 1 order by 2 desc;
 *   -- COMPLETED 45, RECRUITING 21, ACTIVE_NOT_RECRUITING 8,
 *   -- TERMINATED 7, UNKNOWN 7, ENROLLING_BY_INVITATION 3,
 *   -- NOT_YET_RECRUITING 1   (92 rows, ctgov only)
 *
 * `UNKNOWN` (7) and `ENROLLING_BY_INVITATION` (3) are outside the six —
 * ten of ninety-two — and `ENROLLING_BY_INVITATION` is a study still
 * taking participants. A filter that could not be pointed at those rows
 * would leave the model unable to answer about them at all, so the
 * filter is the registry's own vocabulary rather than ours;
 * `statusCounts` below names every word in the cache and marks the
 * untranslated ones, so the tool wrapper can tell the model they exist
 * and are askable.
 */
export const TRIAL_STATUS_FILTERS = [
  'RECRUITING',
  'NOT_YET_RECRUITING',
  'ACTIVE_NOT_RECRUITING',
  'COMPLETED',
  'TERMINATED',
  'WITHDRAWN',
] as const;
export type TrialStatusFilter = (typeof TRIAL_STATUS_FILTERS)[number];

/**
 * ClinicalTrials.gov v2 answers `RECRUITING` and `ACTIVE_NOT_RECRUITING`
 * already in this shape; the legacy v1 spelling was
 * `Active, not recruiting`. Fold case, and fold any run of spaces,
 * commas and hyphens to a single underscore, so both spellings of the
 * same status compare equal. Applied to the caller's word and to the
 * row's word alike — this is the whole of the matching, and it never
 * maps one status onto another.
 */
export const normalizeStatus = (statusRaw: string): string =>
  statusRaw
    .trim()
    .toUpperCase()
    .replace(/[\s,\-]+/g, '_');

export interface TrialsRetrieveFilter {
  /**
   * A registry status word, already normalised by `normalizeStatus`.
   * Any word is accepted, not just the six §A4 translates: the rows the
   * map does not cover are rows a patient can ask about, and the three
   * `ENROLLING_BY_INVITATION` studies in the cache today are the case
   * that decides it. A word no row carries matches nothing and is
   * reported as `matched: 0` — never as a failure, and never widened
   * into 「every trial」.
   */
  status?: string;
}

/** Default number of trials rendered into the prompt when the caller
 *  does not say. The cache holds 92 rows (026's header); rendering all
 *  of them would spend most of a context window restating a table. */
const DEFAULT_LIMIT = 12;
export const TRIALS_MAX_LIMIT = 40;

/** Rendering order: the ones a patient can still join, then the most
 *  recently updated. Presentation only — it changes which trials fit
 *  under `limit`, never what any of them says. */
const STATUS_ORDER: Record<string, number> = {
  RECRUITING: 0,
  NOT_YET_RECRUITING: 1,
  ACTIVE_NOT_RECRUITING: 2,
  COMPLETED: 3,
  TERMINATED: 4,
  WITHDRAWN: 5,
};

const rank = (trial: TrialRecord): number => STATUS_ORDER[normalizeStatus(trial.statusRaw)] ?? 6;

const compareTrials = (a: TrialRecord, b: TrialRecord): number => {
  const byStatus = rank(a) - rank(b);
  if (byStatus !== 0) return byStatus;
  // Missing update dates sort last: an undated row is not a fresh one.
  const aDate = a.sourceUpdatedAt ?? '';
  const bDate = b.sourceUpdatedAt ?? '';
  if (aDate !== bDate) return aDate < bDate ? 1 : -1;
  return a.sourceId < b.sourceId ? -1 : 1;
};

const NOT_PUBLISHED = '登记库未提供';

/**
 * One trial as the model reads it.
 *
 * Both dates are on every record and they are labelled apart, because
 * they answer different questions and the answer collapses if they are
 * confused: 「登记库最后更新」 is the sponsor's last edit — often years
 * ago on a study that is still open — while 「本平台读取时间」 is when
 * we last saw the row. A patient asking 「这个还在招吗」 is owed the
 * second one.
 */
const renderTrial = (trial: TrialRecord): string =>
  [
    '【临床试验登记记录】',
    `登记库：${TRIAL_SOURCE_LABELS[trial.source]}`,
    `登记号：${trial.sourceId}`,
    `标题：${trial.title}`,
    `状态（登记库原词）：${trial.statusRaw}`,
    // NULL means the mapping did not recognise the word, so there is
    // nothing to show — and 「状态未知」 would be a different and false
    // statement about a row whose status is right above this line.
    ...(trial.statusZh ? [`状态（本平台译法）：${trial.statusZh}`] : []),
    `期别：${trial.phase ?? NOT_PUBLISHED}`,
    `申办方：${trial.sponsor ?? NOT_PUBLISHED}`,
    `国家/地区：${trial.countries.length > 0 ? trial.countries.join('、') : NOT_PUBLISHED}`,
    `登记库最后更新：${trial.sourceUpdatedAt ?? NOT_PUBLISHED}`,
    `本平台读取时间：${trial.fetchedAt}`,
    `链接：${trial.url}`,
  ].join('\n');

/** One status word as it appears in the cache. */
export interface TrialStatusCount {
  /** The registry's word, verbatim — the spelling a caller can pass
   *  straight back as a filter. */
  status: string;
  count: number;
  /** True when §A4 fixes a Chinese rendering for this word. False means
   *  the card and the prompt both show the registry's English; it does
   *  NOT mean the rows are unfilterable. */
  translated: boolean;
}

export interface TrialsRetrievalMetadata {
  /** Every source, with its freshness. Copied through untouched so the
   *  tool wrapper can state it to the model. */
  sources: TrialSnapshot['sources'];
  /** Rows in the cache, all sources, before any filter. */
  cachedTotal: number;
  /** Rows matching the filter (equals `cachedTotal` when none). */
  matched: number;
  /** Rows actually rendered — `matched` capped at the limit. */
  returned: number;
  /** The normalised word that was filtered on, or null. */
  statusFilter: string | null;
  /**
   * Every status word in the cache with its row count, commonest first.
   *
   * The census, not a residue: it is what lets the tool wrapper answer a
   * filter that matched nothing with 「缓存里的状态词是这些」 instead of
   * an empty shrug, and what lets it point the model at the rows §A4
   * gives us no Chinese for — the three `ENROLLING_BY_INVITATION`
   * studies today — rather than leaving them as an absence.
   */
  statusCounts: TrialStatusCount[];
}

export class ClinicalTrialsRetriever implements IRetriever {
  readonly id = 'clinical_trials';
  readonly kind = 'sql' as const;

  constructor(private readonly pool: Pool) {}

  async search(input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult> {
    // No `userId` gate and no consent gate, on purpose: this reads a
    // public registry cache and touches nothing belonging to anybody.
    // The two patient retrievers refuse without a user because their
    // queries are keyed on one.

    // Checked before taking a pooled connection, and that is the whole
    // of what it does: a caller who has already hung up should not
    // occupy a connection or open a transaction. It does NOT cancel a
    // query that has already started — pg has no in-band cancel, and
    // the two queries below read at most a few hundred indexed rows.
    // Saying so here rather than letting the presence of the check
    // imply mid-flight cancellation.
    if (ctx.signal?.aborted) {
      return emptyResult(this.id, 'aborted');
    }

    // The cache being unreadable is an outcome, not an exception to
    // escape through. A throw here reaches the orchestrator as a bare
    // `call.error`, which context-builder classifies by tool name into
    // `corpus` — and the patient is then told 「资料库检索没有跑成功」,
    // a sentence about the MEDICAL KNOWLEDGE BASE, which is up and
    // whose chunks are sitting in the same prompt. What broke is this
    // registry cache and nothing else, so it comes back as a reasoned
    // empty result and the tool wrapper says which half is missing.
    let snapshot: TrialSnapshot;
    try {
      snapshot = await readTrialSnapshot(this.pool);
    } catch (error) {
      ctx.logger.error(
        { requestId: ctx.requestId, err: error },
        'clinical_trials retriever: cache unreadable',
      );
      return emptyResult(this.id, 'cache_unreadable');
    }

    const filter = (input.filter ?? {}) as TrialsRetrieveFilter;
    const statusFilter = filter.status ? normalizeStatus(filter.status) : null;
    const limit = Math.min(TRIALS_MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)));

    const census = new Map<string, number>();
    for (const trial of snapshot.trials) {
      census.set(trial.statusRaw, (census.get(trial.statusRaw) ?? 0) + 1);
    }

    const matched = statusFilter
      ? snapshot.trials.filter((trial) => normalizeStatus(trial.statusRaw) === statusFilter)
      : snapshot.trials;

    const selected = [...matched].sort(compareTrials).slice(0, limit);

    const chunks: RetrievedChunk[] = [];
    const citations: Citation[] = [];
    for (const trial of selected) {
      const chunkId = randomUUID();
      chunks.push({
        id: chunkId,
        source: this.id,
        content: renderTrial(trial),
        metadata: {
          source: trial.source,
          sourceId: trial.sourceId,
          statusRaw: trial.statusRaw,
          fetchedAt: trial.fetchedAt,
          url: trial.url,
        },
        distance: null,
        // The registry, not a corpus path. This is what the citation
        // card shows the patient (apps/mobile/lib/citation-label.ts
        // renders the basename of this string), and 「ClinicalTrials.gov」
        // is exactly what they should see before tapping through.
        sourceFile: TRIAL_SOURCE_LABELS[trial.source],
        chunkIndex: null,
        // No authority tier. The corpus grades documents by where they
        // sit in it (指南/文献/病友经验); a registry record is not that
        // kind of claim, and inventing a grade for it would put a badge
        // on the card that means nothing.
        authorityTier: null,
        authorityLabel: null,
      });
      citations.push({
        chunkId,
        source: this.id,
        sourceFile: TRIAL_SOURCE_LABELS[trial.source],
        chunkIndex: null,
        snippet: `${trial.sourceId}｜${trial.statusZh ?? trial.statusRaw}｜读取于 ${trial.fetchedAt}｜${trial.title}`,
        authorityLabel: null,
      });
    }

    const metadata: TrialsRetrievalMetadata & Record<string, unknown> = {
      sources: snapshot.sources,
      cachedTotal: snapshot.trials.length,
      matched: matched.length,
      returned: selected.length,
      statusFilter,
      statusCounts: [...census.entries()]
        .map(([status, count]) => ({
          status,
          count,
          translated: (TRIAL_STATUS_FILTERS as readonly string[]).includes(normalizeStatus(status)),
        }))
        .sort((a, b) => b.count - a.count || (a.status < b.status ? -1 : 1)),
    };

    ctx.logger.info(
      {
        requestId: ctx.requestId,
        cachedTotal: metadata.cachedTotal,
        matched: metadata.matched,
        returned: metadata.returned,
        statusFilter,
        sources: snapshot.sources,
      },
      'clinical_trials retriever: served from cache',
    );

    return { retrieverId: this.id, chunks, citations, metadata };
  }
}
