import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RetrieveContext } from './base.js';
import { MedicalKbRetriever } from './medical-kb.js';

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
});
