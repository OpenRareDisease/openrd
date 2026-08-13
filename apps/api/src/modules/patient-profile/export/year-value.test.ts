import { describe, expect, it } from 'vitest';

import { decodeFirstYear, decodeYear, serialiseYear } from './year-value.js';

describe('year-value — 「记不清了」 is a value, not a blank', () => {
  it('separates 记不清了 from 未采集 all the way to the wire', () => {
    // The whole point of the module: these two must never collapse.
    const remembered = serialiseYear(decodeYear(2014));
    const forgotten = serialiseYear(decodeYear('记不清了'));
    const neverAsked = serialiseYear(decodeYear(null));

    expect(remembered).toEqual({ answer: 'known', answerZh: '已知', year: 2014 });
    expect(forgotten).toEqual({ answer: 'not_remembered', answerZh: '记不清了', year: null });
    expect(neverAsked).toEqual({ answer: 'not_collected', answerZh: '未采集', year: null });

    // Both non-year answers have a null `year`, so a consumer reading
    // only `year` is not misled — it is `answer` that tells them apart.
    expect(forgotten.year).toBeNull();
    expect(neverAsked.year).toBeNull();
    expect(forgotten.answer).not.toBe(neverAsked.answer);
  });

  it('accepts every 「不记得」 token a non-Zod write path may have left in the JSONB', () => {
    ['记不清了', '记不清', '不记得', 'unknown', 'not_remembered', '  记不清了  '].forEach(
      (token) => {
        expect(decodeYear(token), token).toEqual({ kind: 'unknown' });
      },
    );
  });

  it('reads a year out of an ISO date string without inventing a month', () => {
    expect(decodeYear('2014-06-01')).toEqual({ kind: 'year', year: 2014 });
    expect(decodeYear('2014')).toEqual({ kind: 'year', year: 2014 });
  });

  it('treats unparseable free text as 未采集, NOT as 记不清了', () => {
    // 「未采集」 is the weaker claim, and the honest one: free text in
    // the column is no evidence that the question was ever asked.
    expect(decodeYear('大概高中的时候')).toEqual({ kind: 'not_asked' });
    expect(decodeYear('')).toEqual({ kind: 'not_asked' });
    expect(decodeYear({ year: 2014 })).toEqual({ kind: 'not_asked' });
  });

  it('rejects out-of-range and non-integer years rather than passing them through', () => {
    expect(decodeYear(1700)).toEqual({ kind: 'not_asked' });
    expect(decodeYear(3000)).toEqual({ kind: 'not_asked' });
    expect(decodeYear(2014.5)).toEqual({ kind: 'not_asked' });
    expect(decodeYear('0201')).toEqual({ kind: 'not_asked' });
  });

  it('lets 记不清了 win over a later blank in the fallback chain', () => {
    // The regression this guards: falling through 「记不清了」 to a
    // null diagnosisDate and reporting 未采集, i.e. losing the answer
    // the patient actually gave.
    expect(decodeFirstYear('记不清了', null)).toEqual({ kind: 'unknown' });
    expect(decodeFirstYear(null, '2014-06-01')).toEqual({ kind: 'year', year: 2014 });
    expect(decodeFirstYear(2014, '2011-01-01')).toEqual({ kind: 'year', year: 2014 });
    expect(decodeFirstYear(null, null)).toEqual({ kind: 'not_asked' });
  });
});
