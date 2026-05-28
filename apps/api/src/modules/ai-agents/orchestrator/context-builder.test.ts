import { describe, expect, it, vi } from 'vitest';

import { buildContext } from './context-builder.js';
import type { ExecutedToolCall } from './executor.js';
import type { RetrieveContext, RetrievedChunk } from '../retrievers/base.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

const kbChunk = (id: string, content: string): RetrievedChunk => ({
  id,
  source: 'medical_kb',
  content,
  metadata: {},
  distance: 0.1,
  sourceFile: 'fshd/x.md',
});

const profileChunk = (fields: Record<string, unknown>): RetrievedChunk => ({
  id: 'p1',
  source: 'patient_profile',
  content: 'placeholder',
  metadata: { fields },
  distance: null,
  sourceFile: 'patient_profile',
});

const ok = (
  toolCallId: string,
  toolName: string,
  chunks: RetrievedChunk[],
  options: { retrieverId?: string; citationsCount?: number } = {},
): ExecutedToolCall => {
  const retrieverId = options.retrieverId ?? chunks[0]?.source ?? toolName;
  const citationsCount = options.citationsCount ?? chunks.length;
  return {
    toolCallId,
    toolName,
    retrieval: {
      retrieverId,
      chunks,
      citations: chunks.slice(0, citationsCount).map((c) => ({
        chunkId: c.id,
        source: c.source,
        sourceFile: c.sourceFile ?? null,
        chunkIndex: 0,
        snippet: c.content.slice(0, 40),
      })),
      metadata: {},
    },
    display: `${toolName}: ${chunks.length}`,
    latencyMs: 10,
  };
};

describe('buildContext', () => {
  it('renders medical_kb chunks through the renderer and tags non-personal', () => {
    const executed = [
      ok('tc1', 'search_medical_kb', [
        kbChunk('a', 'DUX4 是位于 4q35 的双同源框基因，正常成人组织表达受抑制。'),
        kbChunk('b', 'D4Z4 重复序列拷贝数减少与 DUX4 失抑制相关。'),
      ]),
    ];

    const built = buildContext(executed, {
      mode: 'strict',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    });

    expect(built.toolMessages).toHaveLength(1);
    expect(built.toolMessages[0].toolCallId).toBe('tc1');
    expect(built.toolMessages[0].content).toMatch(/【片段1】/);
    expect(built.toolMessages[0].content).toMatch(/DUX4/);
    expect(built.citations).toHaveLength(2);
    expect(built.fieldsUsed).toEqual([]);
    expect(built.usedPersonalData).toBe(false);
  });

  it('flags usedPersonalData and aggregates fieldsUsed for patient sources', () => {
    const executed = [
      ok('tc1', 'get_my_profile', [
        profileChunk({
          gender: '男',
          ageGroup: '30-40',
          diagnosisStage: 'stage 2',
          d4z4_clinical: 'short',
        }),
      ]),
    ];

    const built = buildContext(executed, {
      mode: 'strict',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    });

    expect(built.usedPersonalData).toBe(true);
    expect(built.fieldsUsed).toEqual(
      expect.arrayContaining(['gender', 'ageGroup', 'diagnosisStage', 'd4z4_clinical']),
    );
    expect(built.toolMessages[0].content).toMatch(/【患者基础档案】/);
    expect(built.toolMessages[0].content).toMatch(/性别: 男/);
  });

  it('dedupes citations by chunkId across tool calls', () => {
    const shared = kbChunk('dup', 'shared content with enough length to survive junk filter');
    const executed = [ok('tc1', 'a', [shared]), ok('tc2', 'b', [shared])];

    const built = buildContext(executed, {
      mode: 'strict',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    });

    expect(built.citations).toHaveLength(1);
    expect(built.citations[0].chunkId).toBe('dup');
  });

  it('emits a redacted error tool message when an executed call has an error', () => {
    const executed: ExecutedToolCall[] = [
      {
        toolCallId: 'tc1',
        toolName: 'a',
        display: 'a: invalid args',
        // The raw error contains data that came back from the
        // retriever (column names, parameters, sometimes user
        // strings). The orchestrator must not echo it back into the
        // LLM context — the model could surface it in the user-facing
        // answer.
        error: 'pg error 22P02: invalid input syntax for integer: "13800001234"',
        latencyMs: 0,
      },
    ];

    const built = buildContext(executed, {
      mode: 'strict',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    });

    expect(built.toolMessages).toHaveLength(1);
    expect(built.toolMessages[0].content).toContain('tc1');
    // The raw error must NOT make it into the prompt.
    expect(built.toolMessages[0].content).not.toContain('13800001234');
    expect(built.toolMessages[0].content).not.toContain('pg error');
    expect(built.usedPersonalData).toBe(false);
  });

  it('does not flag usedPersonalData when a patient retriever returned zero chunks', () => {
    const executed = [ok('tc1', 'get_my_profile', [])];
    const built = buildContext(executed, {
      mode: 'strict',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    });
    expect(built.usedPersonalData).toBe(false);
  });
});
