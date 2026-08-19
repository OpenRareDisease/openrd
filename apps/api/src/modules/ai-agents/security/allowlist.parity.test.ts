/**
 * THE OCR ALLOWLIST AGAINST WHAT ACTUALLY WRITES THE PAYLOAD.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE QUESTION THIS FILE ANSWERS
 * ══════════════════════════════════════════════════════════════════════
 *
 * `OCR_FIELD_LABELS_ZH` is a hand-maintained inventory of every OCR cell
 * that may be named in a prompt, and three rounds of review have found
 * gaps in it — each time the same two shapes, in opposite directions:
 *
 *   - A CELL THE PIPELINE WRITES AND THE LIST DOES NOT CARRY. It is
 *     dropped by deny-by-default INSIDE `projectOcrFields`, before
 *     anything counts, so it appears neither in `notAllowed` nor in
 *     `numericValuesWithheld`. The whole 尿常规 panel was in this state:
 *     seventeen cells, no entry for any of them, and a synthetic
 *     urinalysis rendered as its report type and one row with both
 *     「something was withheld」 statistics reading zero. The assistant is
 *     told a urinalysis exists and shown an empty one.
 *   - A CELL THE LIST CARRIES AND NOTHING WRITES. It reads to the next
 *     maintainer as evidence the key is live, and it is what
 *     `get_my_reports`' description is written from — the `ageGroup`
 *     defect, which the profile scope's own comment describes from the
 *     other side. `testMethod` / `test_method` / `methodology` sat here
 *     while the spelling the bridge really mints,
 *     `geneticTestMethod`, was denied; and the flag/interval derivation
 *     minted a sibling for every SNAKE analyte spelling as well as every
 *     camel one, forty-four keys that
 *     `writeReading` in services/ocr/embedded-report-ocr.ts cannot write
 *     because it writes `flagKey(toCamelCase(key))` and nothing else.
 *
 * CAN THE LIST BE DERIVED INSTEAD OF CHECKED? No, and the reason is
 * worth stating rather than being rediscovered. The list is not a set of
 * key names; it is a set of key names EACH PAIRED WITH CHINESE, and with
 * a decision about which of four tables it belongs to — identity,
 * genetics, measured, qualitative — because that placement is what
 * decides whether the cell gets a 异常标记 and a 参考区间 sibling and
 * whether the redactor's genetics readers are dispatched over it. Neither
 * the Chinese nor the placement is recoverable from the parser: the
 * parser knows `eos_pct` and the regexes that find it, not that it is
 *「嗜酸性粒细胞百分比」 and not that a laboratory prints an interval
 * against it. A derivation would have to invent both, and inventing
 * clinical vocabulary is the one thing this list must not do.
 *
 * SO IT IS CHECKED, IN BOTH DIRECTIONS, AND EVERY KEY IS ACCOUNTED FOR.
 * The parser's field names are read out of the Python source; each is
 * either on the allowlist or on `DECLINED` with a reason, and each key on
 * the allowlist is either parser-produced, a derived sibling, minted by
 * the bridge, or a declared legacy spelling. There is no fourth answer
 * and no silent one: a new analyte in the parser fails this file until
 * somebody has either named it in Chinese or written down why it is not
 * going to a model.
 *
 * WHY IT READS THE PYTHON AS TEXT. Same reason
 * `humanize-allowlist-parity.test.ts` reads this package's source as
 * text: a Node test cannot import a Python module, and this is a check on
 * lists of strings rather than on behaviour. Every parser below throws
 * rather than returning nothing, so a rename on the Python side fails
 * this file loudly instead of quietly stopping checking anything.
 *
 * WHAT IT DOES NOT CHECK. Whether the Chinese is RIGHT — no test can ask
 * that. And `table_*` keys, which the parser mints from arbitrary printed
 * analyte names and which are excluded from the allowlist by design; see
 * `_append_generic_table_fields`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  OCR_FIELDS_SAFE_KEYS_PRECISE,
  OCR_FIELD_LABELS_ZH,
  OCR_FLAG_SUFFIX,
  OCR_REFERENCE_SUFFIX,
  flagKey,
  referenceKey,
} from './allowlist.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PARSER_SOURCE = path.resolve(
  HERE,
  '../../../../../report-manager/app/services/fshd_report_service.py',
);

/** `toCamelCase` in services/ocr/embedded-report-ocr.ts, which is what
 *  turns a parser field name into the second spelling the bridge writes.
 *  Copied rather than imported because it is private to that module and
 *  because a copy that drifts is caught here: the camel spelling it
 *  produces has to be on the allowlist too. */
const toCamelCase = (value: string): string =>
  value.replace(/_([a-z])/g, (_match, chr: string) => chr.toUpperCase());

// ─────────────────────────────────────────────────── reading the parser

/**
 * The dict literals whose KEYS are field names.
 *
 * `row_patterns` in `_extract_diaphragm_ultrasound` is deliberately not
 * here: its keys are 「left」/「right」 and the field name is composed as
 * `f"{side}_{suffix}"`, and every name it can compose is already a key of
 * `metric_definitions` in the same function. The same holds for
 * `table_patterns` in `_extract_pulmonary`, whose composed
 * `{field}_pred_pct` names are all keys of `metric_patterns` there — that
 * one IS read below, because its own keys are field names as well.
 */
const FIELD_NAME_DICTS = [
  'analytes',
  'definitions',
  'text_definitions',
  'numeric_definitions',
  'metric_patterns',
  'metric_definitions',
  'table_patterns',
  'special_flags',
] as const;

/**
 * Every `field_name` the parser can write, as the parser spells it.
 *
 * Two sources, which is all of them: a literal first argument to
 * `_build_field`, and a key of one of the dicts above (each is iterated
 * with the key AS the field name — `for field_name, … in <dict>.items()`
 * — or handed to `_extract_numeric_panel` / `_extract_text_panel`, which
 * does the same).
 */
const parserFieldNames = (): ReadonlySet<string> => {
  const source = fs.readFileSync(PARSER_SOURCE, 'utf8');
  const names = new Set<string>();

  for (const match of source.matchAll(/_build_field\(\s*"([a-z][a-z0-9_]*)"/g)) {
    names.add(match[1]);
  }

  for (const dict of FIELD_NAME_DICTS) {
    const opener = new RegExp(`^([ \\t]*)${dict}(?::[^=\\n]*)? = \\{$`, 'gm');
    for (const open of source.matchAll(opener)) {
      const indent = open[1];
      const body = source.slice(open.index! + open[0].length);
      const closer = body.indexOf(`\n${indent}}`);
      if (closer < 0) {
        throw new Error(
          `${PARSER_SOURCE}: 「${dict} = {」 at offset ${open.index} has no closing brace at its own indentation — this test's parser, not the app, is what broke.`,
        );
      }
      const inner = body.slice(0, closer);
      const keyPattern = new RegExp(`^${indent}[ \\t]+"([a-z][a-z0-9_]*)":`, 'gm');
      for (const key of inner.matchAll(keyPattern)) names.add(key[1]);
    }
  }

  // A floor rather than an exact count: the point is that the parsers
  // above found the panels, not that the parser has a particular size.
  // Measured at 183 when this file was written.
  if (names.size < 150) {
    throw new Error(
      `read only ${names.size} field names out of ${PARSER_SOURCE}; expected well over 150. This test's parser, not the app, is what broke.`,
    );
  }
  return names;
};

// ────────────────────────────────────────────── the recorded decisions

/**
 * PARSER CELLS THAT ARE DELIBERATELY NOT ON THE ALLOWLIST.
 *
 * Every one of these was found by the sweep this file automates, and
 * every one is a decision rather than a gap. They are grouped by the
 * reason, and the reason is the point: a key here is a key somebody
 * declined, and moving one onto the allowlist is a one-line diff with
 * this paragraph attached to it.
 */
const DECLINED: Readonly<Record<string, string>> = {
  // ── PROSE. The report's own sentences. This platform ships ONE prose
  // channel — the gated impression — and it is behind
  // `REPORT_IMPRESSION_CHANNEL_ENABLED`, default off, for the reasons
  // that constant spends a page on. Nine more prose keys admitted as
  // ordinary cells would be that decision reversed by accident, on nine
  // channels with no eligibility accounting of their own. (Three prose
  // cells ARE on the list — `ecgSummary`, `conductionAbnormality`,
  // `fattyInfiltration` — and the premise paragraph in allowlist.ts says
  // what happens to them: `looksLikeFreeText` sends them through gate 0
  // and gate 2 like any other narrative. That is precedent for admitting
  // these, not authority to do it here.)
  interpretation_summary: 'prose — the genetics report’s own interpretation paragraph',
  echo_summary: 'prose — the echocardiography conclusion',
  abdominal_ultrasound_finding: 'prose — 检查所见 block, several sentences',
  abdominal_ultrasound_impression: 'prose — 检查提示 block',
  diaphragm_motion_summary: 'prose — the diaphragm report’s conclusion',
  diaphragm_thickening_summary: 'prose — the diaphragm report’s conclusion',
  key_clinical_signs: 'prose — 病历摘要 free text',
  current_function_status: 'prose — 病历摘要 free text',
  progression_node: 'prose — 病历摘要 free text',
  report_impression: 'the gated channel’s own input; see REPORT_IMPRESSION_KEYS',

  // ── A RAW DOCUMENT LINE UNDER AN ENUM-SHAPED NAME. These two look
  // like flags and are not: `special_flags` sets them to
  // `_find_best_line(lines, [...])`, i.e. whatever line of the document
  // matched — so `gait_abnormality` holds a sentence off a 体格检查,
  // which is exactly the document class gate 0 refuses prose from. Their
  // three siblings in the same dict ARE enums (「yes」/「positive」) and are
  // declined only for want of a decision on the physical-exam panel as a
  // whole, not because of what they hold.
  gait_abnormality: 'holds a raw document line, not an enum — see _extract_physical_exam',
  situp_ability: 'holds a raw document line, not an enum — see _extract_physical_exam',
  facial_weakness: 'physical-exam enum; panel not yet admitted',
  scapular_winging: 'physical-exam enum; panel not yet admitted',
  beevor_sign: 'physical-exam enum; panel not yet admitted',

  // ── PATIENT HISTORY RATHER THAN A LABORATORY READING. Read off a
  // 病历摘要 and identity-adjacent in a way a laboratory value is not: an
  // onset age plus a diagnosis year narrows a person considerably, and
  // the profile scope already carries `familyHistory` under the
  // patient's own consent rather than off somebody's document.
  onset_age: 'patient history, identity-adjacent; profile scope owns this cell',
  disease_duration: 'patient history; derived from onset age',
  family_history: 'already carried on the profile scope, from the patient’s own record',

  // ── MUSCLE STRENGTH, WHICH NEEDS A BRIDGE FIX BEFORE A LIST ENTRY.
  // `_extract_physical_exam` emits one `mrc_score` field PER MUSCLE, with
  // the muscle name and the side on the field rather than in its key, and
  // the bridge's loop writes `fields[fieldName] = valueText` — so all of
  // them collapse onto one `mrc_score` and the last muscle parsed wins,
  // under a key that names no muscle. Admitting that would publish one
  // arbitrary muscle's score as though it were the finding. The bridge's
  // own aggregates (`deltoidStrength` and friends) are the shape that
  // should be admitted; they are in BRIDGE_MINTED below, also declined,
  // pending the same decision.
  mrc_score: 'one key for every muscle — see the collapse in the bridge’s field loop',

  // ── DIAPHRAGM ULTRASOUND. Twelve numbers whose column headers are bare
  // abbreviations (QB / DB / VS / EE / EI / DI) that this repository
  // expands nowhere. A label here is a clinical assertion, and guessing
  // at one would put invented vocabulary in front of a patient. Admitting
  // these needs somebody who can read the report, not a sweep.
  left_qb: 'unexpanded abbreviation — no source in this repo names it',
  left_db: 'unexpanded abbreviation — no source in this repo names it',
  left_vs: 'unexpanded abbreviation — no source in this repo names it',
  left_ee: 'unexpanded abbreviation — no source in this repo names it',
  left_ei: 'unexpanded abbreviation — no source in this repo names it',
  left_di: 'unexpanded abbreviation — no source in this repo names it',
  right_qb: 'unexpanded abbreviation — no source in this repo names it',
  right_db: 'unexpanded abbreviation — no source in this repo names it',
  right_vs: 'unexpanded abbreviation — no source in this repo names it',
  right_ee: 'unexpanded abbreviation — no source in this repo names it',
  right_ei: 'unexpanded abbreviation — no source in this repo names it',
  right_di: 'unexpanded abbreviation — no source in this repo names it',

  // ── PANEL ENUMS AWAITING A VALUE VOCABULARY. Each of these publishes a
  // token this platform minted (`restrictive`, `normal_chambers`, …), and
  // `WIRE_READING_ZH` in render.ts is what stops such a token reaching a
  // Chinese-reading patient as a snake_case identifier. Admitting the key
  // without the values is how that defect gets reintroduced, so the two
  // are one edit and neither has been made.
  ventilatory_pattern: 'enum; values need Chinese in render.ts WIRE_READING_ZH first',
  diffusion_status: 'enum; values need Chinese in render.ts WIRE_READING_ZH first',
  severity: 'enum; values need Chinese, and the bare key name states no panel',
  chamber_size_status: 'enum; values need Chinese in render.ts WIRE_READING_ZH first',
  wall_motion_status: 'enum; values need Chinese in render.ts WIRE_READING_ZH first',
  valve_status: 'enum; values need Chinese in render.ts WIRE_READING_ZH first',
};

/**
 * KEYS THE BRIDGE MINTS THAT NO PARSER FIELD IS NAMED AFTER, each with
 * whether it is on the allowlist and why.
 *
 * `services/ocr/embedded-report-ocr.ts` writes more than the structured
 * fields: it renames genetics cells onto canonical spellings, aggregates
 * muscle strength, copies the classifier's own answer in, and records
 * three counters about its own run.
 */
const BRIDGE_MINTED: Readonly<Record<string, string>> = {
  // Admitted — the document's own identity, and the genetics cells under
  // the canonical spelling `CANONICAL_GENETIC_CELLS` renames them to.
  classifiedType: 'admitted',
  classified_type: 'admitted',
  documentType: 'admitted',
  document_type: 'admitted',
  status: 'admitted',
  d4z4Repeats: 'admitted — canonical spelling of d4z4_repeat_pathogenic',
  methylationValue: 'admitted — canonical spelling of methylation_value',
  diagnosisType: 'admitted — canonical spelling of diagnosis_type',
  creatineKinase: 'admitted — the bridge’s alias for ck',
  myoglobin: 'admitted — the bridge’s alias for mb',
  // Declined — this pipeline's bookkeeping about itself, not the
  // report's content. A count of the fields a parse produced tells a
  // model nothing it can answer a patient with, and `ocrIssue` is an
  // English operator string.
  fieldCount: 'declined — pipeline bookkeeping',
  reviewRecommendedCount: 'declined — pipeline bookkeeping',
  ocrIssue: 'declined — operator diagnostic, English prose',
  impressionText: 'declined — second spelling of the gated channel’s input',
  // Declined — the muscle-strength aggregates. See `mrc_score` in
  // DECLINED: these are the shape that should be admitted, and the
  // decision has not been taken.
  deltoidStrength: 'declined — pending the muscle-strength decision',
  bicepsStrength: 'declined — pending the muscle-strength decision',
  tricepsStrength: 'declined — pending the muscle-strength decision',
  quadricepsStrength: 'declined — pending the muscle-strength decision',
  tibialisStrength: 'declined — pending the muscle-strength decision',
};

/**
 * SPELLINGS NOTHING WRITES ANY MORE AND PAYLOADS ON DISK STILL HOLD.
 *
 * These are the ONLY legitimate members of the 「on the list, produced by
 * nothing」 class, and each one is on a reader's alias list, which is what
 * separates it from the `ageGroup` defect: an archived payload really can
 * arrive carrying it, and a key with no entry here would reach the
 * patient as a raw identifier instead of its Chinese.
 */
const LEGACY_SPELLINGS: Readonly<Record<string, string>> = {
  ecoRIFragment: 'GENETIC_FIELD_KEYS.ecoriFragment; read by profile.controller.ts',
  geneType: 'GENETIC_FIELD_KEYS.geneticType, listed there as legacy',
  gene_type: 'the snake form GENETIC_TYPE_KEYS_LOWER derives from geneType',
  geneticType: 'GENETIC_FIELD_KEYS.geneticType, retired by CANONICAL_GENETIC_CELLS',
  genetic_type: 'GENETIC_FIELD_KEYS.geneticType, snake form',
  reportType: 'the report’s own self-description, off archived payloads',
  report_type: 'the report’s own self-description, off archived payloads',
  d4z4RepeatPathogenic: 'retired by CANONICAL_GENETIC_CELLS; still on disk',
  d4z4_repeat_pathogenic: 'retired by CANONICAL_GENETIC_CELLS; still on disk',
  methylation_value: 'retired by CANONICAL_GENETIC_CELLS; still on disk',
  diagnosis_type: 'retired by CANONICAL_GENETIC_CELLS; still on disk',
};

// ──────────────────────────────────────────────────────────── the checks

const PARSER_NAMES = parserFieldNames();
const ALLOW = OCR_FIELDS_SAFE_KEYS_PRECISE;

/** Both spellings the bridge writes a parser field under. */
const spellings = (fieldName: string): readonly string[] => [fieldName, toCamelCase(fieldName)];

/** Whether the key is one of the two siblings derived off an analyte. */
const siblingStem = (key: string): string | null => {
  if (key.endsWith(OCR_FLAG_SUFFIX)) return key.slice(0, -OCR_FLAG_SUFFIX.length);
  if (key.endsWith(OCR_REFERENCE_SUFFIX)) return key.slice(0, -OCR_REFERENCE_SUFFIX.length);
  return null;
};

describe('OCR allowlist ↔ report parser parity', () => {
  it('the parser source is where this file thinks it is', () => {
    expect(fs.existsSync(PARSER_SOURCE)).toBe(true);
    expect(PARSER_NAMES.size).toBeGreaterThan(150);
    // Spot-check the panels the three known gaps were on, so a parser
    // rewrite that moves them somewhere this reader cannot see fails
    // here rather than silently shrinking the check.
    for (const anchor of ['urine_protein', 'd_dimer', 'eos_pct', 'ck', 'genetic_test_method']) {
      expect(PARSER_NAMES, `${anchor} was not read out of the parser`).toContain(anchor);
    }
  });

  it('every cell the parser writes is either named in Chinese or declined in writing', () => {
    const unaccounted: string[] = [];
    for (const fieldName of PARSER_NAMES) {
      if (fieldName in DECLINED) continue;
      if (spellings(fieldName).some((key) => ALLOW.has(key))) continue;
      unaccounted.push(fieldName);
    }
    expect(
      unaccounted.sort(),
      'These cells reach `ocr_payload.fields` and are dropped by deny-by-default before anything counts, ' +
        'so the model is shown a report with them silently missing. Give each one Chinese in the right table ' +
        'of allowlist.ts, or a reason in DECLINED above.',
    ).toEqual([]);
  });

  it('an admitted cell is admitted under BOTH spellings the bridge writes', () => {
    // The bridge writes `fields[fieldName]` AND `fields[toCamelCase(fieldName)]`.
    // A table carrying only one of the two renders the same cell on one
    // payload and drops it on the next, which is not a state any reader
    // can be written against. The genetics cells are exempt because
    // `canonicaliseGeneticCells` deletes one spelling outright rather
    // than leaving both — see LEGACY_SPELLINGS.
    const canonicalisedGenetics = new Set([
      'd4z4_repeat_pathogenic',
      'd4z4_repeat_other',
      'methylation_value',
      'diagnosis_type',
      'ecori_fragment_kb',
      'haplotype',
    ]);
    const halfAdmitted: string[] = [];
    for (const fieldName of PARSER_NAMES) {
      if (fieldName in DECLINED) continue;
      if (canonicalisedGenetics.has(fieldName)) continue;
      const [snake, camel] = [fieldName, toCamelCase(fieldName)];
      const admitted = ALLOW.has(snake) || ALLOW.has(camel);
      if (!admitted) continue;
      if (!ALLOW.has(snake) || !ALLOW.has(camel)) {
        halfAdmitted.push(`${fieldName} (snake=${ALLOW.has(snake)}, camel=${ALLOW.has(camel)})`);
      }
    }
    expect(halfAdmitted.sort()).toEqual([]);
  });

  it('every key on the allowlist is one something can actually write', () => {
    const producible = new Set<string>();
    for (const fieldName of PARSER_NAMES)
      for (const key of spellings(fieldName)) producible.add(key);

    const phantom: string[] = [];
    for (const key of ALLOW) {
      if (producible.has(key)) continue;
      if (key in BRIDGE_MINTED) continue;
      if (key in LEGACY_SPELLINGS) continue;
      const stem = siblingStem(key);
      if (stem !== null && ALLOW.has(stem)) continue;
      phantom.push(key);
    }
    expect(
      phantom.sort(),
      'These keys are advertised by an inventory that `get_my_reports`’ description is written from, ' +
        'and nothing on this platform can produce one. That is the `ageGroup` defect: a reviewer reads them ' +
        'as evidence the cell is live. Delete them, or record them in LEGACY_SPELLINGS with the alias list that reaches them.',
    ).toEqual([]);
  });

  it('the flag and interval siblings exist under the one spelling the bridge writes', () => {
    // `writeReading` mints `flagKey(toCamelCase(key))` and no snake twin,
    // deliberately — its own note says 「`uric_acid` and `uricAcid` share
    // `uricAcidFlag`, and there is no `uric_acidFlag`」. So a sibling
    // whose stem contains an underscore is a key that cannot arrive.
    const snakeSiblings = [...ALLOW].filter((key) => {
      const stem = siblingStem(key);
      return stem !== null && stem.includes('_');
    });
    expect(snakeSiblings.sort()).toEqual([]);
  });

  it('every measured analyte carries both siblings, and only measured analytes do', () => {
    // The pair is derived, so 「half a pair」 can only mean the derivation
    // stopped being a derivation. Checked anyway: this is the property
    // the flag/interval note says listing keys by hand would lose.
    const missing: string[] = [];
    for (const key of ALLOW) {
      const hasFlag = ALLOW.has(flagKey(key));
      const hasReference = ALLOW.has(referenceKey(key));
      if (hasFlag !== hasReference) missing.push(key);
    }
    expect(missing.sort()).toEqual([]);
  });

  it('a declined cell is one the parser really writes, and really is not admitted', () => {
    // Both directions, so the decline list cannot rot the way the thing
    // it documents did. A key that stopped being produced is a stale
    // decision; a key that was quietly admitted while its reason still
    // stands here is worse — it reads as a decision that was never taken.
    const gone = Object.keys(DECLINED).filter((key) => !PARSER_NAMES.has(key));
    expect(gone.sort(), 'DECLINED names cells the parser no longer writes').toEqual([]);

    const admittedAnyway = Object.keys(DECLINED).filter((key) =>
      spellings(key).some((spelling) => ALLOW.has(spelling)),
    );
    expect(
      admittedAnyway.sort(),
      'These are on the allowlist AND on DECLINED. Whichever is right, the other has to go.',
    ).toEqual([]);
  });

  it('every allowlist key has Chinese, and the Chinese is not the key', () => {
    const bare: string[] = [];
    for (const [key, label] of Object.entries(OCR_FIELD_LABELS_ZH)) {
      if (!label.trim() || label === key) bare.push(key);
    }
    expect(bare.sort()).toEqual([]);
    expect(ALLOW.size).toBe(Object.keys(OCR_FIELD_LABELS_ZH).length);
  });
});
