/**
 * Planner — round 1 of the tool-calling loop.
 *
 * Sends the system prompt + user question to the LLM with the
 * consent-filtered tool list advertised, and returns whatever the
 * model picks: either a list of tool calls or a direct text answer.
 *
 * The planner never executes a tool. The executor does that next.
 * Keeping the split sharp means the executor can apply per-tool
 * timeouts, error capture and ordering without the planner's LLM
 * call being a confounding variable.
 */

import type { AppLogger } from '../../../config/logger.js';
import type { ILLMProvider, LlmChatResponse, LlmMessage, LlmToolDefinition } from '../llm/base.js';
import type { ITool } from '../tools/base.js';

export interface PlanInput {
  systemPrompt: string;
  userPrompt: string;
  /** Normalized prior turns (see security/history.ts), replayed as
   *  plain text messages between the system prompt and the current
   *  question so the model can resolve references like「那我需要复查
   *  吗」. Already scrubbed + budgeted by the route layer. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: ITool[];
  requestId: string;
  /** Forwarded to the LLM so a client disconnect cancels round 1. */
  signal?: AbortSignal;
}

export interface PlanResult {
  /** Whatever the LLM returned. The orchestrator inspects
   *  `toolCalls` to decide whether to run the executor. */
  llmResponse: LlmChatResponse;
  /** Messages submitted to the LLM, returned so the run loop can
   *  reuse them as the prefix for round 2 without re-buying them. */
  messages: LlmMessage[];
}

const toLlmTool = (tool: ITool): LlmToolDefinition => ({
  name: tool.name,
  description: tool.description,
  parametersSchema: tool.parametersSchema,
});

export class Planner {
  constructor(
    private readonly llm: ILLMProvider,
    private readonly logger: AppLogger,
  ) {}

  async plan(input: PlanInput): Promise<PlanResult> {
    // History turns replay as plain text (no toolCalls): the OpenAI-
    // compatible protocol accepts prior assistant messages verbatim,
    // and because round 2 builds on `plan.messages`, the history
    // automatically reaches the final-answer call and the audit hash
    // (serializeMessageForHash walks every message) with no extra
    // plumbing.
    const messages: LlmMessage[] = [
      { role: 'system', content: input.systemPrompt },
      ...(input.history ?? []).map(
        (turn): LlmMessage => ({ role: turn.role, content: turn.content }),
      ),
      { role: 'user', content: input.userPrompt },
    ];

    const useTools = this.llm.supportsToolCalling && input.tools.length > 0;
    const tools = useTools ? input.tools.map(toLlmTool) : undefined;

    const llmResponse = await this.llm.chat({
      messages,
      tools,
      toolChoice: useTools ? 'auto' : undefined,
      temperature: 0.2,
      maxTokens: 800,
      requestId: input.requestId,
      signal: input.signal,
    });

    this.logger.debug(
      {
        requestId: input.requestId,
        toolsAdvertised: tools?.map((t) => t.name) ?? [],
        toolCallsReturned: llmResponse.toolCalls.map((c) => c.name),
        finishReason: llmResponse.finishReason,
      },
      'planner round 1 complete',
    );

    return { llmResponse, messages };
  }
}
