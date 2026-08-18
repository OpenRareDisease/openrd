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
 *             `clinicaliseMethylation` is the one that stays strict-
 *             only, and for the opposite reason: its output is not a
 *             reading. `value_withheld` is a statement about what was
 *             shared, and beside a shared value it would be false.
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
} from './allowlist.js';
import type { AppLogger } from '../../../config/logger.js';
import { isLaboratoryGeneticReport } from '../../patient-profile/genetic-evidence.js';
import {
  FSHD1_MAX_REPEAT_UNITS,
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

const ageGroupFromDate = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  if (!Number.isFinite(year)) return null;
  const age = new Date().getUTCFullYear() - year;
  if (age < 0 || age > 120) return null;
  if (age < 18) return 'under_18';
  if (age < 30) return '18_29';
  if (age < 40) return '30_39';
  if (age < 50) return '40_49';
  if (age < 60) return '50_59';
  if (age < 70) return '60_69';
  return '70_plus';
};

/**
 * Is this value a qualitative result rather than a measurement?
 *
 * Qualitative results survive strict mode — see `projectOcrFields` for
 * the OCR blob and `clinicaliseMethylation` for the genetics cell. The
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
const clinicaliseD4Z4 = (raw: unknown, fromLaboratoryReport: boolean): string | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const reading = readSizeCell(String(raw));
  if (reading === null) return null;
  if (!fromLaboratoryReport) return NOT_A_LABORATORY_READING;
  if (isDeterminateRepeatCount(reading)) {
    return reading.value > FSHD1_MAX_REPEAT_UNITS
      ? 'above_fshd1_repeat_range'
      : 'within_fshd1_repeat_range';
  }
  // The kb branch comes first, because a kb cell reading 0 is a length
  // and not an unreadable count — the same order `zeroRepeatCount`
  // keeps by gating itself on the unit.
  if (reading.unit === 'kb' && reading.value !== null) return 'length_in_kb_not_a_repeat_count';
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
 * THE ONE HELPER HERE THAT IS ASKED IN STRICT MODE ALONE, because
 * neither branch of it is a reading. `value_withheld` is a statement
 * about what the patient shared, and printed beside the shared number
 * it would be false; the laboratory's own word is the cell itself,
 * which precise mode already prints. This platform has no judgement of
 * a methylation result to carry into the other mode — that is what the
 * paragraph above says, and it is why there is nothing here to keep.
 */
const clinicaliseMethylation = (raw: unknown): string | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string' && isQualitativeResult(raw)) return raw.trim();
  return 'value_withheld';
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
 */
const clinicaliseHaplotype = (raw: unknown, fromLaboratoryReport: boolean): string | null => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  if (!fromLaboratoryReport) return NOT_A_LABORATORY_READING;
  const permissive = parsePermissiveHaplotype(raw);
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

/** A free-text field long enough that it is evidently not the short
 *  value the key promised. Impressions in these reports run well under
 *  this; the observed ECG dump was 230+. */
const SAFE_VALUE_MAX_LENGTH = 200;

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

  for (const [key, value] of Object.entries(rawFields)) {
    if (key.includes('_') && camelKeys.has(toCamel(key)) && camelKeys.get(toCamel(key)) === value) {
      continue;
    }
    const lower = key.toLowerCase();
    /** The cell as the report printed it — precise mode only, and
     *  written before the reading so the two read in that order. */
    const emitRawUnderPrecise = () => {
      if (mode !== 'precise') return;
      if (value === null || value === undefined || value === '') return;
      out[key] = value;
    };
    if (lower.includes('d4z4')) {
      emitRawUnderPrecise();
      const v = clinicaliseD4Z4(value, fromLaboratoryReport);
      if (v !== null) out[`${key}_clinical`] = v;
    } else if (lower.includes('methylation')) {
      // Strict-only, and the reason is in `clinicaliseMethylation`:
      // neither of its answers is a reading to carry over.
      if (mode === 'strict') {
        const v = clinicaliseMethylation(value);
        if (v !== null) out[`${key}_clinical`] = v;
      } else {
        emitRawUnderPrecise();
      }
    } else if (lower.includes('haplotype')) {
      emitRawUnderPrecise();
      const v = clinicaliseHaplotype(value, fromLaboratoryReport);
      if (v !== null) out[`${key}_clinical`] = v;
    } else if (lower.includes('date')) {
      // Both modes: strip to year-only. Even in precise mode we don't
      // want the exact day-of-month leaving the server.
      const y = yearFromDate(value);
      if (y !== null) out[`${key}_year`] = y;
    } else if (OCR_FIELDS_SAFE_KEYS_PRECISE.has(key)) {
      if (value === null || value === undefined || value === '') continue;
      // A safe key is not a safe value — see isUntrustworthyValue.
      if (isUntrustworthyValue(value)) {
        droppedUntrusted.push(key);
        continue;
      }
      if (mode === 'precise') {
        out[key] = value;
      } else if (isQualitativeResult(value)) {
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
    if ('d4z4' in input) {
      // NEVER THE LABORATORY'S OWN READING, and not a judgement call:
      // this scope's `d4z4` and `haplotype` are
      // `baseline.diseaseBackground`, the boxes on the registration
      // form. The passport prints those with their own bracket and
      // refuses to grade them; so does this.
      const v = clinicaliseD4Z4(input.d4z4, false);
      if (v !== null) {
        added.d4z4_clinical = v;
        changed.push('d4z4');
      }
      if (dropRawCell) drop.add('d4z4');
    }
    if ('methylation' in input && mode === 'strict') {
      const v = clinicaliseMethylation(input.methylation);
      if (v !== null) {
        added.methylation_clinical = v;
        changed.push('methylation');
      }
      drop.add('methylation');
    }
    if ('haplotype' in input) {
      const v = clinicaliseHaplotype(input.haplotype, false);
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
    // OCR `fields` blob is handled in the top-level redact() flow now
    // (both modes need projection, not just strict). See projectOcrFields.
  }

  // Birthday handling lives outside the scope branch because both
  // profile and reports may carry one.
  //
  // NOTHING REACHES IT. `dateOfBirth`, `date_of_birth` and `birthday`
  // are all on HARD_DELETE_KEYS, so layer 1 removes the cell before
  // this function is ever handed it, and `ageGroup` is therefore
  // derived in neither mode — the assistant only ever sees an age band
  // when a retriever puts one there itself, which none does. Deriving
  // it would mean reading the birthday off the input before layer 1
  // runs, and that is a decision about what reaches an LLM rather than
  // a tidy-up, so it is left as it stands and stated here rather than
  // implied by the branch below.
  if ('dateOfBirth' in input) {
    const ageGroup = ageGroupFromDate(input.dateOfBirth);
    if (ageGroup !== null && !('ageGroup' in input)) {
      added.ageGroup = ageGroup;
      changed.push('dateOfBirth');
    }
    drop.add('dateOfBirth');
  }

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
