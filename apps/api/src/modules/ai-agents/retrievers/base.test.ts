import { describe, expect, it } from 'vitest';
import { buildSnippet, emptyResult } from './base.js';

describe('buildSnippet', () => {
  it('collapses whitespace and keeps short text as-is', () => {
    expect(buildSnippet('foo   bar\n\nbaz')).toBe('foo bar baz');
  });

  it('truncates with an ellipsis when over the limit', () => {
    const long = 'a'.repeat(200);
    const out = buildSnippet(long, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles missing input safely', () => {
    expect(buildSnippet(undefined as unknown as string)).toBe('');
    expect(buildSnippet('')).toBe('');
  });
});

describe('emptyResult', () => {
  it('produces a stable empty-result shape with the reason in metadata', () => {
    const result = emptyResult('test_retriever', 'no_user', { hint: 'x' });
    expect(result.retrieverId).toBe('test_retriever');
    expect(result.chunks).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.metadata).toEqual({ reason: 'no_user', hint: 'x' });
  });
});
