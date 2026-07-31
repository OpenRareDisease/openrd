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
  API_BASE_URL,
  ApiError,
  type AiAskContext,
  type AiAskResponse,
  type StreamAiQuestionCallbacks,
  type StreamAiQuestionHandle,
  dispatchUnauthorized,
  extractApiErrorMessage,
  extractRetryAfterSeconds,
  getAuthToken,
} from './api';
import { AI_STREAM_EVENT_TYPES, parseAiStreamFrame } from './ai-streaming-parser';

/** Max idle time (no frames AND no keepalives) before we declare
 *  the stream truncated. The backend emits an `event: keepalive`
 *  frame every 5s, including during long awaits in the orchestrator
 *  (planner LLM up to 30s, tool execution up to 30s/call). So in a
 *  healthy run mobile sees activity at least every 5s, and 15s is
 *  3× that — enough margin to absorb GC pauses / OS scheduling
 *  jitter without trip­ping on legitimate slow stages, but short
 *  enough that a truly dead stream surfaces as 'error' before the
 *  user gives up. If you ever raise the backend KEEPALIVE_MS in
 *  ai-chat.routes.ts, raise this proportionally. */
const IDLE_TIMEOUT_MS = 15_000;

// Re-export the parser for the screen tests / future consumers
// without forcing them to know the file split.
export { parseAiStreamFrame } from './ai-streaming-parser';

/**
 * Decode the `message` field of a react-native-sse error event into
 * "parsed body + the string a patient should read".
 *
 * The field is either a string (raw HTTP body, or a plain transport
 * message) or an already-parsed object — some react-native-sse
 * versions parse JSON bodies for us. Those two shapes used to be
 * handled by two separate branches and only the object one bothered to
 * pull the human sentence out. So every pre-stream 4xx that arrived as
 * a string went into the answer bubble verbatim: a 429 read
 * `{"error":"AI 请求过于频繁，请稍后再试","details":{"retryAfterSeconds":37}}`
 * and a 404 read `{"success":false,"code":"context_not_found",...}`.
 * Keeping one decode path is what stops the two from drifting apart
 * again.
 */
const decodeSseErrorBody = (
  message: unknown,
  status: number | null,
): { data: unknown; display: string } => {
  let data: unknown = null;
  if (message && typeof message === 'object') {
    data = message;
  } else if (typeof message === 'string' && status !== null && status >= 400) {
    try {
      data = JSON.parse(message);
    } catch {
      // Not JSON (proxy error page, bare status text) — leave `data`
      // null and let the raw string serve as the display text.
    }
  }

  const display =
    extractApiErrorMessage(data) ??
    (typeof message === 'string' && message.trim() ? message : null) ??
    (status !== null ? `HTTP ${status}` : 'stream transport error');

  return { data, display };
};

/**
 * Convert a react-native-sse error event into something the rest of
 * the app can pattern-match. When the backend rejects the request
 * before opening the SSE channel (e.g. 403 consent_required, 401
 * expired token, 429 rate limit, 503 LLM not configured), the lib
 * fires its `error` event with `xhrStatus` + `message` carrying the
 * JSON body. We need to re-pack that as `ApiError` with `.status` and
 * parsed `.data` because:
 *
 *   - the screen's `isConsentRequiredError(error)` guard checks
 *     `error instanceof ApiError && error.status === 403 && error.data?.code === 'consent_required'`
 *   - without `.status` + parsed `.data`, that guard never matches,
 *     and consent-denied users fall into the generic error branch
 *     (no "去设置" CTA, possibly raw JSON shown in the bubble).
 *
 * Network / exception events (no `xhrStatus`) become a plain
 * `Error`, which the screen surfaces via `getFriendlyErrorMessage`.
 *
 * Exported so the unit test can pin the conversion rule without
 * standing up a real SSE connection.
 */
export const sseErrorToApiError = (rawEvent: unknown): Error => {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return new Error('stream transport error');
  }
  const evt = rawEvent as { xhrStatus?: number; message?: unknown };
  const status = typeof evt.xhrStatus === 'number' ? evt.xhrStatus : null;
  const { data, display } = decodeSseErrorBody(evt.message, status);

  if (status !== null) {
    const apiError = new ApiError(display);
    apiError.status = status;
    apiError.data = data;
    // Same field `apiRequest` fills in, so a 429 that arrives over SSE
    // and one that arrives over plain fetch are indistinguishable to
    // the UI rendering the countdown.
    apiError.retryAfterSeconds = extractRetryAfterSeconds(data);
    return apiError;
  }
  return new Error(display);
};

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
  opts?: {
    /** Prior turns for multi-turn follow-ups. The server normalizes
     *  (scrubs, truncates to its own budget) — this is best-effort
     *  context, never authoritative. */
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    /** The object on screen when the question was asked. The server
     *  validates ownership and turns it into a prompt hint; an invalid
     *  reference is a 4xx before the stream opens, never a silently
     *  context-free answer. */
    context?: AiAskContext;
  },
): StreamAiQuestionHandle => {
  let closed = false;
  let doneData: AiAskResponse['data'] | null = null;
  let es: EventSource | null = null;

  // Watchdog: react-native-sse with pollingInterval=0 does NOT emit
  // its `close` event when the server side cleanly EOFs without a
  // terminal frame. The bubble would sit in 'loading' forever. Reset
  // this timer on every received frame; if it fires we treat the
  // stream as truncated and call onComplete(null) so the UI flips
  // to error.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  const armIdleTimer = () => {
    cancelIdleTimer();
    idleTimer = setTimeout(() => {
      if (closed) return;
      cleanup();
      callbacks.onComplete(null);
    }, IDLE_TIMEOUT_MS);
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    cancelIdleTimer();
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
      body: JSON.stringify({
        question,
        progressId,
        ...(opts?.history?.length ? { history: opts.history } : {}),
        ...(opts?.context ? { context: opts.context } : {}),
      }),
      // Don't auto-reconnect mid-stream — a dropped connection
      // means the orchestrator either finished and we missed the
      // tail, or errored. Re-opening would start a brand-new run
      // and double-bill tokens.
      pollingInterval: 0,
    });

    // Start the idle watchdog as soon as the connection is set up;
    // the first frame (planning) usually arrives within a second.
    armIdleTimer();

    // Keepalive heartbeat from the backend. The server emits an
    // `event: keepalive\ndata: {}` frame every 5s — including
    // during long awaits inside the orchestrator (planner LLM up
    // to 30s, tool execution up to 30s/call) when no real event
    // would otherwise fire. We register a dedicated listener that
    // ONLY resets the watchdog and does NOT surface the event
    // upward (keepalive is purely a transport signal, not part of
    // the OrchestratorEvent union). Without this our 15s watchdog
    // would false-positive on healthy slow stages.
    es.addEventListener('keepalive' as unknown as 'message', () => {
      if (closed) return;
      armIdleTimer();
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
        // Live event = stream is healthy, reset the watchdog.
        armIdleTimer();
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
      cleanup();
      const err = sseErrorToApiError(event);
      // SSE 401 doesn't go through `apiRequest` so it bypasses the
      // global auto-logout that PR-Sec-6 wired into `apiRequest`.
      // Dispatch the same handler here so a stale token surfaces a
      // single source of truth: AuthContext clears local session and
      // bounces the user to login, instead of leaving them on a
      // half-rendered QnA screen.
      if (err instanceof ApiError && err.status === 401) {
        void dispatchUnauthorized();
      }
      callbacks.onError(err);
    });

    es.addEventListener('close', () => {
      if (closed) return;
      // react-native-sse fires `close` from its own .close() — so
      // this generally means our own cleanup ran. Still call
      // onComplete(null) defensively in case the lib's behaviour
      // changes in a future version and starts emitting close on
      // server EOF too; the watchdog covers today's truncation
      // case directly.
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
