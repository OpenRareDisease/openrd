import { describe, expect, it, vi } from 'vitest';

import type { RetrieveContext } from './base.js';
import { PlatformDocsRetriever } from './platform-docs.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child() {
    return silentLogger;
  },
};

describe('PlatformDocsRetriever (stub)', () => {
  it('returns an empty result with not_implemented sentinel', async () => {
    const retriever = new PlatformDocsRetriever();
    const ctx: RetrieveContext = {
      userId: 'user-1',
      consentLevel: 'basic',
      requestId: 'req-1',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    };
    const result = await retriever.search({ question: 'platform docs?' }, ctx);
    expect(result.chunks).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.metadata.reason).toBe('not_implemented');
  });
});
