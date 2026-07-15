import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { hashPrompt } from './hash.js';
import { AuditLogger } from './prompt-audit.js';
import type { AuditEntryInput } from './types.js';

const baseEntry: AuditEntryInput = {
  userId: 'user-1',
  requestId: 'req-1',
  llmProvider: 'siliconflow',
  llmModel: 'deepseek-v3.1',
  consentLevel: 'basic',
  redactionMode: 'strict',
  redactedPromptHash: 'abc',
  promptCharLength: 1234,
  usedPersonalData: true,
  fieldsUsed: ['ageGroup', 'd4z4_clinical'],
  toolsCalled: [
    {
      name: 'medical_kb',
      toolCallId: 'call-1',
      status: 'ok',
      chunkCount: 3,
      latencyMs: 120,
    },
    {
      name: 'patient_profile',
      toolCallId: 'call-2',
      status: 'ok',
      chunkCount: 1,
      latencyMs: 45,
    },
  ],
  latencyMs: 1500,
  status: 'success',
};

const makePool = () => {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const query = vi.fn().mockImplementation(async (text: string, params: unknown[]) => {
    calls.push({ text, params });
    if (/INSERT INTO ai_prompt_audit/i.test(text)) {
      return {
        rows: [{ id: 'audit-id-1' }],
        rowCount: 1,
      } as unknown as QueryResult;
    }
    return { rows: [], rowCount: 0 } as unknown as QueryResult;
  });
  return {
    pool: { query } as unknown as Pool,
    query,
    calls,
  };
};

describe('hashPrompt', () => {
  it('produces a stable sha256 hex digest', () => {
    const a = hashPrompt('hello world');
    const b = hashPrompt('hello world');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
  it('trims leading/trailing whitespace but does not collapse internal whitespace', () => {
    // Whitespace collapse was removed because it let an attacker pad a
    // benign prompt to match a known target hash. Internal whitespace
    // must now contribute to the digest.
    expect(hashPrompt('  hello world  ')).toBe(hashPrompt('hello world'));
    expect(hashPrompt('a   b\n  c')).not.toBe(hashPrompt('a b c'));
  });
});

describe('AuditLogger.record', () => {
  it('inserts a row and returns the generated id', async () => {
    const { pool, calls } = makePool();
    const logger = new AuditLogger(pool);
    const id = await logger.record(baseEntry);
    expect(id).toBe('audit-id-1');
    expect(calls).toHaveLength(1);
    const params = calls[0].params;
    expect(params[0]).toBe('user-1');
    expect(params[1]).toBe('req-1');
    expect(params[4]).toBe('basic');
    expect(params[5]).toBe('strict');
    // $9/$10 are the multi-turn history counters (0 / null when the
    // entry predates or omits them).
    expect(params[8]).toBe(0);
    expect(params[9]).toBeNull();
    expect(params[10]).toBe(true);
    expect(JSON.parse(params[11] as string)).toEqual(['ageGroup', 'd4z4_clinical']);
    expect(JSON.parse(params[12] as string)).toEqual([
      {
        name: 'medical_kb',
        toolCallId: 'call-1',
        status: 'ok',
        chunkCount: 3,
        latencyMs: 120,
      },
      {
        name: 'patient_profile',
        toolCallId: 'call-2',
        status: 'ok',
        chunkCount: 1,
        latencyMs: 45,
      },
    ]);
    expect(params[14]).toBe('success');
  });

  it('defaults optional bookkeeping fields to null', async () => {
    const { pool, calls } = makePool();
    const logger = new AuditLogger(pool);
    await logger.record({
      ...baseEntry,
      requestId: undefined,
      redactedPromptHash: undefined,
      promptCharLength: undefined,
      latencyMs: undefined,
      errorDetail: undefined,
    });
    const params = calls[0].params;
    expect(params[1]).toBeNull(); // request_id
    expect(params[6]).toBeNull(); // redacted_prompt_hash
    expect(params[7]).toBeNull(); // prompt_char_length
    expect(params[8]).toBe(0); // history_message_count defaults to 0
    expect(params[9]).toBeNull(); // history_char_length
    expect(params[13]).toBeNull(); // latency_ms
    expect(params[15]).toBeNull(); // error_detail
  });
});

describe('AuditLogger.listByUser', () => {
  const sampleRow = {
    id: 'audit-1',
    user_id: 'user-1',
    request_id: 'req-1',
    llm_provider: 'siliconflow',
    llm_model: 'deepseek-v3.1',
    consent_level: 'basic',
    redaction_mode: 'strict',
    redacted_prompt_hash: 'abc',
    prompt_char_length: 1234,
    used_personal_data: true,
    fields_used: ['ageGroup'],
    tools_called: ['medical_kb'],
    latency_ms: 1500,
    status: 'success',
    error_detail: null,
    created_at: '2026-05-26T20:00:00Z',
  };

  it('returns parsed entries from the matching rows', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [sampleRow],
      rowCount: 1,
    } as unknown as QueryResult);
    const pool = { query } as unknown as Pool;
    const logger = new AuditLogger(pool);

    const entries = await logger.listByUser('user-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('audit-1');
    expect(entries[0].fieldsUsed).toEqual(['ageGroup']);
    // sampleRow uses the legacy string[] shape; the decoder folds
    // it into the current ToolCallSummary[] with promoted defaults.
    expect(entries[0].toolsCalled).toEqual([
      {
        name: 'medical_kb',
        toolCallId: 'legacy-0',
        status: 'ok',
        chunkCount: 0,
        latencyMs: null,
      },
    ]);
    expect(entries[0].status).toBe('success');
    expect(entries[0].createdAt).toBe('2026-05-26T20:00:00.000Z');
  });

  it('passes new ToolCallSummary[] shape through unchanged on read', async () => {
    // Rows persisted from this PR onward already carry the rich
    // shape; the decoder should preserve every field rather than
    // re-promoting it as if it were legacy.
    const richRow = {
      ...sampleRow,
      tools_called: [
        {
          name: 'search_medical_kb',
          toolCallId: 'call-real-1',
          status: 'ok',
          chunkCount: 5,
          latencyMs: 234,
        },
        {
          name: 'get_my_reports',
          toolCallId: 'call-real-2',
          status: 'error',
          chunkCount: 0,
          latencyMs: 12,
          errorDetail: 'no rows',
        },
      ],
    };
    const query = vi.fn().mockResolvedValue({
      rows: [richRow],
      rowCount: 1,
    } as unknown as QueryResult);
    const pool = { query } as unknown as Pool;
    const logger = new AuditLogger(pool);

    const entries = await logger.listByUser('user-1');
    expect(entries[0].toolsCalled).toEqual([
      {
        name: 'search_medical_kb',
        toolCallId: 'call-real-1',
        status: 'ok',
        chunkCount: 5,
        latencyMs: 234,
      },
      {
        name: 'get_my_reports',
        toolCallId: 'call-real-2',
        status: 'error',
        chunkCount: 0,
        latencyMs: 12,
        errorDetail: 'no rows',
      },
    ]);
  });

  it('drops malformed entries in tools_called without crashing', async () => {
    // Defensive: if a row was hand-edited or a future bug stuffed
    // junk into the jsonb column, the decoder should skip the bad
    // entries instead of throwing — the audit list is too important
    // to fail loudly over a corrupted historical row.
    const dirtyRow = {
      ...sampleRow,
      tools_called: [
        { name: 'good', toolCallId: 'c1', status: 'ok', chunkCount: 1, latencyMs: 10 },
        null,
        42,
        { toolCallId: 'no-name', status: 'ok' }, // missing name
        'legacy_string', // legacy shape mixed in
      ],
    };
    const query = vi.fn().mockResolvedValue({
      rows: [dirtyRow],
      rowCount: 1,
    } as unknown as QueryResult);
    const pool = { query } as unknown as Pool;
    const logger = new AuditLogger(pool);

    const entries = await logger.listByUser('user-1');
    const calls = entries[0].toolsCalled;
    expect(calls.map((c) => c.name)).toEqual(['good', 'legacy_string']);
    // The legacy string was promoted with the index-based toolCallId
    // we documented in the decoder.
    expect(calls[1]).toMatchObject({
      name: 'legacy_string',
      toolCallId: 'legacy-4',
      latencyMs: null,
    });
  });

  it('passes status filter as a text array param', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as unknown as QueryResult);
    const pool = { query } as unknown as Pool;
    const logger = new AuditLogger(pool);

    await logger.listByUser('user-1', { status: ['error', 'consent_denied'] });
    const params = query.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe('user-1');
    expect(params[1]).toEqual(['error', 'consent_denied']);
  });

  it('clamps oversized limit to the safety ceiling', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as unknown as QueryResult);
    const pool = { query } as unknown as Pool;
    const logger = new AuditLogger(pool);

    await logger.listByUser('user-1', { limit: 99999 });
    const params = query.mock.calls[0][1] as unknown[];
    // The limit is the second-to-last param (offset is the last one).
    const limitParam = params[params.length - 2] as number;
    expect(limitParam).toBeLessThanOrEqual(200);
  });

  it('returns [] for an empty userId without hitting the DB', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as unknown as QueryResult);
    const pool = { query } as unknown as Pool;
    const logger = new AuditLogger(pool);
    const out = await logger.listByUser('');
    expect(out).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
