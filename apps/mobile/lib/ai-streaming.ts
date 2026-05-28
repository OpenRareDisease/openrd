/**
 * SSE client for `POST /api/ai/ask/stream`.
 *
 * React Native's built-in fetch doesn't have reliable streaming
 * support across iOS / Android / Hermes / new architecture, so we
 * lean on `react-native-sse` — it ships a custom EventSource impl
 * that uses XHR under the hood and supports custom HTTP method +
 * request body (regular EventSource only does GET, which we can't
 * use because /ask/stream needs the question in the body).
 *
 * The parser part is exported separately so unit tests can pin the
 * frame → AiStreamEvent mapping without spinning up a real SSE
 * connection.
 */

import EventSource from 'react-native-sse';

import {
  type AiAskResponse,
  type StreamAiQuestionCallbacks,
  type StreamAiQuestionHandle,
  getAuthToken,
} from './api';
import { AI_STREAM_EVENT_TYPES, parseAiStreamFrame } from './ai-streaming-parser';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// Re-export the parser for the screen tests / future consumers
// without forcing them to know the file split.
export { parseAiStreamFrame } from './ai-streaming-parser';

/**
 * Open an SSE stream for one AI question. Returns a handle the
 * caller can close to abort mid-stream (e.g. user navigates away).
 *
 * Auth header is fetched fresh per call so a token rotation between
 * questions doesn't strand a stale token in the connection.
 *
 * Error handling layers:
 *   - Transport errors (no network, 5xx before first frame) → onError
 *   - Mid-stream `error` SSE frame from the orchestrator → onEvent +
 *     onComplete(null)
 *   - Clean termination after `done` → onEvent(done) + onComplete(data)
 */
export const streamAiQuestion = (
  question: string,
  progressId: string,
  callbacks: StreamAiQuestionCallbacks,
): StreamAiQuestionHandle => {
  let closed = false;
  let doneData: AiAskResponse['data'] | null = null;
  let es: EventSource | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (es) {
      es.close();
      es = null;
    }
  };

  (async () => {
    const token = await getAuthToken();
    if (closed) return;

    es = new EventSource(`${API_BASE_URL}/ai/ask/stream`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ question, progressId }),
      // Don't auto-reconnect mid-stream — a dropped connection
      // means the orchestrator either finished and we missed the
      // tail, or errored. Re-opening would start a brand-new run
      // and double-bill tokens.
      pollingInterval: 0,
    });

    // react-native-sse's `addEventListener('message', ...)` only
    // fires for frames WITHOUT a named `event:` line. Our backend
    // names every frame (`event: planning`, etc.), so we register a
    // listener per known type. Unknown names are dropped on the
    // floor — they'd be a backend bug we want to surface, not
    // silently propagate.
    for (const type of AI_STREAM_EVENT_TYPES) {
      es.addEventListener(type as unknown as 'message', (rawEvent) => {
        if (closed) return;
        const frameData =
          rawEvent && typeof rawEvent === 'object' && 'data' in rawEvent
            ? String((rawEvent as { data: string | null }).data ?? '')
            : '';
        const parsed = parseAiStreamFrame(type, frameData);
        if (!parsed) return;
        callbacks.onEvent(parsed);
        if (parsed.type === 'done') {
          doneData = parsed.data;
          cleanup();
          callbacks.onComplete(doneData);
        } else if (parsed.type === 'error') {
          cleanup();
          callbacks.onComplete(null);
        }
      });
    }

    es.addEventListener('error', (event) => {
      if (closed) return;
      // react-native-sse fires this for both transport-level
      // failures and HTTP non-2xx responses. We don't distinguish
      // — both go through onError and the caller shows the same
      // "AI 服务暂时不可用" copy.
      const message =
        event && typeof event === 'object' && 'message' in event
          ? String((event as { message: string }).message)
          : 'stream transport error';
      cleanup();
      callbacks.onError(new Error(message));
    });

    es.addEventListener('close', () => {
      if (closed) return;
      // EventSource closed without a `done` or `error` frame — the
      // server hung up unexpectedly. Treat as completion with no
      // result so the UI doesn't get stuck in "loading" forever.
      cleanup();
      callbacks.onComplete(null);
    });
  })().catch((err) => {
    cleanup();
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  });

  return {
    close: cleanup,
  };
};
