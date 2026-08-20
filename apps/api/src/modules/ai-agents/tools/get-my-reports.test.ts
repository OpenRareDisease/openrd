import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from './base.js';
import { ToolValidationError } from './base.js';
import {
  CLASSIFIED_REPORT_TYPES,
  DOCUMENT_TYPE_ENUM,
  GetMyReportsTool,
  UPLOAD_DOCUMENT_TYPES,
} from './get-my-reports.js';
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

/**
 * Both vocabularies, pinned across the language boundary.
 *
 * `documentType` is the only argument the model can get wrong in a way
 * the patient sees: a value the classifier never writes comes back
 * empty, and an omitted value cannot be asked for at all. The strings
 * are decided by `_classify_report` in
 * apps/report-manager/app/services/fshd_report_service.py — another
 * workspace, another language, no import between them — so the schema
 * is checked against that source rather than against a memory of it.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..');
const PARSER_SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, 'apps', 'report-manager', 'app', 'services', 'fshd_report_service.py'),
  'utf8',
);

describe('the OCR vocabulary get_my_reports advertises', () => {
  /** Top-level keys of REPORT_TYPE_RULES. Nested rows inside a rule are
   *  indented further and are tuples, not quoted keys. */
  const parserRuleTypes = () => {
    const block = PARSER_SOURCE.match(/^REPORT_TYPE_RULES.*= \{$\n([\s\S]*?)^\}$/m)?.[1];
    expect(block).toBeDefined();
    return [...(block ?? '').matchAll(/^ {4}"([a-z_]+)":/gm)].map((match) => match[1]);
  };

  it('is exactly what the FSHD parser can conclude', () => {
    // `_classify_report` returns a REPORT_TYPE_RULES key, or the
    // literal asserted below when no rule scores. That string is
    // `analysis.fshd.report_type`, which embedded-report-ocr.ts copies
    // into `ocr_payload.fields.classifiedType` — the column
    // patient-reports.ts filters on. Nothing else writes it, so these
    // two together are the whole vocabulary.
    const ruleTypes = parserRuleTypes();
    expect(ruleTypes).toContain('genetic_report');
    expect(PARSER_SOURCE).toMatch(/return "other",/);

    expect(CLASSIFIED_REPORT_TYPES.slice().sort()).toEqual([...ruleTypes, 'other'].sort());
  });

  it('advertises each value once', () => {
    expect(new Set(DOCUMENT_TYPE_ENUM).size).toBe(DOCUMENT_TYPE_ENUM.length);
    expect(DOCUMENT_TYPE_ENUM).toEqual(
      expect.arrayContaining([...UPLOAD_DOCUMENT_TYPES, ...CLASSIFIED_REPORT_TYPES]),
    );
  });

  it('accepts every advertised value through parseArgs', () => {
    // The enum and the validator are two lists until something says so:
    // a value the schema offers and `validate` rejects is a tool call
    // that dies on arrival, with no retry in a two-round orchestrator.
    const tool = new GetMyReportsTool({
      search: vi.fn(),
    } as unknown as PatientReportsRetriever);
    for (const type of DOCUMENT_TYPE_ENUM) {
      expect(tool.parseArgs(JSON.stringify({ documentType: type }))).toEqual({
        documentType: type,
      });
    }
  });

  it('names every advertised value in the description the model reads', () => {
    // The description is what the model actually plans against; an enum
    // it cannot see spelled out is one it will not use.
    const tool = new GetMyReportsTool({
      search: vi.fn(),
    } as unknown as PatientReportsRetriever);
    const properties = tool.parametersSchema.properties as Record<string, { description: string }>;
    for (const type of DOCUMENT_TYPE_ENUM) {
      expect(properties.documentType.description).toContain('`' + type + '`');
    }
  });
});
