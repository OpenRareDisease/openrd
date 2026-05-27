import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from './base.js';
import { ToolValidationError } from './base.js';
import { SearchMedicalKbTool } from './search-medical-kb.js';
import type { RetrieveContext, RetrieveResult } from '../retrievers/base.js';
import type { MedicalKbRetriever } from '../retrievers/medical-kb.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

const ctx: ToolContext = {
  userId: 'user-1',
  consentLevel: 'basic',
  requestId: 'req-1',
  logger: silentLogger as unknown as ToolContext['logger'],
};

const stubResult = (count: number): RetrieveResult => ({
  retrieverId: 'medical_kb',
  chunks: Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    source: 'medical_kb',
    content: 'x',
    metadata: {},
    distance: 0,
  })),
  citations: [],
  metadata: {},
});

describe('SearchMedicalKbTool.parseArgs', () => {
  const tool = new SearchMedicalKbTool({
    search: vi.fn(),
  } as unknown as MedicalKbRetriever);

  it('rejects non-object payloads', () => {
    expect(() => tool.parseArgs('"hi"')).toThrow(ToolValidationError);
    expect(() => tool.parseArgs('[]')).toThrow(ToolValidationError);
  });

  it('rejects missing or empty query', () => {
    expect(() => tool.parseArgs('{}')).toThrow(/query/);
    expect(() => tool.parseArgs('{"query": "   "}')).toThrow(/query/);
  });

  it('parses query + queries + limit and trims junk entries', () => {
    const parsed = tool.parseArgs(
      JSON.stringify({
        query: '  D4Z4 是什么  ',
        queries: ['D4Z4 含义', '', '  ', 'D4Z4 repeat'],
        limit: 5,
      }),
    );
    expect(parsed).toEqual({
      query: 'D4Z4 是什么',
      queries: ['D4Z4 含义', 'D4Z4 repeat'],
      limit: 5,
    });
  });

  it('clamps limit and rejects non-finite numbers', () => {
    expect(tool.parseArgs('{"query":"q","limit":999}')).toEqual({
      query: 'q',
      queries: undefined,
      limit: 20,
    });
    expect(() => tool.parseArgs('{"query":"q","limit":"a"}')).toThrow(/limit/);
  });

  it('rejects invalid JSON', () => {
    expect(() => tool.parseArgs('{')).toThrow(ToolValidationError);
  });
});

describe('SearchMedicalKbTool.execute', () => {
  it('forwards parsed args to the underlying retriever', async () => {
    const search = vi.fn().mockResolvedValue(stubResult(3));
    const tool = new SearchMedicalKbTool({
      search,
    } as unknown as MedicalKbRetriever);

    const args = tool.parseArgs(
      JSON.stringify({ query: 'FSHD onset', queries: ['FSHD age of onset'], limit: 4 }),
    );
    const result = await tool.execute(args, ctx);

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(
      { question: 'FSHD onset', queries: ['FSHD age of onset'], limit: 4 },
      expect.objectContaining({
        userId: 'user-1',
        consentLevel: 'basic',
        requestId: 'req-1',
      }),
    );
    expect(result.retrieval.chunks).toHaveLength(3);
    expect(result.display).toBe('medical_kb: 3 chunks');
  });
});
