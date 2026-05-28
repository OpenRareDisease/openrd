/**
 * Tests for the streaming module's pure pieces — frame parser +
 * SSE-error → ApiError conversion. The full EventSource wiring is
 * deferred to a manual smoke check; faithfully simulating
 * react-native-sse's state machine in jest is more setup than it
 * earns.
 */

// Mock the native modules before any import that transitively
// requires the api module (which uses AsyncStorage).
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('react-native-sse', () => ({
  __esModule: true,
  default: class FakeEventSource {
    addEventListener = jest.fn();
    close = jest.fn();
  },
}));

// eslint-disable-next-line import/first
import { parseAiStreamFrame } from '../ai-streaming-parser';
// eslint-disable-next-line import/first
import { sseErrorToApiError } from '../ai-streaming';
// eslint-disable-next-line import/first
import { ApiError, isConsentRequiredError } from '../api';

describe('parseAiStreamFrame', () => {
  it('returns null for an unknown event name', () => {
    // Defensive: a future backend frame type we haven't shipped
    // mobile support for yet, or proxy / man-in-the-middle
    // injection. Drop silently instead of throwing.
    expect(parseAiStreamFrame('mystery_event', '{"type":"mystery_event"}')).toBeNull();
  });

  it('returns null when the data is not valid JSON', () => {
    expect(parseAiStreamFrame('answer_delta', 'not json {{')).toBeNull();
  });

  it('returns null when the parsed payload is not an object', () => {
    expect(parseAiStreamFrame('answer_delta', '"a string"')).toBeNull();
    expect(parseAiStreamFrame('answer_delta', '42')).toBeNull();
    expect(parseAiStreamFrame('answer_delta', 'null')).toBeNull();
  });

  it('returns null when the payload type does not match the SSE event name', () => {
    // The two should always agree — backend serialiser writes them
    // from the same OrchestratorEvent object. A mismatch means
    // someone is forging frames; refuse to interpret.
    expect(parseAiStreamFrame('answer_delta', '{"type":"done","data":{}}')).toBeNull();
  });

  it('parses a simple stage event (planning) with no payload fields', () => {
    expect(parseAiStreamFrame('planning', '{"type":"planning"}')).toEqual({ type: 'planning' });
  });

  it('parses plan_complete with the toolsPlanned array', () => {
    const out = parseAiStreamFrame(
      'plan_complete',
      '{"type":"plan_complete","toolsPlanned":["search_medical_kb","get_my_profile"]}',
    );
    expect(out).toEqual({
      type: 'plan_complete',
      toolsPlanned: ['search_medical_kb', 'get_my_profile'],
    });
  });

  it('parses answer_delta carrying the incremental text', () => {
    const out = parseAiStreamFrame('answer_delta', '{"type":"answer_delta","text":"你好"}');
    expect(out).toEqual({ type: 'answer_delta', text: '你好' });
  });

  it('parses tool_complete including an optional error string', () => {
    const out = parseAiStreamFrame(
      'tool_complete',
      '{"type":"tool_complete","tool":"x","toolCallId":"c1","chunkCount":0,"error":"timed out"}',
    );
    expect(out).toEqual({
      type: 'tool_complete',
      tool: 'x',
      toolCallId: 'c1',
      chunkCount: 0,
      error: 'timed out',
    });
  });

  it('parses the done frame carrying the narrowed AiAskResponse data', () => {
    // Pin that the parser does NOT try to revalidate the inner
    // `data` shape — that's the server's contract. The screen will
    // consume it as AiAskResponse['data'].
    const out = parseAiStreamFrame(
      'done',
      JSON.stringify({
        type: 'done',
        data: {
          question: 'q',
          answer: 'a',
          citations: [],
          toolCalls: [],
          fieldsUsed: [],
          usedPersonalData: false,
          consentLevel: 'basic',
          redactionMode: 'strict',
          latencyMs: 100,
          auditId: 'aud-1',
          progressId: 'p-1',
          timestamp: '2026-05-28T00:00:00Z',
        },
      }),
    );
    expect(out?.type).toBe('done');
    if (out?.type === 'done') {
      expect(out.data.answer).toBe('a');
      expect(out.data.auditId).toBe('aud-1');
    }
  });

  it('parses the error frame', () => {
    const out = parseAiStreamFrame('error', '{"type":"error","message":"upstream LLM blew up"}');
    expect(out).toEqual({ type: 'error', message: 'upstream LLM blew up' });
  });
});

describe('sseErrorToApiError', () => {
  it('returns a generic Error for null / non-object events', () => {
    expect(sseErrorToApiError(null).message).toBe('stream transport error');
    expect(sseErrorToApiError(undefined).message).toBe('stream transport error');
    expect(sseErrorToApiError('a string').message).toBe('stream transport error');
  });

  it('returns a plain Error (no .status) for transport / exception events', () => {
    // react-native-sse fires `type: exception` with no xhrStatus
    // when the socket itself fails (DNS, no network, TLS).
    const event = { type: 'exception', message: 'Network request failed' };
    const out = sseErrorToApiError(event);
    expect(out).toBeInstanceOf(Error);
    expect(out).not.toBeInstanceOf(ApiError);
    expect(out.message).toBe('Network request failed');
  });

  it('preserves HTTP status + parses JSON body for non-2xx pre-stream responses', () => {
    // The 403 consent_required path: bot finding said this branch
    // was losing the body and breaking the screen's
    // isConsentRequiredError check. Pin the conversion.
    const event = {
      type: 'error',
      xhrStatus: 403,
      message: JSON.stringify({
        success: false,
        code: 'consent_required',
        message: '请先在隐私设置中同意 AI 使用你的数据',
        consent: { level: 'none', flags: {} },
        progressId: 'p-1',
      }),
    };
    const out = sseErrorToApiError(event);
    expect(out).toBeInstanceOf(ApiError);
    const apiErr = out as ApiError;
    expect(apiErr.status).toBe(403);
    expect((apiErr.data as { code?: string })?.code).toBe('consent_required');
  });

  it('lets the screens helper isConsentRequiredError(error) match again', () => {
    // The point of this whole conversion: the existing consent
    // detection helper in api.ts must continue to recognise the
    // streaming-path 403 the way it did the non-streaming one.
    const event = {
      type: 'error',
      xhrStatus: 403,
      message:
        '{"code":"consent_required","message":"x","consent":{"level":"none","flags":{}},"progressId":"p-1","success":false}',
    };
    const out = sseErrorToApiError(event);
    expect(isConsentRequiredError(out)).toBe(true);
  });

  it('keeps the raw string when message is a non-JSON HTTP body', () => {
    const event = { type: 'error', xhrStatus: 500, message: 'Internal Server Error' };
    const out = sseErrorToApiError(event);
    expect(out).toBeInstanceOf(ApiError);
    expect((out as ApiError).status).toBe(500);
    expect(out.message).toBe('Internal Server Error');
    expect((out as ApiError).data).toBeNull();
  });

  it('accepts an already-parsed object as message', () => {
    // Some react-native-sse versions pre-parse JSON bodies into an
    // object before dispatching. Handle that shape too.
    const event = {
      type: 'error',
      xhrStatus: 503,
      message: { error: 'LLM provider unavailable' },
    };
    const out = sseErrorToApiError(event);
    expect(out).toBeInstanceOf(ApiError);
    expect((out as ApiError).status).toBe(503);
    expect((out as ApiError).data).toEqual({ error: 'LLM provider unavailable' });
    expect(out.message).toBe('LLM provider unavailable');
  });
});
