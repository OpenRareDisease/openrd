/**
 * LLM provider contract used by the orchestrator.
 *
 * The orchestrator's planner / executor / final-answer stages all talk
 * through this interface so that swapping SiliconFlow for another
 * OpenAI-compatible vendor (or a local model) is a one-line factory
 * change — no code in `orchestrator/` knows about `openai` SDK types
 * or HTTP details.
 *
 * The shape is deliberately close to OpenAI Chat Completions because
 * that's what every modern provider implements; mapping to it from
 * Anthropic / Google would be a thin adapter in another impl file.
 *
 * Tool calling is modelled explicitly:
 *   - `LlmToolDefinition` is what the planner advertises.
 *   - `LlmToolCall` is what the model returns when it wants to call one.
 *   - `LlmToolMessage` is how the executor feeds the result back in
 *     the next round of `chat()`.
 *
 * Streaming events are exposed via `chatStream` for the final-answer
 * stage so the route can flush SSE to the client without waiting for
 * the full body.
 */

export type LlmFinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown';

export interface LlmSystemMessage {
  role: 'system';
  content: string;
}

export interface LlmUserMessage {
  role: 'user';
  content: string;
}

export interface LlmAssistantMessage {
  role: 'assistant';
  /** May be null when the assistant only emitted tool calls. */
  content: string | null;
  toolCalls?: LlmToolCall[];
}

/**
 * Result of a single tool execution fed back to the model. Must
 * reference the originating `toolCallId` so OpenAI-compatible
 * providers can pair it with the prior assistant turn.
 */
export interface LlmToolMessage {
  role: 'tool';
  toolCallId: string;
  /** Tool name for providers that require it alongside the id. */
  name: string;
  /** Stringified payload the model will read. JSON is conventional
   *  but anything text-shaped is allowed. */
  content: string;
}

export type LlmMessage = LlmSystemMessage | LlmUserMessage | LlmAssistantMessage | LlmToolMessage;

/**
 * A single tool call the model wants the executor to run. The
 * arguments arrive as a JSON string per the OpenAI protocol; callers
 * must `JSON.parse` after validating against the tool's schema.
 */
export interface LlmToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

/**
 * Tool advertised to the model. `parametersSchema` is a JSON Schema
 * object describing the call signature. Kept loosely typed because
 * JSON Schema is recursive and provider SDKs accept `Record<string,
 * unknown>` here anyway.
 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
}

export type LlmToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; name: string };

export interface LlmChatRequest {
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  toolChoice?: LlmToolChoice;
  temperature?: number;
  maxTokens?: number;
  /** Caller-provided correlation id, surfaced in logs. */
  requestId?: string;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmChatResponse {
  /** Final assistant text. Null when the model only emitted tool
   *  calls and produced no prose. */
  content: string | null;
  toolCalls: LlmToolCall[];
  finishReason: LlmFinishReason;
  usage?: LlmUsage;
}

/**
 * Streaming event produced by `chatStream`. Three shapes:
 *
 *   - `text_delta` — append `text` to the assistant message.
 *   - `tool_call_delta` — accumulate a tool call by `index`. The
 *     first delta for an index carries `id` + `name`; subsequent
 *     ones carry incremental `argumentsJson` fragments.
 *   - `finish` — terminal event with `finishReason` + optional
 *     `usage`. No further events follow.
 */
export type LlmStreamEvent =
  | { type: 'text_delta'; text: string }
  | {
      type: 'tool_call_delta';
      index: number;
      id?: string;
      name?: string;
      argumentsJson?: string;
    }
  | { type: 'finish'; finishReason: LlmFinishReason; usage?: LlmUsage };

export interface ILLMProvider {
  /** Vendor identifier, e.g. `siliconflow`. Recorded in audit. */
  readonly providerName: string;
  /** Model id passed to the vendor, e.g. `deepseek-ai/DeepSeek-V3`. */
  readonly model: string;
  /** Whether this provider supports OpenAI-style function calling.
   *  The orchestrator's planner refuses to advertise tools when this
   *  is false. */
  readonly supportsToolCalling: boolean;

  chat(req: LlmChatRequest): Promise<LlmChatResponse>;
  chatStream(req: LlmChatRequest): AsyncIterable<LlmStreamEvent>;
}
