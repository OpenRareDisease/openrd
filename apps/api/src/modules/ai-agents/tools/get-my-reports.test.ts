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

describe('GetMyReportsTool scope', () => {
  const searchOf = (calls: unknown[]) =>
    vi.fn(async (input: unknown) => {
      calls.push(input);
      return stub(1);
    });

  it('narrows to the document the patient had open', async () => {
    const calls: unknown[] = [];
    const tool = new GetMyReportsTool({
      search: searchOf(calls),
    } as unknown as PatientReportsRetriever);

    await tool.execute(
      {},
      { ...ctx, scope: { documentId: '11111111-1111-1111-1111-111111111111' } },
    );

    expect(calls[0]).toMatchObject({
      filter: { documentId: '11111111-1111-1111-1111-111111111111' },
      limit: 1,
    });
  });

  // The drawer's promise is「上下文已带入：这份检查报告」— singular. A
  // model-supplied `documentType` that disagreed with the open report
  // would turn that into zero rows, so the scope replaces the model's
  // filters rather than intersecting with them.
  it('drops the model’s own filters when scoped', async () => {
    const calls: unknown[] = [];
    const tool = new GetMyReportsTool({
      search: searchOf(calls),
    } as unknown as PatientReportsRetriever);

    await tool.execute(
      { documentType: 'blood_panel', since: '2020-01-01', limit: 20 },
      { ...ctx, scope: { documentId: '22222222-2222-2222-2222-222222222222' } },
    );

    expect(calls[0]).toMatchObject({
      filter: { documentId: '22222222-2222-2222-2222-222222222222' },
      limit: 1,
    });
    expect((calls[0] as { filter: Record<string, unknown> }).filter.documentType).toBeUndefined();
    expect((calls[0] as { filter: Record<string, unknown> }).filter.since).toBeUndefined();
  });

  it('leaves an unscoped ask alone', async () => {
    const calls: unknown[] = [];
    const tool = new GetMyReportsTool({
      search: searchOf(calls),
    } as unknown as PatientReportsRetriever);

    await tool.execute({ documentType: 'mri' }, ctx);

    expect(calls[0]).toMatchObject({ filter: { documentType: 'mri' } });
    expect((calls[0] as { filter: Record<string, unknown> }).filter.documentId).toBeUndefined();
  });
});
