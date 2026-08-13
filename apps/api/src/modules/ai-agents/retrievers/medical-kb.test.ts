import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RetrieveContext } from './base.js';
import { RETRIEVAL_FAILURE_REASONS, retrievalFailureReason } from './base.js';
import {
  MedicalKbRetriever,
  NO_RELEVANT_RESULTS,
  apparatusScore,
  isDamagedExtraction,
  stripIngestLabel,
  isNavigationBoilerplate,
} from './medical-kb.js';

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
  // The real logger is pino-based; for the tests we just need the
  // methods the retriever invokes. Cast away the strict type.
  logger: silentLogger as unknown as RetrieveContext['logger'],
};

const mockFetchOk = (body: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

/** One canned 200 per call, in order. Needed by every category-filter
 *  test: the retriever may issue a second, unfiltered request and the
 *  point of the test is usually that the two answers differ. */
const mockFetchSequence = (bodies: unknown[]) => {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call += 1;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
};

/** The `/multi` payload of the nth fetch (0-indexed). */
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, index: number) =>
  JSON.parse((fetchMock.mock.calls[index][1] as RequestInit).body as string);

/** Long enough and punctuated enough to survive every junk filter. */
const PROSE = 'FSHD 的肩胛带无力通常最先被注意到，抬臂困难是最常见的首发主诉之一。';

describe('MedicalKbRetriever', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns empty when both question and queries are blank', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });
    const result = await retriever.search({ question: '   ', queries: [] }, ctx);
    expect(result.chunks).toHaveLength(0);
    expect(result.metadata.reason).toBe('empty_question');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('maps KB service chunks into the unified shape and produces citations', async () => {
    const body = {
      answer: 'preview',
      chunks: [
        {
          content: 'FSHD1 由 4 号染色体 D4Z4 重复减少导致 DUX4 表达失调，下面解释机制。',
          metadata: { source_file: 'fshd/02-genetics-d4z4.md', authority: 'high' },
          distance: 0.12,
        },
        { content: 'short', metadata: {}, distance: 0.5 }, // junk by length filter
      ],
      metadata: { total_results: 1 },
    };
    globalThis.fetch = mockFetchOk(body) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search(
      { question: 'D4Z4 是什么', queries: ['D4Z4 是什么', 'D4Z4 含义'] },
      ctx,
    );

    expect(result.retrieverId).toBe('medical_kb');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].source).toBe('medical_kb');
    expect(result.chunks[0].distance).toBe(0.12);
    expect(result.chunks[0].sourceFile).toBe('fshd/02-genetics-d4z4.md');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].chunkId).toBe(result.chunks[0].id);
    expect(result.metadata.droppedJunk).toBe(1);
    expect(result.metadata.queriesUsed).toEqual(['D4Z4 是什么', 'D4Z4 含义']);
  });

  it('returns empty when KB service is unreachable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED')) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: 'test' }, ctx);
    expect(result.chunks).toHaveLength(0);
    expect(result.metadata.reason).toBe('kb_service_unreachable');
  });

  it('returns empty on non-2xx response from KB service', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('Internal error', { status: 500 }),
      ) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: 'test' }, ctx);
    expect(result.chunks).toHaveLength(0);
    expect(result.metadata.reason).toBe('kb_service_error');
  });

  it('falls back to question when no queries provided', async () => {
    const fetchMock = mockFetchOk({ chunks: [] });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    await retriever.search({ question: 'fallback question' }, ctx);
    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.queries).toEqual(['fallback question']);
  });

  it('forwards Authorization: Bearer when serviceToken is set (PR-Sec-5 #3)', async () => {
    const fetchMock = mockFetchOk({ chunks: [] });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({
      kbServiceUrl: 'http://kb',
      serviceToken: 'super-secret-token',
    });

    await retriever.search({ question: 'with auth' }, ctx);
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer super-secret-token');
  });

  it('omits Authorization header when no serviceToken is configured', async () => {
    const fetchMock = mockFetchOk({ chunks: [] });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    await retriever.search({ question: 'no auth' }, ctx);
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('relevance floor — 「知识库里没找到」 vs 「检索失败」', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('relays the service verdict when every candidate was below the floor', async () => {
    // The service floored all of them, so `chunks` is already empty —
    // what matters is that the retriever names WHY, instead of handing
    // the answer layer a bare empty result it renders as 「（无内容）」.
    globalThis.fetch = mockFetchOk({
      chunks: [],
      metadata: {
        below_relevance_floor: true,
        relevance_floor: 0.4,
        best_distance: 0.4831,
        candidates_considered: 40,
      },
    }) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: '明天北京天气怎么样？' }, ctx);

    expect(result.chunks).toHaveLength(0);
    expect(result.metadata.reason).toBe(NO_RELEVANT_RESULTS);
    expect(result.metadata.relevanceFloor).toBe(0.4);
    expect(result.metadata.bestDistance).toBe(0.4831);
  });

  it('does not report a below-floor result as a retrieval FAILURE', () => {
    // 「我们查了知识库，里面没有」 and 「我们没能查成知识库」 are
    // different facts and the answer layer says different things for
    // them. Putting this reason in the failure set would make the model
    // announce an outage every time a patient asked something the
    // corpus simply does not cover.
    expect(RETRIEVAL_FAILURE_REASONS.has(NO_RELEVANT_RESULTS)).toBe(false);
    expect(
      retrievalFailureReason({
        retrieverId: 'medical_kb',
        chunks: [],
        citations: [],
        metadata: { reason: NO_RELEVANT_RESULTS },
      }),
    ).toBeNull();
  });

  it('leaves a normal result alone when the service did not flag the floor', async () => {
    globalThis.fetch = mockFetchOk({
      chunks: [
        {
          content: 'FSHD 是一种以面部、肩胛带和上臂无力为首发表现的遗传性肌肉疾病。',
          metadata: { source_file: '指南共识/Dutch-FSHD-Guideline.pdf' },
          distance: 0.24,
        },
      ],
      metadata: { below_relevance_floor: false, relevance_floor: 0.4 },
    }) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: 'FSHD 是什么病' }, ctx);

    expect(result.chunks).toHaveLength(1);
    expect(result.metadata.reason).toBeUndefined();
  });

  it('stays quiet when talking to a KB service that has no floor yet', async () => {
    // A service predating the floor sends no such key. Treating a
    // missing flag as「below floor」would blank every answer during a
    // rolling deploy.
    globalThis.fetch = mockFetchOk({
      chunks: [
        {
          content: 'FSHD 患者在全身麻醉前应告知麻醉医师既往的呼吸功能与心脏评估结果。',
          metadata: { source_file: '指南共识/Dutch-FSHD-Guideline.pdf' },
          distance: 0.29,
        },
      ],
      metadata: { total_results: 1 },
    }) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: 'FSHD 麻醉' }, ctx);
    expect(result.chunks).toHaveLength(1);
    expect(result.metadata.reason).toBeUndefined();
  });
});

describe('empty corpus must be loud, not 「（无内容）」', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports kb_empty_corpus when the store returned zero candidates', async () => {
    globalThis.fetch = mockFetchOk({
      chunks: [],
      metadata: { backend_hits: 0, candidates_considered: 0, below_relevance_floor: false },
    }) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: 'FSHD 是什么病' }, ctx);

    expect(result.metadata.reason).toBe('kb_empty_corpus');
    // Must reach the answer layer as a FAILURE — an empty corpus is an
    // outage, not a fact about FSHD.
    expect(retrievalFailureReason(result)).toBe('kb_empty_corpus');
  });

  it('does not blame the corpus when a metadata filter was applied', async () => {
    // Zero hits inside 指南共识 (51 chunks) says nothing about the other
    // 9,543. Claiming kb_empty_corpus here would route the patient to
    //「平台的资料库现在不可用」over a category that simply had no match.
    const fetchMock = mockFetchSequence([
      { chunks: [], metadata: { backend_hits: 0, below_relevance_floor: false } },
      {
        chunks: [{ content: PROSE, metadata: { source_file: 'a.pdf' }, distance: 0.3 }],
        metadata: { backend_hits: 12, below_relevance_floor: false },
      },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search(
      { question: 'FSHD 是什么病', filter: { category: '指南共识' } },
      ctx,
    );

    expect(result.metadata.reason).not.toBe('kb_empty_corpus');
    expect(result.chunks).toHaveLength(1);
  });

  it('may still report an empty corpus, but only off the unfiltered attempt', async () => {
    // Both attempts come back with zero candidates. The second one sent
    // no `where`, so this really is an empty store and the operator
    // needs to hear about it.
    const fetchMock = mockFetchSequence([
      { chunks: [], metadata: { backend_hits: 0, below_relevance_floor: false } },
      { chunks: [], metadata: { backend_hits: 0, below_relevance_floor: false } },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search(
      { question: 'FSHD 是什么病', filter: { category: '指南共识' } },
      ctx,
    );

    expect(result.metadata.reason).toBe('kb_empty_corpus');
    expect(retrievalFailureReason(result)).toBe('kb_empty_corpus');
    expect(bodyOf(fetchMock, 1).where).toBeNull();
  });

  it('an empty-valued filter object must not silence the empty-corpus alarm', async () => {
    // `{ category: undefined }` is what a caller building a filter from
    // an absent argument produces. `{}` is truthy, so before
    // normalisation this suppressed the outage report on every request.
    const fetchMock = mockFetchOk({
      chunks: [],
      metadata: { backend_hits: 0, below_relevance_floor: false },
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search(
      { question: 'FSHD 是什么病', filter: { category: undefined } },
      ctx,
    );

    expect(result.metadata.reason).toBe('kb_empty_corpus');
    // And it must be reported off the FIRST attempt: nothing was
    // filtered, so there is nothing to widen to.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock, 0).where).toBeNull();
    expect(result.metadata.filterFellBack).toBeUndefined();
  });

  it('stays silent when the service reports hits that were all filtered out', async () => {
    // 40 hits came back and every one was a bibliography page. That is
    // a real (if useless) search result, not an outage.
    globalThis.fetch = mockFetchOk({
      chunks: [],
      metadata: { backend_hits: 40, candidates_considered: 0, below_relevance_floor: false },
    }) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: 'FSHD 是什么病' }, ctx);
    expect(result.metadata.reason).toBeUndefined();
  });

  it('stays silent against a KB service too old to report backend_hits', async () => {
    globalThis.fetch = mockFetchOk({
      chunks: [],
      metadata: { total_results: 0 },
    }) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: 'FSHD 是什么病' }, ctx);
    expect(result.metadata.reason).toBeUndefined();
  });
});

describe('category filter — narrows when it helps, widens rather than lie', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const hit = (content = PROSE, distance = 0.3) => ({
    content,
    metadata: { source_file: 'x.pdf' },
    distance,
  });

  it('sends the filter to the service as `where`', async () => {
    const fetchMock = mockFetchSequence([
      { chunks: [hit()], metadata: { backend_hits: 9, below_relevance_floor: false } },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search(
      { question: '确诊后怎么调整心态', filter: { category: '10.心理支持' } },
      ctx,
    );

    expect(bodyOf(fetchMock, 0).where).toEqual({ category: '10.心理支持' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.metadata.filterApplied).toEqual({ category: '10.心理支持' });
    expect(result.metadata.filterFellBack).toBe(false);
  });

  it('does not touch the relevance floor when it narrows the pool', async () => {
    // The 0.40 floor was measured on the raw distance over this corpus.
    // A smaller candidate pool does not change what「close enough」
    // means, so the retriever must neither send an override nor re-judge
    // the distances the service already accepted.
    const fetchMock = mockFetchSequence([
      {
        chunks: [hit(PROSE, 0.39)],
        metadata: { backend_hits: 9, relevance_floor: 0.4, below_relevance_floor: false },
      },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search(
      { question: '心态', filter: { category: '10.心理支持' } },
      ctx,
    );

    expect(bodyOf(fetchMock, 0)).not.toHaveProperty('relevance_floor');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].distance).toBe(0.39);
  });

  it('widens to the whole corpus when the category had nothing close enough', async () => {
    // 11.病友经验 is 150 of the corpus's 10,241 chunks (2026-08-11). A
    // question it cannot answer is not a question the corpus cannot
    // answer.
    const fetchMock = mockFetchSequence([
      {
        chunks: [],
        metadata: { backend_hits: 6, below_relevance_floor: true, relevance_floor: 0.4 },
      },
      { chunks: [hit()], metadata: { backend_hits: 40, below_relevance_floor: false } },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search(
      { question: 'FSHD 麻醉风险', filter: { category: '11.病友经验' } },
      ctx,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).where).toBeNull();
    expect(result.chunks).toHaveLength(1);
    expect(result.metadata.reason).toBeUndefined();
    expect(result.metadata.filterFellBack).toBe(true);
    expect(result.metadata.filterApplied).toEqual({ category: '11.病友经验' });
    expect((result.metadata.filteredAttempt as { reason: string }).reason).toBe(
      NO_RELEVANT_RESULTS,
    );
  });

  it('reports 「查过了，没有」 only after the whole corpus came up short', async () => {
    const fetchMock = mockFetchSequence([
      { chunks: [], metadata: { backend_hits: 6, below_relevance_floor: true } },
      { chunks: [], metadata: { backend_hits: 80, below_relevance_floor: true } },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search(
      { question: '针灸能治好吗', filter: { category: '10.心理支持' } },
      ctx,
    );

    // The reason the answer layer branches on has to describe the
    // unfiltered search, because that is the one the sentence
    //「本平台资料库里没有相关资料」is about.
    expect(result.metadata.reason).toBe(NO_RELEVANT_RESULTS);
    expect(retrievalFailureReason(result)).toBeNull();
    expect(result.metadata.filterFellBack).toBe(true);
  });

  it('does not retry when the service itself is down', async () => {
    // Widening cannot reach a service that is not answering; a second
    // 30s timeout is 30 more seconds a patient waits to be told so.
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search(
      { question: 'FSHD 是什么病', filter: { category: '文献' } },
      ctx,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.metadata.reason).toBe('kb_service_unreachable');
    expect(retrievalFailureReason(result)).toBe('kb_service_unreachable');
  });

  it('does not retry after the caller hung up', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.resolve(
        new Response(JSON.stringify({ chunks: [], metadata: { backend_hits: 5 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    await retriever.search(
      { question: 'FSHD 是什么病', filter: { category: '文献' } },
      { ...ctx, signal: controller.signal },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the filtered result when the category answered', async () => {
    const fetchMock = mockFetchSequence([
      { chunks: [hit(), hit(`${PROSE}另一段。`)], metadata: { backend_hits: 20 } },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search(
      { question: '轮椅怎么申请', filter: { category: '08.无障碍生活' } },
      ctx,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.chunks).toHaveLength(2);
    expect(result.metadata.filterFellBack).toBe(false);
  });

  it('does not widen a search that was never filtered', async () => {
    const fetchMock = mockFetchSequence([
      { chunks: [], metadata: { backend_hits: 80, below_relevance_floor: true } },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: '针灸能治好吗' }, ctx);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.metadata.filterFellBack).toBeUndefined();
    expect(result.metadata.reason).toBe(NO_RELEVANT_RESULTS);
  });
});

describe('authority labelling on chunks and citations', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const anaesthesiaBody = {
    chunks: [
      {
        content:
          'AANA Journal：合并脊柱侧弯的 FSHD 产妇在椎管内麻醉前应完成呼吸功能评估与气道计划。',
        metadata: {
          source_file: 'Balancing Risks in Obstetrics AANA Journal October 2025.pdf',
        },
        distance: 0.28,
        authority_tier: 'literature',
        authority_label: '文献',
      },
      {
        content:
          '我做手术那次的经历是这样的，麻醉医生问了我很多问题，我把病历都带上了，术后恢复还算顺利。',
        metadata: { source_file: '我们的故事丨我的一次手术.pdf' },
        distance: 0.31,
        authority_tier: 'community',
        authority_label: '病友经验',
      },
    ],
    metadata: { below_relevance_floor: false },
  };

  it('carries the tier and label onto chunks and citations', async () => {
    globalThis.fetch = mockFetchOk(anaesthesiaBody) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: 'FSHD 麻醉要注意什么' }, ctx);

    expect(result.chunks.map((c) => c.authorityTier)).toEqual(['literature', 'community']);
    expect(result.citations.map((c) => c.authorityLabel)).toEqual(['文献', '病友经验']);
  });

  it('falls back to the tier stored in chunk metadata by the backfill', async () => {
    globalThis.fetch = mockFetchOk({
      chunks: [
        {
          content: '荷兰 FSHD 指南建议在确诊后建立基线的肺功能与心脏评估记录，并定期复查。',
          metadata: {
            source_file: 'Dutch-FSHD-Guideline.pdf',
            authority_tier: 'guideline',
            authority_label: '指南/共识',
          },
          distance: 0.22,
        },
      ],
      metadata: {},
    }) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: 'FSHD 指南' }, ctx);
    expect(result.chunks[0].authorityTier).toBe('guideline');
    expect(result.citations[0].authorityLabel).toBe('指南/共识');
  });

  it('leaves the label null rather than guessing when the service sends none', async () => {
    // A citation chip that claims 指南 for something we could not
    // classify is worse than a chip with no claim on it at all.
    globalThis.fetch = mockFetchOk({
      chunks: [
        {
          content: '这一段来自一个没有被分级的来源，正文本身足够长，可以通过所有的垃圾过滤。',
          metadata: { source_file: 'mystery.pdf' },
          distance: 0.3,
        },
      ],
      metadata: {},
    }) as unknown as typeof globalThis.fetch;
    const retriever = new MedicalKbRetriever({ kbServiceUrl: 'http://kb' });

    const result = await retriever.search({ question: '?' }, ctx);
    expect(result.chunks[0].authorityTier).toBeNull();
    expect(result.citations[0].authorityLabel).toBeNull();
  });
});

describe('apparatusScore — citation-machinery filter', () => {
  // Every string below is real text from the live corpus, trimmed.
  it('scores clean prose at 0', () => {
    expect(
      apparatusScore(
        'Patients with FSHD have a reduced gait speed, and foot dorsiflexor paresis is often present. Because of the reduced mobility and balance, patients with FSHD are six times as likely to fall than healthy controls.',
      ),
    ).toBe(0);
  });

  it('keeps prose that cites a single source (score 1, under the limit)', () => {
    // A paragraph mentioning one DOI is still a paragraph.
    expect(
      apparatusScore('低强度有氧运动是安全的，见 Voet 等人的综述。DOI: 10.1002/14651858.CD003907'),
    ).toBeLessThan(2);
  });

  it.each([
    // A numbered reference list.
    [
      '96.  van den Heuvel A, Mahfouz A, Kloet SL, Balog J, van Engelen BGM, Tawil R, et al. Single-cell RNA sequencing. Neuromuscul Disord. 2017；27（12）：1077-1083。',
    ],
    // Author + affiliation block off a title page.
    [
      'Emiliano Giardina 1,2 Gina Ravenscroft 6 | Pilar Camaño 3,4 | Franclo Henning 7 | Sarah Burton-Jones 5 | Frederique Magdinier 8',
    ],
    // Submission dates + DOI header.
    [
      'Received: 7 December 2023  Revised: 26 March 2024  Accepted: 2 April 2024  DOI: 10.1111/cge.14533',
    ],
  ])('flags citation apparatus: %s', (text) => {
    expect(apparatusScore(text)).toBeGreaterThanOrEqual(2);
  });

  // The failure this exists to stop: a patient asked about exercise and
  // 6 of 8 citations were bibliographies, after which the model quoted
  // an author-year it had read off a reference list as if it were
  // evidence.
  it('flags the reference list the model mined for a fake citation', () => {
    expect(
      apparatusScore(
        '11. 12. 13. Voet，N. B.等人（2013年）。"肌肉疾病的力量训练和有氧运动训练。"Cochrane系统评价数据库7：CD 003907。 Voet，N.等人（2014年）。神经病学 2015；85（4）：357-364。',
      ),
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('apparatusScore — translated and transliterated forms', () => {
  it('flags a transliterated author list with affiliation digits', () => {
    // A conference poster's title page, cited as a source on exercise
    // until this pattern landed — the Latin author patterns cannot see
    // Chinese transliterations.
    expect(
      apparatusScore(
        '620P 量化 面肩肱骨肌营养不良患者的运动功能 劳伦斯J.海沃德1，爱德华多·安德拉德1，本·里德特2，杰夫·彭卡2',
      ),
    ).toBeGreaterThanOrEqual(2);
  });

  it.each([
    [
      '英文临床指导',
      'Clinicians might encourage patients with FSHD to engage in low-intensity aerobic exercise. An experienced physical therapist can help.',
    ],
    [
      '中文正文',
      '患有FSHD的患者会出现躯干、骨盆和下肢肌肉力量下降，这导致姿势、平衡和步态受限。低强度有氧运动被证明是安全的。',
    ],
    [
      '摘要',
      '摘要 FSHD 是一种遗传性肌肉疾病，最常见的是面部、肩胛骨和上臂肌肉无力。面部肌肉的无力程度不一，可能表现为无法完全闭合眼睛。',
    ],
  ])('leaves %s alone', (_label, text) => {
    expect(apparatusScore(text)).toBe(0);
  });
});

describe('isDamagedExtraction', () => {
  // Weight, not presence. 164 of the 184 chunks in the corpus that
  // carry `(cid:N)` are under 5% artifact — ordinary paragraphs with a
  // couple of unmapped glyphs. Dropping on presence threw away methods
  // sections worth retrieving.
  it('keeps a paragraph carrying a couple of unmapped glyphs', () => {
    const prose =
      'Human primary muscle cells derived from FSHD patients and healthy donors were kindly provided by the Fields Center for FSHD Research Biobank (cid:0), and cultured in skeletal muscle growth medium supplemented with glutamine and fetal bovine serum until they reached confluence.';
    expect(isDamagedExtraction(prose)).toBe(false);
  });

  it('drops text that is mostly artifact', () => {
    expect(
      isDamagedExtraction('[T4-AN-01 to G.P.] (cid:0)(cid:0)(cid:0)(cid:0)(cid:0)(cid:0)'),
    ).toBe(true);
  });

  it('ignores text with no residue at all', () => {
    expect(isDamagedExtraction('低强度有氧运动对 FSHD 患者是安全的。')).toBe(false);
  });
});

describe('over-fetch, trim and dedup arithmetic', () => {
  const chunk = (content: string) => ({ content, metadata: { source_file: 'a.pdf' } });
  const prose = (n: number) =>
    `低强度有氧运动对 FSHD 患者是安全的，这是第 ${n} 段可检索的正文内容，足够长以通过最小长度检查。`;

  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const retrieverWith = (chunks: unknown[]) => {
    const fetchMock = mockFetchOk({ chunks, metadata: {} });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    return { retriever: new MedicalKbRetriever({ kbServiceUrl: 'http://kb.test' }), fetchMock };
  };

  it('asks the service for more than the caller wanted', async () => {
    const { retriever, fetchMock } = retrieverWith([chunk(prose(1))]);
    await retriever.search({ question: 'q', limit: 8 }, ctx);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // Roughly a fifth of this corpus is dropped after the service has
    // already picked its top_k, so asking for exactly the target left
    // the model with two or three chunks.
    expect(body.top_k).toBeGreaterThan(8);
  });

  it("trims back to the caller's limit, and citations stay in step", async () => {
    const many = Array.from({ length: 20 }, (_, i) => chunk(prose(i)));
    const { retriever } = retrieverWith(many);
    const result = await retriever.search({ question: 'q', limit: 5 }, ctx);
    expect(result.chunks).toHaveLength(5);
    // A citation pointing at a trimmed-away chunk would name a source
    // for text the model never saw.
    expect(result.citations).toHaveLength(5);
    expect(result.citations.map((c) => c.chunkId)).toEqual(result.chunks.map((c) => c.id));
  });

  it('drops duplicate text before trimming, not after', async () => {
    // The corpus holds the same paragraph under several rows; deduping
    // after the trim would spend the budget on repeats.
    const dupes = [
      chunk(prose(1)),
      chunk(prose(1)),
      chunk(prose(1)),
      chunk(prose(2)),
      chunk(prose(3)),
    ];
    const { retriever } = retrieverWith(dupes);
    const result = await retriever.search({ question: 'q', limit: 3 }, ctx);
    const texts = result.chunks.map((c) => c.content);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).toHaveLength(3);
  });
});

describe('过滤器不得凭入库标注删掉文档', () => {
  /**
   * 这一组守的是一整类 bug，不是一个 bug。
   *
   * 入库时每块前面会加 `[section.label]`（kb-ingest.py:328），10241 块
   * 里有 7524 块带着它（2026-08-11 实测）。过滤器原本连这一行一起判，
   * 于是一个不走运的标题就能把整份文档从语料里抹掉——把 master 的老
   * pattern 在现语料上重放，114 块、41 个文件，其中四份被清零：给医生
   * 的转诊名单、社区简介、《中国康复辅助器具目录（2023年版）》修订说明
   *（整份就 2 块），以及《全球范围内FSHD药物研究进展汇总》的全部 40 块
   *（chunk_index 0-39），因为抓取横幅被加在了每一块前面——连同里面真实
   * 的 NCT 编号和招募状态。
   *
   * 被清零的是那份 2 块的修订说明，不是 534 块的目录正本；正本当时不在
   * 索引里，老 pattern 对它 534 块也只命中 2 块。别把两件事混成一条。
   *
   * 剥掉标注之后只剩 1 块被丢：药物汇总的 chunk 0，横幅写在正文里而不是
   * 只写在标注里。
   */
  it('剥掉 [page N] 之后正文照常留下', () => {
    expect(stripIngestLabel('[page 92]\n患者应在确诊后接受基线肺功能评估。')).toBe(
      '患者应在确诊后接受基线肺功能评估。',
    );
  });

  it('标题里带「目录」不该让正文陪葬', () => {
    // 《中国康复辅助器具目录（2023年版）》——文件名里的词，不是版式垃圾
    const chunk =
      '[《中国康复辅助器具目录（2023年版）》修订说明]\n本次修订新增了上肢辅具类目，并调整了申领流程。';
    expect(stripIngestLabel(chunk)).not.toContain('目录（2023');
    expect(isNavigationBoilerplate(stripIngestLabel(chunk))).toBe(false);
  });

  it('抓取横幅被前置时，真实试验数据要留下', () => {
    const chunk =
      '[Search for: FSHD, Recruiting studies | List Results | ClinicalTrials.gov]\n' +
      'NCT05902884 招聘 面肩肱型肌营养不良症 尼斯大学中心医院 介入性研究';
    expect(isNavigationBoilerplate(stripIngestLabel(chunk))).toBe(false);
  });

  it('整段真的是导航块时仍然丢弃', () => {
    expect(isNavigationBoilerplate('上一篇\n下一篇\n责任编辑：某某\n点击阅读')).toBe(true);
  });

  it('一句话里提到一次版式词不算导航块', () => {
    expect(
      isNavigationBoilerplate('我们在这一篇里整理了辅具申领的目录和流程，供病友参考使用。'),
    ).toBe(false);
  });
});
