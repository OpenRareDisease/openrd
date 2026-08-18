/**
 * Three-layer PII redactor for patient-scoped retriever output.
 *
 * Operates on structured field maps (the `fields` retrievers expose in
 * their chunk metadata). Renders happen downstream in the
 * Context Builder, so the redactor never has to grep prose.
 *
 *   Layer 1 — hard delete: every key in `HARD_DELETE_KEYS` is removed
 *             unconditionally, in both strict and precise mode.
 *             These are pure identifiers with no clinical value.
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
 */

import type { RedactionMode, RedactionScope } from './allowlist.js';
import {
  HARD_DELETE_KEYS_LOWER,
  OCR_FIELDS_SAFE_KEYS_PRECISE,
  PROMPT_ALLOWLIST,
  SAFE_VALUE_MAX_LENGTH,
} from './allowlist.js';
import type { AppLogger } from '../../../config/logger.js';
import {
  GENETIC_FIELD_KEYS,
  isLaboratoryGeneticReport,
  pickReading,
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
}

export interface RedactionOutcome {
  fields: Record<string, unknown>;
  stats: RedactionStats;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- layer 1

/** Strip every key in HARD_DELETE_KEYS at any depth.
 *
 *  The previous implementation only inspected top-level keys, which
 *  meant nested OCR payloads (e.g. `metadata.fields.fields.patientName`
 *  from the patient_reports retriever) slipped through whenever the
 *  enclosing key itself was on the allowlist. Recursive removal closes
 *  that contract: "hard-delete keys never reach a prompt regardless of
 *  mode" now actually holds for nested objects too.
 *
 *  Only plain objects are descended into; arrays and primitives are
 *  left as-is — they cannot have keys to match.
 */
const hardDelete = (
  input: Record<string, unknown>,
  path: string[] = [],
): {
  cleaned: Record<string, unknown>;
  removed: string[];
} => {
  const cleaned: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (HARD_DELETE_KEYS_LOWER.has(key.toLowerCase())) {
      removed.push([...path, key].join('.'));
      continue;
    }
    if (isPlainObject(value)) {
      const nested = hardDelete(value, [...path, key]);
      cleaned[key] = nested.cleaned;
      for (const r of nested.removed) removed.push(r);
    } else {
      cleaned[key] = value;
    }
  }
  return { cleaned, removed };
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
 *  as a structured field. */
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
const ID_PATTERNS: readonly RegExp[] = [
  // Chinese record-number labels, with or without a value after them.
  /(住院号|门诊号|病历号|就诊号|登记号|标本号|样本号|条形码|检验号|影像号|身份证)/,
  // A bare identifier: a letter-prefixed run of digits (R000000), or a
  // long digit run (barcode, ID card).
  /\b[A-Za-z]{1,3}\d{5,}\b/,
  /\b\d{9,}\b/,
];

/** The length ceiling lives on `allowlist.ts` beside the key list whose
 *  premise it states, and is imported by the write-path schema as well
 *  — see `SAFE_VALUE_MAX_LENGTH` there for why it is not declared in
 *  this file. */
const isUntrustworthyValue = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length > SAFE_VALUE_MAX_LENGTH) return true;
  return ID_PATTERNS.some((pattern) => pattern.test(text));
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
 * The two members of that shape this projection has no value for are
 * the row's id and its upload time. Neither is read by the question —
 * they are `pickGeneticEvidenceDocument`'s ordering keys, and no pick
 * is being made here: the retriever hands over one document per chunk
 * and this is that one.
 */
const chunkIsLaboratoryGeneticReport = (chunk: Record<string, unknown>): boolean =>
  isLaboratoryGeneticReport({
    ocrPayload: { fields: chunk.fields },
    documentType: typeof chunk.documentType === 'string' ? chunk.documentType : null,
    status: typeof chunk.status === 'string' ? chunk.status : null,
    // Required by the shape, read by nothing on this path.
    id: '',
    uploadedAt: null,
  });

/** Project an OCR fields blob through a mode-specific filter.
 *
 *  In **both** modes this is deny-by-default: only keys we know how to
 *  scrub (d4z4 / methylation / haplotype / date), or that are on
 *  `OCR_FIELDS_SAFE_KEYS_PRECISE`, pass through. Free-form OCR keys —
 *  including `findings`, `impression`, unknown vendor-specific fields,
 *  anything the OCR happened to extract that we haven't reviewed — are
 *  dropped.
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

  // THE HAPLOTYPE THE SAME REPORT STATES, read once for the whole blob,
  // because the D4Z4 grey-zone note is about a 4qA array and this is
  // how the passport gates it. `pickReading` over
  // `GENETIC_FIELD_KEYS.haplotype` rather than a scan of this loop's
  // keys: that table is every spelling any writer in this pipeline has
  // ever produced for the cell, and reading it here with the passport's
  // own reader is what keeps 「is this a 4qA array」 one question with
  // one answer. See `WITHIN_FSHD1_REPEAT_RANGE_GREY_ZONE`.
  const haplotypePermissive = parsePermissiveHaplotype(
    pickReading(rawFields, GENETIC_FIELD_KEYS.haplotype),
  );

  for (const [key, value] of Object.entries(rawFields)) {
    if (key.includes('_') && camelKeys.has(toCamel(key)) && camelKeys.get(toCamel(key)) === value) {
      continue;
    }
    const lower = key.toLowerCase();
    /**
     * Publish the cell's own text, having asked whether it is the short
     * structured value its key promised. One helper for every branch
     * that publishes a raw cell, so that 「a safe key is not a safe
     * value」 cannot hold on the safe-key branch and quietly not hold on
     * the genetics ones. See `isUntrustworthyValue`.
     */
    const publishRawCell = (): void => {
      if (isUntrustworthyValue(value)) {
        droppedUntrusted.push(key);
        return;
      }
      out[key] = value;
    };
    /**
     * A GENETICS CELL AND THIS PLATFORM'S READING OF IT, PUBLISHED
     * TOGETHER OR NOT AT ALL.
     *
     * The cell as the report printed it goes first — precise mode only
     * — so the two read in that order; the reading follows in both
     * modes.
     *
     * THE INVARIANT IS ENFORCED HERE RATHER THAN REMEMBERED PER BRANCH.
     * Each branch used to call `emitRawUnderPrecise()` and then, quite
     * separately, write a `_clinical` sibling if one came back — two
     * statements with nothing tying them together, and one reader
     * returning `null` was all it took to break the pairing: a
     * haplotype cell holding an array published 「4qA、4qB」 under
     * precise consent with no reading of any kind beside it. A raw
     * genetics cell never reaches a prompt without this platform's
     * reading of it, and now it structurally cannot.
     *
     * AND THE CELL IS CHECKED AS A VALUE, NOT ONLY AS A KEY — the same
     * check `OCR_FIELDS_SAFE_KEYS_PRECISE` values get, applied here
     * because these keys skip that branch entirely. It used to write
     * `out[key] = value` with no value check at all, so the identical
     * production string — 「…年龄:23 … 科别:神经内科 … 住院号:R000000 …」
     * plus a patient's NAME — was dropped under `ecgSummary` and
     * published verbatim to the prompt under `d4z4Repeats`,
     * `haplotype` or `methylationValue`. The name is inside the cell
     * rather than under `patientName`, so layer 1 does not see it
     * either, and none of this needs an extractor regression to
     * reach: `EDITABLE_OCR_FIELDS` lets a patient hand-correct exactly
     * those cells through `patchDocumentOcrFields`, which spreads the
     * patch straight onto the stored fields.
     *
     * THE READING STILL GOES OUT. The refused thing is the cell's own
     * text, not this platform's reading of it — the model is told what
     * this platform makes of a cell it is not being shown, and
     * `fieldsDroppedAsUnsafe` tells it a cell was refused, exactly as
     * for a safe key whose value failed the same check.
     */
    const publishGeneticCell = (clinical: string | null) => {
      if (clinical === null) return;
      if (mode === 'precise' && value !== null && value !== undefined && value !== '') {
        publishRawCell();
      }
      out[`${key}_clinical`] = clinical;
    };
    if (lower.includes('d4z4')) {
      // 「other」 is how every spelling of the uncontracted allele's cell
      // names itself, and it has to be asked before the band. See
      // `clinicaliseOtherD4Z4Allele`.
      publishGeneticCell(
        lower.includes('other')
          ? clinicaliseOtherD4Z4Allele(value, fromLaboratoryReport)
          : clinicaliseD4Z4(value, fromLaboratoryReport, haplotypePermissive),
      );
    } else if (lower.includes('ecori')) {
      // The other size cell. See `clinicaliseEcoRIFragment` for why it
      // is read by its own reader and not by the one above.
      publishGeneticCell(clinicaliseEcoRIFragment(value, fromLaboratoryReport));
    } else if (lower.includes('methylation')) {
      // No reading, in either mode — see `methylationCell`. The word
      // survives as the cell it is; the measurement is counted with
      // every other withheld measurement rather than relabelled. What
      // it DOES carry now, in both modes, is where the value came from:
      // this cell sits beside siblings that state the refusal, and a
      // 病历摘要's quoted percentage used to sit there stating nothing.
      const survives = methylationCell(value, mode, fromLaboratoryReport);
      if (survives !== null) {
        if (survives.value === 'raw') publishRawCell();
        else withheldNumeric += 1;
        if (survives.origin !== null) out[`${key}_origin`] = survives.origin;
      }
    } else if (lower.includes('haplotype')) {
      publishGeneticCell(clinicaliseHaplotype(value, fromLaboratoryReport));
    } else if (lower.includes('date')) {
      // Both modes: strip to year-only. Even in precise mode we don't
      // want the exact day-of-month leaving the server.
      const y = yearFromDate(value);
      if (y !== null) out[`${key}_year`] = y;
    } else if (OCR_FIELDS_SAFE_KEYS_PRECISE.has(key)) {
      if (value === null || value === undefined || value === '') continue;
      // A safe key is not a safe value — see isUntrustworthyValue. The
      // check is asked once, here, so the strict branch below cannot
      // publish what the precise branch refused.
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
  /** The precise consent is to 「精确数值」, so it is the raw cell and
   *  only the raw cell that this keeps. */
  const dropRawCell = mode === 'strict';

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
    // The methylation cell asks the same question as its two siblings
    // now, so its flag is dropped on the same footing. NOTE: the
    // profile retriever does not yet WRITE this flag — see
    // `geneticCellsFromLaboratoryReport` in
    // retrievers/patient-profile.ts, which computes the answer for
    // `d4z4` and `haplotype` only — so the cell currently always reads
    // `not_read_off_a_laboratory_report`. That is the refusal, which is
    // the direction that only ever withholds; the flag is read here so
    // that the day the retriever answers for methylation too, an
    // autofilled laboratory value stops being refused.
    drop.add('methylationFromLaboratoryReport');
    // The haplotype the same profile records, for the D4Z4 grey-zone
    // gate — `permissiveHaplotype !== false`, the passport's own gate.
    // See `WITHIN_FSHD1_REPEAT_RANGE_GREY_ZONE`.
    const haplotypePermissive = parsePermissiveHaplotype(
      typeof input.haplotype === 'string' ? input.haplotype : null,
    );
    if ('d4z4' in input) {
      const v = clinicaliseD4Z4(
        input.d4z4,
        fromLaboratory('d4z4FromLaboratoryReport'),
        haplotypePermissive,
      );
      if (v !== null) {
        added.d4z4_clinical = v;
        changed.push('d4z4');
      }
      if (dropRawCell) drop.add('d4z4');
    }
    if ('methylation' in input) {
      // Not graded, in either mode — see `methylationCell`. Precise
      // keeps the cell; strict keeps the laboratory's own word and
      // withholds a number under a key that says the number is
      // withheld, rather than under one that says it was graded.
      //
      // AND IT STATES WHERE THE CELL CAME FROM, in both modes, under a
      // key that says origin rather than grade. `diseaseBackground.
      // methylation` is the registration form's own box; a percentage
      // typed into it used to reach the prompt as 「甲基化值: 12%」 with
      // nothing beside it, directly under two sibling readings that
      // both said `not_read_off_a_laboratory_report` about the very
      // same profile. Methylation is the FSHD2 discriminator.
      const survives = methylationCell(
        input.methylation,
        mode,
        fromLaboratory('methylationFromLaboratoryReport'),
      );
      if (survives !== null) {
        if (survives.value === 'withheld') {
          added.methylation_withheld = 'value_withheld';
          drop.add('methylation');
        }
        if (survives.origin !== null) {
          added.methylation_origin = survives.origin;
        }
        // `clinicalised` is the audit list of cells this pass acted on.
        // A laboratory's own qualitative word published untouched is
        // not one of them, so the push is conditional rather than
        // unconditional on the cell existing.
        if (survives.value === 'withheld' || survives.origin !== null) changed.push('methylation');
      }
    }
    if ('haplotype' in input) {
      const v = clinicaliseHaplotype(
        input.haplotype,
        fromLaboratory('haplotypeFromLaboratoryReport'),
      );
      if (v !== null) {
        added.haplotype_clinical = v;
        changed.push('haplotype');
      }
      if (dropRawCell) drop.add('haplotype');
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
  };

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
    const projected = projectOcrFields(
      working.fields,
      mode,
      chunkIsLaboratoryGeneticReport(working),
    );
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

  if (logger && layer3.dropped.length > 0) {
    logger.warn(
      { scope, mode, droppedKeys: layer3.dropped },
      'pii_redactor: dropped fields not in PROMPT_ALLOWLIST',
    );
  }

  return { fields: layer3.kept, stats };
};
