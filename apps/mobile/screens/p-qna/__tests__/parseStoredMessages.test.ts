import { type ChatMessage, buildHistoryPayload, parseStoredMessages } from '../chat-storage';

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

describe('buildHistoryPayload', () => {
  const msg = (overrides: Partial<ChatMessage>): ChatMessage => ({
    id: 'm1',
    role: 'user',
    content: '内容',
    createdAt: '2026-07-14T08:00:00.000Z',
    status: 'sent',
    ...overrides,
  });

  it('replays only sent, non-welcome, non-divider messages from the current epoch', () => {
    const payload = buildHistoryPayload(
      [
        msg({ id: 'welcome', role: 'assistant', content: '欢迎' }),
        msg({ id: 'u1', content: '第一问', epoch: 1 }),
        msg({ id: 'a1', role: 'assistant', content: '第一答', epoch: 1 }),
        msg({ id: 'err', role: 'assistant', content: '出错了', status: 'error', epoch: 1 }),
        msg({ id: 'load', role: 'assistant', content: '加载中', status: 'loading', epoch: 1 }),
        msg({ id: 'div', role: 'assistant', content: '设置已变更', systemDivider: true, epoch: 1 }),
        msg({ id: 'old', content: '旧纪元的问题', epoch: 0 }),
      ],
      1,
    );
    expect(payload).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
    ]);
  });

  it('treats epoch-less legacy messages as epoch 0', () => {
    const legacy = [msg({ id: 'u0', content: '旧消息' })];
    expect(buildHistoryPayload(legacy, 0)).toHaveLength(1);
    expect(buildHistoryPayload(legacy, 1)).toHaveLength(0);
  });

  it('caps the payload at the newest 12 messages', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      msg({ id: `m${i}`, content: `第${i}条`, epoch: 0 }),
    );
    const payload = buildHistoryPayload(many, 0);
    expect(payload).toHaveLength(12);
    expect(payload[11].content).toBe('第19条');
  });
});
