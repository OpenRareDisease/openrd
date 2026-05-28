/**
 * SiliconFlow provider — talks to https://api.siliconflow.cn via the
 * OpenAI SDK (SiliconFlow exposes an OpenAI-compatible REST surface).
 *
 * The provider owns the OpenAI client lifecycle and translates the
 * vendor-neutral `ILLMProvider` shapes to/from the SDK's payloads.
 * Tests inject a mock `client` so they never touch the network.
 */

import OpenAI from 'openai';

import type {
  ILLMProvider,
  LlmChatRequest,
  LlmChatResponse,
  LlmFinishReason,
  LlmMessage,
  LlmStreamEvent,
  LlmToolCall,
  LlmToolChoice,
  LlmToolDefinition,
  LlmUsage,
} from './base.js';
import type { AppLogger } from '../../../config/logger.js';

export interface SiliconFlowOptions {
  apiKey: string;
  /** Defaults to https://api.siliconflow.cn/v1 via env. */
  baseURL: string;
  model: string;
  timeoutMs?: number;
  /** Logger for non-fatal warnings (unknown finish reasons, etc.). */
  logger: AppLogger;
  /** DI seam for tests. When omitted, a real OpenAI client is built. */
  client?: OpenAIChatClient;
}

/**
 * Minimal shape of the OpenAI SDK that we actually call. Declared as
 * a Pick<> so tests can pass a hand-rolled mock without satisfying
 * the full SDK surface.
 */
export type OpenAIChatClient = Pick<OpenAI, 'chat'>;

const FINISH_REASON_MAP: Record<string, LlmFinishReason> = {
  stop: 'stop',
  tool_calls: 'tool_calls',
  length: 'length',
  content_filter: 'content_filter',
};

const mapFinishReason = (raw: string | null | undefined): LlmFinishReason => {
  if (!raw) return 'unknown';
  return FINISH_REASON_MAP[raw] ?? 'unknown';
};

const toOpenAiMessages = (
  messages: LlmMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] =>
  messages.map((message): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
    if (message.role === 'system') {
      return { role: 'system', content: message.content };
    }
    if (message.role === 'user') {
      return { role: 'user', content: message.content };
    }
    if (message.role === 'assistant') {
      const out: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: message.content,
      };
      if (message.toolCalls && message.toolCalls.length > 0) {
        out.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsJson },
        }));
      }
      return out;
    }
    // role === 'tool'
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  });

const toOpenAiTools = (
  tools: LlmToolDefinition[] | undefined,
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined => {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema,
    },
  }));
};

const toOpenAiToolChoice = (
  choice: LlmToolChoice | undefined,
): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined => {
  if (!choice) return undefined;
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice;
  return { type: 'function', function: { name: choice.name } };
};

const extractToolCalls = (
  raw: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
): LlmToolCall[] => {
  if (!raw || raw.length === 0) return [];
  const out: LlmToolCall[] = [];
  for (const call of raw) {
    if (call.type !== 'function' || !call.function) continue;
    out.push({
      id: call.id,
      name: call.function.name,
      argumentsJson: call.function.arguments ?? '',
    });
  }
  return out;
};

const extractUsage = (
  raw: OpenAI.Completions.CompletionUsage | undefined | null,
): LlmUsage | undefined => {
  if (!raw) return undefined;
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
  };
};

/**
 * Re-throw a sanitised Error so the original OpenAI SDK error
 * shape — which can carry the request `headers` (Authorization
 * bearer included) and the request `body` — never reaches downstream
 * audit logs, response bodies, or pino's serializer.
 *
 * The new Error preserves only the message, status, and code fields
 * the orchestrator's audit pipeline already truncates. The original
 * error stays accessible via `.cause` for pino's local stderr but
 * never escapes the process via `.stack` of the original instance.
 */
const sanitiseSiliconFlowError = (error: unknown): Error => {
  const sourceMessage = error instanceof Error ? error.message : String(error);
  const safeMessage = (sourceMessage || 'siliconflow request failed').slice(0, 500);
  const sanitised = new Error(safeMessage);
  sanitised.name = 'SiliconFlowProviderError';
  // Preserve common metadata if present on the original APIError shape
  // (without preserving the raw object → no headers leak).
  if (typeof error === 'object' && error !== null) {
    const src = error as { status?: unknown; code?: unknown };
    if (typeof src.status === 'number') {
      (sanitised as { status?: number }).status = src.status;
    }
    if (typeof src.code === 'string') {
      (sanitised as { code?: string }).code = src.code;
    }
  }
  return sanitised;
};

export class SiliconFlowProvider implements ILLMProvider {
  readonly providerName = 'siliconflow';
  readonly model: string;
  readonly supportsToolCalling = true;

  private readonly client: OpenAIChatClient;
  private readonly logger: AppLogger;

  constructor(private readonly opts: SiliconFlowOptions) {
    this.model = opts.model;
    this.logger = opts.logger;
    this.client =
      opts.client ??
      new OpenAI({
        apiKey: opts.apiKey,
        baseURL: opts.baseURL,
        timeout: opts.timeoutMs ?? 30_000,
      });
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    let completion;
    try {
      completion = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: toOpenAiMessages(req.messages),
          tools: toOpenAiTools(req.tools),
          tool_choice: toOpenAiToolChoice(req.toolChoice),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
        },
        // The OpenAI SDK threads `signal` through fetch + the streaming
        // iterator, so aborting cancels the in-flight HTTP request and
        // any further chunks. Omitting the second arg keeps the SDK on
        // its default options.
        req.signal ? { signal: req.signal } : undefined,
      );
    } catch (error) {
      // OpenAI APIError shapes can carry the request `headers` field
      // verbatim (including our `Authorization: Bearer ...`) and the
      // request body. Re-throw a sanitised Error so downstream
      // audit / log paths can't accidentally leak the bearer token.
      throw sanitiseSiliconFlowError(error);
    }

    const choice = completion.choices?.[0];
    if (!choice) {
      this.logger.warn(
        { requestId: req.requestId, model: this.model },
        'siliconflow chat: empty choices',
      );
      return {
        content: null,
        toolCalls: [],
        finishReason: 'unknown',
        usage: extractUsage(completion.usage),
      };
    }

    return {
      content: choice.message.content ?? null,
      toolCalls: extractToolCalls(choice.message.tool_calls),
      finishReason: mapFinishReason(choice.finish_reason),
      usage: extractUsage(completion.usage),
    };
  }

  async *chatStream(req: LlmChatRequest): AsyncIterable<LlmStreamEvent> {
    let stream;
    try {
      stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: toOpenAiMessages(req.messages),
          tools: toOpenAiTools(req.tools),
          tool_choice: toOpenAiToolChoice(req.toolChoice),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
        },
        req.signal ? { signal: req.signal } : undefined,
      );
    } catch (error) {
      throw sanitiseSiliconFlowError(error);
    }

    let finishEmitted = false;

    for await (const chunk of stream) {
      // The OpenAI SDK's `signal` plumbing eventually breaks the
      // iterator, but on some transports the in-flight chunk lands
      // before the abort propagates. A second check here makes the
      // cancel deterministic — we stop iterating immediately and let
      // the orchestrator finalise without burning more tokens.
      if (req.signal?.aborted) break;
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta ?? {};

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        yield { type: 'text_delta', text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            type: 'tool_call_delta',
            index: tc.index,
            id: tc.id,
            name: tc.function?.name,
            argumentsJson: tc.function?.arguments,
          };
        }
      }

      if (choice.finish_reason) {
        finishEmitted = true;
        yield {
          type: 'finish',
          finishReason: mapFinishReason(choice.finish_reason),
          usage: extractUsage(chunk.usage),
        };
      }
    }

    if (!finishEmitted) {
      yield { type: 'finish', finishReason: 'unknown' };
    }
  }
}
