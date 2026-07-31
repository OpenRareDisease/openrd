import { describe, expect, it, vi } from 'vitest';

import { draftLogFromText, EMPTY_DRAFT } from './draft-log.js';
import type { AppLogger } from '../../../config/logger.js';
import type { ILLMProvider } from '../llm/base.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as AppLogger;

const llmReturning = (content: string): ILLMProvider =>
  ({
    providerName: 'fake',
    model: 'fake-1',
    chat: vi.fn().mockResolvedValue({ content, toolCalls: [], usage: undefined }),
    chatStream: vi.fn(),
  }) as unknown as ILLMProvider;

const draft = (content: string) =>
  draftLogFromText('今天上楼特别费劲', {
    llm: llmReturning(content),
    logger: silentLogger,
    requestId: 'req-1',
  });

describe('draftLogFromText', () => {
  it('extracts a followup draft', async () => {
    const result = await draft(
      JSON.stringify({
        understanding: '上楼费劲，用了 15 秒',
        followup: { stairClimbSeconds: 15, sleepScore: null, fallCount: null, activityNote: null },
        event: null,
      }),
    );

    expect(result.followup?.stairClimbSeconds).toBe(15);
    expect(result.event).toBeNull();
    expect(result.understanding).toBe('上楼费劲，用了 15 秒');
  });

  it('tolerates the markdown fences models add despite being told not to', async () => {
    const result = await draft('```json\n{"followup":{"fallCount":2},"event":null}\n```');
    expect(result.followup?.fallCount).toBe(2);
  });

  it('drops an out-of-range value instead of clamping it', async () => {
    // A clamped number is indistinguishable from one the patient
    // actually said. Better a blank field than an invented measurement
    // in a progression record.
    const result = await draft(JSON.stringify({ followup: { sleepScore: 99, fallCount: 1 } }));

    expect(result.followup?.sleepScore).toBeNull();
    expect(result.followup?.fallCount).toBe(1);
  });

  it('keeps a good field when a sibling field is garbage', async () => {
    const result = await draft(
      JSON.stringify({ followup: { stairClimbSeconds: 'twelve', fallCount: 1 } }),
    );

    expect(result.followup?.stairClimbSeconds).toBeNull();
    expect(result.followup?.fallCount).toBe(1);
  });

  it('returns nothing rather than an empty card when no values were found', async () => {
    const result = await draft(
      JSON.stringify({
        understanding: '没说具体数值',
        followup: {
          stairClimbSeconds: null,
          sleepScore: null,
          fallCount: null,
          activityNote: null,
        },
        event: null,
      }),
    );

    expect(result.followup).toBeNull();
  });

  it('nulls an unknown event type instead of relabelling it「其他」', async () => {
    // 'other'/'moderate' here would be a value the client cannot tell
    // apart from a real classification, so it would overwrite the type
    // and severity the patient picked by hand. The rest of the event
    // still survives — one bad field costs that field only.
    const result = await draft(
      JSON.stringify({
        event: {
          eventType: 'spontaneous_combustion',
          severity: 'catastrophic',
          occurredAt: '2026-07-30',
          description: '厨房里差点摔了',
        },
      }),
    );

    expect(result.event?.eventType).toBeNull();
    expect(result.event?.severity).toBeNull();
    expect(result.event?.description).toBe('厨房里差点摔了');
  });

  it('leaves the classification unset when the model omits it', async () => {
    // A missing key used to hit the same `.catch()` as a bad value, so
    // "said nothing" and "said 其他" arrived identical.
    const result = await draft(JSON.stringify({ event: { description: '昨天开始用踝足矫形器' } }));

    expect(result.event?.eventType).toBeUndefined();
    expect(result.event?.severity).toBeUndefined();
    expect(result.event?.description).toBe('昨天开始用踝足矫形器');
  });

  it('keeps a classification the model did get right', async () => {
    const result = await draft(
      JSON.stringify({ event: { eventType: 'fall', severity: 'severe' } }),
    );

    expect(result.event?.eventType).toBe('fall');
    expect(result.event?.severity).toBe('severe');
  });

  it('returns no event at all for an empty event object', async () => {
    // `{"event":{}}` validated into a complete-looking event, which the
    // client announced as「已填好下面的表单」and pre-filled with the
    // previous saved event's description — a hallucinated event wearing
    // last month's words.
    const result = await draft(JSON.stringify({ understanding: '没说事件', event: {} }));

    expect(result.event).toBeNull();
  });

  it('returns no event when every field of it was dropped', async () => {
    const result = await draft(
      JSON.stringify({
        event: {
          eventType: 'nonsense',
          severity: 'apocalyptic',
          occurredAt: '上周',
          description: '  ',
        },
      }),
    );

    expect(result.event).toBeNull();
  });

  it('refuses a guessed date', async () => {
    const result = await draft(
      JSON.stringify({ event: { eventType: 'fall', occurredAt: '上周二' } }),
    );
    expect(result.event?.occurredAt).toBeNull();
  });

  it('returns an empty draft when the model answers in prose', async () => {
    const result = await draft('我理解你今天上楼比较费劲，建议多休息。');
    expect(result).toEqual(EMPTY_DRAFT);
  });

  it('returns an empty draft when the model returns malformed JSON', async () => {
    const result = await draft('{"followup": {broken');
    expect(result).toEqual(EMPTY_DRAFT);
  });
});
