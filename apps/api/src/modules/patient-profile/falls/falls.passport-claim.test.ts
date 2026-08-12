import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FALL_QUARTER_DAYS, buildFallsSummary, type FallSummaryRow } from './falls.summary.js';

/**
 * The falls module used to tell the maintainer, in five files, that the
 * clinical passport renders the quarterly fall count. It never did.
 * profile.passport.ts has no falls reader at all — the passport's only
 * contact with a fall is the `followupEvents.length > 0` term in
 * `hasRecordedData`, which gates whether a passport id is generated and
 * renders nothing. The real second rendering is the 跌倒记录 block on
 * 病程管理 (apps/mobile/screens/p-manage), which reads `quarters[0]`.
 *
 * That mattered because falls.sql.ts's whole one-query rationale is
 * "two renderings of one question must agree to the row", and one of
 * the two renderings did not exist. A maintainer changing MAX_FALL_ROWS
 * would have gone looking for a passport consumer to keep consistent.
 *
 * Two assertions here, because the claim has two halves that can rot
 * independently:
 *
 *  1. The passport still reads no falls. Checked on the API side only,
 *     and that is sufficient rather than partial: every passport
 *     rendering — the share page, the referral pack, the mobile PDF —
 *     draws from the DTO profile.passport.ts builds, so a count that is
 *     not in the DTO cannot appear downstream.
 *  2. No comment in the falls module or the followup retriever asserts
 *     it does. This one has to tell an assertion from a denial: the
 *     corrected comments say "the clinical passport does NOT render a
 *     fall count", and a guard that banned the word outright would
 *     reject the very sentence that fixed the defect. So the polarity
 *     of the predicate is itself pinned below.
 *
 * The claim has two shapes and the detector below has to see both. Four
 * of the eight were a verb — "the passport shows", "a patient shown
 * ... on the passport" — and four were a noun phrase with no verb at
 * all: "the diary and the passport count", "the passport, the diary
 * screen and the assistant". Both lists in the fixture at the bottom
 * are the sentences themselves, out of HEAD and out of the corrected
 * files, because a guard checked only against prose that no longer
 * contains the claim is checked against nothing.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moduleRoot = path.resolve(__dirname, '..');

const read = (relativePath: string): string => {
  const absolute = path.resolve(moduleRoot, relativePath);
  // A rename should fail loudly here rather than pass by reading an
  // empty string.
  expect(fs.existsSync(absolute), `${relativePath} not found`).toBe(true);
  return fs.readFileSync(absolute, 'utf8');
};

/** Files that build or render the clinical passport. */
const PASSPORT_SOURCES = [
  'profile.passport.ts',
  'passport-share.html.ts',
  'referral-pack.ts',
] as const;

/**
 * Every file in the falls module, plus the other reader of the same
 * summary. Globbed rather than listed: the claim was in five files, the
 * verifier found it in eight, and a hand-written list is one new file
 * away from being wrong again.
 */
const FALLS_SOURCES = [
  ...fs
    .readdirSync(path.join(moduleRoot, 'falls'))
    .filter((name) => name.endsWith('.ts') && name !== path.basename(__filename))
    .map((name) => `falls/${name}`),
  '../ai-agents/retrievers/patient-followups.ts',
];

/**
 * A falls READER, not the English word "fall". The passport files say
 * "falls back to" and "on a fall" in prose; neither reads a fall count.
 * What a renderer would need is one of these symbols, an import from
 * this folder, or a Chinese label for the number.
 */
const FALLS_READER =
  /getFallsSummary|buildFallsSummary|FallsSummary|FALL_HISTORY_SQL|falls\/falls\.|跌倒/;

/**
 * Comment prose, with wrapped lines rejoined.
 *
 * The first version of this guard split the raw source on newlines as
 * well as on full stops, which made every wrapped line its own
 * sentence. falls.summary.ts wrote the claim as
 *
 *     produces (a) a quarterly count, which is what the clinical
 *     passport shows
 *
 * — subject on one line, verb on the next — so the guard written to
 * catch that sentence never saw it whole. It caught three of the eight
 * sentences it was written for.
 *
 * So: keep the comment lines, drop the `*` / `//` marker, join a run of
 * them into one paragraph, and split on full stops only. A blank
 * comment line ends a paragraph, the way it does for a reader. The
 * split needs the whitespace after the stop, because these comments are
 * full of `falls.summary.ts` and `profile.passport.ts` and cutting
 * inside a filename strands a subject from its verb.
 */
const commentSentences = (source: string): string[] => {
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) paragraphs.push(current.join(' '));
    current = [];
  };
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!/^(?:\/\/|\/\*|\*)/.test(line)) {
      flush();
      continue;
    }
    const text = line.replace(/^\/\*+|^\/\/+|^\*+\/?|\*\/$/g, '').trim();
    if (text.length === 0) {
      flush();
      continue;
    }
    current.push(text);
  }
  flush();
  return paragraphs
    .flatMap((paragraph) => paragraph.split(/(?<=\.)\s+|。/))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
};

/**
 * Rendering verbs, active AND passive.
 *
 * The passive is not thoroughness for its own sake: falls.sql.ts wrote
 * its claim as「A patient shown「本季度 3 次」on the passport」, and a
 * list of active forms alone did not match a single character of it.
 */
const RENDER_VERB =
  /\b(?:shows?|showed|shown|renders?|rendered|reads?|displays?|displayed|carries|carried)\b/gi;

/**
 * The other surfaces that really do hold this number. Written with
 * `\s*` through the Chinese ones because a wrapped comment line puts a
 * space inside 病程管理 once the paragraph is rejoined.
 */
const CO_SURFACE = /assistant|diary|screen|retriever|follow-?up|病程\s*管理|跌倒\s*记录/i;

/**
 * The passport named as a holder of the count, with no verb of its own.
 * Four of the eight sentences were this shape, and a verb-only detector
 * is blind to every one of them:
 *
 *   「Default look-back for the diary and the passport count」
 *   「so the passport, the diary screen and the assistant cannot
 *     disagree」
 *   「the interval the passport and a routine neurology follow-up both
 *     work in」
 *   「because the passport and the assistant … are the same question
 *     asked twice」
 *
 * Two narrow patterns rather than one broad one. 「passport」 near a
 * bare 「and」 would fire on the shipped 「the passport is the artefact a
 * patient forwards to a clinician by link, and what a share exposes is
 * governed by sharing-preferences.ts」, which claims nothing about
 * falls. So the passport has to either head a count noun, or stand in a
 * list beside a surface that does render this number.
 */
const PASSPORT_COUNT =
  /\bpassport(?:'s)?\s+(?:count|number|summary|figure)\b|\bcounts?\s+(?:on|in)\s+the\s+(?:clinical\s+)?passport\b/i;
const PASSPORT_LISTED_WITH_A_REAL_SURFACE = new RegExp(
  `\\bpassport\\b[^.]{0,40}?(?:\\band\\b|,)[^.]{0,40}?(?:${CO_SURFACE.source})` +
    `|(?:${CO_SURFACE.source})[^.]{0,40}?(?:\\band\\b|,)[^.]{0,40}?\\bpassport\\b`,
  'i',
);

/**
 * A negator counts only where it negates the claim it is next to.
 *
 * 「anywhere in the sentence」 exempts a sentence for words that have
 * nothing to do with the rendering: falls.controller.ts's own claim sat
 * in 「…for a patient with no falls on record — which is NOT the same as
 * a patient who has not fallen, and the passport must not label it that
 * way」, three negators away from the assertion two lines up. Bounded to
 * the span around the claim, both directions, because the denial can
 * come before the verb (「does NOT render a fall count」) or after it
 * (「it renders no falls at all」).
 */
const NEGATOR = /\b(?:not|never|no|neither|nor)\b/i;
const NEGATOR_REACH = 24;

const negatedAround = (sentence: string, start: number, length: number): boolean =>
  NEGATOR.test(sentence.slice(Math.max(0, start - NEGATOR_REACH), start + length + NEGATOR_REACH));

const claimsThePassportRendersFalls = (sentence: string): boolean => {
  if (!/passport|护照/i.test(sentence)) return false;
  for (const verb of sentence.matchAll(RENDER_VERB)) {
    if (!negatedAround(sentence, verb.index, verb[0].length)) return true;
  }
  const nounPhrase =
    PASSPORT_COUNT.exec(sentence) ?? PASSPORT_LISTED_WITH_A_REAL_SURFACE.exec(sentence);
  return nounPhrase !== null && !negatedAround(sentence, nounPhrase.index, nounPhrase[0].length);
};

const sentencesClaimingThePassportRendersFalls = (source: string): string[] =>
  commentSentences(source).filter(claimsThePassportRendersFalls);

describe('falls: the clinical passport claim', () => {
  it('the passport builds no falls into its DTO, so nothing downstream can render one', () => {
    for (const file of PASSPORT_SOURCES) {
      const hits = read(file)
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter((entry) => FALLS_READER.test(entry.line));
      // If this goes red because the passport now DOES render falls,
      // that is a feature landing, not a flake — and the comments in
      // falls.summary.ts / falls.service.ts / patient-followups.ts that
      // currently say it does not have to change in the same commit.
      expect(hits, `${file} reads falls`).toEqual([]);
    }
  });

  it('no falls comment says otherwise', () => {
    // falls/ holds nine .ts files besides this one, and the retriever
    // makes ten. A glob that silently returned nothing would pass this
    // test for the wrong reason.
    expect(FALLS_SOURCES.length).toBeGreaterThanOrEqual(10);
    for (const file of FALLS_SOURCES) {
      expect(sentencesClaimingThePassportRendersFalls(read(file)), file).toEqual([]);
    }
  });

  /**
   * The correction is only half a fix if the surface it names is as
   * unchecked as the passport was. falls.summary.ts now says the count
   * lands in 病程管理's 跌倒记录 block as「最近 90 天记录到 N 次跌倒」,
   * and that sentence carries a measured number, so it gets measured.
   *
   * The API owns the 90: the mobile headline is
   * `最近 ${quarters[0].endDaysAgo + 1} 天记录到 ${count} 次跌倒`
   * (apps/mobile/lib/falls.ts#summarizeFallsForCourse), so a change to
   * FALL_QUARTER_DAYS here silently rewrites a Chinese sentence over
   * there. Asserted through buildFallsSummary rather than off the
   * constant, because the +1 is the part that could be off by one.
   */
  it('the number in that corrected comment is the one the API produces', () => {
    const rows: FallSummaryRow[] = [
      { occurred_at: new Date('2026-08-01T00:00:00Z'), fall_day_age: 3 },
      { occurred_at: new Date('2026-06-01T00:00:00Z'), fall_day_age: 62 },
    ];
    const summary = buildFallsSummary(rows, { atCap: false, now: Date.parse('2026-08-04Z') });

    expect(FALL_QUARTER_DAYS).toBe(90);
    expect(summary.quarters[0]).toMatchObject({ index: 0, startDaysAgo: 0, count: 2 });
    // The window the mobile sentence names: endDaysAgo + 1.
    expect(summary.quarters[0].endDaysAgo + 1).toBe(90);
  });

  /**
   * The fixture the detector is calibrated against.
   *
   * The first version of it was checked against nothing but the
   * corrected files, which is how it shipped able to catch three of the
   * eight sentences it was written for: it read one wrapped line at a
   * time, knew only the active voice, and exempted a whole sentence for
   * a negator sitting anywhere in it. All three holes are invisible
   * when the only prose you run on is prose that no longer contains the
   * claim.
   *
   * So both directions are pinned on sentences. REMOVED_CLAIMS is the
   * archive: every one of the eight, verbatim from HEAD, joined the way
   * `commentSentences` joins a wrapped comment. HONEST is the
   * corrections that shipped in their place, plus the sentences from
   * HEAD that were already honest — falls.controller.ts denied that the
   * passport may label an empty quarter as「没摔过」in the same paragraph
   * as its false claim, and a guard that cannot tell those two apart is
   * no guard.
   */
  const REMOVED_CLAIMS = [
    // falls.service.ts:215 and :29.
    'The quarterly count the clinical passport shows.',
    'Default look-back for the diary and the passport count.',
    // falls.controller.ts:47.
    'The quarterly count the clinical passport renders.',
    // falls.summary.ts:6-7 — the one wrapped across two comment lines,
    // and the one three lines under it.
    'It takes the rows FALL_HISTORY_SQL returns and produces (a) a quarterly count, which is what the clinical passport shows, and (b) one Chinese sentence, which is what the AI retriever hands to the model.',
    'Both come from the same numbers, computed once, because the passport and the assistant answering「我最近跌倒是不是更频繁了」are the same question asked twice.',
    // falls.summary.ts:83.
    'A quarter, because that is the interval the passport and a routine neurology follow-up both work in.',
    // falls.schema.ts:77.
    'Clamped to the same 730-day ceiling the followup retriever uses so the passport, the diary screen and the assistant cannot disagree about how far back「最近」reaches.',
    // falls.sql.ts:7-9 — the passive, which no active verb list reaches.
    'A patient shown「本季度 3 次」on the passport and told「你最近记录了 5 次」by the assistant has been given two facts about their own body and no way to tell which is real.',
    // patient-followups.ts:51-52 and :467.
    'The summary they feed is composed in patient-profile/falls/falls.summary.ts, which is also what the passport reads — one set of numbers, two renderings.',
    'The second is FALL_HISTORY_SQL, which owns the de-duplication between the two tables and is shared with the falls endpoints so the passport and the assistant cannot disagree.',
  ];

  const HONEST = [
    // Verbatim from the corrected files. If the guard rejects these it
    // is rejecting the correction it exists to enforce.
    'The clinical passport does NOT render a fall count.',
    'Not the clinical passport — that surface renders no falls.',
    '(Not the clinical passport: it renders no falls at all.)',
    'Comments in this module used to say it did, in five files, and none of it was ever true — profile.passport.ts has no falls reader at all.',
    'Putting one there is a product decision and a disclosure decision (the passport is the artefact a patient forwards to a clinician by link, and what a share exposes is governed by sharing-preferences.ts), so it is not something to assert in a doc comment ahead of making it.',
    // Honest at HEAD, in the same paragraph as a false claim: the
    // reason the negator is scoped to the claim rather than dropped.
    'Returns zeroed counts and an empty `quarters` array for a patient with no falls on record — which is NOT the same as a patient who has not fallen, and the passport must not label it that way.',
    // The shapes a future correction is likely to reach for.
    'The passport never showed a fall count and does not show one now.',
    'A passport share exposes no falls data.',
  ];

  it.each(REMOVED_CLAIMS)('reads as a claim: %s', (sentence) => {
    expect(claimsThePassportRendersFalls(sentence)).toBe(true);
  });

  it.each(HONEST)('reads as honest: %s', (sentence) => {
    expect(claimsThePassportRendersFalls(sentence)).toBe(false);
  });

  it('reads a claim that a comment wrapped across two lines', () => {
    const block = [
      '/**',
      ' * This module is pure. It takes the rows FALL_HISTORY_SQL returns',
      ' * and produces (a) a quarterly count, which is what the clinical',
      ' * passport shows, and (b) one Chinese sentence.',
      ' */',
      "const label = 'the passport shows the count';",
    ].join('\n');
    // One hit, not two: the identical sentence in the string literal on
    // the last line is code, not a comment, and this guard is about
    // what the module tells its next maintainer.
    expect(sentencesClaimingThePassportRendersFalls(block)).toHaveLength(1);
  });

  /**
   * The bound, stated as a test rather than as a promise.
   *
   * A denial that trails another surface's claim inside ONE sentence
   * reads as a claim, because the negator is 30 characters past the
   * verb it denies and nothing here parses English well enough to
   * attach it. The fix for an author who hits this is the shape the
   * corrected files already use: two sentences, the denial in its own.
   * Pinned so that the limit is measured instead of asserted, and so
   * that widening the reach later has to come here first.
   */
  it('reads a trailing denial as a claim, and two sentences as honest', () => {
    expect(
      claimsThePassportRendersFalls(
        'The 跌倒记录 block on 病程管理 shows the quarterly count; the passport does not.',
      ),
    ).toBe(true);
    expect(
      claimsThePassportRendersFalls(
        'The quarterly count 病程管理 shows and the assistant reasons over.',
      ),
    ).toBe(false);
  });
});
