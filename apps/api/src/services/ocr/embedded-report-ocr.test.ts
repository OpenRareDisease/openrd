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
import { renderChunkForPrompt } from '../../modules/ai-agents/security/render.js';
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
 *  `patient-reports.ts` builds. */
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
    .map((line) => line.slice(4));
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
      'documentType: genetic_report',
      'classifiedType: genetic_report',
      'haplotype: 4qA',
      'haplotype_clinical: permissive_haplotype',
      'd4z4RepeatOther: 22',
      'd4z4RepeatOther_clinical: other_allele_not_the_contracted_one',
      'methylationValue: 35%',
      'd4z4Repeats: 3',
      'd4z4Repeats_clinical: within_fshd1_repeat_range',
    ]);
    expect(promptRowsFor(fields, 'strict')).toEqual([
      'documentType: genetic_report',
      'classifiedType: genetic_report',
      'haplotype_clinical: permissive_haplotype',
      'd4z4RepeatOther_clinical: other_allele_not_the_contracted_one',
      'd4z4Repeats_clinical: within_fshd1_repeat_range',
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
      'documentType: genetic_report',
      'classifiedType: genetic_report',
      'diagnosisType: FSHD1',
      'haplotype: 4qA',
      'haplotype_clinical: permissive_haplotype',
      'd4z4RepeatOther: 22',
      'd4z4RepeatOther_clinical: other_allele_not_the_contracted_one',
      'methylationValue: 35%',
      'd4z4Repeats: 3',
      'd4z4Repeats_clinical: within_fshd1_repeat_range',
    ]);
    // The subtype survives strict beside the readings and NOT beside a
    // second copy of itself: it is a classification, not a measurement.
    expect(promptRowsFor(fields, 'strict')).toEqual([
      'documentType: genetic_report',
      'classifiedType: genetic_report',
      'diagnosisType: FSHD1',
      'haplotype_clinical: permissive_haplotype',
      'd4z4RepeatOther_clinical: other_allele_not_the_contracted_one',
      'd4z4Repeats_clinical: within_fshd1_repeat_range',
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
