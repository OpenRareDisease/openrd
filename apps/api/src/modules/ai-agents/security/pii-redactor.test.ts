import { describe, expect, it, vi } from 'vitest';

import type { RedactionMode } from './allowlist.js';
import { GENETIC_READING_REFUSALS, redactFields } from './pii-redactor.js';
import { GENETIC_FIELD_KEYS } from '../../patient-profile/genetic-evidence.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child() {
    return silentLogger;
  },
};

const profileSample = {
  // Layer 1 hard-delete
  fullName: '张三',
  contactPhone: '13812345678',
  contactEmail: 'zhangsan@example.com',
  idCard: '11010119900520XXXX',
  dateOfBirth: '1990-05-20',
  regionDistrict: '海淀',
  notes: '私人备注，不能进 prompt',
  // Layer 2 candidates (strict mode clinicalises)
  d4z4: '3/22',
  methylation: '12%',
  haplotype: '4qA',
  diagnosisDate: '2023-06-01',
  // Already-clinical or non-PII fields
  gender: 'female',
  diagnosisStage: 'confirmed',
  diagnosisYear: 2023,
  diagnosisType: 'FSHD1',
  onsetRegion: '肩胛带',
  familyHistory: '母亲疑似',
  independentlyAmbulatory: 'unable',
  assistiveDevices: ['AFO'],
  // A made-up rogue key not in any allowlist
  privateScratchpad: 'should be dropped with a warning',
};

describe('redactFields (profile, strict mode)', () => {
  it('hard-deletes obvious identifiers regardless of mode', () => {
    const { fields, stats } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'strict',
      logger: silentLogger as unknown as Parameters<typeof redactFields>[1]['logger'],
    });
    for (const key of [
      'fullName',
      'contactPhone',
      'contactEmail',
      'idCard',
      'regionDistrict',
      'notes',
    ]) {
      expect(stats.hardDeleted).toContain(key);
      expect(fields[key]).toBeUndefined();
    }
  });

  it('clinicalises D4Z4 / methylation / haplotype and drops the raw values', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'strict',
    });
    expect(fields.d4z4).toBeUndefined();
    expect(fields.methylation).toBeUndefined();
    expect(fields.haplotype).toBeUndefined();
    // This scope's cells are `baseline.diseaseBackground` — the boxes on
    // the registration form — so neither of the two genetics cells is
    // banded at all, whatever it says. The block below drives the
    // classifier through the document that earns a band.
    expect(fields.d4z4_clinical).toBe('not_read_off_a_laboratory_report');
    expect(fields.haplotype_clinical).toBe('not_read_off_a_laboratory_report');
    // And the methylation cell earns no `_clinical` sibling in either
    // mode — the number is withheld under a key that says so.
    expect(fields.methylation_clinical).toBeUndefined();
    expect(fields.methylation_withheld).toBe('value_withheld');
  });

  it('replaces diagnosisDate with diagnosisYear', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'strict',
    });
    expect(fields.diagnosisDate).toBeUndefined();
    expect(fields.diagnosisYear).toBe(2023);
  });

  it('drops fields not in the strict allowlist and warns', () => {
    const warn = vi.fn();
    const fakeLogger = {
      fatal: vi.fn(),
      error: vi.fn(),
      warn,
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      child() {
        return fakeLogger;
      },
    };
    const { fields, stats } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'strict',
      logger: fakeLogger as unknown as Parameters<typeof redactFields>[1]['logger'],
    });
    expect(fields.privateScratchpad).toBeUndefined();
    expect(stats.notAllowed).toContain('privateScratchpad');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('passes allowed clinical fields through', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'strict',
    });
    expect(fields.gender).toBe('female');
    expect(fields.diagnosisType).toBe('FSHD1');
    expect(fields.onsetRegion).toBe('肩胛带');
    expect(fields.independentlyAmbulatory).toBe('unable');
    expect(fields.assistiveDevices).toEqual(['AFO']);
  });
});

/**
 * What the assistant is allowed to say about a genetics cell.
 *
 * These labels are not internal: `renderChunkForPrompt` prints each one
 * into the prompt and the model answers the patient off it, so every
 * case here is a sentence somebody hears.
 */
describe('the genetics cells the assistant is handed', () => {
  /**
   * One cell, as it reaches the assistant off the genetics laboratory's
   * own report — the only document whose readings this platform grades.
   *
   * The chunk is shaped the way the reports retriever builds one: the
   * parser's classification inside the OCR blob, the uploader's
   * declared type beside it. Driving these cases through the profile
   * scope, which is what they used to do, now measures the registration
   * form instead of a report.
   */
  const cellOf = (documentType: string, key: string, raw: unknown): unknown => {
    const { fields } = redactFields(
      {
        documentType,
        fields: { classifiedType: documentType, [key]: raw },
      },
      { scope: 'reports', mode: 'strict' },
    );
    return (fields.fields_clinical as Record<string, unknown>)[`${key}_clinical`];
  };
  const d4z4 = (raw: unknown): unknown => cellOf('genetic_report', 'd4z4Repeats', raw);

  it('bands a repeat count on the one boundary this repo states', () => {
    // 指南 item 三: above 10 the instruction is to go and evaluate FSHD2,
    // which is not FSHD1's contraction.
    expect(d4z4('3')).toBe('within_fshd1_repeat_range');
    expect(d4z4('7')).toBe('within_fshd1_repeat_range');
    expect(d4z4('11')).toBe('above_fshd1_repeat_range');
    expect(d4z4('30')).toBe('above_fshd1_repeat_range');
  });

  it('separates the 8–10 grey zone from the rest of the in-range band', () => {
    // A count of 9 used to reach the assistant spelled identically to a
    // count of 5, while the passport, the share page, the referral pack
    // and the exports were all printing 灰区 for the same cell in the
    // same run. The assistant is the consumer that generates advice.
    expect(d4z4('8')).toBe('within_fshd1_repeat_range_grey_zone_8_to_10');
    expect(d4z4('9')).toBe('within_fshd1_repeat_range_grey_zone_8_to_10');
    expect(d4z4('10')).toBe('within_fshd1_repeat_range_grey_zone_8_to_10');
    expect(d4z4('10个重复单元')).toBe('within_fshd1_repeat_range_grey_zone_8_to_10');
    // The edges belong to `isD4Z4GreyZone` and are not restated here;
    // these two are the cells either side of it.
    expect(d4z4('7')).toBe('within_fshd1_repeat_range');
    expect(d4z4('11')).toBe('above_fshd1_repeat_range');
  });

  it('reads no repeat count against the FSHD1 range over a report stating 4qB', () => {
    // THE NAME AND THE 4qB EXPECTATION BOTH MOVED, because what the
    // haplotype gates moved. It used to gate the grey-zone VARIANT
    // alone: Giardina 2024 states the 1%–2% asymptomatic-carrier figure
    // for 8–10 U 4qA arrays, so over a 4qB report the note would be a
    // paragraph about the other allele. True, and not enough — the
    // fall-through was `within_fshd1_repeat_range`, a label asserting
    // the count sits inside the FSHD1 range, over a report where FSHD1
    // by definition cannot be the mechanism. Two ways that showed:
    //
    //   - a 4qB report of 5 units was answered as an in-range FSHD1
    //     count, while the passport grade, the referral 结论 and the
    //     FHIR Condition text on the same report all refuse it; and
    //   - a 4qB report of 9 units DOWNGRADED to that same label, so
    //     the 8–10 uncertainty disappeared and the bytes were
    //     indistinguishable from a count of 5.
    //
    // The gate is on the whole in-range answer now and the answer is a
    // refusal. `!== false` is unchanged, so a report naming no
    // haplotype, or naming both probes, still keeps the note.
    const withHaplotype = (haplotype: string | undefined, repeats: string): unknown => {
      const { fields } = redactFields(
        {
          documentType: 'genetic_report',
          fields: {
            classifiedType: 'genetic_report',
            d4z4Repeats: repeats,
            ...(haplotype === undefined ? {} : { haplotype }),
          },
        },
        { scope: 'reports', mode: 'strict' },
      );
      return (fields.fields_clinical as Record<string, unknown>).d4z4Repeats_clinical;
    };
    const REFUSED = 'repeat_count_not_read_against_fshd1_range_non_permissive_haplotype';
    expect(withHaplotype('4qB', '9')).toBe(REFUSED);
    // The plain in-range count on the same allele, which is the half
    // the grey-zone gate never covered.
    expect(withHaplotype('4qB', '5')).toBe(REFUSED);
    // And the two counts are no longer spelled the same as each other's
    // 4qA readings, which is what the downgrade produced.
    expect(withHaplotype('4qB', '9')).not.toBe(withHaplotype('4qA', '9'));
    expect(withHaplotype('4qA', '9')).toBe('within_fshd1_repeat_range_grey_zone_8_to_10');
    expect(withHaplotype('4qA/4qB', '9')).toBe('within_fshd1_repeat_range_grey_zone_8_to_10');
    expect(withHaplotype(undefined, '9')).toBe('within_fshd1_repeat_range_grey_zone_8_to_10');
    // Above the range the instruction is 「go and evaluate FSHD2」, and
    // that is the right next step whatever the 4q allele says.
    expect(withHaplotype('4qB', '30')).toBe('above_fshd1_repeat_range');
    // It is a refusal, so the 分级 check in tool-descriptions.test.ts
    // has to know about it.
    expect(GENETIC_READING_REFUSALS.has(REFUSED)).toBe(true);
  });

  it('does not read a length in kb as a repeat count', () => {
    // 「3kb」 used to come out as the most severe band there is. The
    // guideline's kb form of the same threshold is 10–20, this repo
    // converts between the two nowhere, and the passport prints a kb
    // length and judges it with nothing.
    expect(d4z4('3kb')).toBe('length_in_kb_not_a_repeat_count');
    expect(d4z4('18 kb')).toBe('length_in_kb_not_a_repeat_count');
    expect(d4z4('0kb')).toBe('length_in_kb_not_a_repeat_count');
  });

  it('flags a count of zero instead of grading it', () => {
    // 0 repeat units is not an FSHD1 allele, so the cell was misread or
    // is about something else. Neither a confirmation nor an exclusion.
    expect(d4z4('0')).toBe('zero_repeat_count_not_a_valid_reading');
    expect(d4z4('0个')).toBe('zero_repeat_count_not_a_valid_reading');
  });

  it('reads a negation as a negation even when it carries a number', () => {
    // A number survives a negation, and the old digit-grab read this
    // cell as a count of 3.
    expect(d4z4('未检出3个重复单元')).toBe('unspecified');
    expect(d4z4('未检出')).toBe('unspecified');
    expect(d4z4('阴性')).toBe('unspecified');
  });

  it('refuses a bound and a range, which pin down no count', () => {
    expect(d4z4('1-10')).toBe('unspecified');
    expect(d4z4('≤10')).toBe('unspecified');
    expect(d4z4('4~7')).toBe('unspecified');
    expect(d4z4('3/22')).toBe('unspecified');
  });

  it('says a methylation value is on file without grading it', () => {
    /** Both channels, because the cell has two shapes and they do not
     *  share a key: a measurement is withheld and said to be withheld,
     *  a word is the laboratory's own and stays the cell it is. Neither
     *  is a `_clinical` sibling — that key was the last place the
     *  deleted band survived, and it labelled both of these as a grade. */
    const methylation = (raw: unknown) => {
      const { fields } = redactFields({ methylation: raw }, { scope: 'profile', mode: 'strict' });
      expect(fields.methylation_clinical).toBeUndefined();
      return { cell: fields.methylation, withheld: fields.methylation_withheld };
    };
    // No methylation boundary is stated anywhere in this repo, and the
    // band that used to be computed here also guessed the unit: 0.35
    // was multiplied out to 35% while the report parser reads that same
    // cell as 0.35%.
    for (const measurement of ['12%', '0.35', '0', '20-30%']) {
      expect(methylation(measurement)).toEqual({ cell: undefined, withheld: 'value_withheld' });
    }
    // The laboratory's own word is not a number the patient withheld,
    // so it survives as the cell rather than as a statement about
    // consent — and never under a label calling it a grade.
    expect(methylation('未检出')).toEqual({ cell: '未检出', withheld: undefined });
    expect(methylation('低甲基化')).toEqual({ cell: '低甲基化', withheld: undefined });
  });

  it('reads the haplotype cell for what it says', () => {
    const haplotype = (raw: unknown): unknown => cellOf('genetic_report', 'haplotype', raw);
    expect(haplotype('4qA')).toBe('permissive_haplotype');
    expect(haplotype('4qB')).toBe('non_permissive_haplotype');
    // A negation and a probe list are both read as the permissive
    // allele by a bare substring match. Neither states a result.
    expect(haplotype('未检出 4qA 等位基因')).toBe('unspecified_haplotype');
    expect(haplotype('4qA/4qB')).toBe('unspecified_haplotype');
  });

  /**
   * A CELL HOLDING AN ARRAY, WHICH IS THE SHAPE THE EXTRACTOR WRITES
   * WHEN A REPORT LISTS THE LABORATORY'S PROBES.
   *
   * `pickReading` refuses an array everywhere else on this platform —
   * 「there is no sensible coercion, so there is none」 — while every
   * reader here opened with `String(raw)`, which has an answer for
   * everything. So a haplotype cell lost its reading entirely (the
   * function bailed on `typeof raw !== 'string'` and returned null,
   * and nothing else refused the cell), and a single-element
   * `d4z4Repeats` array was banded as the count inside it.
   */
  it('reads no genetics cell off an array', () => {
    expect(cellOf('genetic_report', 'haplotype', ['4qA', '4qB'])).toBe('unspecified_haplotype');
    expect(cellOf('genetic_report', 'haplotype', ['4qA'])).toBe('unspecified_haplotype');
    // 「3」 as a bare array element is what used to reach the patient as
    // a repeat count of 3.
    expect(cellOf('genetic_report', 'd4z4Repeats', ['3'])).toBe('unspecified');
    expect(cellOf('genetic_report', 'd4z4Repeats', ['3', '22'])).toBe('unspecified');
    expect(cellOf('genetic_report', 'ecoRIFragment', ['18kb'])).toBe('unspecified');
    expect(cellOf('genetic_report', 'd4z4RepeatOther', ['22'])).toBe('unspecified');
    // An object is the same answer, for the same reason.
    expect(cellOf('genetic_report', 'haplotype', { value: '4qA' })).toBe('unspecified_haplotype');
  });

  it('never publishes a raw genetics cell without a reading beside it', () => {
    // The invariant, asserted structurally rather than per branch: it
    // was a haplotype array that broke it. Precise mode printed
    // 「单倍型: 4qA、4qB」 — `formatScalar` joining the probe list — with
    // no `_clinical` sibling anywhere near it, and strict mode dropped
    // the cell entirely, so the assistant reported a genetics report as
    // having no haplotype at all.
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields(
        {
          documentType: 'genetic_report',
          fields: {
            classifiedType: 'genetic_report',
            haplotype: ['4qA', '4qB'],
            d4z4Repeats: ['3'],
            ecoRIFragment: ['18kb'],
          },
        },
        { scope: 'reports', mode },
      );
      const projected = (fields.fields ?? fields.fields_clinical) as Record<string, unknown>;
      for (const key of ['haplotype', 'd4z4Repeats', 'ecoRIFragment']) {
        if (projected[key] !== undefined) {
          expect(projected[`${key}_clinical`]).toBeDefined();
        }
      }
      // And the reading is there whether or not the raw cell is.
      expect(projected.haplotype_clinical).toBe('unspecified_haplotype');
    }
  });

  it('withholds an array-valued methylation cell rather than joining it', () => {
    // `formatScalar` would have rendered 「甲基化值: 35、40」 and the
    // model would have read it as this patient's result. There is no
    // methylation boundary in this repo to grade it against either way.
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields({ methylation: ['35', '40'] }, { scope: 'profile', mode });
      expect(fields.methylation).toBeUndefined();
      expect(fields.methylation_clinical).toBeUndefined();
      expect(fields.methylation_withheld).toBe('value_withheld');
    }
  });

  /**
   * THE OTHER SIZE CELL, and the one the dispatch had no branch for.
   * The refusal every other surface prints for an EcoRI fragment was
   * absent here entirely, so a fragment reached the model as a number.
   */
  it('reads the EcoRI fragment as a length and never as a count', () => {
    const ecoRI = (raw: unknown): unknown => cellOf('genetic_report', 'ecoRIFragment', raw);
    expect(ecoRI('18kb')).toBe('length_in_kb_not_a_repeat_count');
    // The bridge writes `ecoriFragmentKb` as the bare reading without
    // its unit, and that is the case that matters: an unqualified 「18」
    // is what `isDeterminateRepeatCount` would have accepted as a count
    // above the FSHD1 range.
    expect(cellOf('genetic_report', 'ecoriFragmentKb', '18')).toBe(
      'length_in_kb_not_a_repeat_count',
    );
    expect(ecoRI('3')).toBe('length_in_kb_not_a_repeat_count');
    // A negation carries a number of its own, here twice over.
    expect(ecoRI('未检出10kb以下片段')).toBe('unspecified');
    expect(ecoRI('未检出')).toBe('unspecified');
    // A range pins down no length.
    expect(ecoRI('10-20kb')).toBe('unspecified');
  });

  /**
   * `GENETIC_FIELD_KEYS.ecoRIFragment` is the passport's list of every
   * spelling this cell has ever been written under, across the current
   * bridge and the legacy extraction paths. Read from there rather than
   * restated, because handling a named subset is how this cell came to
   * be handled for nobody.
   */
  it.each([...GENETIC_FIELD_KEYS.ecoRIFragment])(
    'reads the EcoRI fragment under the spelling「%s」',
    (key) => {
      expect(cellOf('genetic_report', key, '18kb')).toBe('length_in_kb_not_a_repeat_count');
    },
  );

  /**
   * The third length-carrying cell, and the one the FSHD1 boundary is
   * not about. A report printing 「3/22」 was handed to the model as
   * 「within_fshd1_repeat_range」 and 「above_fshd1_repeat_range」 at once.
   */
  it('bands the uncontracted allele on no boundary at all', () => {
    const other = (raw: unknown): unknown => cellOf('genetic_report', 'd4z4RepeatOther', raw);
    // The number the second half of 「3/22」 actually carries. It is a
    // determinate count, so 「unspecified」 would be false of it too.
    expect(other('22')).toBe('other_allele_not_the_contracted_one');
    expect(other('8')).toBe('other_allele_not_the_contracted_one');
    expect(other('100')).toBe('other_allele_not_the_contracted_one');
    // Both spellings the bridge writes, and neither reaches the band.
    expect(cellOf('genetic_report', 'd4z4_repeat_other', '22')).toBe(
      'other_allele_not_the_contracted_one',
    );
    // The laboratory gate still comes first.
    expect(cellOf('medical_record', 'd4z4RepeatOther', '22')).toBe(
      'not_read_off_a_laboratory_report',
    );
  });

  /**
   * THE LABORATORY GATE, which the passport applies to the same two
   * cells and this file did not.
   *
   * `pickGeneticEvidenceDocument` takes a 病历摘要 quoting a repeat
   * count when the genetics report read out nothing — on purpose, for
   * the patients whose only copy of the number that is — and the
   * passport grades that document `transcribed_only`: the value is
   * printed with 转录自非基因报告文件 in its bracket and earns no
   * grade. The registration form's own boxes are the same rule one step
   * further out. Before this gate the assistant was the one surface
   * that read a clinic letter, and a patient's own typing, as a
   * laboratory's measurement.
   */
  it('bands nothing off a document that is not the laboratory report', () => {
    expect(cellOf('medical_record', 'd4z4Repeats', '3')).toBe('not_read_off_a_laboratory_report');
    expect(cellOf('medical_record', 'haplotype', '4qA')).toBe('not_read_off_a_laboratory_report');
    // The kb and zero readings are refusals in a laboratory's voice
    // too — this platform says them about a report it read, and the
    // gate is the same one for all of them.
    expect(cellOf('medical_record', 'd4z4Repeats', '18kb')).toBe(
      'not_read_off_a_laboratory_report',
    );
    expect(cellOf('medical_record', 'd4z4Repeats', '0')).toBe('not_read_off_a_laboratory_report');
  });

  it('bands nothing off the registration form either', () => {
    const baseline = (key: string, raw: unknown): unknown =>
      redactFields({ [key]: raw }, { scope: 'profile', mode: 'strict' }).fields[`${key}_clinical`];
    expect(baseline('d4z4', '3')).toBe('not_read_off_a_laboratory_report');
    expect(baseline('haplotype', '4qA')).toBe('not_read_off_a_laboratory_report');
  });

  it('says nothing at all about a cell that is not there', () => {
    const { fields } = redactFields({ gender: 'female' }, { scope: 'profile', mode: 'strict' });
    expect(fields.d4z4_clinical).toBeUndefined();
    expect(fields.methylation_withheld).toBeUndefined();
    expect(fields.haplotype_clinical).toBeUndefined();
  });
});

/**
 * WHAT THIS PLATFORM MAKES OF A GENETICS CELL DOES NOT DEPEND ON WHAT
 * THE PATIENT AGREED TO SHARE.
 *
 * The classifiers above ran in strict mode alone, so under precise the
 * raw cell was handed to the model with nothing beside it: a length in
 * kb, a repeat count of 0, a negated haplotype, a cell naming both
 * probes and a count transcribed into a clinic letter all arrived as
 * bare values, for exactly the readers whose answers are built from the
 * most detail. The consent is to「精确数值」— it buys the cell a place
 * beside this platform's reading of it, not the reading's removal.
 *
 * Each case below is one prompt line a patient's answer is built from,
 * asserted identical in both modes.
 */
describe('the refusal survives the mode that shares more', () => {
  /** One OCR cell, as it reaches the assistant off a named document,
   *  in both modes: the raw value the prompt carries, and this
   *  platform's reading of it. */
  const cell = (
    mode: RedactionMode,
    documentType: string,
    key: string,
    raw: unknown,
  ): { raw: unknown; reading: unknown } => {
    const { fields } = redactFields(
      { documentType, fields: { classifiedType: documentType, [key]: raw } },
      { scope: 'reports', mode },
    );
    const projected = (fields.fields ?? fields.fields_clinical) as Record<string, unknown>;
    return { raw: projected[key], reading: projected[`${key}_clinical`] };
  };

  const bothModes = (documentType: string, key: string, raw: unknown, reading: string) => {
    expect(cell('strict', documentType, key, raw)).toEqual({ raw: undefined, reading });
    expect(cell('precise', documentType, key, raw)).toEqual({ raw, reading });
  };

  it.each([
    ['3', 'within_fshd1_repeat_range'],
    ['10个重复单元', 'within_fshd1_repeat_range_grey_zone_8_to_10'],
    ['11', 'above_fshd1_repeat_range'],
    ['3kb', 'length_in_kb_not_a_repeat_count'],
    ['18 kb', 'length_in_kb_not_a_repeat_count'],
    ['0kb', 'length_in_kb_not_a_repeat_count'],
    ['0', 'zero_repeat_count_not_a_valid_reading'],
    ['0个', 'zero_repeat_count_not_a_valid_reading'],
    ['未检出3个重复单元', 'unspecified'],
    ['阴性', 'unspecified'],
    ['1-10', 'unspecified'],
    ['≤10', 'unspecified'],
  ])('reads the repeat-count cell「%s」the same way in both modes', (raw, reading) => {
    bothModes('genetic_report', 'd4z4Repeats', raw, reading);
  });

  it.each([
    ['4qA', 'permissive_haplotype'],
    ['4qB', 'non_permissive_haplotype'],
    ['未检出 4qA 等位基因', 'unspecified_haplotype'],
    ['4qA/4qB', 'unspecified_haplotype'],
  ])('reads the haplotype cell「%s」the same way in both modes', (raw, reading) => {
    bothModes('genetic_report', 'haplotype', raw, reading);
  });

  // Precise mode is where this cell was bare: strict counted it into
  // `numericValuesWithheld` and precise printed the fragment with
  // nothing beside it.
  it.each([
    ['18kb', 'length_in_kb_not_a_repeat_count'],
    ['18', 'length_in_kb_not_a_repeat_count'],
    ['未检出10kb以下片段', 'unspecified'],
    ['10-20kb', 'unspecified'],
  ])('reads the EcoRI fragment「%s」the same way in both modes', (raw, reading) => {
    bothModes('genetic_report', 'ecoRIFragment', raw, reading);
  });

  it('withholds a grade from a transcribed fragment in both modes', () => {
    bothModes('medical_record', 'ecoRIFragment', '18kb', 'not_read_off_a_laboratory_report');
  });

  // The uncontracted allele, whose count is determinate and whose band
  // is nobody's. Both modes printed it as a report sending its reader
  // off to evaluate FSHD2.
  it.each(['22', '8'])('refuses the uncontracted allele「%s」a band in both modes', (raw) => {
    bothModes('genetic_report', 'd4z4RepeatOther', raw, 'other_allele_not_the_contracted_one');
  });

  // The laboratory gate is the same refusal one step further out, and
  // it was lost the same way: a repeat count a clinic letter quoted
  // reached a precise-consent patient as a number with no origin.
  it('withholds a grade from a transcription in both modes', () => {
    bothModes('medical_record', 'd4z4Repeats', '3', 'not_read_off_a_laboratory_report');
    bothModes('medical_record', 'haplotype', '4qA', 'not_read_off_a_laboratory_report');
    bothModes('medical_record', 'd4z4Repeats', '18kb', 'not_read_off_a_laboratory_report');
    bothModes('medical_record', 'd4z4Repeats', '0', 'not_read_off_a_laboratory_report');
  });

  // Same rule, one step further out again: the registration form.
  it.each(['3', '18kb', '0'])(
    'withholds a grade from the registration form cell「%s」in both modes',
    (raw) => {
      for (const mode of ['strict', 'precise'] as const) {
        const { fields } = redactFields({ d4z4: raw }, { scope: 'profile', mode });
        expect(fields.d4z4_clinical).toBe('not_read_off_a_laboratory_report');
        expect(fields.d4z4).toBe(mode === 'precise' ? raw : undefined);
      }
    },
  );

  // The one cell with no sibling in either mode: this repo states no
  // methylation boundary, so there is no reading to carry. A
  // measurement joins `numericValuesWithheld` with every other withheld
  // measurement rather than being relabelled as a grade of it.
  it('says nothing beside a methylation value, and grades it in neither mode', () => {
    expect(cell('strict', 'genetic_report', 'methylationValue', '0.35')).toEqual({
      raw: undefined,
      reading: undefined,
    });
    expect(cell('precise', 'genetic_report', 'methylationValue', '0.35')).toEqual({
      raw: '0.35',
      reading: undefined,
    });
    // The laboratory's own word survives strict mode as itself — the
    // same rule every other qualitative result on the blob gets.
    expect(cell('strict', 'genetic_report', 'methylationValue', '未检出')).toEqual({
      raw: '未检出',
      reading: undefined,
    });
  });

  /**
   * NO READING, BUT AN ORIGIN — the one thing this cell was missing,
   * and the one its siblings all carried.
   *
   * `methylationCell` was the ONLY genetics reader with no
   * `fromLaboratoryReport` argument, and neither call site passed an
   * origin. So a percentage a patient typed into the registration form,
   * and a percentage a 病历摘要 quoted off somebody else's report, were
   * rendered to the assistant as bare results sitting directly beside
   * sibling cells that DO state the refusal — on the FSHD2
   * discriminator, the cell 甲基化临床分级 was deleted for overclaiming
   * about.
   *
   * The origin is stated in BOTH modes, like every other refusal here:
   * a refusal to read a cell is not a redaction.
   */
  const origin = (mode: RedactionMode, documentType: string, raw: unknown): unknown => {
    const { fields } = redactFields(
      { documentType, fields: { classifiedType: documentType, methylationValue: raw } },
      { scope: 'reports', mode },
    );
    const projected = (fields.fields ?? fields.fields_clinical) as Record<string, unknown>;
    return projected.methylationValue_origin;
  };

  it('states where a methylation cell came from, in both modes', () => {
    for (const mode of ['strict', 'precise'] as const) {
      // A transcription quoting a percentage, and quoting a word.
      expect(origin(mode, 'medical_record', '12%')).toBe('not_read_off_a_laboratory_report');
      expect(origin(mode, 'medical_record', '未检出')).toBe('not_read_off_a_laboratory_report');
      // A cell this platform cannot read as a value at all still says
      // where the cell came from.
      expect(origin(mode, 'medical_record', ['35', '40'])).toBe('not_read_off_a_laboratory_report');
      // Off the laboratory's own report there is nothing to refuse.
      expect(origin(mode, 'genetic_report', '12%')).toBeUndefined();
    }
  });

  it('states the origin of the profile methylation cell in both modes', () => {
    // `diseaseBackground.methylation` is the registration form's own
    // box. Its two siblings said `not_read_off_a_laboratory_report`
    // about the same profile in the same run; this cell said nothing.
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields(
        { methylation: '12%', d4z4: '3', haplotype: '4qA' },
        { scope: 'profile', mode },
      );
      expect(fields.methylation_origin).toBe('not_read_off_a_laboratory_report');
      expect(fields.d4z4_clinical).toBe('not_read_off_a_laboratory_report');
      // Still no grade of the value itself, in either mode.
      expect(fields.methylation_clinical).toBeUndefined();
    }
    // And the flag the redactor reads it off never reaches a prompt.
    const { fields } = redactFields(
      { methylation: '未检出', methylationFromLaboratoryReport: true },
      { scope: 'profile', mode: 'precise' },
    );
    expect(fields.methylationFromLaboratoryReport).toBeUndefined();
    expect(fields.methylation_origin).toBeUndefined();
    expect(fields.methylation).toBe('未检出');
  });

  // The report's own date, on the same footing as `diagnosisYear`:
  // `reportDate` is on neither allowlist, so deriving the year in
  // strict alone left a precise-consent patient with an undated report.
  it('still derives the report year in both modes', () => {
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields(
        { documentType: 'genetic_report', reportDate: '2026-04-01' },
        { scope: 'reports', mode },
      );
      expect(fields.reportDate).toBeUndefined();
      expect(fields.reportDate_year).toBe(2026);
    }
  });
});

/**
 * A VERDICT THE PARSER COMPUTED IS NOT A CELL THE LABORATORY PRINTED.
 *
 * `_extract_genetic` used to derive `genetic_positive` as 「yes if the
 * text named FSHD1/FSHD2 or any digit followed D4Z4, else uncertain」,
 * and every state this platform refuses to read produced 「yes」. The
 * flag carried no digit, so it cleared the qualitative-result gate and
 * reached the model in strict mode too — settled, and standing beside
 * the reading that says the cell cannot be read.
 *
 * THE DERIVATION IS GONE FROM THE PARSER NOW, so these cases are the
 * regression guard rather than the live defence: payloads written
 * before the deletion still carry the flag and are still on disk, and
 * deny-by-default has to keep holding for them.
 */
describe('a verdict the parser computed never reaches the assistant', () => {
  const promptFields = (mode: RedactionMode, cells: Record<string, unknown>) => {
    const { fields } = redactFields(
      {
        documentType: 'genetic_report',
        fields: { classifiedType: 'genetic_report', ...cells },
      },
      { scope: 'reports', mode },
    );
    return (fields.fields ?? fields.fields_clinical) as Record<string, unknown>;
  };

  it.each([
    ['0', 'zero_repeat_count_not_a_valid_reading'],
    ['3kb', 'length_in_kb_not_a_repeat_count'],
    ['未检出3个重复单元', 'unspecified'],
    ['3', 'within_fshd1_repeat_range'],
  ])('drops it beside the cell「%s」in both modes', (raw, reading) => {
    for (const mode of ['strict', 'precise'] as const) {
      const projected = promptFields(mode, {
        d4z4Repeats: raw,
        geneticPositive: 'yes',
        genetic_positive: 'yes',
      });
      expect(projected.geneticPositive).toBeUndefined();
      expect(projected.genetic_positive).toBeUndefined();
      // What it was derived from stays, with this platform's reading.
      expect(projected.d4z4Repeats_clinical).toBe(reading);
    }
  });

  it('leaves the words the report itself printed where the parser found them', () => {
    // The flag's inputs are on the allowlist already, so nothing the
    // laboratory printed is lost with it.
    const projected = promptFields('precise', {
      diagnosisType: 'FSHD1',
      geneticPositive: 'uncertain',
    });
    expect(projected.diagnosisType).toBe('FSHD1');
    expect(projected.geneticPositive).toBeUndefined();
  });
});

describe('HARD_DELETE_KEYS is matched case-insensitively', () => {
  it('removes PatientName / PATIENT_NAME / Date_Of_Birth / EMAIL', () => {
    const input = {
      PatientName: '李四',
      PATIENT_NAME: '王五',
      Date_Of_Birth: '1990-05-20',
      EMAIL: 'leak@example.com',
      diagnosisType: 'FSHD1',
    };
    const { fields, stats } = redactFields(input, {
      scope: 'profile',
      mode: 'precise',
    });
    expect(fields.PatientName).toBeUndefined();
    expect(fields.PATIENT_NAME).toBeUndefined();
    expect(fields.Date_Of_Birth).toBeUndefined();
    expect(fields.EMAIL).toBeUndefined();
    expect(stats.hardDeleted).toEqual(
      expect.arrayContaining(['PatientName', 'PATIENT_NAME', 'Date_Of_Birth', 'EMAIL']),
    );
    expect(fields.diagnosisType).toBe('FSHD1');
  });
});

describe('redactFields (profile, precise mode)', () => {
  it('preserves raw d4z4 / methylation / haplotype values', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'precise',
    });
    expect(fields.d4z4).toBe('3/22');
    expect(fields.methylation).toBe('12%');
    expect(fields.haplotype).toBe('4qA');
  });

  // This scope's two genetics cells are the boxes on the registration
  // form, so the sentence beside them is the one the passport prints in
  // their bracket — and it is the patient's own consent to share more
  // that used to remove it.
  it('keeps saying the registration form is not a laboratory report', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'precise',
    });
    expect(fields.d4z4_clinical).toBe('not_read_off_a_laboratory_report');
    expect(fields.haplotype_clinical).toBe('not_read_off_a_laboratory_report');
  });

  // `value_withheld` is a statement about what was shared, not a
  // reading of the cell, so it is the one sibling that must NOT appear
  // beside a shared value — it would be false there. Nothing replaces
  // it: this platform has no methylation boundary to state.
  it('says nothing about the methylation value it is now printing', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'precise',
    });
    expect(fields.methylation).toBe('12%');
    expect(fields.methylation_clinical).toBeUndefined();
    expect(fields.methylation_withheld).toBeUndefined();
  });

  // Derived in strict mode alone, and on neither allowlist in its raw
  // form, so consenting to share more used to erase the date outright:
  // the day is dropped in both modes and the year was computed in only
  // one. The retriever writes `diagnosisDate` off the profile column
  // and `diagnosisYear` off the baseline payload, so a patient can
  // easily have the first and not the second.
  it('still derives the diagnosis year from a date the day is stripped from', () => {
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields(
        { diagnosisDate: '2023-06-01', gender: 'female' },
        { scope: 'profile', mode },
      );
      expect(fields.diagnosisDate).toBeUndefined();
      expect(fields.diagnosisYear).toBe(2023);
    }
  });

  it('still hard-deletes pure identifiers in precise mode', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'precise',
    });
    expect(fields.fullName).toBeUndefined();
    expect(fields.contactPhone).toBeUndefined();
    expect(fields.idCard).toBeUndefined();
    expect(fields.notes).toBeUndefined();
  });
});

describe('redactFields (reports)', () => {
  const reportFields = {
    classifiedType: 'genetic_report',
    documentType: 'genetic_report',
    title: '基因检测报告',
    reportDate: '2026-04-01',
    status: 'processed',
    fields: {
      classifiedType: 'genetic_report',
      diagnosisType: 'FSHD1',
      // A cell the report states as one number, so the OCR path has a
      // determinate count to band — which is what these tests are
      // about. The cells that are NOT a count are covered above.
      d4z4Repeats: '3',
      haplotype: '4qA',
      methylationValue: '12%',
      reportIssueDate: '2026-04-01',
    },
  };

  it('strict mode clinicalises OCR field map and drops the raw `fields`', () => {
    const { fields } = redactFields(reportFields, {
      scope: 'reports',
      mode: 'strict',
    });
    expect(fields.fields).toBeUndefined();
    expect(fields.reportDate).toBeUndefined();
    expect(fields.reportDate_year).toBe(2026);
    const fc = fields.fields_clinical as Record<string, unknown>;
    expect(fc).toBeDefined();
    expect(fc.d4z4Repeats_clinical).toBe('within_fshd1_repeat_range');
    expect(fc.haplotype_clinical).toBe('permissive_haplotype');
    // The methylation measurement is withheld and counted, not graded:
    // there is no boundary in this repo to read it against.
    expect(fc.methylationValue_clinical).toBeUndefined();
    expect(fc.methylationValue).toBeUndefined();
    expect(fc.numericValuesWithheld).toBe(1);
    // The subtype is a classification and survives, as it does on the
    // profile — see the block below.
    expect(fc.diagnosisType).toBe('FSHD1');
    expect(fc.reportIssueDate_year).toBe(2026);
  });

  // 「FSHD1」 carries a digit, so the conservative measurement test read
  // the subtype as a measurement: strict mode dropped it off the blob
  // and counted it into `numericValuesWithheld`, announcing a
  // measurement the model could not see on a report that had none —
  // while the profile scope printed the same value under 分型/诊断方式.
  describe('a classification cell whose name ends in 「type」', () => {
    const blob = (key: string, raw: unknown, mode: RedactionMode = 'strict') => {
      const { fields } = redactFields(
        { fields: { classifiedType: 'genetic_report', [key]: raw } },
        { scope: 'reports', mode },
      );
      return (fields.fields ?? fields.fields_clinical) as Record<string, unknown>;
    };

    it('survives strict mode on every spelling the safe list carries', () => {
      for (const key of ['diagnosisType', 'diagnosis_type', 'geneType', 'geneticType']) {
        expect(blob(key, 'FSHD1')[key]).toBe('FSHD1');
      }
      expect(blob('diagnosisType', 'FSHD1').numericValuesWithheld).toBeUndefined();
    });

    it('agrees with what the profile scope prints for the same value', () => {
      const { fields } = redactFields(
        { diagnosisType: 'FSHD1' },
        { scope: 'profile', mode: 'strict' },
      );
      expect(fields.diagnosisType).toBe(blob('diagnosisType', 'FSHD1').diagnosisType);
    });

    it('withholds the cell the moment it stops being one token', () => {
      // A classification cell is where an extractor puts its overflow,
      // and the count stapled on is exactly what precise consent buys.
      for (const overflow of ['FSHD1(D4Z4 3拷贝)', 'FSHD1 / D4Z4 3', 'FSHD1：3拷贝', '20-30']) {
        const fc = blob('diagnosisType', overflow);
        expect(fc.diagnosisType).toBeUndefined();
        expect(fc.numericValuesWithheld).toBe(1);
      }
      // ...and a value with no letter in it is a number however the key
      // is named.
      expect(blob('diagnosisType', '320').diagnosisType).toBeUndefined();
      // Precise consent still buys all of it.
      expect(blob('diagnosisType', 'FSHD1(D4Z4 3拷贝)', 'precise').diagnosisType).toBe(
        'FSHD1(D4Z4 3拷贝)',
      );
    });
  });

  it('strict mode drops unknown OCR keys (deny-by-default)', () => {
    const { fields } = redactFields(
      {
        ...reportFields,
        fields: {
          ...(reportFields.fields as Record<string, unknown>),
          patientName: '张三',
          freeFormFindings: '患者张三主诉下肢无力，姓名身份证已记录',
          classifiedType: 'genetic_report',
        },
      },
      { scope: 'reports', mode: 'strict' },
    );
    const fc = fields.fields_clinical as Record<string, unknown>;
    expect(fc.patientName).toBeUndefined();
    expect(fc.freeFormFindings).toBeUndefined();
    // `classifiedType` is a classification the pipeline assigned, not a
    // measurement and not an identifier, so strict keeps it. Dropping
    // it left the report summariser unable to say what kind of report
    // it was reading — it called a stool panel「血液检测报告」.
    expect(fc.classifiedType).toBe('genetic_report');
    // Known-pattern keys still survive as clinicalised siblings.
    expect(fc.d4z4Repeats_clinical).toBe('within_fshd1_repeat_range');
  });

  it('strict mode keeps qualitative results but withholds measurements', () => {
    const { fields } = redactFields(
      {
        fields: {
          classifiedType: 'infection_screening',
          tppa: '阴性(-)',
          trust_ab: '阴性(-)',
          ck: '1024',
          fvc: '2.31',
          patientName: '张三',
        },
      },
      { scope: 'reports', mode: 'strict' },
    );
    const fc = fields.fields_clinical as Record<string, unknown>;
    // The consent the patient withheld is「精确数值」, and 阴性 is not a
    // number — it is the test's own conclusion.
    expect(fc.tppa).toBe('阴性(-)');
    expect(fc.trust_ab).toBe('阴性(-)');
    // Measurements stay withheld, but their existence is stated so the
    // model reports「需要授权」rather than「报告识别失败」.
    expect(fc.ck).toBeUndefined();
    expect(fc.fvc).toBeUndefined();
    expect(fc.numericValuesWithheld).toBe(2);
    expect(fc.patientName).toBeUndefined();
  });

  // A titre is the number, wearing a qualitative word in front of it.
  // The value observed in production inside `ecgSummary` — a key on the
  // precise safe list. The allowlist's premise is that a listed key
  // holds a short structured value; the extractor broke that premise,
  // and every row already in the database still holds the old value.
  it('drops a safe key whose value carries an identifier', () => {
    const { fields } = redactFields(
      {
        fields: {
          classifiedType: 'ecg',
          ecgSummary:
            '房率: 70 bmp 实性心律不齐 年龄:23 科别:神经内科 门诊号: 住院号:R000000 本报告仅供临床医师参考',
          heartRate: '70',
        },
      },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.ecgSummary).toBeUndefined();
    expect(f.fieldsDroppedAsUnsafe).toBe(1);
    // The rest of the report is untouched — one bad value is not a
    // reason to withhold the whole panel.
    expect(f.heartRate).toBe('70');
  });

  it('drops a safe key whose value is far too long to be one', () => {
    const { fields } = redactFields(
      { fields: { classifiedType: 'ecg', ecgSummary: '所见描述文字。'.repeat(40) } },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.ecgSummary).toBeUndefined();
    expect(f.fieldsDroppedAsUnsafe).toBe(1);
  });

  /**
   * THE SAME CHECK ON THE GENETICS CELLS, WHICH SKIP THE SAFE-KEY
   * BRANCH ENTIRELY.
   *
   * `publishGeneticCell` wrote `out[key] = value` in precise mode with
   * NO value check at all, so the identical production string — the one
   * dropped under `ecgSummary` two tests above — was published verbatim
   * under `d4z4Repeats`, `haplotype` or `methylationValue`. It needs no
   * extractor regression to arrive there: `EDITABLE_OCR_FIELDS` lets a
   * patient hand-correct exactly those cells, and a name typed INSIDE
   * the cell is not under `patientName`, so layer 1 does not see it.
   */
  const IDENTIFIED_DUMP =
    '3个重复单元 患者姓名 张伟 年龄:23 科别:神经内科 门诊号: 住院号:R000000 ' +
    '标本号:20260818001 送检医师 李医生 本报告仅供临床医师结合临床参考';

  it.each(['d4z4Repeats', 'haplotype', 'methylationValue', 'ecoriFragmentKb'])(
    'drops a genetics cell whose value carries an identifier (%s)',
    (key) => {
      const { fields } = redactFields(
        {
          documentType: 'genetic_report',
          fields: { classifiedType: 'genetic_report', [key]: IDENTIFIED_DUMP },
        },
        { scope: 'reports', mode: 'precise' },
      );
      const f = fields.fields as Record<string, unknown>;
      expect(f[key]).toBeUndefined();
      expect(String(JSON.stringify(f))).not.toContain('住院号');
      expect(String(JSON.stringify(f))).not.toContain('张伟');
      // Named rather than silent, exactly as for a safe key.
      expect(f.fieldsDroppedAsUnsafe).toBe(1);
    },
  );

  it('still publishes this platform’s reading of a genetics cell it refused to show', () => {
    // The refused thing is the cell's own text, not the reading of it —
    // otherwise strict mode drops the raw cell, no reading is written,
    // and the assistant reports the report as having no such cell.
    const { fields } = redactFields(
      {
        documentType: 'genetic_report',
        fields: { classifiedType: 'genetic_report', d4z4Repeats: IDENTIFIED_DUMP },
      },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.d4z4Repeats).toBeUndefined();
    expect(f.d4z4Repeats_clinical).toBe('unspecified');
  });

  it('keeps a normal conclusion', () => {
    const { fields } = redactFields(
      { fields: { classifiedType: 'ecg', ecgSummary: '窦性心律不齐，不完全性右束支传导阻滞。' } },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.ecgSummary).toBe('窦性心律不齐，不完全性右束支传导阻滞。');
    expect(f.fieldsDroppedAsUnsafe).toBeUndefined();
  });

  // `reportImpression` is not on the safe list at all, so the MRI
  // impression — signature and all — never reached a prompt. Pinned so
  // a future "let the model read the impression" change has to notice
  // that the value-level guard is what makes that safe.
  it('still denies an un-listed free-text key by default', () => {
    const { fields } = redactFields(
      { fields: { classifiedType: 'muscle_mri', reportImpression: '脂肪浸润，请结合临床. 钱医' } },
      { scope: 'reports', mode: 'precise' },
    );
    expect((fields.fields as Record<string, unknown>).reportImpression).toBeUndefined();
  });

  // The pipeline writes every lab field twice. Both spellings are safe
  // keys, so both used to reach the prompt — and the model reported the
  // duplicate as a third analyte.
  it('collapses camelCase/snake_case aliases of the same value', () => {
    const { fields } = redactFields(
      {
        fields: {
          classifiedType: 'infection_screening',
          trustAb: '阴性(-)',
          trust_ab: '阴性(-)',
          stoolColor: '黄色',
          stool_color: '黄色',
        },
      },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.trustAb).toBe('阴性(-)');
    expect(f.stoolColor).toBe('黄色');
    expect(f.trust_ab).toBeUndefined();
    expect(f.stool_color).toBeUndefined();
  });

  // Disagreement is data, not noise — picking one would be the redactor
  // silently editing a clinical value.
  it('keeps both spellings when they disagree', () => {
    const { fields } = redactFields(
      { fields: { stoolColor: '黄色', stool_color: '棕色' } },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.stoolColor).toBe('黄色');
    expect(f.stool_color).toBe('棕色');
  });

  it('strict mode withholds a qualitative-looking value carrying a figure', () => {
    const { fields } = redactFields(
      { fields: { classifiedType: 'infection_screening', trust_ab: '阳性(1:8)' } },
      { scope: 'reports', mode: 'strict' },
    );
    const fc = fields.fields_clinical as Record<string, unknown>;
    expect(fc.trust_ab).toBeUndefined();
    expect(fc.numericValuesWithheld).toBe(1);
  });

  it('strict mode strips `title` even when callers add it', () => {
    const { fields } = redactFields(
      { ...reportFields, title: '张三的基因检测报告 2026' },
      { scope: 'reports', mode: 'strict' },
    );
    expect(fields.title).toBeUndefined();
  });

  it('precise mode keeps raw OCR fields and raw report date', () => {
    const { fields } = redactFields(reportFields, {
      scope: 'reports',
      mode: 'precise',
    });
    const f = fields.fields as Record<string, unknown>;
    expect(f).toBeDefined();
    expect(f.d4z4Repeats).toBe('3');
    expect(f.haplotype).toBe('4qA');
    expect(fields.fields_clinical).toBeUndefined();
  });
});

describe('OCR fields — lab panels in precise mode', () => {
  // A coagulation report whose values were all extracted correctly
  // still reached the model empty, because the nested-fields allowlist
  // only ever listed the genetics keys. The model then reported an OCR
  // failure that had not happened.
  const COAGULATION = {
    classifiedType: 'coagulation',
    pt: '13.7',
    aptt: '34',
    inr: '1.12',
    fibrinogen: '2.68',
    // Identity travelling in the same payload — must not follow the
    // values through.
    patientName: '张三丰·李四光',
    orderingDoctor: '赵医生',
    bedNo: '011',
    facility: '示例市第一人民医院',
    department: '神经内科',
  };

  it('forwards the measured values', () => {
    const { fields } = redactFields({ fields: COAGULATION }, { scope: 'reports', mode: 'precise' });
    const inner = fields.fields as Record<string, unknown>;
    expect(inner.pt).toBe('13.7');
    expect(inner.aptt).toBe('34');
    expect(inner.inr).toBe('1.12');
    expect(inner.fibrinogen).toBe('2.68');
  });

  it('still denies every identity field beside them', () => {
    const { fields } = redactFields({ fields: COAGULATION }, { scope: 'reports', mode: 'precise' });
    const blob = JSON.stringify(fields);
    for (const leaked of ['张三丰', '赵医生', '011', '示例市第一人民医院', '神经内科']) {
      expect(blob).not.toContain(leaked);
    }
  });

  it('drops lab values entirely in strict mode', () => {
    // precise is opt-in; basic consent still gets the classification
    // only.
    const { fields } = redactFields({ fields: COAGULATION }, { scope: 'reports', mode: 'strict' });
    expect(JSON.stringify(fields)).not.toContain('13.7');
  });
});
