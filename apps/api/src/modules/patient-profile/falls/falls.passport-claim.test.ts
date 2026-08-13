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
 * WHAT THIS GUARDS, in two halves that can rot independently:
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
 * The archive the detector is calibrated against, in numbers 'states
 * its own archive' derives rather than remembers:
 * ARCHIVE: ten sentences, five verb-bearing and five noun-phrase, from
 * six files.
 * SPLIT: five of the ten carried a rendering verb and five named the
 * passport as a holder with no verb at all.
 * REACH: five of the six files are in falls/ itself.
 *
 * The fixture at the bottom holds three lists, because each covers a
 * direction the others cannot: REMOVED_CLAIMS is the archive, verbatim
 * from HEAD; HONEST is the corrections that shipped in their place;
 * UNWRITTEN_CLAIMS is the same claim in words nobody here has used.
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
 * summary. Globbed rather than listed: the module's own comments put
 * the claim in five files and the archive below cites six files, and a
 * hand-written list goes stale the first time falls/ grows a module.
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
 * Splitting on newlines as well as on full stops is what the first
 * version did, and a claim whose subject and verb sit on different
 * comment lines is then never seen whole. It caught three of the ten
 * sentences it was written for: the three short enough to fit inside
 * one comment line, and no others. That is measured off the archive
 * below rather than remembered — see COMMENT_LINE_BUDGET.
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
 * The two things a claim puts in one sentence: the surface, and the
 * number it is said to hold.
 *
 * The first version of this detector asked only 「is there a rendering
 * verb」, off a closed list — shows/renders/reads/displays/carries and
 * their inflections — and that list was written by reading the ten
 * sentences that had been removed. It is a transcript, not a rule:
 * every ordinary verb the next maintainer reaches for went through it
 * untouched, because a verb list can only ever hold the verbs somebody
 * already wrote.
 *
 * So the primary rule names no verb at all: the passport and this
 * module's number within one breath of each other, with no denial
 * reaching either of them. The archived no-verb sentences (「the diary
 * and the passport count」) claim with no verb to catch, so proximity is
 * what makes a claim here.
 */
const PASSPORT = /passport|护照/gi;

/**
 * The number, and the thing it counts, in the spellings this module
 * writes them.
 *
 * Every English noun here is excluded where it is a segment of a path
 * or a filename, because naming a module is not saying the passport
 * holds a count: the lookbehind covers the whole noun group, and the
 * trailing 「not followed by a dot and more word characters」 keeps 「the
 * passport includes falls」 a claim while dropping `falls.summary.ts`,
 * the file this module's comments cite most often.
 *
 * 摔倒 is 跌倒's everyday synonym and the word a patient uses; a comment
 * written in it is the same claim.
 */
const FALL_NUMBER =
  /(?<![\w/.])(?:counts?|numbers?|figures?|totals?|tall(?:y|ies)|summar(?:y|ies))\b(?!\.\w)|(?<![\w/.])falls?(?!\.?\w)(?![/])|跌倒|摔倒|次数|\d+\s*次/gi;

/**
 * How far apart the two may sit and still be one claim, and the same
 * distance each hop of the co-surface pattern below allows. It is doing
 * real work rather than padding a regex: the HONEST fixture's PRE-FIX
 * falls.controller.ts sentence puts a 「counts」 no denial reaches in the
 * same sentence as the passport and claims nothing, because they are
 * 134 characters and two clauses apart — re-derived from that entry in
 * 'the two distances this file runs on'.
 *
 * THIS IS A BOUND, and the one an author is most likely to walk over:
 * 「The clinical passport, which a clinician opens from the share link,
 * also includes the quarterly fall count.」 puts 80 characters between
 * them, and only reaches the suite through the VERB path. The same
 * sentence with a verb outside RENDER_VERB is invisible here, and no
 * widening of the number list changes that. The flip is pinned at the
 * character in 'the two distances this file runs on'.
 */
const SAME_BREATH = 40;

/**
 * Verbs of putting a number on a surface — rendering it or holding it —
 * active AND passive, English AND Chinese. Demoted to a second path: it
 * catches the sentence that names the passport and a verb but no noun
 * of ours (「the passport renders it」), and the sentence whose number is
 * further from the passport than SAME_BREATH allows.
 *
 * The passive is not thoroughness for its own sake: falls.sql.ts wrote
 * its claim as「A patient shown「本季度 3 次」on the passport」, and a
 * list of active forms alone did not match a single character of it.
 * The Chinese half is here because PASSPORT already matches 护照 while
 * this list was English-only, so 「临床护照会一并展示…摔倒记录数目」 named
 * the surface, named a rendering, and hit nothing.
 *
 * STILL A CLOSED LIST, and that is the residual limit of this path: a
 * claim whose only verb is outside it (「the passport owns the quarterly
 * fall count」, 「本季度次数由护照负责」) reaches the suite through the
 * other two paths or not at all. Survivable because the proximity rule
 * needs no verb, but this path is not offered as coverage of the class.
 */
const RENDER_VERB =
  /\b(?:shows?|showed|shown|renders?|rendered|reads?|displays?|displayed|carries|carried|includes?|included|contains?|contained|lists?|listed|prints?|printed|surfaces?|surfaced|appears?|appeared|holds?|held)\b|展示|显示|呈现|列出|写入|写进|收录|印有|写有|带有|载有/gi;

/**
 * The other surfaces that really do hold this number. Written with
 * `\s*` through the Chinese ones because a wrapped comment line puts a
 * space inside 病程管理 once the paragraph is rejoined.
 */
const CO_SURFACE = /assistant|diary|screen|retriever|follow-?up|病程\s*管理|跌倒\s*记录/i;

/**
 * The passport standing in a list beside a surface that does render
 * this number, with neither a verb nor a number of its own. Five of the
 * ten sentences were the no-verb shape, and two of those name no number
 * either — this is the third path, for them (「Default look-back for the
 * diary and the passport count」).
 *
 * Narrow rather than broad. 「passport」 near a bare 「and」 would fire on
 * the shipped 「the passport is the artefact a patient forwards to a
 * clinician by link, and what a share exposes is governed by
 * sharing-preferences.ts」, which claims nothing about falls. So the
 * passport has to stand within SAME_BREATH characters of a surface that
 * does render this number.
 */
const PASSPORT_LISTED_WITH_A_REAL_SURFACE = new RegExp(
  `\\bpassport\\b[^.]{0,${SAME_BREATH}}?(?:\\band\\b|,)[^.]{0,${SAME_BREATH}}?(?:${CO_SURFACE.source})` +
    `|(?:${CO_SURFACE.source})[^.]{0,${SAME_BREATH}}?(?:\\band\\b|,)` +
    `[^.]{0,${SAME_BREATH}}?\\bpassport\\b`,
  'i',
);

/**
 * A negator counts only where it negates the claim it is next to.
 *
 * 「anywhere in the sentence」 exempts a sentence for words that have
 * nothing to do with the rendering. A character budget alone is not a
 * rule about attachment either, and was wrong both ways at once: too
 * generous forwards (「The passport includes the quarterly fall count,
 * not the raw rows.」, where the 「not」 denies the rows) and too mean
 * backwards (「It is not the passport that owns this quarterly fall
 * count.」, whose denial sits 40-odd characters from the number).
 *
 * So a denial has to satisfy BOTH: within NEGATOR_REACH of some part of
 * the claim, and reachable from it without crossing a clause break — a
 * comma, a semicolon, a colon, a dash or a Chinese equivalent. The
 * clause break is what stops a contrast in the next clause from
 * exempting the claim in this one; the distance is what stops a negator
 * about something else at the far end of a long clause from doing it.
 * And the whole claim is the anchor, not the token that happened to
 * match: 「It is not the passport」 denies the pair, so a denial counts
 * if it reaches EITHER the number or the passport it stands next to.
 *
 * TWO BOUNDS ARE LEFT, both pinned as tests rather than promised:
 *   - a denial in the NEXT clause of the same sentence does not reach
 *     back («… shows the quarterly count; the passport does not.»),
 *     pinned by 'reads a trailing denial as a claim';
 *   - a denial more than NEGATOR_REACH away inside its own clause does
 *     not reach either, pinned by 'the two distances this file runs on'.
 */
const NEGATOR = /\b(?:not|never|no|nothing|none|neither|nor)\b|不|没有|没|无/gi;
const NEGATOR_REACH = 24;
/** Where a denial stops being able to attach backwards or forwards. */
const CLAUSE_BREAK = /[,;:—–，；：、]|--/;

/** A span the claim is made of: [start, end). */
type Span = [number, number];

/**
 * Does this negator attach to any part of the claim — near enough, and
 * with no clause break between it and the part it would deny?
 */
const denies = (sentence: string, negator: RegExpExecArray, spans: Span[]): boolean =>
  spans.some(([start, end]) => {
    const [from, to] =
      negator.index < start ? [negator.index + negator[0].length, start] : [end, negator.index];
    if (to - from > NEGATOR_REACH) return false;
    return !CLAUSE_BREAK.test(sentence.slice(from, to));
  });

const negatedClaim = (sentence: string, spans: Span[]): boolean =>
  [...sentence.matchAll(NEGATOR)].some((negator) => denies(sentence, negator, spans));

const spanOf = (match: RegExpExecArray): Span => [match.index, match.index + match[0].length];

/** Characters between two spans, 0 where they touch or overlap. */
const gapBetween = (a: RegExpExecArray, b: RegExpExecArray): number =>
  Math.max(0, Math.max(a.index, b.index) - Math.min(a.index + a[0].length, b.index + b[0].length));

/**
 * Three paths, in the order they earn their keep: the number beside the
 * passport, then a rendering verb somewhere in a sentence that names
 * the passport, then the passport listed next to a surface that really
 * does hold this number.
 */
const numberInTheSameBreath = (sentence: string): boolean => {
  const passports = [...sentence.matchAll(PASSPORT)];
  return [...sentence.matchAll(FALL_NUMBER)].some((number) =>
    passports.some(
      (passport) =>
        gapBetween(number, passport) <= SAME_BREATH &&
        !negatedClaim(sentence, [spanOf(number), spanOf(passport)]),
    ),
  );
};

const rendersWithAVerb = (sentence: string): boolean =>
  [...sentence.matchAll(RENDER_VERB)].some((verb) => !negatedClaim(sentence, [spanOf(verb)]));

const listedWithARealSurface = (sentence: string): boolean => {
  const listed = PASSPORT_LISTED_WITH_A_REAL_SURFACE.exec(sentence);
  return listed !== null && !negatedClaim(sentence, [spanOf(listed)]);
};

/** `matchAll` rather than `test`, which on a /g regex carries lastIndex between calls. */
const mentionsThePassport = (sentence: string): boolean =>
  [...sentence.matchAll(PASSPORT)].length > 0;

const claimsThePassportRendersFalls = (sentence: string): boolean =>
  mentionsThePassport(sentence) &&
  (numberInTheSameBreath(sentence) ||
    rendersWithAVerb(sentence) ||
    listedWithARealSurface(sentence));

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
   * The comments below quote falls.controller.ts's shipped denial, and
   * an unchecked quotation is how the previous one rotted: the guard
   * stayed green while the sentence it quoted was reworded away.
   */
  it('quotes falls.controller.ts as it stands', () => {
    expect(read('falls/falls.controller.ts')).toContain('no reader may label it that way');
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
   * ten sentences it was written for. The second fixed that and was
   * still calibrated the same way — its verb list was the verbs these
   * ten sentences happen to use — so 「the passport INCLUDES the count」
   * walked through it. A fixture built only from removed prose can only
   * ever prove the detector catches yesterday, which is why there is a
   * third list.
   *
   * REMOVED_CLAIMS is the archive: every one of the ten sentences,
   * verbatim from HEAD, joined the way `commentSentences` joins a
   * wrapped comment, each carrying the file it came out of so the
   * counts in this file's header can be derived rather than recounted.
   * HONEST is the corrections that shipped in their place, plus the
   * sentences from HEAD that were already honest — falls.controller.ts
   * denied that the passport may label an empty quarter as「没摔过」in
   * the same paragraph as its false claim, and a guard that cannot tell
   * those two apart is no guard. UNWRITTEN_CLAIMS is the same claim in
   * words nobody in this repo has used.
   *
   * `from` is the FILE and not a line in it: the first version carried
   * line numbers into a revision nothing in this tree can read, and
   * five of the ten were off by one or two. The sentence text is
   * verbatim, which is what `git log -S` needs anyway; the file IS
   * checked against FALLS_SOURCES below.
   */
  const REMOVED_CLAIMS: Array<{ from: string; sentence: string }> = [
    {
      from: 'falls/falls.service.ts',
      sentence: 'The quarterly count the clinical passport shows.',
    },
    {
      from: 'falls/falls.service.ts',
      sentence: 'Default look-back for the diary and the passport count.',
    },
    {
      from: 'falls/falls.controller.ts',
      sentence: 'The quarterly count the clinical passport renders.',
    },
    {
      // The one wrapped across two comment lines.
      from: 'falls/falls.summary.ts',
      sentence:
        'It takes the rows FALL_HISTORY_SQL returns and produces (a) a quarterly count, which is what the clinical passport shows, and (b) one Chinese sentence, which is what the AI retriever hands to the model.',
    },
    {
      from: 'falls/falls.summary.ts',
      sentence:
        'Both come from the same numbers, computed once, because the passport and the assistant answering「我最近跌倒是不是更频繁了」are the same question asked twice.',
    },
    {
      from: 'falls/falls.summary.ts',
      sentence:
        'A quarter, because that is the interval the passport and a routine neurology follow-up both work in.',
    },
    {
      from: 'falls/falls.schema.ts',
      sentence:
        'Clamped to the same 730-day ceiling the followup retriever uses so the passport, the diary screen and the assistant cannot disagree about how far back「最近」reaches.',
    },
    {
      // The passive, which no active verb list reaches.
      from: 'falls/falls.sql.ts',
      sentence:
        'A patient shown「本季度 3 次」on the passport and told「你最近记录了 5 次」by the assistant has been given two facts about their own body and no way to tell which is real.',
    },
    {
      from: '../ai-agents/retrievers/patient-followups.ts',
      sentence:
        'The summary they feed is composed in patient-profile/falls/falls.summary.ts, which is also what the passport reads — one set of numbers, two renderings.',
    },
    {
      from: '../ai-agents/retrievers/patient-followups.ts',
      sentence:
        'The second is FALL_HISTORY_SQL, which owns the de-duplication between the two tables and is shared with the falls endpoints so the passport and the assistant cannot disagree.',
    },
  ];

  /**
   * The same claim, in words this repo has never used.
   *
   * Not an archive and not a wishlist of verbs to add: every one of
   * these is a sentence a maintainer could write on the day the falls
   * module grows a second reader, and the detector has to see it
   * without anyone editing a list first. Ordinary English verbs first,
   * then the shapes that change something other than the verb —
   * passive, Chinese, the number written as a Chinese figure, the
   * passport named in a possessive with no verb anywhere, a subordinate
   * clause between the passport and its number, and a contrast clause
   * whose negator denies something other than the claim.
   */
  const UNWRITTEN_CLAIMS = [
    'The clinical passport includes the quarterly fall count.',
    'The passport surfaces this number to the clinician.',
    'The count also appears on the clinical passport.',
    'The clinical passport lists the quarterly fall count.',
    'The passport contains the fall count.',
    'The passport includes falls.',
    'The fall count is printed on the clinical passport.',
    'The clinical passport prints the quarterly fall count for the clinician.',
    'Whatever else changes, the passport still lists the quarterly fall count.',
    'The passport, along with 病程管理, is where this number ends up.',
    '护照上的跌倒次数来自同一次查询。',
    'The passport headline is「本季度 3 次」.',
    "The passport's quarterly figure comes from the same query.",
    // A subordinate clause pushes the number 80 characters from the
    // passport, past SAME_BREATH; only the verb path sees this one.
    'The clinical passport, which a clinician opens from the share link, also includes the quarterly fall count.',
    // The negator denies the rows, not the count. Both of these were
    // exempted while a denial was a distance rather than an attachment,
    // and the second dies on a verb this file has always held.
    'The passport includes the quarterly fall count, not the raw rows.',
    'The passport shows the quarterly count, not the raw rows.',
    // Chinese in a vocabulary neither 跌倒 nor 次数 nor N 次.
    '临床护照会一并展示患者最近三个月的摔倒记录数目。',
    '这个数字也会写进临床护照。',
    // The passport named as a destination rather than a renderer.
    'The count reaches the passport unchanged.',
    'The passport takes the quarterly count straight from buildFallsSummary.',
    'Two surfaces consume it: 病程管理, and the passport.',
  ];

  const HONEST = [
    // Verbatim from the corrected files. If the guard rejects these it
    // is rejecting the correction it exists to enforce.
    'The clinical passport does NOT render a fall count.',
    'Not the clinical passport — that surface renders no falls.',
    '(Not the clinical passport: it renders no falls at all.)',
    'Comments in this module used to say it did, in five files, and none of it was ever true — profile.passport.ts has no falls reader at all.',
    'Putting one there is a product decision and a disclosure decision (the passport is the artefact a patient forwards to a clinician by link, and what a share exposes is governed by sharing-preferences.ts), so it is not something to assert in a doc comment ahead of making it.',
    // falls.controller.ts as it stood BEFORE the correction: honest, in
    // the same paragraph as a false claim, which is the reason a denial
    // is scoped to the claim rather than dropped. Not what ships today
    // — the shipped line reads 「no reader may label it that way」 and
    // never names the passport, so it clears the guard trivially
    // ('quotes falls.controller.ts as it stands' pins that wording).
    'Returns zeroed counts and an empty `quarters` array for a patient with no falls on record — which is NOT the same as a patient who has not fallen, and the passport must not label it that way.',
    // The shapes a future correction is likely to reach for.
    'The passport never showed a fall count and does not show one now.',
    'A passport share exposes no falls data.',
    'Nothing about falls reaches the passport DTO.',
    '临床护照不显示跌倒次数。',
    // A denial that leads the sentence by more than NEGATOR_REACH, and
    // therefore has to reach the passport rather than the number.
    'It is not the passport that owns this quarterly fall count.',
    // Naming this folder is not claiming to read it: the second path
    // widened from a verb list to「the passport and a number in one
    // sentence」, and a path segment is not a number. `falls.summary.ts`
    // is a filename in which `summary` is not this module's number.
    'The passport is built in profile.passport.ts, which imports nothing from falls/.',
    'profile.passport.ts does not import falls/falls.summary.ts.',
    'profile.passport.ts imports nothing from falls.summary.ts.',
    'profile.passport.ts and falls.summary.ts are separate modules.',
  ];

  it.each(REMOVED_CLAIMS)('reads as a claim: $sentence', ({ sentence }) => {
    expect(claimsThePassportRendersFalls(sentence)).toBe(true);
  });

  it.each(UNWRITTEN_CLAIMS)('reads as a claim, in words nobody used: %s', (sentence) => {
    expect(claimsThePassportRendersFalls(sentence)).toBe(true);
  });

  it.each(HONEST)('reads as honest: %s', (sentence) => {
    expect(claimsThePassportRendersFalls(sentence)).toBe(false);
  });

  /**
   * A number stated in prose about the array directly below it is
   * exactly the defect this whole file exists to catch, so every count
   * this file's comments state about the archive is derived here and
   * the prose has to match, not the other way round. Two halves:
   *
   *   DERIVED — every prose sentence in this file that states a count
   *   about the archive, rebuilt here from REMOVED_CLAIMS and
   *   FALLS_SOURCES and asserted to appear verbatim in the comments.
   *   Reword one past its derived form and this goes red.
   *
   *   ACCOUNTED-FOR — a scan for a number word attached to `sentences`,
   *   `files`, `archive`, `list` or `array` anywhere in this file's
   *   comments. Every hit has to sit inside a DERIVED string or inside
   *   NOT_THE_ARCHIVE, so a new counting sentence nobody derived fails
   *   here.
   */
  const NUMBER_WORDS = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
  ];
  /** A comment line is 72 columns and opens with ' * '. */
  const COMMENT_LINE_BUDGET = 69;

  /**
   * Number words this file's comments attach to something countable
   * about the archive. `of the N` is here because it is how a stale
   * numerator hides — 「four of the eight」 names no noun at all.
   */
  const COUNTS_SOMETHING = new RegExp(
    `of the (?:${NUMBER_WORDS.join('|')})\\b` +
      `|\\b(?:${NUMBER_WORDS.join('|')})\\b(?:\\W+\\w+){0,3}?\\W+(?:sentences|files)\\b` +
      `|\\b(?:archive|list|array)\\b(?:\\W+\\w+){0,3}?\\W+(?:${NUMBER_WORDS.join('|')})\\b`,
    'gi',
  );

  /**
   * Number words in this file's comments that are NOT counting the
   * archive — quotations of the wrong count this file exists to record,
   * and ordinary sentences that happen to put a number beside one of
   * the scan's nouns. Exact fragments, so a reword of any of them has
   * to come past here.
   */
  const NOT_THE_ARCHIVE = [
    // An ordinary sentence that happens to put a number next to one of
    // the scan's nouns.
    'two sentences, the denial in its own',
    // Not a count of the array: how many of the line numbers the first
    // version of the archive carried were wrong, measured once against
    // a revision this tree cannot read.
    'five of the ten were off by one or two',
    // Quotations of a count this file records as WRONG. These must not
    // track the arrays — that is the point of quoting them — so they
    // are listed here rather than derived.
    '「four of the eight」',
    '「Only three of the ten sentences ever named a number.」',
  ];

  it('states its own archive, and states it right', () => {
    const verbBearing = REMOVED_CLAIMS.filter((entry) => rendersWithAVerb(entry.sentence));
    // 「two of those name no number either」, from the co-surface
    // pattern's own doc comment: the two the third path alone can see.
    const coSurfaceOnly = REMOVED_CLAIMS.filter(
      (entry) =>
        !rendersWithAVerb(entry.sentence) &&
        !numberInTheSameBreath(entry.sentence) &&
        listedWithARealSurface(entry.sentence),
    );
    expect(coSurfaceOnly).toHaveLength(2);
    const files = [...new Set(REMOVED_CLAIMS.map((entry) => entry.from))];
    // Every cited file is one the guard above actually reads. A claim
    // archived out of a file nothing scans is an archive of nothing.
    files.forEach((file) => expect(FALLS_SOURCES, file).toContain(file));
    // 「the three short enough to fit inside one comment line」 — the
    // measurement behind the「caught three of the ten」claim.
    const oneLiners = REMOVED_CLAIMS.filter(
      (entry) => entry.sentence.length <= COMMENT_LINE_BUDGET,
    );
    const inFallsModule = files.filter((file) => file.startsWith('falls/'));
    const fallsModuleFiles = FALLS_SOURCES.filter((file) => file.startsWith('falls/'));

    const n = (value: number): string => {
      // A loud failure rather than an `undefined` interpolated into an
      // expected string, which reads as a broken test rather than as a
      // list that outgrew its words.
      expect(NUMBER_WORDS[value], `no number word for ${value}; extend NUMBER_WORDS`).toBeDefined();
      return NUMBER_WORDS[value];
    };
    /** Same number word, at the head of a sentence. */
    const N = (value: number): string => n(value).replace(/^./, (c) => c.toUpperCase());
    const total = n(REMOVED_CLAIMS.length);

    /** Every count this file's comments state about the archive. */
    const DERIVED = [
      `ARCHIVE: ${total} sentences, ${n(verbBearing.length)} verb-bearing and ` +
        `${n(REMOVED_CLAIMS.length - verbBearing.length)} noun-phrase, from ${n(files.length)} files.`,
      `SPLIT: ${n(verbBearing.length)} of the ${total} carried a rendering verb and ` +
        `${n(REMOVED_CLAIMS.length - verbBearing.length)} named the passport as a holder with no verb at all.`,
      `REACH: ${n(inFallsModule.length)} of the ${n(files.length)} files are in falls/ itself.`,
      `The falls module used to tell the maintainer, in ${n(inFallsModule.length)} files, ` +
        `that the clinical passport renders the quarterly fall count.`,
      `the module's own comments put the claim in ${n(inFallsModule.length)} files and the ` +
        `archive below cites ${n(files.length)} files`,
      `It caught ${n(oneLiners.length)} of the ${total} sentences it was written for: ` +
        `the ${n(oneLiners.length)} short enough to fit inside one comment line, and no others.`,
      `that list was written by reading the ${total} sentences that had been removed`,
      `${N(REMOVED_CLAIMS.length - verbBearing.length)} of the ${total} sentences were the no-verb shape, ` +
        `and ${n(coSurfaceOnly.length)} of those name no number either`,
      `falls/ holds ${n(fallsModuleFiles.length)} .ts files besides this one, and the retriever ` +
        `makes ${n(FALLS_SOURCES.length)}.`,
      `it shipped able to catch ${n(oneLiners.length)} of the ${total} sentences it was written for`,
      `its verb list was the verbs these ${total} sentences happen to use`,
      `archive: every one of the ${total} sentences, verbatim from HEAD`,
      `the measurement behind the「caught ${n(oneLiners.length)} of the ${total}」claim`,
    ];

    const sentences = commentSentences(fs.readFileSync(__filename, 'utf8'));
    const prose = sentences.join(' ');
    DERIVED.forEach((statement) => expect(prose, statement).toContain(statement));

    // The other direction: nothing counts the archive off-book. Every
    // number word the scan attaches to a countable noun has to sit
    // inside one of the derived statements or be declared not to be
    // about the archive.
    const covered = [...DERIVED, ...NOT_THE_ARCHIVE];
    // Per sentence, not over the joined prose: a scan that ran across a
    // full stop would report a phrase no reader ever sees.
    const scan = (text: string) => [...text.matchAll(COUNTS_SOMETHING)].map((match) => match[0]);
    // A scan that matched nothing would pass this test for the wrong
    // reason; the derived list alone puts this many in reach.
    expect(sentences.flatMap(scan).length).toBeGreaterThanOrEqual(DERIVED.length);
    // Coverage is by REMOVAL, not by 「some approved string also contains
    // this phrase」: a new sentence that reuses a phrasing already
    // approved elsewhere — 「Only three of the ten sentences ever named a
    // number.」 — passes a containment check and is exactly the thing
    // this half is for.
    const unaccounted = sentences.flatMap((sentence) =>
      scan(covered.reduce((rest, statement) => rest.split(statement).join(' … '), sentence)),
    );
    expect(unaccounted, 'counts stated in a comment that nothing here derives').toEqual([]);
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
   * The two distances this file runs on, pinned at the character where
   * each one flips.
   *
   * With LITERALS, and the constants asserted separately. `apart(gap)`
   * builds its string FROM its argument, so a flip written as
   * `apart(SAME_BREATH)` / `apart(SAME_BREATH + 1)` holds at every value
   * of SAME_BREATH and pins nothing at all.
   */
  it('the two distances this file runs on', () => {
    // Neutral filler: no passport, no number of ours, no verb from the
    // list, no negator, no clause break.
    const filler = (length: number): string =>
      ' that a patient forwards by link to a clinician somewhere else again'.slice(0, length);
    /** `passport`, then exactly `gap` characters, then `count`. */
    const apart = (gap: number): string => `The passport${filler(gap - 1)} count.`;
    /** A denial, then exactly `reach` characters, then the claim. */
    const denialAhead = (reach: number): string => `Not${filler(reach - 1)} passport count.`;
    expect(filler(40)).toHaveLength(40);

    // SAME_BREATH. Nothing to go on but how far apart the two anchors
    // sit — which is the shape 「The clinical passport, which a clinician
    // opens from the share link, ends up with the quarterly fall
    // count.」 has, once its verb is one this file does not hold.
    expect(SAME_BREATH).toBe(40);
    expect(apart(40)).toContain('passport');
    expect(claimsThePassportRendersFalls(apart(40))).toBe(true);
    expect(claimsThePassportRendersFalls(apart(41))).toBe(false);

    // NEGATOR_REACH, backwards: 「It is not the passport…」 denies the
    // pair from in front of it, and has to reach the passport rather
    // than the number to do it.
    expect(NEGATOR_REACH).toBe(24);
    expect(claimsThePassportRendersFalls(denialAhead(24))).toBe(false);
    expect(claimsThePassportRendersFalls(denialAhead(25))).toBe(true);

    // And the 134 the SAME_BREATH doc comment cites, re-derived from
    // the fixture entry it is about rather than remembered.
    const zeroed = HONEST.find((sentence) => sentence.startsWith('Returns zeroed counts'))!;
    const counts = zeroed.indexOf('counts');
    expect(zeroed.indexOf('passport') - (counts + 'counts'.length)).toBe(134);
  });

  /**
   * The bound, stated as a test rather than as a promise: a denial that
   * trails another surface's claim inside ONE sentence reads as a
   * claim, because it sits in the next clause and nothing here parses
   * English well enough to attach it backwards. The fix for an author
   * who hits this is the shape the corrected files already use: two
   * sentences, the denial in its own.
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

  /**
   * The widest bound, and the one that survives widening the detector.
   *
   * The full list, so that no reader has to infer it: RENDER_VERB is a
   * closed list ('reads as a claim, in words nobody used' is the only
   * thing keeping it honest); SAME_BREATH and NEGATOR_REACH are
   * distances, pinned in 'the two distances this file runs on'; a
   * denial in the next clause does not reach back, pinned in 'reads a
   * trailing denial as a claim'; and this one — both anchors have to be
   * in the SAME sentence, so a claim that names the passport in one
   * sentence and its number in the next is invisible here, whatever the
   * number list or the verb list holds. Attaching a pronoun to a
   * subject across a full stop is the thing this file is not able to
   * do, so it does not claim to.
   */
  it('cannot see a claim split across two sentences, and says so', () => {
    expect(
      sentencesClaimingThePassportRendersFalls(
        '// The passport is the second rendering. It carries the quarterly count.',
      ),
    ).toEqual([]);
    expect(
      sentencesClaimingThePassportRendersFalls(
        '// The passport is the second rendering and carries the quarterly count.',
      ),
    ).toHaveLength(1);
  });
});
