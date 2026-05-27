import { describe, expect, it, vi } from 'vitest';

import { Orchestrator } from './run.js';
import { OrchestratorConsentDenied, type OrchestratorEvent } from './types.js';
import type { ILLMProvider, LlmChatRequest, LlmChatResponse } from '../llm/base.js';
import type { RetrieveContext, RetrieveResult } from '../retrievers/base.js';
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

const stubResult = (
  retrieverId: string,
  chunkCount: number,
  fields?: Record<string, unknown>,
): RetrieveResult => ({
  retrieverId,
  chunks: Array.from({ length: chunkCount }, (_, i) => ({
    id: `c-${retrieverId}-${i}`,
    source: retrieverId,
    content:
      retrieverId === 'medical_kb'
        ? `medical knowledge chunk ${i + 1} long enough to survive renderer filter`
        : 'placeholder',
    metadata: fields ? { fields } : {},
    distance: retrieverId === 'medical_kb' ? 0.1 + i * 0.01 : null,
    sourceFile: retrieverId === 'medical_kb' ? `fshd/${i}.md` : retrieverId,
  })),
  citations: Array.from({ length: chunkCount }, (_, i) => ({
    chunkId: `c-${retrieverId}-${i}`,
    source: retrieverId,
    sourceFile: retrieverId === 'medical_kb' ? `fshd/${i}.md` : retrieverId,
    chunkIndex: i,
    snippet: `snippet ${i}`,
  })),
  metadata: {},
});

const mkTool = (name: string, result: RetrieveResult): ITool => ({
  name,
  description: `${name} stub`,
  parametersSchema: { type: 'object', properties: {} },
  parseArgs: () => ({}),
  execute: async (): Promise<ToolExecutionResult> => ({
    retrieval: result,
    display: `${name}: ${result.chunks.length}`,
  }),
});

const mkLlm = (
  responses: LlmChatResponse[],
): ILLMProvider & {
  chat: ReturnType<typeof vi.fn>;
} => {
  let i = 0;
  const chat = vi.fn().mockImplementation(async () => {
    const r = responses[i] ?? responses[responses.length - 1];
    i += 1;
    return r;
  });
  return {
    providerName: 'mock',
    model: 'mock-model',
    supportsToolCalling: true,
    chat,
    chatStream: vi.fn(),
  } as unknown as ILLMProvider & { chat: ReturnType<typeof vi.fn> };
};

describe('Orchestrator.run', () => {
  it('refuses when consent is none', async () => {
    const orch = new Orchestrator(
      mkLlm([{ content: 'x', toolCalls: [], finishReason: 'stop' }]),
      new ToolRegistry(),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    await expect(
      orch.run({
        userId: 'u1',
        question: 'hi',
        requestId: 'r1',
        consentLevel: 'none',
      }),
    ).rejects.toBeInstanceOf(OrchestratorConsentDenied);
  });

  it('returns directly when the planner answers without calling tools', async () => {
    const llm = mkLlm([{ content: '直接回答', toolCalls: [], finishReason: 'stop' }]);
    const registry = new ToolRegistry().register(
      mkTool('search_medical_kb', stubResult('medical_kb', 0)),
    );
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    const result = await orch.run(
      {
        userId: 'u1',
        question: 'q',
        requestId: 'r1',
        consentLevel: 'basic',
      },
      (e) => events.push(e),
    );

    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe('直接回答');
    expect(result.toolsCalled).toEqual([]);
    expect(result.usedPersonalData).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['planning', 'plan_complete', 'done']);
  });

  it('runs tool calls, renders context, and produces a final answer', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [
          {
            id: 'call-1',
            name: 'search_medical_kb',
            argumentsJson: '{"query":"D4Z4"}',
          },
          {
            id: 'call-2',
            name: 'get_my_profile',
            argumentsJson: '{}',
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: '基于知识库和你的资料的最终回答',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
      },
    ]);

    const registry = new ToolRegistry()
      .register(mkTool('search_medical_kb', stubResult('medical_kb', 2)))
      .register(
        mkTool(
          'get_my_profile',
          stubResult('patient_profile', 1, { gender: '男', ageGroup: '30-40' }),
        ),
      );
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    const result = await orch.run(
      {
        userId: 'u1',
        question: 'tell me about D4Z4 and my situation',
        requestId: 'r1',
        consentLevel: 'basic',
      },
      (e) => events.push(e),
    );

    expect(llm.chat).toHaveBeenCalledTimes(2);
    const round2Arg = llm.chat.mock.calls[1][0] as LlmChatRequest;
    expect(round2Arg.tools).toBeUndefined();
    // system + user + assistant(toolCalls) + 2 tool messages
    expect(round2Arg.messages).toHaveLength(5);
    expect(round2Arg.messages[2].role).toBe('assistant');
    expect(round2Arg.messages[3].role).toBe('tool');
    expect(round2Arg.messages[4].role).toBe('tool');

    expect(result.answer).toBe('基于知识库和你的资料的最终回答');
    expect(result.toolsCalled).toEqual(['search_medical_kb', 'get_my_profile']);
    expect(result.usedPersonalData).toBe(true);
    expect(result.fieldsUsed).toEqual(expect.arrayContaining(['gender', 'ageGroup']));
    expect(result.citations).toHaveLength(3); // 2 kb + 1 profile
    expect(result.redactionMode).toBe('strict');
    expect(result.redactedPromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.promptCharLength).toBeGreaterThan(0);
    expect(result.llmUsage?.totalTokens).toBe(130);

    expect(events.map((e) => e.type)).toEqual([
      'planning',
      'plan_complete',
      'tool_start',
      'tool_start',
      'tool_complete',
      'tool_complete',
      'context_built',
      'answering',
      'done',
    ]);
  });

  it('uses precise mode when consent is precise', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [
          {
            id: 'call-1',
            name: 'get_my_profile',
            argumentsJson: '{}',
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'done', toolCalls: [], finishReason: 'stop' },
    ]);
    const registry = new ToolRegistry().register(
      mkTool('get_my_profile', stubResult('patient_profile', 1, { d4z4: '3/22', gender: '男' })),
    );
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const result = await orch.run({
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'precise',
    });

    expect(result.redactionMode).toBe('precise');
    expect(result.fieldsUsed).toEqual(expect.arrayContaining(['d4z4', 'gender']));
  });

  it('only advertises consent-appropriate tools to the planner', async () => {
    const llm = mkLlm([{ content: 'x', toolCalls: [], finishReason: 'stop' }]);
    const registry = new ToolRegistry()
      .register(mkTool('search_medical_kb', stubResult('medical_kb', 0)))
      .register({
        ...mkTool('get_my_profile', stubResult('patient_profile', 0)),
        minConsent: 'basic',
      });
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    await orch.run({
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'basic',
    });

    const advertised = (llm.chat.mock.calls[0][0] as LlmChatRequest).tools ?? [];
    expect(advertised.map((t) => t.name).sort()).toEqual(['get_my_profile', 'search_medical_kb']);
  });

  // Fix #2 regression: the audit hash must reflect every message sent
  // to the LLM, including the assistant turn (with its tool-call
  // arguments). Two runs that differ only in the assistant message
  // must produce different hashes.
  it('audit hash differentiates runs that differ only in the assistant tool-call payload', async () => {
    const buildRegistry = () =>
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 1)));

    const runWith = async (argsJson: string) => {
      const llm = mkLlm([
        {
          content: null,
          toolCalls: [{ id: 'call-1', name: 'search_medical_kb', argumentsJson: argsJson }],
          finishReason: 'tool_calls',
        },
        { content: 'same final answer', toolCalls: [], finishReason: 'stop' },
      ]);
      const orch = new Orchestrator(
        llm,
        buildRegistry(),
        silentLogger as unknown as RetrieveContext['logger'],
      );
      return orch.run({
        userId: 'u1',
        question: 'same question',
        requestId: 'r1',
        consentLevel: 'basic',
      });
    };

    const a = await runWith('{"query":"D4Z4 mechanism"}');
    const b = await runWith('{"query":"FSHD treatment"}');

    expect(a.redactedPromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.redactedPromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.redactedPromptHash).not.toBe(b.redactedPromptHash);
  });
});
