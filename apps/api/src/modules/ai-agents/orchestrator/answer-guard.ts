/**
 * THE LAST PASS OVER WHAT LEAVES THE SERVER TOWARD THE PATIENT.
 *
 * `security/pii-redactor.ts` is the last pass over what leaves the
 * server toward the MODEL: one place, positioned last, deny-by-default,
 * and it states what it withheld rather than silently editing. This is
 * the same discipline pointed the other way, and it exists because the
 * other direction was never guarded at all.
 *
 * WHY A PROMPT RULE WAS NOT ENOUGH, MEASURED RATHER THAN ARGUED. The
 * previous round wrote the rules out explicitly. `CLINICAL_INFERENCE_BOUNDS`
 * in run.ts names 「1–3 个重复单元属于病情较严重的遗传基础」 as forbidden
 * and closes the hedge loophole in the same bullet
 * (「前面加上「通常」「往往」「可能」也一样不行——落在他的数字上它就是
 * 预测」); the methylation bullet says 「不要自己划一条线」. Driven against
 * the running stack with a synthetic patient carrying d4z4Repeats: '3',
 * haplotype: '4qA', methylationValue: '95%', the model broke both on the
 * patient's own numbers — the severity claim arrived inside a table
 * whose column header was 「对你个人的意义」 (so it was never a sentence
 * with 「你」 in it), and the methylation value was graded
 * (「95% 这个数值高出常规预期」). The rules are correctly written and the
 * model does not obey them. A rule that is only asserted is not a
 * control.
 *
 * ---------------------------------------------------------------------
 * WHAT THE SECOND ROUND AGAINST THE STACK CHANGED, AND WHY IT IS A
 * CHANGE OF SHAPE RATHER THAN A LIST OF PATCHES.
 *
 * The first version of this file was four checks, and each one was a
 * fact ANDed with a lexicon. Driven again, the model went through the
 * lexicons and the windows, not through the facts:
 *
 *   - it kept the severity claim and typed 「在群体研究层面」 in front of
 *     it, which the escape below used to accept, and then named the
 *     band 1–3 — the band the reader is standing in;
 *   - it bolded the word being matched, so 「**更严重受累**」 reached a
 *     lexicon that had never seen an asterisk;
 *   - it answered a follow-up whose number lived in the conversation
 *     rather than in this turn's retrieval, where the number set was
 *     empty and every check stood down;
 *   - it printed 「诊断范围（1-10）」 in a 参考范围 column, which no check
 *     looked at.
 *
 * So the rule this file is now built to, stated once and applied
 * everywhere below:
 *
 *   A CHECK IS GROUNDED IN A FACT THIS TURN HOLDS WHEREVER ONE EXISTS.
 *   Which numbers are his; which cells carry this platform's reading;
 *   what the retrieved chunks and the rendered projection actually say;
 *   which intervals his record printed. A fact cannot be paraphrased
 *   around, and it is the half of every rule below that does the work.
 *
 *   WHERE NO FACT CAN ANSWER IT, THE LEXICON SAYS SO IN ITS OWN COMMENT
 *   AND FAILS TOWARD SILENCE. 「严重」 is not derivable from anything the
 *   turn holds and never will be; neither is 参考范围. Those lists are
 *   marked, and every one of them is used to DECIDE TO WITHHOLD rather
 *   than to decide to publish — a word the list is missing costs a
 *   sentence that should have been cut, never a sentence that should
 *   have been kept.
 *
 *   AND EVERY LEXICON IS MATCHED AGAINST NORMALISED TEXT, once, in one
 *   place. See `normaliseForMatch`.
 *
 * ---------------------------------------------------------------------
 * WHAT EACH CHECK IS DERIVED FROM — none of them is a list of forbidden
 * claims, because a list of claims is what the prompt already is:
 *
 *   1. A severity / prognosis / progression / onset claim attached to
 *      THIS PATIENT'S number. The turn knows which numbers are theirs:
 *      they are in the projection this run built, or — on a follow-up
 *      that retrieved nothing — in the conversation this run is
 *      holding. A word list would have to guess; this asks whether the
 *      sentence carries one of *their* values, or a band containing it.
 *   2. A grading of a cell this platform declines to grade. The turn
 *      knows which cells it graded: a cell that travelled with a
 *      `_clinical` sibling has this platform's reading, a cell that
 *      travelled without one does not, and methylation is permanently
 *      the second kind because no file in this repo states a boundary.
 *      So the guard does not carry a list of ungradable cells; it reads
 *      the projection and treats every reading-less cell the same way.
 *   3. A mechanism no retrieved source states. The turn holds the
 *      retrieved chunks AND its own rendered rows. A causal sentence
 *      carrying no citation whose every 4-character shingle is absent
 *      from both was composed here, not read.
 *   4. A claim that the record does not hold a cell it does hold.
 *      `numericValuesWithheld` is an absence produced by CONSENT, and
 *      the model read it as an absence of the finding —
 *      「但是，这里面没有甲基化的结果」 to a patient whose report says
 *      95%. The turn knows the cell is on file: it is in the raw
 *      retriever payload and not in the rendered projection. What the
 *      check asks is whose absence the sentence asserts — the REPORT'S
 *      or this assistant's — because only the first one is false.
 *   5. A reference interval the record never printed. A 参考范围 cell is
 *      a claim about what the LABORATORY printed beside the patient's
 *      value. The turn holds every interval the record actually
 *      carried, so an interval that is not one of them was composed
 *      here — and it reaches the patient looking exactly like the
 *      laboratory's own.
 *
 * WHAT IT DOES WHEN IT FIRES — see `buildRegenerationDirective` and
 * `buildExcisionNotice`. Briefly: regenerate once with the offending
 * sentences quoted back, and if the second answer still violates, excise
 * exactly those sentences, RE-INSPECT WHAT IS LEFT (see
 * `exciseUntilClean`), and TELL THE PATIENT what was removed and why.
 * Refusing the whole answer was considered and rejected: this is a
 * patient who asked a direct question about their own report, this
 * platform's own readings of that report are legitimate answers to it,
 * and withholding them punishes the patient for the model's error. A
 * silent excision was rejected for the reason stated on
 * `markDegraded` — a caveat the patient cannot see is not a caveat.
 *
 * ---------------------------------------------------------------------
 * WHAT THIS FILE STILL CANNOT SEE, measured against the running stack in
 * the same session that produced the fixes above. Both fail toward
 * PUBLICATION, which is why they are written down here rather than left
 * for the next round to rediscover:
 *
 *   - A TURN THAT DOES NOT KNOW THE NUMBER IS HIS. Asked
 *     「帮我总结一下文献里 D4Z4 重复数和发病年龄的关系」 — a question
 *     that names no record — nothing retrieved the patient's report and
 *     nothing in the conversation named a count, so the model published
 *     「1–3 个重复单元的患者病情通常较严重」 to a patient whose count is
 *     3 and check 1 had nothing to fire on. THIS IS NOT CLOSEABLE WITH A
 *     LEXICON and must not be attempted with one: the same table is the
 *     correct answer to the same question asked by someone whose count
 *     is 30, and a guard that deleted it would be deleting the
 *     encyclopedia. What closes it is the retrieval — the rule in
 *     `companion-tools.ts` that adds `get_my_reports` when the
 *     conversation is about the patient's own material, widened to a
 *     question that asks about the bands their own report is in. That
 *     is a change to which tools run, which is that file's decision and
 *     not this one's.
 *   - A CLAIM ASSEMBLED ACROSS TWO PERMITTED SENTENCES. Observed:
 *     「3 个重复单元在 FSHD 人群里确实属于较短的范围。」 followed by
 *     「在群体层面，重复数越短，总体上发病往往越早、表型往往越重。」
 *     Neither sentence is a violation — the first states his value and
 *     says only that it is short, the second is the cohort finding the
 *     prompt permits — and together they are the syllogism. The unit
 *     this file judges is a segment; a two-step inference across
 *     segments is not something a segment-level check sees, and pooling
 *     adjacent sentences to catch it would condemn every honest answer
 *     that states a value and then states the population trend, which is
 *     the shape this platform asks for.
 *   - A BAND THAT REACHES A BULLET LIST THROUGH ITS LEAD-IN. The two
 *     inheritances below — a nested item from its label, a sentence
 *     from the sentence it points back at — cover the shapes that were
 *     observed. They do not cover
 *     「你落在 1–3 这一档。这一档在临床上通常关联着：」 followed by
 *     「- 发病年龄相对较早」, where the band reaches the bullets through
 *     a lead-in that is not itself a list item. Propagating numbers
 *     from any colon-terminated lead-in WAS tried and rejected: it
 *     condemns 「你的重复数是 3，下面是随访建议：」 followed by
 *     「- 每年复查一次，注意病程变化」 — a follow-up plan, deleted for
 *     the word 病程. Deleting a patient's follow-up advice to catch one
 *     more phrasing of a trend they were told two lines earlier is the
 *     wrong trade, and this is the line where the inheritance stops.
 *
 * ---------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT OWN, said loudly rather than quietly worked
 * around:
 *
 *   - THE LOCALISATION TABLE BELONGS IN security/, NOT HERE.
 *     `WIRE_TOKEN_ZH` maps this platform's wire vocabulary onto Chinese
 *     a patient can read. Those tokens are MINTED in
 *     security/pii-redactor.ts (`within_fshd1_repeat_range`,
 *     `permissive_haplotype`, the `GENETIC_READING_REFUSALS` set) and in
 *     security/render.ts (`numericValuesWithheld`, the block headings),
 *     and the Chinese for each belongs beside the token it names. It is
 *     here because those files are another lane's this round. The cost
 *     of that is exact and worth writing down: a reading label added
 *     over there does not fail to compile over here — it just reaches a
 *     patient as a snake_case identifier, which is the defect this
 *     table exists to fix. `answer-guard.test.ts` runs the real redactor
 *     over every genetics branch and fails when a label it emits has no
 *     entry here, which converts that silence into a red test but does
 *     not make the table's home correct.
 *   - THE CELL VOCABULARY (`CELL_TERMS`) is the same shape of borrowing:
 *     `pii-redactor.ts` already classifies a payload key onto a genetics
 *     cell (its `GeneticCellBranch` / `branchOf`), and this file asks the
 *     same question of the same keys with its own copy. Exporting that
 *     classifier is the fix.
 */

import {
  CEILING_EXCLUSIVE,
  CEILING_INCLUSIVE,
  CEILING_INCLUSIVE_DIGRAPHS,
  FLOOR_EXCLUSIVE,
  FLOOR_INCLUSIVE,
  FLOOR_INCLUSIVE_DIGRAPHS,
  PRINTED_NUMBER,
  RANGE_SEPARATOR_SOURCE,
} from '../../../utils/clinical-notation.js';
import { HARD_DELETE_KEYS_LOWER } from '../security/allowlist.js';

// ------------------------------------------------------------ normalisation

/**
 * MARKDOWN IS LAYOUT. EVERY CHECK BELOW IS ABOUT WORDS.
 *
 * The single most effective thing the model did against the first
 * version of this file was to emphasise the word being matched. Driven
 * against the stack it wrote 「**在群体研究层面，D4Z4 重复数 1–3 确实与
 * 更早发病、更严重的病情相关**」 and 「1–3 个重复单元的患者被描述为
 * **「更严重受累」**」; a `**` sitting inside 「更严重」 does not split it,
 * but 「更**严重**」 does, and the model produces both. The same holds
 * for every other lexicon here — 甲基化, 参考范围, 没有 — and for the
 * cell terms the proximity rules are measured from.
 *
 * So the emphasis characters come off ONCE, here, and every check reads
 * `Segment.match` rather than `Segment.text`. The verbatim text is what
 * gets quoted back to the model and what the excision has to find
 * again, so it is kept beside it rather than replaced.
 *
 * `*` and backtick are removed unconditionally — neither is a word
 * character in Chinese or in this platform's vocabulary.
 *
 * SINGLE `~` IS NOT EMPHASIS, AND STRIPPING IT WAS BLINDING THE CHECK
 * THAT NEEDS IT MOST. No fact-versus-lexicon question arises here: this
 * file already states, as a fact about its own vocabulary, that `~` is a
 * BAND SEPARATOR — `BAND_SOURCE` lists it beside `–`, `～`, 到 and 至,
 * and the canonical interval key `intervalsIn` mints is literally
 * `${low}~${high}`. Every check reads the normalised text, so a band the
 * model wrote 「1~3」 arrived at `carriesBandAround` as the four-digit
 * string 13: the severity check saw no band, the reference-range check
 * saw no interval, and the one notation this file uses for a band
 * internally was the one notation it could not read. Markdown
 * strikethrough is `~~` and only `~~`, so that is what comes off.
 *
 * SINGLE `_` IS DELIBERATELY LEFT: this platform's own wire tokens are
 * snake_case (`not_read_off_a_laboratory_report`), the localisation
 * above runs before any of this, and mangling an unrecognised token
 * into one word would hide it from the eyes that have to notice it.
 * `__` — which can only be emphasis — is removed.
 */
const ZERO_WIDTH = /[\u200b-\u200f\u2060\ufeff]/gu;
const EMPHASIS = /\*|`|~~|__/gu;

export const normaliseForMatch = (text: string): string =>
  text.replace(ZERO_WIDTH, '').replace(EMPHASIS, '');

// ---------------------------------------------------------------- vocabulary

/**
 * Which genetics cell a payload key belongs to, and the words a Chinese
 * answer uses for that cell.
 *
 * NOT a list of the cells this guard governs — that comes from the
 * projection, one function down. This only answers 「the turn carried a
 * cell; what would a sentence about it look like」, which is a question
 * no derivation can answer for you: you cannot find a claim about
 * methylation without knowing the word 甲基化.
 *
 * `keyMatch` is matched case-insensitively as a substring of the payload
 * key, which is how `pii-redactor.ts` routes the same keys onto the same
 * four branches. See the note at the top of this file.
 */
const CELL_TERMS: Readonly<Record<string, { keyMatch: string; terms: readonly string[] }>> = {
  d4z4: { keyMatch: 'd4z4', terms: ['D4Z4', '重复数', '重复单元', '拷贝数'] },
  haplotype: { keyMatch: 'haplotype', terms: ['单倍型', '4qA', '4qB'] },
  methylation: { keyMatch: 'methylation', terms: ['甲基化'] },
  ecori: { keyMatch: 'ecori', terms: ['EcoRI', '片段长度'] },
};

const CELL_NAMES = Object.keys(CELL_TERMS);

/** The cell a payload key belongs to, or null for a key that is not a
 *  genetics cell at all (`gender`, `status`, `spanDays`…). */
const cellOfKey = (key: string): string | null => {
  const lower = key.toLowerCase();
  return CELL_NAMES.find((cell) => lower.includes(CELL_TERMS[cell].keyMatch)) ?? null;
};

/** Chinese for the cell, used in the excision notice. */
const CELL_LABEL_ZH: Readonly<Record<string, string>> = {
  d4z4: 'D4Z4 重复数',
  haplotype: '单倍型',
  methylation: '甲基化',
  ecori: 'EcoRI 片段长度',
};

/**
 * Keys whose numeric value is a CALENDAR or a TALLY rather than a
 * measurement of this patient's body.
 *
 * They are excluded from the number set because they are the numbers a
 * safe sentence is most likely to contain: 「2019 年确诊以来…」 pairs a
 * year with a progression word in every honest answer that mentions when
 * the patient was diagnosed. A measurement never appears that way.
 */
const NON_MEASUREMENT_KEY = /year|date|time|count|days|_at$|index|id$/i;

// ------------------------------------------------------------ wire tokens

/**
 * This platform's wire vocabulary, in Chinese.
 *
 * Every one of these was OBSERVED reaching a patient verbatim. Driven
 * against the running stack: 「单倍型是 4qA，属于「允许型」（permissive）」,
 * 「你的报告里有些字段标注了 not_read_off_a_laboratory_report」 — followed
 * by the model's own invented gloss of what that token means — and
 * 「目前上传的是基因检测报告（genetic_report）」.
 *
 * Substitution rather than a violation, deliberately. A wire token in
 * the answer is a RENDERING fault, not a claim the platform forbids:
 * the sentence around it is usually correct and the patient is entitled
 * to it. Regenerating for it would spend an LLM call to fix a string
 * replacement, and excising it would delete a true sentence. So the
 * guard rewrites the token in place and records that it did.
 *
 * Ordered longest-first at use, so
 * `within_fshd1_repeat_range_grey_zone_8_to_10` is not half-consumed by
 * `within_fshd1_repeat_range`.
 */
export const WIRE_TOKEN_ZH: Readonly<Record<string, string>> = {
  // --- readings (minted in pii-redactor.ts `clinicaliseD4Z4` / `clinicaliseHaplotype`)
  within_fshd1_repeat_range_grey_zone_8_to_10: '这个重复数落在 8–10 这段说不准的区间里',
  within_fshd1_repeat_range: '这个重复数落在 FSHD1 的范围里',
  above_fshd1_repeat_range: '这个重复数在 FSHD1 的范围之上',
  permissive_haplotype: '允许型单倍型',
  non_permissive_haplotype: '非允许型单倍型',
  // --- refusals (pii-redactor.ts `GENETIC_READING_REFUSALS`)
  not_read_off_a_laboratory_report: '本平台没有把这一格当成化验报告上的读数',
  length_in_kb_not_a_repeat_count: '这一格记的是长度（kb），不是重复单元数',
  other_allele_not_the_contracted_one: '这一格是另一条等位基因，不是收缩的那一条',
  repeat_count_not_read_against_fshd1_range_non_permissive_haplotype:
    '同一份报告写的是非允许型，所以本平台没有拿这个重复数去对 FSHD1 的范围',
  zero_repeat_count_not_a_valid_reading: '这一格写的是 0，本平台不把它当成有效读数',
  unspecified_haplotype: '这一格没有写明是哪一型',
  unspecified: '这一格没有写明',
  // --- projection bookkeeping (render.ts / pii-redactor.ts)
  numericValuesWithheld: '按当前授权扣下的测量值个数',
  fieldsDroppedAsUnsafe: '因为无法确认而没有发出的格子数',
  methylation_withheld: '甲基化数值（有结果在案，按当前授权没有发出）',
  value_withheld: '有结果在案，按当前授权没有发出',
  fields_clinical: '本平台对报告字段的判读',
  classifiedType: '报告类型',
  genetic_report: '基因检测报告',
};

/**
 * A bare English word this platform never says to a patient, handled
 * separately from the snake_case tokens because it is a WORD and a
 * substring rule would eat `permissive_haplotype`'s tail.
 */
const BARE_WIRE_WORD: Readonly<Record<string, string>> = {
  permissive: '允许型',
  'non-permissive': '非允许型',
};

/**
 * THE SUFFIX IS THE VOCABULARY, so this one is a shape rather than a
 * list.
 *
 * `WIRE_TOKEN_ZH` above can only carry the keys somebody remembered to
 * add, and the projection mints a key per CELL: `methylation_clinical`,
 * `d4z4Repeats_origin`, `haplotype_withheld`. Driven against the running
 * stack, the model wrote 「判读栏里没有 methylation_clinical 这个字段」 —
 * a true and useful sentence with a snake_case identifier in the middle
 * of it, and the table has no entry for that key because the table is a
 * list of keys.
 *
 * `_clinical` / `_origin` / `_withheld` are the projection's own naming
 * convention (see `projectOcrFields` in security/pii-redactor.ts), so
 * the suffix is derivable where the key is not. Applied AFTER the exact
 * table, so `fields_clinical` — which has its own better wording — is
 * already gone by the time this runs.
 */
const WIRE_SUFFIX_ZH: ReadonlyArray<{ pattern: RegExp; zh: string }> = [
  {
    pattern: /(?<![0-9A-Za-z_])[A-Za-z][0-9A-Za-z]*_clinical(?![0-9A-Za-z_])/gu,
    zh: '这一格的「本平台判读」',
  },
  {
    pattern: /(?<![0-9A-Za-z_])[A-Za-z][0-9A-Za-z]*_origin(?![0-9A-Za-z_])/gu,
    zh: '这一格的「来源」',
  },
  {
    pattern: /(?<![0-9A-Za-z_])[A-Za-z][0-9A-Za-z]*_withheld(?![0-9A-Za-z_])/gu,
    zh: '这一格的「按当前授权没有发出」',
  },
];

const WIRE_TOKENS_LONGEST_FIRST = Object.keys(WIRE_TOKEN_ZH).sort((a, b) => b.length - a.length);

/** `-` is deliberately not escaped: it is only special inside a
 *  character class, nothing here interpolates into one, and `\-` is an
 *  invalid escape under the `u` flag. */
const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * THE MODEL OFTEN GETS THIS RIGHT AND THEN SHOWS ITS WORKING.
 *
 * Driven against the stack, asked to gloss the Chinese term with its
 * English original, the model wrote 「你的单倍型是 4qA，对应的是
 * 「允许型（permissive）」单倍型」 — the Chinese is already there, the
 * English is a parenthetical beside it, and the blind substitution below
 * turned that into 「允许型（允许型）」. A stutter in the one sentence the
 * patient is reading for the answer is worse than the English word was:
 * the English word is inert, and the stutter reads as a broken system.
 *
 * A gloss is not a wire token reaching a patient — it is a wire token
 * being TRANSLATED, which is what this whole table is for. So the gloss
 * collapses to the Chinese, in both orders, and the substitution below
 * never sees it. Longest wire form first for the same reason the token
 * loop is: 「非允许型（non-permissive）」 must not be read as
 * 「允许型（permissive）」 with debris on either side.
 */
const GLOSS_PAIRS: ReadonlyArray<{ wire: string; zh: string }> = [
  ...Object.entries(WIRE_TOKEN_ZH),
  ...Object.entries(BARE_WIRE_WORD),
]
  .map(([wire, zh]) => ({ wire, zh }))
  .sort((a, b) => b.wire.length - a.wire.length);

const OPEN_BRACKET = '［【（(\\[「『';
const CLOSE_BRACKET = '］】）)\\]」』';
const CLOSING_QUOTE = '」』"”\'';

const collapseGlosses = (answer: string): { text: string; tokens: string[] } => {
  let text = answer;
  const tokens: string[] = [];
  for (const { wire, zh } of GLOSS_PAIRS) {
    const w = escapeForRegex(wire);
    const z = escapeForRegex(zh);
    // 「允许型（permissive）」 and 「「允许型」（permissive）」 — the closing
    // quote is kept, the bracket and the wire word go.
    const chineseFirst = new RegExp(
      `(${z}\\s*[${CLOSING_QUOTE}]?)\\s*[${OPEN_BRACKET}]\\s*${w}\\s*[${CLOSE_BRACKET}]`,
      'giu',
    );
    // 「permissive（允许型）」 — the same gloss written the other way up.
    const wireFirst = new RegExp(
      `${w}\\s*[${OPEN_BRACKET}]\\s*(${z})\\s*[${CLOSE_BRACKET}]`,
      'giu',
    );
    for (const pattern of [chineseFirst, wireFirst]) {
      if (!pattern.test(text)) continue;
      pattern.lastIndex = 0;
      tokens.push(wire);
      text = text.replace(pattern, '$1');
    }
  }
  return { text, tokens };
};

/** Substitute this platform's wire vocabulary for Chinese. Returns the
 *  rewritten text and the tokens that were actually present. */
export const localiseWireTokens = (answer: string): { text: string; tokens: string[] } => {
  const collapsed = collapseGlosses(answer);
  let text = collapsed.text;
  const tokens: string[] = [...collapsed.tokens];
  const note = (token: string) => {
    if (!tokens.includes(token)) tokens.push(token);
  };
  for (const token of WIRE_TOKENS_LONGEST_FIRST) {
    if (!text.includes(token)) continue;
    note(token);
    text = text.split(token).join(WIRE_TOKEN_ZH[token]);
  }
  for (const [word, zh] of Object.entries(BARE_WIRE_WORD)) {
    const pattern = new RegExp(`(?<![0-9A-Za-z_-])${escapeForRegex(word)}(?![0-9A-Za-z_-])`, 'gi');
    if (!pattern.test(text)) continue;
    note(word);
    text = text.replace(pattern, zh);
  }
  for (const { pattern, zh } of WIRE_SUFFIX_ZH) {
    pattern.lastIndex = 0;
    const found = text.match(pattern);
    if (!found) continue;
    for (const token of found) note(token);
    text = text.replace(pattern, zh);
  }
  return { text, tokens };
};

// ------------------------------------------------------------- the evidence

/** One of this patient's own values, and which cell it came from. */
export interface PatientNumber {
  value: number;
  /** The genetics cell it belongs to, or null for any other measurement. */
  cell: string | null;
  /** The unit the record printed beside it — 「%」, 「kb」 — or null when
   *  the record printed a bare number. See `restoreUnits`. */
  unit: string | null;
  /** How the turn knows this number is his. `record` — it is on a
   *  payload a patient-scoped retriever returned this turn. `conversation`
   *  — this turn retrieved nothing of his, and the number is one the
   *  conversation is carrying beside one of his cells. See
   *  `BuildGuardEvidenceInput.conversationTexts`. */
  origin: 'record' | 'conversation';
}

/**
 * What the turn holds, in the shape the checks ask questions of.
 *
 * Assembled by `buildGuardEvidence` from things the run already has: the
 * raw retriever payloads for the patient's own numbers, the rendered
 * rows for what this platform said about them, the retrieved chunks for
 * what a source states, and — only when the first of those is empty —
 * the conversation itself.
 */
export interface GuardEvidence {
  /** Every measurement on this patient's record, whether or not consent
   *  let it travel. A number the model never saw cannot be one it
   *  reasoned from, so including it costs nothing and closes the case
   *  where the value reached the model through replayed history. */
  numbers: readonly PatientNumber[];
  /** Cells that travelled WITHOUT this platform's reading beside them.
   *  Methylation is permanently one; anything else here is a cell whose
   *  `_clinical` sibling the redactor declined to write this turn. */
  ungradedCells: readonly string[];
  /** Cells the record holds a value for that did NOT reach the prompt.
   *  An absence produced by consent, which must never be reported as an
   *  absence of the finding. */
  withheldCells: readonly string[];
  /**
   * 4-character shingles of everything the turn READ rather than
   * composed: every retrieved non-patient chunk, every rendered
   * projection row, and this file's own Chinese for the platform's
   * readings.
   *
   * THE LAST TWO ARE WHY A TABLE CELL CAN BE CHECKED AT ALL. The first
   * version skipped table rows outright, because a cell restating this
   * platform's own `permissive_haplotype` reading in plain Chinese
   * shares no wording with the corpus and was excised for it. That cell
   * is not unsourced — its source is the projection sitting in this
   * turn's own prompt. Once the projection is part of what counts as a
   * source, the row can be judged like any other sentence, and the
   * fabricated ones in tables stop being invisible.
   */
  supportShingles: ReadonlySet<string>;
  corpusChunkCount: number;
  /**
   * Every numeric interval the RECORD carried this turn, canonicalised
   * by `intervalsIn`. The admissible contents of a 参考范围 cell, and
   * nothing else is — see `fabricated_reference_range`.
   */
  recordIntervals: ReadonlySet<string>;
  /**
   * The genetics cells this turn knows are THIS PATIENT'S — a cell his
   * payloads carry a value for, a cell the projection printed, or a cell
   * the conversation fallback recovered a number for.
   *
   * The fact half of the possessive limb of check 1. It is deliberately
   * NOT 「the cells this file has words for」: 甲基化 in a sentence about
   * a patient whose record holds no methylation is a sentence about the
   * concept, and the claim this platform forbids is the one landing on
   * HIS cell.
   */
  patientCells: ReadonlySet<string>;
}

/**
 * MEASURED, NOT PICKED. Against the live corpus for
 * 「FSHD D4Z4 重复数 甲基化 机制 DUX4 病情严重程度」 (8 chunks, 7,460
 * chars), the fraction of a sentence's n-grams present in the retrieval:
 *
 *                                        n=4     n=5     n=6
 *   invented 「代偿性地维持在高度甲基化的状态」  0.000   0.000   0.000
 *   invented 「代偿性高甲基化状态」              0.000   0.000   0.000
 *   textbook 「D4Z4 松散 → DUX4 激活 → 肌肉病变」 0.051   0.000   0.000
 *   textbook 「因为 D4Z4 重复数缩短导致的 FSHD」  0.152   0.089   0.045
 *
 * At n=6 the textbook sentences score zero too, which is why this check
 * excised two correct paraphrases of the FSHD mechanism from live
 * answers. Only n=4 separates them, and only barely — so the test is
 * 「NOT ONE 4-gram in common」, the most permissive form of it, rather
 * than a coverage threshold the numbers above do not support.
 *
 * WHAT THAT COSTS, stated: a Chinese-heavy retrieval gives an invented
 * sentence more chances to share a 4-gram, so this check misses more
 * than it catches and is the weakest of the five. It fails toward
 * silence, which is the correct direction for a check whose false
 * positive is deleting a true sentence about the patient's disease.
 */
const SHINGLE = 4;
const CJK = /[\u4e00-\u9fff]/u;

/** Content characters only: punctuation, spaces and markdown furniture
 *  are layout rather than words, and a shingle that spans them matches
 *  nothing useful. */
const contentChars = (text: string): string =>
  [...text].filter((ch) => CJK.test(ch) || /[0-9A-Za-z]/u.test(ch)).join('');

const shinglesOf = (text: string): string[] => {
  const chars = contentChars(text);
  if (chars.length < SHINGLE) return [];
  const out: string[] = [];
  for (let i = 0; i + SHINGLE <= chars.length; i += 1) out.push(chars.slice(i, i + SHINGLE));
  return out;
};

/**
 * A numeric interval, in the shapes a laboratory or a source writes one.
 *
 * Canonicalised so the answer's wording cannot dodge the comparison:
 * 「40-60」, 「40–60」 and 「40 至 60」 are one interval, and 「<40」,
 * 「小于 40」 and 「40 以下」 are another.
 */

/**
 * ------------------------------------------------------------------
 * THE NOTATION A BAND AND A BOUND ARE PRINTED IN — THE COMPLETE SET,
 * NOT THIS FILE'S HISTORICAL SUBSET OF IT.
 *
 * WHY THIS IS A DEFECT AND NOT A TIDY-UP. This repo holds SIX copies of
 * these two classes and they disagreed with each other, so THE SAME
 * STRING READ DIFFERENTLY DEPENDING ON WHICH FILE READ IT:
 *
 *   - this file's band separator was 「-–—~～到至」 — no full-width
 *     hyphen 「－」 (U+FF0D), which is what a Chinese IME gives for a
 *     hyphen keyed in Chinese mode, and no 「−」 / 「﹣」 / 「‐」;
 *   - this file's comparators were 「<≤＜≦⩽」 / 「>≥＞≧⩾」 — no small-form
 *     「﹤」「﹥」 (U+FE64/U+FE65), which the Python parser has had since
 *     the round that found them on a real report;
 *   - the Python parser (`_RANGE_DASHES` / `_COMPARATORS` in
 *     `apps/report-manager/app/services/fshd_report_service.py`) carries
 *     the small-form comparators but NOT 「≦」「≧」;
 *   - the passport (`parseD4Z4Reading` in
 *     `apps/api/src/modules/patient-profile/profile.passport.ts`) carries
 *     「≦」「≧」「﹤」「﹥」 but its range dashes are only 「-~—～」, and its
 *     two other in-file copies (`PRINTED_RANGE`, `STRENGTH_RANGE_CELL`)
 *     disagree with each other as well.
 *
 * A report printing 「50－310」 was an interval to one reader and a bare
 * number to another. This file is on the publication path, so the cost
 * here is exact: `recordIntervals` loses the laboratory's own range, and
 * the model reprinting that very range is flagged as fabricating it —
 * a true reference interval deleted off a patient's screen — while an
 * invented one written in the same spelling sails past `intervalsIn`
 * because the answer side lost it too.
 *
 * THE COMPLETE SET IS NO LONGER TRANSCRIBED HERE. It is
 * `apps/api/src/utils/clinical-notation.ts` — every spelling of a
 * hyphen, a dash, a minus, a tilde, the four comparators Unicode gives
 * a Chinese IME, the two range WORDS 到 / 至, and the digit-group
 * spelling of a number — and the classes below are derived from it so
 * a mark added there lands here without anyone remembering to come.
 *
 * WHERE IT ACTUALLY LIVES NOW, AND WHY THIS FILE NO LONGER SPELLS ANY
 * OF IT ITSELF.
 *
 * The block above used to end 「NEITHER IS CREATED HERE」 and propose a
 * neutral `utils/` module. That module WAS created —
 * `apps/api/src/utils/clinical-notation.ts` — and `profile.passport.ts`
 * adopted it. THIS FILE DID NOT, and being the last holdout is not a
 * cosmetic debt, because a shared vocabulary is only a floor for the
 * readers that stand on it: the copies here agreed with the module
 * about the dashes and the comparators, and disagreed with it about the
 * one thing this file never had a spelling for at all —
 *
 *   A NUMBER IS PRINTED WITH DIGIT GROUPS. 「3,250」 IS ONE NUMBER.
 *
 * All three interval readers below spelled a number `[0-9]+(\.[0-9]+)?`,
 * which stops dead at the group separator, and the failure is not a
 * missed interval — it is a WRONG one, which is the class of defect
 * this parser has now been rebuilt for three rounds running:
 *
 *   - 「大于 1,200」 read as 「>1」 — a four-digit floor entering the turn
 *     as the floor 1, so every value in the record clears it;
 *   - 「参考范围 1,200-3,250」 read as the band 「200~3」 — an INVERTED
 *     band, low end above high end, off a range the laboratory printed
 *     correctly;
 *   - 「3,250 个以上」 read as 「>250」.
 *
 * The same defect was fixed in the Python parser two rounds ago (its
 * `_DIGIT_GROUPS`), and `PRINTED_NUMBER` is the transcription of that
 * fix the shared module states — grouped alternative FIRST, or the scan
 * stops at the first group and reads 3. Adopting it is what makes the
 * threshold on a report and the threshold in an answer the same string
 * to every reader in `apps/api`.
 *
 * A GROUPED NUMBER MUST ALSO NOT BE ENTERED IN THE MIDDLE, which is the
 * half a bare adoption would miss: the old edge guards refused a digit
 * or a letter on either side, and a comma is neither, so 「1,200」 would
 * still offer 「200」 to a reader that started one character later or
 * backtracked off the grouped alternative. `NUMBER_STARTS` /
 * `NUMBER_ENDS` below refuse a group continuation on each side, so a
 * partial group is not a number here at all.
 *
 * ACROSS `apps/api` AND `apps/mobile` a shared module is still not
 * possible as the repo stands: the root `workspaces` field is `apps/*`
 * and there is no `packages/` directory, so a module both could import
 * would be a NEW WORKSPACE plus a change to the root manifest. That is
 * a repo-layout decision and not one lane's to take on the way past.
 * The Python parser cannot import a TypeScript module at all and has to
 * stay a transcription of the same table whatever happens.
 */
/** The comparator classes, DERIVED from the shared vocabulary rather
 *  than retyped: inclusive and exclusive both name the same side, and
 *  this parser's canonical key deliberately does not carry inclusivity
 *  (see below), so the two are unioned here and told apart nowhere. The
 *  ASCII digraphs lead the alternation for the reason
 *  `COMPARATOR_SOURCE` states — otherwise 「<=25」 matches the bare 「<」
 *  and leaves 「=25」 standing. */
const BELOW_SYMBOL_CHARS = `${CEILING_EXCLUSIVE}${CEILING_INCLUSIVE}`;
const ABOVE_SYMBOL_CHARS = `${FLOOR_EXCLUSIVE}${FLOOR_INCLUSIVE}`;

/**
 * WHAT STANDS BETWEEN A NUMBER AND THE WORD THAT BOUNDS IT.
 *
 * A unit, and in Chinese a MEASURE WORD, and both are optional. This is
 * the seam the open-ended forms below were missing: a repeat count is
 * written 「11 个以上」 or 「11 个单元以上」 or 「11 个重复单元以上」,
 * never 「11以上」, and a pattern that required the number to sit against
 * 以上 saw none of them. Driven against the running stack the model put
 * 「正常参考：11 个单元以上」 in a 参考范围 column — an interval this
 * platform's record never printed, standing beside the patient's own
 * value, and `intervalsIn` returned nothing at all for the cell, so
 * `fabricated_reference_range` had nothing to compare and the invented
 * threshold published.
 *
 * The measure word carries no arithmetic — 「11 个以上」 and 「11 以上」
 * are the same interval — so it is skipped rather than captured, and the
 * canonical form is unchanged.
 *
 * 拷贝数 WAS MISSING, AND THIS FILE ALREADY KNEW THE WORD. `CELL_TERMS`
 * twenty lines up registers 拷贝数 as one of the four terms that name the
 * D4Z4 cell — it is what a Chinese report writes when it does not write
 * 重复数 — and this list held only the bare 拷贝. Alternation is
 * leftmost-first, so 「11 个拷贝数以上」 matched 拷贝, left 数 standing
 * between the measure and 以上, and produced NO INTERVAL AT ALL: a
 * 参考范围 cell written that way had nothing for
 * `fabricated_reference_range` to compare, exactly as the 个 and the 及
 * forms did before their own rounds. Longest alternative first for the
 * same reason `WIRE_TOKENS_LONGEST_FIRST` is sorted.
 *
 * INCOMPLETE BY CONSTRUCTION, like every list in this file: it is a
 * question about NOTATION, no fact this turn holds can answer it, and a
 * measure word it misses still costs an interval on BOTH sides (the
 * record's and the answer's) rather than a permission.
 */
const MEASURE_TAIL =
  '\\s*(?:%|％|kb|KB)?\\s*(?:个|条|段|次|例)?\\s*(?:重复单元|重复数|拷贝数|单元|拷贝|单位|copies?|units?)?\\s*';

/**
 * ...AND THE CONJUNCTION THAT JOINS THE MEASURE TO THE BOUNDARY WORD,
 * WHICH IS THE ORDINARY CHINESE FORM AND NOT AN EVASION.
 *
 * 「11 个及以上」「10 个及以下」 is how a Chinese laboratory sheet and a
 * Chinese answer write an open-ended interval — 及 is the ordinary
 * inclusive conjunction, and 「11 个以上」 is the terser variant, not the
 * standard one. The patterns below required 以上 to sit against
 * `MEASURE_TAIL`, so the 及 forms produced NO interval at all: a
 * 参考范围 column reading 「正常参考：11 个及以上」 gave `intervalsIn`
 * nothing to return, `fabricated_reference_range` had nothing to compare,
 * and an invented laboratory threshold published beside the patient's
 * own value.
 *
 * NO FACT THIS TURN HOLDS CAN ANSWER 「is this string an interval」 — it
 * is a question about notation — but this is also not a claim lexicon:
 * it is a closed grammatical join, it carries no arithmetic (「11 个及
 * 以上」 and 「11 以上」 are the same interval), and so it is skipped
 * rather than captured and the canonical form is unchanged. It is
 * applied SYMMETRICALLY — to the intervals read off the record and to
 * the intervals read out of the answer — so widening it can only ever
 * add a comparison, never a permission.
 */
const BOUND_CONNECTIVE = '(?:及|或|或者|及其|乃至)?\\s*';

/**
 * A NUMBER, AND THE TWO EDGES THAT KEEP HALF OF ONE FROM BEING READ AS
 * A WHOLE ONE.
 *
 * `PRINTED_NUMBER` is the shared spelling — 「3,250」 and 「3250」 and
 * 「12.4」, grouped alternative first. It is a bare alternation, so it
 * is always wrapped in a group at the call site or it would split the
 * pattern it is dropped into.
 *
 * The edges are what the adoption alone would not give. The old guards
 * refused a DIGIT or a LETTER on either side of a number, which is what
 * keeps 「4q35」 an identifier; a comma is neither, so 「1,200」 still
 * offered 「200」 to a scan that entered one character later, and — the
 * case that actually bites — to the regex engine BACKTRACKING off the
 * grouped alternative when the rest of the pattern failed. So each edge
 * also refuses a group continuation: three digits after a comma ahead,
 * a digit-then-comma behind. A number this parser reads is a WHOLE
 * printed number or it is not a number.
 */
const NUMBER_STARTS = '(?<![0-9A-Za-z.])(?<![0-9][,，])';
const NUMBER_ENDS = '(?![0-9A-Za-z.])(?![,，][0-9]{3})';

/** The digit-group separator carries no arithmetic — it is layout — so
 *  it comes off before the value is read. `Number('3,250')` is NaN, and
 *  a NaN key would be published as 「>NaN」. */
const readNumber = (raw: string | undefined): number => Number((raw ?? '').replace(/[,，]/gu, ''));

/**
 * A BAND, IN THE SHAPES A REPORT AND A PAPER ACTUALLY WRITE ONE.
 *
 * The unit is optional on BOTH endpoints because a laboratory writes
 * 「40%-60%」 and a paper writes 「40-60%」, and a band regex that stops
 * at the first `%` sees neither. Same for the measure word: 「1 个到 3 个
 * 重复单元」 is the band 1~3 written the way a Chinese answer writes it.
 * One source string, used by the reference-range scan and by the
 * severity check, so the two can never disagree about what a band is.
 *
 * The separator is `RANGE_SEPARATOR_SOURCE` — the complete dash set
 * plus the two Chinese words, from the shared vocabulary. It used to be
 * a five-character subset, and a band a Chinese IME typed 「1－3」 was
 * not a band here.
 */
const BAND_SOURCE = `${NUMBER_STARTS}(${PRINTED_NUMBER})${MEASURE_TAIL}${RANGE_SEPARATOR_SOURCE}${MEASURE_TAIL}(${PRINTED_NUMBER})${MEASURE_TAIL}${NUMBER_ENDS}`;

const INTERVAL_BAND = new RegExp(BAND_SOURCE, 'gu');

/**
 * WHICH SIDE OF THE NUMBER A BOUNDARY WORD PUTS YOU ON.
 *
 * THIS IS NOT A LEXICON THE WAY THE REST OF THE FILE'S LISTS ARE, and
 * the difference decides how it had to be fixed. 「严重」 is a judgement
 * no fact derives, so that list may be incomplete and fails toward
 * silence. A BOUNDARY WORD HAS AN ARITHMETIC MEANING: 不低于 11 IS the
 * set 11, 12, 13…, and there is a right answer and a wrong one. The
 * previous version got the wrong one, and it got it by pattern rather
 * than by accident:
 *
 *   - the BELOW alternation held 低于, so 「不低于 11 个」 — AT LEAST 11 —
 *     matched inside the negation and canonicalised to 「<11」;
 *   - the ABOVE alternation held 超过, so 「不超过 100%」 — AT MOST 100 —
 *     canonicalised to 「>100」.
 *
 * Every downstream reader of `intervalsIn` was then reasoning about the
 * COMPLEMENT of the band the text stated. `recordIntervals` is the set a
 * 参考范围 cell is checked against, so a report printing
 * 「正常参考：不低于 11 个」 entered the turn as 「<11」: the model
 * reprinting the laboratory's own interval as 「11 个以上」 was flagged as
 * fabricating it, and an invented 「10 以下」 matched and published. An
 * inverted bound is worse than a missing one — a missing bound costs a
 * comparison, an inverted one makes the guard argue for the wrong band.
 *
 * SO THE PARSER IS BUILT OUT OF THE GRAMMAR RATHER THAN OUT OF A LIST OF
 * STRINGS. There are exactly two things to get right and they compose:
 *
 *   1. A DIRECTION WORD — 大于 / 高于 / 超过 / 多于 / 超出 point up,
 *      小于 / 低于 / 少于 point down.
 *   2. A NEGATOR IN FRONT OF IT — 不 / 未 / 没(有) — which FLIPS the
 *      direction, because that is what negating a bound does.
 *
 * 不足 / 不到 / 不满 / 未满 are written as WHOLE ATOMS rather than left to
 * rule 2, because they are not negations of a direction word: 足 and 到
 * are not bounds, and 「不足 11」 is 「<11」 rather than the flip of
 * anything. They sit in the BELOW list ahead of the negator branch and
 * the engine reaches them by backtracking off it.
 *
 * AND THE SPELT-OUT ≥ AND ≤, which are how a Chinese report and a
 * Chinese answer write those two symbols. 大于等于 / 大于或等于 /
 * 小于等于 / 小于或等于 were absent entirely, so a record printing
 * 「参考值：大于等于 11 个」 contributed NO interval and the same
 * threshold written 「≥11」 in the answer read as invented. They are the
 * same grammar as rule 1 with an inclusive tail, so they are written
 * that way rather than enumerated.
 *
 * 至少 / 最少 / 起码 / 至多 / 最多 are the other closed way Chinese opens
 * an interval and are listed for the same reason.
 *
 * INCLUSIVITY IS DELIBERATELY NOT CARRIED INTO THE CANONICAL KEY, which
 * is the convention this file already had — 「≥11」 and 「>11」 have
 * always both been 「>11」 — and it is kept because the key exists to
 * ANSWER ONE QUESTION: did the record print this interval. Splitting
 * 「≥11」 from 「>11」 would make a record that printed one and an answer
 * that wrote the other read as a fabrication, which is a true reference
 * range deleted off a patient's screen for a boundary character. The
 * DIRECTION is what this file has to get right, and that is what the
 * parser now gets right.
 *
 * IT IS APPLIED SYMMETRICALLY — the record's intervals and the answer's
 * intervals go through this one function — so a form added here can only
 * ever add a comparison, never a permission. What it still cannot read
 * is written down rather than left to be rediscovered: a bound with the
 * number in front of the direction word (「11 个是下限」) and a bound
 * stated as a word (「十一个以上」) produce no interval. Both fail toward
 * the record contributing one interval fewer, which costs a comparison
 * and not a permission.
 *
 * ---------------------------------------------------------------------
 * AND THE OTHER HALF OF THE SAME PARSER, WHICH THIS NOTE USED TO LIST AS
 * AN ACCEPTED MISS AND WHICH IS NOT ONE.
 *
 * The rewrite above built the PREFIX form out of the grammar — a
 * direction word, optionally negated, and the negation FLIPS it. The
 * SUFFIX form got the measure word, the connective and nothing else: it
 * had no negator branch at all. So 「未见 11 个以上」 and
 * 「没有 11 个以上」 — both of which mean FEWER THAN 11 WERE FOUND —
 * canonicalised to 「>11」, the interval of everything they deny.
 *
 * THAT IS THE SAME DEFECT AS 不低于, not a smaller one. A missing form
 * costs a comparison; an INVERTED one makes this file argue for the
 * opposite band, and every downstream reader of `intervalsIn` inherits
 * it. Concretely, on the record side: a report whose D4Z4 reference cell
 * reads 「未见 11 个以上重复单元」 entered `recordIntervals` as 「>11」, so
 * the model reprinting that laboratory line as 「11 个以下」 was flagged
 * as fabricating a range the report actually printed, while an invented
 * 「11 个以上」 matched the record and published beside the patient's own
 * 3. Both directions wrong, from one missing branch.
 *
 * SO THE SUFFIX IS BUILT OUT OF THE SAME TWO PIECES THE PREFIX IS: a
 * boundary word, and a NEGATOR THAT FLIPS IT. The only difference is
 * where the negator stands — Chinese puts it in front of the whole
 * predicate, so in the suffix form it sits in front of the NUMBER rather
 * than in front of the boundary word.
 *
 * IT IS NOT ALLOWED TO REACH ACROSS A CONTENT WORD, and that is a
 * safety property rather than tidiness. 「没有人的重复数在 11 个以上」 is
 * not a negated bound — it is a quantifier over people that happens to
 * open with 没有, and the band 11 以上 really is stated in it — so a
 * negator allowed to reach across the sentence would flip a bound the
 * sentence asserts.
 *
 * ---------------------------------------------------------------------
 * AND THE THIRD ROUND ON THIS PARSER, WHICH IS WHY THE BOUND IS NOW
 * DERIVED INSTEAD OF ENUMERATED.
 *
 * Twice this parser was widened by adding a shape, and twice the next
 * round found a shape it read BACKWARDS rather than merely missed. The
 * reason was structural and it was the same reason both times: NEGATION
 * AND DIRECTION WERE FUSED INTO ONE PATTERN THAT REQUIRED THEM
 * ADJACENT.
 *
 *   - the PREFIX parser spelt its negated forms as `NEGATOR DIRECTION`
 *     with nothing allowed between them, so 「不得低于 11」 /
 *     「不能超过 100」 / 「不应低于 11」 / 「未曾超过 100」 — a modal
 *     or an aspect particle standing between the negator and the
 *     direction word, which is how a Chinese reference statement is
 *     actually written — did not match the negated branch at all. The
 *     engine then matched the BARE direction word one character later,
 *     so 「不得低于 11」 — AT LEAST 11 — entered the turn as 「<11」.
 *   - the SUFFIX parser allowed EXACTLY ONE tail token after the
 *     negator, so 「没有发现 11 个以上」 / 「没有检出 11 个以上」 /
 *     「没有测出 11 个以上」 / 「没有达到 11 个以上」 — 没 + 有 is
 *     already the one token and 发现 / 检出 / 测出 / 达到 had nowhere
 *     to stand — matched no negator at all and canonicalised to
 *     「>11」, the interval of everything they deny. That is the most
 *     ordinary way a Chinese report or a Chinese answer states that a
 *     threshold was NOT reached.
 *
 * Both are the same inversion, closed twice already, arriving each time
 * on the shape the negator grammar did not cover. So the grammar is
 * written down once, COMPOSITIONALLY:
 *
 *   A BOUND IS A DIRECTION, OPTIONALLY NEGATED, AND THE NEGATION FLIPS
 *   IT EXACTLY ONCE, WHATEVER CLOSED-CLASS MATERIAL STANDS BETWEEN THE
 *   NEGATOR AND THE DIRECTION WORD.
 *
 * The direction is parsed on its own (`BELOW_WORD` / `ABOVE_WORD`, which
 * no longer carry a negator branch at all), the negation is parsed on
 * its own (`BOUND_NEGATION`), and the two are combined by the SAME XOR
 * on both sides of the number. One rule replaces four hand-fused
 * alternations, so the next unlisted modal costs a token added to one
 * closed list rather than a fifth shape read backwards.
 *
 * WHAT MAY STAND IN THE GAP is closed, and it is function words only:
 * PREVERBAL modals (能 / 可 / 应 / 该 / 须 / 会 / 要 / 能够 / 可以 /
 * 应该 / 应当 / 必须 / 法, as in 无法), the preverbal aspect adverbs
 * (曾 / 曾经 / 再) and the attainment verbs that make a negator and a
 * number one predicate (有 / 见 / 到 / 满 / 足 / 达 / 达到 / 发现 /
 * 检出 / 测出 / 超过 / 超出). A CONTENT WORD IS NOT IN IT, and that is
 * exactly what keeps 「没有人的重复数在 11 个以上」 un-flipped: 人 ends
 * the gap, the negator branch fails, and the sentence contributes the
 * band it really states.
 *
 * THE RESIDUAL FAILURE MODE IS STATED SO IT IS NOT REDISCOVERED: a
 * negator this gap cannot reach falls back to the UN-NEGATED reading,
 * which is the reading the parser gave before this round. A gap token
 * this list misses therefore cannot make anything worse than it is
 * today, and it is a token in a closed function-word list rather than a
 * new pattern.
 *
 * ---------------------------------------------------------------------
 * AND WHAT THAT GAP COST THE ROUND IT WAS BUILT, WHICH IS WHY POSITION
 * IS NOW PART OF THE RULE AND NOT JUST MEMBERSHIP.
 *
 * The list above was assembled by part of speech — 「a modal, an aspect
 * particle, an attainment verb」 — and TWO of its members are not
 * preverbal at all. A gap is a POSITION, so a token that cannot stand
 * in that position does not merely fail to help: it makes the negator
 * reach a direction word across a word boundary that is not there.
 *
 *   - 过 stood first, and 不 + 过 IS ONE WORD. 不过 is the ordinary
 *     Chinese connective 「however」 — the exact word a careful answer
 *     writes in front of a caveat — so 「不过大于 10 个就要考虑 FSHD2」
 *     parsed as a negated 大于 and entered the turn as 「<10」. The
 *     guard then argued about the complement of the band the sentence
 *     states, which is the precise failure the compositional rebuild
 *     existed to end, reintroduced by the rebuild itself. 过 is the
 *     EXPERIENTIAL aspect and it follows its verb, so it now sits in
 *     `ASPECT_TAIL` behind a link (没有过 / 未见过) and cannot stand
 *     against 不 at all.
 *   - 得 stood next to it with the same shape: preverbal only in the
 *     fused modal 不得, and elsewhere the POST-verbal potential
 *     complement, which made 不见得 (「not necessarily」) a negated
 *     bound. A hedge is not a bound: 「不见得低于 11」 asserts nothing
 *     about 11 and was being read as 「>11」. 未必 says the same thing
 *     and never matched, because 必 is not in the list — so the two
 *     spellings of one hedge disagreed. 得 now attaches to 不 in
 *     `NEGATOR_HEAD` and nowhere else.
 *
 * THE REST OF THE LIST WAS CHECKED FOR THE SAME PROPERTY — does 不 /
 * 未 / 没 / 无 plus this token spell a COMMON WORD in which the token is
 * not a particle linking to a direction word — and no other member has
 * it. 不得 / 不能 / 不可 / 不应 / 不该 / 不须 / 不会 / 不要 / 无法 /
 * 不曾 / 未曾 / 不再 / 没有 / 未见 / 未达 are all genuine negations of
 * whatever follows them, and 不足 / 不到 / 不满 / 未满 are already
 * WHOLE ATOMS below. 不法 is a word (「lawless」) but 法 exists here for
 * 无法 and 「不法」 never precedes a direction word. The multi-character
 * members (达到 / 能够 / 可以 / 应该 / 应当 / 必须 / 发现 / 检出 /
 * 测出 / 超过 / 超出 / 曾经) cannot fuse into a different word at all.
 *
 * SO THE RULE THE GAP ENFORCES IS NOW BOTH HALVES OF ONE FACT: a token
 * may stand in the gap only if it is closed-class AND PREVERBAL, and a
 * post-verbal particle is admitted only in the position it actually
 * occupies.
 *
 * 不足 / 不到 / 不满 / 未满 stay WHOLE ATOMS and the gap cannot take
 * them apart: 足 and 到 are in the gap list, but no direction word
 * follows them, so the engine backtracks off the negator branch and
 * reaches the atom. 「不足 11」 is 「<11」 and not the flip of anything.
 *
 * ---------------------------------------------------------------------
 * AND THE UNIT GLUED TO THE BOUND NUMBER, WHICH IS HOW A REPORT PRINTS
 * ONE AND WHICH PRODUCED NO INTERVAL AT ALL.
 *
 * `BOUND_NUMBER` ended in a negative lookahead that refused a Latin
 * letter after the digits. The lookahead is there for a reason — it
 * stops a number inside an IDENTIFIER (4qA, D4Z4, 4q35) being read as a
 * measurement — but a laboratory prints its bounds 「>38kb」
 * 「≤38kb」 「<0.5mg/L」 「>200U/L」, unit glued to the digits, and
 * every one of those matched NOTHING: `intervalsIn` returned an empty
 * list for the cell, `fabricated_reference_range` had nothing to
 * compare, and the check that exists to protect the record's OWN
 * intervals could not see them. Same cost as the 个 and the 及 forms
 * before their rounds, on the side of the notation this file had never
 * looked at.
 *
 * A UNIT AND AN IDENTIFIER ARE TOLD APART STRUCTURALLY, not by a list of
 * unit names — which is what keeps this from being a seventh lexicon: a
 * unit is a short Latin run (optionally a 「/」 denominator, or a percent
 * sign) that IS NOT FOLLOWED BY A DIGIT. 「38kb」 ends after its letters
 * and is a unit; 「4q35」 puts a digit after the letter and stays an
 * identifier, so it is still refused, and so is 「≥11个」-style Chinese
 * measure text, which `MEASURE_TAIL` owns. The unit carries no
 * arithmetic and is dropped from the key, which is the convention
 * `MEASURE_TAIL` already established — 「>38kb」 and 「>38」 are one
 * interval — and the comparison stays symmetric because the record's
 * intervals and the answer's intervals both come through this function.
 */
/** 大于等于 / 大于或等于 — the inclusive tail, which changes no direction
 *  and therefore no key. */
const OR_EQUAL = '(?:或?等于)?';
const UP_WORD = '(?:大于|高于|多于|超过|超出)';
const DOWN_WORD = '(?:小于|低于|少于)';
/** The closed function words that may stand between the negator and the
 *  direction word it negates: modals and the attainment verbs that make
 *  a negator and a number one predicate. A content word is deliberately
 *  absent — see the block above — and so are the two POST-verbal
 *  particles, which `NEGATOR_HEAD` and `ASPECT_TAIL` place instead of
 *  this list. Longest alternative first, for the same reason
 *  `MEASURE_TAIL` is sorted. */
const NEGATOR_LINK =
  '(?:达到|能够|可以|应该|应当|必须|发现|检出|测出|超过|超出|曾经|能|可|应|该|须|会|要|法|曾|再|有|见|到|满|足|达)';
/** 过 IS POST-VERBAL, so it may only follow a verb inside the gap:
 *  「没有过 11 个以上」「未见过 11 个以上」 are the experiential aspect
 *  and they are negations of that bound. Against the negator itself it
 *  is not a particle at all — see `NEGATOR_HEAD`. */
const ASPECT_TAIL = '(?:\\s*过)?';
/** THE HEAD OF A NEGATION — 不 / 未 / 没 / 无, the negator core that
 *  flips a direction word, and the one place a token is admitted for
 *  the negator it fuses with rather than for its part of speech.
 *
 *  得 is preverbal ONLY in 不得 (「must not」). After anything else it is
 *  the potential complement — 不见得 is 「not necessarily」, a HEDGE that
 *  asserts no bound, and reading it as a negation turns 「不见得低于 11」
 *  into the claim 「>11」. 未必, which means the same thing, never
 *  matched here because 必 is not in the list, and now the two agree.
 *
 *  过 is the mirror image: it is admitted after a verb (`ASPECT_TAIL`)
 *  and refused against 不, because 不过 IS ONE WORD — the ordinary
 *  discourse connective 「however」 — and it is exactly the word a
 *  careful answer puts in front of a caveat. It negates nothing, so
 *  「不过大于 10 个就要考虑 FSHD2」 was entering the turn as 「<10」, the
 *  complement of the band the sentence states. 没过 / 未过 keep it,
 *  because there 过 is the VERB (「没过 10 个」 — did not exceed 10) and
 *  the negation is real. */
const NEGATOR_HEAD = `(?:不(?:\\s*得)?|(?:未|没|无)${ASPECT_TAIL})`;
/** A negator and its gap: 「不」「不得」「未曾」「无法」「没有发现」.
 *  Bounded, so it is a grammatical join and not a reach across a
 *  sentence, and so the engine cannot backtrack pathologically. */
const BOUND_NEGATION = `${NEGATOR_HEAD}(?:\\s*${NEGATOR_LINK}${ASPECT_TAIL}){0,3}\\s*`;
/** Whole atoms: not negations of a direction word, so the negator rule
 *  must not be allowed to take them apart. */
const BELOW_ATOM = '(?:不足|不到|不满|未满|至多|最多)';
const ABOVE_ATOM = '(?:至少|最少|起码)';
/** The complete comparator classes — see `BELOW_SYMBOL_CHARS`. The
 *  ASCII digraphs come first so `<=` is not consumed as a bare `<`. */
const BELOW_SYMBOL = `(?:${CEILING_INCLUSIVE_DIGRAPHS.join('|')}|[${BELOW_SYMBOL_CHARS}])`;
const ABOVE_SYMBOL = `(?:${FLOOR_INCLUSIVE_DIGRAPHS.join('|')}|[${ABOVE_SYMBOL_CHARS}])`;
/** THE DIRECTION ALONE. The negator is no longer fused in here: it is
 *  `BOUND_NEGATION`, and the flip is the XOR in `intervalsIn`. */
const BELOW_WORD = `(?:${BELOW_SYMBOL}|${DOWN_WORD}${OR_EQUAL}|${BELOW_ATOM})`;
const ABOVE_WORD = `(?:${ABOVE_SYMBOL}|${UP_WORD}${OR_EQUAL}|${ABOVE_ATOM})`;
/** The unit a report glues to a bound number — kb, mg/L, U/L, % — told
 *  apart from an identifier by what follows it, not by name. */
const GLUED_UNIT = '(?:\\s*(?:%|％)|\\s*[A-Za-z]{1,6}(?:\\s*/\\s*[A-Za-z]{1,6})?)?';
const BOUND_NUMBER = `(?<pnum>${PRINTED_NUMBER})${GLUED_UNIT}${NUMBER_ENDS}`;

/** 「不低于 11」「不得低于 11」「≥11」「大于等于 11」「>38kb」 — the
 *  bound in front of the number, its direction and its negation parsed
 *  separately and combined by the XOR in `intervalsIn`. */
const INTERVAL_BOUND_PREFIX = new RegExp(
  `(?<pneg>${BOUND_NEGATION})?(?:(?<pbelow>${BELOW_WORD})|(?<pabove>${ABOVE_WORD}))\\s*${BOUND_NUMBER}`,
  'gu',
);

/** 「11 个及以上」「10 个以内」「没有发现 11 个以上」 — the bound
 *  after the number, and the negator in front of it that flips the
 *  direction. `BOUND_NEGATION` is the same negator grammar the prefix
 *  form uses, standing where Chinese puts it in this shape: in front of
 *  the NUMBER rather than in front of the boundary word. See
 *  `MEASURE_TAIL` and `BOUND_CONNECTIVE` for what may stand between the
 *  number and the boundary word. */
const INTERVAL_BOUND_SUFFIX = new RegExp(
  `(?<![0-9A-Za-z.])(?<sneg>${BOUND_NEGATION})?${NUMBER_STARTS}(?<snum>${PRINTED_NUMBER})` +
    `${MEASURE_TAIL}${BOUND_CONNECTIVE}` +
    '(?:(?<sbelow>以下|以内|之下|之内)|(?<sabove>以上|之上))',
  'gu',
);

export const intervalsIn = (text: string): string[] => {
  const out: string[] = [];
  const scan = (pattern: RegExp, render: (match: RegExpExecArray) => string | null) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const key = render(match);
      if (key !== null) out.push(key);
    }
  };
  scan(INTERVAL_BAND, (match) => `${readNumber(match[1])}~${readNumber(match[2])}`);
  scan(INTERVAL_BOUND_PREFIX, (match) => {
    const value = readNumber(match.groups?.pnum);
    if (!Number.isFinite(value)) return null;
    // The SAME XOR the suffix form uses, because it is the same grammar:
    // a direction, optionally negated, and the negation flips it exactly
    // once however many closed-class tokens stand between the two.
    // 「低于 11」 is 「<11」, 「不低于 11」 and 「不得低于 11」 are both
    // 「>11」, and 「不能超过 100」 is 「<100」.
    const below = match.groups?.pbelow !== undefined;
    const negated = match.groups?.pneg !== undefined;
    return `${below !== negated ? '<' : '>'}${value}`;
  });
  scan(INTERVAL_BOUND_SUFFIX, (match) => {
    const value = readNumber(match.groups?.snum);
    if (!Number.isFinite(value)) return null;
    // XOR, because that is what negating a bound does: 「11 个以上」 is
    // 「>11」 and 「没有发现 11 个以上」 is 「<11」, and 「没有 10 个以下」
    // — 「not fewer than 10」 — is 「>10」. Literally the same
    // `BOUND_NEGATION` the prefix parser uses, applied on the other side
    // of the number, and combined by the same XOR.
    const below = match.groups?.sbelow !== undefined;
    const negated = match.groups?.sneg !== undefined;
    return `${below !== negated ? '<' : '>'}${value}`;
  });
  return out;
};

/**
 * Walk a raw retriever payload for this patient's measurements.
 *
 * `HARD_DELETE_KEYS_LOWER` is skipped first: those keys hold telephone
 * numbers, record numbers and identity documents, which are numbers this
 * function would otherwise put in the set and then match against any
 * digits in the answer. They never reach a prompt, so they can never be
 * a number the model reasoned from either.
 *
 * A value counts only when it is a NUMBER — 「3」, 「95%」, 「12.4 kb」 —
 * and not when it is an identifier that merely contains digits. 「4qA」
 * would otherwise contribute 4, and every sentence containing a bare 4
 * beside a severity word would read as a claim about this patient's
 * haplotype.
 */
const NUMERIC_VALUE = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(%|％|kb|KB|个|次|分|岁)?\s*$/u;

/** The unit as this file writes it, so 「KB」 and 「kb」 are one unit. */
const canonicalUnit = (raw: string | undefined): string | null => {
  if (!raw) return null;
  if (raw === '％') return '%';
  if (raw.toLowerCase() === 'kb') return 'kb';
  return raw;
};

const collectNumbers = (value: unknown, key: string, depth: number, out: PatientNumber[]): void => {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, key, depth + 1, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
      if (HARD_DELETE_KEYS_LOWER.has(innerKey.toLowerCase())) continue;
      collectNumbers(innerValue, innerKey, depth + 1, out);
    }
    return;
  }
  if (NON_MEASUREMENT_KEY.test(key)) return;
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  if (raw === null) return;
  const match = NUMERIC_VALUE.exec(raw);
  if (!match) return;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return;
  out.push({
    value: parsed,
    cell: cellOfKey(key),
    unit: canonicalUnit(match[2]),
    origin: 'record',
  });
};

/** Every scalar string on a payload, for the interval scan. */
const collectScalars = (value: unknown, depth: number, out: string[]): void => {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collectScalars(item, depth + 1, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
      if (HARD_DELETE_KEYS_LOWER.has(innerKey.toLowerCase())) continue;
      collectScalars(innerValue, depth + 1, out);
    }
    return;
  }
  if (typeof value === 'string' || typeof value === 'number') out.push(String(value));
};

/**
 * THE FOLLOW-UP TURN, WHICH IS THE ORDINARY SHAPE OF THIS CONVERSATION.
 *
 * The first version assembled the patient's numbers from the chunks a
 * PATIENT-scoped retriever returned THIS TURN. Driven against the stack,
 * 「那 3 个重复单元，是不是意味着我以后会更严重、进展更快？」 asked after
 * a turn that had already read the report retrieved nothing of the
 * patient's — the question names no record, so nothing forced the
 * lookup — and the model answered 「1 到 3 个单元的患者，往往是疾病谱系
 * 里偏重的那一端」 with every check standing down for want of a number.
 * A patient asking about their own report asks most of their questions
 * this way.
 *
 * So when the turn does not hold the record for a cell, the numbers for
 * that cell come out of what the turn IS holding instead: the question,
 * and the assistant turns of the history — restricted to sentences that
 * name one of the genetics cells, because a bare number in a
 * conversation is not a measurement.
 *
 * PER CELL, AND NOT PER TURN, WHICH IS WHERE THE FIRST VERSION OF THIS
 * FALLBACK WENT WRONG. It read the conversation only when
 * `patientPayloads` was EMPTY — 「the turn retrieved nothing」 — and a
 * patient-scoped retrieval is not one thing. Driven against the stack,
 * 「我上个月复查的时候提到过随访，那 3 个重复单元是不是意味着病情比较
 * 重？」 pulled the FOLLOW-UP records and not the genetics report:
 * `patientPayloads` had a chunk in it, so the fallback stood down, and
 * the chunk it had carried no genetics cell at all. The number set was
 * EMPTY AND AUTHORITATIVE-LOOKING — the worst of the two states, because
 * an empty set is indistinguishable here from 「nothing of his is in
 * play」 — and check 1 had nothing to fire on. ANY patient chunk was
 * disarming the fallback; only the chunk that carries the CELL should.
 *
 * So the gate is `cellsOnFile`: a cell whose value this turn's own
 * patient payloads carry is authoritative and the conversation is not
 * read for it, and a cell they do not carry falls back. The old
 * behaviour is the special case where the payloads carry no cell at all.
 *
 * THE BOUND IS STILL THE POINT. Where the record for a cell IS in this
 * turn, it is authoritative and the conversation adds nothing but noise:
 * a cohort band the previous turn quoted would enter the set as though
 * it were his, and honest cohort sentences would start disappearing from
 * answers that had a perfectly good number set. Note the gate asks
 * whether the record HOLDS the cell, not whether it produced a NUMBER
 * for it — 「4qA」 is a haplotype on file that no number can be read off,
 * and letting a cell with an unparseable value fall through to the
 * conversation would admit any digit standing beside 单倍型.
 *
 * ---------------------------------------------------------------------
 * AND THE SEGMENT THAT CARRIES THE NUMBER IS NOT ALWAYS THE SEGMENT THAT
 * NAMES THE CELL, WHICH IS HOW THE PATIENT ASKS THE SECOND QUESTION.
 *
 * The gate above is per SEGMENT: the sentence has to name the cell and
 * carry the number. A patient's follow-up does neither in one sentence.
 * Driven against the running stack, 「那 3 个是不是意味着我病情比较重？」
 * — after an assistant turn that had said 「你的 D4Z4 重复数这一格我读到
 * 了。报告上写的是 3。」 — put the cell in one sentence and the number in
 * the next, and then referred back to the number with a BARE CLASSIFIER,
 * which names nothing at all. Every segment failed the gate, the number
 * set came out empty, and check 1 stood down on the most direct question
 * a patient can ask about their own count.
 *
 * THE FACT HALF IS ALREADY IN THIS TURN, and it is the same fact
 * `inspectAnswer` uses for 「这一项」: WHICH CELLS THE CONVERSATION NAMES
 * ANYWHERE. Chinese puts the antecedent on either side of the anaphor
 * and this run hands the question in FIRST and the history after, so
 * 「the sentence before」 is not even well defined here — but 「this
 * conversation is about methylation and this turn's record did not bring
 * methylation back」 is a fact, and it is what licenses reading a
 * pronoun-shaped reference at all.
 *
 * THE LEXICAL HALF IS THE ANAPHOR ITSELF, and it is deliberately the
 * NARROW direction. Every other list in this file may be incomplete for
 * free, because a missing entry costs a sentence that should have been
 * cut. THIS ONE IS THE OTHER WAY AROUND: a number wrongly admitted here
 * enters the set as though it were the patient's, and check 1 then
 * DELETES true sentences that happen to contain it. So the anaphor is
 * required to be a demonstrative over a BARE classifier — no head noun
 * after it, which is precisely what makes it anaphoric — and only the
 * number it points at is taken, not every digit in the sentence.
 * 「那 2 个孩子」 has a head noun and is not read; 「那 3 个是不是…」 has
 * none and is. A shape this misses costs a caught violation, which is
 * the direction this particular list has to fail in.
 *
 * WHAT THE FALLBACK CANNOT DO, stated rather than papered over. It
 * cannot tell his number from a cohort number the conversation
 * mentioned, so inside the fallback it treats both as his and fails
 * toward silence. And it recovers only NUMBERS: `ungradedCells` and
 * `withheldCells` are read off the projection, there is no projection on
 * such a turn, and checks 2 and 4 therefore stay down. Inventing them
 * from model prose would be guessing what this platform said.
 */
const CALENDAR_LITERAL = /^(?:19|20)[0-9]{2}$/u;
const CALENDAR_SUFFIX = /^\s*(?:年|月|日|岁|周|天|次|小时|分钟|号|名|人|例|篇|项)/u;
const NUMBER_IN_PROSE =
  /(?<![0-9A-Za-z./])([0-9]+(?:\.[0-9]+)?)\s*(%|％|kb|KB)?(?![0-9A-Za-z./])/gu;

/**
 * 「那 3 个」「这 95%」 — a demonstrative over a number whose head noun is
 * ELIDED, which is Chinese's own way of pointing back at something
 * already said.
 *
 * The elision is the whole signal, so it is what the pattern tests for:
 * after the classifier there must be a clause boundary or a grammatical
 * continuation, never a noun. That is what separates 「那 3 个是不是意味
 * 着…」 — a reference — from 「那 2 个孩子」 — a noun phrase about
 * something else entirely, whose 2 must not enter this patient's number
 * set. The continuation list is short on purpose: see the block above
 * for why this is the one list in the file that has to fail NARROW.
 */
const BARE_CLASSIFIER_REFERENCE = new RegExp(
  '(?:那|这)\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(%|％|kb|KB)?\\s*(?:个|条|段|次|例)?' +
    // ...AND THE SENTENCE-FINAL PARTICLES, which is how a patient
    // actually ends this question. 「那 3 个呢？」「那 3 个吗？」 were
    // outside the list, so the most natural follow-up there is recovered
    // no number at all. Admitting them does not loosen the elision test
    // that makes this list safe to have: 呢 / 吗 / 吧 / 啊 / 呀 / 嘛 are
    // particles and cannot be the head noun the test exists to exclude —
    // 「那 2 个孩子呢？」 still has 孩 standing where the lookahead looks.
    '(?=\\s*(?:$|[，,。、；;：:！？!?…—「」『』()（）]|呢|吗|吧|啊|呀|嘛' +
    '|是|就|会|能|算|属|指|意味|代表|说明|到底|究竟|有没有|多|够))',
  'gu',
);

const collectConversationNumbers = (
  texts: readonly string[],
  cellsOnFile: ReadonlySet<string>,
  out: PatientNumber[],
): void => {
  const segments = texts.flatMap((text) => segmentsOf(text));
  // WHICH CELLS THIS CONVERSATION IS ABOUT, read over the whole of it
  // rather than sentence by sentence. The antecedent of a bare
  // classifier may sit on either side of it, and this run hands the
  // question in before the history, so 「somewhere in this conversation」
  // is the only honest scope. Cells this turn's own records carry are
  // excluded here for the same reason they are excluded below: the
  // record already answered them authoritatively.
  const named = CELL_NAMES.filter(
    (cell) =>
      !cellsOnFile.has(cell) && segments.some((segment) => cellTermsPresent(segment.match, cell)),
  );

  const take = (
    literal: string,
    unit: string | undefined,
    after: string,
    cells: readonly string[],
  ): void => {
    if (CALENDAR_LITERAL.test(literal)) return;
    if (!unit && CALENDAR_SUFFIX.test(after)) return;
    const value = Number(literal);
    if (!Number.isFinite(value)) return;
    out.push({
      value,
      cell: cells.length === 1 ? cells[0] : null,
      unit: canonicalUnit(unit),
      origin: 'conversation',
    });
  };

  for (const segment of segments) {
    // Only the cells this turn's own records did NOT carry. A segment
    // that names nothing but covered cells is a sentence about a cell
    // the record already answered authoritatively, and its numbers are
    // whatever the conversation happened to quote.
    const cells = CELL_NAMES.filter(
      (cell) => !cellsOnFile.has(cell) && cellTermsPresent(segment.match, cell),
    );
    let match: RegExpExecArray | null;
    if (cells.length > 0) {
      NUMBER_IN_PROSE.lastIndex = 0;
      while ((match = NUMBER_IN_PROSE.exec(segment.match)) !== null) {
        take(match[1], match[2], segment.match.slice(match.index + match[0].length), cells);
      }
      continue;
    }
    // The segment names no cell. It may still be pointing back at a
    // number this conversation established for one — but only if the
    // conversation established a cell at all, and only through the
    // number the anaphor itself covers.
    if (named.length === 0) continue;
    BARE_CLASSIFIER_REFERENCE.lastIndex = 0;
    while ((match = BARE_CLASSIFIER_REFERENCE.exec(segment.match)) !== null) {
      take(match[1], match[2], segment.match.slice(match.index + match[0].length), named);
    }
  }
};

/**
 * The rows the projection printed, as the two questions the checks ask
 * of them.
 *
 * `fields` and `ocrKeys` are exactly `readEmission`'s output in run.ts —
 * the rows the tool messages carried, cross-checked against what the
 * projection published. Passed in rather than recomputed so there is one
 * reading of the tool messages per turn and both readers see the same
 * rows.
 */
export interface EmittedRows {
  fields: ReadonlySet<string>;
  ocrKeys: ReadonlySet<string>;
}

export interface BuildGuardEvidenceInput {
  /** Raw `metadata.fields` of every chunk a PATIENT-scoped retriever
   *  returned this turn. */
  patientPayloads: readonly Record<string, unknown>[];
  emitted: EmittedRows;
  /** `content` of every chunk a non-patient retriever returned. */
  corpusTexts: readonly string[];
  /**
   * The tool messages this turn put in the prompt FOR THE PATIENT'S OWN
   * RECORD — this platform's rendered rows and nothing else. A source
   * for a claim, and the record's own reference intervals if it printed
   * any.
   *
   * A CORPUS TOOL MESSAGE MUST NOT BE PASSED HERE. Every interval in
   * this text is admissible as 「what the laboratory printed beside this
   * patient's value」, and a knowledge-base chunk that states FSHD1's
   * repeat range would make an invented 参考范围 column look sourced —
   * which is what happened when this was every tool message. Corpus
   * text belongs in `corpusTexts`, where it supports a mechanism claim
   * and nothing else.
   */
  renderedTexts?: readonly string[];
  /** The question, and the assistant turns of the history. Read only for
   *  the genetics cells `patientPayloads` did NOT carry this turn; see
   *  `collectConversationNumbers`. */
  conversationTexts?: readonly string[];
}

export const buildGuardEvidence = (input: BuildGuardEvidenceInput): GuardEvidence => {
  // WHICH CELLS THIS TURN'S OWN RECORDS CARRY. Read first, because it is
  // both halves of one question: which cells the prompt withheld a value
  // for (below), and which cells the conversation fallback is allowed to
  // speak for (`collectConversationNumbers`).
  const onFile = new Set<string>();
  const walk = (value: unknown, key: string, depth: number): void => {
    if (depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (HARD_DELETE_KEYS_LOWER.has(innerKey.toLowerCase())) continue;
        walk(innerValue, innerKey, depth + 1);
      }
      return;
    }
    if (value === null || value === undefined || value === '') return;
    const cell = cellOfKey(key);
    if (cell !== null) onFile.add(cell);
  };
  for (const payload of input.patientPayloads) walk(payload, '', 0);

  const numbers: PatientNumber[] = [];
  for (const payload of input.patientPayloads) collectNumbers(payload, '', 0, numbers);
  collectConversationNumbers(input.conversationTexts ?? [], onFile, numbers);

  // Which cells this platform graded, and which it merely printed. Both
  // sets are read off the SAME rows: a `_clinical` row is this
  // platform's reading of a cell, and a cell with any other row and no
  // `_clinical` row is one it declined to read.
  const printedKeys = [...input.emitted.fields, ...input.emitted.ocrKeys];
  const graded = new Set<string>();
  const printed = new Set<string>();
  for (const key of printedKeys) {
    const cell = cellOfKey(key);
    if (cell === null) continue;
    printed.add(cell);
    if (key.endsWith('_clinical')) graded.add(cell);
  }
  const ungradedCells = [...printed].filter((cell) => !graded.has(cell));

  // WHICH CELLS ARE HIS. Both halves of 「the turn holds this cell for
  // this patient」: a cell his own payloads carry (`onFile`) and a cell
  // the projection printed. The conversation fallback's cells are added
  // too — on a follow-up turn that retrieved nothing there is no
  // projection at all, and that is exactly the turn where the model
  // writes about 「你的重复数」 with no digit anywhere near it.
  const patientCells = new Set<string>([...onFile, ...printed]);
  for (const number of numbers) {
    if (number.cell !== null) patientCells.add(number.cell);
  }

  // A cell the RECORD holds a value for and the PROMPT does not carry —
  // `onFile` above against the printed rows, which is the only pairing
  // that can tell 「consent withheld it」 from 「there is no such cell」,
  // the distinction the model got backwards.
  //
  // A cell whose ONLY printed rows are a reading or a withheld statement
  // has no value in the prompt. `_clinical` is a reading of the cell, not
  // the cell: strict mode prints `d4z4Repeats_clinical` and drops the
  // count, and 「你的重复数报告里没写」 would be as false as the
  // methylation sentence.
  const valuePrinted = new Set<string>();
  for (const key of printedKeys) {
    const cell = cellOfKey(key);
    if (cell === null) continue;
    if (key.endsWith('_clinical') || key.endsWith('_withheld') || key.endsWith('_origin')) continue;
    valuePrinted.add(cell);
  }
  const withheldCells = [...onFile].filter((cell) => !valuePrinted.has(cell));

  const renderedTexts = input.renderedTexts ?? [];
  const supportShingles = new Set<string>();
  // The Chinese for a reading counts as a source ONLY when this turn
  // actually printed that reading. The whole table would be a different
  // thing: 「这一格记的是长度（kb），不是重复单元数」 contributes the
  // shingle 重复单元 to every turn, and an invented sentence containing
  // 重复单元 would score as sourced. What is admissible is what the
  // prompt in front of the model said, in the language the model is
  // obliged to say it back in.
  const readingsPrinted = WIRE_TOKENS_LONGEST_FIRST.filter((token) =>
    renderedTexts.some((text) => text.includes(token)),
  ).map((token) => WIRE_TOKEN_ZH[token]);
  for (const text of [...input.corpusTexts, ...renderedTexts, ...readingsPrinted]) {
    for (const shingle of shinglesOf(text)) supportShingles.add(shingle);
  }

  // The intervals the RECORD carried. Deliberately NOT the corpus: a
  // threshold a paper states is a fact about a cohort, and printing it
  // in a 参考范围 column beside this patient's value presents it as the
  // interval their laboratory printed. See `fabricated_reference_range`.
  const recordIntervals = new Set<string>();
  const scalars: string[] = [];
  for (const payload of input.patientPayloads) collectScalars(payload, 0, scalars);
  for (const text of [...scalars, ...renderedTexts]) {
    for (const interval of intervalsIn(normaliseForMatch(text))) recordIntervals.add(interval);
  }

  return {
    numbers,
    ungradedCells,
    withheldCells,
    supportShingles,
    corpusChunkCount: input.corpusTexts.length,
    recordIntervals,
    patientCells,
  };
};

// ------------------------------------------------------------------ segments

/**
 * The unit the guard judges and, when it has to, removes.
 *
 * A LINE when the line is a table row or a heading, a SENTENCE
 * otherwise. The table case is not a nicety: the observed severity
 * violation was a table cell under the header 「对你个人的意义」, and a
 * table cell is not a sentence — it has no 。 and no 你, and splitting on
 * punctuation would have judged 「1–3 个重复单元属于病情较严重的遗传基础」
 * as a fragment of the row above it. Removing half a row would also
 * leave a broken table on the patient's screen.
 *
 * `text` is verbatim — it is quoted back to the model and it is what the
 * excision has to find again. `match` is the same span with the
 * markdown taken off, and it is what every check reads. See
 * `normaliseForMatch`.
 */
interface Segment {
  text: string;
  match: string;
  start: number;
  end: number;
}

const SENTENCE_END = /[。！？；!?;]/u;

const makeSegment = (text: string, start: number, end: number): Segment => ({
  text,
  match: normaliseForMatch(text),
  start,
  end,
});

/**
 * A SPAN THAT IS NOTHING BUT MARKDOWN IS NOT A SEGMENT.
 *
 * Sentence-splitting cuts at the 。, and the model puts its closing
 * 「**」 AFTER the 。 — so 「**你的重复数落在 1-3 个重复单元这一档。**」
 * became two segments, the second one the two characters 「**」. It can
 * never be a violation (every check reads `match`, which is empty for
 * it) but it SAT BETWEEN the lead-in and the table, and the lead-in test
 * asks what comes next. A stray asterisk pair was standing between a
 * band and the three rows that read it as a prognosis, and all three
 * published. It also silently broke the 这个区间 chain, whose referent is
 * the segment immediately before.
 *
 * Dropping it is safe in the direction that matters: a span with no
 * content characters carries no claim, no number and no cell, so nothing
 * that could have been withheld is lost by not looking at it. A
 * separator row keeps its pipes and dashes and is NOT dropped —
 * `isHeaderRow` reads it.
 */
const carriesWords = (segment: Segment): boolean => segment.match.trim() !== '';

const segmentsOf = (answer: string): Segment[] => {
  const segments: Segment[] = [];
  let lineStart = 0;
  for (const line of answer.split('\n')) {
    const trimmed = normaliseForMatch(line).trim();
    const isRowOrHeading = trimmed.startsWith('|') || trimmed.startsWith('#');
    if (line.trim().length > 0) {
      if (isRowOrHeading) {
        segments.push(makeSegment(line, lineStart, lineStart + line.length));
      } else {
        let cursor = 0;
        let sentenceStart = 0;
        for (const ch of line) {
          cursor += ch.length;
          if (!SENTENCE_END.test(ch)) continue;
          const text = line.slice(sentenceStart, cursor);
          const segment = makeSegment(text, lineStart + sentenceStart, lineStart + cursor);
          if (carriesWords(segment)) segments.push(segment);
          sentenceStart = cursor;
        }
        if (sentenceStart < line.length) {
          const text = line.slice(sentenceStart);
          const segment = makeSegment(text, lineStart + sentenceStart, lineStart + line.length);
          if (carriesWords(segment)) segments.push(segment);
        }
      }
    }
    lineStart += line.length + 1;
  }
  return segments;
};

const isTableRow = (segment: Segment): boolean => segment.match.trim().startsWith('|');

/** The cells of a markdown row, without the outer pipes. */
const rowCells = (match: string): string[] => {
  const trimmed = match.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return trimmed.split('|');
};

const isSeparatorRow = (match: string): boolean => /^\s*\|[\s:|-]+\|?\s*$/u.test(match);

/**
 * WHICH ROW IS THE HEADER — asked of markdown's own structure rather
 * than of the words in the row.
 *
 * The first version called any row containing 参考范围 a header, which
 * held until a run against the stack produced
 *
 *   | **D4Z4 重复数** | 3 | 1–10（FSHD 患者范围）<br>≥11（正常范围） | … |
 *
 * — a DATA row whose reference cell says 正常范围, read as a second
 * header, so the column was re-registered and the row itself was never
 * checked. The invented interval was published under the guard's nose.
 *
 * A markdown header is the row immediately above the separator. That is
 * a fact about the document and a data row cannot spell its way into
 * being one.
 */
const isHeaderRow = (segments: readonly Segment[], index: number): boolean => {
  const next = segments[index + 1];
  return next !== undefined && isTableRow(next) && isSeparatorRow(next.match);
};

// ------------------------------------------------------------------- checks

/**
 * The words that turn a value into a prediction.
 *
 * A LEXICON, and it has to be. THE RULE AT THE TOP OF THIS FILE SAYS TO
 * ASK FIRST WHETHER A FACT THE TURN HOLDS COULD ANSWER IT, so: it
 * cannot. The turn holds which numbers are his, which cells this
 * platform graded, what the retrieval says and which intervals the
 * record printed. NONE OF THOSE ANSWERS 「is this sentence a prediction
 * about how bad it will get」. 「严重」 is a judgement, and no projection
 * row, no chunk and no payload key will ever derive it. So this half
 * stays a list, it is used ONLY to decide to WITHHOLD, and the fact —
 * whose number the sentence lands on — is the half that does the work.
 * A lexicon alone would flag every sentence in a disease encyclopedia.
 *
 * IT IS A REGISTER LIST, AND IT WILL ALWAYS BE INCOMPLETE. That is the
 * defect the second half of it exists to reduce rather than to close.
 * The first version carried only the 更-comparatives — 更快 更重 更早 —
 * which is the register of a translation, not of a clinical answer
 * written in Chinese. A Chinese clinical answer states exactly the claim
 * this check exists to stop in the 较 / 比较 / 偏 / 相对 register:
 * 「发病较早」「病情比较重」「起病偏早」「相对较重」, and every one of
 * those went straight past. The band-naming half was working the whole
 * time; the half that decides WHAT WAS SAID was reading for the wrong
 * register.
 *
 * So the comparatives are written COMPOSITIONALLY — a degree marker
 * against a severity axis — because that is what the language actually
 * does, and because enumerating 4×7 pairs by hand is how the next
 * register goes missing too. It still will not be complete: a claim
 * written 「病情不容乐观」 or 「预后堪忧」 or in any register nobody has
 * driven the stack in yet is a claim this list does not hold, and the
 * excision notice must not promise otherwise — see `buildExcisionNotice`.
 *
 * 早 is excluded before 期 so 「比较早期的报告」 — a sentence about a
 * DOCUMENT's date — is not read as a claim about when the disease
 * started.
 */
const COMPARATIVE_DEGREE = '(?:更|较|比较|偏|相对较?|稍微?|略|越|最)';
/** The axes a severity claim is made along. Bare, these are far too
 *  broad to use — they only count behind a degree marker or in front of
 *  a comparative tail. */
const SEVERITY_AXIS = '(?:早(?!期)|晚|重|轻|快|慢|差)';
const SEVERITY_WORD = new RegExp(
  [
    '严重|重症|轻重|轻型|重型|预后|进展|恶化|加重|病程|残疾|轮椅|走不了|失能|寿命|活不',
    '发病早|起病早|早发|晚发|发病年龄|起病年龄|表型更|表型偏|受累',
    // 更早 / 较早 / 比较重 / 偏重 / 相对较重 / 越快 / 最重 — and so
    // 发病较早, 起病偏早, 病情比较重 through the axis inside them.
    `${COMPARATIVE_DEGREE}${SEVERITY_AXIS}`,
    // 「进展快一些」「重得多」 — the comparative written as a tail.
    `${SEVERITY_AXIS}(?:一些|一点|得多|不少)`,
  ].join('|'),
  'u',
);

/**
 * WHY THERE IS NO LONGER A POPULATION ESCAPE ON THIS CHECK.
 *
 * There was one: a sentence carrying 群体 / 人群 / 队列 / 研究 was
 * exempt, because `CLINICAL_INFERENCE_BOUNDS` permits a cohort statement
 * said as a cohort statement and the population trend is real,
 * publishable, and most of an honest answer to 「重复数少是不是更重」.
 *
 * Driven against the running stack, that exemption is the hole the model
 * walks through. Asked 「从群体研究的角度讲，重复数落在 1-3 这一档的人，
 * 病情是不是更重、发病更早？」 about a patient whose count is 3, it wrote
 * 「在群体研究层面，D4Z4 重复数 1–3 确实与更早发病、更严重的病情相关」,
 * 「1–3 个重复单元的患者更高风险属于「早发型」FSHD」 and
 * 「早发型患者的中位重复数为 3」 — every one of them exempt, every one of
 * them naming the band this reader is standing in, and the guard
 * recorded no violation at all.
 *
 * The prompt already said what the code did not: a cohort framing is a
 * licence to state a cohort fact, not a licence to name the band the
 * reader is standing in. So the escape is gone, and what replaces it is
 * not another word list — it is the fact the check was already built
 * on. A cohort sentence that does not carry his number or a band around
 * it never matched this check to begin with:
 * 「在人群层面，重复数越短总体上发病越早、越重，但这是趋势，不是对你个人
 * 的预测」 has no digits in it and passes untouched, which is the shape
 * the prompt asks for and the shape this check now leaves alone.
 *
 * WHAT THAT COSTS, stated: a cohort finding whose whole content is the
 * band — 「早发型患者的中位重复数为 3」 — cannot be published to the
 * patient whose count is 3. That is the intended trade. The
 * regeneration directive says so explicitly, so the model gets one
 * chance to write the same finding without standing the reader in it.
 */

/**
 * The thing that is not a prediction: the model REFUSING to make one, or
 * handing the question to a clinician.
 *
 * Both were excised in a live run, which is the worst possible outcome
 * for this check — the sentence removed was the platform's own position,
 * stated correctly, in the model's voice:
 *
 *   「我不能把你的 3 个重复单元、95% 甲基化值拿来判断「你病情严重不严重」」
 *   「至于 95% 这个数值对你的病情具体意味着什么，建议跟你的主治医生讨论」
 *
 * Both carry the patient's number and a severity word and neither is a
 * claim. `CLINICAL_INFERENCE_BOUNDS` asks for exactly these two moves,
 * so a guard that deletes them is enforcing the opposite of the rule.
 */
const CLAIM_DISCLAIMED =
  /不能|不会|无法|没法|没能|没办法|不做|不拿|不据此|不是对|不要自己|不是用来|不能用来|不作为|不足以|不预测|不推断|不判断|说不准|由医生|请医生|主治医生|问医生|医生判断|医生评估/u;

/**
 * ...AND IT HAS TO STAND IN FRONT OF THE CLAIM, WHICH IS THE RULE THIS
 * ESCAPE WAS MISSING AND THE ONE ITS NEIGHBOURS ALREADY HAVE.
 *
 * `gradingIsNotAsserted` two screens down says it plainly for check 2:
 * 「我没办法把这个数值解读成「高」或「低」」 is a refusal and has to
 * survive, 「95% 高出常规预期，我没有办法解释」 is a grade followed by a
 * disclaimer and must not — POSITION is the only thing separating them.
 * The same distinction was never applied here: `CLAIM_DISCLAIMED` was
 * tested against the WHOLE segment, so a hedge anywhere in it, including
 * after the claim, stood the entire severity check down. Which is the
 * shape a model reaches for by default:
 *
 *   「1–3 个重复单元这一档发病较早、病情较重，不过具体还要看你的主治医生
 *    怎么判断。」
 *
 * The claim is delivered whole, in front of a reader whose count is 3,
 * and the trailing referral — the very sentence this platform asks for
 * everywhere else — was acting as the password for it.
 * `CLINICAL_INFERENCE_BOUNDS` already says a hedge does not rescue a
 * prediction (「前面加上「通常」「往往」「可能」也一样不行」); this makes
 * the code say it too.
 *
 * SO: the disclaimer only cancels a severity word that comes AFTER it.
 * That keeps every refusal this file has pinned — 「我不能把你的 3 个重复
 * 单元…拿来判断「你病情严重不严重」」 opens with 不能 — and takes the
 * escape away from the claim that has already been made.
 *
 * AND THE INTERROGATIVE COMES WITH IT, for the reason check 2 already
 * gives about its own grading word: a severity word inside a question
 * being handed to a clinician is not a verdict.
 * 「95% 这个数值具体代表什么、是否异常、是否提示更重或更轻的表型，建议你
 * 拿着报告去问你的主治医生。」 was removed from a live answer by check 2
 * before `INTERROGATIVE` existed, and putting a position rule on check 1
 * without it would remove the same sentence again from the other side.
 * The question mark stands BEFORE the severity word there, which is what
 * makes it a question about it rather than an answer to it.
 *
 * Asked of the ASSERTED text (the topic clause already stripped) so all
 * the positions are measured on one string.
 *
 * IT IS STILL A REGISTER LIST ON BOTH HALVES and still incomplete by
 * construction — but the incompleteness now costs a sentence that should
 * have been cut rather than an escape hatch, which is the direction this
 * file's lists are supposed to fail in and the direction this one was
 * failing in backwards.
 */
const claimIsNotAsserted = (asserted: string): boolean => {
  const severity = asserted.search(SEVERITY_WORD);
  if (severity < 0) return false;
  const before = asserted.slice(0, severity);
  return CLAIM_DISCLAIMED.test(before) || INTERROGATIVE.test(before);
};

/**
 * Words that put a cell on a scale. Paired with a cell the platform
 * declined to grade, this is the platform drawing a line it refuses to
 * draw.
 *
 * ANOTHER REGISTER LIST, and the same warning as `SEVERITY_WORD`: it
 * decides only to WITHHOLD, and it will never be complete. 正常范围 was
 * in it; 典型范围 was not, and driving the running stack in this round
 * the model published 「你的甲基化 95% 是在 FSHD1 的典型范围里的」 —
 * a line drawn on the one cell this platform permanently refuses to
 * grade, said in the synonym the list did not hold. The cell terms and
 * the possessive are grounded in facts the turn holds; this half is
 * not, and cannot be.
 */
const GRADING_WORD =
  /偏高|偏低|过高|过低|很高|很低|太高|太低|极高|极低|相当高|非常高|高出|低于|超出|超标|异常|正常范围|典型范围|常规范围|正常水平|明显升高|明显降低|属于高|属于低|高甲基化|低甲基化|分级|哪一档|这一档|程度很|水平很|读成|比较少见|不太常见/u;

/** A negation reaching FORWARD over the grading word. 「我没办法把这个数值
 *  解读成「高」或「低」」 is a refusal to grade and must survive; 「95% 高出
 *  常规预期，我没有办法解释」 is a grade followed by a disclaimer and must
 *  not. Position is what separates them, so the marker only cancels a
 *  grading word that comes after it. */
const NEGATION = /不|没|无法|拒绝|未|别|勿/u;

/**
 * A sentence ASSERTING a cause.
 *
 * 「机制」 on its own is the word, not the claim, and admitting it made
 * the check fire on a sentence that proposed nothing: driven against the
 * stack, 「我再帮你查一下知识库，看看有没有关于这家检测机构的甲基化检测
 * 方法或者相关机制的解释」 — a search preamble — was read as an invented
 * mechanism and excised. So the word only counts when it is followed by
 * the shape that turns it into an assertion (机制是 / 的机制在于 /
 * 机制上).
 *
 * BARE 「因为」 IS GONE for the same reason: it is a discourse connective
 * before it is a causal claim, and
 * 「因为即使是相同的重复数，不同的人病情也可能很不一样」 — a caveat
 * saying the opposite of a mechanism — was excised from a live answer on
 * it. 「是因为」 stays, because that one is an assertion.
 */
const CAUSAL_MARKER = /由于|导致|引起|造成|代偿|使得|是因为|所致|机制(?:是|上|在于)/u;

export type ClinicalViolationKind =
  | 'severity_from_patient_number'
  | 'ungraded_cell_graded'
  | 'unsourced_mechanism'
  | 'retest_of_a_value_on_file'
  | 'fabricated_reference_range';

export interface ClinicalViolation {
  kind: ClinicalViolationKind;
  /** Verbatim, so the regeneration can quote it back and the excision
   *  can find it again. */
  sentence: string;
  /** The fact from THIS TURN that makes it a violation, in Chinese,
   *  because it is quoted to the model and summarised to the patient. */
  because: string;
}

/** Does the segment carry this number as a number, rather than as part
 *  of an identifier? 「FSHD1」 must not match 1 and 「D4Z4」 must not
 *  match 4 — both appear in every correct answer about this patient. */
const carriesNumber = (segment: string, value: number): boolean => {
  const literal = String(value);
  // 「/」 is a boundary too. 「没有统一的 Stage 1/2/3 之类的分期」 — a
  // sentence saying this platform has NO severity ladder — was removed
  // from a live answer because its 3 was read as the patient's repeat
  // count.
  const pattern = new RegExp(`(?<![0-9A-Za-z./])${literal}(?![0-9A-Za-z./])`, 'u');
  return pattern.test(segment);
};

/** ...or a band containing it. 「属于 1–3 个单元的范围」 never prints the
 *  patient's 3 as a standalone token in some phrasings, and the band is
 *  the same claim about the same person. */
const BAND = new RegExp(BAND_SOURCE, 'gu');

const carriesBandAround = (segment: string, value: number): boolean => {
  BAND.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BAND.exec(segment)) !== null) {
    const low = Number(match[1]);
    const high = Number(match[2]);
    if (Number.isFinite(low) && Number.isFinite(high) && value >= low && value <= high) return true;
  }
  return false;
};

/**
 * Is the grading word cancelled by something standing in front of it?
 *
 * Two things cancel it and both have to reach FORWARD, because position
 * is the only thing separating them from the assertion:
 *   - a NEGATION —「我没办法把这个数值解读成「高」或「低」」 is a refusal
 *     to grade and has to survive.
 *   - an INTERROGATIVE —「95% 这个数值具体代表什么、是否异常、是否提示
 *     更重或更轻的表型——建议你拿着报告去问你的主治医生」 was removed
 *     from a live answer. 「是否异常」 is the question being handed to a
 *     clinician, not a verdict.
 */
const INTERROGATIVE =
  /是否|是不是|有没有|算不算|会不会|意味着什么|代表什么|说明什么|哪一|哪个|哪种|吗/u;

const gradingIsNotAsserted = (segment: string): boolean => {
  const grading = segment.search(GRADING_WORD);
  if (grading < 0) return false;
  const before = segment.slice(0, grading);
  return NEGATION.test(before) || INTERROGATIVE.test(before);
};

function cellTermsPresent(segment: string, cell: string): boolean {
  return CELL_TERMS[cell]?.terms.some((term) => segment.includes(term)) ?? false;
}

/**
 * DOES THE POSSESSIVE ATTACH TO THE CELL — ASKED OF THE CLAUSE, NOT OF A
 * CHARACTER COUNT.
 *
 * This was a window of eight characters, and the window is why it
 * existed: 「FSHD1 通常表现为 D4Z4 区域的低甲基化，但具体的数值解读需要
 * 结合你的临床表型一起看」 was removed from a live answer because the
 * 你的 — seventeen characters away and attached to 临床表型 — was being
 * read as attaching to 甲基化.
 *
 * EIGHT CHARACTERS IS NOT WHERE CHINESE PUTS A POSSESSIVE. 你的 governs
 * its noun across as much material as the speaker cares to insert, and
 * a clinical answer inserts plenty: 「你的这份 2026 年 4 月的报告里那一格
 * 甲基化数值偏高」 puts fifteen characters between the two, and
 * 「你的报告里这一次测出来的甲基化明显升高」 puts nine. Both are the
 * violation this check exists for and both were outside the window, so
 * the check was passing exactly the sentences a Chinese answer writes.
 * Widening the count would have re-admitted the false positive above,
 * because the false positive is only 17 characters away — the count
 * cannot separate them at any value.
 *
 * WHAT SEPARATES THEM IS THE CLAUSE. A possessive binds inside its own
 * clause and stops at the comma; the FSHD1 sentence has the cell in one
 * clause and the 你的 in the next, and no amount of distance-fiddling
 * expresses that. So the segment is cut at its clause punctuation and
 * the question is asked of one clause at a time — a fact about the
 * sentence's own structure, which is what the rule at the top of this
 * file asks for wherever a fact is available.
 *
 * It is still the WEAK half of check 2 and still only ever an addition:
 * the strong half — the sentence carries this patient's own value for
 * that cell — is grounded in the projection and needs none of this. A
 * possessive this misses costs a caught violation, never a deleted true
 * sentence.
 */
const CLAUSE_BOUNDARY = /[，,、；;：:。！？!?—…\n]|——/u;
const POSSESSIVE = /你的|您的|你这|你那|您这|您那|你本人|本人|你自己|你个人|你报告|你档案/u;

/** The segment cut into clauses. A clause is where a possessive binds,
 *  and the punctuation is where a clause ends. */
const clausesOf = (segment: string): string[] =>
  segment.split(new RegExp(CLAUSE_BOUNDARY.source, 'gu')).filter((clause) => clause.trim() !== '');

const possessiveAttachedToCell = (segment: string, cell: string): boolean =>
  clausesOf(segment).some((clause) => POSSESSIVE.test(clause) && cellTermsPresent(clause, cell));

/**
 * CHECK 1 WITHOUT THE DIGIT: THE CLAIM ATTACHED TO HIS CELL BY THE
 * POSSESSIVE INSTEAD OF BY THE NUMBER.
 *
 * Check 1 asks whether the sentence carries one of HIS values or a band
 * around one, and that is the right question for every sentence that
 * names a number. It is not how the most direct form of the claim is
 * written. Driven against the running stack:
 *
 *   「你的重复数意味着病情较重」
 *   「你的这个甲基化水平提示病程进展会比较快」
 *
 * — no digit, nothing to inherit from a label or an anaphor, and check 1
 * had nothing at all to fire on. The reader is named by 你的 rather than
 * by 3, which is if anything the MORE personal way to say it.
 *
 * THE RULE AT THE TOP OF THIS FILE, APPLIED BEFORE WIDENING ANYTHING.
 * Can a fact this turn holds answer 「is this sentence about this
 * patient's own cell」? YES, and it is the same fact check 2 is already
 * built on: `patientCells` — the cells this turn holds for this patient.
 * A sentence naming 甲基化 for a patient whose record holds no
 * methylation is a sentence about the concept and this limb never sees
 * it. So the fact does the work here exactly as the number set does it
 * one limb up; nothing was added to `SEVERITY_WORD`.
 *
 * AND IT IS ASKED OF THE CLAUSE, for the reason the block above
 * `possessiveAttachedToCell` gives at length: a possessive binds inside
 * its own clause. The clause is also what keeps the honest sentence
 * alive —
 *
 *   「你的 D4Z4 重复数这一格我读到了，至于病情会不会进展，得看随访」
 *
 * has the possessive and the cell in one clause and the severity word in
 * the next, so nothing in this limb fires; the claim it exists for puts
 * all three in one clause because that is what makes it a claim.
 *
 * The possessive list is a register list like every other one here, it
 * is used only to WITHHOLD, and it is incomplete by construction: a
 * phrasing it misses costs a caught violation and never a deleted true
 * sentence.
 */
const possessedCellCarryingTheClaim = (
  segment: string,
  cells: ReadonlySet<string>,
): string | null => {
  if (cells.size === 0) return null;
  for (const clause of clausesOf(segment)) {
    if (!POSSESSIVE.test(clause)) continue;
    if (!SEVERITY_WORD.test(clause)) continue;
    for (const cell of cells) {
      if (cellTermsPresent(clause, cell)) return cell;
    }
  }
  return null;
};

// ------------------------------------------- check 4: whose absence is it

/**
 * THE CLAIM TO CATCH IS 「YOUR REPORT DOES NOT CONTAIN THIS」 ABOUT A CELL
 * THE RECORD HOLDS — however it is phrased.
 *
 * The first version asked whether an absence word stood within eight
 * characters of the cell's name, and skipped the sentence outright if it
 * mentioned consent anywhere. Both were wrong in the same direction:
 *
 *   - EIGHT CHARACTERS IS NOT HOW CHINESE REFERS BACK. Driven against
 *     the stack the model wrote 「目前获取到的报告中没有包含这一项数据」
 *     — the cell is 这一项, the name is in the sentence before it, and no
 *     window of any size reaches it.
 *   - AND THE CONSENT WORDING BECAME A PASSWORD. 「根据你的隐私设置，
 *     报告里没有甲基化结果」 says something false about the report and
 *     escaped on the 隐私设置.
 *
 * So the question is not distance and not vocabulary; it is WHOSE
 * ABSENCE THE SENTENCE ASSERTS. 「报告里没有」 is a claim about the
 * document, and it is false. 「没有发给我」「我这边看不到」 is a claim
 * about this assistant, and it is true — it is the one wording that is
 * correct here, and pushing the model off it would leave it saying
 * nothing at all.
 *
 * The subject is read as the nearest holder standing BEFORE the absence
 * word, with a delivery verb after it able to hand the absence back to
 * the assistant. That is a sentence's own structure rather than a
 * character count, and it is the only thing that separates the two.
 *
 * ---------------------------------------------------------------------
 * AND IT IS ASKED OF EVERY ABSENCE MARKER IN THE SEGMENT, NOT THE FIRST.
 *
 * Resolving only the first one was a hole with this platform's own name
 * on it. `WIRE_TOKEN_ZH` localises the redactor's refusals into Chinese
 * and every one of them IS AN ABSENCE SENTENCE —
 * 「本平台没有把这一格当成化验报告上的读数」,
 * 「这一格没有写明是哪一型」 — so the model quoting the platform back at
 * the patient puts a 没有 at the front of the sentence that resolves,
 * correctly, to the ASSISTANT. Under a first-marker-only rule that
 * verdict then covered the whole segment. Driven against the running
 * stack:
 *
 *   「这一格标的是「本平台没有把这一格当成化验报告上的读数」，
 *    你的报告里也没有甲基化的结果。」
 *
 * The first 没有 is the platform's own refusal, quoted; the second is the
 * false claim about the document, and it was never examined. The guard's
 * own localisation was acting as the password.
 *
 * So every marker is resolved and ANY marker predicated of the report
 * makes the sentence a violation. The direction is right: an absence
 * sentence with two subjects is one true half and one false half, and
 * the false half is the one the patient acts on.
 */
/**
 * THE WAYS CHINESE SAYS A DOCUMENT LACKS A FIELD.
 *
 * A REGISTER LIST, and by the rule at the top of this file it has to
 * be: no fact this turn holds can decide whether a string of Chinese
 * ASSERTS an absence. The turn knows the cell is on file and that
 * consent held its value back — that is `withheldCells`, and it is the
 * fact half of check 4, the half that decides the claim is FALSE. This
 * half only decides that an absence was claimed at all, and it will
 * never be complete: this list is the gate on the whole of check 4, and
 * a phrasing missing from it costs a caught violation.
 *
 * It was the 「没有」 register and nothing else, which is one register out
 * of several a report summary actually uses. 「报告里未提及甲基化」,
 * 「报告里找不到这一项」, 「这一格是缺失的」, 「那一栏是空白的」 are the
 * ordinary ways to say it and every one of them walked straight past.
 *
 * THE FIELD-STATE FORMS ARE ANCHORED TO THE FIELD WORD, and that is not
 * tidiness. 缺失 is also the clinical word for a DELETION — 「D4Z4 片段
 * 缺失」 is a finding the report STATES, not a field it lacks — and a
 * bare 缺失 in the list would delete that true sentence off the
 * patient's screen. So the field-state words only count as an absence
 * when they are predicated of a FIELD (项 / 格 / 栏 / 数据 / 结果 …),
 * which is the sentence's own structure rather than a guess. Every
 * marker here still fails toward silence: it only ever decides to
 * WITHHOLD a sentence, never to publish one.
 */
const ABSENCE_MARKER =
  /(?<!有)没有|不含|未包含|缺少|没做|未做|查不到|未检出|没写|未写|不包括|未提及|未提到|没提及|没提到|找不到|(?:项|格|栏|列|字段|数据|结果|信息|内容|数值|值)\s*(?:是|为|都是)?\s*(?:缺失|空白|空的|空着|留空|未填|没填|空(?![\u4e00-\u9fff]))/u;
const REPORT_HOLDER = /报告|记录|档案|资料|化验单|单子|检测结果|报告单|这份|上传的|里面/u;
/**
 * WHO CAN LACK SOMETHING — AND 授权 CANNOT, WHICH IS WHY IT IS GONE.
 *
 * The block above says the consent wording must not become a password,
 * and then 授权 sat in the holder list, where it became one again by a
 * different route. The subject resolves to the LAST holder before the
 * marker, so consent wording placed BETWEEN the report and the absence
 * — 「你的报告里的甲基化，按当前授权，没有结果。」, which is the ordinary
 * order for a reason clause in Chinese — made the platform the subject
 * of a sentence whose subject is plainly the document, and the false
 * claim published.
 *
 * The distinction is structural, not lexical: 我这边 / 系统 / 平台 are
 * PARTIES that can hold or fail to hold a value, and 授权 is a
 * CONDITION on delivery. A condition is not a subject. What actually
 * hands the absence back to this assistant is the delivery verb below —
 * 「按当前授权没有发给我」 — and that is the wording the file already
 * relies on and the wording this platform's own projection mints
 * (`value_withheld`: 「有结果在案，按当前授权没有发出」), so 发出 joins
 * it.
 */
const SELF_HOLDER = /我这边|我这里|我目前|我手上|我看到|我收到|系统|平台|这边|我方/u;

/**
 * THE VERB THAT HANDS THE ABSENCE BACK TO THIS ASSISTANT — SPLIT IN TWO,
 * BECAUSE HALF OF THE OLD LIST IS PREDICATED OF THE DOCUMENT AT LEAST AS
 * READILY AS OF THE ASSISTANT.
 *
 * The single list held 发给 / 给我 / 传给 / 到我 beside 显示 / 读到 /
 * 看到 / 拿到 / 收到 / 访问, and treated the presence of any of them in
 * the marker's clause as proof that the absence was this assistant's.
 * The first group cannot be said of a report — a report does not 「发给
 * 我」 anything, the platform's own projection mints 「按当前授权没有发
 * 出」, and the direction is inside the verb. THE SECOND GROUP HAS NO
 * DIRECTION IN IT AT ALL. 「报告里没有显示甲基化结果」 is the ordinary
 * Chinese for 「the document does not show it」 — the report is the
 * subject, the claim is false, and it is exactly what check 4 exists to
 * stop. The old list read 显示 as the assistant's verb and let it
 * publish. 「报告里没有写到甲基化」 and 「这份资料里没有看到这一项」 are
 * the same shape.
 *
 * WHAT SEPARATES THEM IS WHO IS DOING IT, and that is in the clause
 * rather than in the verb: 「我这边没有看到」 and 「系统没有显示出来」 name
 * the party, 「报告里没有显示」 does not. So the ambiguous verbs only
 * cancel the claim when the assistant is NAMED in the marker's own
 * clause. A bare 我 counts — it is the subject, which is the whole
 * question — and it is why 「你的报告里的甲基化，我没有看到」 survives
 * while 「你的报告里没有显示甲基化」 does not.
 *
 * Both lists are register lists and both are incomplete by construction.
 * They differ in FAILURE DIRECTION and that is why they are separate: a
 * verb missing from `DELIVERY_TO_SELF` costs a true assistant-side
 * sentence (the guard over-cuts), a verb missing from
 * `PERCEPTION_VERB` costs nothing at all, and a verb wrongly IN
 * `DELIVERY_TO_SELF` publishes a false claim about the patient's report.
 * So the first list stays narrow and only takes verbs whose direction is
 * lexical.
 */
const DELIVERY_TO_SELF = /发(?:给|到|出|来)|给我|传(?:给|到)|到我|获取到我/u;
const PERCEPTION_VERB = /显示|读到|拿到|收到|看到|查到|检索到|访问|获取到|写到|提到|列出/u;
/** The assistant, as the subject of one of those verbs. 「我的」 is
 *  excluded on purpose: it is the PATIENT's possessive — 「我的报告里没有
 *  显示甲基化」 is the false claim about the document, said by a model
 *  writing in the patient's voice, and reading its 我 as the assistant
 *  would hand it the escape. */
const SELF_SUBJECT = /我(?!的)|系统|平台|这边|本方/u;

/** The cell, named by a pronoun rather than by its word. Only counts
 *  when the cell's own name was established earlier in the answer —
 *  the anaphora has to have an antecedent, and the document is where it
 *  lives. */
const CELL_ANAPHORA =
  /这一项|这个项目|这项|该项|这一格|这一栏|这个指标|这个数值|这个结果|这部分|这些数值|这一条/u;

/**
 * WHAT THE DELIVERY VERB HAS TO BE: THE VERB THE ABSENCE MARKER NEGATES,
 * NOT A WORD SOMEWHERE AFTER IT.
 *
 * The block above says twice that the consent wording must not become a
 * password, and then a 24-CHARACTER WINDOW made it one a third time, by
 * position instead of by presence. Stating the absence first and
 * explaining it second is the ordinary order in Chinese:
 *
 *   「你的报告里没有甲基化的结果，因为按当前授权没有发给我。」
 *
 * The first 没有 is predicated of the DOCUMENT and is false. The second
 * is predicated of this assistant and is true. They are twelve
 * characters apart, so the true half's 发给 sat inside the false half's
 * window and stood the whole check down — the same sentence with the two
 * clauses swapped was caught, which is not a distinction about meaning.
 *
 * A window cannot separate them at any width: shrink it and
 * 「按当前授权没有完整地发给我」 starts publishing as a violation, widen
 * it and more of the sentence becomes password. WHAT SEPARATES THEM IS
 * THE CLAUSE, exactly as it does for the possessive one screen up. 没有
 * governs the verb in its OWN clause; a verb across the comma belongs to
 * the next predicate and says nothing about this one. So the delivery
 * verb is looked for between the marker and the end of its clause, which
 * is the sentence's own structure rather than a character count, and
 * every marker in the segment is still resolved on its own.
 */
/**
 * ...AND THE SUBJECT MAY STAND AFTER THE VERB, WHICH IS THE ORDINARY
 * CHINESE EXISTENTIAL ORDER AND NOT AN EVASION.
 *
 * The resolution only ever looked BACKWARD: the subject was the nearest
 * holder standing before the marker, and a marker with no holder in
 * front of it was 「about nobody」 and stood the check down. Chinese
 * writes the other order at least as often — the negated existential
 * puts the thing first and the location after the verb:
 *
 *   「甲基化的结果没有出现在你上传的报告里。」
 *   「这一项没有包含在这份检测结果中。」
 *
 * Both are claims about the DOCUMENT, both are false about a cell the
 * record holds, and both had nothing before the 没有 to resolve to, so
 * `absenceAtIsAboutTheReport` returned false on the plainest existential
 * sentence there is.
 *
 * SO THE FORWARD LOOK IS THE FALLBACK AND NOT AN ADDITION: it is
 * consulted ONLY when neither holder stands in front of the marker.
 * That ordering is what keeps this platform's own quoted refusal alive
 * —「这一格标的是「本平台没有把这一格当成化验报告上的读数」」 has 平台
 * BEFORE the marker and 报告 after it, and reading the tail first would
 * turn the platform's correct position into a violation. A holder in
 * front wins, exactly as it did before; the tail only speaks when the
 * front is silent.
 *
 * The delivery test still runs first, so 「没有发给我这份报告里的数值」
 * is still the assistant's absence.
 */
/** Whose absence is the marker AT THIS POSITION predicated of? */
const absenceAtIsAboutTheReport = (
  segment: string,
  marker: number,
  markerLength: number,
): boolean => {
  const head = segment.slice(0, marker);
  const afterMarker = segment.slice(marker + markerLength);
  const boundary = afterMarker.search(CLAUSE_BOUNDARY);
  // The rest of the marker's OWN clause. `CLAUSE_BOUNDARY` is where a
  // clause ends; a delivery verb past it is the next predicate's.
  const tail = boundary < 0 ? afterMarker : afterMarker.slice(0, boundary);
  const lastOf = (pattern: RegExp): number => {
    let best = -1;
    let from = 0;
    for (;;) {
      const rest = head.slice(from);
      const at = rest.search(pattern);
      if (at < 0) break;
      best = from + at;
      from = best + 1;
    }
    return best;
  };
  const report = lastOf(REPORT_HOLDER);
  const self = lastOf(SELF_HOLDER);
  // 「你的报告里的甲基化数值按当前授权没有发给我」 — the report is the
  // nearest holder, and the absence is still the assistant's. The
  // delivery verb is what says so, and it has to be THIS marker's verb.
  if (DELIVERY_TO_SELF.test(tail)) return false;
  // ...and the verbs a REPORT is the subject of just as readily only
  // cancel it when the assistant is named in this marker's own clause.
  // See `PERCEPTION_VERB`.
  const clauseHead = head.split(new RegExp(CLAUSE_BOUNDARY.source, 'u')).slice(-1)[0] ?? '';
  if (PERCEPTION_VERB.test(tail) && SELF_SUBJECT.test(clauseHead + tail)) return false;
  if (report >= 0) return self <= report;
  // Nothing in front of the marker holds anything. The existential order
  // puts the document after the verb; it counts only when this marker's
  // own clause names no other party after it either.
  if (self >= 0) return false;
  const reportAfter = tail.search(REPORT_HOLDER);
  const selfAfter = tail.search(SELF_HOLDER);
  if (reportAfter < 0) return false;
  return selfAfter < 0 || selfAfter > reportAfter;
};

/** The same regex, walked. `ABSENCE_MARKER` is deliberately kept
 *  non-global so nothing else in this file inherits a `lastIndex`. */
const ABSENCE_MARKER_EVERY = new RegExp(ABSENCE_MARKER.source, 'gu');

/** Does the segment assert, ANYWHERE in it, that the REPORT lacks
 *  something? See the block above: one segment can carry the platform's
 *  own refusal and the false claim about the document, and only the
 *  second one is a violation. */
const absenceIsAboutTheReport = (segment: string): boolean => {
  ABSENCE_MARKER_EVERY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ABSENCE_MARKER_EVERY.exec(segment)) !== null) {
    if (absenceAtIsAboutTheReport(segment, match.index, match[0].length)) {
      ABSENCE_MARKER_EVERY.lastIndex = 0;
      return true;
    }
    // A zero-length match cannot happen with this alternation, but a
    // stalled `lastIndex` would spin forever if one ever did.
    if (match.index === ABSENCE_MARKER_EVERY.lastIndex) ABSENCE_MARKER_EVERY.lastIndex += 1;
  }
  return false;
};

/**
 * A sentence RECOMMENDING the patient go and get a test — as opposed to
 * one restating the question they asked.
 *
 * 「需要」 and 「可以」 were in here, and 「至于「是否需要再做甲基化检测」，
 * 这个问题没有标准答案」 was removed from a live answer to a patient
 * whose own question was 「需不需要再去做一个甲基化检测？」. Engaging with
 * the question they asked is not the defect; the defect is telling them
 * the report lacks the value, and then sending them to buy it again. So
 * only the advisory shapes count.
 */
const ACQUIRE_MARKER =
  /建议(?:你|您)?(?:再|去|做|查|加做)|最好(?:再|去)?(?:做|查)|应该(?:再|去)?(?:做|查)|可以去(?:做|查)|去补(?:做|查)/u;

const TEST_MARKER = /检测|检查|化验|测一下|做一个/u;

// -------------------------------------- check 5: a reference range nobody printed

/**
 * A 参考范围 CELL IS A CLAIM ABOUT WHAT THE LABORATORY PRINTED.
 *
 * Driven against the running stack and asked for a table with a
 * 参考范围 column, the model wrote
 * 「| D4Z4 重复数 | 3 | … | 3个重复单元落在 FSHD1 的诊断范围（1-10）内 |」.
 * The interval is not on the report, it is not in the projection, and it
 * is standing in a column whose header promises the reader that it is
 * the interval their own laboratory measured them against. A patient
 * comparing their 3 to a 1-10 they believe came off their report is
 * reading a diagnostic threshold this platform invented.
 *
 * The lexicon here is unavoidable — 参考范围 is a phrase, not a fact —
 * but it decides only WHERE TO LOOK. What decides the violation is the
 * fact: `evidence.recordIntervals` holds every interval the record
 * actually carried this turn, and an interval that is not one of them
 * was composed here.
 *
 * DELIBERATELY NOT ADMITTING CORPUS INTERVALS. A threshold a paper
 * states is a fact about a cohort; reprinting it under 参考范围 beside
 * this patient's own value turns it into a fact about their report. The
 * honest form — 「知识库里写 FSHD1 的重复数范围是 1–10 [2]」 — carries no
 * reference-range framing and this check never looks at it.
 *
 * THE COLUMN, NOT THE ROW. A data row usually carries no 参考范围 of its
 * own; the word is in the header. So the header is read once and the
 * column index remembered, which is the document's own structure rather
 * than a guess about which cell is which.
 */
// 正常人 / 健康人 / 正常应该 are here for the same reason 典型范围 is in
// `GRADING_WORD`: driving the running stack in this round, the model
// wrote 「正常人是 11 个以上，你的结果是 3 个」, 「正常应该超过 10 个」 and
// 「健康人（正常）：D4Z4 重复数 >10 个单元」 — a claim about what a
// laboratory calls normal, standing beside this patient's own value,
// phrased around every word this list held. Like every lexicon in this
// file it decides only WHERE TO LOOK; the violation is still decided by
// `evidence.recordIntervals`. And like every lexicon in this file it is
// still incomplete, which is why `buildExcisionNotice` no longer claims
// otherwise.
//
// 正常情况 / 正常人群 joined it the same way, in this round, on the
// running stack: asked for his value in one sentence and the normal
// value in the next, the model wrote 「你的 D4Z4 重复数是 3。」 followed by
// 「正常情况下，这个数值通常大于 10。」 — a threshold this platform never
// printed, standing one sentence away from his own number, phrased around
// every entry this list held. It is INCOMPLETE BY CONSTRUCTION and always
// will be: no fact this turn holds can decide whether a string of Chinese
// frames an interval as 「what a laboratory calls normal」. It is used
// ONLY to decide WHERE TO LOOK and therefore only ever to WITHHOLD — a
// register it misses costs a fabricated range that should have been cut,
// never a true one deleted — and the fact half (`recordIntervals`) is
// what decides the violation.
const REFERENCE_RANGE_CONTEXT =
  /参考范围|参考值|参考区间|正常范围|正常值|正常区间|正常人|正常人群|正常情况|健康人|正常应该|正常应在|临界值|界值|阈值|分界线|诊断范围|诊断区间|正常参考|cut-?off/iu;

// ------------------------------------------------------------------ topic clause

/**
 * A leading 「关于X，」 names the topic; it does not assert X.
 *
 * 「关于病情严重程度，**你的 D4Z4 重复数是 3 个**，这个重复数**落在
 * FSHD1 的范围里**」 was removed from a live answer: the severity word
 * is in the heading clause and the sentence itself is this platform's
 * own reading, read back verbatim — the one thing that must always reach
 * the patient. Stripped before the severity test, so
 * 「关于你的重复数，3 个属于病情较严重的一档」 is still caught: there the
 * severity word is in the part that remains.
 */
const TOPIC_CLAUSE = /^\s*(?:关于|至于|说到|谈到|针对)[^，。；]{0,20}[，:：]/u;

/**
 * THE GUARD'S OWN WORDS ARE NOT THE MODEL'S.
 *
 * `exciseUntilClean` re-inspects what excision left behind, and what it
 * leaves behind includes the marks below. Those marks talk about
 * 病情轻重 and about 「你的报告里没有」 because they have to explain what
 * went; re-reading them as claims would let the guard chase its own
 * tail. They are skipped by their opening, which nothing else in an
 * answer produces.
 */
const REDACTION_MARK_OPENING = '（这里有一句被我删掉了：';

/**
 * A NESTED LIST ITEM IS THE SECOND HALF OF THE LINE ABOVE IT.
 *
 * Driven against the running stack and asked for the same finding as a
 * bulleted summary, the model wrote
 *
 *   - **1–3 个重复单元**
 *     - 发病风险最高，属于「早发型」FSHD 的高危人群
 *     - 病情通常较严重，肌肉无力进展较快
 *
 * — the band on one line, the claim on the next, and neither line
 * carrying both. Markdown is how the model naturally writes a table of
 * bands, so this is not an evasion; it is the ordinary rendering, and a
 * check that reads one line at a time cannot see the sentence a reader
 * sees.
 *
 * So a nested item is judged carrying the NUMBERS its enclosing items
 * named. Numbers only, and deliberately not severity words: a heading
 * like 「关于病情严重程度：」 over a list of this platform's own readings
 * would otherwise condemn every one of them, which is the exact failure
 * `TOPIC_CLAUSE` exists to prevent.
 *
 * AND ONLY FROM A PARENT THAT IS A LABEL. `LABEL_CONTENT_MAX` is the
 * line between 「**1–3 个重复单元**」 — a group heading whose whole
 * content is the band — and a sentence that happens to mention a
 * number. A sentence carries its own claim; a label carries the claim
 * of everything under it.
 */
const LIST_ITEM_INDENT = /^(\s*)(?:[-*+•]|\d+[.)、])\s/u;
const LABEL_CONTENT_MAX = 16;

/**
 * ...AND A LEAD-IN THAT IS NOT ITSELF A LIST ITEM, WHICH IS THE ORDINARY
 * WAY A BANDED LIST GETS INTRODUCED.
 *
 * The inheritance above only inherits from a LIST ITEM, and the note at
 * the top of this file recorded the gap: a bolded prose line ending in
 * 「：」 is how a model introduces a band table, and its numbers reached
 * none of the bullets under it. Driven against the running stack:
 *
 *   **你落在 1–3 个重复单元这一档**：
 *   - 发病年龄通常比较早
 *   - 病情相对较重，进展也快一些
 *
 * Every bullet is the claim, the band is on the lead-in, and the
 * lead-in has no bullet marker so `labelStack` was empty by the time the
 * bullets were read.
 *
 * WHAT WAS TRIED BEFORE AND REJECTED IS STILL REJECTED. That note says
 * propagating numbers from ANY colon-terminated lead-in condemns
 * 「你的重复数是 3，下面是随访建议：」 followed by
 * 「- 每年复查一次，注意病程变化」 — a follow-up plan deleted for the
 * word 病程 — and that trade is still the wrong one. So this is
 * narrower, and the narrowing is not a length cutoff:
 *
 *   A PROSE LEAD-IN PROPAGATES A BAND, NEVER A BARE VALUE.
 *
 * 「1–3 个重复单元」 is an interval — a band the reader is being sorted
 * into, whose whole purpose is to say what is true of everyone in it —
 * and a claim under it is a claim about that band. 「你的重复数是 3」 is
 * a VALUE, and a list under it is a list of things to do about him. The
 * first is exactly the shape check 1 exists for; the second is the
 * follow-up plan the earlier attempt deleted. That distinction is
 * structural rather than a guess about the words, and it costs nothing
 * to the honest case: 「你的重复数是 3，下面是随访建议：」 names no band,
 * so it propagates nothing and every bullet under it is judged on its
 * own.
 *
 * The band may be one the lead-in states or one it points back at, so
 * the anaphora chain feeds it: 「你落在 1–3 这一档。这一档在临床上通常
 * 关联着：」 propagates 1–3 to the bullets through the lead-in's own
 * referent.
 *
 * AND THE HEADING WITH NO COLON AT ALL, which is what the model
 * actually wrote when this was driven against the running stack. Asked
 * for the bands as a bolded-heading list it produced
 *
 *   **1–4 个重复单元**
 *   - **发病年龄**：通常在儿童期或青春期早发…
 *   - **病情特点**：整体上病情相对更重…
 *
 * — the same structure as the colon form with the colon left off,
 * because the bold IS the punctuation. A colon-only rule reads that
 * heading as an ordinary sentence and every bullet under it goes
 * unjudged, which is how this shape published.
 *
 * So a lead-in qualifies two ways, and BOTH are gated on the band: it
 * ends in 「：」, or its whole content is short enough to be a label —
 * the same `LABEL_CONTENT_MAX` test the bulleted labels already use,
 * asked of a line that happens not to carry a bullet marker. The band
 * gate is what keeps 「你的重复数是 3，下面是随访建议：」 harmless: it is
 * short and it is colon-terminated and it names NO BAND, so it
 * propagates nothing.
 *
 * AND THE THING UNDER THE LEAD-IN IS AS OFTEN A TABLE AS A LIST, which
 * the first version of this inheritance could not see at all. The label
 * stack is cleared by any segment that is not a list item, and a table
 * row is not a list item — so
 *
 *   **你落在 1–3 个重复单元这一档**：
 *   | 项目 | 说明 |
 *   | --- | --- |
 *   | 发病年龄 | 通常比较早 |
 *   | 病情 | 相对较重，进展也快一些 |
 *
 * pushed the lead-in and then had it thrown away by the header row,
 * before a single data row was judged. Driven against the running stack
 * that is what the model writes when the same question is asked for a
 * table instead of bullets, and every row published.
 *
 * A TABLE UNDER A LEAD-IN IS THE LEAD-IN'S CONTENT, exactly as the
 * bullets are — markdown's own structure says so, since a table
 * interrupted by a blank line or a paragraph is a different table. So a
 * row no longer ENDS the lead-in's scope; it inherits from it and
 * leaves the stack standing, and the first ordinary sentence after the
 * table clears it as before. The band gate is unchanged and is what
 * keeps this honest: 「你的重复数是 3，下面是随访建议：」 names no band,
 * propagates nothing, and a table of follow-up advice under it is
 * judged row by row on its own words.
 *
 * ...AND THE LONG HEADING WITH NO COLON, which the note here used to
 * list as an accepted miss and which the table fix above put straight in
 * front of the model. Asked for the band as one bolded sentence followed
 * immediately by a table, the running stack wrote
 *
 *   **你的重复数落在 1-3 个重复单元这一档。**
 *   | 发病年龄 | 在群体中往往发病较早… |
 *   |---|---|
 *   | 病情特点 | 在群体中往往病情较重… |
 *   | 进展速度 | 在群体中进展往往较快… |
 *
 * — seventeen content characters, one over `LABEL_CONTENT_MAX`, ending
 * in 「。」 rather than 「：」, so neither branch recognised it and all
 * three rows published. A CHARACTER COUNT IS NOT WHAT MAKES A SENTENCE A
 * LEAD-IN, in exactly the way eight characters was not what makes a
 * possessive attach; and the fact that does make it one is sitting in
 * the document: WHAT COMES NEXT. A sentence immediately followed by a
 * list item or a table row introduced them — markdown says so, since
 * anything else between would break the list or end the table.
 *
 * So the third way to qualify is structural: the segment is directly
 * followed by a list item or a row. It is still gated on the band, which
 * is the whole safety of this inheritance —
 * 「你的重复数是 3，下面是随访建议：」 introduces a list too, names no
 * band, and propagates nothing either way.
 *
 * WHAT IT COSTS, stated: an ordinary sentence that happens to name a
 * band and happens to be followed by a table now propagates into it, so
 * a row under 「知识库里写 FSHD1 的范围是 1–10 [2]。」 carrying 进展 or
 * 病程 can be cut. That is the same trade the colon form already made
 * two paragraphs up, extended to one more shape of lead-in rather than
 * a new kind of trade.
 *
 * WHAT IT STILL MISSES, stated: a lead-in whose band is inherited from a
 * sentence two hops back, and a lead-in separated from its list by an
 * intervening sentence. Both fail toward publication, and both cost a
 * caught violation rather than a deleted true sentence.
 */
const PROSE_LEAD_IN = /[:：]\s*$/u;

const isProseLabel = (text: string, introducedAList: boolean): boolean =>
  PROSE_LEAD_IN.test(text) || contentChars(text).length <= LABEL_CONTENT_MAX || introducedAList;

/** Does the segment at `index` sit directly on top of a list item or a
 *  table row? Markdown's own answer to 「did this sentence introduce
 *  what follows it」 — anything in between would break the list or end
 *  the table. */
const introducesAList = (segments: readonly Segment[], index: number): boolean => {
  const next = segments[index + 1];
  if (next === undefined) return false;
  return LIST_ITEM_INDENT.test(next.text) || isTableRow(next);
};

/** Does the text state an interval at all? The BAND regex is global, so
 *  its `lastIndex` is reset before every use. */
const namesABand = (text: string): boolean => {
  BAND.lastIndex = 0;
  return BAND.test(text);
};

/**
 * ...AND THE SAME MOVE IN PROSE, WHICH IS THE OTHER HALF OF THE SAME
 * SEAM.
 *
 * Driven against the running stack, the model wrote
 *
 *   你的重复数是 3，落在 1–3 这个区间里。
 *   根据研究，这个区间的患者整体上更容易出现早发型、病情相对更重的情况。
 *
 * The first sentence is permitted and correct — it states his value and
 * says which band it is in. The second carries the claim and refers to
 * the band by 这个区间, so it holds no digit at all and check 1 had
 * nothing to match. Splitting a sentence in two is not an evasion
 * either; it is how the language works.
 *
 * So a segment that refers to a band ANAPHORICALLY and names no number
 * of its own is judged carrying the numbers of the segment immediately
 * before it. IMMEDIATELY, and one hop only: the referent of 这个区间 is
 * the last band mentioned, and reaching further back would let any
 * sentence in the answer supply a number to any other.
 */
const BAND_ANAPHORA =
  /这个区间|这一区间|该区间|这个范围|这一范围|该范围|这一?档|这个区段|这一段区间|上面这一/u;

/**
 * ...AND THE POINTER AT A VALUE, WHICH IS THE COMMONER OF THE TWO.
 *
 * The list above is every way of pointing back at a BAND, and it was the
 * only way of pointing back at anything. A patient's own number is not a
 * band, and 「你的重复数是 3。这个数值在临床上通常关联着更早的发病年龄。」
 * — which the running stack writes far more readily than the 这个区间
 * form — refers back to the VALUE. It names no digit, so
 * `previousSegmentText` was never consulted and check 1 stood down on
 * the plainest two-sentence version of the claim there is.
 *
 * NO FACT ANSWERS 「is this string an anaphor」 — it is a question about
 * notation — but the fact is still the half that decides: the anaphor
 * only causes the PREVIOUS SEGMENT'S text to be read alongside this one,
 * and check 1 then requires a number in it to be one of HIS. A pointer
 * at a sentence that named no number of his changes nothing.
 *
 * It is a closed grammatical class — a demonstrative over 数值 / 数字 /
 * 结果 / 读数 / 重复数 — rather than a claim lexicon, and it is
 * incomplete by construction like every list in this file: a form it
 * misses costs a caught violation.
 *
 * 这一格 / 这一项 are deliberately NOT here. Those point at a FIELD, and
 * 「甲基化这一格本平台不下结论。」 is the sentence that has to BREAK the
 * chain rather than extend it — see the test that pins exactly that.
 */
const VALUE_ANAPHORA =
  /这个数值|这一数值|该数值|这个数字|这一数字|该数字|这个结果|这一结果|该结果|这个读数|这个重复数|这个甲基化|这个值|这一数据|这个数据|这个水平|这个(?!数值|数字|数据)数/u;

/**
 * Does the segment name a number of its own?
 *
 * NOT 「does it contain a digit」, which was the first version and was
 * wrong for the same reason `carriesNumber` has its boundaries: FSHD1,
 * FSHD2, DUX4 and 4qA all contain digits, and
 * 「在 FSHD1 里，这是重复数最少的一档。」 is a pure anaphor that a digit
 * test reads as naming its own number — so the chain broke on the one
 * sentence shape it exists for.
 */
const STANDALONE_NUMBER = /(?<![0-9A-Za-z./])[0-9]+(?:\.[0-9]+)?(?![0-9A-Za-z./])/u;

/**
 * DOES THE SEGMENT SUPPLY ITS OWN REFERENT — ASKED OF THE ANAPHOR THAT
 * IS ACTUALLY IN IT, RATHER THAN OF EVERY DIGIT ON THE LINE.
 *
 * The chain used to be switched off by `namesANumber` — ANY standalone
 * number anywhere in the pointing sentence. The reason it exists is
 * real and is pinned: 「你的重复数是 3。8–10 这一档的预后说不清楚。」 must
 * not borrow the 3, because 这一档 is pointing at the 8–10 the sentence
 * states itself. But 「any number」 is not that rule, it is a proxy for
 * it, and it is the wrong proxy in the direction that publishes:
 *
 *   「你的重复数是 3。这个数值在 2019 年的一项队列研究里和更早的发病
 *    年龄相关。」
 *
 * 2019 is a YEAR. It is not what 这个数值 points at, nothing in the
 * sentence is, and yet its presence stood the whole chain down and check
 * 1 published a prognosis hung on the patient's own value. A citation
 * marker 「[2]」 does the same thing, and so does any cohort size the
 * model happens to quote.
 *
 * SO THE QUESTION IS ASKED OF THE ANAPHOR'S OWN KIND, which is the
 * structure that was there all along:
 *
 *   - a BAND anaphor (这个区间 / 这一档) points at an INTERVAL, so only
 *     an interval the segment states itself can be its referent;
 *   - a VALUE anaphor (这个数值 / 这个结果) points at a SINGLE NUMBER, so
 *     only a standalone number that could be a reading can be — which a
 *     year, a bracketed citation index and a counted quantity
 *     (「3 项研究」,「20 例」) cannot.
 *
 * The calendar tests are the same two `collectConversationNumbers`
 * already uses on the conversation fallback, for the same reason and
 * with the same failure direction: a form they misjudge costs a caught
 * violation, never a deleted true sentence, because the borrow only ever
 * ADDS text for check 1 to look in and check 1 still requires the number
 * it finds to be one of HIS.
 */
const STANDALONE_NUMBER_EVERY = new RegExp(STANDALONE_NUMBER.source, 'gu');

const namesAValueOfItsOwn = (text: string): boolean => {
  STANDALONE_NUMBER_EVERY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STANDALONE_NUMBER_EVERY.exec(text)) !== null) {
    const literal = match[0];
    if (CALENDAR_LITERAL.test(literal)) continue;
    if (CALENDAR_SUFFIX.test(text.slice(match.index + literal.length))) continue;
    // 「[2]」 — a citation index, which is furniture rather than a reading.
    if (text[match.index - 1] === '[' && text[match.index + literal.length] === ']') continue;
    STANDALONE_NUMBER_EVERY.lastIndex = 0;
    return true;
  }
  return false;
};

/** Does the segment point back at something it did not state itself? */
const pointsAtAnEarlierSegment = (text: string): boolean =>
  (BAND_ANAPHORA.test(text) && !namesABand(text)) ||
  (VALUE_ANAPHORA.test(text) && !namesAValueOfItsOwn(text));

/**
 * Inspect one finished answer. Pure: it reports, it does not rewrite.
 */
export const inspectAnswer = (answer: string, evidence: GuardEvidence): ClinicalViolation[] => {
  const violations: ClinicalViolation[] = [];
  const seen = new Set<string>();
  const add = (violation: ClinicalViolation): void => {
    const key = `${violation.kind}:${violation.sentence}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push(violation);
  };

  // Which columns of the table currently being read are reference
  // ranges. Reset on leaving the table; see REFERENCE_RANGE_CONTEXT.
  let referenceColumns: number[] = [];

  // Cells the answer names ANYWHERE, so a 「这一项」 has an antecedent.
  // The whole document rather than the part above it, because Chinese
  // puts the referent on either side — 「报告里没有这一项。要不要补一个
  // 甲基化检测，得看…」 names it after — and because the antecedent may
  // be a sentence an earlier excision pass already took out.
  const segments = segmentsOf(answer);
  const cellsNamedAnywhere = new Set<string>();
  for (const segment of segments) {
    for (const cell of CELL_NAMES) {
      if (cellTermsPresent(segment.match, cell)) cellsNamedAnywhere.add(cell);
    }
  }

  // Is each segment about this patient? Read once for all of them,
  // because check 5 asks it of the segment BEFORE and the segment AFTER
  // as well as of the segment itself. See `rowIsAboutThisPatient`.
  const aboutPatientAt = segments.map((segment) => rowIsAboutThisPatient(segment.match, evidence));

  /**
   * ...AND FORWARD, BECAUSE A FABRICATED THRESHOLD IS AS OFTEN STATED
   * BEFORE THE PATIENT'S VALUE AS AFTER IT.
   *
   * The hop was backward only. Driven the other way up —
   *
   *   「正常参考范围是 11 个以上。」
   *   「你的 D4Z4 重复数是 3 个。」
   *
   * — the sentence carrying the invented laboratory threshold is the
   * FIRST one, and asked on its own it is about nobody: it names no cell
   * and carries none of his numbers. The backward hop had nothing to
   * look at, and the interval published one line above the value the
   * patient was about to compare against it. Setting the range up and
   * then landing the reader in it is the more natural order of the two,
   * and it was the one direction this check could not see.
   *
   * Symmetric with the backward hop in every other respect: ONE segment,
   * and a separator row does not spend it (it is punctuation and can
   * never be about anybody).
   */
  const aboutPatientAfter = (index: number): boolean => {
    for (let next = index + 1; next < segments.length; next += 1) {
      if (isTableRow(segments[next]) && isSeparatorRow(segments[next].match)) continue;
      return aboutPatientAt[next];
    }
    return false;
  };

  // The enclosing list labels, innermost last. See LIST_ITEM_INDENT.
  let labelStack: { indent: number; text: string }[] = [];
  // The sentence before this one, for a 这个区间 that points at it.
  let previousSegmentText = '';
  // Was the sentence before this one about this patient? See the block
  // above `rowIsAboutThisPatient` for why check 5 has to ask.
  let previousAboutPatient = false;
  /**
   * ...AND WAS THE SENTENCE BEFORE THIS ONE THE 参考范围 FRAMING WITHOUT
   * THE DIGITS?
   *
   * Check 5 required the framing and the interval IN ONE SEGMENT, and a
   * model splits them as readily as it splits the claim in check 1:
   *
   *   「你的 D4Z4 重复数是 3 个。正常参考范围是这样的：」
   *   「11 个以上算正常，10 个及以下提示 FSHD1。」
   *
   * The first sentence has the framing and no interval, the second has
   * two intervals and no framing word, and neither was checked. So a
   * framing that stated no interval of its own carries forward exactly
   * one segment — the same one-hop rule the anaphora chain and the
   * about-this-patient carry already use.
   *
   * TWO NARROWINGS, because this one reaches further than the others.
   * It carries only from a framing segment that produced NO interval —
   * a framing that stated its own was already judged, and letting it
   * carry as well would condemn the sentence after every reference range
   * on the page. And it does not apply to a receiving segment that
   * carries a CITATION MARKER: 「知识库里写 FSHD1 的范围是 1–10 [2]」 is
   * the honest form this check has always left alone (see the 参考范围
   * block), and a framing sentence in front of it must not turn it into
   * a fabrication. The same `[N]` test check 3 uses, for the same
   * reason.
   *
   * WHAT IT COSTS, stated: an uncited encyclopedia interval written
   * directly after a sentence that named 参考范围 and printed none is now
   * cut. That is the trade this check has always made, extended to one
   * more position — and a patient reading 「11 个以上算正常」 one line
   * under 「正常参考范围是这样的：」 cannot tell it from their own
   * laboratory's either.
   */
  let previousFramedWithoutInterval = false;

  for (const [segmentIndex, segment] of segments.entries()) {
    const text = segment.match;
    if (text.includes(REDACTION_MARK_OPENING)) continue;
    const row = isTableRow(segment);

    const indentMatch = LIST_ITEM_INDENT.exec(segment.text);
    if (indentMatch === null) {
      // A TABLE ROW DOES NOT END THE LEAD-IN'S SCOPE — it is what the
      // lead-in introduced. See the block above PROSE_LEAD_IN.
      if (!row) labelStack = [];
    } else {
      const indent = indentMatch[1].length;
      while (labelStack.length > 0 && labelStack[labelStack.length - 1].indent >= indent) {
        labelStack.pop();
      }
    }
    // What the enclosing labels named, for the NUMBER half of check 1.
    const inherited = labelStack.map((label) => label.text).join(' ');
    // ...plus the sentence immediately before, when this one points back
    // at a band instead of naming it. See BAND_ANAPHORA.
    const anaphoric = pointsAtAnEarlierSegment(text) ? previousSegmentText : '';
    // The chain carries: 「你落在 1–3 这一档。这一档在 FSHD1 里最短。
    // 这一档发病更早。」 is three sentences and one referent. Every link
    // needs its own explicit anaphor, so the chain cannot grow through a
    // sentence that changed the subject.
    previousSegmentText = anaphoric ? `${text} ${anaphoric}` : text;
    const withInherited = [text, inherited, anaphoric].filter(Boolean).join(' ');
    if (indentMatch !== null && contentChars(text).length <= LABEL_CONTENT_MAX) {
      labelStack.push({ indent: indentMatch[1].length, text });
    } else if (
      indentMatch === null &&
      !row &&
      isProseLabel(text, introducesAList(segments, segmentIndex)) &&
      namesABand(withInherited)
    ) {
      // A lead-in the list under it inherits from. See PROSE_LEAD_IN.
      // Indent −1 so any bullet at any indent stays inside it, and
      // `withInherited` rather than `text` so a lead-in that points at
      // its band with 这一档 carries the digits it points at.
      labelStack.push({ indent: -1, text: withInherited });
    }

    // Is this segment itself about the patient, for check 5? Plus the
    // segment before it and the segment after it — the invented
    // threshold stands on either side of the value it is read against.
    const aboutThisPatient = aboutPatientAt[segmentIndex];
    const besideHisValue =
      aboutThisPatient || previousAboutPatient || aboutPatientAfter(segmentIndex);

    // ---- 5. A reference interval the record never printed -----------
    if (row) {
      // A table has its own framing — the column header — so the prose
      // carry stops at it rather than reaching across the whole table.
      previousFramedWithoutInterval = false;
      const cells = rowCells(text);
      if (!isSeparatorRow(text)) {
        if (isHeaderRow(segments, segmentIndex)) {
          referenceColumns = cells
            .map((cell, index) => (REFERENCE_RANGE_CONTEXT.test(cell) ? index : -1))
            .filter((index) => index >= 0);
        } else if (referenceColumns.length > 0) {
          const invented = referenceColumns
            .flatMap((index) => intervalsIn(cells[index] ?? ''))
            .filter((interval) => !evidence.recordIntervals.has(interval));
          if (invented.length > 0 && besideHisValue) {
            add({
              kind: 'fabricated_reference_range',
              sentence: segment.text.trim(),
              because: `这一行在「参考范围」那一列写了「${invented[0]}」，但本轮读到的报告和本平台印出来的行里都没有这个区间——这个数字不是化验室给的，患者会拿自己的数值去对它。`,
            });
          }
        }
      }
    } else {
      referenceColumns = [];
      const framedHere = REFERENCE_RANGE_CONTEXT.test(text);
      // The framing may be in this sentence or in the one before it, and
      // a receiving sentence that cites its source is the honest form
      // this check has always left alone. See `previousFramedWithoutInterval`.
      const framed: boolean =
        framedHere || (previousFramedWithoutInterval && !/\[[0-9]/u.test(text));
      const stated: string[] = framed ? intervalsIn(text) : [];
      if (framed) {
        const invented = stated.filter((interval) => !evidence.recordIntervals.has(interval));
        if (invented.length > 0 && besideHisValue) {
          add({
            kind: 'fabricated_reference_range',
            sentence: segment.text.trim(),
            because: `这句给出了一个「参考范围/正常值」区间「${invented[0]}」，但本轮读到的报告和本平台印出来的行里都没有这个区间——这个数字不是化验室给的。`,
          });
        }
      }
      previousFramedWithoutInterval = framedHere && stated.length === 0;
    }

    // 1. A severity claim landing on one of this patient's own numbers.
    //
    // NO POPULATION ESCAPE. See the block above SEVERITY_WORD.
    const asserted = text.replace(TOPIC_CLAUSE, '');
    if (SEVERITY_WORD.test(asserted) && !claimIsNotAsserted(asserted)) {
      const hit = evidence.numbers.find(
        (number) =>
          carriesNumber(withInherited, number.value) ||
          carriesBandAround(withInherited, number.value),
      );
      if (hit) {
        const provenance =
          hit.origin === 'record'
            ? '他本人档案/报告里的数值'
            : '这轮对话里已经作为他本人数值出现过的数字';
        add({
          kind: 'severity_from_patient_number',
          sentence: segment.text.trim(),
          because: `这句把「${hit.value}」——${provenance}——和病情轻重、进展或发病早晚绑在了一起。说成「在人群里」也不行：他的数字（或者包住他数字的那一档）一旦被点名，这句话就落在他身上了。`,
        });
      } else {
        // ...and the same claim with no digit in it at all, attached to
        // his cell by 你的 instead. See `possessedCellCarryingTheClaim`.
        const cell = possessedCellCarryingTheClaim(asserted, evidence.patientCells);
        if (cell !== null) {
          add({
            kind: 'severity_from_patient_number',
            sentence: segment.text.trim(),
            because: `这句在同一个小句里把「你的${CELL_LABEL_ZH[cell] ?? cell}」和病情轻重、进展或发病早晚绑在了一起。没有写出数字不代表说的不是他——「你的」已经把这句话安在他本人身上了。`,
          });
        }
      }
    }

    // 2. A grade on a cell this platform declines to grade.
    if (!gradingIsNotAsserted(text) && GRADING_WORD.test(text)) {
      for (const cell of evidence.ungradedCells) {
        const byNumber = evidence.numbers.some(
          (number) => number.cell === cell && carriesNumber(text, number.value),
        );
        const byName = possessiveAttachedToCell(text, cell);
        if (!byNumber && !byName) continue;
        add({
          kind: 'ungraded_cell_graded',
          sentence: segment.text.trim(),
          because: `本轮工具消息里「${CELL_LABEL_ZH[cell] ?? cell}」这一格没有带本平台的判读（没有 _clinical），本平台对这一格不下结论；这句话给它划了一条线。`,
        });
      }
    }

    // 3. A mechanism nothing the turn read states.
    //
    // A TABLE ROW IS JUDGED CELL BY CELL rather than skipped. It used to
    // be skipped whole, because a cell restating this platform's own
    // reading in plain Chinese — 「4qA | 这是允许型单倍型——意味着你的
    // D4Z4 收缩是能导致 FSHD 的类型」 — shares no wording with the corpus
    // and was excised for it. That cell was never unsourced: its source
    // is the projection in this turn's own prompt, which
    // `supportShingles` now contains. With the support set honest, the
    // row can be read, and an invented mechanism stops being able to
    // hide in a table.
    if (evidence.corpusChunkCount > 0) {
      const units = row ? rowCells(text) : [text];
      for (const unit of units) {
        if (contentChars(unit).length < 15) continue;
        if (!CAUSAL_MARKER.test(unit)) continue;
        if (/\[[0-9]/u.test(unit)) continue;
        if (
          !/(FSHD|DUX4|SMCHD1)/iu.test(unit) &&
          !CELL_NAMES.some((cell) => cellTermsPresent(unit, cell))
        )
          continue;
        const shingles = shinglesOf(unit);
        const supported = shingles.some((shingle) => evidence.supportShingles.has(shingle));
        if (shingles.length > 0 && !supported) {
          add({
            kind: 'unsourced_mechanism',
            sentence: segment.text.trim(),
            because:
              '这句给出了一个机制解释，但本轮检索到的片段、本平台印出来的判读里都没有写过它，也没有标出处编号。',
          });
        }
      }
    }

    // 4. Telling the patient a value they have is missing, or to go get
    //    it again.
    for (const cell of evidence.withheldCells) {
      const namesCell = cellTermsPresent(text, cell);
      // The pronoun only counts once the cell has been named — the
      // anaphora needs an antecedent, and the document is where it is.
      const refersToCell = namesCell || (cellsNamedAnywhere.has(cell) && CELL_ANAPHORA.test(text));
      if (!refersToCell) continue;
      const saysMissing = absenceIsAboutTheReport(text);
      // A referral is not a recommendation. 「你可以跟主治医生聊一聊，听听
      // 他对你的具体情况是否建议做甲基化检测」 hands the decision to a
      // clinician, which is what this platform asks for everywhere else;
      // the defect is telling the patient to go and buy a result they
      // already have.
      const saysGetIt =
        ACQUIRE_MARKER.test(text) && !CLAIM_DISCLAIMED.test(text) && TEST_MARKER.test(text);
      if (!saysMissing && !saysGetIt) continue;
      add({
        kind: 'retest_of_a_value_on_file',
        sentence: segment.text.trim(),
        because: `「${CELL_LABEL_ZH[cell] ?? cell}」这一格在他的记录里是有结果的，只是当前授权没有把数值发给你——这是授权造成的看不见，不是报告里没有。说「按当前授权我这边看不到」是对的，说「报告里没有」是错的。`,
      });
    }

    // ONE HOP, AND A TABLE DOES NOT SPEND IT. A row is judged as part of
    // what introduced it — the same rule `labelStack` follows two screens
    // up — so the carry set by the lead-in stands for the whole table
    // rather than being consumed by the header row.
    if (!row) previousAboutPatient = aboutThisPatient;
  }

  return violations;
};

/**
 * Is this row/sentence about the patient at all? A fabricated interval
 * in a general encyclopedia table is somebody else's problem; one
 * standing beside this patient's own value is this file's.
 *
 * ---------------------------------------------------------------------
 * AND IT IS ASKED OF THE SEGMENT PLUS THE ONE BEFORE IT, BECAUSE THE
 * NATURAL FORM PUTS THE VALUE AND THE INVENTED RANGE IN DIFFERENT
 * SENTENCES.
 *
 * Driven against the running stack:
 *
 *   「你的 D4Z4 重复数是 3 个。」
 *   「正常参考范围是 11 个以上。」
 *
 * The second sentence is the fabricated laboratory threshold this check
 * exists for — it is standing beside his value and the patient will
 * compare their 3 against it — and asked ON ITS OWN it is about nobody:
 * it names no cell and carries none of his numbers, so this gate refused
 * it and the invented interval published. Splitting a claim over two
 * sentences is not an evasion; it is how the language works, and the
 * same seam is already written up two screens above for the severity
 * check.
 *
 * NO WIDENING OF THE 参考范围 LEXICON WOULD HAVE CLOSED THIS — the
 * lexicon matched perfectly. What was missing is a fact, and the
 * document holds it: WHAT THE SENTENCE BEFORE THIS ONE WAS ABOUT. So the
 * question is asked of the segment and, failing that, of the segment
 * immediately before it.
 *
 * ONE HOP, for the reason the anaphora chain gives: reaching further
 * back lets any sentence in the answer make any other sentence 「about
 * this patient」. A TABLE DOES NOT SPEND THE HOP — a row is judged as
 * part of what introduced it, exactly as `labelStack` already treats it
 * — so a table of ranges under 「你的重复数是 3 个：」 is judged row by
 * row rather than let through by its own header.
 *
 * WHAT IT COSTS, stated: an encyclopedia interval written in the
 * sentence after one about this patient is now cut, where before only
 * the same interval written in the same sentence was. That is the
 * trade this check has always made — see the 参考范围 block — extended
 * to one more position, and a patient reading a 「正常范围」 next to
 * their own value cannot tell the two apart either.
 *
 * WHAT IT STILL MISSES, stated: two hops (「你的重复数是 3。这个我读到
 * 了。正常范围是 11 以上。」) and a range separated from the patient's
 * value by a paragraph. Both fail toward publication.
 */
function rowIsAboutThisPatient(text: string, evidence: GuardEvidence): boolean {
  if (CELL_NAMES.some((cell) => cellTermsPresent(text, cell))) return true;
  return evidence.numbers.some((number) => carriesNumber(text, number.value));
}

// ------------------------------------------------------------------ units

/**
 * A MEASUREMENT WITHOUT ITS UNIT IS A DIFFERENT MEASUREMENT.
 *
 * The projection prints 「甲基化值: 95%」. Driven against the running
 * stack and asked for the number alone, the model answered with the two
 * characters 「95」 and nothing else. A methylation percentage and a bare
 * 95 are not the same reading, and the patient has no way to tell which
 * one they were given.
 *
 * A REPAIR, NOT A VIOLATION, for the same reason `localiseWireTokens` is
 * one: the sentence is true, the patient is entitled to it, and the only
 * thing wrong with it is a missing suffix that THE RECORD ALREADY HOLDS.
 * The unit is never invented here — it is copied off the payload the
 * number came from, and a number the record printed bare stays bare.
 *
 * ONLY 「%」 AND 「kb」. Dropping 个 or 次 from a Chinese sentence changes
 * nothing a reader could misread; dropping the percent sign or the kb
 * changes the quantity. The narrow list is the point.
 *
 * WHERE IT WILL ACT, kept tight because a rewrite in the wrong place is
 * worse than a bare number: the segment names the cell the value belongs
 * to, or the segment is nothing but the number.
 */
const RESTORABLE_UNITS: ReadonlySet<string> = new Set(['%', 'kb']);
/** A digit followed by one of these is already carrying a unit of its
 *  own, whatever the record says. 「95 名患者」 is not this patient's
 *  methylation value. */
const FOREIGN_UNIT = /^[\s*`]*(?:名|人|例|个|条|项|次|年|月|日|岁|篇|种|类|位|份)/u;

export const restoreUnits = (
  answer: string,
  evidence: GuardEvidence,
): { text: string; restored: string[] } => {
  const restorable = evidence.numbers.filter(
    (number) => number.unit !== null && RESTORABLE_UNITS.has(number.unit),
  );
  if (restorable.length === 0) return { text: answer, restored: [] };

  const restored: string[] = [];
  let out = answer;
  for (const segment of segmentsOf(answer)) {
    if (segment.match.includes(REDACTION_MARK_OPENING)) continue;
    const bare = contentChars(segment.match);
    let current = segment.text;
    for (const number of restorable) {
      const literal = String(number.value);
      const unit = number.unit as string;
      const namesCell = number.cell !== null && cellTermsPresent(segment.match, number.cell);
      const isJustTheNumber = bare === literal;
      if (!namesCell && !isJustTheNumber) continue;
      const pattern = new RegExp(`(?<![0-9A-Za-z./%])${literal}(?![0-9A-Za-z./])`, 'gu');
      const carriedAlready = new RegExp(`^[\\s*\`]*(?:${escapeForRegex(unit)}|％)`, 'iu');
      let rebuilt = '';
      let cursor = 0;
      let hit = false;
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(current)) !== null) {
        const end = match.index + literal.length;
        const after = current.slice(end);
        if (carriedAlready.test(after) || FOREIGN_UNIT.test(after)) continue;
        rebuilt += current.slice(cursor, end) + unit;
        cursor = end;
        hit = true;
      }
      if (!hit) continue;
      current = rebuilt + current.slice(cursor);
      restored.push(`${literal}${unit}`);
    }
    if (current === segment.text) continue;
    // Re-anchored by search rather than by offset: an earlier segment
    // may already have grown by a character.
    const at = out.indexOf(segment.text);
    if (at < 0) continue;
    out = out.slice(0, at) + current + out.slice(at + segment.text.length);
  }
  return { text: out, restored: [...new Set(restored)] };
};

// ------------------------------------------------------------------ remedy

/**
 * The instruction the regeneration round carries.
 *
 * QUOTED BACK, NOT DESCRIBED. The prompt already describes the rule in
 * `CLINICAL_INFERENCE_BOUNDS` and the model read it and broke it anyway;
 * repeating the description is the move that has already failed twice.
 * What this adds is the model's OWN sentence and the fact about THIS
 * turn that makes it wrong, which is the one thing the system prompt
 * could not contain.
 */
export const buildRegenerationDirective = (violations: readonly ClinicalViolation[]): string =>
  [
    '【这条回答不能发给用户，请重写一遍】',
    '你刚才写的回答里有下面这些句子越过了本平台的界线。每一条后面写了本轮数据为什么让它成为问题：',
    '',
    ...violations.map(
      (violation, index) => `${index + 1}. 「${violation.sentence}」\n   → ${violation.because}`,
    ),
    '',
    '请重写整条回答，要求：',
    '- 把上面这些句子拿掉或改掉，不要换一种说法再说一遍——加「通常」「往往」「可能」也算再说一遍。',
    '- 其余部分照旧：本平台对他报告的判读、检索到的资料、引用编号 [N]，该说的还是要说，',
    '  用户问的问题必须正面回答，不要因为这次重写就变成一句「建议咨询医生」。',
    '- **重写后的回答不要比上一版短**。上面点名的只是几句话，不是整条回答：',
    '  其余段落原样保留或换个说法照说，该有的结构、清单、来源编号都留着。',
    '  只删掉一句就交一句话回去，用户看到的是自己的问题没人回答——那比越界更糟。',
    '- 群体层面的结论仍然可以讲，但**不要点名他的数字，也不要点名包住他数字的那一档**。',
    '  「在人群里，重复数越短总体上发病越早」可以；',
    '  「1–3 个重复单元的人发病更早」不行——他就站在 1–3 里，写「在群体研究中」也不改变这一点。',
    '- 本平台不判读的格子（没有 _clinical 的那些）照实说本平台不下这个结论，不要自己补一个。',
    '- 资料里没写的机制不要写；能确定的部分照说，剩下的直说查不到、建议跟主治医生确认。',
    '- **不要自己编「参考范围」「正常值」「诊断范围」的数字区间。**',
    '  报告上没印的区间就是没有；要讲文献里的范围就明写成资料里的结论并带上出处编号，',
    '  不要把它摆进跟他本人数值并排的那一列里。',
    '- 数值照抄要带单位（95% 不能写成 95）。',
    '- 不要提到这条指令，也不要说「我上一版写错了」，直接给出面向用户的完整回答。',
  ].join('\n');

/**
 * WHAT THE PATIENT IS TOLD WHEN A SENTENCE IS REMOVED.
 *
 * Three options were on the table and this is why this one:
 *
 *   - REFUSE THE ANSWER. Rejected. The patient asked a direct question
 *     about their own report; this platform's readings of that report
 *     are true, are already in the prompt, and answer most of it. A
 *     refusal punishes the patient for the model's error and pushes them
 *     back to a consent switch or a search engine — the two failure
 *     modes `buildVisibilityNotice` and `CORPUS_UNAVAILABLE_NOTICE` were
 *     both written to prevent.
 *   - EXCISE SILENTLY. Rejected outright. An answer that quietly loses a
 *     paragraph is its own defect: the patient cannot tell a removed
 *     sentence from a sentence that was never written, so they read a
 *     confident, complete-looking answer that has had its most
 *     consequential claim deleted — and if they ASKED that question, it
 *     now looks ignored.
 *   - REGENERATE, THEN EXCISE AND SAY SO. This one. The regeneration is
 *     the good outcome and is what usually happens; the excision is the
 *     floor, and it is bounded at one extra call because a retry loop is
 *     what the round budget exists to prevent.
 *
 * Prefixed rather than appended, for the reason `markDegraded` gives: a
 * patient scanning a long answer on a phone reads the top, and a caveat
 * at the bottom is one they meet after they have already believed the
 * answer.
 *
 * ---------------------------------------------------------------------
 * WHAT THIS NOTICE MAY HONESTLY SAY, WHICH IS LESS THAN IT USED TO SAY.
 *
 * The first version read 「这条回答里有 N 处被我删掉了，原因是它们把你
 * 自己的数值读成了病情轻重」 and then stopped. A patient reads that as an
 * assurance: the bad claims were found and taken out, so what is left has
 * been checked. `exciseUntilClean` even runs to a fixed point, which
 * makes the assurance look earned.
 *
 * IT IS NOT EARNED, AND THE FIXED POINT IS EXACTLY WHY. The loop
 * converges over WHAT THE DETECTOR CAN SEE. The detector is a fact ANDed
 * with a REGISTER LIST (see `SEVERITY_WORD`), and a register list is
 * never complete — so a claim stated twice, once in a register the list
 * holds and once in a register it does not, loses the first copy and
 * keeps the second, and the surviving copy is now sitting directly under
 * a banner saying claims like it were removed. Driven against the running
 * stack that is one turn away: the model wrote the severity claim as
 * 「病情更重」 in a table row and again as 「发病较早、总体偏重」 in the
 * paragraph below it, and before the register fix the second one
 * published under the notice.
 *
 * The register fix narrows that gap; it cannot close it, and a notice
 * whose truth depends on a lexicon being complete is a notice that will
 * eventually lie. So this one says what the guard ACTUALLY DID — these
 * N sentences were removed — and then says the part the patient needs in
 * order to read the rest correctly: THE CHECK IS NOT COMPLETE, so what
 * is left is not certified. A patient who knows the filter is partial
 * reads the remaining text the way they should; a patient who believes
 * it is total does not.
 *
 * It costs a sentence of confidence in this platform. That is the right
 * price: the alternative is a patient trusting a prediction about their
 * own disease because a banner implied it had been checked.
 */
export const buildExcisionNotice = (violations: readonly ClinicalViolation[]): string => {
  const kinds = new Set(violations.map((violation) => violation.kind));
  const reasons: string[] = [];
  if (kinds.has('severity_from_patient_number'))
    reasons.push('把你自己的数值读成了病情轻重、进展快慢或发病早晚');
  if (kinds.has('ungraded_cell_graded')) reasons.push('给一项本平台不下结论的指标划了高低');
  if (kinds.has('unsourced_mechanism')) reasons.push('给出了检索资料里没有写过的机制解释');
  if (kinds.has('retest_of_a_value_on_file'))
    reasons.push('把「授权没发给我」说成了「你的报告里没有」');
  if (kinds.has('fabricated_reference_range'))
    reasons.push('写了一个你报告上并没有印的「参考范围」数字区间');
  // The second paragraph says WHY the platform has the rule, and it has
  // to be true of the violations that actually fired: a turn whose only
  // problem was 「报告里没有」 was being told the platform does not
  // predict from numbers, which is a correct sentence about a rule that
  // had nothing to do with what was removed.
  const rule =
    kinds.has('severity_from_patient_number') || kinds.has('ungraded_cell_graded')
      ? '本平台不会拿某一个人的数字去预测他的病情，也不会替自己不判读的格子下结论——'
      : kinds.has('retest_of_a_value_on_file')
        ? '你那一项是有结果的，只是按你当前的授权没有发到我这边来——'
        : kinds.has('fabricated_reference_range')
          ? '你报告上没有印过的参考区间，我不能摆在你的数值旁边让你去对——'
          : '没有资料出处的机制解释，我不能当成你报告的解释讲给你——';
  // The limit of what was done, said in the notice itself. See the block
  // above: the excision runs to a fixed point over WHAT THIS CHECK CAN
  // RECOGNISE, and what it recognises is a word list that will never be
  // complete. Naming N removals without naming that would read as 「the
  // rest has been checked」, which is the one thing this notice must not
  // imply.
  const incomplete =
    '要说清楚的是：我删掉的只是我认出来的那几句。同一个意思换个说法写，我不一定认得出来，' +
    '所以下面留下来的内容不等于「已经逐句核对过」。如果你读到哪一句像是在拿你的数值判断你本人的' +
    '病情轻重、发展快慢或者发病早晚，那句话也不作数，以你主治医生的判断为准。';
  return (
    `⚠️ 这条回答里有 ${violations.length} 处被我删掉了，原因是它们${reasons.join('；')}。\n\n` +
    rule +
    '这是平台的规矩，不是你的问题不该问。上面留下来的是本平台对你报告的判读和检索到的资料，' +
    '被删掉的那部分，最好带着报告直接问你的主治医生。\n\n' +
    incomplete
  );
};

/**
 * Everything survived being cut. Rather than hand back a blank bubble,
 * say what happened and point at the answer that IS available — this
 * platform's own reading of the report, which is in the prompt and is
 * what the patient asked about.
 */
export const EMPTY_AFTER_EXCISION_FALLBACK =
  '这次我写出来的回答整段都越过了本平台的界线（拿你的数值去推病情轻重、或者给不判读的指标下了结论），' +
  '所以我没有把它发给你。\n\n' +
  '能告诉你的是本平台对你报告的判读本身——比如「我的重复数在不在 FSHD1 的范围里」' +
  '「我的单倍型是不是允许型」这类问题，直接问我就行，我照着报告回答。' +
  '至于病情会怎么走、这些数字对你个人意味着什么，本平台不做这个判断，建议带着报告问你的主治医生。';

/**
 * IS THE REGENERATED ANSWER STILL AN ANSWER?
 *
 * Driven against the running stack, this is the failure the regeneration
 * introduces and it is worse than the violation it fixes. Told that
 * three of its sentences were out of bounds, the model deleted the whole
 * reply and returned 「你还有什么想了解的吗？」 — clean, compliant, and a
 * patient who asked about their own genetics report reading a
 * conversational filler. The directive now says not to; a directive is
 * not a control, which is the premise of this entire file.
 *
 * So the regeneration is ACCEPTED ONLY IF IT IS STILL SUBSTANTIVE, and
 * otherwise the run falls back to excising the FIRST answer — which
 * keeps this platform's readings, the retrieved material and the
 * citations the patient can open, loses exactly the offending sentences,
 * and says so. A stunted-but-clean reply and an excised-but-complete one
 * are both honest; only the second one answers the question.
 *
 * The threshold is a fraction of what excision alone would have left,
 * not of the original: comparing against the original would reject a
 * regeneration of an answer that was mostly violation, which is the case
 * where regenerating helps most.
 */
const SUBSTANTIVE_FRACTION = 0.5;

export const isSubstantiveRewrite = (rewrite: string, excisedOriginal: string): boolean =>
  rewrite.trim().length >= Math.floor(excisedOriginal.trim().length * SUBSTANTIVE_FRACTION);

/**
 * The short reason that stands where the sentence stood.
 *
 * ONE LINE, IN THE PLACE THE SENTENCE OCCUPIED, and this is the whole
 * point of marking rather than deleting. Deletion was tried first and
 * produced rubble: excising 「是的，你的报告里确实没有甲基化的结果——…」
 * and the sentence that introduced the list below it left a live answer
 * opening on four orphaned bullets and a closing recommendation, with no
 * lead-in and no subject. The patient could not tell that from a broken
 * renderer, and could not tell WHICH part had been judged. A marker in
 * place says both, keeps the document's structure intact, and cannot be
 * mistaken for the answer's own words.
 */
const REDACTION_MARK_ZH: Readonly<Record<ClinicalViolationKind, string>> = {
  severity_from_patient_number: `${REDACTION_MARK_OPENING}它拿你自己的数值去推病情轻重或进展快慢，本平台不做这个判断。）`,
  ungraded_cell_graded: `${REDACTION_MARK_OPENING}它给一项本平台不下结论的指标划了高低。）`,
  unsourced_mechanism: `${REDACTION_MARK_OPENING}它给的机制解释在这次检索到的资料里查不到出处。）`,
  retest_of_a_value_on_file: `${REDACTION_MARK_OPENING}它把「按当前授权没发给我」说成了「你的报告里没有」。）`,
  fabricated_reference_range: `${REDACTION_MARK_OPENING}它写了一个你报告上并没有印过的参考区间。）`,
};

/**
 * Replace the violating segments with the reason they went.
 *
 * A TABLE ROW IS REMOVED rather than marked: a row replaced by prose is
 * a broken table, and a table missing one row still renders. Everything
 * else is marked in place, so the paragraph it sat in keeps its shape.
 */
export const redactViolations = (
  answer: string,
  violations: readonly ClinicalViolation[],
): string => {
  const markFor = new Map<string, string>();
  for (const violation of violations) {
    if (!markFor.has(violation.sentence)) {
      markFor.set(violation.sentence, REDACTION_MARK_ZH[violation.kind]);
    }
  }
  const doomed = segmentsOf(answer).filter((segment) => markFor.has(segment.text.trim()));
  if (doomed.length === 0) return answer;
  let out = answer;
  // Right to left so earlier offsets stay valid.
  for (const segment of [...doomed].sort((a, b) => b.start - a.start)) {
    const replacement = isTableRow(segment) ? '' : (markFor.get(segment.text.trim()) ?? '');
    out = out.slice(0, segment.start) + replacement + out.slice(segment.end);
  }
  // A sentence removed from the MIDDLE of a line takes its half of the
  // surrounding markdown with it. Observed: excising
  // 「**报告中没有甲基化的结果。」 left a line opening 「** 」, which the
  // client renders as a stray asterisk pair. Nothing here rewrites
  // words — it only drops markup that no longer has a partner, and
  // lines that are now nothing but markup.
  const ORPHAN_BOLD = /\*\*/gu;
  const lines = out
    .split('\n')
    .map((line) => {
      const bolds = line.match(ORPHAN_BOLD)?.length ?? 0;
      return bolds % 2 === 1 ? line.replace('**', '') : line;
    })
    .filter((line) => !/^[\s*_~`>|:-]+$/u.test(line) || line.trim() === '' || /\|/u.test(line));

  // A REMOVED ROW LEAVES ITS NEWLINE BEHIND, AND A BLANK LINE ENDS A
  // MARKDOWN TABLE.
  //
  // Removing the row rather than marking it is what keeps the table
  // renderable — but the line's own newline is not part of the span,
  // so what was left was an empty line between the separator and the
  // rows below it. Driven against the running stack, an excised
  // 「| 1–3 个 | … |」 left exactly that, and the client rendered the
  // header, then a paragraph, then the remaining rows as literal pipes.
  // The blank line only goes when it is INSIDE a table; a blank line
  // after the last row is ordinary markdown and stays.
  const isRow = (line: string | undefined): boolean => (line ?? '').trim().startsWith('|');
  const withoutHoles = lines.filter(
    (line, index) => !(line.trim() === '' && isRow(lines[index - 1]) && isRow(lines[index + 1])),
  );

  return withoutHoles
    .filter((line, index, all) => !(line.trim() === '' && all[index - 1]?.trim() === ''))
    .join('\n')
    .trim();
};

/**
 * EXCISION IS NOT A ONE-PASS OPERATION, AND THE NOTICE ON TOP OF IT IS A
 * PROMISE.
 *
 * The first version excised once and published. The notice it prefixed
 * says 「这条回答里有 N 处被我删掉了」 and names the reason; what stood
 * under it had never been looked at again. Driven against the stack that
 * gap was reachable in one turn: the model made the same severity claim
 * twice, once plainly and once inside a cohort-framed sentence, the
 * first was cut, the second was not, and the patient read an assurance
 * that the offending claim had been removed sitting directly above the
 * offending claim.
 *
 * So the excision runs to a FIXED POINT, and the violations the notice
 * counts are everything that had to go across all of the passes rather
 * than only the first. Bounded, because a rewrite loop is what the round
 * budget exists to prevent — and the bound FAILS TO SILENCE rather than
 * to publication: if the text still violates after the last pass, or if
 * a pass cannot remove what it found (a segment the redactor could not
 * match), nothing is returned and the caller publishes
 * `EMPTY_AFTER_EXCISION_FALLBACK`. An empty answer with an honest notice
 * is recoverable; a false assurance is not.
 */
const MAX_EXCISION_PASSES = 3;

export const exciseUntilClean = (
  answer: string,
  violations: readonly ClinicalViolation[],
  evidence: GuardEvidence,
): { text: string; violations: ClinicalViolation[] } => {
  const all: ClinicalViolation[] = [...violations];
  const know = new Set(all.map((violation) => `${violation.kind}:${violation.sentence}`));
  let text = redactViolations(answer, violations);

  for (let pass = 0; pass < MAX_EXCISION_PASSES; pass += 1) {
    const remaining = inspectAnswer(text, evidence);
    if (remaining.length === 0) return { text, violations: all };
    for (const violation of remaining) {
      const key = `${violation.kind}:${violation.sentence}`;
      if (know.has(key)) continue;
      know.add(key);
      all.push(violation);
    }
    const next = redactViolations(text, remaining);
    // Nothing moved: the redactor cannot reach what the inspector can
    // see. Publishing it would be publishing the claim under a notice
    // saying it was removed.
    if (next === text) return { text: '', violations: all };
    text = next;
  }

  if (inspectAnswer(text, evidence).length > 0) return { text: '', violations: all };
  return { text, violations: all };
};

/** What the guard did, carried onto the run result for the audit row. */
export interface ClinicalGuardState {
  violations: ClinicalViolation[];
  /** `localised` — nothing was wrong with the claims; a wire token was
   *  rewritten into Chinese, or a unit was put back, on the way out.
   *  `regenerated` — the check fired and the second answer was clean.
   *  `excised` — it was not, and the sentences were marked and reported
   *  to the patient. */
  action: 'localised' | 'regenerated' | 'excised';
  /** Wire tokens rewritten into Chinese on the way out. */
  localisedTokens: string[];
  /** Values that reached the answer without the unit the record holds
   *  for them, and were given it back. See `restoreUnits`. */
  restoredUnits: string[];
}
