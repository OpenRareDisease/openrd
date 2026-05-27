import { describe, expect, it, vi } from 'vitest';

import { Planner } from './planner.js';
import type { ILLMProvider, LlmChatResponse } from '../llm/base.js';
import type { RetrieveContext } from '../retrievers/base.js';
import type { ITool } from '../tools/base.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

const mockLlm = (
  response: LlmChatResponse,
  options: { supportsToolCalling?: boolean } = {},
): ILLMProvider & { chat: ReturnType<typeof vi.fn> } => {
  const chat = vi.fn().mockResolvedValue(response);
  return {
    providerName: 'mock',
    model: 'mock-model',
    supportsToolCalling: options.supportsToolCalling ?? true,
    chat,
    chatStream: vi.fn(),
  } as unknown as ILLMProvider & { chat: ReturnType<typeof vi.fn> };
};

const stubTool = (name: string): ITool => ({
  name,
  description: `${name} stub`,
  parametersSchema: { type: 'object', properties: {} },
  parseArgs: () => ({}),
  execute: async () => ({
    retrieval: { retrieverId: name, chunks: [], citations: [], metadata: {} },
    display: '',
  }),
});

describe('Planner', () => {
  it('advertises tools when LLM supports tool calling', async () => {
    const llm = mockLlm({
      content: null,
      toolCalls: [],
      finishReason: 'stop',
    });
    const planner = new Planner(llm, silentLogger as unknown as RetrieveContext['logger']);

    const result = await planner.plan({
      systemPrompt: 'sys',
      userPrompt: 'user q',
      tools: [stubTool('search_medical_kb'), stubTool('get_my_profile')],
      requestId: 'req-1',
    });

    expect(result.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user q' },
    ]);
    const arg = llm.chat.mock.calls[0][0];
    expect(arg.toolChoice).toBe('auto');
    expect(arg.tools).toHaveLength(2);
    expect(arg.tools[0].name).toBe('search_medical_kb');
    expect(arg.requestId).toBe('req-1');
  });

  it('skips tool advertising when LLM does not support tool calling', async () => {
    const llm = mockLlm(
      { content: 'direct', toolCalls: [], finishReason: 'stop' },
      { supportsToolCalling: false },
    );
    const planner = new Planner(llm, silentLogger as unknown as RetrieveContext['logger']);

    await planner.plan({
      systemPrompt: 'sys',
      userPrompt: 'q',
      tools: [stubTool('a')],
      requestId: 'req-2',
    });

    const arg = llm.chat.mock.calls[0][0];
    expect(arg.tools).toBeUndefined();
    expect(arg.toolChoice).toBeUndefined();
  });

  it('skips tool advertising when no tools are passed', async () => {
    const llm = mockLlm({ content: 'x', toolCalls: [], finishReason: 'stop' });
    const planner = new Planner(llm, silentLogger as unknown as RetrieveContext['logger']);

    await planner.plan({
      systemPrompt: 'sys',
      userPrompt: 'q',
      tools: [],
      requestId: 'req-3',
    });

    const arg = llm.chat.mock.calls[0][0];
    expect(arg.tools).toBeUndefined();
    expect(arg.toolChoice).toBeUndefined();
  });
});
