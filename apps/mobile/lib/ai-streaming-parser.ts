/**
 * Pure SSE frame parser for the AI streaming endpoint. Split out of
 * `ai-streaming.ts` so jest can test the parsing logic without
 * dragging in `react-native-sse` (which doesn't import cleanly in
 * Node) or the rest of `api.ts`'s runtime imports (AsyncStorage,
 * fetch).
 *
 * The runtime SSE client in `ai-streaming.ts` imports from this
 * module too — single source of truth for the event-name list and
 * the parse rule.
 */

import type { AiStreamEvent } from './api';

/** Every OrchestratorEvent type the backend can emit. Used both as
 *  the runtime list for EventSource listener registration and as
 *  the allowlist for the parser. Keep in sync with the backend's
 *  `OrchestratorEvent` union (apps/api/src/modules/ai-agents/
 *  orchestrator/types.ts). */
export const AI_STREAM_EVENT_TYPES = [
  'planning',
  'plan_complete',
  'tool_start',
  'tool_complete',
  'context_built',
  'answering',
  'answer_delta',
  'done',
  'error',
] as const;

export type AiStreamEventName = (typeof AI_STREAM_EVENT_TYPES)[number];

/**
 * Parse one SSE frame's `data:` JSON payload into a typed
 * AiStreamEvent. The frame's event name comes in separately
 * (EventSource exposes it as `event.type`) so this helper takes the
 * name explicitly.
 *
 * Returns `null` when:
 *   - the event name is one we don't recognise
 *   - the payload isn't valid JSON
 *   - the payload doesn't carry a `type` field (defensive: the
 *     backend always sets it, but a malformed proxy injection could
 *     drop it)
 *   - the payload's `type` doesn't match the SSE event name (forged
 *     / proxy-injected frame)
 */
export const parseAiStreamFrame = (eventName: string, rawData: string): AiStreamEvent | null => {
  if (!AI_STREAM_EVENT_TYPES.includes(eventName as AiStreamEventName)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== 'string' || obj.type !== eventName) return null;
  // Trust the shape from this point — backend authored the JSON
  // and we already validated `type` matches the SSE event name.
  return parsed as AiStreamEvent;
};
