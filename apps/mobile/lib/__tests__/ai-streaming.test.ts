/**
 * Pure-function tests for the SSE frame parser. Tests the actual
 * EventSource wiring is deferred to a manual smoke check — mocking
 * `react-native-sse` faithfully would require simulating the
 * EventSource state machine, which is more setup than it earns.
 */

// Importing the pure parser file directly — no react-native-sse,
// no AsyncStorage, no fetch. Jest runs it in plain Node without
// any RN-runtime gymnastics.
import { parseAiStreamFrame } from '../ai-streaming-parser';

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
