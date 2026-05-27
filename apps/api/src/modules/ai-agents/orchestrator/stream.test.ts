import { describe, expect, it, vi } from 'vitest';

import { Orchestrator } from './run.js';
import { runStream } from './stream.js';
import type { OrchestratorEvent } from './types.js';
import type { ILLMProvider } from '../llm/base.js';
import type { RetrieveContext } from '../retrievers/base.js';
import type { ITool, ToolExecutionResult } from '../tools/base.js';
import { ToolRegistry } from '../tools/registry.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

const stubTool = (name: string): ITool => ({
  name,
  description: '',
  parametersSchema: { type: 'object', properties: {} },
  parseArgs: () => ({}),
  execute: async (): Promise<ToolExecutionResult> => ({
    retrieval: { retrieverId: name, chunks: [], citations: [], metadata: {} },
    display: `${name}: 0`,
  }),
});

const llm = (chunks: Array<() => Promise<unknown>>): ILLMProvider =>
  ({
    providerName: 'mock',
    model: 'mock',
    supportsToolCalling: true,
    chat: vi.fn().mockImplementation(() => chunks.shift()?.()),
    chatStream: vi.fn(),
  }) as unknown as ILLMProvider;

describe('runStream', () => {
  it('yields stage events in order and ends with done', async () => {
    const mockLlm = llm([
      async () => ({
        content: null,
        toolCalls: [{ id: 't1', name: 'a', argumentsJson: '{}' }],
        finishReason: 'tool_calls',
      }),
      async () => ({ content: 'final', toolCalls: [], finishReason: 'stop' }),
    ]);
    const registry = new ToolRegistry().register(stubTool('a'));
    const orch = new Orchestrator(
      mockLlm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    for await (const ev of runStream(orch, {
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'basic',
    })) {
      events.push(ev);
    }

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('planning');
    expect(types[types.length - 1]).toBe('done');
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_complete');
    expect(types).toContain('context_built');
    expect(types).toContain('answering');
  });

  it('emits an error event when the orchestrator rejects', async () => {
    const mockLlm = {
      providerName: 'mock',
      model: 'mock',
      supportsToolCalling: true,
      chat: vi.fn().mockRejectedValue(new Error('llm down')),
      chatStream: vi.fn(),
    } as unknown as ILLMProvider;
    const orch = new Orchestrator(
      mockLlm,
      new ToolRegistry(),
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    for await (const ev of runStream(orch, {
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'basic',
    })) {
      events.push(ev);
    }

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.message).toBe('llm down');
    }
  });
});
