import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from './base.js';
import { ToolValidationError } from './base.js';
import { GetMyReportsTool } from './get-my-reports.js';
import type { RetrieveContext, RetrieveResult } from '../retrievers/base.js';
import type { PatientReportsRetriever } from '../retrievers/patient-reports.js';

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

const stub = (count: number): RetrieveResult => ({
  retrieverId: 'patient_reports',
  chunks: Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    source: 'patient_reports',
    content: 'x',
    metadata: {},
    distance: null,
  })),
  citations: [],
  metadata: {},
});

describe('GetMyReportsTool.parseArgs', () => {
  const tool = new GetMyReportsTool({
    search: vi.fn(),
  } as unknown as PatientReportsRetriever);

  it('accepts no args', () => {
    expect(tool.parseArgs('{}')).toEqual({});
    expect(tool.parseArgs('')).toEqual({});
  });

  it('rejects non-object payloads', () => {
    expect(() => tool.parseArgs('"hi"')).toThrow(ToolValidationError);
  });

  it('validates documentType + since + limit', () => {
    expect(() => tool.parseArgs('{"documentType":""}')).toThrow(/documentType/);
    expect(() => tool.parseArgs('{"since":"not-a-date"}')).toThrow(/since/);
    expect(() => tool.parseArgs('{"limit":"x"}')).toThrow(/limit/);
  });

  it('passes valid filter through and clamps limit', () => {
    expect(
      tool.parseArgs(
        JSON.stringify({
          documentType: '  genetic_report  ',
          since: '2024-01-01',
          limit: 999,
        }),
      ),
    ).toEqual({
      documentType: 'genetic_report',
      since: '2024-01-01',
      limit: 20,
    });
  });
});

describe('GetMyReportsTool.execute', () => {
  it('omits filter when no documentType/since provided', async () => {
    const search = vi.fn().mockResolvedValue(stub(2));
    const tool = new GetMyReportsTool({
      search,
    } as unknown as PatientReportsRetriever);

    await tool.execute({ limit: 3 }, ctx);

    expect(search).toHaveBeenCalledWith(
      { question: '', filter: undefined, limit: 3 },
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('forwards filter + limit and reports count in display', async () => {
    const search = vi.fn().mockResolvedValue(stub(2));
    const tool = new GetMyReportsTool({
      search,
    } as unknown as PatientReportsRetriever);

    const args = tool.parseArgs(JSON.stringify({ documentType: 'mri', since: '2024-06-01' }));
    const result = await tool.execute(args, ctx);

    expect(search).toHaveBeenCalledWith(
      {
        question: '',
        filter: { documentType: 'mri', since: '2024-06-01' },
        limit: undefined,
      },
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(result.display).toBe('patient_reports: 2 chunks');
  });

  it('shows empty reason in display string', async () => {
    const empty: RetrieveResult = {
      retrieverId: 'patient_reports',
      chunks: [],
      citations: [],
      metadata: { reason: 'no_reports_found' },
    };
    const tool = new GetMyReportsTool({
      search: vi.fn().mockResolvedValue(empty),
    } as unknown as PatientReportsRetriever);

    const result = await tool.execute({}, ctx);
    expect(result.display).toBe('patient_reports: empty (no_reports_found)');
  });
});
