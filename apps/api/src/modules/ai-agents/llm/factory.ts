/**
 * Factory that builds the configured LLM provider from env.
 *
 * Returning `null` is a first-class outcome: when the operator hasn't
 * set an API key, `/api/ai/ask` must short-circuit with a clear "AI
 * not configured" response rather than crash. The orchestrator and
 * route both honour that contract.
 *
 * Adding a vendor: branch on a new `AI_PROVIDER` env var here and
 * return its implementation. The interface guarantees the
 * orchestrator stays untouched.
 */

import type { ILLMProvider } from './base.js';
import { SiliconFlowProvider } from './siliconflow.js';
import type { AppEnv } from '../../../config/env.js';
import type { AppLogger } from '../../../config/logger.js';

export const createLlmProvider = (env: AppEnv, logger: AppLogger): ILLMProvider | null => {
  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY || '';
  if (!apiKey) {
    logger.warn('LLM provider disabled: AI_API_KEY / OPENAI_API_KEY missing');
    return null;
  }

  return new SiliconFlowProvider({
    apiKey,
    baseURL: env.AI_API_BASE_URL,
    model: env.AI_API_MODEL,
    timeoutMs: env.AI_API_TIMEOUT,
    logger,
  });
};
