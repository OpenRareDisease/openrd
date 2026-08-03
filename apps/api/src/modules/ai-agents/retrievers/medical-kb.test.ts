import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RetrieveContext } from './base.js';
import { MedicalKbRetriever, apparatusScore, isDamagedExtraction } from './medical-kb.js';

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
