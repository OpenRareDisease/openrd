import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from './base.js';
import { GetMyProfileTool } from './get-my-profile.js';
import type { RetrieveContext, RetrieveResult } from '../retrievers/base.js';
import type { PatientProfileRetriever } from '../retrievers/patient-profile.js';

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
  consentLevel: 'precise',
  requestId: 'req-1',
  logger: silentLogger as unknown as ToolContext['logger'],
};

describe('GetMyProfileTool', () => {
  it('advertises minConsent=basic', () => {
    const tool = new GetMyProfileTool({} as unknown as PatientProfileRetriever);
    expect(tool.minConsent).toBe('basic');
  });

  it('tolerates empty/null/garbage args by passing nothing to the retriever', async () => {
    const stub: RetrieveResult = {
      retrieverId: 'patient_profile',
      chunks: [
        {
          id: 'c1',
          source: 'patient_profile',
          content: 'x',
          metadata: { fields: { gender: 'M' } },
          distance: null,
        },
      ],
      citations: [],
      metadata: {},
    };
    const search = vi.fn().mockResolvedValue(stub);
    const tool = new GetMyProfileTool({
      search,
    } as unknown as PatientProfileRetriever);

    for (const raw of ['', '{}', 'null', '"oops"']) {
      tool.parseArgs(raw);
    }

    const result = await tool.execute({}, ctx);
    expect(search).toHaveBeenCalledWith(
      { question: '' },
      expect.objectContaining({ userId: 'user-1', consentLevel: 'precise' }),
    );
    expect(result.retrieval.chunks).toHaveLength(1);
    expect(result.display).toBe('patient_profile: 1 chunk');
  });

  it('surfaces empty-result reason in the display string', async () => {
    const empty: RetrieveResult = {
      retrieverId: 'patient_profile',
      chunks: [],
      citations: [],
      metadata: { reason: 'profile_not_found' },
    };
    const tool = new GetMyProfileTool({
      search: vi.fn().mockResolvedValue(empty),
    } as unknown as PatientProfileRetriever);

    const result = await tool.execute({}, ctx);
    expect(result.display).toBe('patient_profile: empty (profile_not_found)');
  });
});
