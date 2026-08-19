/**
 * Three-layer PII redactor for patient-scoped retriever output.
 *
 * Operates on structured field maps (the `fields` retrievers expose in
 * their chunk metadata). Renders happen downstream in the
 * Context Builder, so the redactor never has to grep prose.
 *
 *   Layer 1 — hard delete: every key in `HARD_DELETE_KEYS` is removed
 *             unconditionally, in both strict and precise mode, AT ANY
 *             DEPTH AND INSIDE ARRAYS AS WELL AS OBJECTS. These are
 *             pure identifiers with no clinical value. See `hardDelete`
 *             for the array half, which is the one that was missing.
 *
 *   Layer 2 — clinicalise: THIS PLATFORM'S OWN READING OF A CELL, and
 *             it runs in BOTH modes. A genetics cell gains a
 *             `_clinical` sibling holding what this platform makes of
 *             it — a band on the one repeat-count boundary this repo
 *             states, or a refusal to read the cell as a result at
 *             all. A dated field gains its year. Strict mode then
 *             drops the raw original, because the raw value is the
 *             thing the patient did not consent to share; precise mode
 *             keeps it beside the reading.
 *
 *             IT USED TO RUN ONLY IN STRICT, and the refusals were
 *             therefore exactly what the patients who consented to
 *             share the most never got: a length in kb, a repeat count
 *             of 0, a negated haplotype, a cell naming both probes and
 *             a value never read off a laboratory report all reached
 *             the prompt as bare cells, for the readers whose answers
 *             are built from the most detail. Consent decides how much
 *             of a cell reaches the prompt. It does not decide whether
 *             this platform is willing to interpret it — the refusal
 *             is not a redaction, it is this platform declining to
 *             read a cell, and that is true whatever the patient
 *             shared. The derived years are on the same footing:
 *             `diagnosisYear` and `reportDate_year` are the only form
 *             of those cells either allowlist carries, so deriving
 *             them in strict alone left a precise-consent patient with
 *             no date at all.
 *
 *             The methylation cell is the one whose VALUE this
 *             function never reads, and for the opposite reason: there
 *             is no boundary stated anywhere in this repo to read it
 *             against, so it earns no `_clinical` sibling in either
 *             mode. What it does carry, in both, is where the cell came
 *             from — it was the one genetics cell stating nothing at
 *             all, so a percentage typed into the registration form or
 *             quoted on a 病历摘要 sat beside siblings that DO state
 *             the refusal, looking like a result this platform stood
 *             behind. See `methylationCell`.
 *
 *             WHAT A LABEL MAY CLAIM. It is answered to a patient by
 *             the assistant, so it may say only what this repo says
 *             elsewhere: the genetics cells are read with the
 *             passport's own readers and banded on the one repeat-count
 *             boundary this platform states. See `clinicaliseD4Z4`.
 *
 *   Layer 3 — allowlist: only keys enumerated in
 *             `PROMPT_ALLOWLIST[scope][mode]` survive. Anything else
 *             (including any field added to a retriever but not yet
 *             reviewed) is dropped with a logger warning so the
 *             oversight is visible.
 *
 * ACROSS ALL THREE, ONE INVARIANT: NO VALUE THIS MODULE READS OR
 * PUBLISHES SKIPS EXAMINATION BY VIRTUE OF ITS TYPE.
 *
 * Both walks over a cell used to stop at the first thing that was not a
 * string or a plain object. Layer 1 said so in as many words — 「arrays
 * and primitives are left as-is — they cannot have keys to match」 — and
 * `isUntrustworthyValue` opened with `typeof value !== 'string' → false`.
 * An array can hold an object, and an object can hold a hard-delete key,
 * so `fields.d4z4Repeats = [{ patientName, idCard }]` walked past layer 1
 * whole, was declared trustworthy without being looked at, was published
 * raw by `publishGeneticCell` under precise consent, and left
 * `formatScalar` as JSON: a name and an ID card number in an LLM prompt,
 * under a key on the precise allowlist, on both scopes and through both
 * callers. The claim it broke is layer 1's own, quoted above it: 「hard-
 * delete keys never reach a prompt regardless of mode」.
 *
 * The invariant is enforced in exactly two total functions rather than
 * per branch — `hardDelete` for layer 1 and `isUntrustworthyValue` for
 * the examination — and each of them says, type by type, what it makes
 * of an array, an object, a number, a boolean, null, undefined and a
 * nested mixture, including what it does when the walk cannot finish.
 * The one place the examination is NOT asked is named on
 * `isUntrustworthyValue`, so this paragraph does not have to be taken on
 * trust.
 */

import type { RedactionMode, RedactionScope } from './allowlist.js';
import {
  HARD_DELETE_KEYS_LOWER,
  OCR_FIELDS_SAFE_KEYS_PRECISE,
  PROMPT_ALLOWLIST,
  REPORT_IMPRESSION_CHANNEL_ENABLED,
  REPORT_IMPRESSION_KEYS,
  SAFE_VALUE_MAX_LENGTH,
} from './allowlist.js';
import { scrubPiiText } from './text-scrub.js';
import type { AppLogger } from '../../../config/logger.js';
import type { GeneticEvidenceDocumentLike } from '../../patient-profile/genetic-evidence.js';
import {
  GENETIC_FIELD_KEYS,
  documentClassifiedType,
  isLaboratoryGeneticReport,
  showsClinicalNarrative,
} from '../../patient-profile/genetic-evidence.js';
import {
  FSHD1_MAX_REPEAT_UNITS,
  isD4Z4GreyZone,
  isDeterminateRepeatCount,
  parsePermissiveHaplotype,
  readSizeCell,
} from '../../patient-profile/profile.passport.js';

export type { RedactionMode, RedactionScope } from './allowlist.js';

export interface RedactOptions {
  scope: RedactionScope;
  mode: RedactionMode;
  logger?: AppLogger;
}

export interface RedactionStats {
  hardDeleted: string[];
  clinicalised: string[];
  notAllowed: string[];
  /** Layer 4. Paths whose string value had an identifier taken out of
   *  it, and — suffixed `(withheld)` — the ones the scrub could not
   *  make safe and dropped whole. Named rather than counted, because a
   *  key disappearing between the allowlist and the prompt is exactly
   *  the thing an audit row has to be able to explain. */
  identifiersScrubbed: string[];
  /** Layer 4 again, and the other two gates. Paths whose value was
   *  recognised as FREE TEXT rather than a cell and therefore had gate 0
   *  and gate 2 applied to it — suffixed with the reason where the gate
   *  refused. Named for the same reason `identifiersScrubbed` is: a
   *  measurement disappearing out of a sentence, or a whole prose cell
   *  disappearing because the document turned out to be a narrative, is
   *  a thing an audit row has to be able to explain. */
  freeTextGated: string[];
}

export interface RedactionOutcome {
  fields: Record<string, unknown>;
  stats: RedactionStats;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- layer 1

/**
 * HOW FAR EITHER TOTAL WALK IN THIS FILE GOES BEFORE IT REFUSES THE REST.
 *
 * Layer 1's strip and the examination below are both recursive walks
 * over a value this module did not build, and such a walk has two ways
 * not to finish: a cycle, and a depth nobody bounded. Neither may end in
 * a value reaching a prompt unexamined, so both answer 「refuse」 rather
 * than 「pass」 at this line — layer 1 drops the subtree and records the
 * drop in `stats.hardDeleted`, the examination calls the cell
 * untrustworthy. A bound that fails open is the same defect as no bound.
 *
 * An OCR blob is two levels deep (`fields.fields.<cell>`) and a baseline
 * payload three, so this is headroom rather than a limit anything real
 * meets.
 */
const MAX_NESTING_DEPTH = 12;

/** Strip every key in HARD_DELETE_KEYS at any depth, INSIDE ARRAYS AS
 *  WELL AS OBJECTS.
 *
 *  The first implementation inspected top-level keys only, which meant
 *  nested OCR payloads (e.g. `metadata.fields.fields.patientName` from
 *  the patient_reports retriever) slipped through whenever the enclosing
 *  key itself was on the allowlist. Recursion into plain objects closed
 *  that half and stated the other half as a reason: 「Only plain objects
 *  are descended into; arrays and primitives are left as-is — they
 *  cannot have keys to match」.
 *
 *  AN ARRAY CANNOT HOLD A KEY AND AN OBJECT INSIDE ONE CAN, and that is
 *  the shape the extractor writes whenever a page prints more than one
 *  of something. So `fields.d4z4Repeats = [{ patientName: '张三', idCard:
 *  '…' }]` passed layer 1 untouched, was handed to `publishGeneticCell`,
 *  and — the examination below having short-circuited on
 *  `typeof value !== 'string'` — was published raw under precise consent
 *  and JSON-stringified into the prompt by `formatScalar`. The contract
 *  this function is here to keep, 「hard-delete keys never reach a prompt
 *  regardless of mode」, was false for every genetics cell and every safe
 *  key on both scopes.
 *
 *  THE WALK IS THEREFORE TOTAL, and here is every type it can meet:
 *
 *    - an object — descended key by key; a hard-delete key is removed
 *      and recorded, everything else is descended into in turn. 「Object」
 *      here means own enumerable entries, which is what a `Date` or a
 *      `Map` has none of: those walk as empty and come out as `{}`,
 *      exactly as they did before arrays were added to this walk.
 *    - an array — descended element by element, under the element's
 *      index, so a removal inside one is recorded as `cell.0.patientName`
 *      rather than silently.
 *    - a string, a number, a boolean, null, undefined, a symbol, a
 *      function — leaves. They carry no keys, so there is nothing here
 *      to remove; whether their CONTENT may be published is the
 *      examination's question, not this one's.
 *    - a nested mixture — objects in arrays in objects, to
 *      `MAX_NESTING_DEPTH`.
 *    - a cycle, or nesting past that depth — the subtree is DROPPED and
 *      recorded, never passed through. See `MAX_NESTING_DEPTH`.
 */
const hardDeleteValue = (
  value: unknown,
  path: string[],
  removed: string[],
  depth: number,
  ancestors: Set<object>,
): { keep: boolean; value: unknown } => {
  if (!isPlainObject(value) && !Array.isArray(value)) return { keep: true, value };
  if (depth >= MAX_NESTING_DEPTH || ancestors.has(value)) {
    removed.push(path.join('.'));
    return { keep: false, value: undefined };
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const cleaned: unknown[] = [];
      value.forEach((item, index) => {
        const inner = hardDeleteValue(
          item,
          [...path, String(index)],
          removed,
          depth + 1,
          ancestors,
        );
        if (inner.keep) cleaned.push(inner.value);
      });
      return { keep: true, value: cleaned };
    }
    const cleaned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (HARD_DELETE_KEYS_LOWER.has(key.toLowerCase())) {
        removed.push([...path, key].join('.'));
        continue;
      }
      const inner = hardDeleteValue(item, [...path, key], removed, depth + 1, ancestors);
      if (inner.keep) cleaned[key] = inner.value;
    }
    return { keep: true, value: cleaned };
  } finally {
    ancestors.delete(value);
  }
};

const hardDelete = (
  input: Record<string, unknown>,
): {
  cleaned: Record<string, unknown>;
  removed: string[];
} => {
  const removed: string[] = [];
  const walked = hardDeleteValue(input, [], removed, 0, new Set<object>());
  return {
    cleaned: walked.keep ? (walked.value as Record<string, unknown>) : {},
    removed,
  };
};

// ---------------------------------------------------------------- layer 2

/**
 * Is this value a qualitative result rather than a measurement?
 *
 * Qualitative results survive strict mode — see `projectOcrFields` for
 * the OCR blob and `methylationCell` for the genetics cell. The
 * test is deliberately conservative: anything carrying a digit is
 * treated as a measurement, so「1.02」stays withheld and so does a
 * borderline string like「阳性(1:8)」whose titre is the number the
 * patient did not consent to share.
 */
const isQualitativeResult = (value: unknown): boolean => {
  if (typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || text.length > 24) return false;
  return !/\d/.test(text);
};

/**
 * IS THIS CELL A CLASSIFICATION RATHER THAN A MEASUREMENT?
 *
 * `isQualitativeResult` refuses anything carrying a digit, and it is
 * right to — 「阳性(1:8)」 hides the titre the patient withheld. But a
 * classification key is named for what it holds, and this disease's
 * subtypes are spelled with a numeral on the end. So strict mode
 * dropped 「diagnosisType: FSHD1」 off the OCR blob AND counted it into
 * `numericValuesWithheld`, which told the model a measurement it could
 * not see existed on a report where none did — while the profile scope
 * printed that same value one section above, on the stated ground that
 *「category label like "FSHD1" is non-PII」. One value, two answers,
 * and the wrong one also miscounted what it withheld.
 *
 * ON THE KEY'S NAME, so the class is closed rather than enumerated:
 * `classifiedType`, `reportType`, `documentType`, `diagnosisType`,
 * `geneType`, `geneticType` and every snake spelling of them end in
 *「type」, and so will the next one. (`haplotype` ends in it too and is
 * dispatched to its own reader long before this branch.)
 *
 * AND ON THE VALUE BEING A SINGLE TOKEN, because a classification cell
 * is where an extractor puts its overflow: 「FSHD1(D4Z4 3拷贝)」 is a
 * subtype with a repeat count stapled to it, and that count is exactly
 * what the precise consent buys. Any separator — a space, a bracket, a
 * colon, a slash, a decimal point, a percent, a hyphen — sends the
 * value back to the measurement test, as does a value with no letter
 * in it at all, which is a number however the key is named.
 */
const CATEGORY_LABEL_KEY = /type$/i;
const SINGLE_CATEGORY_TOKEN = /^(?=.*\p{L})[\p{L}\p{N}_]{1,24}$/u;

const isCategoryLabel = (key: string, value: unknown): boolean =>
  CATEGORY_LABEL_KEY.test(key) &&
  typeof value === 'string' &&
  SINGLE_CATEGORY_TOKEN.test(value.trim());

/**
 * THE CELL THAT NAMES THE DIAGNOSIS, IN EVERY SPELLING — and the one
 * genetics cell on this projection that had no branch of its own.
 *
 * `projectOcrFields` dispatches the genetics cells on the substrings
 * 「d4z4」/「ecori」/「methylation」/「haplotype」. `diagnosisType` matches
 * none of them, so it fell through to the `OCR_FIELDS_SAFE_KEYS_PRECISE`
 * branch, which asks only whether a key is safe to NAME — a PII
 * question — and published 「FSHD1」 verbatim in precise mode and again
 * in strict via `isCategoryLabel`, on the stated ground that a category
 * label is non-PII. That ground is sound and it is not the question the
 * siblings answer: `fromLaboratoryReport` was computed and passed into
 * this projection, and every other genetics cell on the same 病历摘要
 * rendered `not_read_off_a_laboratory_report` beside itself. Stating
 * the refusal beside everything EXCEPT the diagnosis is not neutral —
 * it implies the diagnosis is the one this platform did read off a
 * laboratory report. On a 出院小结 that row is the only genetics content
 * on the page.
 *
 * DISPATCHED OFF THE PASSPORT'S OWN KEY TABLE, NOT OFF A SUBSTRING.
 * Every other reader here matches a substring, and that is right for
 * them: 「d4z4」 and 「ecori」 name an assay, so a key containing one is
 * that cell whatever else is spelled around it. The substring this
 * class shares is 「gene」, and matching it would sweep in
 * `geneticPositive` — the verdict `_extract_genetic` used to compute,
 * deliberately absent from every allowlist and currently dropped by
 * deny-by-default — and publish it with a sibling reading beside it.
 * `GENETIC_FIELD_KEYS.geneticType` is the closed list this platform
 * already keeps of the spellings that ARE this cell, legacy paths
 * included, and reading it here is what keeps the assistant and the
 * passport naming the same cells.
 *
 * PLUS EACH SPELLING'S SNAKE FORM, because the bridge in
 * services/ocr/embedded-report-ocr.ts writes every structured field
 * under BOTH its camelCase and its snake_case name, and the passport's
 * table happens to carry `geneType` without `gene_type`. That table is
 * a preference ORDER for reading one value — a missing alias costs it
 * nothing, because the camel spelling is right beside it on the same
 * blob. Here a missing alias costs a cell its origin, so the two
 * spellings are derived rather than enumerated.
 */
const toSnake = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

const GENETIC_TYPE_KEYS_LOWER: ReadonlySet<string> = new Set(
  GENETIC_FIELD_KEYS.geneticType.flatMap((key) => [key.toLowerCase(), toSnake(key)]),
);

/**
 * WHAT THE ASSISTANT MAY SAY ABOUT A GENETICS CELL THIS PLATFORM DID
 * NOT READ OFF THE LABORATORY'S OWN REPORT.
 *
 * ASKED IN BOTH MODES, like every other reading below it. What the
 * precise consent buys is the cell itself, printed beside this
 * sentence; it does not buy the cell a promotion to a reading this
 * platform never made of it.
 *
 * The passport's rule, in the one form this file can state it: a value
 * read off a 病历摘要 quoting a result, or typed into the registration
 * form, is DISPLAYED with its origin beside it and earns no grade of
 * any kind — see `isLaboratoryGeneticReport`, which is the question,
 * and `GeneticEvidenceGrade.transcribed_only`, which is what such a
 * document gets instead of a reading of its content.
 *
 * One label for both cells and both origins, because it is one fact.
 * It says what this platform did rather than where the number came
 * from: an OCR autofill can copy a report's value into an empty
 * baseline field and leave no record of having done it, so 「this is not
 * from a report」 is a claim the passport explicitly refuses to make
 * about an archived value.
 */
const NOT_A_LABORATORY_READING = 'not_read_off_a_laboratory_report';

/**
 * WHAT THIS PLATFORM SAYS ABOUT A LENGTH IN KB, wherever a genetics
 * cell turns out to be holding one.
 *
 * A constant for the same reason `NOT_A_LABORATORY_READING` is one: two
 * cells reach it — the repeat-count cell when the report gave that cell
 * in kb, and the EcoRI fragment, which is a kb measurement by
 * definition — and it is one fact about both. The passport says it in
 * Chinese to a reader (`KB_LENGTH_NOT_JUDGED_ZH`: 指南给出的界限是按重复
 * 单元数写的，本平台不在 kb 和重复单元数之间做换算); this is the same
 * refusal in the vocabulary the labels here are written in.
 */
const LENGTH_IN_KB_NOT_A_REPEAT_COUNT = 'length_in_kb_not_a_repeat_count';

/**
 * IS THIS CELL A READING AT ALL — the passport's `pickReading` rule,
 * asked before any reader below is handed the cell.
 *
 * Every reader here used to open with `String(raw)`, and `String` has
 * an answer for everything. A haplotype cell holding
 * `['4qA', '4qB']` — which is what the extractor writes when the report
 * lists the laboratory's probes — stringified to 「4qA,4qB」, and a
 * `d4z4Repeats` cell holding `['3']` stringified to 「3」 and was banded
 * as a repeat count of 3. `pickReading` refuses both: 「A payload field
 * holding an array or an object is NOT a reading … There is no sensible
 * coercion, so there is none.」 This is that refusal, in the shape the
 * readers below need it.
 *
 * `not_a_reading` and `empty` are deliberately different answers.
 * Nothing is published for an empty cell, because there is nothing on
 * the report to say anything about. A cell that holds something this
 * platform cannot read as a value is a cell that EXISTS, and the model
 * has to be told the platform declined to read it — otherwise strict
 * mode drops the raw cell, no reading is written, and the assistant
 * reports a genetics report as having no haplotype at all.
 */
type GeneticCellText =
  | { kind: 'text'; text: string }
  | { kind: 'empty' }
  | { kind: 'not_a_reading' };

const readGeneticCell = (raw: unknown): GeneticCellText => {
  if (raw === null || raw === undefined) return { kind: 'empty' };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? { kind: 'text', text: trimmed } : { kind: 'empty' };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return { kind: 'text', text: String(raw) };
  return { kind: 'not_a_reading' };
};

/**
 * THE D4Z4 CELL, READ BY THE READER THE REST OF THE PLATFORM READS IT
 * WITH, and banded only when it is a repeat count.
 *
 * IT USED TO PARSE THE CELL ITSELF — the first digits in the string,
 * mapped onto a severity ladder, with no unit check and no zero check.
 * Every reading the passport, the app and the exports were moved off
 * came through here intact and was answered to the patient by the
 * assistant: 「3kb」 as the most severe contraction there is, when a
 * length in kb is printed and judged by nothing everywhere else on this
 * platform; 「0」 the same way, when 0 units is not an FSHD1 allele at
 * all; and 「未检出3个重复单元」 as a count of 3, because a negation
 * carries a number of its own. `readSizeCell` is what the cell says and
 * `isDeterminateRepeatCount` is whether that is a count — the same two
 * questions the passport asks, asked here rather than answered again by
 * a regular expression of this file's own.
 *
 * THE BANDS NAME A RANGE, NOT A PROGNOSIS. The ladder they replace ran
 * low_repeat_severe / _moderate / _mild / borderline / normal_range on
 * edges written nowhere else in this repo, and its top edge called a
 * count of 30 borderline while `countAboveFshd1Range` has the guideline
 * sending anything past `FSHD1_MAX_REPEAT_UNITS` off to evaluate FSHD2
 * — two answers to one question, and the wrong one was the one a
 * patient heard. What is left is that boundary and no severity word:
 * the platform's own 孕前 page says the count tracks onset and severity
 * 「在群体层面」 and 「不是对某一个孩子的预测」, and this label is read to
 * exactly one patient.
 *
 * AND ONLY OFF THE LABORATORY'S OWN REPORT. Every band below is a
 * reading of a cell in a laboratory's voice, and this function was
 * applied to two cells that are not one: the profile scope's `d4z4` is
 * `diseaseBackground.d4z4`, the box on the registration form, and the
 * reports scope hands over whichever document the retriever pulled,
 * which is a 病历摘要 as often as a genetics report. So a count a
 * patient typed and a count a clinic letter quoted were each answered
 * to that patient as 「within_fshd1_repeat_range」, while the passport,
 * the share page, the referral pack and the exports were all printing
 * the same number with 本人填写 or 转录自非基因报告文件 in its bracket
 * and refusing to grade it. See `NOT_A_LABORATORY_READING`.
 */

/**
 * THE 8–10 UNIT GREY ZONE, WHICH THE ASSISTANT WAS THE ONE CONSUMER NOT
 * TOLD ABOUT.
 *
 * `within_fshd1_repeat_range` was the whole of the in-range answer, so a
 * count of 9 reached the model spelled identically to a count of 5 —
 * while the passport, the share page, the referral pack, the PDF and
 * the exports were all printing 灰区 for that same cell in the same run,
 * off `isD4Z4GreyZone`. Of every surface this platform has, the
 * assistant is the one that generates ADVICE rather than showing a
 * value to someone who can ask a follow-up question, and it was the one
 * told the least: Giardina et al. 2024 has an 8 U 4qA array reported as
 * likely pathogenic rather than pathogenic, because 1%–2% of European
 * controls carry one with no signs and no family history.
 *
 * THE PREDICATE IS IMPORTED, NOT RESTATED. The edges live in
 * `isD4Z4GreyZone` and its kb gate lives there too; a second copy of
 * 「8 到 10」 in this file is how the assistant and the passport come to
 * disagree about one number.
 *
 * AND IT IS GATED ON THE HAPLOTYPE THE SAME WAY THE PASSPORT GATES IT
 * — `permissiveHaplotype !== false`, not `=== true`. The figure is
 * stated for 4qA arrays, so over a report naming 4qB the note would be
 * a paragraph about the other allele; a report that named no haplotype
 * keeps it, which is the direction that only ever adds uncertainty.
 */
const WITHIN_FSHD1_REPEAT_RANGE_GREY_ZONE = 'within_fshd1_repeat_range_grey_zone_8_to_10';

/**
 * THE REPORT THIS COUNT CAME OFF STATES 4qB, SO THE COUNT IS NOT READ
 * AGAINST THE FSHD1 RANGE AT ALL.
 *
 * THE HAPLOTYPE USED TO GATE THE GREY-ZONE VARIANT AND NOTHING ELSE.
 * The plain in-range branch returned `within_fshd1_repeat_range`
 * whatever the haplotype said, so a laboratory report stating 4qB —
 * where FSHD1 by definition CANNOT be the mechanism, because FSHD1 is a
 * contracted D4Z4 array ON A PERMISSIVE 4qA ALLELE — handed the model a
 * label asserting the count sits inside the FSHD1 range. Every other
 * surface built off that same report refuses it in so many words: the
 * passport's grade says 「不拿它上面的重复数去套指南里按重复数分组的建议」,
 * the referral 结论 says 「本平台不把这份报告算作已确认的分子遗传学诊断」,
 * and the FHIR Condition text says 「这一条不构成可作确诊依据的基因结果」.
 * `PassportDiagnosisConfirmation.genetic_non_permissive` states the
 * reason: a contraction reported on 4qB 「is not weaker evidence towards
 * the diagnosis; it is a finding that argues against this mechanism」.
 * Commit ca4a261 removed exactly this from the mobile card; the
 * assistant, which is the surface that generates ADVICE, kept it.
 *
 * IT WAS WORSE INSIDE THE GREY ZONE. Gating only the grey-zone variant
 * meant a 4qB report of 9 units DOWNGRADED to the plain in-range label
 * — so the 8–10 uncertainty vanished and the bytes were indistinguishable
 * from a count of 5 on the same allele. The gate belongs on the whole
 * in-range answer, and the answer it produces is a refusal rather than a
 * quieter band.
 *
 * `above_fshd1_repeat_range` IS DELIBERATELY LEFT UNGATED. That label's
 * whole content is the guideline sending this report's reader off to
 * evaluate FSHD2, and that instruction does not stop being the right
 * next step because the 4q allele is 4qB.
 */
const REPEAT_COUNT_ON_NON_PERMISSIVE_HAPLOTYPE =
  'repeat_count_not_read_against_fshd1_range_non_permissive_haplotype';

const clinicaliseD4Z4 = (
  raw: unknown,
  fromLaboratoryReport: boolean,
  haplotypePermissive: boolean | null,
): string | null => {
  const cell = readGeneticCell(raw);
  if (cell.kind === 'empty') return null;
  if (!fromLaboratoryReport) return NOT_A_LABORATORY_READING;
  if (cell.kind === 'not_a_reading') return 'unspecified';
  const reading = readSizeCell(cell.text);
  if (reading === null) return null;
  if (isDeterminateRepeatCount(reading)) {
    if (reading.value > FSHD1_MAX_REPEAT_UNITS) return 'above_fshd1_repeat_range';
    // The WHOLE in-range answer is gated on the haplotype, not just its
    // grey-zone variant. See `REPEAT_COUNT_ON_NON_PERMISSIVE_HAPLOTYPE`.
    if (haplotypePermissive === false) return REPEAT_COUNT_ON_NON_PERMISSIVE_HAPLOTYPE;
    // The 8–10 grey zone, on the passport's own predicate and gated the
    // passport's own way — `!== false`, so a report naming no haplotype
    // keeps the note. See `WITHIN_FSHD1_REPEAT_RANGE_GREY_ZONE`.
    return isD4Z4GreyZone(reading)
      ? WITHIN_FSHD1_REPEAT_RANGE_GREY_ZONE
      : 'within_fshd1_repeat_range';
  }
  // The kb branch comes first, because a kb cell reading 0 is a length
  // and not an unreadable count — the same order `zeroRepeatCount`
  // keeps by gating itself on the unit.
  if (reading.unit === 'kb' && reading.value !== null) return LENGTH_IN_KB_NOT_A_REPEAT_COUNT;
  if (reading.value === 0) return 'zero_repeat_count_not_a_valid_reading';
  return 'unspecified';
};

/**
 * THE ECORI FRAGMENT — THE OTHER SIZE CELL, AND A LENGTH IN KB WHATEVER
 * THE CELL PRINTS.
 *
 * IT REACHED THE MODEL AS A BARE NUMBER. `clinicaliseD4Z4` is dispatched
 * on the cell's name, the name has no 「d4z4」 in it, and no other branch
 * claimed it — so precise mode printed the fragment with none of the
 * refusal every other surface prints for the same number, and strict
 * mode swept it into `numericValuesWithheld`, once for every spelling of
 * it in the blob. Worse than a stated 「18kb」: the bridge writes
 * `ecoriFragmentKb` as the bare reading without its unit, so a cell on
 * the prompt read 「18」 — indistinguishable, to a model asked about D4Z4
 * 重复数, from a repeat count of 18.
 *
 * NOT `clinicaliseD4Z4` WITH ANOTHER NAME. That function bands whatever
 * `isDeterminateRepeatCount` accepts, and a bare 「18」 with no stated
 * unit is exactly what it accepts — so routing this cell through it
 * would answer 「above_fshd1_repeat_range」 about a fragment length, which
 * is the misreading in the other direction and the one the boundary was
 * written to prevent. This cell is not a count in any state, so it is
 * never banded and the unit is never asked for: `kbLengthsNotJudged` in
 * the passport tests the parsed EcoRI cell for a value and nothing else,
 * and this is that test.
 *
 * DISPATCHED ON THE SUBSTRING, like every other cell reader in
 * `projectOcrFields`, and that is what makes the class closed rather
 * than enumerated. Every spelling in the passport's
 * `GENETIC_FIELD_KEYS.ecoRIFragment` — the current bridge's and the
 * legacy extraction paths' alike — lowercases to something containing
 * 「ecori」, and so will the next one. Naming a subset here is how this
 * cell came to be handled under some of its names and none of the
 * others.
 */
const clinicaliseEcoRIFragment = (raw: unknown, fromLaboratoryReport: boolean): string | null => {
  const cell = readGeneticCell(raw);
  if (cell.kind === 'empty') return null;
  if (!fromLaboratoryReport) return NOT_A_LABORATORY_READING;
  if (cell.kind === 'not_a_reading') return 'unspecified';
  const reading = readSizeCell(cell.text);
  if (reading === null) return null;
  // `readSizeCell` is what withholds the value from a negated cell, so
  //「未检出10kb以下片段」 arrives here with no length to name.
  return reading.value !== null ? LENGTH_IN_KB_NOT_A_REPEAT_COUNT : 'unspecified';
};

/**
 * THE SECOND NUMBER IN 「3/22」 — THE ALLELE THAT WAS NOT CONTRACTED, and
 * the length-carrying cell on this projection that no boundary is about.
 *
 * IT WAS BEING BANDED ON THE FSHD1 BOUNDARY. `clinicaliseD4Z4` is
 * dispatched on 「d4z4」, this cell's name contains it, and so a report
 * printing 「D4Z4 重复数 3/22」 handed the model two readings of itself:
 * `d4z4RepeatPathogenic_clinical: within_fshd1_repeat_range` and,
 * directly beneath it, `d4z4RepeatOther_clinical:
 * above_fshd1_repeat_range` — the label whose whole meaning is that the
 * guideline is sending this report's reader off to evaluate FSHD2. The
 * arithmetic is right and the claim is false: 22 units is what the
 * uncontracted allele is supposed to be, and the boundary is stated
 * about the contracted one.
 *
 * SO NO BAND, AND NOT BECAUSE THE NUMBER IS UNREADABLE. `unspecified`
 * is what this file says when a cell pins nothing down; when this one
 * pins a count down it is simply not the count any boundary in this
 * repo is about. `GENETIC_FIELD_KEYS.d4z4Repeats` is the passport's
 * list of the cells that ARE, and every spelling of this one is
 * deliberately outside it: no surface on this platform reads the other
 * allele, prints it, or grades it. The assistant was the only one that
 * did, and it graded it wrongly.
 *
 * BUT THE LABEL IS A CLAIM ABOUT THE CELL, so the cell has to be read
 * before it is granted. The first cut asked only whether the value was
 * non-empty, which made 「0」, 「18 kb」, 「未检出」 and 「—」 come out
 * identical to a determinate 22 — and in strict mode the raw cell is
 * dropped, so that sentence was the whole of what the prompt carried:
 * a report whose other-allele cell says 未检出 was handed over as an
 * allele this platform had read and placed. The three refusals below
 * are its sibling's, in its sibling's order and for its reasons —
 * `readSizeCell` is what the cell says, `isDeterminateRepeatCount` is
 * whether that is a count, and the kb branch precedes the zero branch
 * because a kb cell reading 0 is a length and not an unreadable count.
 */
const OTHER_ALLELE_NOT_THE_CONTRACTED_ONE = 'other_allele_not_the_contracted_one';

const clinicaliseOtherD4Z4Allele = (raw: unknown, fromLaboratoryReport: boolean): string | null => {
  const cell = readGeneticCell(raw);
  if (cell.kind === 'empty') return null;
  // The laboratory gate first, as everywhere else: what a 病历摘要 quoted
  // is not this platform's reading of anything, this cell included.
  if (!fromLaboratoryReport) return NOT_A_LABORATORY_READING;
  if (cell.kind === 'not_a_reading') return 'unspecified';
  const reading = readSizeCell(cell.text);
  if (reading === null) return null;
  if (isDeterminateRepeatCount(reading)) return OTHER_ALLELE_NOT_THE_CONTRACTED_ONE;
  if (reading.unit === 'kb' && reading.value !== null) return LENGTH_IN_KB_NOT_A_REPEAT_COUNT;
  if (reading.value === 0) return 'zero_repeat_count_not_a_valid_reading';
  return 'unspecified';
};

/**
 * A METHYLATION CELL, WITHHELD RATHER THAN GRADED.
 *
 * IT HAD THE SAME SHAPE AS THE D4Z4 LADDER AND ONE DEFECT MORE. The
 * first number in the string decided a band — so a range read as its
 * lower bound, a negation read as the number inside it, and a 0 read as
 * the worst band there is — and before that the number was converted:
 * anything at or below 1 was multiplied out as a ratio, anything above
 * it taken as a percent. The report parser defaults this cell's unit to
 * %, so 「甲基化 0.35」 left the parser as 0.35% and reached the patient
 * as 35%.
 *
 * AND NOTHING IN THIS REPO STATES A METHYLATION BOUNDARY. Those edges
 * are this file's own invention. The passport prints the value and
 * grades it with nothing; the discipline everywhere else is that a
 * threshold is quoted rather than converted, and there is no quote to
 * hand. So the band is deleted rather than qualified, and what is left
 * is the true statement: there is a methylation result on file and the
 * number is not being shared.
 *
 * A CELL THAT IS NOT A NUMBER IS THE LABORATORY'S OWN WORD, and it
 * survives — the same rule `projectOcrFields` applies to every other
 * qualitative result, for the same reason. What the patient withheld is
 *「精确数值」, and 未检出 is not one.
 *
 * SO THERE IS NO `methylation_clinical`, AND THE KEY WAS THE LAST
 * PLACE THE GRADE SURVIVED. Deleting the ladder left a key still
 * spelled `_clinical` and still labelled 甲基化临床分级 in
 * `PROFILE_FIELD_LABELS`, holding one of two things that are not a
 * grade: `value_withheld`, which is a statement about what the patient
 * consented to, and — worse — the laboratory's own qualitative word.
 * Rendered, a numeric cell printed 「甲基化临床分级: value_withheld」 and
 * a qualitative one printed 「甲基化临床分级: 未检出」, handing the
 * laboratory's word back to the model as this platform's grading of
 * the FSHD2 discriminator. Every other surface refuses it: the
 * passport, the share page, the referral pack and the mobile PDF print
 * 甲基化 as a value with its origin bracket and no grade, and the
 * TREAT-NMD document gives `diagnosis.d4z4` and `diagnosis.haplotype` a
 * verdict while `diagnosis.methylation` gets a bare string.
 *
 * WHAT IS LEFT IS THE TWO CHANNELS THIS FILE ALREADY HAS FOR A CELL IT
 * DOES NOT GRADE. The laboratory's own word survives under the cell's
 * own key — the rule `projectOcrFields` applies to every other
 * qualitative result, because what the patient withheld is 「精确数值」
 * and 未检出 is not one. A measurement is withheld and said to be
 * withheld, so the model reports a result it cannot read rather than
 * no result: `numericValuesWithheld` on the reports blob, and
 * `methylation_withheld` on the profile, which is the same sentence
 * under a label that states it instead of one that grades it.
 *
 * AND A CELL THAT IS NOT A SCALAR IS NEITHER. The two channels above
 * are 「the laboratory's own word」 and 「a measurement, withheld」, and an
 * array is not a word — `formatScalar` would have joined
 * `['35', '40']` into 「甲基化值: 35、40」 and published it as this
 * patient's methylation result, which is the coercion `pickReading`
 * refuses everywhere else on this platform. It takes the withheld
 * channel: there is a methylation cell on file and no number is
 * reaching the prompt, which is true of it in both modes.
 *
 * BUT WHERE THE CELL CAME FROM IS STILL A QUESTION THIS READER HAS TO
 * ASK, AND IT WAS THE ONE GENETICS READER THAT DID NOT.
 *
 * `clinicaliseD4Z4`, `clinicaliseEcoRIFragment`,
 * `clinicaliseOtherD4Z4Allele` and `clinicaliseHaplotype` all take
 * `fromLaboratoryReport` and all answer `not_read_off_a_laboratory_report`
 * when the value did not come off the laboratory's own report. This one
 * took no such argument and neither call site passed an origin — so a
 * percentage a patient typed into the registration form's 甲基化 box,
 * and a percentage a 病历摘要 quoted off somebody else's report, were
 * rendered to the assistant as bare results sitting directly beside
 * sibling cells that DO carry the refusal:
 *
 *     - d4z4Repeats_clinical: not_read_off_a_laboratory_report
 *     - haplotype_clinical: not_read_off_a_laboratory_report
 *     - methylationValue: 12%
 *
 * The third line is the FSHD2 discriminator, printed as though this
 * platform stood behind it, on the cell 甲基化临床分级 was deleted for
 * overclaiming about. The passport's rule does not have a methylation
 * exception: a value not read off a laboratory genetics report may be
 * DISPLAYED with its origin and may never decide anything.
 *
 * THE ORIGIN IS STATED IN BOTH MODES, like every other refusal in this
 * file. What the precise consent buys is the number beside the
 * sentence; it does not buy the cell a promotion to a reading this
 * platform never made. And it is stated WITHOUT grading the cell —
 * there is still no methylation boundary in this repo, so the origin
 * travels under its own key rather than under a `_clinical` sibling
 * that would read as this platform's verdict on the value.
 */
interface MethylationCell {
  /** What happens to the number: published, or withheld and counted. */
  value: 'raw' | 'withheld';
  /** `NOT_A_LABORATORY_READING` when this platform did not read the
   *  cell off the laboratory's own report, `null` when it did. */
  origin: string | null;
}

const methylationCell = (
  raw: unknown,
  mode: RedactionMode,
  fromLaboratoryReport: boolean,
): MethylationCell | null => {
  const cell = readGeneticCell(raw);
  if (cell.kind === 'empty') return null;
  const origin = fromLaboratoryReport ? null : NOT_A_LABORATORY_READING;
  if (cell.kind === 'not_a_reading') return { value: 'withheld', origin };
  if (mode === 'precise') return { value: 'raw', origin };
  return { value: isQualitativeResult(raw) ? 'raw' : 'withheld', origin };
};

/**
 * 4qA / 4qB, READ BY THE PASSPORT'S OWN READER.
 *
 * It matched the cell on a bare substring, which cannot tell 「4qA」
 * apart from 「未检出 4qA 等位基因」 and reads a cell naming both probes
 * as the permissive one. `parsePermissiveHaplotype` refuses both, and
 * refuses them the way the passport already refuses them.
 *
 * THE PERMISSIVE LABEL NO LONGER SAYS PATHOGENIC. 4qA is the permissive
 * haplotype; on its own it is not a finding of disease — this platform's
 * own statement of the report requirements has the haplotype as the item
 * WITHOUT which 「重复单元数本身不足以下结论」, which is the opposite
 * claim. `non_permissive_haplotype` is left as it is: it is the word the
 * passport's own grade uses.
 *
 * WHICH IS ALSO WHY IT NEEDS THE LABORATORY. That grade is minted from
 * a record the passport brands `laboratory_report` and from nothing
 * else, precisely because a transcription can carry a haplotype as
 * readily as a repeat count. Same gate as the cell above, for the same
 * reason and in the same words.
 *
 * A CELL HOLDING AN ARRAY IS `unspecified_haplotype` AND NOT `null`.
 * It used to bail on `typeof raw !== 'string'` and return null, so no
 * `_clinical` sibling was written — and nothing else refused the cell:
 * precise mode published the array, which `formatScalar` joined into
 * 「单倍型: 4qA、4qB」, the exact line `pickReading` exists to refuse,
 * asserted as this patient's haplotype with no reading beside it; and
 * strict mode, which drops the raw cell, published nothing at all, so
 * the assistant reported a genetics report as having no haplotype. The
 * cell EXISTS and this platform cannot read it — which is what
 * `unspecified_haplotype` already says about 「4qA/4qB」 written as a
 * string, and it is the same fact.
 *
 * THAT IS HALF THE ANSWER, AND THE OTHER HALF WAS MISSING FOR LONGER.
 * A reading beside the cell does not stop the cell being printed:
 * precise mode went on publishing the array, so the prompt carried
 * 「单倍型: 4qA、4qB」 with `unspecified_haplotype` directly beneath it —
 * one line asserting a haplotype and the next refusing to read one. The
 * refusal of the raw half lives on the shared publish path, where it
 * covers every genetics cell on both scopes at once, and it is THIS
 * function's own reader that decides it: `publishGeneticCell` prints a
 * cell only where `readGeneticCell` returned text, so the two halves
 * cannot come apart again. See `isScalarCell` for the same rule at the
 * category cell's width.
 */
const clinicaliseHaplotype = (raw: unknown, fromLaboratoryReport: boolean): string | null => {
  const cell = readGeneticCell(raw);
  if (cell.kind === 'empty') return null;
  if (!fromLaboratoryReport) return NOT_A_LABORATORY_READING;
  if (cell.kind === 'not_a_reading') return 'unspecified_haplotype';
  const permissive = parsePermissiveHaplotype(cell.text);
  if (permissive === true) return 'permissive_haplotype';
  if (permissive === false) return 'non_permissive_haplotype';
  return 'unspecified_haplotype';
};

/** Strip the day from any date-looking string, keeping only the year
 *  as a structured field.
 *
 *  THIS ONE COERCES WITH `String(raw)` AND IS ALLOWED TO, which is the
 *  opposite of the rule every genetics reader here follows. The
 *  difference is what escapes: those readers publish the cell beside
 *  their reading, so a coercion there puts the cell's own bytes in the
 *  prompt; this one publishes a four-digit integer and nothing else. An
 *  array stringifies to its joined elements and an object to
 *  「[object Object]」, and either way the only thing that can leave is a
 *  year between 1901 and next year. A cell holding `['2019-03-01']`
 *  therefore still yields 2019 rather than losing the date, and no part
 *  of the value it came from travels with it.
 *
 *  The upper bound reads the process clock, and it is the one date
 *  expression in this file that may: it is a sanity ceiling on a parsed
 *  integer, never a date this platform prints, and its `+ 1` slack is
 *  wider than the eight hours between UTC and the Asia/Shanghai calendar
 *  the product declares — so no value's fate can turn on which of the
 *  two the host happens to be in. */
const yearFromDate = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null;
  const text = String(raw);
  const match = text.match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year > 1900 && year <= new Date().getUTCFullYear() + 1
    ? year
    : null;
};

/**
 * EVERY VALUE A `_clinical` GENETICS KEY CAN HOLD THAT IS NOT A READING
 * OF THE CELL — this platform declining to read it, in each of the
 * wordings the readers above use.
 *
 * Exported for `tools/tool-descriptions.test.ts`, which uses it to ask
 * the question this list exists to keep answerable: does a key whose
 * label CLAIMS something — a 分级, a grade — ever actually hold one, or
 * are all of its reachable values refusals? `PROFILE_FIELD_LABELS`
 * deleted 甲基化临床分级 for exactly that reason and then kept
 * 「D4Z4 临床分级」 and 「单倍型临床分级」 over two keys that, with the
 * laboratory gate hardcoded false, could hold nothing but
 * `not_read_off_a_laboratory_report`.
 */
export const GENETIC_READING_REFUSALS: ReadonlySet<string> = new Set([
  NOT_A_LABORATORY_READING,
  LENGTH_IN_KB_NOT_A_REPEAT_COUNT,
  OTHER_ALLELE_NOT_THE_CONTRACTED_ONE,
  // A count this platform declines to read against the FSHD1 range
  // because the same report says 4qB. It parses and it is a count; what
  // it is not is a reading of that count against a boundary stated for
  // the other allele. See `REPEAT_COUNT_ON_NON_PERMISSIVE_HAPLOTYPE`.
  REPEAT_COUNT_ON_NON_PERMISSIVE_HAPLOTYPE,
  'zero_repeat_count_not_a_valid_reading',
  'unspecified',
  'unspecified_haplotype',
]);

/**
 * THE PROFILE SCOPE'S KEY FOR 「a value is on file and is not being
 * shared」, PER CELL.
 *
 * The reports scope counts every withheld measurement on a blob into one
 * `numericValuesWithheld`; this scope has no blob and no counter, so the
 * statement needs a key of its own, and layer 3 passes literal keys — a
 * `${cell}_withheld` template would mint keys `PROMPT_ALLOWLIST.profile`
 * does not carry, and layer 3 drops them silently. So the table names
 * exactly the cells that CAN be said, and `GeneticCellSink.stateWithheld`
 * reports back whether the caller's cell was one of them.
 *
 * `methylation` is the only entry. See the note on `stateWithheld` in
 * `clinicalise` for the cell that is missing from it and what adding one
 * costs.
 */
const PROFILE_WITHHELD_KEYS: Readonly<Record<string, string>> = {
  methylation: 'methylation_withheld',
};

interface ClinicaliseResult {
  added: Record<string, unknown>;
  drop: Set<string>;
  changed: string[];
}

/**
 * `stool_color` → `stoolColor`. Used to collapse the alias pairs the
 * OCR pipeline emits.
 */
const toCamel = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * Reject a value that a safe key should never have been holding.
 *
 * `OCR_FIELDS_SAFE_KEYS_PRECISE` is a list of keys, and it carries an
 * unstated premise: that a listed key holds a short, structured value
 * — a number, an enum, a one-line impression. The extractor is what
 * makes that true, and the extractor broke it. Observed in production,
 * inside `ecgSummary`, a key on the precise list:
 *
 *   "房室… 年龄:23 … 科别:神经内科 … 门诊号: 住院号:R000000 …
 *    本报告仅供临床医师结合临床参考"
 *
 * An inpatient medical-record number, a department and an age, on their
 * way to the model, through a key the allowlist trusted. The Python
 * extractor is fixed, but "the allowlist is safe as long as the
 * extractor behaves" is not a security property — every row already in
 * the database still has the old value, and the next extractor change
 * is one commit away.
 *
 * So the value is checked as well as the key. This is the same
 * deny-by-default stance the rest of this module takes.
 */
/**
 * THE IDENTIFIER VOCABULARY, WRITTEN ONCE AND ASKED BY BOTH CALLERS.
 *
 * There are two readers of this vocabulary and they must never be two
 * vocabularies:
 *
 *   - `isUntrustworthyText`, which REFUSES a cell whose value carries
 *     any of these, and
 *   - `scrubIdentifiers` (layer 4), which REMOVES them from free text
 *     and then refuses the whole field if anything is left.
 *
 * The second one is new, and the temptation was to give it a scrubber
 * of its own — a shorter, friendlier list, because a scrub that refuses
 * too much costs a sentence while a cell refusal costs one cell. That
 * is exactly how the two would drift, and the drift is one-directional:
 * the free-text path is the one carrying a whole radiology sentence, so
 * a weaker copy there would be the weaker copy on the wider channel.
 * So the labels and the value shapes are declared once, below, and each
 * reader is built from them.
 *
 * WHAT A LABEL LIST CAN AND CANNOT DO. A record number announces itself
 * (住院号, 门诊号) and can be removed with its value. A Chinese personal
 * name announces nothing: 张三 and 高明 are two characters that are also
 * two ordinary characters, and no pattern tells them apart. So names are
 * reached two ways — a label in front of one, and the payload's own
 * `patientName` / `doctorName` cells — and an UNLABELLED name this
 * document never filed under a key is NOT reachable by either. That
 * limitation is real, it is stated in `scrubIdentifiers`, and it is why
 * the eligibility gate exists: a narrative document, where unlabelled
 * names of relatives and physicians are the norm, sends no free text at
 * all.
 */

/**
 * ONE NORMALISATION, AT THE ENTRY TO EVERY GATE, SO THAT EVERY PATTERN
 * BELOW MAY ASSUME ASCII.
 *
 * JavaScript's `\d` and `[A-Za-z0-9]` are ASCII-only. Chinese hospital
 * PDFs and the OCR bridge routinely emit the FULL-WIDTH forms —
 * U+FF10..U+FF19 for the digits, U+FF21..U+FF5A for the letters,
 * U+FF01..U+FF5E for the punctuation — and every identifier pattern,
 * the labelled-value scrub, the token scan of gate 2 and the residual
 * check were all written in ASCII classes. So an 18-digit ID card, a
 * mobile number, a full date and every measurement typeset full-width
 * walked through all three gates, in BOTH modes, and left the
 * unclassified flag clear as well — because the second reading
 * re-scanned with the same ASCII regex. It failed open and it failed
 * silently, which is the worst pair.
 *
 * The answer is not full-width alternatives bolted onto thirty
 * patterns; that is the enumeration this whole change exists to stop
 * writing. The text is folded ONCE, here, at the entry to the gates and
 * to the cell examination, and everything downstream is entitled to
 * assume ASCII. WHAT IS FOLDED, exhaustively:
 *
 *   - U+FF01..U+FF5E, the full-width ASCII block, onto U+0021..U+007E by
 *     the fixed 0xFEE0 offset — MINUS the grouping and sentence
 *     punctuation named in `FULL_WIDTH_KEPT`. What is folded is what can
 *     hide INSIDE an identifier or a measurement: the digits, the Latin
 *     letters, and 「％」「／」「－」「．」「＝」「＋」「＠」「～」. What is
 *     left alone is `FULL_WIDTH_KEPT` — 「，」「；」「：」「！」「？」「（）」
 *     「＂」「＇」 — because folding those rewrites the report's own prose
 *     into half-width punctuation for no gain: no identifier hides
 *     behind a Chinese comma. The handful of patterns that need 「：」 or
 *     a bracket as a DELIMITER name both spellings, which is six places
 *     rather than thirty.
 *   - NOTHING is done to U+3000 or the other Unicode spaces, and that is
 *     a decision rather than an omission: JavaScript's `\s` ALREADY
 *     matches every one of them (U+00A0, U+1680, U+2000..U+200A, U+202F,
 *     U+205F, U+3000), so every `\s` below already reads an ideographic
 *     space as a separator. Folding them would rewrite the
 *     report's own typography for no gain — 「炎性改变　未见水肿」 is
 *     printed with an ideographic space on purpose.
 *   - The zero-width characters (U+200B..U+200D, U+2060, U+FEFF) are
 *     DELETED rather than mapped. They are invisible, they survive OCR
 *     and copy-paste, and one of them dropped inside a digit run is
 *     enough to break every `\d{9,}` in this file.
 *   - The Unicode dashes (U+2010..U+2015, U+2212) onto `-`, so a date or
 *     a range typeset with an en dash reads as one shape.
 *   - The superscript digits (U+00B9, U+00B2, U+00B3, U+2070,
 *     U+2074..U+2079) onto their ASCII digits, so 「kg/m²」 is the same
 *     token to gate 2 as 「kg/m2」.
 *   - The Arabic-Indic digits (U+0660..U+0669, U+06F0..U+06F9) onto
 *     ASCII, for the same reason as the full-width ones.
 *
 * WHAT IS DELIBERATELY NOT FOLDED, so the list above is not read as
 * covering it: the Roman numerals (U+2160..U+217F) and the enclosed
 * digits (U+2460..U+24FF). Neither carries an ASCII digit, gate 2
 * therefore never reads either as a measurement, and 「Ⅲ级」 and 「①」 are
 * a grade and a list marker — names, not numbers. Nor are the CJK
 * punctuation marks that have no ASCII counterpart in the FF block —
 * 「。」 and 「、」 keep their own code points and the patterns below name
 * them literally where they matter.
 *
 * THE COST, STATED: a published impression carries a half-width 「-」
 * where the report printed 「－」, and half-width digits and letters
 * throughout. That is accepted on purpose, and it is why the fold was
 * narrowed to the characters that can hide inside an identifier rather
 * than applied to the whole block. WHAT IS NOT AN OPTION is scanning a
 * folded copy and publishing the original: that is a gate certifying a
 * string nobody examined.
 */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const FULL_WIDTH_ASCII = /[\uFF01-\uFF5E]/g;
/** The full-width characters that are NOT folded: sentence and
 *  grouping punctuation, which no identifier can hide behind. See the
 *  note on `normaliseForGates`. */
const FULL_WIDTH_KEPT: ReadonlySet<string> = new Set([
  '\uFF01',
  '\uFF02',
  '\uFF07',
  '\uFF08',
  '\uFF09',
  '\uFF0C',
  '\uFF1A',
  '\uFF1B',
  '\uFF1F',
]);
const UNICODE_DASH = /[\u2010-\u2015\u2212]/g;
const SUPERSCRIPT_DIGIT = /[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]/g;
const SUPERSCRIPT_DIGITS: Readonly<Record<string, string>> = {
  '\u00B9': '1',
  '\u00B2': '2',
  '\u00B3': '3',
  '\u2070': '0',
  '\u2074': '4',
  '\u2075': '5',
  '\u2076': '6',
  '\u2077': '7',
  '\u2078': '8',
  '\u2079': '9',
};
const ARABIC_INDIC_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/g;

const normaliseForGates = (raw: string): string =>
  raw
    .replace(ZERO_WIDTH, '')
    .replace(FULL_WIDTH_ASCII, (c) =>
      FULL_WIDTH_KEPT.has(c) ? c : String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(UNICODE_DASH, '-')
    .replace(SUPERSCRIPT_DIGIT, (c) => SUPERSCRIPT_DIGITS[c])
    .replace(ARABIC_INDIC_DIGIT, (c) => {
      const code = c.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });

const anyOf = (words: readonly string[]) =>
  [...words].sort((a, b) => b.length - a.length).join('|');

/**
 * A RECORD NUMBER'S LABEL, AS A SUFFIX RULE RATHER THAN A LIST.
 *
 * The list this replaces was an enumeration — 住院号, 门诊号, 病案号,
 * 病历号 … — and the finding against it was the finding an enumeration
 * always gets: 门诊卡号, 就诊卡号, ID号 and 检查编号 are not on it, and the
 * next hospital will print a fifth spelling. The enumerable part of such
 * a label is its SUFFIX. A counter in a Chinese medical document is
 * printed under 「…号」 and the prefix is whatever that hospital calls the
 * counter, so the suffix is matched and the prefix is a bounded run of
 * Han or Latin characters.
 *
 * WITH ONE EXCLUSION, AND IT IS NOT A JUDGEMENT CALL. A handful of
 * ordinary words end in 号 and none of them is a counter. 「高信号」 is
 * the commonest word in an MRI impression; a bare 号 suffix would read it
 * as a label and eat the value printed after it, which is the same
 * failure `CHINESE_SURNAMES` had. The excluded characters are the ones
 * that make 号 mean something other than a number — 信/符/括/逗/句/问/
 * 顿/引/冒/分/叹/折 — asserted as a lookbehind on the character
 * immediately before the 号, so 登记号 and 编号 keep working.
 *
 * AND THE SHAPES THAT DO NOT END IN 号 stay as literals, because there
 * is no suffix to generalise: an ID card, a barcode, and the birth date
 * / age family. On that last one, unchanged from the list this replaces:
 * `dateOfBirth` / `birthday` are on HARD_DELETE_KEYS, `patientAge` is
 * deliberately absent from OCR_FIELDS_SAFE_KEYS_PRECISE, and
 * `clinicalise` says in as many words that there is NO age band in
 * either mode. An age printed inside an impression is that same value
 * arriving by another door, so it leaves by the same one. The observed
 * production leak this check was written for — 「…年龄:23 … 科别:神经内科
 * … 住院号:R000000…」 inside `ecgSummary` — printed all three together.
 */
const NOT_A_RECORD_NUMBER_BEFORE_HAO = '信符括逗句问顿引冒分叹折';

const RECORD_NUMBER_LABEL_SOURCE = [
  `(?:[一-龥]{1,5}|[A-Za-z]{1,6})(?<![${NOT_A_RECORD_NUMBER_BEFORE_HAO}])号`,
  '(?<![A-Za-z])ID(?![A-Za-z])',
  ...['身份证', '条形码', '出生日期', '出生年月', '年龄', '生日'],
].join('|');

/**
 * A PERSON'S LABEL, ALSO AS A SUFFIX RULE, AND SPLIT INTO TWO TIERS
 * BECAUSE ONLY ONE OF THEM MAY EAT WHAT FOLLOWS UNCONDITIONALLY.
 *
 * The list this replaces treated 受检者 / 被检者 / 受检人 / 技师 as
 * DEDICATED labels whose following two or three Han characters were
 * eaten with no further question asked. In a report's IMPRESSION those
 * words are ordinary sentence subjects, so 「受检者未见明显异常」 became
 * 「受检者[人名未共享]显异常」 — THE NEGATION DELETED AND THE RULED-OUT
 * FINDING PUBLISHED AS PRESENT. That is the exact defect this whole
 * change exists to end, reintroduced by its own guardrail.
 *
 * TIER 1 — DEDICATED. 姓名 / 名字 / 签名, with up to four Han characters
 * of prefix (患者姓名, 受检者姓名, 医师签名). These strings exist on a page
 * in order to introduce a name and can be nothing else, so whatever
 * follows one IS the value and is taken without corroboration.
 *
 * TIER 2 — ROLES. 医师 / 医生 / 大夫 / 技师 / 技士 / 护士 / 护师, again with a
 * Han prefix — which is what covers 经治医师, 住院医师, 管床医师, 诊断医师,
 * 主治医师 and the bare 医师 in one rule instead of eleven entries — plus
 * the standalone role nouns 受检者 / 被检者 / 受检人 / 送检人 / 申请人. Every
 * one of these can open an ordinary clinical sentence, so a tier-2 label
 * only eats what follows it when a DELIMITER says a field follows
 * (姓名：, 受检者（…）) or when the surname witness fires. Otherwise it is
 * left alone and the sentence survives intact.
 */
const DEDICATED_NAME_LABEL_SOURCE = '[一-龥]{0,4}(?:姓名|名字|签名)';

const PERSON_ROLE_LABEL_SOURCE = [
  '[一-龥]{0,4}(?:医师|医生|大夫|技师|技士|护师|护士)',
  '受检者',
  '被检者',
  '受检人',
  '送检人',
  '申请人',
].join('|');

const PERSON_NAME_LABEL_SOURCE = `(?:${DEDICATED_NAME_LABEL_SOURCE}|${PERSON_ROLE_LABEL_SOURCE})`;

/**
 * ORDINARY WORDS A NAME FOLLOWS IN PROSE, used by the SCRUB and by
 * nothing else.
 *
 * 「患者张三，女」 is how a report opens. The word is not an identifier
 * and never refuses a cell — see `DEDICATED_NAME_LABEL_SOURCE` — but a
 * name directly after one is a name.
 */
const PERSON_NOUNS: readonly string[] = ['患者', '病人', '本例', '该患者'];

/**
 * THE FIRST CHARACTER OF A CHINESE NAME, AS CORROBORATION AND NOTHING
 * MORE.
 *
 * The one reliable thing about a Chinese personal name. The deleted
 * extractor's own note said it best — 「Chinese names have no reliable
 * pattern」 — and that is true of the NAME; it is not true of the
 * surname, which is drawn from a list this short.
 *
 * TWENTY-TWO CHARACTERS ARE GONE FROM IT, and the rule that removed them
 * is the rule this file now applies to every witness: A WITNESS THAT
 * FIRES ON ORDINARY CLINICAL VOCABULARY IS NOT A WITNESS. Each of these
 * is the opening character of a word an impression prints constantly, so
 * corroborating on it deleted the analyte or the hedge after 患者 and put
 * a person marker in its place:
 *
 *   白 (白细胞, 白蛋白, 脑白质)   高 (高信号, 高度, 高密度)
 *   石 (结石)                     方 (方向, 前方)
 *   金 (金属)                     田 / 万 / 向 (向心性, 方向)
 *   于 (a preposition)            严 (严重)
 *   曾 (曾行, 曾有)               余 (其余, 余各叶)
 *   范 (范围)                     黄 (黄疸, 黄斑)
 *   段 (节段)                     叶 (肺叶, 左叶)
 *   程 (程度, 过程)               史 (病史)
 *   孔 (椎间孔)                   毛 (毛糙, 毛细血管)
 *   任 (任何)                     戴 (戴支具)
 *
 * WHAT THAT COSTS, STATED RATHER THAN HIDDEN: a patient actually
 * surnamed 高 or 黄 is no longer reached by THIS witness. They are still
 * reached by the two mechanisms that do not guess — the document's own
 * `patientName` cell (see `identifierValuesInInput`) and a dedicated
 * label in front of the name — and by gate 0, which sends nothing at all
 * off the documents where unlabelled names are the norm.
 *
 * NOT A COMPLETE LIST AND IT CANNOT BE. A rare surname after 患者 is a
 * name this scrub does not reach. See the limitations `scrubIdentifiers`
 * states.
 */
const CHINESE_SURNAMES =
  '王李张刘陈杨赵吴周徐孙马朱胡郭何林罗郑梁谢宋唐许韩冯邓曹彭肖董袁潘蒋蔡杜苏魏吕丁沈姚卢姜崔钟谭陆汪廖贾夏韦付邹孟熊秦邱江尹薛闫雷侯龙陶黎贺顾郝龚邵钱覃武莫汤';

/** Labels a means of CONTACTING this person is printed under. Removed
 *  with the value, like a record number, and marked as a number because
 *  that is what a telephone is. Suffix-shaped for the same reason the
 *  record-number label is: 联系电话 / 家属电话 / 手机 are one rule. */
const CONTACT_LABEL_SOURCE = [
  '[一-龥]{0,3}(?:电话|手机|传真|邮箱|微信|联系方式)',
  '(?<![A-Za-z])(?:QQ|qq|Tel|TEL|tel|Fax|FAX|fax|E-?mail|E-?MAIL|e-?mail)(?![A-Za-z])',
].join('|');

/** Labels a PLACE is printed under. Split from the contact labels only
 *  so the marker can say which of the two it took: 「患者[地点未共享]」
 *  over a telephone number reads as a hospital transfer. */
const ADDRESS_LABEL_SOURCE = '[一-龥]{0,3}(?:家庭住址|现住址|住址|地址|工作单位|籍贯|户籍)';

/**
 * EVERY LABEL SHAPE AT ONCE, USED AS A NEGATIVE LOOKAHEAD INSIDE EVERY
 * VALUE RUN — which is the structural half of the ordering fix.
 *
 * `ADDRESS_SCRUB` accepted Han characters in its value class and ran
 * BEFORE the name scrub, so on 「住址：北京市海淀区中关村大街1号 姓名：张
 * 三」 it ran greedily through the address, through the space, THROUGH
 * THE 姓名 LABEL, and stopped somewhere inside 张三 — and the name behind
 * it then survived, because the label that would have caught it had been
 * eaten by the address. Order alone cannot fix that: whichever scrub
 * runs first can swallow the next one's label.
 *
 * So no value run may cross a label, whatever the order. The guard is
 * asserted character by character inside the run rather than at its end,
 * which is what makes it hold for a greedy quantifier.
 */
const ANY_LABEL_SOURCE = [
  RECORD_NUMBER_LABEL_SOURCE,
  PERSON_NAME_LABEL_SOURCE,
  CONTACT_LABEL_SOURCE,
  ADDRESS_LABEL_SOURCE,
].join('|');

/**
 * IDENTIFIER SHAPES THAT ANNOUNCE THEMSELVES WITHOUT A LABEL, EACH
 * PAIRED WITH THE MARKER IT LEAVES BEHIND.
 *
 * One list of pairs rather than two lists matched by index: the pairing
 * used to live in a second array whose order had to be kept in step by
 * hand, which is a drift waiting to happen every time a shape is added
 * in the middle.
 *
 * These are the ones both readers can act on unaided, so they are also
 * the ones the free-text residual check is allowed to use: after
 * `scrubIdentifiers` has run, a hit here means the scrub did NOT make the
 * string safe, and the whole field is withheld.
 *
 * EVERY PATTERN HERE ASSUMES ASCII DIGITS AND ASCII PUNCTUATION. That is
 * not an oversight and it is not a hope — see `normaliseForGates`, which
 * every entry point to this vocabulary runs first.
 *
 * `\b` is used only where both sides of the match are ASCII. A Chinese
 * character is a non-word character to JavaScript, so `\b` does fire
 * between 号 and R — but it does NOT fire between two digits, which is
 * why the long-run patterns are anchored on non-digit lookarounds
 * instead.
 */
interface SelfAnnouncingIdentifier {
  readonly pattern: RegExp;
  /** Which sentinel the match is replaced with. */
  readonly sentinel: 'number' | 'date' | 'place';
}

const MONTH_NAME = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';

const SELF_ANNOUNCING_IDENTIFIERS: readonly SelfAnnouncingIdentifier[] = [
  // A mainland ID card: 18 characters, or the legacy 15 digits. WITH THE
  // OCR SPACES TOLERATED. A page that breaks the number into its blocks
  // used to have only its first block removed by the labelled scrub, and
  // the remainder published — and the remainder is the BIRTH-DATE field
  // of the card.
  {
    pattern:
      /(?<!\d)\d{6}\s*(?:18|19|20)\d{2}\s*(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s*\d{3}[\dXx](?!\d)/,
    sentinel: 'number',
  },
  { pattern: /(?<!\d)\d{15}(?!\d)/, sentinel: 'number' },
  // A letter-prefixed record number (R000000), or any long digit run —
  // a barcode, an ID card, a mobile number.
  { pattern: /(?<![A-Za-z\d])[A-Za-z]{1,3}\d{5,}(?!\d)/, sentinel: 'number' },
  { pattern: /(?<!\d)\d{9,}(?!\d)/, sentinel: 'number' },
  // A landline with its area code, in the two ways a page prints one.
  { pattern: /(?<!\d)0\d{2,3}[-\s]\d{7,8}(?!\d)/, sentinel: 'number' },
  // A DATE FINER THAN A YEAR, IN THE FOUR SHAPES A CHINESE DOCUMENT
  // ACTUALLY PRINTS. The year alone is not an identifier — this pipeline
  // publishes it as `reportDate_year`, and gate 2 protects it as a name —
  // but the MONTH already narrows a person to one of a few hundred, and
  // the day is how a family member's death or a prior admission is
  // pinned to them.
  //
  // 2019年3月 and 2019年3月5日 were the shapes the list had; 2019-03,
  // 19-03-05 and 05-Mar-2019 were not, and all three are what an OCR
  // bridge emits off a header.
  { pattern: /(?<!\d)(?:19|20)?\d{2}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日?)?/, sentinel: 'date' },
  {
    pattern:
      /(?<!\d)(?:19|20)\d{2}\s*[-/.]\s*(?:0?[1-9]|1[0-2])(?:\s*[-/.]\s*(?:0?[1-9]|[12]\d|3[01]))?(?!\d)/,
    sentinel: 'date',
  },
  {
    pattern: /(?<!\d)\d{2}\s*[-/.]\s*(?:0?[1-9]|1[0-2])\s*[-/.]\s*(?:0?[1-9]|[12]\d|3[01])(?!\d)/,
    sentinel: 'date',
  },
  {
    pattern: new RegExp(
      String.raw`(?<![A-Za-z\d])(?:0?[1-9]|[12]\d|3[01])\s*[-/ ]\s*(?:${MONTH_NAME})[a-z]*\s*[-/ ]\s*(?:19|20)?\d{2}(?![A-Za-z\d])`,
    ),
    sentinel: 'date',
  },
  {
    pattern: new RegExp(
      String.raw`(?<![A-Za-z\d])(?:19|20)\d{2}\s*[-/ ]\s*(?:${MONTH_NAME})[a-z]*\s*[-/ ]\s*(?:0?[1-9]|[12]\d|3[01])(?![A-Za-z\d])`,
    ),
    sentinel: 'date',
  },
  { pattern: /(?<!\d)\d{1,2}\s*月\s*\d{1,2}\s*日(?!\d)/, sentinel: 'date' },
  // AN ADDRESS, and only where enough components agree that it is one.
  // A single 号 is 「10 号染色体」 and a single 区 is an anatomical region,
  // so neither alone may match: what is required is an administrative
  // chain (省/市 → 市/区/县) or a street plus a number.
  {
    pattern: /[一-龥]{2,8}(?:省|自治区|特别行政区)[一-龥]{2,8}(?:市|自治州|区|县)/,
    sentinel: 'place',
  },
  { pattern: /[一-龥]{2,8}市[一-龥]{2,8}(?:区|县|旗)/, sentinel: 'place' },
  {
    pattern: /[一-龥]{2,10}(?:街道|大街|路|街|巷|村|镇|乡|小区)[一-龥\d]{0,10}号/,
    sentinel: 'place',
  },
];

const IDENTIFIER_VALUE_PATTERNS: readonly RegExp[] = SELF_ANNOUNCING_IDENTIFIERS.map(
  (entry) => entry.pattern,
);

/**
 * A LABEL STILL STANDING **WITH A VALUE BEHIND IT**, which is not the
 * same question as 「does this text contain the word 年龄」.
 *
 * The bare-label detectors these replace were a denial of service on the
 * reports this channel exists to carry. 年龄 and 电话 are on the label
 * lists and the residual check fired on the word alone, so
 * 「腰椎年龄相关性退变」 — ordinary radiology — withheld the ENTIRE
 * impression of a genuine report, and so did 「建议电话随访」.
 *
 * What the check is actually for is a scrub that did not understand what
 * it was looking at. The scrub removes a record-number or contact label
 * TOGETHER WITH its value, so a label still followed by an alphanumeric
 * value afterwards means exactly that. A label with prose after it is
 * prose.
 */
const labelWithValueStanding = (labelSource: string): RegExp =>
  new RegExp(`(?:${labelSource})(?:\\s*[:：=]\\s*(?=[A-Za-z0-9一-龥])|\\s*(?=[A-Za-z0-9]))`);

const RECORD_NUMBER_VALUE_STANDING = labelWithValueStanding(RECORD_NUMBER_LABEL_SOURCE);
const CONTACT_VALUE_STANDING = labelWithValueStanding(
  `${CONTACT_LABEL_SOURCE}|${ADDRESS_LABEL_SOURCE}`,
);

/** A cell whose value even NAMES a dedicated name label is refused whole
 *  — `isUntrustworthyText` has no way to publish half a value, and a cell
 *  that prints 姓名 is a cell the extractor filled with a page fragment.
 *  ONLY the dedicated tier: a cell printing 医师 or 技师 may be
 *  「主治医师查房」, and refusing it would be the same denial of service
 *  the bare 年龄 detector was. */
const DEDICATED_NAME_LABEL_PATTERN = new RegExp(DEDICATED_NAME_LABEL_SOURCE);

const ID_PATTERNS: readonly RegExp[] = [
  ...IDENTIFIER_VALUE_PATTERNS,
  RECORD_NUMBER_VALUE_STANDING,
  CONTACT_VALUE_STANDING,
  DEDICATED_NAME_LABEL_PATTERN,
];

/**
 * WHAT THE FREE-TEXT RESIDUAL CHECK ASKS, which is a SUBSET of what a
 * cell is refused for, and the difference is deliberate.
 *
 * The scrub leaves person labels standing on purpose —
 * 「受检者[人名未共享]」 — so asking a name-label pattern after the scrub
 * would withhold every impression that ever named a patient, including
 * the ones the scrub handled correctly. A record-number label is
 * different: the scrub removes it WITH its value, so one still standing
 * with a value behind it means the scrub did not understand what it was
 * looking at, and that is exactly the state that must fail closed.
 */
const RESIDUAL_IDENTIFIER_PATTERNS: readonly RegExp[] = [
  ...IDENTIFIER_VALUE_PATTERNS,
  RECORD_NUMBER_VALUE_STANDING,
  CONTACT_VALUE_STANDING,
];

/** The two questions asked of one piece of text — a value, or a key
 *  naming one. Normalised first, for the reason `normaliseForGates`
 *  gives: an ID card typeset in full-width digits used to pass this
 *  check as readily as it passed the gates. The length ceiling lives on
 *  `allowlist.ts` beside the key list whose premise it states, and is
 *  imported by the write-path schema as well — see `SAFE_VALUE_MAX_LENGTH`
 *  there for why it is not declared in this file. */
const isUntrustworthyText = (text: string): boolean => {
  const trimmed = normaliseForGates(text).trim();
  if (trimmed.length > SAFE_VALUE_MAX_LENGTH) return true;
  return ID_PATTERNS.some((pattern) => pattern.test(trimmed));
};

/**
 * THE EXAMINATION, AND IT IS TOTAL OVER TYPES.
 *
 * IT USED TO OPEN `if (typeof value !== 'string') return false` — a
 * DECLARATION OF TRUSTWORTHINESS FOR EVERYTHING IT DID NOT RECOGNISE,
 * written as though the only alternative to a string were a number. An
 * array and an object are the two shapes that can hold a whole record,
 * and both answered 「trustworthy」 without being looked at. Paired with
 * layer 1 not descending into arrays, that put a `patientName` and an
 * `idCard` inside `fields.d4z4Repeats` into the prompt verbatim — see
 * the invariant at the top of this file, and `hardDelete` for the other
 * half of the walk.
 *
 * WHAT THE TEST MEANS FOR EACH TYPE:
 *
 *   - a string — the length ceiling and the identifier patterns, which
 *     is what this function always was.
 *   - a number, a bigint — the same two questions asked of the printed
 *     form. An ID card number is 18 digits and a barcode 9 or more, and
 *     JSON carries either as a number as readily as a string;
 *     `\b\d{9,}\b` is what catches them. No cell any allowlist here
 *     names is a nine-digit measurement.
 *   - a boolean — trustworthy. Two values, and neither can carry an
 *     identifier.
 *   - null, undefined — trustworthy: there is no value to carry one, and
 *     nothing is published for such a cell in any case.
 *   - an ARRAY — untrustworthy if ANY element is, and trustworthy when
 *     none are. The container is not itself the offence: an array of
 *     short strings is a real shape on this platform (`assistiveDevices`
 *     is one by construction, and the extractor writes a cell as a list
 *     whenever a page prints two of something), so refusing every array
 *     outright would delete clinical content rather than protect it.
 *     What it HOLDS is examined, to the bottom.
 *   - an OBJECT — untrustworthy if any KEY is a hard-delete key or itself
 *     reads as an identifier, or if any VALUE is. The key half is belt
 *     and braces after layer 1 for the publish paths, and it is not
 *     redundant on the profile haplotype gate, which asks this question
 *     about a cell in order to decide whether to READ it.
 *
 *     WHAT IS WALKED IS THE OWN ENUMERABLE ENTRIES, and that is not an
 *     approximation of the object — it is exactly the set `formatScalar`
 *     in render.ts can put in a prompt, because that is what
 *     `JSON.stringify` prints. A `Date` or a `Map` therefore examines as
 *     empty and renders as empty: there is no entry to refuse and no
 *     byte of its state that could have escaped either. A class instance
 *     with own fields IS its fields, and they are examined.
 *   - a FUNCTION or a SYMBOL — untrustworthy. Neither has entries to
 *     walk and neither is a value a laboratory printed, so 「cannot be
 *     examined」 answers 「refuse」 rather than 「pass」.
 *   - a NESTED MIXTURE — objects inside arrays inside objects, examined
 *     to `MAX_NESTING_DEPTH`.
 *   - a CYCLE, or nesting past that depth — untrustworthy, for the same
 *     reason as the line above: a walk that cannot finish has not
 *     examined anything, and a bound that fails open is no bound.
 *
 * WHERE IT IS ASKED, so the invariant is checkable rather than asserted:
 * `publishGeneticCell`, `publishMethylationCell` and
 * `publishDiagnosisTypeCell` — the whole of the shared publish path, so
 * both scopes and every genetics cell — plus the
 * `OCR_FIELDS_SAFE_KEYS_PRECISE` branch of `projectOcrFields`, and BOTH
 * scopes' haplotype gates: the profile scope's in `clinicalise` and the
 * reports scope's in `projectOcrFields`. A gate is a cell being read in
 * order to answer about another cell, so it clears the bar a cell being
 * published clears.
 *
 * AND WHERE IT IS NOT, because the sentence above would otherwise
 * overclaim. The profile scope's non-genetics cells — `familyHistory`,
 * `onsetRegion`, `assistiveDevices`, `gender`, `diagnosisStage`,
 * `independentlyAmbulatory` — travel from the retriever to layer 3
 * untouched by THIS function, and layer 3 is a gate on KEYS. That is
 * not a typeof short-circuit and it is not what this fix was about: it
 * reads identically for a bare string and for an array, and closing it
 * needed a decision about free text the patient typed (`familyHistory`
 * is unbounded by design, so this function's ceiling is not its
 * ceiling) that does not belong to this function.
 *
 * THAT DECISION IS NOW MADE, ONE LAYER DOWN. `scrubKeptValue` (layer 4)
 * walks every string layer 3 kept, on every scope, and takes the
 * identifiers out of it rather than refusing the cell — which is the
 * answer the ceiling could not give: a family history is allowed to be
 * long, and it is not allowed to carry a telephone number. This
 * function still owns the CELL question, and the two share one
 * identifier vocabulary, so a value it would refuse is a value the
 * scrub would have edited; sharing the list is what keeps the two from
 * disagreeing about the same string.
 */
const isUntrustworthyValue = (
  value: unknown,
  depth: number = 0,
  ancestors: Set<object> = new Set<object>(),
): boolean => {
  if (value === null || value === undefined || typeof value === 'boolean') return false;
  if (typeof value === 'string') return isUntrustworthyText(value);
  if (typeof value === 'number' || typeof value === 'bigint') {
    return isUntrustworthyText(String(value));
  }
  if (typeof value !== 'object') return true;
  if (depth >= MAX_NESTING_DEPTH || ancestors.has(value)) return true;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.some((item) => isUntrustworthyValue(item, depth + 1, ancestors));
    }
    if (!isPlainObject(value)) return true;
    return Object.entries(value).some(
      ([key, inner]) =>
        HARD_DELETE_KEYS_LOWER.has(key.toLowerCase()) ||
        isUntrustworthyText(key) ||
        isUntrustworthyValue(inner, depth + 1, ancestors),
    );
  } finally {
    ancestors.delete(value);
  }
};

/**
 * A VALUE THIS PLATFORM CAN PRINT AS A CELL, WHICH IS THE OTHER HALF OF
 * THE QUESTION AND NOT THE SAME ONE.
 *
 * `isUntrustworthyValue` asks whether a value carries something that may
 * not be shown. This asks whether it is a value at all. A container that
 * survives the examination — `['4qA', '4qB']`, `{ probes: ['4qA'] }` —
 * still is not a reading of anything: `formatScalar` joins the first
 * into 「单倍型: 4qA、4qB」 and JSON-stringifies the second, and
 * `pickReading` refuses exactly that coercion everywhere else on this
 * platform, 「there is no sensible coercion, so there is none」. The
 * comment on `clinicaliseHaplotype` already described that line as
 * something the file no longer does, and precise mode was still doing it
 * — the reading beside it said `unspecified_haplotype` while the cell
 * above it asserted a haplotype.
 *
 * So a cell is published as itself only when it IS a scalar, and a
 * container gets what an unreadable cell gets: no raw cell, and this
 * platform's statement beside the space where it would have been.
 * `methylationCell` already took this position in words — 「AND A CELL
 * THAT IS NOT A SCALAR IS NEITHER」 — for the one cell that has no
 * `_clinical` sibling; this is the same rule for the cells that do.
 *
 * THIS IS THE CATEGORY CELL'S VERSION OF THE QUESTION, and a boolean
 * passes it because `isQualitativeResult` has always counted one as a
 * result the strict mode may keep. The SIZE cells ask a stricter one:
 * `publishGeneticCell` prints a cell only where `readGeneticCell`
 * returned text, so a `d4z4Repeats` holding `true` is withheld rather
 * than rendered by `formatScalar` as 「是」 under a reading that says the
 * cell could not be read. Same reason as the container, one type
 * further in — and a non-finite number is refused by both, for the same
 * reason again.
 */
const isScalarCell = (value: unknown): boolean =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

/**
 * A KEY MINTED FROM WHATEVER THE TABLE HAPPENED TO PRINT, AND THEREFORE
 * NOT A CELL ANY READER HERE MAY CLAIM.
 *
 * `_append_generic_table_fields` in the report parser slugs the printed
 * analyte name of every table row no type-specific extractor claimed and
 * emits it as `table_<slug>`. Its docstring states what that buys:
 * 「They are deliberately NOT canonical keys: the API's prompt allowlist
 * is deny-by-default, so these reach the patient's own report screen but
 * not a model prompt until someone reviews the name.」
 *
 * DENY-BY-DEFAULT WAS NOT WHAT THEY MET. The genetics readers below are
 * dispatched on the SUBSTRINGS 「d4z4」/「ecori」/「methylation」/
 * 「haplotype」, and a slug is arbitrary printed text, so a row printed
 *「D4Z4 甲基化 %」 minted `table_d4z4_methylation_pct` — which contains
 * 「d4z4」, is tested for it BEFORE 「methylation」, and so bought a
 * methylation percentage a reading on the FSHD1 repeat-count boundary,
 * plus the raw value beside it under precise consent. The substring
 * dispatch is right for a reviewed key, whose name somebody chose; it
 * cannot be right for a name the printer chose.
 *
 * So a generic table key is excluded from every branch and falls to
 * deny-by-default, which is the guarantee the parser's docstring already
 * describes. Reviewing such a name means adding it to
 * `OCR_FIELDS_SAFE_KEYS_PRECISE` or to the passport's own key tables —
 * both of which are diffs a human reads.
 *
 * MATCHED ON THE SNAKE FORM OF THE KEY, because the bridge in
 * services/ocr/embedded-report-ocr.ts writes every structured field
 * under both spellings (`fields[fieldName]` and
 * `fields[toCamelCase(fieldName)]`), and the alias collapse below
 * DELETES the snake half and keeps the camel one — so
 * `tableD4z4MethylationPct` is the spelling that actually reaches the
 * dispatch. `toSnake` maps both spellings onto the parser's own prefix.
 */
const isGenericTableKey = (key: string): boolean => toSnake(key).startsWith('table_');

/**
 * WHICH GENETICS READER A KEY IS DISPATCHED TO — asked in one place,
 * because two places asking it is how the gate below came apart from
 * the loop it gates.
 *
 * The order is load-bearing and is the loop's own: a row printed
 * 「D4Z4 甲基化 %」 is a d4z4 key before it is a methylation one, which
 * is the precedence `isGenericTableKey` was written about. A generic
 * table key answers `null` here for that function's stated reason — a
 * name the printer chose may not buy a clinical band, and it may not
 * buy a vote on one either.
 *
 * THE HAPLOTYPE GATE WALKS THIS, NOT A KEY TABLE. `projectOcrFields`
 * used to find the gating cell with `pickReading` over
 * `GENETIC_FIELD_KEYS.haplotype` — three spellings — while the loop
 * beside it minted a haplotype reading for EVERY key containing
 * 「haplotype」. Executed on a blob whose cell was spelled
 * `haplotypeAllele: '4qB'`, one projection carried
 * `haplotypeAllele_clinical: non_permissive_haplotype` and
 * `d4z4Repeats_clinical: within_fshd1_repeat_range_grey_zone_8_to_10`
 * together, in both modes — the 8–10 note whose own docstring says it
 * is 「a paragraph about the other allele」 over a report naming 4qB,
 * printed directly beneath this platform's own statement that the
 * report names 4qB. `clinicaliseEcoRIFragment` already records what
 * that costs: naming a subset of the spellings 「is how this cell came
 * to be handled under some of its names and none of the others」. The
 * substring is the class, so the gate reads the class.
 */
type GeneticCellBranch = 'd4z4' | 'ecori' | 'methylation' | 'haplotype';

const geneticBranchFor = (key: string): GeneticCellBranch | null => {
  if (isGenericTableKey(key)) return null;
  const lower = key.toLowerCase();
  if (lower.includes('d4z4')) return 'd4z4';
  if (lower.includes('ecori')) return 'ecori';
  if (lower.includes('methylation')) return 'methylation';
  if (lower.includes('haplotype')) return 'haplotype';
  return null;
};

// ------------------------------------------------- the shared publish path

/**
 * ONE PUBLISH PATH FOR A GENETICS CELL, WHICHEVER SCOPE IT SITS ON.
 *
 * All three of these lived inside `projectOcrFields` — one as a
 * closure, two written out in the dispatch loop — which meant every
 * guard they enforce was a guard the REPORTS scope had and the profile
 * scope did not. The profile branch of `clinicalise` open-coded the same
 * four cells and called `isUntrustworthyValue` on none of them, so out
 * of one request the production ECG dump —「…年龄:23 … 科别:神经内科 …
 * 住院号:R000000 …」— was dropped under `fields.d4z4Repeats` and
 * published verbatim under `diseaseBackground.d4z4`, `.haplotype` and
 * `.diagnosisType`. Both of those cells have live writers: the
 * registration form, and `patchDocumentOcrFields` feeding
 * `applyGeneticReportAutofill`.
 *
 * So the guards live here, once, and a scope supplies only what
 * genuinely differs between the two: where a published statement goes,
 * whether the raw cell is already on the projection and has to be
 * deleted rather than simply not added, and what the scope is able to
 * say when a measurement is withheld.
 */
interface GeneticCellSink {
  /** A statement this platform is making — the cell's own text, this
   *  platform's reading of it, or where it came from. */
  publish(key: string, value: unknown): void;
  /** The cell's own text does not reach the prompt. A no-op on a scope
   *  that builds its output from scratch; a deletion on one where the
   *  raw cell is already on the projection. */
  withholdRaw(key: string): void;
  /** ...and the scope's way of saying that a value is on file and is not
   *  being shared. Returns whether the scope actually managed to say it:
   *  layer 3 passes literal keys, so a scope can only make this
   *  statement about a cell that has one on `PROMPT_ALLOWLIST`. */
  stateWithheld(key: string): boolean;
  /** The cell failed `isUntrustworthyValue`. Nothing about it goes out —
   *  not the text, not a reading, not an origin, not a withheld
   *  statement. There is no cell, so there is nothing to say. */
  refuse(key: string): void;
}

/**
 * A GENETICS CELL AND THIS PLATFORM'S READING OF IT, PUBLISHED TOGETHER
 * OR NOT AT ALL.
 *
 * The cell as it was recorded goes first — precise mode only — so the
 * two read in that order; the reading follows in both modes.
 *
 * THE INVARIANT IS ENFORCED HERE RATHER THAN REMEMBERED PER CALL SITE.
 * Each branch used to emit the raw cell and then, quite separately,
 * write a `_clinical` sibling if one came back — two statements with
 * nothing tying them together, and one reader returning `null` was all
 * it took to break the pairing: a haplotype cell holding an array
 * published 「4qA、4qB」 under precise consent with no reading of any kind
 * beside it. A raw genetics cell never reaches a prompt without this
 * platform's reading of it, and now it structurally cannot — on either
 * scope, because there is only one function left that can publish one.
 *
 * AND THE CELL IS CHECKED AS A VALUE, NOT ONLY AS A KEY — the same check
 * `OCR_FIELDS_SAFE_KEYS_PRECISE` values get, applied here because these
 * keys skip that branch entirely, and applied on the profile scope
 * because that scope has no such branch at all. The identical production
 * string plus a patient's NAME was dropped under `ecgSummary` and
 * published verbatim under `d4z4Repeats`, `haplotype` or
 * `methylationValue`. The name is inside the cell rather than under
 * `patientName`, so layer 1 does not see it either.
 *
 * THE GUARD IS ASKED FIRST, AND A REFUSED CELL IS NOT READ.
 *
 * It used to run the reader and then let the raw-publish step ask — so
 * the reading was minted from a string this platform had already decided
 * it would not show. An inpatient record number pasted into `d4z4Repeats`
 * went through `readSizeCell`, THE DIGITS OF THE RECORD NUMBER became
 * the repeat count, and the model was told 「above_fshd1_repeat_range」 —
 * the label whose whole documented meaning is that the guideline is
 * sending this reader off to evaluate FSHD2.
 *
 * The reader is passed as a thunk rather than called at the call site so
 * that ordering is structural rather than remembered: an argument is
 * evaluated before the guard sees it, and this is the defect that came
 * of exactly that.
 */
const publishGeneticCell = (
  sink: GeneticCellSink,
  key: string,
  value: unknown,
  mode: RedactionMode,
  read: () => string | null,
): void => {
  if (isUntrustworthyValue(value)) {
    sink.refuse(key);
    return;
  }
  const clinical = read();
  if (clinical === null) {
    // No reading, so no cell: the pairing above is symmetric, and a raw
    // cell already sitting on the projection has to be deleted for it to
    // hold rather than merely not added.
    sink.withholdRaw(key);
    return;
  }
  // A CELL IS PRINTED ONLY WHERE THIS PLATFORM COULD READ IT AS ONE, and
  // that is `readGeneticCell`'s question rather than a second answer to
  // it. Precise consent buys the value the laboratory printed, not
  // `formatScalar`'s join of a list, its JSON dump of an object or its
  //「是」 for a boolean — each of which used to be printed as this
  // patient's haplotype or repeat count with the `_clinical` sibling
  // directly beneath saying the cell could not be read. See
  // `isScalarCell` for the same rule at the category cell's width. The
  // reading is published either way, so a withheld container leaves the
  // model told the cell exists rather than told there is none.
  if (mode === 'precise' && readGeneticCell(value).kind === 'text') {
    sink.publish(key, value);
  } else {
    sink.withholdRaw(key);
  }
  sink.publish(`${key}_clinical`, clinical);
};

/**
 * THE METHYLATION CELL — the one genetics cell that mints no `_clinical`
 * sibling, and the one that used to be written out by hand on both
 * scopes because of it.
 *
 * `methylationCell` decides what happens to the number; what happens
 * AROUND the number is the same discipline every other cell gets, and
 * neither hand-written copy had all of it. The reports copy asked
 * `isUntrustworthyValue` about the raw cell only, and the profile copy
 * asked it not at all — so a refused cell still produced both of the
 * statements this function makes beside it:
 *
 *   - `${key}_origin`, which asserts that a methylation result exists
 *     and says where it came from, about a cell the same projection then
 *     declines to publish. Its siblings print NOTHING for the identical
 *     string, so the prompt carried a provenance line for the FSHD2
 *     discriminator with no value, no reading and no refusal near it.
 *   - the withheld statement, which is the CONSENT channel:「there is a
 *     measurement here and the patient did not share the number」. A
 *     refusal to read a cell is not a redaction, and the two modes
 *     therefore gave one cell two different accounts — precise called it
 *     `fieldsDroppedAsUnsafe`, strict called it a real methylation
 *     number consent was hiding.
 *
 * The live case is the one `EDITABLE_OCR_FIELDS` opens: `methylationValue`
 * is on it, `ocrFieldsPatchSchema` accepts any string up to
 * `SAFE_VALUE_MAX_LENGTH`, and a patient hand-correcting 甲基化 pasted
 * an inpatient record number —「住院号:R000000」, the same string this
 * file already refuses on `d4z4Repeats`.
 *
 * THE ORIGIN FOLLOWS THE CELL. It is a sentence about something the
 * prompt carries, so it is written only when the prompt carries either
 * the value or a statement that a value is being withheld. Where the
 * scope can say neither, an origin would be provenance for nothing.
 */
const publishMethylationCell = (
  sink: GeneticCellSink,
  key: string,
  value: unknown,
  mode: RedactionMode,
  fromLaboratoryReport: boolean,
): void => {
  if (isUntrustworthyValue(value)) {
    sink.refuse(key);
    return;
  }
  const survives = methylationCell(value, mode, fromLaboratoryReport);
  if (survives === null) return;
  let stated: boolean;
  if (survives.value === 'raw') {
    sink.publish(key, value);
    stated = true;
  } else {
    sink.withholdRaw(key);
    stated = sink.stateWithheld(key);
  }
  if (stated && survives.origin !== null) sink.publish(`${key}_origin`, survives.origin);
};

/**
 * THE CELL THAT NAMES THE DIAGNOSIS, ON EITHER SCOPE.
 *
 * IT WAS THE SAME VALUE WITH TWO ANSWERS. `applyGeneticReportAutofill`
 * copies the picked report's subtype verbatim into
 * `diseaseBackground.diagnosisType`, so one string reaches the reports
 * scope off the OCR blob and the profile scope off the baseline. The
 * reports scope asked `isCategoryLabel` about it and strict mode
 * therefore withheld 「FSHD1(D4Z4 3拷贝)」 — a subtype with a repeat count
 * stapled to it, and that count is exactly what the precise consent
 * buys. The profile scope asked nothing at all: `diagnosisType` sits on
 * the profile strict allowlist under the justification 「category label
 * like FSHD1 is non-PII」, which is a claim about `FSHD1` and was applied
 * to whatever the cell held. So the count the reports scope withheld was
 * printed one section above it, out of the same report, in the same
 * prompt.
 *
 * `isCategoryLabel` exists precisely because that premise breaks — its
 * own note names this value — and it was consulted on one scope.
 *
 * THE ORIGIN FOLLOWS THE CELL, for the reason given on
 * `publishMethylationCell`: it is a sentence about something the prompt
 * carries.
 */
const publishDiagnosisTypeCell = (
  sink: GeneticCellSink,
  key: string,
  value: unknown,
  mode: RedactionMode,
  fromLaboratoryReport: boolean,
): void => {
  if (value === null || value === undefined || value === '') return;
  // A safe key is not a safe value, asked here because these keys skip
  // the safe-key branch entirely and the profile scope has none.
  if (isUntrustworthyValue(value)) {
    sink.refuse(key);
    return;
  }
  let stated: boolean;
  // The cell itself, on exactly the terms the reports scope already had:
  // precise consent buys it whole, and strict keeps a single-token
  // classification because 「FSHD1」 is a category label rather than a
  // measurement. That is a PII decision and it stands; what changed is
  // that both scopes now make it.
  //
  // AND IT HAS TO BE A CELL BEFORE IT CAN BE A CATEGORY LABEL. Both
  // strict tests already require a string, so only precise mode ever
  // published a container here — as `formatScalar`'s join or JSON dump,
  // asserted as this patient's 分型. See `isScalarCell`.
  if (
    isScalarCell(value) &&
    (mode === 'precise' || isQualitativeResult(value) || isCategoryLabel(key, value))
  ) {
    sink.publish(key, value);
    stated = true;
  } else {
    sink.withholdRaw(key);
    stated = sink.stateWithheld(key);
  }
  if (stated && !fromLaboratoryReport) sink.publish(`${key}_origin`, NOT_A_LABORATORY_READING);
};

/**
 * IS THE DOCUMENT THIS CHUNK PROJECTS THE GENETICS LABORATORY'S OWN
 * REPORT — the passport's question, asked rather than answered a second
 * time here. `isLaboratoryGeneticReport` reads a document's own
 * classification off its OCR payload and falls back to the type its
 * uploader declared, and both of those are on this projection: the
 * parser writes `classifiedType` into the blob, and the retriever puts
 * `documentType` beside it.
 *
 * AND THE DOCUMENT'S OWN PAGE, WHICH THIS PATH USED TO BE THE ONE
 * WITHOUT. `isLaboratoryGeneticReport` closes on the uploader's
 * declared type only where the page shows NEITHER a clinical narrative
 * nor a laboratory's structure — and with no page on the projection
 * that was every archived row, so an archived 病历摘要 whose uploader
 * ALSO picked 基因检测报告 from the menu was believed here and refused
 * on every other surface. Its own note said so: 「the gap closes the
 * moment the retriever's projection carries the OCR text; nothing here
 * has to change for that」. `buildReportFields` carries it now, under
 * `extractedText`, and this is where it is read.
 *
 * THE TEXT IS READ AND NOT PUBLISHED. It is on `HARD_DELETE_KEYS`, so
 * layer 1 deletes it in both modes at any depth — which is why this
 * question is asked of `redactFields`'s INPUT rather than of the
 * working map, and why the answer is computed once and carried. A page
 * that reached the prompt would be the OCR full-text dump, names and
 * all.
 *
 * The two members of that shape this projection has no value for are
 * the row's id and its upload time. Neither is read by the question —
 * they are `pickGeneticEvidenceDocument`'s ordering keys, and no pick
 * is being made here: the retriever hands over one document per chunk
 * and this is that one.
 */
const chunkDocument = (chunk: Record<string, unknown>): GeneticEvidenceDocumentLike => ({
  ocrPayload: {
    fields: chunk.fields,
    extractedText: typeof chunk.extractedText === 'string' ? chunk.extractedText : null,
  },
  documentType: typeof chunk.documentType === 'string' ? chunk.documentType : null,
  status: typeof chunk.status === 'string' ? chunk.status : null,
  // Required by the shape, read by nothing on this path.
  id: '',
  uploadedAt: null,
});

const chunkIsLaboratoryGeneticReport = (chunk: Record<string, unknown>): boolean =>
  isLaboratoryGeneticReport(chunkDocument(chunk));

/** Project an OCR fields blob through a mode-specific filter.
 *
 *  In **both** modes this is deny-by-default: only keys we know how to
 *  scrub (d4z4 / methylation / haplotype / date), or that are on
 *  `OCR_FIELDS_SAFE_KEYS_PRECISE`, pass through. Free-form OCR keys —
 *  including `findings`, `impression`, unknown vendor-specific fields,
 *  anything the OCR happened to extract that we haven't reviewed — are
 *  dropped. A key the parser minted from a printed analyte name is
 *  unreviewed by construction and is dropped before the dispatch, so the
 *  substrings above cannot be bought by accident — see
 *  `isGenericTableKey`.
 *
 *  What the two modes differ on is *values*, not keys. Precise emits
 *  the measurement; strict emits qualitative results verbatim and
 *  replaces the measurements with a `numericValuesWithheld` count. The
 *  safe-key list is shared because a key being safe to name has never
 *  depended on consent — only the number beside it does.
 *
 *  THE GENETICS CELLS CARRY THEIR READING IN BOTH MODES, for the same
 *  reason: what this platform makes of a cell does not depend on
 *  consent either. Precise mode adds the raw cell to the reading
 *  rather than replacing the reading with it. See `clinicaliseD4Z4`.
 *
 *  This is the fix for the PR #23 follow-up review: precise mode used
 *  to accept the entire raw `fields` blob via the allowlist, leaking
 *  whatever the OCR pipeline happened to put in there.
 */
const projectOcrFields = (
  rawFields: Record<string, unknown>,
  mode: RedactionMode,
  fromLaboratoryReport: boolean,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  // Counted, not listed. The model needs to know that measurements
  // exist and are withheld — otherwise it reports the report as
  // unreadable — but naming which analytes were measured is itself a
  // disclosure the patient did not opt into.
  let withheldNumeric = 0;
  /** Safe keys whose *value* failed the content check. Logged by the
   *  caller so a regression in the extractor is visible rather than
   *  silently absorbed here. */
  const droppedUntrusted: string[] = [];

  // The extractor writes every lab field twice — `stoolColor` and
  // `stool_color`, `trustAb` and `trust_ab` — and both spellings are on
  // the safe-key list, so the prompt carried each analyte twice. That
  // is not just waste: the model reads the second spelling as a
  // separate test and reports it as one. Observed verbatim, a syphilis
  // screen with two analytes was summarised as three, the third being
  //「trust_ab：阴性」.
  //
  // Snake_case yields to camelCase when both are present and agree.
  // When they disagree, both stay — a silent pick between two different
  // values would be the redactor editing clinical data.
  const camelKeys = new Map<string, unknown>();
  for (const [key, value] of Object.entries(rawFields)) {
    if (!key.includes('_')) camelKeys.set(key, value);
  }

  /** Snake_case yields to camelCase when both are present and agree —
   *  as a predicate rather than a condition written out twice, because
   *  the gate below and the loop below it have to skip the same cells
   *  for the gate to be a reading of what the loop publishes. */
  const collapsesToCamelAlias = (key: string, value: unknown): boolean =>
    key.includes('_') && camelKeys.has(toCamel(key)) && camelKeys.get(toCamel(key)) === value;

  // THE HAPLOTYPE THE SAME REPORT STATES, read once for the whole blob,
  // because the D4Z4 grey-zone note is about a 4qA array and this is
  // how the passport gates it. See `WITHIN_FSHD1_REPEAT_RANGE_GREY_ZONE`.
  //
  // READ OFF THE CELLS THIS LOOP ITSELF CALLS HAPLOTYPE CELLS, on the
  // same dispatch (`geneticBranchFor`) and behind the same two guards
  // `publishGeneticCell` puts in front of every reader, in the same
  // order. It used to be `pickReading` over a three-spelling key table
  // while the loop matched the substring, and the two disagreeing is
  // measured in `geneticBranchFor`'s note: one projection asserting
  // 4qB and applying the 4qA grey-zone note to the count in the same
  // breath.
  //
  // UNANIMITY OR NOTHING, which is `parsePermissiveHaplotype`'s own
  // rule one cell wider: that function answers `null` for a single
  // cell naming both alleles, and two cells naming one allele each are
  // the same fact spread over two keys. A cell that states no allele
  // does not vote — it has not disagreed with anything.
  //
  // AND A CELL THIS PLATFORM WOULD NOT SHOW CANNOT GATE ANYTHING — the
  // same rule, and the same `isUntrustworthyValue`, that the profile
  // scope's copy of this gate states in `clinicalise` and that
  // `publishGeneticCell` enforces before any reader runs. Executed on
  // one blob whose 单倍型 cell held a hand-correction paste — 「4q单倍
  // 型:4qB 姓名:张三 科别:神经内科 住院号:R000000」, the live case
  // `publishMethylationCell` already names — the loop below REFUSED
  // that cell (no `haplotype`, no `haplotype_clinical`,
  // `fieldsDroppedAsUnsafe: 1`) while this gate, before it asked,
  // read 4qB off the very same string and banded a count of 9 as
  // `repeat_count_not_read_against_fshd1_range_non_permissive_haplotype`
  // — a refusal whose documented content is 「the report this count came
  // off states 4qB」 published with no 4qB anywhere on the block to refer
  // to, over a run prompt that tells the model to answer 「我的单倍型是不
  // 是允许型」 straight off these fields. The profile scope, handed the
  // identical cell in the identical run, said
  // `within_fshd1_repeat_range_grey_zone_8_to_10`.
  //
  // WHAT THESE GUARDS DO NOT CURE, stated here so the paragraph above
  // is not read as covering it: `parsePermissiveHaplotype` matches
  // 4qA / 4qB as bare substrings, so a 检测方法/说明 block pasted into
  // the 单倍型 box whose only 4qB is the boilerplate 「4qB 型等位基因不具
  // 有致病性」 still reads `false` — it is short, it carries no
  // identifier, and nothing here has grounds to refuse it. Executed, it
  // bands a count of 9 as
  // `repeat_count_not_read_against_fshd1_range_non_permissive_haplotype`.
  // That is the passport reader's reading of a cell and it is the same
  // reading `clinicaliseHaplotype` publishes beside it, so this
  // projection is at least saying one thing; making it the RIGHT thing
  // is a change to `parsePermissiveHaplotype` in
  // patient-profile/profile.passport.ts, not to this gate.
  //
  // `null`, not `false`, for a refused cell: 「unknown」 is what this
  // platform has, and `!== false` keeps the grey-zone note, the only
  // direction that adds uncertainty rather than removing it.
  let haplotypePermissive: boolean | null = null;
  let haplotypeCellsDisagree = false;
  for (const [key, value] of Object.entries(rawFields)) {
    if (collapsesToCamelAlias(key, value)) continue;
    if (geneticBranchFor(key) !== 'haplotype') continue;
    // THE GUARD IS ASKED FIRST, AND A REFUSED CELL IS NOT READ — the
    // sentence `publishGeneticCell` is written under, applied here
    // because deciding another cell's reading IS reading this one. The
    // live case is the hand-correction paste 「4q单倍型:4qB 姓名:张三 科
    // 别:神经内科 住院号:R000000」, which the loop below refuses to
    // publish, refuses to read, and counts into `fieldsDroppedAsUnsafe`.
    if (isUntrustworthyValue(value)) continue;
    // ...AND A CONTAINER IS NOT A READING, which is `readGeneticCell`'s
    // question and the reason `['4qA', '4qB']` gets
    // `unspecified_haplotype` rather than a joined string. A cell this
    // platform prints no allele for states no allele to gate on.
    const cell = readGeneticCell(value);
    if (cell.kind !== 'text') continue;
    const stated = parsePermissiveHaplotype(cell.text);
    if (stated === null) continue;
    if (haplotypePermissive === null) haplotypePermissive = stated;
    else if (haplotypePermissive !== stated) haplotypeCellsDisagree = true;
  }
  if (haplotypeCellsDisagree) haplotypePermissive = null;

  /**
   * This scope's half of the shared publish path. The blob is built from
   * scratch here, so a withheld cell is one that is never added rather
   * than one that has to be deleted, and the withheld statement is the
   * count every other withheld measurement on this blob goes into.
   */
  const sink: GeneticCellSink = {
    publish: (publishKey, publishValue) => {
      out[publishKey] = publishValue;
    },
    withholdRaw: () => {},
    stateWithheld: () => {
      withheldNumeric += 1;
      return true;
    },
    refuse: (refusedKey) => {
      droppedUntrusted.push(refusedKey);
    },
  };

  for (const [key, value] of Object.entries(rawFields)) {
    if (collapsesToCamelAlias(key, value)) continue;
    // A name the printer chose is not a reviewed key, so it may not buy
    // a clinical band by containing a substring. Deny-by-default, which
    // is what the parser's own docstring promises about it. See
    // `isGenericTableKey`. Asked here as well as inside
    // `geneticBranchFor` because it also has to keep such a key out of
    // the safe-key branch at the bottom.
    if (isGenericTableKey(key)) continue;
    const lower = key.toLowerCase();
    // The one dispatch, shared with the haplotype gate above so that a
    // cell gating a reading and a cell getting one are the same set.
    const branch = geneticBranchFor(key);
    if (branch === 'd4z4') {
      // 「other」 is how every spelling of the uncontracted allele's cell
      // names itself, and it has to be asked before the band. See
      // `clinicaliseOtherD4Z4Allele`.
      publishGeneticCell(sink, key, value, mode, () =>
        lower.includes('other')
          ? clinicaliseOtherD4Z4Allele(value, fromLaboratoryReport)
          : clinicaliseD4Z4(value, fromLaboratoryReport, haplotypePermissive),
      );
    } else if (branch === 'ecori') {
      // The other size cell. See `clinicaliseEcoRIFragment` for why it
      // is read by its own reader and not by the one above.
      publishGeneticCell(sink, key, value, mode, () =>
        clinicaliseEcoRIFragment(value, fromLaboratoryReport),
      );
    } else if (branch === 'methylation') {
      // No reading, in either mode — see `methylationCell`. The word
      // survives as the cell it is; the measurement is counted with
      // every other withheld measurement rather than relabelled. What it
      // carries beside itself in both modes is where the value came
      // from: this cell sits beside siblings that state the refusal, and
      // a 病历摘要's quoted percentage used to sit there stating nothing.
      // The guard order and the origin rule are the shared path's — see
      // `publishMethylationCell`.
      publishMethylationCell(sink, key, value, mode, fromLaboratoryReport);
    } else if (branch === 'haplotype') {
      publishGeneticCell(sink, key, value, mode, () =>
        clinicaliseHaplotype(value, fromLaboratoryReport),
      );
    } else if (GENETIC_TYPE_KEYS_LOWER.has(lower)) {
      // THE CELL THAT NAMES THE DIAGNOSIS — see `GENETIC_TYPE_KEYS_LOWER`
      // for why it is dispatched off the passport's own key table and
      // not off a substring, and `publishDiagnosisTypeCell` for what is
      // published about it.
      publishDiagnosisTypeCell(sink, key, value, mode, fromLaboratoryReport);
    } else if (lower.includes('date')) {
      // Both modes: strip to year-only. Even in precise mode we don't
      // want the exact day-of-month leaving the server.
      const y = yearFromDate(value);
      if (y !== null) out[`${key}_year`] = y;
    } else if (OCR_FIELDS_SAFE_KEYS_PRECISE.has(key)) {
      if (value === null || value === undefined || value === '') continue;
      // A safe key is not a safe value — see isUntrustworthyValue. The
      // check is asked once, here, so the strict branch below cannot
      // publish what the precise branch refused. It is total over types:
      // a list cell is examined element by element rather than declared
      // trustworthy for not being a string, which is how a 住院号 pasted
      // into `ecgSummary` used to reach the prompt as soon as the
      // extractor wrapped it in an array.
      if (isUntrustworthyValue(value)) {
        droppedUntrusted.push(key);
        continue;
      }
      if (mode === 'precise') {
        out[key] = value;
      } else if (isQualitativeResult(value) || isCategoryLabel(key, value)) {
        // Strict mode keeps qualitative results.
        //
        // The consent step the patient did not take is「精确数值」— the
        // exact numbers. 阴性 / 阳性 / 黄色 / 软 are not numbers; they
        // are the test's own conclusion, and they identify nobody.
        //
        // Withholding them was not a privacy decision, it was a gap:
        // the strict branch here was written for the genetic fields
        // (d4z4 / methylation / haplotype) and never extended when the
        // safe-key list grew to ~90 lab keys. So every ordinary panel —
        // stool, syphilis screen, coagulation — projected to `{}`, and
        // the report summariser, handed an empty object, wrote
        //「这是一份血液检测报告，但未提取到具体检测数据」about a stool
        // report holding eight extracted values. Wrong on the data and
        // wrong on the report type, because even `classifiedType` was
        // gone.
        out[key] = value;
      } else {
        withheldNumeric += 1;
      }
    }
    // else: deny-by-default. Free-form / unknown OCR keys never make
    // it into the prompt regardless of mode.
  }
  if (withheldNumeric > 0) {
    out.numericValuesWithheld = withheldNumeric;
  }
  if (droppedUntrusted.length > 0) {
    // Named, not silent: the model should say「这份报告的这几项读不出来」
    // rather than answer as though the fields did not exist.
    out.fieldsDroppedAsUnsafe = droppedUntrusted.length;
  }
  return out;
};

/**
 * For each known-sensitive raw key, compute this platform's reading of
 * it. Unknown keys fall through untouched here (the allowlist layer is
 * the final gate).
 *
 * WHAT THE MODE DECIDES IS WHETHER THE RAW CELL STAYS, and nothing
 * else. It used to decide whether this function was called at all,
 * which made every refusal below a thing only the patients who shared
 * least were told — see the layer 2 note at the top of this file.
 */
const clinicalise = (
  input: Record<string, unknown>,
  scope: RedactionScope,
  mode: RedactionMode,
): ClinicaliseResult => {
  const added: Record<string, unknown> = {};
  const drop = new Set<string>();
  const changed: string[] = [];

  if (scope === 'profile') {
    // WHERE THIS SCOPE'S GENETICS CELLS CAME FROM, ASKED RATHER THAN
    // ASSUMED.
    //
    // Both calls below used to pass a hardcoded `false`, on the stated
    // ground that `baseline.diseaseBackground` is the registration
    // form's own box. That is where the cell SITS, and it is not where
    // the value came from: `applyGeneticReportAutofill` copies a parsed
    // genetics report's values into those same empty boxes at read
    // time. So the prompt asserted `not_read_off_a_laboratory_report`
    // about cells whose provenance the passport was resolving to
    // `kind: 'report'` / 「报告读取」 in the same run, and whose TREAT-NMD
    // provenance sentence ends 「所以这个值是基因报告的解析结果」 — one
    // profile, two answers, and the assistant's was the one that
    // generates advice.
    //
    // The answer is now carried on the projection by the retriever,
    // which asks `readGeneticEvidence` — the passport's and the
    // exports' own reader. See `geneticCellsFromLaboratoryReport` in
    // retrievers/patient-profile.ts. A projection that carries no flag
    // (an older caller, a hand-built fixture) still reads as `false`,
    // which is the refusal this branch used to hardcode.
    //
    // Both flags are dropped unconditionally: they are how this
    // function was told what to say, never something to say. Dropping
    // them here rather than letting layer 3 do it keeps them off the
    // 「dropped fields not in PROMPT_ALLOWLIST」 warning, which is for
    // fields somebody meant to ship.
    const fromLaboratory = (key: string): boolean => input[key] === true;
    drop.add('d4z4FromLaboratoryReport');
    drop.add('haplotypeFromLaboratoryReport');
    // The methylation cell asks the same question as its siblings, and
    // the retriever ANSWERS it now. It did not: this comment used to
    // record that `geneticCellsFromLaboratoryReport` computed the flag
    // for `d4z4` and `haplotype` only, so the cell always read
    // `not_read_off_a_laboratory_report` — a negative asserted about a
    // value the same request attributed to the laboratory report on
    // five other surfaces, printed INSIDE the same profile block as two
    // sibling readings that can only be minted when the flag is true.
    // One document, two answers, in one prompt.
    drop.add('methylationFromLaboratoryReport');
    // Same for the cell that names the diagnosis. It is autofilled off
    // the picked report by `applyGeneticReportAutofill` exactly as the
    // other three are, so a 病历摘要's quoted 「FSHD1」 lands in the same
    // box a laboratory's does.
    drop.add('diagnosisTypeFromLaboratoryReport');
    /**
     * THIS SCOPE'S HALF OF THE SHARED PUBLISH PATH.
     *
     * The raw cells are ALREADY on the projection here — the retriever
     * wrote them and layer 3 will keep whichever the allowlist names —
     * so withholding one is a deletion rather than a decision not to
     * add it, and that is the whole of what differs from the reports
     * scope. Everything else the three publishers do is the same code.
     *
     * `changed` is the audit list of cells this pass ACTED ON. A key
     * that is already on the input is the cell itself being republished
     * untouched — a laboratory's own qualitative methylation word, say —
     * which is not an action; a key that is not is one this pass minted,
     * and it is recorded against the cell it is about.
     */
    const noteCell = (key: string): void => {
      const cell = key.replace(/_(clinical|origin|withheld)$/, '');
      if (!changed.includes(cell)) changed.push(cell);
    };
    const sink: GeneticCellSink = {
      publish: (publishKey, publishValue) => {
        added[publishKey] = publishValue;
        if (!(publishKey in input)) noteCell(publishKey);
      },
      withholdRaw: (rawKey) => {
        drop.add(rawKey);
        noteCell(rawKey);
      },
      /**
       * Only the cells on `PROFILE_WITHHELD_KEYS` can be said, and the
       * return value is which — see that table for why it is a table.
       *
       * SO A WITHHELD `diagnosisType` IS DROPPED WITHOUT A WORD. It is
       * reachable — 「FSHD1(D4Z4 3拷贝)」 is a subtype with a repeat count
       * stapled to it and strict mode withholds it on both scopes now —
       * and this scope has nothing to say about it, where the reports
       * scope has `numericValuesWithheld`. Saying it needs a
       * `diagnosisType_withheld` key on the profile allowlist, a label
       * in `PROFILE_FIELD_LABELS`, and a fixture in
       * tools/tool-descriptions.test.ts that makes it reachable; two of
       * those three are outside this module. Until then the cell is
       * silently absent rather than published with its count, which is
       * the safe direction and not a complete one.
       */
      stateWithheld: (cellKey) => {
        const withheldKey = PROFILE_WITHHELD_KEYS[cellKey];
        if (withheldKey === undefined) return false;
        added[withheldKey] = 'value_withheld';
        noteCell(cellKey);
        return true;
      },
      refuse: (refusedKey) => {
        drop.add(refusedKey);
        noteCell(refusedKey);
      },
    };
    /**
     * THE HAPLOTYPE THIS PROFILE RECORDS, READ ONLY WHERE IT IS THIS
     * PLATFORM'S TO READ.
     *
     * It gates the D4Z4 reading — `permissiveHaplotype !== false` is the
     * passport's own gate, and a 4qB allele is why
     * `REPEAT_COUNT_ON_NON_PERMISSIVE_HAPLOTYPE` exists. It used to be
     * parsed off `input.haplotype` unconditionally, with no reference to
     * `haplotypeFromLaboratoryReport` at all.
     *
     * THE FOUR CELLS ON THIS SCOPE CARRY INDEPENDENT ORIGINS.
     * `geneticCellsFromLaboratoryReport` compares each archived cell
     * against the picked report's own line, so a profile whose D4Z4 came
     * off the laboratory's report and whose 单倍型 was typed into the
     * registration form is the ordinary case, not a corner. In it, a
     * TRANSCRIBED 「4qB」 was deciding how a laboratory-read count was
     * banded: a count of 9 came out
     * `repeat_count_not_read_against_fshd1_range_non_permissive_haplotype`
     * three lines above `haplotype_clinical:
     * not_read_off_a_laboratory_report` — one block refusing to read the
     * cell and, off the same cell, refusing to read the count. The
     * non-permissive verdict 「is minted from a record the passport
     * brands laboratory_report and from nothing else, precisely because
     * a transcription can carry a haplotype as readily as a repeat
     * count」 (`clinicaliseHaplotype`); a gate is that verdict applied to
     * a second cell, so it is minted from nothing else either.
     *
     * AND A CELL THIS PLATFORM WOULD NOT SHOW CANNOT GATE ANYTHING —
     * `isUntrustworthyValue` for the same reason the publishers ask it
     * before their readers run.
     *
     * `null` where the gate has no laboratory haplotype to read, which
     * is 「unknown」: `!== false` keeps the grey-zone note, the direction
     * that only ever adds uncertainty.
     */
    const haplotypePermissive =
      fromLaboratory('haplotypeFromLaboratoryReport') && !isUntrustworthyValue(input.haplotype)
        ? parsePermissiveHaplotype(typeof input.haplotype === 'string' ? input.haplotype : null)
        : null;
    // WHERE THE SUBTYPE CAME FROM, on the same footing as its three
    // siblings and under a key that states an origin rather than grading
    // anything — and the cell's VALUE tested, which is what this scope
    // never did. See `publishDiagnosisTypeCell`.
    if ('diagnosisType' in input) {
      publishDiagnosisTypeCell(
        sink,
        'diagnosisType',
        input.diagnosisType,
        mode,
        fromLaboratory('diagnosisTypeFromLaboratoryReport'),
      );
    }
    if ('d4z4' in input) {
      publishGeneticCell(sink, 'd4z4', input.d4z4, mode, () =>
        clinicaliseD4Z4(
          input.d4z4,
          fromLaboratory('d4z4FromLaboratoryReport'),
          haplotypePermissive,
        ),
      );
    }
    if ('methylation' in input) {
      // Not graded, in either mode — see `methylationCell`. Precise
      // keeps the cell; strict keeps the laboratory's own word and
      // withholds a number under a key that says the number is withheld,
      // rather than under one that says it was graded. And it states
      // where the cell came from, in both modes: `diseaseBackground.
      // methylation` is the registration form's own box, and a
      // percentage typed into it used to reach the prompt as
      //「甲基化值: 12%」 with nothing beside it, directly under two
      // sibling readings that both said `not_read_off_a_laboratory_report`
      // about the very same profile. Methylation is the FSHD2
      // discriminator. See `publishMethylationCell`.
      publishMethylationCell(
        sink,
        'methylation',
        input.methylation,
        mode,
        fromLaboratory('methylationFromLaboratoryReport'),
      );
    }
    if ('haplotype' in input) {
      publishGeneticCell(sink, 'haplotype', input.haplotype, mode, () =>
        clinicaliseHaplotype(input.haplotype, fromLaboratory('haplotypeFromLaboratoryReport')),
      );
    }
    // diagnosisDate is identifying down to the day; replace with just
    // the year so the orchestrator can still talk about "diagnosed
    // a year ago" without leaking the exact date. The day is dropped
    // in both modes — the precise consent is to a clinical value, not
    // to a calendar date — and so the year is derived in both, because
    // `diagnosisYear` is the only form of this cell either allowlist
    // carries and a precise-consent patient was otherwise left with no
    // diagnosis date at all.
    if ('diagnosisDate' in input) {
      const year = yearFromDate(input.diagnosisDate);
      if (year !== null && !('diagnosisYear' in input)) {
        added.diagnosisYear = year;
        changed.push('diagnosisDate');
      }
      drop.add('diagnosisDate');
    }
  }

  if (scope === 'reports') {
    // Same footing as `diagnosisDate`: the day never leaves and
    // `reportDate_year` is the only form either allowlist carries.
    if ('reportDate' in input) {
      const year = yearFromDate(input.reportDate);
      if (year !== null && !('reportDate_year' in input)) {
        added.reportDate_year = year;
        changed.push('reportDate');
      }
      drop.add('reportDate');
    }
    // THE UPLOAD YEAR IS A DIFFERENT CELL AND GETS A DIFFERENT KEY.
    // `reportDate` is now only ever the laboratory's own date (see
    // `resolveReportDate` in patient-reports.ts); a row that carries
    // nothing but the moment the file arrived reaches here as
    // `uploadDate` and leaves as `uploadYear`, so 报告年份 cannot be
    // printed over an upload timestamp. Both are collapsed to the year
    // by the same rule, for the same reason.
    if ('uploadDate' in input) {
      const year = yearFromDate(input.uploadDate);
      if (year !== null && !('uploadYear' in input)) {
        added.uploadYear = year;
        changed.push('uploadDate');
      }
      drop.add('uploadDate');
    }
    // OCR `fields` blob is handled in the top-level redact() flow now
    // (both modes need projection, not just strict). See projectOcrFields.
  }

  // THERE IS NO AGE BAND, in either mode, and this is where a reader
  // looks for one. `dateOfBirth`, `date_of_birth` and `birthday` are
  // all on HARD_DELETE_KEYS, so layer 1 removes the cell before this
  // function is ever handed it; banding it would mean reading the
  // birthday off the input before layer 1 runs, and that is a decision
  // about what reaches an LLM rather than a tidy-up. Left undecided it
  // grew a derivation nothing called and an inventory nothing could
  // fill, and out of that inventory an age band in `get_my_profile`'s
  // description — which is an instruction a model obeys. Decided: no
  // band, and nothing downstream that reads as one.

  return { added, drop, changed };
};

// ---------------------------------------------------------------- layer 3

const filterByAllowlist = (
  input: Record<string, unknown>,
  scope: RedactionScope,
  mode: RedactionMode,
): {
  kept: Record<string, unknown>;
  dropped: string[];
} => {
  const allowed = new Set(PROMPT_ALLOWLIST[scope][mode]);
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key)) {
      kept[key] = value;
    } else {
      dropped.push(key);
    }
  }
  return { kept, dropped };
};

// ---------------------------------------------------------------- layer 4

/**
 * LAYER 4 — THE THREE GATES ON FREE TEXT, AND THEY RUN LAST.
 *
 * A report's own impression is the sentence the radiologist, the
 * geneticist or the pulmonologist wrote about the result. It reaches
 * the model as the report printed it, and it gets there only through
 * three gates, in this order:
 *
 *   Gate 0 — ELIGIBILITY. Which documents may send free text at all.
 *            A RESULT document's impression is a test's own conclusion
 *            about a result and, names and numbers aside, is clinical
 *            language. A NARRATIVE document — 病历摘要, 门诊病历,
 *            出院小结, 入院记录 — is a story about a person: 主诉, 现病史,
 *            既往史, occupation, address, who in the family had what,
 *            the names of the treating doctors. What identifies a person
 *            there is not a pattern; 「其兄 2019 年因同病去世」 identifies
 *            a family and cannot be scrubbed without deleting the
 *            sentence. So a narrative sends NOTHING, and the marker says
 *            an impression exists and was not shared. See
 *            `documentEligibility`.
 *
 *   Gate 1 — IDENTIFIERS, IN BOTH MODES. Names, record numbers, ID
 *            cards, phone numbers, addresses, dates finer than a year.
 *            CONSENT HAS NOTHING TO DO WITH THIS GATE: nobody consented
 *            to identifiers. It sits here, at the last point before text
 *            leaves the server, rather than in the retriever, so that
 *            every path producing free text — the ones that exist today
 *            and the ones added later — passes through one
 *            implementation. See `scrubIdentifiers`.
 *
 *   Gate 2 — MEASUREMENTS, UNDER STRICT CONSENT. An impression is full
 *            of numbers, and passing them through in strict mode would
 *            open a hole in the consent model straight through the
 *            free-text path — handing a patient who never granted
 *            「精确数值」 exactly the numbers that consent exists to
 *            withhold. `isQualitativeResult` already states the rule
 *            this file applies to cells: anything carrying a digit is a
 *            measurement, so 阳性(1:8) stays withheld because the titre
 *            is the number the patient did not consent to share. Same
 *            rule here. See `maskMeasurements` for the digits that are
 *            part of a NAME and must survive it.
 *
 * ALL THREE FAIL CLOSED. A guardrail that passes what it cannot judge
 * is not a guardrail. Where the eligibility gate cannot tell what kind
 * of document this is, where the identifier scrub cannot make a string
 * safe, or where the mask cannot bound its own reading of a digit, the
 * WHOLE field is withheld and replaced with a marker saying an
 * impression exists and was not shared. The model must never conclude
 * that a report had no impression because a gate ate it silently — and
 * the same when the text is capped, which reports how much was cut.
 *
 * THE STRUCTURE IS THE ENFORCEMENT, NOT THIS COMMENT. Comments have not
 * held rules in this module: three rounds of them failed on the
 * laboratory gate. `GatedFreeText` is a branded string whose brand
 * symbol is module-private, and `gateFreeText` is the only function
 * that mints one, so a raw string cannot be assigned into a published
 * free-text field at any call site and the compiler says so — the same
 * device `UploaderDeclaredDocumentType` uses in
 * patient-profile/genetic-evidence.ts.
 */

declare const gatedFreeTextBrand: unique symbol;

/**
 * PROSE THAT HAS PASSED ALL THREE GATES.
 *
 * Nominal on purpose. No value carries the brand at runtime and the
 * symbol is module-private, so the only way to obtain one is
 * `gateFreeText` below: a plain `string` — the retriever's raw
 * impression above all — is not assignable to it.
 */
export type GatedFreeText = string & { readonly [gatedFreeTextBrand]: true };

/** Everything one free-text field contributes to the prompt. The only
 *  producer is `gateFreeText`, and `text` is the branded type, so a
 *  caller cannot build one of these out of a raw string. */
export interface FreeTextOutcome {
  /** The gated text. `null` whenever any gate refused. */
  readonly text: GatedFreeText | null;
  /** Why nothing is being sent, when nothing is. Always paired with a
   *  `text` of `null`, and never both absent — the model has to be able
   *  to tell 「there was an impression and you are not getting it」 from
   *  「this report has no impression」. */
  readonly withheld: string | null;
  readonly valuesMasked: number;
  readonly identifiersRemoved: number;
  readonly charactersCut: number;
}

/** WHY AN IMPRESSION IS NOT BEING SENT. One vocabulary, so the model
 *  reads the same word for the same refusal, and so a reader of the
 *  audit row can tell which gate fired. */
const FREE_TEXT_REFUSALS = {
  narrative:
    'impression_exists_but_this_document_is_a_clinical_narrative_about_a_person_not_a_test_result',
  unknownKind: 'impression_exists_but_this_platform_cannot_tell_what_kind_of_document_this_is',
  identifiers: 'impression_exists_but_identifiers_in_it_could_not_be_removed',
  unclassifiedValue: 'impression_exists_but_a_number_in_it_could_not_be_classified',
} as const;

// ------------------------------------------------------------ gate 0

/**
 * DOES THE CLASSIFIER'S OWN VOCABULARY NAME THIS DOCUMENT AS A RESULT.
 *
 * Split off `CLASSIFIED_REPORT_TYPES`, which is the list this repo
 * already keeps of what `_classify_report` in
 * apps/report-manager/app/services/fshd_report_service.py can conclude
 * — pinned against that Python table by get-my-reports.test.ts. No new
 * document-type list is invented here; the only thing added is which
 * side of the eligibility line each existing entry falls on, and both
 * sides are enumerated so a type added to the classifier fails the
 * partition test in pii-redactor.test.ts rather than defaulting to
 * eligible.
 *
 * The three that are NOT result documents are not a judgement call:
 * `medical_summary` IS 病历摘要 and `physical_exam` IS 体格检查, and both
 * of those strings are entries on `CLINICAL_NARRATIVE_MARKERS` in
 * patient-profile/genetic-evidence.ts — the list five rounds of work
 * went into. `other` is not a classification at all; it is the
 * classifier saying it could not name the document, which is the
 * 「cannot tell」 case and fails closed.
 */
const RESULT_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'abdominal_ultrasound',
  'biochemistry',
  'blood_routine',
  'coagulation',
  'diaphragm_ultrasound',
  'ecg',
  'echocardiography',
  'genetic_report',
  'infection_screening',
  'muscle_enzyme',
  'muscle_mri',
  'pulmonary_function',
  'stool_test',
  'thyroid_function',
  'urinalysis',
]);

/**
 * THE OTHER SIDE OF THE PARTITION, AND IT IS TWO DIFFERENT THINGS.
 *
 * `medical_summary` and `physical_exam` are documents the classifier
 * NAMED, and what it named them is 病历摘要 and 体格检查 — both of which
 * are entries on `CLINICAL_NARRATIVE_MARKERS` in
 * patient-profile/genetic-evidence.ts. `other` is not a classification
 * at all; it is the classifier saying it could not name the document.
 *
 * Those are two different refusals and they used to produce one marker.
 * A document positively classified 病历摘要 told the model 「this
 * platform cannot tell what kind of document this is」 — which is false,
 * and worse than useless: the model cannot distinguish 「we know what
 * this is and its prose is about a person」 from 「we have no idea what
 * we are holding」, and the first is a fact it can reason with.
 *
 * `NON_RESULT_DOCUMENT_TYPES` is DERIVED from the two rather than
 * written a third time, so it stays exhaustive with them by
 * construction — and it is now consulted by `documentEligibility`
 * rather than exported for a test and read by nothing else.
 */
const NARRATIVE_DOCUMENT_TYPES: ReadonlySet<string> = new Set(['medical_summary', 'physical_exam']);

/** The classifier declining to name the document. Not a kind. */
const UNNAMED_DOCUMENT_TYPES: ReadonlySet<string> = new Set(['other']);

export const NON_RESULT_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  ...NARRATIVE_DOCUMENT_TYPES,
  ...UNNAMED_DOCUMENT_TYPES,
]);

type Eligibility = 'result' | 'narrative' | 'unknown';

/**
 * WHICH DOCUMENTS MAY SEND FREE TEXT AT ALL.
 *
 * Three answers, and only one of them sends anything.
 *
 * THE NARRATIVE QUESTION IS ASKED FIRST AND OUTRANKS THE LABEL, exactly
 * as it does in `isLaboratoryGeneticReport`: a 病历摘要 with a whole
 * genetics report pasted into it is still a 病历摘要, and it will carry
 * a classifier label as readily as anything else. The predicate is
 * `showsClinicalNarrative`, shared with that gate rather than copied —
 * see its note in patient-profile/genetic-evidence.ts.
 *
 * AND IT IS ASKED OF A DOCUMENT THAT INCLUDES THE IMPRESSION ITSELF.
 * `showsClinicalNarrative` searches the stored page plus an allowlist
 * of `fields` cells whose contents this pipeline knows, and of the
 * eight keys an impression can arrive under exactly one is on that
 * list. So the sentence that makes a document a narrative was, for
 * seven of the eight, in the one cell the predicate could not read:
 * a payload whose `reportImpression` opens 「主诉：双下肢无力3年」 and
 * whose page was never stored showed the predicate nothing. The text
 * about to be sent is part of the document's own page, so it is put
 * where the predicate reads the page.
 *
 * THEN THE LABEL, AND IT MUST BE A POSITIVE ONE. 「not a narrative」 is
 * not 「a result」: an archived 病历摘要 with no page and no
 * narrative-only cells shows this predicate nothing at all, which is
 * precisely the row the laboratory gate spends four paragraphs on. So
 * eligibility requires the classifier to have NAMED this document as
 * one of the result kinds. Anything else — `other`, an unparsed row, a
 * label from some vocabulary this platform does not know — is
 * `unknown`, and `unknown` sends nothing.
 *
 * WHAT THAT COSTS AND WHO PAYS IT. `documentClassifiedType` falls back
 * to `patient_documents.document_type` on a row the parse never
 * labelled, and two values are spelled the same in both vocabularies —
 * `genetic_report` and `other`. So a row the parser never classified,
 * uploaded under 基因检测报告, is eligible on the uploader's declaration
 * alone. That is the same weak witness the laboratory gate documents at
 * step (4) and accepts for the same reason: refusing it would refuse
 * the genuine report of a patient whose page was not stored. The other
 * upload-form values (`mri`, `blood_panel`) are not on the classifier's
 * list, so an unparsed MRI sends nothing — fail closed.
 */
const documentEligibility = (
  document: GeneticEvidenceDocumentLike,
  impression: string,
): Eligibility => {
  const withImpression: GeneticEvidenceDocumentLike = {
    ...document,
    ocrPayload: isPlainObject(document.ocrPayload)
      ? {
          ...document.ocrPayload,
          extractedText: [
            typeof document.ocrPayload.extractedText === 'string'
              ? document.ocrPayload.extractedText
              : '',
            impression,
          ]
            .filter(Boolean)
            .join('\n'),
        }
      : { extractedText: impression },
  };
  if (showsClinicalNarrative(withImpression)) return 'narrative';
  const type = documentClassifiedType(document);
  if (RESULT_DOCUMENT_TYPES.has(type)) return 'result';
  // A NAMED NON-RESULT IS A NARRATIVE, NOT AN UNKNOWN. See
  // `NARRATIVE_DOCUMENT_TYPES`: 病历摘要 and 体格检查 are documents this
  // platform recognised, and the marker has to say the true reason.
  if (NARRATIVE_DOCUMENT_TYPES.has(type)) return 'narrative';
  return 'unknown';
};

// ------------------------------------------------------------ gate 1

/**
 * THE MARKERS, AND WHY NONE OF THEM IS SPELLED WITH A WORD THIS FILE
 * SEARCHES FOR.
 *
 * The scrub runs more than once over the same string — the channel runs
 * it, and then `scrubKeptValue` runs it again over everything layer 3
 * kept — so a marker has to survive its own scrub unchanged. It was
 * 「[地址未共享]」 and 「[姓名未共享]」 first, and both are made of words on
 * the lists above: the second pass read 地址 inside the marker the first
 * pass had just written, called the string unsafe, and withheld a
 * correctly scrubbed impression. 姓名 did the visible version of the
 * same thing — 「受检者[姓名[姓名[姓名未共享]]]」, the label scrub matching
 * inside its own output, three deep.
 *
 * So the markers are spelled with synonyms no list here carries, and —
 * because a synonym is a thing someone can change later — the scrub
 * does not write them at all until it has finished. It works in
 * private-use sentinels (U+E000 to U+E003), which are outside every
 * character class here — 一-龥 is U+4E00 to U+9FA5 and the token scan is
 * ASCII — so no pattern in this file can match one. The residual
 * question is asked of the sentinel text, and the human wording is
 * substituted last.
 */
const NAME_MARKER = '[人名未共享]';
const NUMBER_MARKER = '[编号未共享]';
const DATE_MARKER = '[日期未共享]';
const PLACE_MARKER = '[地点未共享]';
const MEASUREMENT_MARKER = '[数值未共享]';
const TRUNCATION_MARKER = '[后续未列出]';

/**
 * WHERE A TRUNCATION MAY CUT: never inside one of this file's own
 * markers.
 *
 * Every marker is a bracketed run with no bracket inside it, so 「the
 * cut opened a bracket it did not close」 is decidable by looking for
 * the last 「[」 in the slice and asking whether a 「]」 follows it. If
 * one does not, the slice is pulled back to that bracket. The two
 * failures this prevents are an unclosed 「[数值未」 dangling in the
 * prompt, and a marker cut down far enough to vanish — which reads to
 * the model as an ordinary truncation while the counts beside it still
 * say a value was masked there.
 */
const cutBeforeAnyOpenMarker = (text: string, limit: number): number => {
  const slice = text.slice(0, limit);
  const open = slice.lastIndexOf('[');
  if (open === -1) return limit;
  return slice.indexOf(']', open) === -1 ? open : limit;
};

const NAME_SENTINEL = '\uE000';
const NUMBER_SENTINEL = '\uE001';
const DATE_SENTINEL = '\uE002';
const PLACE_SENTINEL = '\uE003';
const SENTINEL_MARKERS: Readonly<Record<string, string>> = {
  [NAME_SENTINEL]: NAME_MARKER,
  [NUMBER_SENTINEL]: NUMBER_MARKER,
  [DATE_SENTINEL]: DATE_MARKER,
  [PLACE_SENTINEL]: PLACE_MARKER,
};

/**
 * THE VALUE BEHIND A LABEL, AND WHY EACH FAMILY GETS ITS OWN CLASS.
 *
 * Three rules hold across all of them:
 *
 *   1. NO RUN MAY CROSS A LABEL. Every Han-capable class is written as
 *      `(?!ANY_LABEL_SOURCE)` per character, so a greedy quantifier
 *      cannot run out of one field and into the next one's label. See
 *      `ANY_LABEL_SOURCE` for the address that ate a 姓名 label and the
 *      name behind it.
 *   2. NO RUN MAY CROSS THE WHITESPACE THE PAGE ITSELF DREW, except
 *      where the continuation is positively of the same kind as what
 *      came before it — a further all-digit block of one OCR-split
 *      number, or a further Latin word of one Latin name. The space is
 *      the boundary the page printed; anything else is a run that
 *      swallows the next field.
 *   3. EVERY CLASS ASSUMES ASCII PUNCTUATION. `normaliseForGates` has
 *      already folded 「：」「（」「－」 onto their ASCII forms, so the
 *      classes name each delimiter once instead of twice.
 */

/** A record number or a contact detail: an ASCII run, and — because an
 *  ID card broken across OCR blocks is still an ID card — up to three
 *  further ALL-DIGIT blocks after it. 「身份证号 110101 19900307 1234」
 *  used to lose its first block and publish the rest, which is the
 *  card's birth-date field. A continuation that is not all digits (「CK
 *  890」) is not part of the number and stops the run. */
const LABELLED_ASCII_VALUE = String.raw`\s*[:：=]?\s*[A-Za-z0-9()\-/.]{1,24}(?:\s+\d{2,8}){0,3}`;

const RECORD_NUMBER_SCRUB = new RegExp(
  `(?:${RECORD_NUMBER_LABEL_SOURCE})${LABELLED_ASCII_VALUE}`,
  'g',
);
const CONTACT_SCRUB = new RegExp(`(?:${CONTACT_LABEL_SOURCE})${LABELLED_ASCII_VALUE}`, 'g');

/** An address value may hold Han characters, which is what made it the
 *  greediest class in the file. It is bounded four ways: a Han value
 *  needs the page to have printed a DELIMITER (otherwise 「地址不详」 —
 *  ordinary prose — loses its 不详 to the same defect the name labels
 *  had), it may not cross a label, it may not cross whitespace, and it
 *  is capped. An unlabelled address is not left to this scrub: the
 *  administrative-chain shapes in `SELF_ANNOUNCING_IDENTIFIERS` reach
 *  「北京市海淀区…」 with no label in front of it at all. */
const ADDRESS_SCRUB = new RegExp(
  `(?:${ADDRESS_LABEL_SOURCE})(?:\\s*[:：=]\\s*(?:(?!${ANY_LABEL_SOURCE})[A-Za-z0-9()\\-/.一-龥]){1,30}|\\s*(?:(?!${ANY_LABEL_SOURCE})[A-Za-z0-9()\\-/.]){1,30})`,
  'g',
);

/**
 * A NAME, AND WHAT COUNTS AS ONE DEPENDS ON WHAT INTRODUCED IT.
 *
 * THE VALUE IS NOT ENUMERABLE AND THE LABEL IS. That is the whole
 * shape of the fix. The old rule took 「two or three contiguous Han
 * characters」 after a label, so 姓名：ZHANG SAN, 姓名：欧阳建国, a
 * transliterated minority name and every name after the first in a
 * 、-separated list were all published. After a label the value is
 * WHATEVER FOLLOWS, in whatever script and however many names it lists,
 * up to the boundary the page drew.
 *
 *   - LATIN — one to four Latin words. A Latin personal name spans
 *     spaces and a Chinese one does not, so the space continuation is
 *     allowed here and nowhere else.
 *   - HAN — up to four characters (欧阳建国 is four), repeated across
 *     「、」 so a list of names is one value. Whitespace ends it: 「姓名：
 *     张三 患者李四」 with a space-tolerant run took 张三患 as one name,
 *     ate the 患者 label off the next field and left 李四 standing.
 *   - WITNESSED HAN — the surname corroboration, for the cases where
 *     nothing but a bare word introduced the name.
 */
const LATIN_NAME_VALUE = String.raw`[A-Za-z][A-Za-z.'·\-]{0,19}(?:\s+[A-Za-z][A-Za-z.'·\-]{0,19}){0,3}`;
const HAN_NAME_VALUE = `(?:(?!${ANY_LABEL_SOURCE})[一-龥·]){1,4}(?:\\s*、\\s*(?:(?!${ANY_LABEL_SOURCE})[一-龥·]){1,4}){0,4}`;
const WITNESSED_NAME_VALUE = `[${CHINESE_SURNAMES}][一-龥]{1,2}(?:\\s*、\\s*[${CHINESE_SURNAMES}][一-龥]{1,2}){0,4}`;

/**
 * WHERE A WITNESSED NAME HAS TO END, AND THIS IS THE STRUCTURAL HALF OF
 * THE SURNAME FIX.
 *
 * 「患者白细胞计数正常」 and 「患者高信号区域局限」 were read as
 * 患者 + a three-character name because nothing said where the name
 * stopped. A personal name in prose is followed by punctuation or by
 * whitespace — 「患者张三，女」 — and an analyte or a hedge is followed by
 * more of its own word. Requiring the boundary is what lets the surname
 * list stay a corroboration instead of becoming the whole test; trimming
 * the list (see `CHINESE_SURNAMES`) is the second half, not the first.
 */
const NAME_BOUNDARY = String.raw`(?=[\s,;:.()\[\]!?"'/\\|、。，；：！？（）“”‘’]|$)`;

/**
 * A name after a DEDICATED label — 姓名：张三, 患者姓名 ZHANG SAN,
 * 医师签名王五. Whatever follows the label is the value, because that is
 * the label's only job, so no delimiter and no witness is required.
 */
const DEDICATED_NAME_SCRUB = new RegExp(
  `(${DEDICATED_NAME_LABEL_SOURCE})\\s*[:：=]?\\s*[(（]?(?:${LATIN_NAME_VALUE}|${HAN_NAME_VALUE})[)）]?`,
  'g',
);

/**
 * A name after a ROLE label. Two shapes and neither of them may eat
 * prose:
 *
 *   - DELIMITED — 受检者：张三, 主治医师（王五）. A delimiter means a field
 *     follows, and then the value is whatever follows.
 *   - WITNESSED — 经治医师李四。 A role label with no delimiter is an
 *     ordinary sentence subject as often as it is a label, so the
 *     surname and the boundary both have to fire. 「受检者未见明显异常」
 *     and 「技师操作规范」 hit neither and survive whole, WHICH IS THE
 *     POINT: the old rule ate the negation out of the first one and
 *     published a ruled-out finding as present.
 */
const ROLE_NAME_DELIMITED_SCRUB = new RegExp(
  `(${PERSON_ROLE_LABEL_SOURCE})\\s*(?:[:：=]\\s*|[(（]\\s*)(?:${LATIN_NAME_VALUE}|${HAN_NAME_VALUE})\\s*[)）]?`,
  'g',
);
const ROLE_NAME_WITNESSED_SCRUB = new RegExp(
  `(${PERSON_ROLE_LABEL_SOURCE})\\s*(?:${WITNESSED_NAME_VALUE}|${LATIN_NAME_VALUE})${NAME_BOUNDARY}`,
  'g',
);

/** A name after an ordinary NOUN, which needs both witnesses. See
 *  `PERSON_NOUNS`, `CHINESE_SURNAMES` and `NAME_BOUNDARY`. */
const NOUN_NAME_SCRUB = new RegExp(
  `(${anyOf(PERSON_NOUNS)})\\s*[(（]?(?:${WITNESSED_NAME_VALUE})[)）]?${NAME_BOUNDARY}`,
  'g',
);

/** The sentinel each self-announcing shape leaves behind, read off the
 *  pair it was declared with rather than off a parallel array. */
const SENTINEL_FOR: Readonly<Record<SelfAnnouncingIdentifier['sentinel'], string>> = {
  number: NUMBER_SENTINEL,
  date: DATE_SENTINEL,
  place: PLACE_SENTINEL,
};

/** Every occurrence of a string this document filed under a
 *  hard-delete key, whitespace-tolerant so an OCR line wrap through the
 *  middle of a name still matches. */
const knownIdentifierPattern = (value: string): RegExp | null => {
  const characters = [...value.trim()].filter((c) => !/\s/.test(c));
  if (characters.length < 2 || characters.length > 24) return null;
  const escaped = characters.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('\\s*'), 'g');
};

interface ScrubResult {
  readonly text: string;
  readonly removed: number;
  /** The scrub could not make this string safe — an identifier shape
   *  survives it. The caller withholds the whole field. */
  readonly unsafe: boolean;
}

/**
 * GATE 1 — TAKE THE IDENTIFIERS OUT, THEN CHECK THAT THEY ARE OUT.
 *
 * NORMALISED FIRST, ALWAYS. See `normaliseForGates`: every pattern
 * below is written in ASCII classes, and a page that typeset its digits
 * full-width used to walk an ID card, a mobile number and a whole date
 * past all of them without setting a single flag.
 *
 * THE ORDER IS EXPLICIT AND EACH STEP SAYS WHY IT IS WHERE IT IS. It
 * matters less than it used to — no value class can cross a label any
 * more (see `ANY_LABEL_SOURCE`), which is what made the old order
 * load-bearing and fragile — but 「the order does not matter」 is a claim
 * that has to be true of the whole pipeline rather than assumed of it,
 * so both defences are kept:
 *
 *   1. THE SHARED PROSE SCRUB, from security/text-scrub.ts. It owns the
 *      email pattern this file deliberately does not have a second copy
 *      of, plus its own ID-card and mobile shapes. It runs FIRST because
 *      it is script-independent and label-independent: nothing it
 *      removes could have been part of a Chinese label's value, and
 *      taking an email out early keeps its `@`-joined run from being
 *      read as a record number.
 *   2. THE VALUES THIS DOCUMENT ITSELF FILED UNDER AN IDENTIFIER KEY —
 *      the patient's name, the physician's name. These are the only
 *      names on the page known to BE names, so they are removed before
 *      anything has a chance to eat the label in front of one.
 *   3. RECORD NUMBERS and 4. CONTACT DETAILS, label and value together:
 *      the label without its number states nothing and the number
 *      without its label is still the number.
 *   5. ADDRESSES. Last of the label-and-value family because its value
 *      class is the only one that admits Han characters, so it is the
 *      one whose greed used to reach a following label.
 *   6. NAMES AFTER A DEDICATED LABEL, then 7. after a ROLE label
 *      (delimited, then witnessed), then 8. after an ordinary NOUN. The
 *      label is KEPT and the value replaced: 「受检者[人名未共享]」 still
 *      tells the model whose body the sentence is about.
 *   9. THE SHAPES THAT ANNOUNCE THEMSELVES, last, because by now every
 *      label-bound value is gone and what is left is unlabelled.
 *
 * AND THEN THE RESIDUAL CHECK, WHICH IS THE HALF THAT FAILS CLOSED. A
 * scrub that runs and reports success is worth nothing on its own —
 * the whole reason the previous design refused to scrub free text was
 * that a scrubber over prose is allow-by-default wearing a safety
 * costume. So the scrubbed string is asked the same question again,
 * with `RESIDUAL_IDENTIFIER_PATTERNS`, and a hit means the WHOLE field
 * is withheld rather than published in a state this module could not
 * account for.
 *
 * WHAT IT STILL CANNOT REACH, stated here rather than left to be
 * discovered:
 *
 *   - AN UNLABELLED NAME THIS DOCUMENT NEVER FILED UNDER A KEY. 「张三，
 *     男，双侧大腿…」 with no `patientName` cell, no 姓名 label and no
 *     patient noun in front of it is a name no pattern in this file can
 *     see. Two characters of Chinese are two characters of Chinese.
 *     This is the single largest residual risk on this channel and it is
 *     why Gate 0 exists: narrative documents, where relatives' and
 *     physicians' names appear unlabelled as a matter of course, send
 *     nothing at all.
 *   - A RARE SURNAME AFTER 患者, or one of the twenty-two common ones
 *     `CHINESE_SURNAMES` had to give up because they open ordinary
 *     clinical words. Corroboration cannot be complete and this one is
 *     deliberately less complete than it was.
 *   - A FAMILY MEMBER NAMED ON A RESULT DOCUMENT. 「其兄张伟同病」 on a
 *     genetics report is reached only if 张伟 was filed under a
 *     hard-delete key, which it will not have been.
 *   - AN ADDRESS WITH NO ADMINISTRATIVE CHAIN. 「中关村大街」 with no
 *     number and no 市/区 is not matched; requiring less would match
 *     anatomical prose.
 *   - AN INSTITUTION'S NAME. 「北京协和医院」 identifies a hospital, not
 *     a patient, and is left standing on purpose — it is what tells the
 *     model an outside laboratory issued this report.
 *
 * AND WHAT IT COSTS IN THE OTHER DIRECTION: a name that is also an
 * ordinary word is removed anyway. If this document filed
 * `patientName: 高明`, then 「信号增高明显」 loses its 高明. Nobody
 * consented to identifiers, so this gate resolves its doubt toward
 * removal, and the cost is a garbled clause rather than a leaked name.
 */
const SHARED_SCRUB_MARKERS = /\[(?:ID|PHONE|EMAIL)\]/g;

const scrubIdentifiers = (raw: string, knownValues: readonly string[]): ScrubResult => {
  let text = normaliseForGates(raw);
  let removed = 0;

  const replaceAll = (pattern: RegExp, sentinel: string, keepLabel = false) => {
    text = text.replace(pattern, (match: string, label?: string) => {
      removed += 1;
      return keepLabel && label ? `${label}${sentinel}` : sentinel;
    });
  };

  // (1) The shared prose scrub — the one owner of the email pattern.
  //     Its own markers are folded onto this file's sentinels so the
  //     published string speaks one vocabulary.
  const shared = scrubPiiText(text);
  if (shared !== text) {
    text = shared.replace(SHARED_SCRUB_MARKERS, () => {
      removed += 1;
      return NUMBER_SENTINEL;
    });
  }

  // (2) The names this document filed under its own identifier keys.
  for (const value of knownValues) {
    const pattern = knownIdentifierPattern(value);
    if (pattern) replaceAll(pattern, NAME_SENTINEL);
  }

  // (3)-(5) Label and value together.
  replaceAll(RECORD_NUMBER_SCRUB, NUMBER_SENTINEL);
  replaceAll(CONTACT_SCRUB, NUMBER_SENTINEL);
  replaceAll(ADDRESS_SCRUB, PLACE_SENTINEL);

  // (6)-(8) Names, label kept.
  replaceAll(DEDICATED_NAME_SCRUB, NAME_SENTINEL, true);
  replaceAll(ROLE_NAME_DELIMITED_SCRUB, NAME_SENTINEL, true);
  replaceAll(ROLE_NAME_WITNESSED_SCRUB, NAME_SENTINEL, true);
  replaceAll(NOUN_NAME_SCRUB, NAME_SENTINEL, true);

  // (9) The shapes that announce themselves, each with the sentinel it
  //     was declared beside.
  for (const entry of SELF_ANNOUNCING_IDENTIFIERS) {
    replaceAll(new RegExp(entry.pattern.source, 'g'), SENTINEL_FOR[entry.sentinel]);
  }

  // Asked of the SENTINEL text, before the human wording goes in. See
  // the note on the markers: a marker spelled out of a word on one of
  // these lists answers this question about itself.
  const unsafe = RESIDUAL_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(text));
  return {
    text: text.replace(/[\ue000-\ue003]/g, (c) => SENTINEL_MARKERS[c]),
    removed,
    unsafe,
  };
};

// ------------------------------------------------------------ gate 2

/**
 * NUMBERS THAT ARE PART OF A NAME — AND THE DEFAULT IS NOW THE OTHER
 * WAY ROUND.
 *
 * THE OLD RULE RESOLVED ITS DOUBT TOWARD PUBLISHING. It read the
 * parser's `_NOT_INSIDE_A_LATIN_TOKEN` — 「a digit welded to the end of a
 * Latin word is part of that word's NAME」 — and turned it into 「a token
 * that welds letters to digits IS a name unless it matches a short unit
 * list」. That rule is right about 4qA and D4Z4 and wrong about
 * everything a laboratory prints, so under STRICT consent, which is the
 * consent that says 「no precise numbers」, the model was handed
 * 120/80mmHg, 890-1200U/L, 22.5kg/m2, 1.73m2 and LDL2.6. A unit list can
 * never be long enough to close that, because the thing being tested for
 * is 「is this a measurement」 and the answer was defaulting to no.
 *
 * SO: A TOKEN CARRYING A DIGIT IS A MEASUREMENT UNLESS IT IS
 * POSITIVELY RECOGNISED AS A NAME. Doubt resolves toward masking,
 * everywhere, which is the same direction gate 1 resolves in and for the
 * same reason — the two failures are not equal. Over-masking a name
 * costs clinical meaning in one clause; publishing a measurement under
 * strict consent is the consent model failing.
 *
 * WHAT COUNTS AS POSITIVELY RECOGNISED, IN TWO VOCABULARIES, BECAUSE
 * THE OLD ONE HAD ONLY THE LATIN HALF. It reached Latin tokens and
 * exactly one Chinese span (「N 号染色体」), so 「3级」, 「FSHD 1型」, a
 * vertebral level spelled in Chinese and the ordinals of an enumerated
 * 结论 were all masked as measurements — and a bare four-digit YEAR with
 * it, on a pipeline that publishes `reportDate_year` and a gate 1 that
 * deliberately leaves a year standing.
 *
 *   - NAME SPANS, for the digits that touch a Chinese character. A
 *     number followed by a Chinese CLASSIFIER — 号染色体, 型, 级, 期, a
 *     vertebral level, a rib, an ECG lead — is a name in Chinese exactly
 *     as `4qA` is one in Latin. So is a year written 「2019年」, and so is
 *     the 「1.」 that opens a numbered conclusion.
 *   - NAME TOKENS, for the Latin half. Derived where this repo already
 *     holds the answer — every key on `OCR_FIELDS_SAFE_KEYS_PRECISE`
 *     that carries a digit IS a name by that list's own reckoning
 *     (ft3, ft4, fev1, d4z4) — plus the shape rules for the families
 *     that are generated rather than listed: vertebral levels, ECG
 *     leads, MRI sequences and the 4q/10q loci.
 *
 * WHAT THIS COSTS, STATED: an analyte this repo has no key for, printed
 * welded to its value (「XYZ4.1」), is now MASKED rather than published.
 * That is the correct direction and it is a real loss of a clause.
 */
const NAME_SPAN_PATTERNS: readonly RegExp[] = [
  // A number followed by a Chinese classifier that makes it a name.
  // 「10 号染色体」 / 「4 号染色体」 — profile.passport.ts writes this phrase.
  /\d{1,3}\s*号(?:染色体|外显子|内含子|导联)/g,
  // 「FSHD 1型」, 「肌力3级」, 「Ⅱ期」 written with an ASCII numeral, and the
  // Chinese spellings of a vertebral level.
  //
  // THE SUB-STAGE LETTER IS PART OF THE GRADE. This read `\d{1,3}\s*`
  // and a Mercuri fat-infiltration grade is routinely written with one
  // — 2a, 2b, 3a — so 「双侧大腿脂肪浸润 Mercuri 2a 级，臀大肌 3 级。」
  // published the 3 and masked the 2a, putting a real grade and a
  // 「[数值未共享]」 in one rendered sentence and inviting the model to
  // read the masked one as a number this platform was hiding. It is the
  // scale this disease's muscle MRI is reported on; a grade is a name
  // whether or not it carries a letter.
  /\d{1,3}[a-dA-D]?\s*(?:型|级|期|区|段|肋|导联)/g,
  /第\s*\d{1,3}\s*(?:颈|胸|腰|骶|尾)?(?:椎|肋|指|趾|节|次|型|级|期|对|组)/g,
  /(?:颈|胸|腰|骶|尾)\s*\d{1,2}(?:\s*[-~]\s*\d{1,2})?/g,
  // ...AND THE SAME GRADE NAMED BY ITS SCALE RATHER THAN BY A CHINESE
  // CLASSIFIER. 「Mercuri 2a」 with no 级 behind it is how a report
  // written half in Latin prints it, and the span above cannot see it.
  /[Mm]ercuri\s*(?:分级|评分)?\s*[0-4][a-dA-D]?/g,
  // A YEAR. Gate 1 leaves it standing on purpose and this pipeline
  // publishes `reportDate_year`, so masking it here contradicted both.
  // The 年 is required: a bare four-digit run with no 年 behind it is a
  // laboratory value as readily as a year, and doubt masks.
  /(?:19|20)\d{2}\s*年/g,
];

/**
 * THE ORDINALS OF AN ENUMERATED CONCLUSION — 「结论：1.双侧… 2.肩胛带
 * 肌…」 — AND THIS IS A FUNCTION BECAUSE THE QUESTION IT ASKS CANNOT BE
 * ASKED OF ONE OCCURRENCE.
 *
 * It was a member of the list above, spelled
 * `(?<=^|[\s,;:、。：；，])\d{1,2}\s*[.、)]\s*(?!\d)`, and that shape is a
 * PUNCTUATION SHAPE rather than a positive test that a number is a
 * name: it protects any one- or two-digit number that happens to sit in
 * front of a dot, a 、 or a bracket, with no check that a list exists at
 * all. 、 is an ordinary clause separator in Chinese, so
 * 「双侧股四头肌脂肪分数 32、伴轻度水肿。」 — a measurement — reached the
 * model under STRICT consent with its 32 intact, and `valuesMasked`
 * counted zero, so the audit row said nothing had been withheld. That
 * is the consent model failing silently, which is the one failure this
 * gate exists to make impossible.
 *
 * A LIST IS EVIDENCE OF ITSELF. An enumeration numbers its items from
 * one and counts up, so a candidate is a list marker only if the
 * markers before it are there too, in order: 1., then 2., and so on. A
 * lone number in front of a separator is not a list and gets no
 * protection — it is masked like any other measurement, and the counter
 * says so.
 *
 * WHAT THIS COSTS, STATED: a genuine single-item enumeration 「结论：
 * 1.双侧大腿脂肪浸润。」 loses its 「1」 to a mask. The clause survives
 * whole and the numeral carried nothing clinical, which is the cheap
 * side of a trade whose other side is publishing a measurement.
 */
const ORDINAL_CANDIDATE = /(?<=^|[\s,;:、。：；，])(\d{1,2})\s*[.、)]\s*(?!\d)/g;

const enumeratedOrdinalSpans = (text: string): { start: number; end: number }[] => {
  const run: { start: number; end: number }[] = [];
  let expected = 1;
  for (const match of text.matchAll(ORDINAL_CANDIDATE)) {
    if (Number(match[1]) !== expected) continue;
    run.push({ start: match.index, end: match.index + match[0].length });
    expected += 1;
  }
  // One marker is a number in front of a full stop; two in sequence are
  // a list.
  return run.length >= 2 ? run : [];
};

/**
 * THE LATIN TOKENS THAT CARRY A DIGIT AND ARE STILL NAMES.
 *
 * DERIVED FROM `OCR_FIELDS_SAFE_KEYS_PRECISE` WHEREVER IT ALREADY KNOWS
 * — a key on that list carrying a digit is a name by that list's own
 * reckoning, which is what the note on the deleted `ANALYTE_PREFIXES`
 * said in passing about ft3 / ft4 / fev1 and then used for the opposite
 * purpose. `d4z4Repeats` yields `d4z4`, `fev1` yields itself.
 */
const nameTokenFromKey = (key: string): string | null => {
  const match = /^[a-z]+\d+(?:[a-z]\d+)*/.exec(key.toLowerCase());
  return match ? match[0] : null;
};

const DIGIT_BEARING_NAME_TOKENS: ReadonlySet<string> = new Set(
  [...OCR_FIELDS_SAFE_KEYS_PRECISE]
    .map((key) => nameTokenFromKey(key))
    .filter((token): token is string => token !== null),
);

/**
 * ...AND THE FAMILIES THAT ARE GENERATED RATHER THAN LISTED, so that a
 * level or a lead this repo has no key for is still a name.
 *
 * C1..C8 / T1..T12 / L1..L6 / S1..S5 are vertebral levels and heart
 * sounds; V1..V9 / aVR / aVL / aVF are ECG leads; T1WI / T2WI are MRI
 * sequences; `4q35`, `4qA`, `4qB` and `10q26` are the loci this disease
 * is defined on. Each is bounded so the shape cannot absorb a value —
 * 「T3 1.8」 keeps its T3 and masks its 1.8.
 */
const NAME_TOKEN_SHAPES: readonly RegExp[] = [
  /^(?:c[1-8]|t(?:1[0-2]|[1-9])|l[1-6]|s[1-5])$/,
  /^t[12]wi$/,
  /^(?:v[1-9]|avr|avl|avf)$/,
  /^fshd[12]?$/,
  /^(?:dux4|smchd1|dnmt3b|lrif1)$/,
  /^covid-?19$/,
];

/**
 * ...AND THE NAMES THAT ARE ONLY NAMES WHOLE.
 *
 * `tokenIsName` splits a token on the separators the token scan allows
 * and asks about each part, which is right for a value with a unit
 * welded on (`22.5kg/m2` fails on the part that is neither) and wrong
 * for every name whose separator is INSIDE it. The dot is the one that
 * did the damage, and it did it to the vocabulary this disease is
 * defined on:
 *
 *   - HGVS. 「c.1490G>A」 scans as the token `c.1490G`, splits into `c`
 *     and `1490g`, and `1490g` matches no shape — so the whole variant
 *     was replaced by 「[数值未共享]」. Same for 「p.Arg1234Cys」. That
 *     notation is the ENTIRE content of an FSHD2 / SMCHD1 result: with
 *     it masked, a strict-consent reader is told a variant was found
 *     and not which one.
 *   - A LOCUS WITH A SUB-BAND. 「4q35.2」 split into `4q35` and `2`.
 *     `4q35` alone survived, so the discriminator of this disease
 *     survived at band resolution and vanished at sub-band resolution —
 *     and 「4qA161」, the haplotype written with its allele size, was
 *     masked outright because the old locus shape had nowhere to put
 *     the size.
 *   - AN ABBREVIATED VERTEBRAL LEVEL. Chinese radiology prints
 *     「C5-6」, not 「C5-C6」; the second parts as `c5` and `c6` and
 *     survives, the first parts as `c5` and a bare `6` and the whole
 *     token is replaced.
 *
 * So the whole token is asked FIRST, and only a token no whole shape
 * recognises is split. Each shape is anchored and bounded, so none of
 * them can absorb a measurement standing next to a name.
 */

/** An HGVS reference sequence, when the token carried one: `NM_001723.7:`
 *  scans as `001723.7:` once the underscore has ended the token before
 *  it, so the prefix is optional and loose and the variant behind it is
 *  what has to match. */
const HGVS_REFERENCE = String.raw`(?:[a-z\d]+(?:[._][a-z\d]+)*:)?`;
/** c. / g. / m. / n. / r. — a position, an optional intronic offset and
 *  the allele letters. `c.-14G`, `c.*23A` and `c.1490+1G` included. */
const HGVS_NUCLEOTIDE = String.raw`[cgmnr]\.[*\-]?\d+(?:[+\-]\d+)?[a-z]*`;
/** p. — one- or three-letter amino acids around a codon number. */
const HGVS_PROTEIN = String.raw`p\.[a-z]{1,3}\d+(?:[a-z]{1,3}|\*)?(?:fs(?:\*\d+)?)?`;
/** What the tokeniser leaves of a range once the underscore has split
 *  it: `c.1490_1492del` scans as `c.1490` and `1492del`. A number
 *  ending in a change keyword is never a measurement. */
const HGVS_RANGE_TAIL = String.raw`\d+(?:delins|del|ins|dup|inv)[a-z]*`;

const WHOLE_TOKEN_NAME_SHAPES: readonly RegExp[] = [
  // HGVS variant notation, in the forms the token scan produces.
  new RegExp(`^(?:${HGVS_REFERENCE}(?:${HGVS_NUCLEOTIDE}|${HGVS_PROTEIN})|${HGVS_RANGE_TAIL})$`),
  // A chromosome locus, with or without a sub-band, and a 4q/10q
  // haplotype with or without its allele size: `4q`, `4q35`, `4q35.2`,
  // `4qter`, `4qA`, `4qA161`, `10q26.3`.
  /^\d{1,2}[pq](?:ter|\d{1,2}(?:\.\d{1,2})?)?(?:[ab]\d{0,3})?$/,
  // A vertebral level or a range of them, however the second end is
  // abbreviated: `c5`, `c5-c6`, `c5-6`, `t12-l1`, `c5/6`.
  /^(?:c[1-8]|t(?:1[0-2]|[1-9])|l[1-6]|s[1-5])(?:[-~/](?:c[1-8]|t(?:1[0-2]|[1-9])|l[1-6]|s[1-5]|1[0-2]|[1-9]))?$/,
];

/**
 * A PART OF A SPLIT TOKEN IS A NAME BY THE SAME TWO VOCABULARIES THE
 * WHOLE TOKEN IS ASKED BY. `4q35-4q36` has no whole shape of its own and
 * is judged end by end, and each end is a locus.
 */
const partIsName = (part: string): boolean =>
  !/\d/.test(part) ||
  DIGIT_BEARING_NAME_TOKENS.has(part) ||
  NAME_TOKEN_SHAPES.some((shape) => shape.test(part)) ||
  WHOLE_TOKEN_NAME_SHAPES.some((shape) => shape.test(part));

/**
 * A maximal ASCII token. A Chinese character is a boundary, which is
 * what makes 「未检出3个重复单元」 offer up a bare 「3」.
 *
 * THE COMMA IS NOT A JOINER, and that is a consequence of
 * `normaliseForGates`. It used to be one, for 「1,000」 — and once the
 * full-width 「，」 that separates two Chinese clauses is folded onto an
 * ASCII comma, joining across it welds a measurement to the name after
 * it: 「CK 890，4号染色体」 became the single token 「890,4」, which
 * overlapped the 「4号染色体」 name span and so PUBLISHED the 890 under
 * strict consent. 「1,000」 now scans as two tokens, both of which are
 * measurements and both of which are masked, which is the same answer
 * one token would have given.
 */
const ASCII_TOKEN = /[A-Za-z0-9]+(?:[.:/^+\-~][A-Za-z0-9]+)*(?:\s*[%‰])?/g;

/**
 * IS THIS TOKEN A NAME?
 *
 * THE WHOLE TOKEN IS ASKED BEFORE IT IS SPLIT, and that ordering is the
 * fix rather than an optimisation. Splitting first destroys every name
 * whose separator is inside it — `c.1490G`, `4q35.2`, `C5-6` — because
 * the halves a name is made of are not names on their own. See
 * `WHOLE_TOKEN_NAME_SHAPES`.
 *
 * Only a token no whole shape recognises is split, and then every part
 * has to be a name, so a value with a unit welded on (`22.5kg/m2`)
 * still fails on the part that is neither.
 */
const tokenIsName = (token: string): boolean => {
  const t = token
    .trim()
    .toLowerCase()
    .replace(/[.,:]+$/, '');
  if (!/\d/.test(t)) return true; // no digit — nothing to mask
  if (WHOLE_TOKEN_NAME_SHAPES.some((shape) => shape.test(t))) return true;
  const parts = t.split(/[.,:/^+~-]/).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => partIsName(part));
};

interface MaskResult {
  readonly text: string;
  readonly masked: number;
  /** A digit survived that this gate cannot account for. Fails closed.
   *  See `maskMeasurements`. */
  readonly unclassified: boolean;
}

/** The protected spans OF A GIVEN STRING — and it takes the string as
 *  an argument for the reason `maskMeasurements` gives. */
const nameSpansIn = (text: string): { start: number; end: number }[] => {
  const spans: { start: number; end: number }[] = enumeratedOrdinalSpans(text);
  for (const pattern of NAME_SPAN_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return spans;
};

/**
 * A token is protected only when a name span CONTAINS it, not when it
 * merely touches one. A token that straddles the edge of a span is a
 * token this gate cannot account for, and doubt masks: 「V1-V3导联」
 * straddles the 「3导联」 span and is answered by the Latin name shapes
 * instead, while a measurement that happens to abut a name span gets no
 * free ride out of the adjacency.
 */
const containedInNameSpan = (
  spans: readonly { start: number; end: number }[],
  start: number,
  end: number,
): boolean => spans.some((span) => span.start <= start && end <= span.end);

/**
 * GATE 2 — MASK THE MEASUREMENTS, KEEP THE CLINICAL LANGUAGE.
 *
 * What survives is the language and the structure:
 * 「双侧大腿脂肪浸润约 [数值未共享]，肩胛带肌未见异常」 still tells the
 * model the finding, its laterality, its site and the negative beside
 * it. A masked number inside a negation keeps its negation:
 * 「未检出3个重复单元」 masks to 「未检出[数值未共享]个重复单元」 and still
 * reads as a negation, because the mask replaces the number and touches
 * nothing else.
 *
 * THEN IT CHECKS ITSELF, and that is the half that fails closed. Every
 * ASCII digit left standing is re-classified from scratch: if any of
 * them is not inside a name span or a token this gate calls a name, the
 * WHOLE field is withheld.
 *
 * AND THE SPANS ARE COMPUTED AGAINST THE STRING BEING SCANNED, WHICH IS
 * THE BUG THIS SIGNATURE EXISTS TO MAKE IMPOSSIBLE. They used to be
 * computed once, as offsets into the RAW string, and then re-used by the
 * verification pass while it iterated the MASKED one. The marker is
 * seven characters and it replaces tokens as short as one, so everything
 * after the first mask was shifted, and the drift cut both ways: a
 * protected name fell outside its own stale span and the field was
 * withheld — an eligible report silenced — while a real measurement
 * landed inside a stale span and was PUBLISHED under strict consent.
 * `nameSpansIn` therefore takes the text it is describing, and each pass
 * asks it about its own string.
 */
const maskMeasurements = (raw: string): MaskResult => {
  const rawSpans = nameSpansIn(raw);

  let masked = 0;
  const text = raw.replace(ASCII_TOKEN, (token, ...rest) => {
    const offset = rest[rest.length - 2] as number;
    if (containedInNameSpan(rawSpans, offset, offset + token.length)) return token;
    if (tokenIsName(token)) return token;
    masked += 1;
    return MEASUREMENT_MARKER;
  });

  // The independent second reading, against ITS OWN string.
  // `MEASUREMENT_MARKER` carries no ASCII digit of its own, so anything
  // found here came off the page.
  const maskedSpans = nameSpansIn(text);
  let unclassified = false;
  for (const match of text.matchAll(new RegExp(ASCII_TOKEN.source, 'g'))) {
    if (!/\d/.test(match[0])) continue;
    if (containedInNameSpan(maskedSpans, match.index, match.index + match[0].length)) continue;
    if (!tokenIsName(match[0])) unclassified = true;
  }
  return { text, masked, unclassified };
};

// ------------------------------------------------------------ the channel

/**
 * A FREE-TEXT CHANNEL: the key a retriever offers prose under, and the
 * keys its gated form reaches the prompt under.
 *
 * A table rather than a branch, so that a retriever adding a free-text
 * field adds a row here and gets all three gates — and cannot publish
 * one without, because the published value has to be a `GatedFreeText`
 * and `gateFreeText` is the only thing that makes one.
 */
interface FreeTextChannel {
  /** What the retriever calls it. On NEITHER allowlist: layer 3 drops
   *  the raw cell and the audit row shows that it did. */
  readonly input: string;
  /**
   * WHETHER THIS CHANNEL PUBLISHES AT ALL.
   *
   * `false` means the gates are never run for it and none of its five
   * keys is written, which is a different and stronger statement than
   * 「the keys are not on the allowlist」: nothing is computed, nothing
   * is dropped, and the audit row says nothing, because there was no
   * attempt to publish for an audit to describe.
   *
   * It is a property of the CHANNEL rather than a branch in the loop
   * below, so a second channel added to this table gets its own answer
   * instead of inheriting this one's.
   */
  readonly enabled: boolean;
  readonly text: string;
  readonly withheld: string;
  readonly valuesMasked: string;
  readonly identifiersRemoved: string;
  readonly charactersCut: string;
}

/** THE KEY THE REPORTS RETRIEVER OFFERS THE REPORT'S OWN IMPRESSION
 *  UNDER. Named here rather than inline because gate 0 reads it whether
 *  or not the channel publishes — see `documentEligibility` in
 *  `redactFields`. */
const REPORT_IMPRESSION_INPUT = 'reportImpressionAsPrinted';

const FREE_TEXT_CHANNELS: Readonly<Record<RedactionScope, readonly FreeTextChannel[]>> = {
  profile: [],
  followups: [],
  reports: [
    {
      input: REPORT_IMPRESSION_INPUT,
      // THE SWITCH. One constant, declared and argued in
      // security/allowlist.ts, and read here and in exactly the places
      // that DESCRIBE this channel to somebody — the allowlist, the
      // renderer's label table, `get_my_reports`'s description. None of
      // those may be able to disagree with this one.
      enabled: REPORT_IMPRESSION_CHANNEL_ENABLED,
      ...REPORT_IMPRESSION_KEYS,
    },
  ],
};

/**
 * THE ONLY PLACE A `GatedFreeText` IS MINTED.
 *
 * Runs the three gates in order and returns what the channel may
 * publish. Every refusal returns `text: null` WITH a reason, never a
 * silent drop.
 */
const gateFreeText = (
  raw: string,
  options: {
    readonly eligibility: Eligibility;
    readonly knownIdentifiers: readonly string[];
    readonly mode: RedactionMode;
  },
): FreeTextOutcome => {
  const refuse = (withheld: string): FreeTextOutcome => ({
    text: null,
    withheld,
    valuesMasked: 0,
    identifiersRemoved: 0,
    charactersCut: 0,
  });

  // Gate 0.
  if (options.eligibility === 'narrative') return refuse(FREE_TEXT_REFUSALS.narrative);
  if (options.eligibility !== 'result') return refuse(FREE_TEXT_REFUSALS.unknownKind);

  // Gate 1.
  const scrubbed = scrubIdentifiers(raw, options.knownIdentifiers);
  if (scrubbed.unsafe) return refuse(FREE_TEXT_REFUSALS.identifiers);

  // THE CAP, AND IT RUNS BEFORE GATE 2 RATHER THAN AFTER IT.
  //
  // It used to run last, over the text gate 2 had just EXPANDED — every
  // masked measurement is one to four characters replaced by a
  // seven-character marker. So an impression that fitted under the cap
  // in precise mode crossed it in strict, and the patient who consented
  // to LESS lost the tail of the sentence as well as its numbers. In a
  // Chinese impression the tail is where 结论 lives, so the strict
  // reader lost the conclusion and the precise reader kept it. Cutting
  // the identifier-scrubbed text means both modes cut at the same place
  // in the same sentence, and the mode decides only what is masked
  // inside what survives.
  //
  // The published string may therefore exceed `SAFE_VALUE_MAX_LENGTH`
  // by the mask expansion. That is deliberate and it is the smaller
  // cost: the constant is a bound on how much of a report's prose
  // travels, and a marker is this platform's own word, not the report's.
  //
  // AND THE CUT NEVER LANDS INSIDE A MARKER. A slice through
  // 「[数值未共享]」 leaves an unclosed bracket, or — worse — removes
  // enough of it that the sentence reads as merely truncated while
  // `valuesMasked` still claims a value was masked there. So the cut is
  // pulled back to the start of any marker it would have opened.
  let charactersCut = 0;
  let body = scrubbed.text.trim();
  if (body.length > SAFE_VALUE_MAX_LENGTH) {
    const cut = cutBeforeAnyOpenMarker(body, SAFE_VALUE_MAX_LENGTH);
    charactersCut = body.length - cut;
    body = `${body.slice(0, cut)}${TRUNCATION_MARKER}`;
  }

  // Gate 2.
  let valuesMasked = 0;
  if (options.mode === 'strict') {
    const gated = maskMeasurements(body);
    if (gated.unclassified) return refuse(FREE_TEXT_REFUSALS.unclassifiedValue);
    body = gated.text;
    valuesMasked = gated.masked;
  }

  return {
    text: body as GatedFreeText,
    withheld: null,
    valuesMasked,
    identifiersRemoved: scrubbed.removed,
    charactersCut,
  };
};

/**
 * THE REPORT-IMPRESSION CHANNEL, AS ONE CALL, OVER A RETRIEVER'S RAW
 * OFFERING.
 *
 * `redactFields` runs EXACTLY this and then publishes what comes back;
 * there is no second copy of the wiring. It is exported for that
 * reason and one other: the channel's tests drive it directly, so the
 * three gates and the corpus behind them are exercised on every CI run
 * whether or not `REPORT_IMPRESSION_CHANNEL_ENABLED` lets the answer
 * reach a prompt. A switch that silently stopped a hundred tests from
 * running would rot the thing it was supposed to preserve.
 *
 * It reads the document afresh — eligibility off the page WITH the
 * impression folded in, the known identifiers off the cells layer 1 is
 * about to delete — so a caller cannot hand it a weaker view of the
 * document than the redactor has.
 *
 * `null` means the report stated no impression: nothing to gate, and
 * nothing to say was withheld.
 */
export const gateReportImpression = (
  fields: Record<string, unknown>,
  options: { readonly mode: RedactionMode },
): FreeTextOutcome | null => {
  const raw = fields[REPORT_IMPRESSION_INPUT];
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  return gateFreeText(raw, {
    eligibility: documentEligibility(chunkDocument(fields), raw),
    knownIdentifiers: identifierValuesInInput(fields, 0, new Set<object>()),
    mode: options.mode,
  });
};

/**
 * IS THIS STRING FREE TEXT, OR IS IT A CELL?
 *
 * THE GATES USED TO GOVERN ONE KEY. `FREE_TEXT_CHANNELS` wired all three
 * of them into `reportImpressionAsPrinted` and nothing else, and free
 * text does not only arrive there:
 *
 *   - `ecgSummary`, `conductionAbnormality` and `fattyInfiltration` are
 *     on `OCR_FIELDS_SAFE_KEYS_PRECISE` and hold prose. Under precise
 *     consent they were published with NO ELIGIBILITY TEST AT ALL, so
 *     one chunk could refuse the impression of a 病历摘要 as a narrative
 *     about a person and print that document's narrative prose in the
 *     row underneath.
 *   - `familyHistory` is free text the PATIENT typed, it is on both
 *     profile allowlists, and the channel table read `profile: []`. So
 *     it got no measurement gate — which is the consent hole this whole
 *     design exists to close, on the one field where the text is not
 *     even a clinician's.
 *
 * The answer cannot be a longer channel table, for the reason every
 * other list in this file had to stop being a list. It is a question
 * asked of the VALUE, so a free-text field a future retriever adds is
 * covered on the commit that adds it rather than on the commit somebody
 * remembers to declare it.
 *
 * WHAT MAKES A STRING FREE TEXT, and the test is deliberately generous
 * in the direction of gating:
 *
 *   - it is not a MACHINE TOKEN. `not_read_off_a_laboratory_report`,
 *     `within_fshd1_repeat_range_grey_zone_8_to_10`, `muscle_mri`,
 *     `4qA` and `FSHD1` are strings this module or this repo minted, and
 *     they are `^[A-Za-z0-9_]+$`. Gating them would mask the digits out
 *     of this platform's own readings, which is the opposite of what
 *     any of this is for; AND
 *   - it carries a sentence delimiter, OR runs past eight characters, OR
 *     welds a digit onto a Chinese character. That last clause is what
 *     catches 「外婆45岁发病」 — five characters and no punctuation, and
 *     the age in the middle of it is exactly the precise value the
 *     strict consent withheld.
 *
 * WHAT IS STILL NOT COVERED, stated rather than implied: a SHORT
 * digit-free Chinese enum on a narrative document — 「窦性心动过缓」, six
 * characters — reads as a cell and is published. It carries no
 * measurement and no identifier shape; what it carries is a fact about
 * a person's heart, off a document gate 0 would have silenced. That
 * residual is bounded by the length rule and by nothing else.
 */
/**
 * WHICH SCOPES CAN CARRY TEXT THIS PLATFORM DID NOT COMPOSE — which is
 * the question gate 2 is actually asking of a string, and it cannot be
 * asked of the string itself.
 *
 * `eventSummary` on the follow-ups scope reads 「跌倒（轻）×1，最近 3 天
 * 前」 and `looksLikeFreeText` says yes about it, correctly: it is a
 * sentence with punctuation and digits. But it is a sentence THIS
 * PLATFORM wrote out of rows the patient recorded, and the numbers in it
 * are `count` and `spanDays` — both of which sit on the follow-ups
 * STRICT allowlist by name, three lines apart. Masking them would have
 * the redactor contradicting the allowlist beside it.
 *
 * The follow-ups scope is the one that cannot carry foreign prose, and
 * its own allowlist says why in as many words: the patient's free-text
 * `notes` and event `description` are 「deliberately absent from BOTH
 * modes」. What is left there is composed here. The profile scope carries
 * `familyHistory`, which the patient types; the reports scope carries an
 * OCR bridge's output. Both of those are foreign prose and both are
 * gated.
 *
 * GATE 1 IS NOT ON THIS TABLE and runs everywhere regardless: nobody
 * consented to identifiers, on any scope, whoever composed the sentence.
 */
const SCOPES_CARRYING_FOREIGN_PROSE: Readonly<Record<RedactionScope, boolean>> = {
  profile: true,
  reports: true,
  followups: false,
};

const MACHINE_TOKEN = /^[A-Za-z0-9_]+$/;
const SENTENCE_DELIMITER = /[，,；;。、：:]/;
const DIGIT_WELDED_TO_HAN = /(?:[一-龥]\s*\d|\d\s*[一-龥])/;
const FREE_TEXT_MIN_LENGTH = 8;

const looksLikeFreeText = (value: string): boolean => {
  const text = value.trim();
  if (!text) return false;
  if (MACHINE_TOKEN.test(text)) return false;
  return (
    SENTENCE_DELIMITER.test(text) ||
    text.length > FREE_TEXT_MIN_LENGTH ||
    DIGIT_WELDED_TO_HAN.test(text)
  );
};

/**
 * EVERY STRING LAYER 3 KEPT, THROUGH THE SAME GATES, AT ANY DEPTH.
 *
 * Gate 1 positioned literally last. The channel above has already run
 * it over the impression — running it again is a no-op, the markers
 * carry no identifiers — and this pass is what makes the claim 「the
 * identifier scrub sits at the last point before text leaves the
 * server」 true of the OTHER strings too: a precise-mode OCR cell, a
 * profile's free-typed 家族史, whatever a future retriever adds. A
 * string this pass cannot make safe is DROPPED rather than published,
 * which is the same fail-closed answer the channel gives.
 *
 * AND GATES 0 AND 2 WITH IT, over the strings `looksLikeFreeText`
 * answers yes about. That is the by-construction half: the three gates
 * are properties of PROSE reaching a prompt, not properties of one key.
 *
 *   - Gate 0 is asked only where there is a document to judge, which is
 *     the reports scope. A profile field is something the patient typed
 *     about themselves, not a document whose kind can be classified, so
 *     there is nothing for eligibility to read and it is not asked.
 *   - Gate 2 is asked on every scope, because the consent it enforces
 *     is the patient's and does not depend on where the prose came from.
 *
 * The known-identifier values are not passed here: they are the
 * document's own name cells, and layer 1 has already deleted the cells
 * this pass walks. What is left to find is the self-announcing shapes.
 */
interface KeptValueGate {
  readonly mode: RedactionMode;
  /** Whether gates 0 and 2 are asked of this scope's prose at all. See
   *  `SCOPES_CARRYING_FOREIGN_PROSE`. */
  readonly gatesProse: boolean;
  /** `null` on a scope with no document to classify. */
  readonly eligibility: Eligibility | null;
  /** Paths already published BY a channel, which have been through all
   *  three gates under the channel's own accounting and must not be
   *  gated a second time — a second mask pass would count the same
   *  measurement twice and a second cap would truncate a truncation. */
  readonly channelKeys: ReadonlySet<string>;
}

const scrubKeptValue = (
  value: unknown,
  path: string[],
  scrubbed: string[],
  gated: string[],
  depth: number,
  options: KeptValueGate,
): { keep: boolean; value: unknown } => {
  if (typeof value === 'string') {
    const here = path.join('.');
    if (path.length === 1 && options.channelKeys.has(path[0])) {
      return { keep: true, value };
    }
    const result = scrubIdentifiers(value, []);
    if (result.unsafe) {
      scrubbed.push(`${here} (withheld)`);
      return { keep: false, value: undefined };
    }
    if (result.removed > 0) scrubbed.push(here);
    let text = result.text;
    if (options.gatesProse && looksLikeFreeText(text)) {
      // Gate 0 — prose off a document this platform will not send prose
      // from goes nowhere, whatever key it arrived under.
      if (options.eligibility !== null && options.eligibility !== 'result') {
        gated.push(`${here} (${options.eligibility})`);
        return { keep: false, value: undefined };
      }
      // Gate 2 — the measurements, under strict consent.
      if (options.mode === 'strict') {
        const masked = maskMeasurements(text);
        if (masked.unclassified) {
          gated.push(`${here} (unclassified value)`);
          return { keep: false, value: undefined };
        }
        if (masked.masked > 0) gated.push(here);
        text = masked.text;
      }
    }
    return { keep: true, value: text };
  }
  if (depth >= MAX_NESTING_DEPTH) return { keep: false, value: undefined };
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    value.forEach((item, index) => {
      const inner = scrubKeptValue(
        item,
        [...path, String(index)],
        scrubbed,
        gated,
        depth + 1,
        options,
      );
      if (inner.keep) out.push(inner.value);
    });
    return { keep: true, value: out };
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const inner = scrubKeptValue(item, [...path, key], scrubbed, gated, depth + 1, options);
      if (inner.keep) out[key] = inner.value;
    }
    return { keep: true, value: out };
  }
  return { keep: true, value };
};

/**
 * THE NAMES THIS DOCUMENT ITSELF FILED UNDER AN IDENTIFIER KEY.
 *
 * Read off the redactor's INPUT, before layer 1 deletes the cells, for
 * the same reason the laboratory gate is: they are gone by the time
 * anything downstream could use them. `HARD_DELETE_KEYS_LOWER` is the
 * identifier vocabulary this module already keeps — the extended one,
 * not a second copy — so a key added there starts protecting free text
 * on the same commit it starts being deleted.
 *
 * The values are used ONLY to find their own occurrences inside prose
 * and replace them; none of them is ever published. This is the one
 * mechanism that reaches a Chinese personal name with no label in front
 * of it, which is why it is worth reading a deleted cell to get.
 */
const identifierValuesInInput = (
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  underIdentifierKey = false,
  out: string[] = [],
): string[] => {
  if (typeof value === 'string') {
    if (underIdentifierKey && value.trim()) out.push(value);
    return out;
  }
  if (typeof value !== 'object' || value === null) return out;
  if (depth >= MAX_NESTING_DEPTH || ancestors.has(value)) return out;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        identifierValuesInInput(item, depth + 1, ancestors, underIdentifierKey, out);
      }
      return out;
    }
    for (const [key, item] of Object.entries(value)) {
      identifierValuesInInput(
        item,
        depth + 1,
        ancestors,
        underIdentifierKey || HARD_DELETE_KEYS_LOWER.has(key.toLowerCase()),
        out,
      );
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
};

// ---------------------------------------------------------------- public

export const redactFields = (
  fields: Record<string, unknown>,
  options: RedactOptions,
): RedactionOutcome => {
  const { scope, mode, logger } = options;
  const stats: RedactionStats = {
    hardDeleted: [],
    clinicalised: [],
    notAllowed: [],
    identifiersScrubbed: [],
    freeTextGated: [],
  };

  // THE LABORATORY GATE IS ASKED OF THE INPUT, BEFORE LAYER 1, and its
  // answer is carried to layer 2b below.
  //
  // The question reads the document's own page (see
  // `chunkIsLaboratoryGeneticReport`), and the page is on
  // `HARD_DELETE_KEYS` — so asking it after layer 1, where it used to
  // be asked, would be asking it of a projection the page had just been
  // deleted from, which is the state the gap it closes was measured in.
  // Everything else the question reads (`classifiedType` inside the
  // blob, `documentType`, `status`) survives layer 1 untouched, so the
  // answer is the same one the old call site computed wherever no page
  // is present.
  const fromLaboratoryReport = scope === 'reports' && chunkIsLaboratoryGeneticReport(fields);

  // LAYER 4'S INPUT IS READ HERE, FOR THE SAME REASON AND OFF THE SAME
  // MAP.
  //
  // Gate 0 reads the document's own page, which layer 1 deletes, and it
  // reads it WITH the impression folded in — the sentence that makes a
  // 病历摘要 a narrative is often in the impression cell itself. So the
  // raw impression is read off the input, carried, and used at the end.
  //
  // IT IS READ WHETHER OR NOT THE CHANNEL PUBLISHES. With the switch
  // off nothing is published from it, but gate 0's answer still governs
  // every OTHER piece of prose on this chunk (see `scrubKeptValue`), and
  // showing that gate less of the document than the document contains
  // would make the switch a privacy change. It is not one.
  const impressionInput = fields[REPORT_IMPRESSION_INPUT];
  const impressionRaw = typeof impressionInput === 'string' ? impressionInput : '';

  // Layer 1 — recursive hard-delete (covers nested OCR blobs).
  const layer1 = hardDelete(fields);
  stats.hardDeleted = layer1.removed;
  let working = layer1.cleaned;

  // Layer 2 — this platform's reading of the top-level cells (D4Z4 /
  // haplotype → _clinical, diagnosisDate → year), in both modes. Which
  // raw originals survive it is what the mode decides; whether the
  // reading is stated is not.
  const layer2 = clinicalise(working, scope, mode);
  stats.clinicalised = layer2.changed;
  working = { ...working, ...layer2.added };
  for (const k of layer2.drop) {
    delete working[k];
  }

  // Layer 2b — OCR `fields` projection. Runs in **both** modes
  // because precise mode otherwise let the raw OCR blob through
  // verbatim (PR #23 follow-up). Strict mode emits `fields_clinical`
  // with clinicalised values; precise mode emits `fields` with raw
  // values plus this platform's reading of the genetics cells among
  // them, and only for keys we explicitly trust as structured /
  // non-PII. Free-form OCR keys are dropped in both modes.
  if (scope === 'reports' && isPlainObject(working.fields)) {
    const projected = projectOcrFields(working.fields, mode, fromLaboratoryReport);
    if (mode === 'strict') {
      working.fields_clinical = projected;
      delete working.fields;
    } else {
      working.fields = projected;
    }
    stats.clinicalised.push('fields');
  }

  // Layer 3 — always.
  const layer3 = filterByAllowlist(working, scope, mode);
  stats.notAllowed = layer3.dropped;
  const kept = layer3.kept;

  // Layer 4 — the three gates on free text, LAST. See the block above
  // `GatedFreeText`. The allowlist is still the authority on which keys
  // exist: a channel key that is not on `PROMPT_ALLOWLIST[scope][mode]`
  // publishes nothing, so adding a channel without allowlisting it
  // fails visibly rather than smuggling a field past layer 3.
  const allowed = new Set(PROMPT_ALLOWLIST[scope][mode]);

  // GATE 0 IS ASKED ONCE, ABOUT THE DOCUMENT, and its answer governs
  // every piece of prose on this chunk rather than one key — see
  // `looksLikeFreeText`. It is asked WITH the impression folded into the
  // page, which is what `documentEligibility` needs and what the loop
  // below used to ask per channel.
  //
  // `null` on a scope with no document to classify: a profile field is
  // something the patient typed about themselves, not a document whose
  // kind exists to be read.
  const eligibility =
    scope === 'reports' ? documentEligibility(chunkDocument(fields), impressionRaw) : null;

  const channelKeys = new Set<string>();
  for (const channel of FREE_TEXT_CHANNELS[scope]) {
    // A channel publishing under its own key must not leave the raw
    // value standing when a gate refuses — or when the switch means
    // there was no gate run at all. `put` skips a null, so the key is
    // cleared first and only written back if something survived.
    delete kept[channel.text];
    // THE SWITCH, AT THE ONE POINT WHERE ANYTHING WOULD BE PUBLISHED.
    // Off, the gates are not run and none of the five keys is written —
    // not the text, not a marker, not a zero. `stats` stays silent too:
    // there was no attempt to publish for the audit row to describe.
    if (!channel.enabled) continue;
    const outcome = gateReportImpression(fields, { mode });
    if (!outcome) continue;
    const put = (key: string, value: unknown) => {
      if (value === null || value === 0) return;
      if (!allowed.has(key)) {
        stats.notAllowed.push(key);
        return;
      }
      kept[key] = value;
      channelKeys.add(key);
    };
    put(channel.text, outcome.text);
    put(channel.withheld, outcome.withheld);
    put(channel.valuesMasked, outcome.valuesMasked);
    put(channel.identifiersRemoved, outcome.identifiersRemoved);
    put(channel.charactersCut, outcome.charactersCut);
  }

  // ...and all three gates over everything else layer 3 kept, at any
  // depth. See `scrubKeptValue` and `looksLikeFreeText`.
  const walked = scrubKeptValue(kept, [], stats.identifiersScrubbed, stats.freeTextGated, 0, {
    mode,
    gatesProse: SCOPES_CARRYING_FOREIGN_PROSE[scope],
    eligibility,
    channelKeys,
  });
  const final = walked.keep ? (walked.value as Record<string, unknown>) : {};

  if (logger && layer3.dropped.length > 0) {
    logger.warn(
      { scope, mode, droppedKeys: layer3.dropped },
      'pii_redactor: dropped fields not in PROMPT_ALLOWLIST',
    );
  }
  if (logger && stats.identifiersScrubbed.length > 0) {
    logger.warn(
      { scope, mode, scrubbed: stats.identifiersScrubbed },
      'pii_redactor: identifiers removed from free text before the prompt',
    );
  }
  if (logger && stats.freeTextGated.length > 0) {
    logger.warn(
      { scope, mode, gated: stats.freeTextGated },
      'pii_redactor: free text gated for eligibility or measurements before the prompt',
    );
  }

  return { fields: final, stats };
};
