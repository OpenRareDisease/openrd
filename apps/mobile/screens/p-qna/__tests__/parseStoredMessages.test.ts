import { parseStoredMessages } from '../chat-storage';

const validMessage = {
  id: 'assistant_1',
  role: 'assistant',
  content: '你好',
  createdAt: '2026-07-14T08:00:00.000Z',
  status: 'sent',
};

describe('parseStoredMessages hydration guards', () => {
  it('returns null for null / malformed JSON / non-array payloads', () => {
    expect(parseStoredMessages(null)).toBeNull();
    expect(parseStoredMessages('not-json{')).toBeNull();
    expect(parseStoredMessages(JSON.stringify({ id: 'x' }))).toBeNull();
    expect(parseStoredMessages(JSON.stringify([]))).toBeNull();
  });

  it('passes valid entries through, dropping entries missing core fields', () => {
    const parsed = parseStoredMessages(
      JSON.stringify([validMessage, { id: 'broken' }, null, 'string-entry']),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].id).toBe('assistant_1');
  });

  it('keeps failedQuestion only when it is a string', () => {
    const parsed = parseStoredMessages(
      JSON.stringify([
        { ...validMessage, id: 'a', status: 'error', failedQuestion: '重新问这个' },
        { ...validMessage, id: 'b', status: 'error', failedQuestion: 12345 },
        { ...validMessage, id: 'c', status: 'error', failedQuestion: { q: 'obj' } },
      ]),
    );
    expect(parsed?.map((m) => m.failedQuestion)).toEqual(['重新问这个', undefined, undefined]);
  });

  it('keeps consentRequired only when it is literally true', () => {
    const parsed = parseStoredMessages(
      JSON.stringify([
        { ...validMessage, id: 'a', status: 'error', consentRequired: true },
        // Truthy-but-not-true values must be dropped — the consent
        // card must never render off a corrupted flag.
        { ...validMessage, id: 'b', status: 'error', consentRequired: 1 },
        { ...validMessage, id: 'c', status: 'error', consentRequired: 'yes' },
        { ...validMessage, id: 'd', status: 'error', consentRequired: false },
      ]),
    );
    expect(parsed?.map((m) => m.consentRequired)).toEqual([true, undefined, undefined, undefined]);
  });
});
