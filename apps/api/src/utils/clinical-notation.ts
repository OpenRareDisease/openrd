/**
 * ══════════════════════════════════════════════════════════════════════
 * THE PUNCTUATION A CLINICAL INTERVAL IS ACTUALLY PRINTED WITH.
 * ONE VOCABULARY, IN ONE PLACE, FOR EVERY READER IN apps/api.
 * ══════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS. The same three questions — 「is this cell a
 * range?」, 「is this cell a bound?」, 「which side does the bound name,
 * and does it include its own limit?」 — were answered by six private
 * character classes that had drifted apart from one another:
 *
 *   - the interval comparison in profile.passport.ts knew thirteen
 *     dashes and not the two WORDS 至/到, so a result cell reading
 *     「0.5至1.2」 — the reference column mis-parsed into the result
 *     column — walked past the guard that exists to refuse exactly
 *     that, its low end was handed to the comparison, and the platform
 *     published 「本平台比对：低于该区间」 about a number nobody
 *     measured;
 *   - the MMT cell class in the same file knew eight dashes and not
 *     ‐ ‑ ‒ ― 〜, so 「4‐5级」 — an examiner declining to choose
 *     between grade 4 and grade 5 — was read as the determinate grade
 *     4 and voted in 平均肌力 on the passport, the share page, the
 *     referral pack and the markdown export;
 *   - the D4Z4 bound class knew a different eight again.
 *
 * Every one of those was a widening someone did on the class in front
 * of them. A shared vocabulary is what makes the next widening land on
 * all of them at once, and `clinical-notation.test.ts` asserts the set
 * as a TABLE so a member added to one class and not another goes red
 * instead of going unnoticed.
 *
 * THE SET IS COPIED FROM THE PRODUCER, NOT INVENTED HERE. Everything
 * these classes read came off `_read_row_reference` /
 * `extract_numeric_value` in
 * apps/report-manager/app/services/fshd_report_service.py, which return
 * the cell RAW, so whatever the laboratory typed arrives unaltered.
 * `_RANGE_DASHES`, `_RANGE_WORDS` and `_COMPARATORS` there are the
 * floor this set has to reach.
 *
 *   RANGE SEPARATORS — thirteen marks and two words:
 *     -  U+002D hyphen-minus        ~  U+007E tilde
 *     ‐  U+2010 hyphen              ‑  U+2011 non-breaking hyphen
 *     ‒  U+2012 figure dash         –  U+2013 en dash
 *     —  U+2014 em dash             ―  U+2015 horizontal bar
 *     −  U+2212 minus sign          〜 U+301C wave dash
 *     ﹣ U+FE63 small hyphen-minus  －  U+FF0D fullwidth hyphen-minus
 *     ～ U+FF5E fullwidth tilde
 *     到 U+5230                     至 U+81F3
 *
 *   COMPARATORS — twelve marks and four digraphs:
 *     ceiling, EXCLUSIVE:  <  U+003C   ＜ U+FF1C   ﹤ U+FE64
 *     ceiling, INCLUSIVE:  ≤  U+2264   ⩽  U+2A7D   ≦  U+2266
 *                          <= and =<
 *     floor,   EXCLUSIVE:  >  U+003E   ＞ U+FF1E   ﹥ U+FE65
 *     floor,   INCLUSIVE:  ≥  U+2265   ⩾  U+2A7E   ≧  U+2267
 *                          >= and =>
 *
 * THE EXCLUSIVE / INCLUSIVE SPLIT IS THE HALF A WIDENING LOSES, and it
 * is the half that decides where a reading sitting EXACTLY on the limit
 * lands. The parser only has to know that 「＜」 names a CEILING; a
 * reader in this repo has to know it EXCLUDES its own limit while 「⩽」
 * does not. Hence four classes and `classifyComparator`, not one class
 * plus a direction — and hence the digraphs are INCLUSIVE: 「<=25」 is
 * the ASCII spelling of 「≤25」 and admits 25, which the bare 「<」 it
 * starts with does not. A reader that stripped the 「=」 and asked the
 * remaining character would answer that backwards on the limit itself.
 *
 * WHAT IS STILL NOT ACCEPTED, said out loud so the next reader does not
 * trust this further than it goes: an interval written entirely in
 * WORDS (「大于 10」, 「10 以上」, 「正常」) — `parseD4Z4Reading` reads
 * those against its own word list and the interval comparison does not,
 * because a row it cannot read prints as it stands, which is the safe
 * direction; a NEGATIVE bound (「−5－5」), because `PRINTED_NUMBER`
 * carries no sign and the dash class would eat it; and a space-grouped
 * number (「3 250」), which the parser folds away before publishing.
 * Adding any of those is a change to this file and to the table, not to
 * a class at a call site.
 *
 * THE MOBILE HALF IS NOT HERE, AND CANNOT BE. See the block above
 * `RANGE_DASHES` in apps/mobile/lib/report-insights.ts for the exact
 * change that would be required to share this file with the handset
 * bundle, written out so it can be decided rather than rediscovered.
 */

/** A character class body with every regex-significant member escaped,
 *  so a class stays correct no matter what order its members are
 *  declared in. The old classes were correct only because 「-」 happened
 *  to be written first. */
const charClass = (chars: string) => `[${chars.replace(/[\\\]^-]/g, (mark) => '\\' + mark)}]`;

/** The thirteen marks an interval is printed BETWEEN two numbers with. */
export const RANGE_DASHES = '-~‐‑‒–—―−〜﹣－～';

/** And the two WORDS it is also printed with. 「1至10」 and 「1到10」 are
 *  the same interval as 「1-10」, written out. They are not punctuation,
 *  so they cannot live in a character class, and every reader that
 *  needs one needs the other — which is the whole reason the separator
 *  is exported as a regex SOURCE and not as a string of characters. */
export const RANGE_WORDS: readonly string[] = ['到', '至'];

/** 「<25」 EXCLUDES 25. */
export const CEILING_EXCLUSIVE = '<＜﹤';
/** 「≤25」 ADMITS 25. */
export const CEILING_INCLUSIVE = '≤⩽≦';
/** 「>9」 EXCLUDES 9. */
export const FLOOR_EXCLUSIVE = '>＞﹥';
/** 「≥9」 ADMITS 9. */
export const FLOOR_INCLUSIVE = '≥⩾≧';

/** The ASCII spellings of 「≤」, both orders. INCLUSIVE — see the header. */
export const CEILING_INCLUSIVE_DIGRAPHS: readonly string[] = ['<=', '=<'];
/** The ASCII spellings of 「≥」, both orders. INCLUSIVE. */
export const FLOOR_INCLUSIVE_DIGRAPHS: readonly string[] = ['>=', '=>'];

/** Every comparator that is a single character. */
export const COMPARATOR_CHARS = `${CEILING_EXCLUSIVE}${CEILING_INCLUSIVE}${FLOOR_EXCLUSIVE}${FLOOR_INCLUSIVE}`;

/** Every comparator that is two characters. */
export const COMPARATOR_DIGRAPHS: readonly string[] = [
  ...CEILING_INCLUSIVE_DIGRAPHS,
  ...FLOOR_INCLUSIVE_DIGRAPHS,
];

/**
 * 「A to B」, as one regex source — THE one place a separator is spelled.
 *
 * Unparenthesised alternation is why this is a non-capturing GROUP and
 * not a bare alternation: dropped into a longer pattern, 「a|b」 would
 * split that whole pattern in two.
 */
export const RANGE_SEPARATOR_SOURCE = `(?:${charClass(RANGE_DASHES)}|${RANGE_WORDS.join('|')})`;

/**
 * A comparator, as one regex source.
 *
 * THE DIGRAPHS COME FIRST IN THE ALTERNATION and this is not cosmetic:
 * a regex alternation is ordered, so with the single-character class
 * first 「<=25」 would match 「<」, leave 「=25」 behind, and an anchored
 * pattern would fail while an unanchored one would answer EXCLUSIVE
 * about a limit the laboratory wrote as inclusive.
 */
export const COMPARATOR_SOURCE = `(?:${COMPARATOR_DIGRAPHS.join('|')}|${charClass(COMPARATOR_CHARS)})`;

/**
 * 「3,250」 IS ONE NUMBER, and the grouped spelling has to come first in
 * the alternation or the scan stops at the first group and reads 3. The
 * comma in both widths, as the parser's `_DIGIT_GROUPS` has it.
 */
export const PRINTED_NUMBER = String.raw`\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

export type ComparatorKind =
  | 'ceiling_exclusive'
  | 'ceiling_inclusive'
  | 'floor_exclusive'
  | 'floor_inclusive';

/**
 * Which side a comparator names, and whether it admits its own limit.
 *
 * ASKED OF THE VOCABULARY, NOT OF A BRANCH AT THE CALL SITE, so a
 * spelling added above is answered everywhere without a branch being
 * added at four call sites and forgotten at one of them.
 *
 * The digraphs are tested BEFORE the single characters for the reason
 * they lead the alternation, and emptiness is tested before either,
 * because 「''.includes('')」 is true and an absent capture would
 * otherwise be answered by whichever class is asked first.
 */
export const classifyComparator = (mark: string | undefined | null): ComparatorKind | null => {
  if (!mark) return null;
  if (CEILING_INCLUSIVE_DIGRAPHS.includes(mark)) return 'ceiling_inclusive';
  if (FLOOR_INCLUSIVE_DIGRAPHS.includes(mark)) return 'floor_inclusive';
  if (mark.length !== 1) return null;
  if (CEILING_EXCLUSIVE.includes(mark)) return 'ceiling_exclusive';
  if (CEILING_INCLUSIVE.includes(mark)) return 'ceiling_inclusive';
  if (FLOOR_EXCLUSIVE.includes(mark)) return 'floor_exclusive';
  if (FLOOR_INCLUSIVE.includes(mark)) return 'floor_inclusive';
  return null;
};

/**
 * The range separators MINUS the plain ASCII hyphen, for the one reader
 * that must not have it.
 *
 * `parseD4Z4Reading` scans a whole genetics cell rather than an
 * anchored interval, and that cell is full of hyphenated NAMES —
 * 「4q35-D4Z4」, 「EcoRI-BlnI」. Treating 「-」 there as an interval
 * separator would refuse to read a determinate repeat count off any
 * cell that spelled out what was measured. The two-number fallback in
 * that function is what catches a real hyphen range, so nothing is
 * lost; every OTHER member of the set is rare enough in a name and
 * common enough as an OCR'd dash that it stays in.
 *
 * Derived rather than retyped: a mark added to `RANGE_DASHES` lands
 * here too, which is the drift this file exists to end.
 */
export const RANGE_DASHES_WITHOUT_PLAIN_HYPHEN = RANGE_DASHES.replace('-', '');

/** The same 「A to B」 grammar as `RANGE_SEPARATOR_SOURCE`, for that one
 *  reader. Both words stay: 「1至10」 is an interval in any cell. */
export const RANGE_SEPARATOR_SOURCE_WITHOUT_PLAIN_HYPHEN = `(?:${charClass(
  RANGE_DASHES_WITHOUT_PLAIN_HYPHEN,
)}|${RANGE_WORDS.join('|')})`;
