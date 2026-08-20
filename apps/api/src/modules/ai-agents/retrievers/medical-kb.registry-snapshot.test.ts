import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RetrieveContext } from './base.js';
import { MedicalKbRetriever, isRegistrySnapshotChunk, registrySnapshotDate } from './medical-kb.js';

/**
 * §A6 — the 2025-03-31 ClinicalTrials.gov snapshot in the corpus.
 *
 * The fixtures below are the real thing, not a paraphrase. Taken from
 * `kb_chunks` on 2026-08-13:
 *
 *   SELECT chunk_index, left(replace(content, E'\n', ' '), 200)
 *     FROM kb_chunks
 *    WHERE source_file ILIKE '%全球范围内FSHD药物研究进展%'
 *    ORDER BY chunk_index;
 *
 * 40 chunks. 0–36 are ClinicalTrials.gov's glossary; 37–39 are the
 * result table, Google-translated. 39 of the 40 survive `isJunk`
 * (replayed the exported predicates over the stored contents — only
 * chunk 0 is dropped, on the scrape banner in its body), so the ones
 * carrying NCT numbers are retrievable today and carry no date.
 */

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
};

const ctx: RetrieveContext = {
  userId: null,
  consentLevel: 'basic',
  requestId: 'req-test',
  logger: silentLogger as unknown as RetrieveContext['logger'],
};

/** kb_chunks chunk_index 38, verbatim apart from the truncation, with
 *  the ingest label the pipeline prepends to every chunk. */
const SNAPSHOT_CHUNK =
  '[Search for: FSHD, Recruiting studies | List Results | ClinicalTrials.gov]\n' +
  'NCT05902884 招聘 面肩关节疾病 设备 : MSOT 敏锐回声 IRCCS 警察大学阿戈斯蒂诺·杰梅利基金会 介入 ' +
  '4 先进的 面肩关节疾病 -COM：评估非行走能力的新型临床结果测量方法 面肩关节疾病 患者，一项试点研究 ' +
  'NCT05453461 招聘 面肩肱型肌营养不良症 诊断测试 : 针对无法行走的 FSHD 患者的新 COM 验证 尼斯大学中心医院 介入';

const SNAPSHOT_METADATA = {
  source_file: 'A.全球范围内FSHD药物研究进展汇总.htm',
  folder_path: '05.相关研究/第一批：2025年3月31日',
  html_title: 'Search for: FSHD, Recruiting studies | List Results | ClinicalTrials.gov',
  category: '05.相关研究',
};

/** An ordinary corpus chunk, for the negative cases. */
const PROSE = 'FSHD 的肩胛带无力通常最先被注意到，抬臂困难是最常见的首发主诉之一。';

const mockFetchOk = (body: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb.test' });

describe('registrySnapshotDate', () => {
  it('reads the date out of the batch folder name', () => {
    expect(registrySnapshotDate(SNAPSHOT_METADATA)).toBe('2025-03-31');
    expect(registrySnapshotDate({ folder_path: '05.相关研究/2025-03-31' })).toBe('2025-03-31');
  });

  it('returns null rather than guessing when no date is on the path', () => {
    expect(registrySnapshotDate({ folder_path: '05.相关研究' })).toBeNull();
    expect(registrySnapshotDate({})).toBeNull();
  });
});

describe('isRegistrySnapshotChunk', () => {
  it('recognises a mid-document chunk by its ingest label', () => {
    // Chunk 38's own text says nothing about where it came from; the
    // saved page's title only reaches it through the label.
    expect(isRegistrySnapshotChunk(SNAPSHOT_CHUNK, {})).toBe(true);
  });

  it('recognises it by html_title when the label is absent', () => {
    expect(isRegistrySnapshotChunk('NCT05902884 招聘', SNAPSHOT_METADATA)).toBe(true);
  });

  it('leaves ordinary corpus chunks alone', () => {
    expect(
      isRegistrySnapshotChunk(PROSE, { source_file: '01.疾病定义和科普/A.什么是FSHD.docx' }),
    ).toBe(false);
  });
});

describe('MedicalKbRetriever — registry snapshot stamping', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('stamps the scrape date onto the prompt text', async () => {
    globalThis.fetch = mockFetchOk({
      chunks: [{ content: SNAPSHOT_CHUNK, metadata: SNAPSHOT_METADATA, distance: 0.2 }],
    }) as unknown as typeof globalThis.fetch;

    const result = await retriever.search({ question: '哪些试验在招募' }, ctx);

    // Not dropped: the page is a real record of what was registered in
    // March 2025. Dated: it is not a statement about today.
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].content).toContain('2025-03-31');
    expect(result.chunks[0].content).toContain('这不是当前状态');
    expect(result.chunks[0].content).toContain('list_clinical_trials');
    // The corpus text itself is still there, unedited.
    expect(result.chunks[0].content).toContain('NCT05902884');
  });

  it('marks the citation card the patient can open', async () => {
    globalThis.fetch = mockFetchOk({
      chunks: [{ content: SNAPSHOT_CHUNK, metadata: SNAPSHOT_METADATA, distance: 0.2 }],
    }) as unknown as typeof globalThis.fetch;

    const result = await retriever.search({ question: '哪些试验在招募' }, ctx);
    expect(result.citations[0].snippet).toContain('（2025-03-31的网页快照）');
    // The snippet is capped at 180 chars; the marker must leave room for
    // the preview it prefixes.
    expect(result.citations[0].snippet.length).toBeLessThanOrEqual(180);
    expect(result.citations[0].snippet).toContain('NCT05902884');
  });

  it('says so out loud when the path carries no date', async () => {
    globalThis.fetch = mockFetchOk({
      chunks: [{ content: SNAPSHOT_CHUNK, metadata: { source_file: 'trials.htm' }, distance: 0.2 }],
    }) as unknown as typeof globalThis.fetch;

    const result = await retriever.search({ question: '哪些试验在招募' }, ctx);
    expect(result.chunks[0].content).toContain('保存日期没有记录下来');
    expect(result.metadata.registrySnapshotChunks).toBe(1);
    expect(result.metadata.registrySnapshotDates).toEqual([]);
  });

  it('reports the count over the chunks that survived the trim', async () => {
    const snapshotChunk = (n: number) => ({
      content: `${SNAPSHOT_CHUNK} 变体${n}`,
      metadata: SNAPSHOT_METADATA,
      distance: 0.1 + n / 100,
    });
    globalThis.fetch = mockFetchOk({
      chunks: [snapshotChunk(1), snapshotChunk(2), snapshotChunk(3)],
    }) as unknown as typeof globalThis.fetch;

    const result = await retriever.search({ question: '哪些试验在招募', limit: 2 }, ctx);
    // Telling the model about a stamped chunk it cannot see would send
    // it looking for a caveat with nothing to attach to.
    expect(result.chunks).toHaveLength(2);
    expect(result.metadata.registrySnapshotChunks).toBe(2);
    expect(result.metadata.registrySnapshotDates).toEqual(['2025-03-31']);
  });

  it('does not touch ordinary corpus chunks', async () => {
    globalThis.fetch = mockFetchOk({
      chunks: [
        {
          content: PROSE,
          metadata: { source_file: '01.疾病定义和科普/A.什么是FSHD.docx' },
          distance: 0.2,
        },
      ],
    }) as unknown as typeof globalThis.fetch;

    const result = await retriever.search({ question: 'FSHD 是什么' }, ctx);
    expect(result.chunks[0].content).toBe(PROSE);
    expect(result.metadata.registrySnapshotChunks).toBe(0);
  });
});
