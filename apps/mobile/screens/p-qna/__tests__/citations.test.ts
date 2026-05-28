import { normalizeCitationIndexes, parseCitationSegments } from '../citations';

describe('parseCitationSegments', () => {
  it('returns an empty list for empty input', () => {
    expect(parseCitationSegments('', 3)).toEqual([]);
  });

  it('returns one text segment when there are no citation tokens', () => {
    expect(parseCitationSegments('FSHD 是一种遗传性肌肉病', 0)).toEqual([
      { type: 'text', value: 'FSHD 是一种遗传性肌肉病' },
    ]);
  });

  it('splits a single [N] cite out of the surrounding text', () => {
    const out = parseCitationSegments('详见[1]这一段。', 3);
    expect(out).toEqual([
      { type: 'text', value: '详见' },
      { type: 'cite', indexes: [1], raw: '[1]' },
      { type: 'text', value: '这一段。' },
    ]);
  });

  it('parses [N,M] with multiple comma-separated indexes', () => {
    const out = parseCitationSegments('参考[1,2]两个来源。', 5);
    expect(out).toEqual([
      { type: 'text', value: '参考' },
      { type: 'cite', indexes: [1, 2], raw: '[1,2]' },
      { type: 'text', value: '两个来源。' },
    ]);
  });

  it('tolerates whitespace around commas inside the brackets', () => {
    const out = parseCitationSegments('参考[1 , 3, 5]。', 5);
    expect(out).toEqual([
      { type: 'text', value: '参考' },
      { type: 'cite', indexes: [1, 3, 5], raw: '[1 , 3, 5]' },
      { type: 'text', value: '。' },
    ]);
  });

  it('handles two citation tokens in the same sentence', () => {
    const out = parseCitationSegments('开头[1]中间[2]末尾。', 3);
    expect(out).toEqual([
      { type: 'text', value: '开头' },
      { type: 'cite', indexes: [1], raw: '[1]' },
      { type: 'text', value: '中间' },
      { type: 'cite', indexes: [2], raw: '[2]' },
      { type: 'text', value: '末尾。' },
    ]);
  });

  it('drops out-of-range indexes and folds the whole token to plain text when none remain', () => {
    // citationCount=2 so [5] points at nothing. We render the raw
    // `[5]` rather than a pressable that opens nothing.
    const out = parseCitationSegments('看[5]这条。', 2);
    expect(out).toEqual([
      { type: 'text', value: '看' },
      { type: 'text', value: '[5]' },
      { type: 'text', value: '这条。' },
    ]);
  });

  it('keeps the valid subset when only some indexes in a multi-index token are out of range', () => {
    // The LLM emitted [1,9]; we have 3 citations. Drop the 9 but
    // keep the cite tappable on [1]. raw stays "[1,9]" so the
    // rendered label matches what the LLM actually wrote (so the
    // user can still see the LLM's intent even if part of it was
    // hallucinated).
    const out = parseCitationSegments('详见[1,9]。', 3);
    expect(out).toEqual([
      { type: 'text', value: '详见' },
      { type: 'cite', indexes: [1], raw: '[1,9]' },
      { type: 'text', value: '。' },
    ]);
  });

  it('treats zero and negative indexes as invalid', () => {
    const out = parseCitationSegments('看[0]和[-1]。', 5);
    // -1 doesn't actually match the regex (no \- in the pattern), so
    // it stays as plain "-1]" leakage — but the surrounding "[" gets
    // consumed as a literal too. Pin the behaviour so a future
    // regex change can't silently re-introduce a tap on [0].
    expect(out[1]).toEqual({ type: 'text', value: '[0]' });
  });

  it('preserves leading text when the answer starts with a citation', () => {
    const out = parseCitationSegments('[1] 是答案的开头。', 2);
    expect(out).toEqual([
      { type: 'cite', indexes: [1], raw: '[1]' },
      { type: 'text', value: ' 是答案的开头。' },
    ]);
  });

  it('preserves trailing text when the answer ends with a citation', () => {
    const out = parseCitationSegments('结尾在这里。[2]', 3);
    expect(out).toEqual([
      { type: 'text', value: '结尾在这里。' },
      { type: 'cite', indexes: [2], raw: '[2]' },
    ]);
  });

  it('does NOT match Chinese 【N】 brackets (scope decision)', () => {
    // The proposal scopes Phase 3b to ASCII brackets only — Chinese
    // brackets often appear inside quoted document text, where
    // matching them would create spurious tap targets.
    const out = parseCitationSegments('文档里写【1】是病例编号。', 3);
    expect(out).toEqual([{ type: 'text', value: '文档里写【1】是病例编号。' }]);
  });

  it('does NOT match range form [1-3] (scope decision)', () => {
    const out = parseCitationSegments('范围[1-3]', 5);
    // The regex requires \d+ followed by optional comma-separated \d+.
    // `1-3` doesn't match, so the whole token degrades to text.
    expect(out).toEqual([{ type: 'text', value: '范围[1-3]' }]);
  });
});

describe('normalizeCitationIndexes', () => {
  it('dedupes repeated indexes preserving sorted order', () => {
    expect(normalizeCitationIndexes([1, 1, 2])).toEqual([1, 2]);
  });

  it('sorts unsorted input', () => {
    expect(normalizeCitationIndexes([3, 1, 2])).toEqual([1, 2, 3]);
  });

  it('returns [] for empty input', () => {
    expect(normalizeCitationIndexes([])).toEqual([]);
  });
});
