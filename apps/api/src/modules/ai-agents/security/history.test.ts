import { describe, expect, it } from 'vitest';

import { normalizeHistory } from './history.js';
import { AppError } from '../../../utils/app-error.js';

const LIMITS = { maxMessages: 12, charBudget: 8000 };

describe('normalizeHistory', () => {
  it('absent/null history normalizes to empty (single-turn)', () => {
    expect(normalizeHistory(undefined, LIMITS)).toEqual({
      messages: [],
      charLength: 0,
      droppedCount: 0,
    });
    expect(normalizeHistory(null, LIMITS)).toEqual({
      messages: [],
      charLength: 0,
      droppedCount: 0,
    });
  });

  it('passes well-formed turns through in order', () => {
    const result = normalizeHistory(
      [
        { role: 'user', content: '肌酸激酶 800 说明什么？' },
        { role: 'assistant', content: '通常提示肌肉损伤……' },
      ],
      LIMITS,
    );
    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(result.droppedCount).toBe(0);
    expect(result.charLength).toBe(result.messages.reduce((sum, m) => sum + m.content.length, 0));
  });

  const invalidShapes: Array<[string, unknown]> = [
    ['non-array', { role: 'user', content: 'x' }],
    ['string entry', ['hello']],
    ['null entry', [null]],
    ['bad role', [{ role: 'system', content: 'x' }]],
    ['non-string content', [{ role: 'user', content: 42 }]],
    ['missing content', [{ role: 'user' }]],
  ];
  for (const [name, raw] of invalidShapes) {
    it(`rejects structurally invalid history (${name}) with a 400`, () => {
      try {
        normalizeHistory(raw, LIMITS);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(400);
      }
    });
  }

  it('silently keeps only the newest maxMessages turns', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn-${i}`,
    }));
    const result = normalizeHistory(raw, LIMITS);
    expect(result.messages).toHaveLength(12);
    expect(result.messages[0].content).toBe('turn-8');
    expect(result.messages[11].content).toBe('turn-19');
    expect(result.droppedCount).toBe(8);
  });

  it('drops whole oldest turns to fit the char budget (newest kept)', () => {
    const result = normalizeHistory(
      [
        { role: 'user', content: 'a'.repeat(500) },
        { role: 'assistant', content: 'b'.repeat(500) },
        { role: 'user', content: 'c'.repeat(500) },
      ],
      { maxMessages: 12, charBudget: 1000 },
    );
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content[0]).toBe('b');
    expect(result.charLength).toBe(1000);
    expect(result.droppedCount).toBe(1);
  });

  it('truncates oversized single turns (user 2000 / assistant 1500) with an ellipsis', () => {
    const result = normalizeHistory(
      [
        { role: 'user', content: 'u'.repeat(3000) },
        { role: 'assistant', content: 'a'.repeat(3000) },
      ],
      LIMITS,
    );
    expect(result.messages[0].content).toHaveLength(2001);
    expect(result.messages[0].content.endsWith('…')).toBe(true);
    expect(result.messages[1].content).toHaveLength(1501);
  });

  it('scrubs PII-shaped tokens from every turn (assistant downgrade backstop)', () => {
    const result = normalizeHistory(
      [
        { role: 'user', content: '我的手机是13800001234' },
        { role: 'assistant', content: '已记录，身份证110101199001011234，邮箱 a@b.com' },
      ],
      LIMITS,
    );
    expect(result.messages[0].content).toBe('我的手机是[PHONE]');
    expect(result.messages[1].content).toContain('[ID]');
    expect(result.messages[1].content).toContain('[EMAIL]');
    expect(result.messages[1].content).not.toContain('110101199001011234');
  });

  it('maxMessages 0 disables history entirely', () => {
    const result = normalizeHistory([{ role: 'user', content: 'x' }], {
      maxMessages: 0,
      charBudget: 8000,
    });
    expect(result.messages).toEqual([]);
    expect(result.droppedCount).toBe(1);
  });
});
