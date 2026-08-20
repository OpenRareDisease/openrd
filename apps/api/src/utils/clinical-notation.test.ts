/**
 * ══════════════════════════════════════════════════════════════════════
 * THE NOTATION VOCABULARY, AS A TABLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The point of this file is that DRIFT GOES RED. Six private character
 * classes in two files had each been widened by whoever was looking at
 * one of them, and the result was three different answers to 「is this
 * cell an interval?」 living within a hundred lines of each other. Every
 * one of those widenings was correct and none of them reached the other
 * classes.
 *
 * So the set is spelled out here codepoint by codepoint, ONE MEMBER PER
 * ROW, rather than compared against the module's own constants — a test
 * that reads `RANGE_DASHES` and asserts `RANGE_DASHES` passes no matter
 * what is in it. A mark added to the module without being added here
 * fails the count; a mark added here without being added to the module
 * fails its own row.
 *
 * The mobile twin of this table is in
 * apps/mobile/lib/__tests__/report-insights.notation.test.ts, and it
 * exists because a handset bundle cannot import this module. The exact
 * workspace change that would let it is written out above `RANGE_DASHES`
 * in apps/mobile/lib/report-insights.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  CEILING_EXCLUSIVE,
  CEILING_INCLUSIVE,
  CEILING_INCLUSIVE_DIGRAPHS,
  COMPARATOR_SOURCE,
  FLOOR_EXCLUSIVE,
  FLOOR_INCLUSIVE,
  FLOOR_INCLUSIVE_DIGRAPHS,
  PRINTED_NUMBER,
  RANGE_DASHES,
  RANGE_DASHES_WITHOUT_PLAIN_HYPHEN,
  RANGE_SEPARATOR_SOURCE,
  RANGE_SEPARATOR_SOURCE_WITHOUT_PLAIN_HYPHEN,
  RANGE_WORDS,
  classifyComparator,
} from './clinical-notation.js';

/** Every mark an interval may be printed BETWEEN two numbers with, with
 *  its codepoint, so a row is unambiguous in a diff. */
const RANGE_SEPARATORS = [
  ['U+002D', 'hyphen-minus', '-'],
  ['U+007E', 'tilde', '~'],
  ['U+2010', 'hyphen', '‐'],
  ['U+2011', 'non-breaking hyphen', '‑'],
  ['U+2012', 'figure dash', '‒'],
  ['U+2013', 'en dash', '–'],
  ['U+2014', 'em dash', '—'],
  ['U+2015', 'horizontal bar', '―'],
  ['U+2212', 'minus sign', '−'],
  ['U+301C', 'wave dash', '〜'],
  ['U+FE63', 'small hyphen-minus', '﹣'],
  ['U+FF0D', 'fullwidth hyphen-minus', '－'],
  ['U+FF5E', 'fullwidth tilde', '～'],
  ['U+5230', 'the word 到', '到'],
  ['U+81F3', 'the word 至', '至'],
] as const;

/** Every comparator, with the side it names and whether it admits its
 *  own limit. The second half is the one a widening drops. */
const COMPARATORS = [
  ['U+003C', '<', 'ceiling_exclusive'],
  ['U+FF1C', '＜', 'ceiling_exclusive'],
  ['U+FE64', '﹤', 'ceiling_exclusive'],
  ['U+2264', '≤', 'ceiling_inclusive'],
  ['U+2A7D', '⩽', 'ceiling_inclusive'],
  ['U+2266', '≦', 'ceiling_inclusive'],
  ['digraph', '<=', 'ceiling_inclusive'],
  ['digraph', '=<', 'ceiling_inclusive'],
  ['U+003E', '>', 'floor_exclusive'],
  ['U+FF1E', '＞', 'floor_exclusive'],
  ['U+FE65', '﹥', 'floor_exclusive'],
  ['U+2265', '≥', 'floor_inclusive'],
  ['U+2A7E', '⩾', 'floor_inclusive'],
  ['U+2267', '≧', 'floor_inclusive'],
  ['digraph', '>=', 'floor_inclusive'],
  ['digraph', '=>', 'floor_inclusive'],
] as const;

const anchoredRange = new RegExp(
  `^(?:${PRINTED_NUMBER})${RANGE_SEPARATOR_SOURCE}(?:${PRINTED_NUMBER})$`,
);
const anchoredBound = new RegExp(`^(${COMPARATOR_SOURCE})(?:${PRINTED_NUMBER})$`);
const anchoredRangeNoHyphen = new RegExp(
  `^(?:${PRINTED_NUMBER})${RANGE_SEPARATOR_SOURCE_WITHOUT_PLAIN_HYPHEN}(?:${PRINTED_NUMBER})$`,
);

describe('range separators', () => {
  it.each(RANGE_SEPARATORS)('%s %s separates two numbers', (_code, _name, mark) => {
    expect(anchoredRange.test(`50${mark}310`)).toBe(true);
  });

  /** The count is the half that catches an ADDITION nobody wrote a row
   *  for — a mark quietly appended to the module reaches the readers
   *  without reaching this table, and silently changes what an interval
   *  is. */
  it('the set is exactly these fifteen, no more', () => {
    expect([...RANGE_DASHES]).toHaveLength(13);
    expect(RANGE_WORDS).toHaveLength(2);
    expect(RANGE_SEPARATORS).toHaveLength(15);
  });

  it('every member of the table is in the module, and vice versa', () => {
    const declared = [...RANGE_DASHES, ...RANGE_WORDS].sort();
    const tabled = RANGE_SEPARATORS.map(([, , mark]) => mark).sort();
    expect(declared).toEqual(tabled);
  });

  /** A member is a SEPARATOR, never a number. Without this, adding a
   *  digit-shaped mark would make 「50-310」 read as one number. */
  it.each(RANGE_SEPARATORS)('%s %s is not itself a number', (_code, _name, mark) => {
    expect(new RegExp(`^(?:${PRINTED_NUMBER})$`).test(mark)).toBe(false);
  });
});

describe('comparators', () => {
  it.each(COMPARATORS)('%s %s is read as %s', (_code, mark, kind) => {
    const match = anchoredBound.exec(`${mark}25`);
    expect(match?.[1]).toBe(mark);
    expect(classifyComparator(match?.[1])).toBe(kind);
  });

  it('the set is exactly these sixteen, no more', () => {
    expect([...CEILING_EXCLUSIVE]).toHaveLength(3);
    expect([...CEILING_INCLUSIVE]).toHaveLength(3);
    expect([...FLOOR_EXCLUSIVE]).toHaveLength(3);
    expect([...FLOOR_INCLUSIVE]).toHaveLength(3);
    expect(CEILING_INCLUSIVE_DIGRAPHS).toHaveLength(2);
    expect(FLOOR_INCLUSIVE_DIGRAPHS).toHaveLength(2);
    expect(COMPARATORS).toHaveLength(16);
  });

  it('every member of the table is in the module, and vice versa', () => {
    const declared = [
      ...CEILING_EXCLUSIVE,
      ...CEILING_INCLUSIVE,
      ...FLOOR_EXCLUSIVE,
      ...FLOOR_INCLUSIVE,
      ...CEILING_INCLUSIVE_DIGRAPHS,
      ...FLOOR_INCLUSIVE_DIGRAPHS,
    ].sort();
    expect(declared).toEqual(COMPARATORS.map(([, mark]) => mark).sort());
  });

  /**
   * THE DIGRAPH IS INCLUSIVE THOUGH IT BEGINS WITH THE EXCLUSIVE MARK,
   * and this is the whole reason the alternation is ordered and the
   * classification is asked of the WHOLE match. A reader that took the
   * first character of 「<=25」 would answer EXCLUSIVE and put a reading
   * of exactly 25 outside a limit the laboratory wrote it inside.
   */
  it('a digraph is matched whole and never stripped to its first mark', () => {
    expect(anchoredBound.exec('<=25')?.[1]).toBe('<=');
    expect(anchoredBound.exec('>=25')?.[1]).toBe('>=');
    expect(classifyComparator('<=')).toBe('ceiling_inclusive');
    expect(classifyComparator('<')).toBe('ceiling_exclusive');
  });

  /** Every 「includes('')」 is true, so an unread capture must not be
   *  answered by whichever class is asked first. */
  it('an absent or unknown comparator is placed nowhere', () => {
    expect(classifyComparator('')).toBeNull();
    expect(classifyComparator(undefined)).toBeNull();
    expect(classifyComparator(null)).toBeNull();
    expect(classifyComparator('=')).toBeNull();
    expect(classifyComparator('≠')).toBeNull();
    expect(classifyComparator('<<')).toBeNull();
  });
});

describe('the one deliberate divergence', () => {
  /**
   * `parseD4Z4Reading` scans a whole genetics cell full of hyphenated
   * NAMES — 「4q35-D4Z4」, 「EcoRI-BlnI」 — so it alone drops the plain
   * hyphen. It has to be exactly one character narrower than the set,
   * derived rather than retyped, or it becomes the fourth private
   * class this module exists to end.
   */
  it('is the plain hyphen, and nothing else', () => {
    expect([...RANGE_DASHES_WITHOUT_PLAIN_HYPHEN]).toEqual(
      [...RANGE_DASHES].filter((mark) => mark !== '-'),
    );
    expect([...RANGE_DASHES_WITHOUT_PLAIN_HYPHEN]).toHaveLength([...RANGE_DASHES].length - 1);
  });

  it.each(RANGE_SEPARATORS.filter(([, , mark]) => mark !== '-'))(
    '%s %s still separates two numbers there',
    (_code, _name, mark) => {
      expect(anchoredRangeNoHyphen.test(`1${mark}10`)).toBe(true);
    },
  );

  it('and the plain hyphen does not', () => {
    expect(anchoredRangeNoHyphen.test('1-10')).toBe(false);
  });
});

describe('the grouped number', () => {
  /** 「1，000－2，000」 is one interval between two numbers, in either
   *  comma width, and the grouped spelling has to win the alternation
   *  or the scan stops at the first group. */
  it.each([
    ['1,000', '2,000'],
    ['1，000', '2，000'],
  ])('%s and %s are one number each', (low, high) => {
    expect(anchoredRange.test(`${low}-${high}`)).toBe(true);
    expect(new RegExp(`^(?:${PRINTED_NUMBER})$`).test(low)).toBe(true);
  });
});
