import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { RetrieveContext } from './base.js';
import {
  ClinicalTrialsRetriever,
  normalizeStatus,
  TRIAL_STATUS_FILTERS,
} from './clinical-trials.js';
import type { TrialsRetrievalMetadata } from './clinical-trials.js';
import { cdtRowsPage, ctgovPage1 } from '../../trials/__fixtures__/fixtures.js';
import { _parseSearchList, CDT_DETAIL_URL } from '../../trials/chinadrugtrials.fetcher.js';
import { _toTrialRecord } from '../../trials/ctgov.fetcher.js';
import { CTGOV_STATUS_ZH } from '../../trials/status-map.js';
import { trialFetchState } from '../../trials/trials.service.js';
import type { TrialRecord, TrialSnapshot } from '../../trials/trials.service.js';
import type { TrialRecordInput } from '../../trials/trials.types.js';

const snapshotMock = vi.fn();

vi.mock('../../trials/trials.service.js', async () => {
  const actual = await vi.importActual<typeof import('../../trials/trials.service.js')>(
    '../../trials/trials.service.js',
  );
  return { ...actual, readTrialSnapshot: (...args: unknown[]) => snapshotMock(...args) };
});

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

const ctx = (over: Partial<RetrieveContext> = {}): RetrieveContext => ({
  userId: 'user-1',
  consentLevel: 'basic',
  logger: silentLogger,
  ...over,
});

const trial = (over: Partial<TrialRecord> = {}): TrialRecord => ({
  source: 'ctgov',
  sourceId: 'NCT04635891',
  title: 'Validation of Motor Outcome Assessments in FSHD',
  statusRaw: 'RECRUITING',
  statusZh: '招募中',
  phase: 'N/A',
  sponsor: 'University of Kansas Medical Center',
  countries: ['United States'],
  url: 'https://clinicaltrials.gov/study/NCT04635891',
  sourceUpdatedAt: '2025-06-01',
  fetchedAt: '2026-08-13T04:00:07Z',
  ...over,
});

const snapshot = (trials: TrialRecord[]): TrialSnapshot => ({
  trials,
  sources: [
    {
      source: 'ctgov',
      recordCount: trials.filter((t) => t.source === 'ctgov').length,
      fetchedAt: '2026-08-13T04:00:07Z',
      lastRun: { startedAt: '2026-08-13T04:00:00Z', finishedAt: '2026-08-13T04:00:09Z', ok: true },
      lastSuccessAt: '2026-08-13T04:00:09Z',
    },
    {
      source: 'chinadrugtrials',
      recordCount: 0,
      fetchedAt: null,
      lastRun: null,
      lastSuccessAt: null,
    },
  ],
});

const pool = {} as Pool;
const run = async (input: Parameters<ClinicalTrialsRetriever['search']>[0], over = {}) =>
  new ClinicalTrialsRetriever(pool).search(input, ctx(over));

const metaOf = (result: { metadata: Record<string, unknown> }) =>
  result.metadata as unknown as TrialsRetrievalMetadata;

describe('TRIAL_STATUS_FILTERS', () => {
  it('is exactly the set the refresh knows how to translate', () => {
    // Two lists of the same six words, in two files, because the tool
    // schema that spells them out needs a literal tuple and
    // `CTGOV_STATUS_ZH.keys()` is `string[]`. These are the TRANSLATED
    // words, not the filterable ones — the filter takes any registry
    // word. A seventh word added to the map without being added here
    // would be translated on the page and still described to the model
    // as one we have no Chinese for.
    expect([...TRIAL_STATUS_FILTERS].sort()).toEqual([...CTGOV_STATUS_ZH.keys()].sort());
  });
});

describe('normalizeStatus', () => {
  it('folds the v1 and v2 spellings of the same status together', () => {
    expect(normalizeStatus('Active, not recruiting')).toBe('ACTIVE_NOT_RECRUITING');
    expect(normalizeStatus('ACTIVE_NOT_RECRUITING')).toBe('ACTIVE_NOT_RECRUITING');
    expect(normalizeStatus(' recruiting ')).toBe('RECRUITING');
  });
});

describe('ClinicalTrialsRetriever', () => {
  it('puts the fetch date on every rendered record', async () => {
    snapshotMock.mockResolvedValue(snapshot([trial()]));
    const result = await run({ question: '' });

    // A cached trial with no date on it is a claim about the present
    // made from an unknown past. This is the line that stops that, and
    // it is on every record rather than once at the top because the
    // list is a union of two sources refreshed on their own schedules.
    expect(result.chunks[0].content).toContain('本平台读取时间：2026-08-13T04:00:07Z');
    expect(result.chunks[0].content).toContain('登记号：NCT04635891');
    expect(result.chunks[0].content).toContain(
      '链接：https://clinicaltrials.gov/study/NCT04635891',
    );
    expect(result.chunks[0].content).toContain('状态（登记库原词）：RECRUITING');
    // The registry's own last edit is labelled apart from our read.
    expect(result.chunks[0].content).toContain('登记库最后更新：2025-06-01');
  });

  it('carries the id, status and date into the citation snippet too', async () => {
    snapshotMock.mockResolvedValue(snapshot([trial()]));
    const result = await run({ question: '' });
    expect(result.citations[0].snippet).toContain('NCT04635891');
    expect(result.citations[0].snippet).toContain('招募中');
    expect(result.citations[0].snippet).toContain('2026-08-13T04:00:07Z');
    expect(result.citations[0].sourceFile).toBe('ClinicalTrials.gov');
  });

  it('shows the registry word when we have no approved translation', async () => {
    snapshotMock.mockResolvedValue(
      snapshot([trial({ statusRaw: 'Enrolling by invitation', statusZh: null })]),
    );
    const result = await run({ question: '' });
    expect(result.chunks[0].content).toContain('状态（登记库原词）：Enrolling by invitation');
    // 「状态未知」 would be a false statement about a row whose status is
    // on the line above.
    expect(result.chunks[0].content).not.toContain('状态未知');
    expect(result.chunks[0].content).not.toContain('本平台译法');
  });

  it('filters on the normalised status and counts what it filtered', async () => {
    snapshotMock.mockResolvedValue(
      snapshot([
        trial({ sourceId: 'NCT-A', statusRaw: 'RECRUITING' }),
        trial({ sourceId: 'NCT-B', statusRaw: 'Active, not recruiting', statusZh: null }),
        trial({ sourceId: 'NCT-C', statusRaw: 'COMPLETED', statusZh: '已完成' }),
      ]),
    );
    const result = await run({ question: '', filter: { status: 'RECRUITING' } });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].content).toContain('NCT-A');
    const meta = metaOf(result);
    expect(meta.matched).toBe(1);
    expect(meta.cachedTotal).toBe(3);
    expect(meta.statusFilter).toBe('RECRUITING');
  });

  it('counts every status word in the cache and marks the untranslated ones', async () => {
    snapshotMock.mockResolvedValue(
      snapshot([
        trial({ sourceId: 'NCT-A', statusRaw: 'RECRUITING' }),
        trial({ sourceId: 'NCT-B', statusRaw: 'Enrolling by invitation', statusZh: null }),
        trial({ sourceId: 'NCT-C', statusRaw: 'Enrolling by invitation', statusZh: null }),
      ]),
    );
    const result = await run({ question: '', filter: { status: 'RECRUITING' } });

    // The census is what lets the tool wrapper name the rows §A4 gives
    // us no Chinese for — and name them with the spelling that fetches
    // them, so they are askable rather than merely mentioned.
    expect(metaOf(result).statusCounts).toEqual([
      { status: 'Enrolling by invitation', count: 2, translated: false },
      { status: 'RECRUITING', count: 1, translated: true },
    ]);
  });

  it('filters on a registry word §A4 has no translation for', async () => {
    // ENROLLING_BY_INVITATION is 3 of the 92 rows cached on 2026-08-14
    // and those studies are still taking participants. A filter that
    // only accepted the six translated words would leave the model
    // unable to answer about them at all — while the same tool result
    // told it they exist.
    snapshotMock.mockResolvedValue(
      snapshot([
        trial({ sourceId: 'NCT-OPEN', statusRaw: 'RECRUITING' }),
        trial({ sourceId: 'NCT-INV', statusRaw: 'ENROLLING_BY_INVITATION', statusZh: null }),
      ]),
    );
    const result = await run({
      question: '',
      filter: { status: 'ENROLLING_BY_INVITATION' },
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].content).toContain('NCT-INV');
    expect(metaOf(result).matched).toBe(1);
  });

  it('answers a status word no row carries with a plain zero', async () => {
    snapshotMock.mockResolvedValue(snapshot([trial()]));
    const result = await run({ question: '', filter: { status: 'ONGOING' } });

    // Not a throw and not a silent widening to every trial: both would
    // reach the patient as a sentence about something that did not
    // happen.
    expect(result.chunks).toHaveLength(0);
    expect(metaOf(result).matched).toBe(0);
    expect(metaOf(result).cachedTotal).toBe(1);
    expect(metaOf(result).statusFilter).toBe('ONGOING');
  });

  it('reports an unreadable cache as a reason, not as a throw', async () => {
    // A throw here reaches the orchestrator as a bare tool error, and
    // context-builder turns that into 「资料库检索没有跑成功」 — a
    // sentence about the medical knowledge base, which did not fail.
    snapshotMock.mockReset();
    snapshotMock.mockRejectedValue(new Error('connection terminated unexpectedly'));
    const result = await run({ question: '' });

    expect(result.chunks).toHaveLength(0);
    expect(result.metadata.reason).toBe('cache_unreadable');
  });

  it('orders the joinable trials first and reports what the limit cut', async () => {
    snapshotMock.mockResolvedValue(
      snapshot([
        trial({ sourceId: 'NCT-DONE', statusRaw: 'COMPLETED', sourceUpdatedAt: '2026-01-01' }),
        trial({ sourceId: 'NCT-OPEN', statusRaw: 'RECRUITING', sourceUpdatedAt: '2024-01-01' }),
      ]),
    );
    const result = await run({ question: '', limit: 1 });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].content).toContain('NCT-OPEN');
    const meta = metaOf(result);
    expect(meta.matched).toBe(2);
    expect(meta.returned).toBe(1);
  });

  it('passes the source freshness through untouched', async () => {
    snapshotMock.mockResolvedValue(snapshot([trial()]));
    const meta = metaOf(await run({ question: '' }));
    expect(meta.sources.map((s) => [s.source, trialFetchState(s)])).toEqual([
      ['ctgov', 'ok'],
      ['chinadrugtrials', 'never_ran'],
    ]);
  });

  it('does not take a connection for a caller that has hung up', async () => {
    snapshotMock.mockReset();
    const aborted = new AbortController();
    aborted.abort();
    const result = await run({ question: '' }, { signal: aborted.signal });
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(result.chunks).toHaveLength(0);
    expect(result.metadata.reason).toBe('aborted');
  });
});

/* ------------------------------------------------------------------ */
/* Both registries, from the captures the fetchers' own tests run on   */
/* ------------------------------------------------------------------ */

/**
 * A fetcher's row as `readTrialSnapshot` hands it back: `raw` is never
 * selected, `countries` has already become an array, and every row
 * carries its run's instant.
 */
const asCachedRecord = (input: TrialRecordInput): TrialRecord => ({
  source: input.source,
  sourceId: input.sourceId,
  title: input.title,
  statusRaw: input.statusRaw,
  statusZh: input.statusZh,
  phase: input.phase,
  sponsor: input.sponsor,
  countries: input.countries ?? [],
  url: input.url,
  sourceUpdatedAt: input.sourceUpdatedAt,
  fetchedAt: '2026-08-13T04:00:07Z',
});

/** Page 1 of the ClinicalTrials.gov capture, through the same
 *  `_toTrialRecord` the refresh writes the cache with. */
const ctgovRecords = (): TrialRecord[] =>
  (JSON.parse(ctgovPage1()) as { studies: unknown[] }).studies.map((study) =>
    asCachedRecord(_toTrialRecord(study)),
  );

/**
 * The mainland registry's own rows, through the same `_parseSearchList`
 * the scraper runs. 「进行中 招募中」 and 已完成 below are that
 * registry's words in the spelling its results table writes them, read
 * off the captured page rather than typed here.
 *
 * The two nulls are not stand-ins either: chinadrugtrials.fetcher.ts
 * writes NULL into both columns for every row it produces, because the
 * platform publishes no last-changed date and its status word is
 * already Chinese. They are the reason a mainland row cannot win a
 * comparison written for the other registry.
 */
const chinaRecords = (): TrialRecord[] =>
  _parseSearchList(cdtRowsPage(), 'search page 1').rows.map((row) =>
    asCachedRecord({
      source: 'chinadrugtrials',
      sourceId: row.ctr,
      title: row.plainTitle,
      statusRaw: row.statusRaw,
      statusZh: null,
      phase: null,
      sponsor: null,
      countries: null,
      url: `${CDT_DETAIL_URL}?id=${row.detailId}`,
      sourceUpdatedAt: null,
      raw: null,
    }),
  );

const mixedSnapshot = (): TrialSnapshot => ({
  trials: [...ctgovRecords(), ...chinaRecords()],
  sources: [
    {
      source: 'ctgov',
      recordCount: ctgovRecords().length,
      fetchedAt: '2026-08-13T04:00:07Z',
      lastRun: { startedAt: '2026-08-13T04:00:00Z', finishedAt: '2026-08-13T04:00:09Z', ok: true },
      lastSuccessAt: '2026-08-13T04:00:09Z',
    },
    {
      source: 'chinadrugtrials',
      recordCount: chinaRecords().length,
      fetchedAt: '2026-08-13T04:10:02Z',
      lastRun: { startedAt: '2026-08-13T04:09:00Z', finishedAt: '2026-08-13T04:10:04Z', ok: true },
      lastSuccessAt: '2026-08-13T04:10:04Z',
    },
  ],
});

const sourcesOf = (result: { chunks: Array<{ metadata: Record<string, unknown> }> }) =>
  result.chunks.map((chunk) => chunk.metadata.source);

const statusesOf = (result: { chunks: Array<{ metadata: Record<string, unknown> }> }) =>
  result.chunks.map((chunk) => chunk.metadata.statusRaw);

describe('ClinicalTrialsRetriever over both registries', () => {
  it('reads two vocabularies out of the one status column', () => {
    // The premise of every assertion below, taken off the captures
    // rather than asserted about them: one registry writes an English
    // enum token, the other writes Chinese, and the mainland rows carry
    // no last-changed date at all.
    expect(new Set(ctgovRecords().map((t) => t.statusRaw))).toContain('RECRUITING');
    expect(new Set(chinaRecords().map((t) => t.statusRaw))).toContain('进行中 招募中');
    expect(chinaRecords().every((t) => t.sourceUpdatedAt === null)).toBe(true);
  });

  it('renders a mainland record under the default limit', async () => {
    // The capture has 13 RECRUITING studies on its first page alone,
    // which is more than the default limit — so a mainland row that
    // sorts behind them is a row that can never reach the prompt, and
    // the tool then tells the patient no mainland record came back.
    snapshotMock.mockResolvedValue(mixedSnapshot());
    const result = await run({ question: '' });

    expect(sourcesOf(result)).toContain('chinadrugtrials');
    expect(sourcesOf(result)).toContain('ctgov');
  });

  it('ranks the mainland words beside the words that mean the same thing', async () => {
    snapshotMock.mockResolvedValue(mixedSnapshot());
    const result = await run({ question: '', limit: 40 });

    const chinaStatuses = result.chunks
      .filter((chunk) => chunk.metadata.source === 'chinadrugtrials')
      .map((chunk) => chunk.metadata.statusRaw);
    // 进行中 招募中 before 进行中 尚未招募 before 已完成 — the tiers the
    // English words are in, in the registry's own spelling. Unplaced,
    // all nine ranked behind WITHDRAWN and came back in id order with
    // 已完成 first. The two 主动终止 rows are in the tier after these
    // and the cap stops inside 已完成, which is the same cut that would
    // fall on a ClinicalTrials.gov row of that tier.
    expect(chinaStatuses).toEqual([
      '进行中 招募中',
      '进行中 尚未招募',
      '进行中 尚未招募',
      '已完成',
      '已完成',
      '已完成',
      '已完成',
    ]);
  });

  it('does not let either registry spend the whole limit on one tier', async () => {
    snapshotMock.mockResolvedValue(mixedSnapshot());
    const result = await run({ question: '', limit: 2 });

    expect(sourcesOf(result).sort()).toEqual(['chinadrugtrials', 'ctgov']);
    // Both of them are the tier a patient can still join: neither
    // registry's turn costs the reader a recruiting study.
    expect(statusesOf(result).sort()).toEqual(['RECRUITING', '进行中 招募中']);
  });

  it('filters on the mainland registry own status word', async () => {
    snapshotMock.mockResolvedValue(mixedSnapshot());
    const result = await run({ question: '', filter: { status: '进行中 招募中' } });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].content).toContain('状态（登记库原词）：进行中 招募中');
    expect(metaOf(result).matched).toBe(1);
  });

  it('counts the mainland words in the census the tool reads back to the model', async () => {
    snapshotMock.mockResolvedValue(mixedSnapshot());
    const counts = metaOf(await run({ question: '' })).statusCounts;

    const chinaCounts = counts.filter((entry) => /[一-鿿]/.test(entry.status));
    expect(chinaCounts).toEqual([
      { status: '已完成', count: 4, translated: false },
      { status: '主动终止', count: 2, translated: false },
      { status: '进行中 尚未招募', count: 2, translated: false },
      { status: '进行中 招募中', count: 1, translated: false },
    ]);
  });
});
