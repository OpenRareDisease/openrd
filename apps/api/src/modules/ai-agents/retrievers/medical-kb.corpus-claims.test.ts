/**
 * The corpus figures in medical-kb.test.ts have to agree with the ones
 * a census already checks.
 *
 * medical-kb.test.ts restates, in Chinese, the measurements the doc
 * comments in medical-kb.ts state in English: how many chunks the corpus
 * holds, how many carry an ingest label, what master's old pattern
 * dropped when replayed. medical-kb.ts and knowledge.py are both in the
 * source set of scripts/kb_parsers/test_kb_corpus_census.py, which is
 * the thing that runs those numbers back against
 * `select … from kb_chunks`. The test file beside them was never in
 * scope, and it drifted: it still said
 *「150 of 9,594 chunks」after this branch's own re-chunk took the corpus
 * to 10,241, and survived the commit that swept every other 9,594 out.
 *
 * So this is the missing link in the chain, and it is only a link:
 *
 *   kb_chunks ──census (needs the corpus, dev machine)──▶ medical-kb.ts
 *                                                   knowledge.py
 *        └──────────── this file (no corpus, runs in CI) ──▶ medical-kb.test.ts
 *
 * It proves the restatement matches the statement, not that either
 * matches the database — that stays the census's job, and a number wrong
 * in both files is wrong here silently. What it does close is the case
 * the census cannot see at all: one of the two copies being updated
 * alone. Every pattern below asserts that it matched, so rewording a
 * claim out of existence fails rather than quietly retiring it.
 *
 * Not every anchor is census-pinned, and each row says which it is in a
 * comment. The ones that are not anchor to a figure in medical-kb.ts
 * that no query checks — the replay counts, the cid-residue weighting,
 * the length of the 修订说明. Those rows still catch a one-sided edit,
 * which is what this file is for; they just inherit nothing from the
 * database.
 *
 * WHAT THIS FILE CATCHES, AND WHAT IT DOES NOT
 * -------------------------------------------
 * The enumerated rows are pattern matches over prose, so on their own
 * they would be blind to a figure written in a shape nobody enumerated —
 * exactly how the 9,594 survived in the first place. Two things narrow
 * that:
 *
 *   1.「每个语料数字都被某条 claim 罩着」below scans medical-kb.test.ts
 *      for EVERY「N 块 / N chunks / N 个文件 / N files」and fails on any
 *      occurrence that no row's pattern covers and that is not on
 *      UNPINNED with a reason. A newly added「语料现在一共 12,000 块」is
 *      caught by that test even though no pattern here describes it.
 *   2. Every anchor must match its file exactly ONCE. A pattern loose
 *      enough to hit two copies would otherwise read whichever came
 *      first — which is how the 病友经验 row was, for one round,
 *      anchored to knowledge.py's relevance-floor probe block
 *     「the live corpus (10,241 chunks / 211 files, bge-m3)」instead of
 *      to the census header further down the same file. That first copy
 *      is pinned by nothing: the census's header pattern requires a
 *      trailing date and that sentence ends in `bge-m3`.
 *
 * What is left, named exactly, so nobody reads the two tests above as
 * total coverage:
 *
 *   - A corpus figure whose number is not adjacent to 块/chunks/个文件/
 *     files —「一万块语料」, 「10,241 条」, 「the corpus's 211 sources」.
 *     The scanner's vocabulary is pinned by「扫描器认得的写法就是这些」
 *     below, so narrowing it is a red test, but widening the PROSE past
 *     it is not.
 *   - Freshness. Every number here can be wrong in both files at once
 *     and this file passes; only the census, which needs the corpus,
 *     compares anything to kb_chunks. Dates are pinned only to each
 *     other:「日期也不许单独漂」holds every date in medical-kb.test.ts to
 *     the census header's date, so a re-measurement that re-stamps one
 *     file fails — but a re-measurement that re-stamps neither is
 *     invisible here, as it is to the census.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..');

const SOURCES = {
  'medical-kb.test.ts': path.join(HERE, 'medical-kb.test.ts'),
  'medical-kb.ts': path.join(HERE, 'medical-kb.ts'),
  'knowledge.py': path.join(REPO_ROOT, 'apps', 'api', 'knowledge.py'),
} as const;

type SourceName = keyof typeof SOURCES;

/**
 * Source with comment markers stripped and runs of whitespace collapsed,
 * so a claim matches wherever the comment happened to wrap. Same shape
 * as `_flat` in test_kb_corpus_census.py, and for the same reason: a
 * pattern that breaks when a comment is rewrapped is a pattern that gets
 * deleted rather than fixed.
 */
const flat = (name: SourceName): string =>
  fs
    .readFileSync(SOURCES[name], 'utf8')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#:|#|\/\/|\*)\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

const num = (raw: string): number => Number(raw.replace(/[,，]/g, ''));

/**
 * The one place `pattern` matches `name`, or a loud failure.
 *
 * TWO failures, not one. Zero matches means the claim was reworded or
 * deleted. More than one means the pattern is ambiguous, and an
 * ambiguous pattern silently reads whichever copy comes first in the
 * file — the defect this whole file exists to catch, committed by the
 * guard itself.
 */
const matchOnce = (name: SourceName, pattern: RegExp, what: string): RegExpMatchArray => {
  const source = flat(name);
  const all = [
    ...source.matchAll(new RegExp(pattern.source, `${pattern.flags.replace(/g/g, '')}g`)),
  ];
  if (all.length === 0) {
    throw new Error(`${what}: no longer stated in ${name} — re-point this test or drop the claim`);
  }
  if (all.length > 1) {
    throw new Error(
      `${what}: ${all.length} places in ${name} match this pattern, so which copy it reads is an ` +
        `accident — tighten it (matched: ${all.map((m) => JSON.stringify(m[0])).join(', ')})`,
    );
  }
  return all[0];
};

/** Every number the patterns capture, or a loud failure naming the claim
 *  that is no longer stated. */
const figures = (name: SourceName, patterns: RegExp[], what: string): number[] =>
  patterns.flatMap((pattern) => matchOnce(name, pattern, what).slice(1).map(num));

/** Where each pattern sits in the flattened file — the input to the
 *  coverage scan below. */
const spans = (name: SourceName, patterns: RegExp[], what: string): Array<[number, number]> =>
  patterns.map((pattern) => {
    const hit = matchOnce(name, pattern, what);
    return [hit.index ?? 0, (hit.index ?? 0) + hit[0].length];
  });

/**
 * Each row is one measurement written down twice. `here` reads the
 * restatement in medical-kb.test.ts; `anchor` reads the other copy.
 *
 * `anchorOrder: 'reversed'` is for the rows the two files write in
 * opposite orders. It used to be a single `.sort()` over both sides,
 * which made EVERY row order-blind: swapping medical-kb.test.ts's
 *「10241 块 里有 7524 块带着它」to「7524 块 里有 10241 块带着它」— a
 * sentence saying the corpus is 7,524 chunks — passed.
 */
const CROSS_FILE_CLAIMS: Array<{
  what: string;
  here: RegExp[];
  anchor: SourceName;
  anchorPattern: RegExp[];
  anchorOrder?: 'reversed';
}> = [
  {
    // Census-pinned: 'medical-kb.ts ingest-label census' in
    // test_kb_corpus_census.py reads this same anchor sentence.
    what: 'corpus total and how many chunks carry an ingest label',
    here: [/(\d[\d,]*) 块 里有 (\d[\d,]*) 块带着它/],
    anchor: 'medical-kb.ts',
    // Written the other way round there — and that asymmetry is exactly
    // what lets one of the two be updated alone.
    anchorPattern: [/(\d[\d,]*) of the corpus's (\d[\d,]*) chunks carry one/],
    anchorOrder: 'reversed',
  },
  {
    // Not census-pinned: a replay count, nothing in kb_chunks to
    // compare it to. This row only holds the two copies together.
    what: "what master's pattern drops when replayed",
    here: [/重放，(\d[\d,]*) 块、(\d[\d,]*) 个文件/],
    anchor: 'medical-kb.ts',
    anchorPattern: [/drops (\d[\d,]*) chunks across (\d[\d,]*) files/],
  },
  {
    // Not census-pinned — a per-document count from the same replay.
    what: 'the ClinicalTrials listing emptied by its scrape banner',
    here: [/的全部 (\d[\d,]*) 块/],
    anchor: 'medical-kb.ts',
    anchorPattern: [/lost all (\d[\d,]*) to the scrape banner/],
  },
  {
    // Not census-pinned.
    what: 'the 修订说明 that was zeroed, against the catalogue proper',
    here: [/不是 (\d[\d,]*) 块的目录正本/],
    anchor: 'medical-kb.ts',
    anchorPattern: [/catalogue proper — .*?, (\d[\d,]*) chunks — was never emptied/],
  },
  {
    // Not census-pinned.
    what: "master's pattern over the catalogue proper",
    here: [/老 pattern 对它 (\d[\d,]*) 块也只命中 (\d[\d,]*) 块/],
    anchor: 'medical-kb.ts',
    anchorPattern: [/master's pattern matches (\d[\d,]*) of its (\d[\d,]*)/],
    anchorOrder: 'reversed',
  },
  {
    // Not census-pinned.
    what: 'the 修订说明 read end to end',
    here: [/（整份就 (\d[\d,]*) 块）/],
    anchor: 'medical-kb.ts',
    anchorPattern: [/说明\.docx is (\d[\d,]*) chunks long/],
  },
  {
    // Census-pinned twice over: the category row and the census header
    // are both in test_kb_corpus_census.py's table.
    what: '11.病友经验 as a slice of the corpus',
    here: [/11\.病友经验 is (\d[\d,]*) of the corpus's (\d[\d,]*) chunks/],
    anchor: 'knowledge.py',
    // Two rows of the same census block, read separately: the header
    // states the total above the per-category table, so one pattern
    // spanning both would depend on which came first.
    //
    // The total's pattern carries「/ N files, YYYY-MM-DD」on purpose.
    // Without that tail it also matches the relevance-floor probe block
    // earlier in the file —「the live corpus (10,241 chunks / 211 files,
    // bge-m3)」— and matches it FIRST, so this row's total was being
    // compared against a copy no census pattern reaches.
    anchorPattern: [
      /11\.病友经验\/ \(including the 连载 subdirectory\) (\d[\d,]*)/,
      /the live corpus \((\d[\d,]*) chunks \/ \d+ files, \d{4}-\d{2}-\d{2}\)/,
    ],
  },
  {
    // Census-pinned: the 指南共识 row of the same census block.
    what: '指南共识 as a slice of the corpus',
    here: [/指南共识 \((\d[\d,]*) chunks\)/],
    anchor: 'knowledge.py',
    anchorPattern: [/指南共识\/ (\d[\d,]*) chunks/],
  },
  {
    // Not census-pinned: a property of the extraction, not of the
    // corpus's shape, so no query can re-derive it.
    what: 'how much of the (cid:N) residue is light enough to keep',
    here: [/(\d[\d,]*) of the (\d[\d,]*) chunks in the corpus that carry/],
    anchor: 'medical-kb.ts',
    anchorPattern: [/(\d[\d,]*) of the (\d[\d,]*) chunks carrying it are under 5%/],
  },
];

/**
 * Every「N 块 / N chunks / N 个文件 / N files」in medical-kb.test.ts.
 *
 * Exported shape rather than an inline regex because the vocabulary IS
 * the residual limit of this file, and a limit worth disclosing is worth
 * pinning: see「扫描器认得的写法就是这些」.
 */
const CORPUS_FIGURE = /(\d[\d,]*)\s*(?:块|chunks|个文件|files)/g;

const corpusFigures = (text: string): Array<{ at: number; text: string }> =>
  [...text.matchAll(CORPUS_FIGURE)].map((m) => ({ at: m.index ?? 0, text: m[0] }));

/**
 * The figures in medical-kb.test.ts that no cross-file row covers, each
 * with the reason it cannot be one.
 *
 * Keyed by the exact flattened sentence fragment, which must itself
 * occur exactly once — so the reason stays attached to a real sentence
 * rather than becoming a blanket exemption.
 */
const UNPINNED: Array<{ fragment: string; why: string }> = [
  {
    fragment: '剥掉标注之后只剩 1 块被丢',
    // medical-kb.ts states the same fact as「One is still dropped, and
    // correctly: chunk 0 of the ClinicalTrials listing …」— an English
    // number word, which no numeric pattern can pair with 1. Both sides
    // say the same thing; only the shapes refuse to line up.
    why: "medical-kb.ts spells this one as the word 'One', so there is no number to compare",
  },
  {
    fragment: '被清零的是那份 2 块的修订说明',
    // Not cross-file: it is medical-kb.test.ts restating its own
    //「整份就 2 块」three sentences earlier. Held to that instead, by
    //「修订说明的块数在本文件里说了两次」below.
    why: 'a second statement of the same 2 inside this file; pinned to the first one instead',
  },
];

describe('medical-kb.test.ts 里的语料数字，和被 census 盯着的那份对得上', () => {
  it.each(CROSS_FILE_CLAIMS)('$what', ({ here, anchor, anchorPattern, anchorOrder, what }) => {
    const restated = figures('medical-kb.test.ts', here, what);
    const stated = figures(anchor, anchorPattern, what);
    expect(restated).toEqual(anchorOrder === 'reversed' ? [...stated].reverse() : stated);
  });

  it('每条 claim 都真的抓到了数字，没有一条是空过的', () => {
    // Without this, a pattern that captures no groups would compare []
    // against [] and pass — the hollow-gate shape this whole file is a
    // response to.
    for (const claim of CROSS_FILE_CLAIMS) {
      expect(figures('medical-kb.test.ts', claim.here, claim.what).length).toBeGreaterThan(0);
      expect(figures(claim.anchor, claim.anchorPattern, claim.what).length).toBeGreaterThan(0);
    }
  });

  it('每个语料数字都被某条 claim 罩着，或者写明了为什么罩不住', () => {
    // The enumerated rows only see the shapes someone thought of. This
    // is the closed-world half: a corpus figure that no row covers has
    // to be declared, so「语料现在一共 12,000 块」cannot arrive silently
    // the way「150 of 9,594 chunks」did.
    const source = flat('medical-kb.test.ts');
    const covered = CROSS_FILE_CLAIMS.flatMap((claim) =>
      spans('medical-kb.test.ts', claim.here, claim.what),
    );
    for (const { fragment } of UNPINNED) {
      const at = source.indexOf(fragment);
      expect(at, `UNPINNED fragment no longer in the file: ${fragment}`).toBeGreaterThanOrEqual(0);
      expect(source.indexOf(fragment, at + 1), `UNPINNED fragment is not unique: ${fragment}`).toBe(
        -1,
      );
      covered.push([at, at + fragment.length]);
    }

    const loose = corpusFigures(source).filter(
      ({ at }) => !covered.some(([start, end]) => at >= start && at < end),
    );
    expect(
      loose.map(({ at, text }) => `${text} — ${source.slice(Math.max(0, at - 40), at + 20)}`),
    ).toEqual([]);
  });

  it('扫描器认得的写法就是这些 —— 别的形状本文件看不见', () => {
    // The boundary of the test above, written as assertions rather than
    // as a promise in the header. Narrowing this vocabulary (dropping
    //「块」, say) turns this red; prose that steps outside it stays
    // invisible, which is the residue the header discloses.
    expect(corpusFigures('语料现在一共 12,000 块').map((f) => f.text)).toEqual(['12,000 块']);
    expect(corpusFigures('10,241 chunks / 211 files').map((f) => f.text)).toEqual([
      '10,241 chunks',
      '211 files',
    ]);
    expect(corpusFigures('重放，114 块、41 个文件').map((f) => f.text)).toEqual([
      '114 块',
      '41 个文件',
    ]);
    // Outside the vocabulary, and therefore outside this file:
    expect(corpusFigures('语料现在有一万块')).toEqual([]);
    expect(corpusFigures('语料现在一共 12,000 条')).toEqual([]);
    expect(corpusFigures("the corpus's 211 sources")).toEqual([]);
  });

  it('修订说明的块数在本文件里说了两次，两次要一样', () => {
    // The second statement is what UNPINNED exempts from the cross-file
    // scan, so it has to be held to something.
    const first = num(matchOnce('medical-kb.test.ts', /（整份就 (\d[\d,]*) 块）/, '修订说明')[1]);
    const again = num(
      matchOnce('medical-kb.test.ts', /那份 (\d[\d,]*) 块的修订说明/, '修订说明（第二次）')[1],
    );
    expect(again).toBe(first);
  });

  it('日期也不许单独漂', () => {
    // A re-ingest moves the numbers AND the date. The numbers are held
    // to medical-kb.ts and knowledge.py row by row above; without this,
    // a re-measurement that re-stamped only those two files would leave
    // medical-kb.test.ts claiming its figures were measured on a day
    // they were not, with every other test here green.
    const censusDate = matchOnce(
      'knowledge.py',
      /the live corpus \(\d[\d,]* chunks \/ \d+ files, (\d{4}-\d{2}-\d{2})\)/,
      'knowledge.py census header date',
    )[1];
    const restated = [...flat('medical-kb.test.ts').matchAll(/\d{4}-\d{2}-\d{2}/g)].map(
      (m) => m[0],
    );
    expect(restated.length).toBeGreaterThan(0);
    expect([...new Set(restated)]).toEqual([censusDate]);
  });

  it('没有别的 9,594 留在这两个文件里', () => {
    // The figure this branch's re-chunk replaced. It survived a whole
    // commit whose message was about sweeping it out, in the two files
    // that commit was editing.
    for (const name of ['medical-kb.test.ts', 'medical-kb.ts'] as const) {
      expect(fs.readFileSync(SOURCES[name], 'utf8')).not.toMatch(/9,?594/);
    }
  });
});
