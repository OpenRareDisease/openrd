/**
 * ONE CELL ON THE REPORT IS ONE ROW ON THE PROMPT.
 *
 * The bridge's job is to turn one parse into one payload, and four
 * separate cells have now reached the model more than once because it
 * wrote the same reading under several names: the EcoRI fragment (three
 * keys, two strings), the methylation cell (two keys, one of them
 * without its unit), the D4Z4 repeat count (two keys, each
 * independently graded by the redactor) and the FSHD subtype (two keys,
 * in both modes). The first three had the same shape — a
 * `genetic_summary` copy written on top of what the structured-field
 * loop had already written from the same cell. The subtype was blunter:
 * two consecutive assignments in this file, `fields.diagnosisType` and
 * `fields.geneticType`, off one parsed 分型.
 *
 * THE ASSERTION IS MADE ON THE RENDERED PROMPT AND NOT ON THE KEYS,
 * because that is the surface the defect was visible on. Counting keys
 * in `ocr_payload.fields` would have passed throughout: the duplicates
 * were real keys, and what made them reach the model was
 * `projectOcrFields` collapsing a snake/camel pair only when the two
 * values AGREE, plus its dispatch on the 「d4z4」 / 「methylation」
 * substrings giving every surviving spelling its own `_clinical` row.
 * So these tests run the real renderer in both modes and count lines.
 *
 * AND THE COUNT IS TAKEN OVER `GENETIC_FIELD_KEYS` AS WELL AS OVER
 * SUBSTRINGS, because the subtype proved a substring list cannot state
 * this invariant: `diagnosisType` and `geneticType` are two spellings of
 * one cell that share no substring at all, so the `CELLS` list at the
 * bottom of this file could not have caught them. The alias table is
 * every spelling any writer in this pipeline has ever produced for a
 * cell, which makes 「two rows in one group」 exactly the defect.
 *
 * THE PARSER FIXTURES ARE REAL. Each `analysis` below was captured from
 * `analyze_fshd_report` in apps/report-manager — the pure-text half of
 * the pipeline, run over the report text quoted beside it — and trimmed
 * to the structured fields and `genetic_summary` this bridge reads.
 * They are inlined rather than produced by shelling out to python so
 * the suite stays hermetic; if the parser's shape changes, the
 * end-to-end run in apps/report-manager/tests is what catches it.
 */

import { describe, expect, it } from 'vitest';
import { buildFields } from './embedded-report-ocr.js';
import type { RedactionMode } from '../../modules/ai-agents/security/allowlist.js';
import { ocrRowKeyOfLabel, renderChunkForPrompt } from '../../modules/ai-agents/security/render.js';
import { GENETIC_FIELD_KEYS, pickReading } from '../../modules/patient-profile/genetic-evidence.js';

interface ParserCase {
  /** The report text `analyze_fshd_report` was run over. */
  readonly reportText: string;
  readonly analysis: Record<string, unknown>;
}

const geneticAnalysis = (
  reportText: string,
  structuredFields: Array<Record<string, unknown>>,
  geneticSummary: Record<string, unknown>,
): ParserCase => ({
  reportText,
  analysis: {
    fshd: {
      report_type: 'genetic_report',
      report_type_confidence: 0.9,
      review_queue: [],
      structured_fields: structuredFields,
      normalized_summary: { genetic_summary: geneticSummary },
    },
  },
});

const HAPLOTYPE_FIELD = {
  field_name: 'haplotype',
  field_value: '4qA',
  normalized_value: '4qA',
  unit: null,
  confidence: 0.95,
};

/** 「D4Z4 重复单元数: 3/22」 with 「甲基化: 35%」 — a count inside the
 *  FSHD1 range, the uncontracted allele beside it, and a methylation
 *  cell whose unit the laboratory printed. */
const COUNT_IN_RANGE_WITH_METHYLATION_PERCENT = geneticAnalysis(
  '基因检测报告\n检测方法: Southern blot\nD4Z4 重复单元数: 3/22\n4qA 等位基因\n甲基化: 35%',
  [
    HAPLOTYPE_FIELD,
    {
      field_name: 'd4z4_repeat_pathogenic',
      field_value: '3',
      normalized_value: 3,
      unit: null,
      confidence: 0.97,
    },
    {
      field_name: 'd4z4_repeat_other',
      field_value: '22',
      normalized_value: 22,
      unit: null,
      confidence: 0.94,
    },
    {
      field_name: 'methylation_value',
      field_value: '35',
      normalized_value: 35.0,
      unit: '%',
      confidence: 0.9,
    },
  ],
  {
    haplotype: '4qA',
    d4z4_repeat_pathogenic: 3,
    d4z4_repeat_other: 22,
    genetic_test_method: 'southern_blot',
    methylation_value: 35.0,
  },
);

/** The same report with the sentence that states the subtype:
 *  「检测结论: 本次检测结果符合 FSHD1 的分子诊断标准」. The parser writes
 *  一个 分型 to TWO places — its own `diagnosis_type` structured field
 *  and `genetic_summary.diagnosis_type` — and this bridge used to turn
 *  those into three keys. Fixture kept beside the one above rather than
 *  folded into it: a report whose 结论 excludes or merely suspects a
 *  type states none (see `_extract_genetic`), and that state is what
 *  `COUNT_IN_RANGE_WITH_METHYLATION_PERCENT` holds. */
const SUBTYPE_STATED_WITH_A_COUNT = geneticAnalysis(
  '基因检测报告\n检测方法: Southern blot\nD4Z4 重复单元数: 3/22\n4qA 等位基因\n甲基化: 35%\n检测结论: 本次检测结果符合 FSHD1 的分子诊断标准。',
  [
    {
      field_name: 'diagnosis_type',
      field_value: 'FSHD1',
      normalized_value: 'FSHD1',
      unit: null,
      confidence: 0.98,
    },
    HAPLOTYPE_FIELD,
    {
      field_name: 'd4z4_repeat_pathogenic',
      field_value: '3',
      normalized_value: 3,
      unit: null,
      confidence: 0.97,
    },
    {
      field_name: 'd4z4_repeat_other',
      field_value: '22',
      normalized_value: 22,
      unit: null,
      confidence: 0.94,
    },
    {
      field_name: 'methylation_value',
      field_value: '35',
      normalized_value: 35.0,
      unit: '%',
      confidence: 0.9,
    },
  ],
  {
    diagnosis_type: 'FSHD1',
    haplotype: '4qA',
    d4z4_repeat_pathogenic: 3,
    d4z4_repeat_other: 22,
    genetic_test_method: 'southern_blot',
    methylation_value: 35.0,
  },
);

/** 「甲基化: 0.35」 — a bisulfite ratio, which is how this cell is
 *  commonly printed. The parser leaves the unit empty rather than
 *  defaulting it to %, so what must survive here is a bare 「0.35」 and
 *  never 「0.35%」 or 「35%」. */
const METHYLATION_WITHOUT_A_UNIT = geneticAnalysis(
  '基因检测报告\nD4Z4 重复单元数: 3/22\n4qA 等位基因\n甲基化: 0.35',
  [
    HAPLOTYPE_FIELD,
    {
      field_name: 'd4z4_repeat_pathogenic',
      field_value: '3',
      normalized_value: 3,
      unit: null,
      confidence: 0.97,
    },
    {
      field_name: 'd4z4_repeat_other',
      field_value: '22',
      normalized_value: 22,
      unit: null,
      confidence: 0.94,
    },
    {
      field_name: 'methylation_value',
      field_value: '0.35',
      normalized_value: 0.35,
      unit: null,
      confidence: 0.9,
    },
  ],
  { haplotype: '4qA', d4z4_repeat_pathogenic: 3, d4z4_repeat_other: 22, methylation_value: 0.35 },
);

/** 「D4Z4 重复单元数: 25」 — past `FSHD1_MAX_REPEAT_UNITS`, so the
 *  reading sends the report's reader off to evaluate FSHD2. */
const COUNT_ABOVE_RANGE = geneticAnalysis(
  '基因检测报告\nD4Z4 重复单元数: 25\n4qA 等位基因',
  [
    HAPLOTYPE_FIELD,
    {
      field_name: 'd4z4_repeat_pathogenic',
      field_value: '25',
      normalized_value: 25,
      unit: null,
      confidence: 0.97,
    },
  ],
  { haplotype: '4qA', d4z4_repeat_pathogenic: 25 },
);

/** 「D4Z4 重复单元数: 0」 — not a valid reading, so the parser keeps the
 *  raw cell on the structured field and leaves
 *  `genetic_summary.d4z4_repeat_pathogenic` NULL. This is the state
 *  that used to produce a different alias set from every other. */
const COUNT_OF_ZERO = geneticAnalysis(
  '基因检测报告\nD4Z4 重复单元数: 0\n4qA 等位基因\n甲基化: 35%',
  [
    HAPLOTYPE_FIELD,
    {
      field_name: 'd4z4_repeat_pathogenic',
      field_value: '0',
      normalized_value: '0',
      unit: null,
      confidence: 0.3,
    },
    {
      field_name: 'methylation_value',
      field_value: '35',
      normalized_value: 35.0,
      unit: '%',
      confidence: 0.9,
    },
  ],
  { haplotype: '4qA', d4z4_repeat_pathogenic: null, methylation_value: 35.0 },
);

/** 「D4Z4重复单元数: 1-10」 — an interval, not a count.
 *  `genetic_summary.d4z4_repeat_pathogenic` is NULL here too. */
const COUNT_IS_A_RANGE = geneticAnalysis(
  '基因检测报告\nD4Z4重复单元数: 1-10\n4qA 等位基因',
  [
    HAPLOTYPE_FIELD,
    {
      field_name: 'd4z4_repeat_pathogenic',
      field_value: '1-10',
      normalized_value: '1-10',
      unit: null,
      confidence: 0.8,
    },
  ],
  { haplotype: '4qA', d4z4_repeat_pathogenic: null },
);

/** 「D4Z4 EcoRI 片段长度: 18 kb」 — the parser refuses to read the length
 *  as a count and records it under `ecori_fragment_kb` instead. Kept
 *  here because it is the cell the fix below is modelled on. */
const KB_LENGTH_IN_THE_D4Z4_CELL = geneticAnalysis(
  '基因检测报告\nD4Z4 EcoRI 片段长度: 18 kb\n4qA 等位基因',
  [
    HAPLOTYPE_FIELD,
    {
      field_name: 'ecori_fragment_kb',
      field_value: '18',
      normalized_value: 18.0,
      unit: 'kb',
      confidence: 0.94,
    },
  ],
  { haplotype: '4qA', ecori_fragment_kb: 18.0, genetic_test_method: 'southern_blot' },
);

/** 「D4Z4 未检出3个重复单元」 — a negation carrying a number that is not
 *  a count. The parser drops the cell entirely, so the bridge has
 *  nothing to write and no spelling of it may appear. */
const NEGATED_COUNT = geneticAnalysis(
  '基因检测报告\nD4Z4 未检出3个重复单元\n4qA 等位基因',
  [HAPLOTYPE_FIELD],
  { haplotype: '4qA' },
);

const fieldsFor = (testCase: ParserCase): Record<string, string> =>
  buildFields(testCase.analysis, 'genetic_report', testCase.reportText).fields;

/** The rows the model actually receives for this payload, as lines of
 *  the rendered prompt with their 「  - 」 bullet stripped. Run through
 *  the real renderer over a chunk shaped like the one
 *  `patient-reports.ts` builds.
 *
 *  RE-KEYED TO THE PAYLOAD'S OWN VOCABULARY. The OCR block used to
 *  print its raw payload keys, so a row's label WAS its key and every
 *  assertion below could be written in the spellings this bridge emits.
 *  It prints Chinese now — 「D4Z4 重复数（本平台判读）」 rather than
 *  `d4z4Repeats_clinical` — for the same reason the document-type
 *  VALUE was localised earlier (see the note in the first `toEqual`
 *  below): a snake_case identifier under a Chinese heading is one the
 *  model copies into the patient's answer.
 *
 *  What this file asks is 「one cell on the report, one row on the
 *  prompt」, and that question is about keys. So the label is mapped
 *  back through the renderer's own inverse rather than through a
 *  second copy of its table here — `ocrRowKeyOfLabel` is exported for
 *  exactly this, and a row whose key has no Chinese name printed its
 *  key and comes back unchanged. */
const promptRowsFor = (fields: Record<string, string>, mode: RedactionMode): string[] => {
  const chunk = {
    id: 'doc-1',
    source: 'patient_reports',
    content: '',
    score: 1,
    metadata: {
      documentType: 'genetic_report',
      status: 'parsed',
      fields: {
        classifiedType: 'genetic_report',
        documentType: 'genetic_report',
        status: 'parsed',
        fields,
      },
    },
  };
  return renderChunkForPrompt(chunk as never, { mode })
    .content.split('\n')
    .filter((line) => line.startsWith('  - '))
    .map((line) => line.slice(4))
    .map((row) => {
      const cut = row.indexOf(': ');
      return cut < 0 ? row : `${ocrRowKeyOfLabel(row.slice(0, cut))}:${row.slice(cut + 1)}`;
    });
};

const rowsNaming = (rows: string[], cell: string): string[] =>
  rows.filter((row) => row.toLowerCase().includes(cell));

describe('the methylation cell', () => {
  /**
   * IT KEEPS THE UNIT THE LABORATORY PRINTED, AND ONLY THAT ONE.
   *
   * The parser's structured field carries the unit; the
   * `genetic_summary` copy is a bare float. Writing the float over the
   * camel spelling left 「35」 under `methylationValue` and 「35%」 under
   * `methylation_value` — and `GENETIC_FIELD_KEYS.methylationValue` is
   * headed by `methylationValue`, so the UNITLESS one is what the
   * passport, the share page, the referral pack, the exports and the
   * app's 病程 row all printed. Commit 4a0c535 exists because this same
   * cell reached a patient with the wrong unit once already.
   */
  it('keeps the printed unit and is stored under one key', () => {
    const fields = fieldsFor(COUNT_IN_RANGE_WITH_METHYLATION_PERCENT);
    expect(fields.methylationValue).toBe('35%');
    expect(fields.methylation_value).toBeUndefined();
    expect(pickReading(fields, GENETIC_FIELD_KEYS.methylationValue)).toBe('35%');
  });

  it('does not invent a unit the laboratory did not print', () => {
    const fields = fieldsFor(METHYLATION_WITHOUT_A_UNIT);
    expect(fields.methylationValue).toBe('0.35');
    expect(fields.methylation_value).toBeUndefined();
    expect(pickReading(fields, GENETIC_FIELD_KEYS.methylationValue)).toBe('0.35');
  });

  /** Precise mode printed the cell twice, in two different strings.
   *  Strict mode counted it twice: `numericValuesWithheld: 2` for a
   *  report that printed one measurement. */
  it('reaches the prompt once in each mode', () => {
    const fields = fieldsFor(COUNT_IN_RANGE_WITH_METHYLATION_PERCENT);
    expect(rowsNaming(promptRowsFor(fields, 'precise'), 'methylation')).toEqual([
      'methylationValue: 35%',
    ]);
    // No 甲基化 row at all in strict — the number is withheld and
    // counted, never graded. See `methylationCell` in pii-redactor.ts.
    expect(rowsNaming(promptRowsFor(fields, 'strict'), 'methylation')).toEqual([]);
    expect(promptRowsFor(fields, 'strict')).toContain('numericValuesWithheld: 1');
  });
});

describe('the FSHD subtype', () => {
  /**
   * ONE 分型, ONE KEY — and unlike the two cells above, this one was
   * never a snake/camel pair. `fields.diagnosisType` and
   * `fields.geneticType` sat on consecutive lines of this bridge, both
   * on `OCR_FIELDS_SAFE_KEYS_PRECISE`, neither with an underscore for
   * `projectOcrFields` to collapse against.
   */
  it('is stored under one key', () => {
    const fields = fieldsFor(SUBTYPE_STATED_WITH_A_COUNT);
    expect(fields.diagnosisType).toBe('FSHD1');
    expect(fields.geneticType).toBeUndefined();
    expect(fields.diagnosis_type).toBeUndefined();
    expect(pickReading(fields, GENETIC_FIELD_KEYS.geneticType)).toBe('FSHD1');
  });

  /**
   * IN BOTH MODES, which is what separated this from the measurement
   * duplicates. A subtype is a classification, so `isCategoryLabel`
   * carries it through strict mode intact rather than withholding it —
   * the duplicate was therefore not counted into
   * `numericValuesWithheld` either, it was simply printed twice to the
   * patients who consented to share least as well as to those who
   * consented to share most.
   */
  it('reaches the prompt once in each mode', () => {
    const fields = fieldsFor(SUBTYPE_STATED_WITH_A_COUNT);
    for (const mode of ['precise', 'strict'] as const) {
      const rows = promptRowsFor(fields, mode);
      const spellings: readonly string[] = GENETIC_FIELD_KEYS.geneticType;
      expect(rows.filter((row) => spellings.includes(row.split(':')[0]))).toEqual([
        'diagnosisType: FSHD1',
      ]);
    }
  });

  /** A 结论 that excludes or only suspects a type has stated none, and
   *  the bridge must not mint a subtype key at all — under any of its
   *  spellings — for the report the parser refused. */
  it('writes no subtype at all when the report states none', () => {
    const fields = fieldsFor(COUNT_IN_RANGE_WITH_METHYLATION_PERCENT);
    expect(pickReading(fields, GENETIC_FIELD_KEYS.geneticType)).toBeNull();
    for (const spelling of GENETIC_FIELD_KEYS.geneticType) {
      expect(fields[spelling]).toBeUndefined();
    }
  });
});

describe('the D4Z4 repeat count', () => {
  /**
   * ONE COUNT, ONE KEY, AND THE SAME KEY IN EVERY STATE.
   *
   * `genetic_summary.d4z4_repeat_pathogenic` is null for a range and
   * for every cell this repo refuses to read as a count, so a bridge
   * that wrote `d4z4Repeats` from it produced a DIFFERENT ALIAS SET
   * depending on what the report said — and `d4z4Repeats` is the one
   * key `EDITABLE_OCR_FIELDS` lets a patient correct and the one
   * `profile.controller.ts` names first. It existed only when the
   * reading was clean.
   */
  it.each([
    ['a count inside the FSHD1 range', COUNT_IN_RANGE_WITH_METHYLATION_PERCENT, '3'],
    ['a count above the FSHD1 range', COUNT_ABOVE_RANGE, '25'],
    ['a count of 0, which is not a valid reading', COUNT_OF_ZERO, '0'],
    ['an interval rather than a count', COUNT_IS_A_RANGE, '1-10'],
  ])('is stored under one key for %s', (_label, testCase, expected) => {
    const fields = fieldsFor(testCase as ParserCase);
    expect(fields.d4z4Repeats).toBe(expected);
    expect(fields.d4z4RepeatPathogenic).toBeUndefined();
    expect(fields.d4z4_repeat_pathogenic).toBeUndefined();
    expect(pickReading(fields, GENETIC_FIELD_KEYS.d4z4Repeats)).toBe(expected);
  });

  /** The uncontracted allele is a DIFFERENT cell and keeps its own
   *  spellings: its snake/camel pair agrees, so `projectOcrFields`
   *  collapses it, and no surface on this platform reads it as the
   *  count. Nothing here may fold it into the one above. */
  it('leaves the uncontracted allele as its own cell', () => {
    const fields = fieldsFor(COUNT_IN_RANGE_WITH_METHYLATION_PERCENT);
    expect(fields.d4z4RepeatOther).toBe('22');
    expect(fields.d4z4Repeats).toBe('3');
  });

  /** A cell the parser refused at the source has nothing to
   *  canonicalise, and canonicalising must not mint an empty one. */
  it.each([
    ['a kb length in the count cell', KB_LENGTH_IN_THE_D4Z4_CELL],
    ['a negation carrying a number', NEGATED_COUNT],
  ])('writes no count at all for %s', (_label, testCase) => {
    const fields = fieldsFor(testCase as ParserCase);
    expect(pickReading(fields, GENETIC_FIELD_KEYS.d4z4Repeats)).toBeNull();
    for (const spelling of GENETIC_FIELD_KEYS.d4z4Repeats) {
      expect(fields[spelling]).toBeUndefined();
    }
  });
});

/**
 * THE INVARIANT ITSELF, asserted the way the EcoRI fix asserts it: a
 * cell the laboratory printed once is one raw row and one `_clinical`
 * row on the prompt, in the mode that carries raw rows, and one
 * `_clinical` row in the mode that does not.
 *
 * Stated over every genetics cell rather than over the two just fixed,
 * so the next `genetic_summary` copy written on top of a structured
 * field fails here rather than in a patient's answer.
 */
describe('one cell on the report, one row on the prompt', () => {
  const CELLS = ['d4z4repeats', 'd4z4repeatother', 'ecori', 'methylation', 'haplotype'] as const;

  const EVERY_FIXTURE: ReadonlyArray<readonly [string, ParserCase]> = [
    ['a count in range with a methylation percent', COUNT_IN_RANGE_WITH_METHYLATION_PERCENT],
    ['a stated subtype beside a count', SUBTYPE_STATED_WITH_A_COUNT],
    ['a methylation cell with no unit', METHYLATION_WITHOUT_A_UNIT],
    ['a count above the FSHD1 range', COUNT_ABOVE_RANGE],
    ['a count of 0', COUNT_OF_ZERO],
    ['an interval rather than a count', COUNT_IS_A_RANGE],
    ['a kb length in the count cell', KB_LENGTH_IN_THE_D4Z4_CELL],
    ['a negation carrying a number', NEGATED_COUNT],
  ];

  it.each(EVERY_FIXTURE)('%s', (_label, testCase) => {
    const fields = fieldsFor(testCase as ParserCase);

    for (const mode of ['precise', 'strict'] as const) {
      const rows = promptRowsFor(fields, mode);
      for (const cell of CELLS) {
        const named = rowsNaming(rows, cell);
        const rawRows = named.filter((row) => !row.split(':')[0].endsWith('_clinical'));
        const clinicalRows = named.filter((row) => row.split(':')[0].endsWith('_clinical'));
        // `toEqual` on the rows and not `toHaveLength`: when this
        // breaks, the failure has to show WHICH spellings reached the
        // model, because that is the whole content of the defect.
        expect(
          rawRows.length,
          `${mode}: raw rows for ${cell} → ${rawRows.join(' | ')}`,
        ).toBeLessThanOrEqual(mode === 'precise' ? 1 : 0);
        expect(
          clinicalRows.length,
          `${mode}: _clinical rows for ${cell} → ${clinicalRows.join(' | ')}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  /**
   * THE SAME CLAIM STATED OVER THE ALIAS TABLES, which is the form the
   * subtype needed. `diagnosisType` and `geneticType` are two spellings
   * of one cell sharing no substring, so no entry in `CELLS` above could
   * have named both; `GENETIC_FIELD_KEYS` is every spelling any writer
   * in this pipeline has ever produced for a cell, so a group holding
   * two rows IS one cell reaching the model twice. Read off the shared
   * table rather than restated here, so a spelling added there is
   * covered without a second edit.
   *
   * The raw bound is 1 in BOTH modes rather than 0 in strict: strict
   * withholds measurements but keeps classifications, so the subtype's
   * own row survives it — see `isCategoryLabel` in pii-redactor.ts. The
   * measurement groups are pinned to 0 in strict by the substring test
   * above; what this adds is that no group is ever printed twice.
   */
  it.each(EVERY_FIXTURE)('one row per alias group — %s', (_label, testCase) => {
    const fields = fieldsFor(testCase);

    for (const mode of ['precise', 'strict'] as const) {
      const rows = promptRowsFor(fields, mode);
      for (const [group, spellings] of Object.entries(GENETIC_FIELD_KEYS)) {
        const keyOf = (row: string) => row.split(':')[0];
        const rawRows = rows.filter((row) => (spellings as readonly string[]).includes(keyOf(row)));
        const clinicalRows = rows.filter((row) =>
          (spellings as readonly string[]).some(
            (spelling) => keyOf(row) === `${spelling}_clinical`,
          ),
        );
        expect(
          rawRows.length,
          `${mode}: raw rows for ${group} → ${rawRows.join(' | ')}`,
        ).toBeLessThanOrEqual(1);
        expect(
          clinicalRows.length,
          `${mode}: _clinical rows for ${group} → ${clinicalRows.join(' | ')}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  /** The positive half of the same claim: the rows the fixed payload
   *  actually produces, in full, so a regression that DROPS a cell
   *  fails here too rather than passing the counts above. */
  it('renders the whole genetics blob once, in both modes', () => {
    const fields = fieldsFor(COUNT_IN_RANGE_WITH_METHYLATION_PERCENT);
    expect(promptRowsFor(fields, 'precise')).toEqual([
      // The bridge's own two, written from the parser's classification
      // and the uploader's declared type rather than off any cell.
      //
      // 基因报告 and not `genetic_report`: the VALUE of a document-type
      // key is localised on its way into the prompt (see
      // `DOCUMENT_TYPE_VALUE_LABELS` in security/render.ts), because a
      // snake_case English token under a Chinese label in an otherwise
      // Chinese prompt had the model inventing its own translation.
      // What this test is actually about — one cell on the report
      // producing exactly one row on the prompt — is untouched by that:
      // the keys and the row count are the same either way.
      //
      // The `_clinical` values below read the same way for the same
      // reason, one round later: a READING is a token this platform
      // mints (`within_fshd1_repeat_range`), and it was printed
      // verbatim into the prompt until security/render.ts took the
      // Chinese for this vocabulary home from answer-guard.ts. The keys
      // and the row count are again untouched — which is the whole of
      // what these two lists are pinning.
      'documentType: 基因报告',
      'classifiedType: 基因报告',
      'haplotype: 4qA',
      'haplotype_clinical: 允许型单倍型',
      'd4z4RepeatOther: 22',
      'd4z4RepeatOther_clinical: 这一格是另一条等位基因，不是收缩的那一条',
      'methylationValue: 35%',
      'd4z4Repeats: 3',
      'd4z4Repeats_clinical: 这个重复数落在 FSHD1 的范围里',
    ]);
    expect(promptRowsFor(fields, 'strict')).toEqual([
      'documentType: 基因报告',
      'classifiedType: 基因报告',
      'haplotype_clinical: 允许型单倍型',
      'd4z4RepeatOther_clinical: 这一格是另一条等位基因，不是收缩的那一条',
      'd4z4Repeats_clinical: 这个重复数落在 FSHD1 的范围里',
      'numericValuesWithheld: 1',
    ]);
  });

  /** The same blob with the 分型 the report states, in full. Spelled out
   *  separately rather than folded into the case above because the row
   *  that has to appear exactly once is the one this bridge printed
   *  twice, and a count assertion would pass on a payload that lost it
   *  altogether. */
  it('renders a stated subtype exactly once, in both modes', () => {
    const fields = fieldsFor(SUBTYPE_STATED_WITH_A_COUNT);
    expect(promptRowsFor(fields, 'precise')).toEqual([
      'documentType: 基因报告',
      'classifiedType: 基因报告',
      'diagnosisType: FSHD1',
      'haplotype: 4qA',
      'haplotype_clinical: 允许型单倍型',
      'd4z4RepeatOther: 22',
      'd4z4RepeatOther_clinical: 这一格是另一条等位基因，不是收缩的那一条',
      'methylationValue: 35%',
      'd4z4Repeats: 3',
      'd4z4Repeats_clinical: 这个重复数落在 FSHD1 的范围里',
    ]);
    // The subtype survives strict beside the readings and NOT beside a
    // second copy of itself: it is a classification, not a measurement.
    expect(promptRowsFor(fields, 'strict')).toEqual([
      'documentType: 基因报告',
      'classifiedType: 基因报告',
      'diagnosisType: FSHD1',
      'haplotype_clinical: 允许型单倍型',
      'd4z4RepeatOther_clinical: 这一格是另一条等位基因，不是收缩的那一条',
      'd4z4Repeats_clinical: 这个重复数落在 FSHD1 的范围里',
      'numericValuesWithheld: 1',
    ]);
  });

  /**
   * ARCHIVED PAYLOADS ARE NOT REWRITTEN, and every reader still finds
   * their subtype. The three spellings this bridge used to mint sit on
   * document rows already in the database; the alias table is untouched,
   * so `pickReading` — which is what the passport, the profile autofill,
   * the exports, the app's report-detail table and its correction sheet
   * all go through — resolves each of them, including the ones no
   * writer emits any more. Asserted rather than asserted-in-a-comment,
   * because 「the readers already cover it」 is the claim a deletion
   * lives or dies on.
   */
  it.each([
    [
      'the shape this bridge wrote before today',
      { diagnosis_type: 'FSHD1', diagnosisType: 'FSHD1', geneticType: 'FSHD1' },
    ],
    ['a legacy payload holding only geneticType', { geneticType: 'FSHD1' }],
    ['a legacy payload holding only geneType', { geneType: 'FSHD2' }],
    ['a legacy payload holding only genetic_type', { genetic_type: 'FSHD1' }],
    ['a legacy payload holding only diagnosis_type', { diagnosis_type: 'FSHD1' }],
  ])('still resolves the subtype off %s', (_label, archived) => {
    expect(pickReading(archived, GENETIC_FIELD_KEYS.geneticType)).toMatch(/^FSHD[12]$/);
  });

  /** And a patient's hand-correction wins over the archived spelling
   *  beside it. `EDITABLE_OCR_FIELDS` accepts `diagnosisType`, which is
   *  the head of the alias list, so a correction lands ON the cell —
   *  the reason the canonical key is the one the bridge keeps. */
  it('prefers a hand-corrected subtype over an archived spelling', () => {
    const corrected = { geneticType: 'FSHD1', diagnosisType: 'FSHD2' };
    expect(pickReading(corrected, GENETIC_FIELD_KEYS.geneticType)).toBe('FSHD2');
  });
});

/**
 * THE LABORATORY PANEL, WHICH IS THE OTHER HALF OF THIS BRIDGE.
 *
 * The genetics cells above were minted twice; the muscle-damage panel
 * had the opposite defect — one cell, one key, and the key overwritten
 * with a worse copy of itself. `normalized_summary.lab_panel` holds the
 * BARE FLOAT, and the block that copied eight of its entries into
 * `fields` ran AFTER the structured-field loop had already written the
 * same cells with the unit the laboratory printed.
 *
 * The fixtures are shaped like `analyze_fshd_report`'s real output for a
 * 心肌酶谱 and a 血常规 in the ordinary cell-per-line OCR layout — a
 * structured field per row carrying `unit`, `abnormal_flag` and
 * `reference_range_raw`, and a `lab_panel` of bare floats beside them.
 */
const labAnalysis = (
  structuredFields: Array<Record<string, unknown>>,
  labPanel: Record<string, unknown>,
): ParserCase => ({
  reportText: '示例市中心医院 检验报告单',
  analysis: {
    fshd: {
      report_type: 'biochemistry',
      report_type_confidence: 0.9,
      review_queue: [],
      structured_fields: structuredFields,
      normalized_summary: { lab_panel: labPanel },
    },
  },
});

/** 「肌酸激酶(CK) 693 ↑ 50-310 U/L」 beside an albumin the same page
 *  printed unflagged, and a platelet count whose unit starts with a
 *  digit. */
const A_FLAGGED_MUSCLE_ENZYME_PANEL = labAnalysis(
  [
    {
      field_name: 'ck',
      field_value: '693',
      normalized_value: 693,
      unit: 'U/L',
      confidence: 0.93,
      abnormal_flag: 'high',
      reference_range_raw: '50-310',
      reference_low: 50,
      reference_high: 310,
    },
    {
      field_name: 'uric_acid',
      field_value: '520',
      normalized_value: 520,
      unit: 'umol/L',
      confidence: 0.93,
      abnormal_flag: 'high',
      reference_range_raw: '208-428',
    },
    {
      field_name: 'alb',
      field_value: '42',
      normalized_value: 42,
      unit: 'g/L',
      confidence: 0.93,
      reference_range_raw: '40-55',
    },
    {
      field_name: 'plt',
      field_value: '249',
      normalized_value: 249,
      unit: '10^9/L',
      confidence: 0.93,
      reference_range_raw: '125-350',
    },
  ],
  { ck: 693, uric_acid: 520, alb: 42, plt: 249 },
);

describe('the muscle-damage panel keeps its unit', () => {
  /**
   * MEASURED: `ck: 「693」` and `ldh: 「319」` where the parser had
   * produced 「693U/L」 and 「319U/L」, on a payload whose every analyte
   * NOT on the eight-key list kept its unit. The eight cells a clinician
   * reads an FSHD patient's muscle damage off were the eight that
   * reached 我的档案, the passport, the exports and the model prompt as
   * unitless numbers, beside neighbours reading 「42g/L」.
   */
  it('does not overwrite the unit-bearing value with the bare float', () => {
    const fields = fieldsFor(A_FLAGGED_MUSCLE_ENZYME_PANEL);
    expect(fields.ck).toBe('693U/L');
    expect(fields.uricAcid).toBe('520umol/L');
    // The alias the app's blood card reads is the same string.
    expect(fields.creatineKinase).toBe('693U/L');
  });

  it('renders every analyte on the report the same way', () => {
    const fields = fieldsFor(A_FLAGGED_MUSCLE_ENZYME_PANEL);
    expect(fields.alb).toBe('42g/L');
  });

  it('separates a unit that starts with a digit', () => {
    // 「24910^9/L」 is one string in which the first five characters are
    // two different numbers.
    expect(fieldsFor(A_FLAGGED_MUSCLE_ENZYME_PANEL).plt).toBe('249 10^9/L');
  });

  /** The panel is still the answer where the parse produced an entry
   *  and no structured field to render — the one state in which the
   *  bare float is the best this bridge has. */
  it('still answers from the panel when no structured field carries the cell', () => {
    const fields = fieldsFor(labAnalysis([], { ck: 693 }));
    expect(fields.ck).toBe('693');
  });
});

describe('what the laboratory said about the row', () => {
  /**
   * The parser reads the flag and the reference interval off the row and
   * writes both onto the structured field; `observations[]` and
   * `latest_summary.by_analyte` carry them, and `ocr_payload.fields` —
   * the only one of the three any patient-facing screen reads — carried
   * the number alone.
   *
   * THESE KEYS ARE CARRIED AND NOT YET RENDERED. `ReportInsightMetric`
   * in apps/mobile/lib/report-insights.ts is `{ label, value, date }`
   * and has no member that can hold a flag, and
   * `OCR_FIELDS_SAFE_KEYS_PRECISE` does not list them so they reach no
   * model prompt in either mode. Both are stated in the comment on the
   * structured-field loop; this suite asserts the half that is this
   * file's to keep true.
   */
  it('carries the flag and the interval the row printed', () => {
    const fields = fieldsFor(A_FLAGGED_MUSCLE_ENZYME_PANEL);
    expect(fields.ckFlag).toBe('high');
    expect(fields.ckReference).toBe('50-310');
  });

  it('camelises the sibling keys with the cell they belong to', () => {
    const fields = fieldsFor(A_FLAGGED_MUSCLE_ENZYME_PANEL);
    expect(fields.uricAcidFlag).toBe('high');
    expect(fields.uricAcidReference).toBe('208-428');
  });

  /** ONE SPELLING. Every other cell in the loop is written under both
   *  the snake and the camel name because both are already on disk;
   *  these two are new, so there is no snake twin for
   *  `projectOcrFields` to have to collapse. */
  it('writes one spelling of each and no snake twin', () => {
    const fields = fieldsFor(A_FLAGGED_MUSCLE_ENZYME_PANEL);
    expect(fields.ck_flag).toBeUndefined();
    expect(fields.uric_acid_flag).toBeUndefined();
    expect(fields.uric_acid_reference).toBeUndefined();
  });

  it('mints no flag for a row the laboratory did not flag', () => {
    const fields = fieldsFor(A_FLAGGED_MUSCLE_ENZYME_PANEL);
    expect(fields.albFlag).toBeUndefined();
    // The interval is still carried: a row can print one without being
    // abnormal, and that is what the reading is normal AGAINST.
    expect(fields.albReference).toBe('40-55');
  });
});
