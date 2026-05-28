import { describe, expect, it, vi } from 'vitest';

import type { LlmChatRequest, LlmStreamEvent, LlmToolDefinition } from './base.js';
import {
  SiliconFlowProvider,
  type OpenAIChatClient,
  type SiliconFlowOptions,
} from './siliconflow.js';
import type { RetrieveContext } from '../retrievers/base.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

interface StreamFixture {
  // OpenAI stream chunks shape — only fields the impl touches.
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const makeStream = (chunks: StreamFixture[]): AsyncIterable<StreamFixture> => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) yield chunk;
  },
});

const baseOpts = (client: OpenAIChatClient): SiliconFlowOptions => ({
  apiKey: 'sk-test',
  baseURL: 'http://localhost/v1',
  model: 'deepseek-ai/DeepSeek-V3',
  timeoutMs: 5_000,
  logger: silentLogger,
  client,
});

describe('SiliconFlowProvider.chat', () => {
  it('forwards messages + tools and parses a text response', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: { content: 'hi from llm', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
    const client: OpenAIChatClient = {
      chat: { completions: { create } } as unknown as OpenAIChatClient['chat'],
    };
    const provider = new SiliconFlowProvider(baseOpts(client));

    const tool: LlmToolDefinition = {
      name: 'search_medical_kb',
      description: 'search the FSHD KB',
      parametersSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    };
    const req: LlmChatRequest = {
      messages: [
        { role: 'system', content: 'you are an assistant' },
        { role: 'user', content: 'what is D4Z4?' },
      ],
      tools: [tool],
      toolChoice: 'auto',
      temperature: 0.3,
      maxTokens: 200,
    };

    const response = await provider.chat(req);

    expect(response).toEqual({
      content: 'hi from llm',
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
    });
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0];
    expect(arg.model).toBe('deepseek-ai/DeepSeek-V3');
    expect(arg.temperature).toBe(0.3);
    expect(arg.max_tokens).toBe(200);
    expect(arg.tool_choice).toBe('auto');
    expect(arg.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'search_medical_kb',
          description: 'search the FSHD KB',
          parameters: tool.parametersSchema,
        },
      },
    ]);
    expect(arg.messages).toEqual([
      { role: 'system', content: 'you are an assistant' },
      { role: 'user', content: 'what is D4Z4?' },
    ]);
  });

  it('parses tool calls when the model decides to invoke one', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'search_medical_kb',
                  arguments: '{"query":"D4Z4"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const provider = new SiliconFlowProvider(
      baseOpts({
        chat: { completions: { create } } as unknown as OpenAIChatClient['chat'],
      }),
    );

    const response = await provider.chat({
      messages: [{ role: 'user', content: 'tell me' }],
    });

    expect(response.content).toBeNull();
    expect(response.finishReason).toBe('tool_calls');
    expect(response.toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'search_medical_kb',
        argumentsJson: '{"query":"D4Z4"}',
      },
    ]);
  });

  it('round-trips an assistant + tool message back into the OpenAI shape', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'final' }, finish_reason: 'stop' }],
    });
    const provider = new SiliconFlowProvider(
      baseOpts({
        chat: { completions: { create } } as unknown as OpenAIChatClient['chat'],
      }),
    );

    await provider.chat({
      messages: [
        { role: 'user', content: 'tell me' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call-1', name: 'search_medical_kb', argumentsJson: '{}' }],
        },
        {
          role: 'tool',
          toolCallId: 'call-1',
          name: 'search_medical_kb',
          content: '{"chunks":[]}',
        },
      ],
    });

    const arg = create.mock.calls[0][0];
    expect(arg.messages).toEqual([
      { role: 'user', content: 'tell me' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'search_medical_kb', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: '{"chunks":[]}',
      },
    ]);
  });

  it('maps a forced tool choice to OpenAI shape', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    const provider = new SiliconFlowProvider(
      baseOpts({
        chat: { completions: { create } } as unknown as OpenAIChatClient['chat'],
      }),
    );

    await provider.chat({
      messages: [{ role: 'user', content: 'go' }],
      toolChoice: { type: 'function', name: 'get_my_profile' },
    });

    expect(create.mock.calls[0][0].tool_choice).toEqual({
      type: 'function',
      function: { name: 'get_my_profile' },
    });
  });

  it('returns an empty response with usage if the vendor returns no choices', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    });
    const provider = new SiliconFlowProvider(
      baseOpts({
        chat: { completions: { create } } as unknown as OpenAIChatClient['chat'],
      }),
    );

    const response = await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response.content).toBeNull();
    expect(response.toolCalls).toEqual([]);
    expect(response.finishReason).toBe('unknown');
    expect(response.usage?.promptTokens).toBe(5);
  });

  it('maps unknown finish_reason to "unknown"', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'x' }, finish_reason: 'something_new' }],
    });
    const provider = new SiliconFlowProvider(
      baseOpts({
        chat: { completions: { create } } as unknown as OpenAIChatClient['chat'],
      }),
    );

    const response = await provider.chat({
      messages: [{ role: 'user', content: 'q' }],
    });

    expect(response.finishReason).toBe('unknown');
  });
});

describe('SiliconFlowProvider.chatStream', () => {
  it('yields text deltas, tool call deltas and a finish event', async () => {
    const stream = makeStream([
      { choices: [{ delta: { content: 'hel' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'lo' }, finish_reason: null }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  function: { name: 'search_medical_kb', arguments: '{"q":' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
      },
    ]);
    const create = vi.fn().mockResolvedValue(stream);
    const provider = new SiliconFlowProvider(
      baseOpts({
        chat: { completions: { create } } as unknown as OpenAIChatClient['chat'],
      }),
    );

    const events: LlmStreamEvent[] = [];
    for await (const ev of provider.chatStream({
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      events.push(ev);
    }

    expect(events).toEqual([
      { type: 'text_delta', text: 'hel' },
      { type: 'text_delta', text: 'lo' },
      {
        type: 'tool_call_delta',
        index: 0,
        id: 'call-1',
        name: 'search_medical_kb',
        argumentsJson: '{"q":',
      },
      {
        type: 'tool_call_delta',
        index: 0,
        id: undefined,
        name: undefined,
        argumentsJson: '"hi"}',
      },
      {
        type: 'finish',
        finishReason: 'tool_calls',
        usage: { promptTokens: 4, completionTokens: 1, totalTokens: 5 },
      },
    ]);
    expect(create.mock.calls[0][0].stream).toBe(true);
  });

  it('emits a synthetic finish event when the stream ends without one', async () => {
    const stream = makeStream([
      { choices: [{ delta: { content: 'partial' }, finish_reason: null }] },
    ]);
    const create = vi.fn().mockResolvedValue(stream);
    const provider = new SiliconFlowProvider(
      baseOpts({
        chat: { completions: { create } } as unknown as OpenAIChatClient['chat'],
      }),
    );

    const events: LlmStreamEvent[] = [];
    for await (const ev of provider.chatStream({
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      events.push(ev);
    }

    expect(events[events.length - 1]).toEqual({
      type: 'finish',
      finishReason: 'unknown',
    });
  });
});

describe('SiliconFlowProvider error sanitiser (PR-Sec-5 #5)', () => {
  it('chat() throws a SiliconFlowProviderError that drops headers / body', async () => {
    // Simulate an OpenAI APIError shape that carries the request
    // headers (with Authorization) and a request body. We must not
    // see either field after the wrap.
    class FakeApiError extends Error {
      status = 401;
      code = 'invalid_api_key';
      headers = { Authorization: 'Bearer SECRET-DO-NOT-LEAK' };
      request = { body: { messages: [{ content: '私人 PII 数据' }] } };
      constructor() {
        super('Incorrect API key (siliconflow says so)');
        this.name = 'APIError';
      }
    }

    const create = vi.fn().mockRejectedValue(new FakeApiError());
    const provider = new SiliconFlowProvider(
      baseOpts({
        chat: { completions: { create } } as unknown as OpenAIChatClient['chat'],
      }),
    );

    try {
      await provider.chat({ messages: [{ role: 'user', content: 'q' }] });
      throw new Error('expected throw');
    } catch (error) {
      const e = error as Error & {
        headers?: unknown;
        request?: unknown;
        status?: number;
        code?: string;
      };
      expect(e.name).toBe('SiliconFlowProviderError');
      expect(e.message).toContain('Incorrect API key');
      expect(e.status).toBe(401);
      expect(e.code).toBe('invalid_api_key');
      // Critical: the carrier fields are not preserved on the wrapped error.
      expect(e.headers).toBeUndefined();
      expect(e.request).toBeUndefined();
      // And nothing in the message includes the bearer token.
      expect(JSON.stringify(e)).not.toContain('SECRET-DO-NOT-LEAK');
    }
  });
});
