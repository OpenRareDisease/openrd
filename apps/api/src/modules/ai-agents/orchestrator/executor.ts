/**
 * Executor — runs the tool calls the planner picked, in parallel.
 *
 * Each call is independent (no tool reads another's output in this
 * round), so parallelisation is safe and the round-trip latency is
 * bounded by the slowest retriever. Failures are captured per call
 * so the orchestrator can feed an error string back to the model
 * via the tool message rather than failing the whole request.
 *
 * `ToolValidationError` (the model passed bad args) and any other
 * thrown error are both caught and surfaced through
 * `ExecutedToolCall.error`. The orchestrator decides whether to
 * loop, retry, or just compose the final answer with what it has.
 */

import type { LlmToolCall } from '../llm/base.js';
import type { RetrieveResult } from '../retrievers/base.js';
import type { ITool, ToolContext } from '../tools/base.js';
import { ToolValidationError } from '../tools/base.js';
import type { ToolRegistry } from '../tools/registry.js';

export interface ExecutedToolCall {
  toolCallId: string;
  toolName: string;
  /** Set when the tool ran successfully. */
  retrieval?: RetrieveResult;
  /** Short display string the orchestrator may show ("3 chunks"). */
  display: string;
  /** Set when validation or execution failed. */
  error?: string;
}

export interface ExecuteOptions {
  /** Per-tool wall-clock budget. Defaults to 30s. */
  timeoutMs?: number;
}

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const runSingle = async (
  call: LlmToolCall,
  tool: ITool | undefined,
  ctx: ToolContext,
  timeoutMs: number,
): Promise<ExecutedToolCall> => {
  if (!tool) {
    return {
      toolCallId: call.id,
      toolName: call.name,
      display: `unknown tool: ${call.name}`,
      error: `Unknown tool: ${call.name}`,
    };
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = tool.parseArgs(call.argumentsJson);
  } catch (error) {
    const message =
      error instanceof ToolValidationError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      toolCallId: call.id,
      toolName: call.name,
      display: `${call.name}: invalid args`,
      error: message,
    };
  }

  try {
    const result = await withTimeout(tool.execute(parsedArgs, ctx), timeoutMs, call.name);
    return {
      toolCallId: call.id,
      toolName: call.name,
      retrieval: result.retrieval,
      display: result.display,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logger.warn(
      { tool: call.name, toolCallId: call.id, error: message },
      'tool execution failed',
    );
    return {
      toolCallId: call.id,
      toolName: call.name,
      display: `${call.name}: error`,
      error: message,
    };
  }
};

export class Executor {
  constructor(private readonly registry: ToolRegistry) {}

  async executeAll(
    calls: LlmToolCall[],
    ctx: ToolContext,
    opts: ExecuteOptions = {},
  ): Promise<ExecutedToolCall[]> {
    if (calls.length === 0) return [];
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const promises = calls.map((call) =>
      runSingle(call, this.registry.get(call.name), ctx, timeoutMs),
    );
    return Promise.all(promises);
  }
}
