import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from './base.js';
import { ToolValidationError } from './base.js';
import { KB_CATEGORIES, SearchMedicalKbTool } from './search-medical-kb.js';
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

const stubResult = (count: number, metadata: Record<string, unknown> = {}): RetrieveResult => ({
  retrieverId: 'medical_kb',
  chunks: Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    source: 'medical_kb',
    content: 'x',
    metadata: {},
    distance: 0,
  })),
  citations: [],
  metadata,
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

describe('category — the corpus filter the planner can now reach', () => {
  const tool = new SearchMedicalKbTool({ search: vi.fn() } as unknown as MedicalKbRetriever);

  it('advertises the real corpus categories, not an invented list', () => {
    const schema = tool.parametersSchema as {
      properties: { category: { enum: string[]; description: string } };
    };
    // Sampled from `select metadata->>'category', count(*) from
    // kb_chunks group by 1` on the live corpus. If the ingester ever
    // stops filing by top-level folder these must move together.
    expect(schema.properties.category.enum).toEqual([...KB_CATEGORIES]);
    expect(schema.properties.category.enum).toContain('11.病友经验');
    expect(schema.properties.category.enum).toContain('08.无障碍生活');
    expect(schema.properties.category.enum).toContain('文献');
    // The root-level papers carry `category: ""` and match no value
    // here. The model has to be told, or it will narrow to a category
    // believing it still sees them.
    expect(schema.properties.category.enum).not.toContain('');
    expect(schema.properties.category.description).toContain('根目录');
  });

  it('accepts an exact category and forwards it as a filter', async () => {
    const search = vi.fn().mockResolvedValue(stubResult(2));
    const withSearch = new SearchMedicalKbTool({ search } as unknown as MedicalKbRetriever);
    const args = withSearch.parseArgs(
      JSON.stringify({ query: '确诊后怎么调整心态', category: '10.心理支持' }),
    );
    const result = await withSearch.execute(args, ctx);

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { category: '10.心理支持' } }),
      expect.anything(),
    );
    expect(result.display).toContain('限定类目：10.心理支持');
  });

  it('canonicalises a category written without its filing prefix', () => {
    expect(tool.parseArgs(JSON.stringify({ query: 'q', category: '病友经验' }))).toMatchObject({
      category: '11.病友经验',
    });
    expect(tool.parseArgs(JSON.stringify({ query: 'q', category: 'afo' }))).toMatchObject({
      category: 'AFO',
    });
  });

  it('rejects a category that is not in the corpus, and says which are', () => {
    expect(() => tool.parseArgs(JSON.stringify({ query: 'q', category: '13.食谱' }))).toThrow(
      /Unknown `category`/,
    );
    expect(() => tool.parseArgs(JSON.stringify({ query: 'q', category: '13.食谱' }))).toThrow(
      /11\.病友经验/,
    );
    expect(() => tool.parseArgs(JSON.stringify({ query: 'q', category: 7 }))).toThrow(
      ToolValidationError,
    );
  });

  it('treats an empty category as no category, and sends no filter at all', async () => {
    const search = vi.fn().mockResolvedValue(stubResult(1));
    const withSearch = new SearchMedicalKbTool({ search } as unknown as MedicalKbRetriever);
    const args = withSearch.parseArgs(JSON.stringify({ query: 'q', category: '  ' }));
    expect(args).toMatchObject({ category: undefined });
    await withSearch.execute(args, ctx);

    // Not `{}` — an empty filter object reads as「a filter was sent」to
    // the retriever's empty-corpus guard.
    expect(search.mock.calls[0][0].filter).toBeUndefined();
  });

  it('tells the model when the results did NOT come from the category it asked for', async () => {
    const search = vi.fn().mockResolvedValue(stubResult(6, { filterFellBack: true }));
    const withSearch = new SearchMedicalKbTool({ search } as unknown as MedicalKbRetriever);
    const args = withSearch.parseArgs(
      JSON.stringify({ query: '麻醉风险', category: '11.病友经验' }),
    );
    const result = await withSearch.execute(args, ctx);

    // Six chunks and silence would let the model present corpus-wide
    // literature to the patient as 病友经验.
    expect(result.display).toContain('11.病友经验');
    expect(result.display).toContain('全库检索');
    expect(result.display).not.toContain('限定类目');
  });

  it('leaves the display untouched when no category was requested', async () => {
    const search = vi.fn().mockResolvedValue(stubResult(3));
    const withSearch = new SearchMedicalKbTool({ search } as unknown as MedicalKbRetriever);
    const result = await withSearch.execute(withSearch.parseArgs('{"query":"q"}'), ctx);
    expect(result.display).toBe('medical_kb: 3 chunks');
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
