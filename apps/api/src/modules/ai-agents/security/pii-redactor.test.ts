import { describe, expect, it, vi } from 'vitest';

import type { RedactionMode } from './allowlist.js';
import { REPORT_IMPRESSION_CHANNEL_ENABLED } from './allowlist.js';
import type { FreeTextOutcome } from './pii-redactor.js';
import { GENETIC_READING_REFUSALS, gateReportImpression, redactFields } from './pii-redactor.js';
import { renderChunkForPrompt } from './render.js';
import { GENETIC_FIELD_KEYS } from '../../patient-profile/genetic-evidence.js';
import type { RetrievedChunk } from '../retrievers/base.js';

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
        fields: { classifiedType: documentType, documentType, [key]: raw },
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
            documentType: 'genetic_report',
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

  it('does not let a haplotype cell it refuses to read gate the repeat count', () => {
    // ONE CELL, ONE RUN, ONE ANSWER — the rule `clinicalise` states for
    // the profile scope's copy of this gate 「AND A CELL THIS PLATFORM
    // WOULD NOT SHOW CANNOT GATE ANYTHING」, asked here too.
    //
    // The reports-scope gate read `pickReading(...haplotype)` and never
    // asked `isUntrustworthyValue`, so the SAME PASS refused to publish
    // the cell and believed it anyway: a 9 came out
    // `repeat_count_not_read_against_fshd1_range_non_permissive_haplotype`
    // — whose documented content is 「the report this count came off
    // states 4qB」 — with no `haplotype`, no `haplotype_clinical` and no
    // 4qB anywhere on the block to refer to, over a run prompt that
    // tells the model to answer 「我的单倍型是不是允许型」 straight off
    // these fields. The profile scope, on the identical cell, said the
    // grey-zone note.
    //
    // AND IT WAS WRONG, not merely inconsistent.
    // `parsePermissiveHaplotype` matches the probe names as bare
    // substrings, so the second paste below — a 检测方法/说明 block whose
    // only 4qB is the boilerplate 「4qB 型等位基因不具有致病性」, stating
    // nothing about THIS patient's allele — banded a grey-zone FSHD1
    // candidate as a count not read against the FSHD1 range. Same defect
    // `publishGeneticCell` records for the size cells, one cell along.
    const refusedHaplotypes = [
      // The live hand-correction paste `publishMethylationCell` names.
      '4q单倍型:4qB 姓名:张三 科别:神经内科 住院号:R000000',
      '检测方法:Southern blot（EcoRI/BlnI 双酶切，p13E-11 探针杂交）。' +
        '说明:4qB 型等位基因不具有致病性，本次检测未对 4q35 区域以外的位点进行分析。' +
        '送检单位:某某医院神经内科门诊 住院号:R000000 报告医师:李四',
    ];
    for (const haplotype of refusedHaplotypes) {
      const { fields } = redactFields(
        {
          documentType: 'genetic_report',
          fields: {
            classifiedType: 'genetic_report',
            documentType: 'genetic_report',
            d4z4Repeats: '9',
            haplotype,
          },
        },
        { scope: 'reports', mode: 'precise' },
      );
      const projected = fields.fields as Record<string, unknown>;
      // The cell is refused, which is why it cannot gate: nothing about
      // it is published, so a refusal minted off it would have no
      // referent on the block.
      expect(projected).not.toHaveProperty('haplotype');
      expect(projected).not.toHaveProperty('haplotype_clinical');
      expect(projected.fieldsDroppedAsUnsafe).toBe(1);
      // `null`, not `false` — 「unknown」 keeps the grey-zone note, the
      // direction that only adds uncertainty.
      expect(projected.d4z4Repeats_clinical).toBe('within_fshd1_repeat_range_grey_zone_8_to_10');
      // ...and the other scope, handed the same cell, agrees.
      const profile = redactFields(
        {
          d4z4: '9',
          haplotype,
          d4z4FromLaboratoryReport: true,
          haplotypeFromLaboratoryReport: true,
        },
        { scope: 'profile', mode: 'precise' },
      );
      expect(profile.fields.d4z4_clinical).toBe(projected.d4z4Repeats_clinical);
    }
    // A cell this platform WILL show still gates, both ways. The guard
    // is on the refusal, not on the reading.
    const gatedBy = (haplotype: string): unknown => {
      const { fields } = redactFields(
        {
          documentType: 'genetic_report',
          fields: {
            classifiedType: 'genetic_report',
            documentType: 'genetic_report',
            d4z4Repeats: '9',
            haplotype,
          },
        },
        { scope: 'reports', mode: 'strict' },
      );
      return (fields.fields_clinical as Record<string, unknown>).d4z4Repeats_clinical;
    };
    expect(gatedBy('4qB')).toBe(
      'repeat_count_not_read_against_fshd1_range_non_permissive_haplotype',
    );
    expect(gatedBy('4qA')).toBe('within_fshd1_repeat_range_grey_zone_8_to_10');
  });

  it('gates the repeat count on the same haplotype cells it publishes readings for', () => {
    // THE GATE AND THE LOOP HAVE TO WALK ONE SET OF KEYS.
    //
    // The dispatch in `projectOcrFields` mints a haplotype reading for
    // EVERY key containing 「haplotype」 — that substring is the class,
    // which is what `clinicaliseEcoRIFragment` records about naming a
    // subset of the spellings. The gate beside it looked the cell up in
    // `GENETIC_FIELD_KEYS.haplotype`, three spellings, so any other one
    // got a reading and no vote: executed on `haplotypeAllele: '4qB'`,
    // one projection carried `haplotypeAllele_clinical:
    // non_permissive_haplotype` and `d4z4Repeats_clinical:
    // within_fshd1_repeat_range_grey_zone_8_to_10` together, in both
    // modes — the 8–10 note, whose own docstring calls it 「a paragraph
    // about the other allele」 over a report naming 4qB, printed under
    // this platform's own statement that the report names 4qB. That is
    // the reassurance commit ca4a261 took off the mobile card, restored
    // on the surface that generates advice.
    const project = (
      fields: Record<string, unknown>,
      mode: 'precise' | 'strict',
    ): Record<string, unknown> => {
      const out = redactFields(
        {
          documentType: 'genetic_report',
          fields: {
            classifiedType: 'genetic_report',
            documentType: 'genetic_report',
            geneticTestMethod: 'Southern blot',
            d4z4Repeats: '9',
            ...fields,
          },
        },
        { scope: 'reports', mode },
      );
      return (out.fields.fields ?? out.fields.fields_clinical) as Record<string, unknown>;
    };
    const REFUSED = 'repeat_count_not_read_against_fshd1_range_non_permissive_haplotype';
    const GREY = 'within_fshd1_repeat_range_grey_zone_8_to_10';

    for (const mode of ['precise', 'strict'] as const) {
      // A spelling outside the three-key table now votes, because it is
      // a cell this same pass reads and publishes.
      const offTable = project({ haplotypeAllele: '4qB' }, mode);
      expect(offTable.haplotypeAllele_clinical).toBe('non_permissive_haplotype');
      expect(offTable.d4z4Repeats_clinical).toBe(REFUSED);

      // Two cells naming one allele each is `parsePermissiveHaplotype`'s
      // 「both probes」 case spread over two keys, and it gets the same
      // answer: unknown, which keeps the grey-zone note.
      const disagreeing = project({ haplotype: '4qA', haplotypeAllele: '4qB' }, mode);
      expect(disagreeing.haplotype_clinical).toBe('permissive_haplotype');
      expect(disagreeing.haplotypeAllele_clinical).toBe('non_permissive_haplotype');
      expect(disagreeing.d4z4Repeats_clinical).toBe(GREY);

      // A cell stating no allele has not disagreed with one that does.
      // `['4qA', '4qB']` is published as `unspecified_haplotype`, and
      // the readable sibling is what the count is gated on.
      const container = project({ haplotype: ['4qA', '4qB'], haplotypeAllele: '4qB' }, mode);
      expect(container.haplotype_clinical).toBe('unspecified_haplotype');
      expect(container.d4z4Repeats_clinical).toBe(REFUSED);

      // The refused half of the same rule, one key along: the cell the
      // pass will not publish does not vote, and the cell it does
      // publish decides. `fieldsDroppedAsUnsafe` counts the first.
      const refusedPlusReadable = project(
        { haplotype: '住院号:R000000', haplotype4q: '4qA' },
        mode,
      );
      expect(refusedPlusReadable).not.toHaveProperty('haplotype_clinical');
      expect(refusedPlusReadable.fieldsDroppedAsUnsafe).toBe(1);
      expect(refusedPlusReadable.haplotype4q_clinical).toBe('permissive_haplotype');
      expect(refusedPlusReadable.d4z4Repeats_clinical).toBe(GREY);

      // A NAME THE PRINTER CHOSE MAY NOT BUY A CLINICAL BAND AND MAY NOT
      // BUY A VOTE ON ONE. `table_*` is slugged from a printed analyte
      // name — see `isGenericTableKey` — so it reaches neither the
      // dispatch nor the gate.
      const printerMinted = project({ table_haplotype_4q: '4qB' }, mode);
      expect(printerMinted).not.toHaveProperty('table_haplotype_4q_clinical');
      expect(printerMinted.d4z4Repeats_clinical).toBe(GREY);
    }
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
            documentType: 'genetic_report',
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
      { documentType, fields: { classifiedType: documentType, documentType, [key]: raw } },
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
      {
        documentType,
        fields: { classifiedType: documentType, documentType, methylationValue: raw },
      },
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
        fields: { classifiedType: 'genetic_report', documentType: 'genetic_report', ...cells },
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
      documentType: 'genetic_report',
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
        {
          fields: { classifiedType: 'genetic_report', documentType: 'genetic_report', [key]: raw },
        },
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
          documentType: 'genetic_report',
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
          fields: {
            classifiedType: 'genetic_report',
            documentType: 'genetic_report',
            [key]: IDENTIFIED_DUMP,
          },
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

  /**
   * A CELL THIS PLATFORM WILL NOT SHOW IS NOT A CELL IT HAS READ.
   *
   * This test used to assert the opposite — 「still publishes this
   * platform's reading of a genetics cell it refused to show」, on the
   * ground that the refused thing is the cell's own text and not the
   * reading of it. `publishGeneticCell` ran the reader BEFORE
   * `publishRawCell` asked `isUntrustworthyValue`, so the reading was
   * minted from a string the same projection then refused, and in
   * precise mode both statements went out together.
   *
   * The case that shows why it cannot stand is an inpatient record
   * number, which `patchDocumentOcrFields` lets a patient paste into
   * this very cell: THE DIGITS OF THE RECORD NUMBER became the repeat
   * count, and the model was told the report's D4Z4 count is above the
   * FSHD1 range — the label whose whole documented meaning is that the
   * guideline is sending this reader off to evaluate FSHD2. In strict
   * mode, where the raw cell is dropped anyway, that band was the only
   * thing the prompt carried about the cell.
   *
   * `fieldsDroppedAsUnsafe` is what the model gets instead, and it is
   * the same answer a safe key whose value failed the same check gets.
   */
  it.each([
    ['an identified dump', IDENTIFIED_DUMP],
    // A bare record number: `readSizeCell` reads 000000 → 0 out of
    // 「R000000」 in one spelling and a count out of the other, so the
    // band this produced was 「above_fshd1_repeat_range」.
    ['a bare record number', '住院号:R000000'],
    ['a record number with a department', '住院号 R12345678 科别:神经内科'],
  ])('reads nothing off a genetics cell it refuses to show (%s)', (_label, raw) => {
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields(
        {
          documentType: 'genetic_report',
          fields: {
            classifiedType: 'genetic_report',
            documentType: 'genetic_report',
            d4z4Repeats: raw,
          },
        },
        { scope: 'reports', mode },
      );
      const f = (fields.fields ?? fields.fields_clinical) as Record<string, unknown>;
      expect(f.d4z4Repeats).toBeUndefined();
      // No band, no refusal-shaped reading, nothing at all: there is no
      // cell to have read.
      expect(f.d4z4Repeats_clinical).toBeUndefined();
      expect(Object.keys(f).filter((key) => key.startsWith('d4z4'))).toEqual([]);
      expect(f.fieldsDroppedAsUnsafe).toBe(1);
    }
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

/**
 * THE CELL THAT NAMES THE DIAGNOSIS, AND WHERE IT CAME FROM.
 *
 * `projectOcrFields` dispatches the genetics cells on the substrings
 * 「d4z4」/「ecori」/「methylation」/「haplotype」, and `diagnosisType` —
 * with its `geneticType` / `geneType` / `diagnosis_type` /
 * `genetic_type` spellings, all of them `GENETIC_FIELD_KEYS.geneticType`
 * — matches none of them. It fell through to the safe-key branch, which
 * asks only whether a key is safe to NAME, and was published verbatim
 * in both modes on the stated ground that a category label like
 *「FSHD1」is non-PII. That is a PII argument, and the question the
 * siblings answer is a provenance one: `fromLaboratoryReport` was
 * computed and passed into this projection, and every other genetics
 * cell on the same 病历摘要 rendered `not_read_off_a_laboratory_report`
 * beside itself. Stating the refusal beside everything EXCEPT the
 * diagnosis implies the diagnosis is the one cell that WAS read off a
 * laboratory report — and on a 出院小结 that row is the only genetics
 * content on the page.
 */
describe('the diagnosis cell carries the origin its siblings carry', () => {
  const projected = (
    mode: RedactionMode,
    documentType: string,
    cells: Record<string, unknown>,
  ): Record<string, unknown> => {
    const { fields } = redactFields(
      { documentType, fields: { classifiedType: documentType, documentType, ...cells } },
      { scope: 'reports', mode },
    );
    return (fields.fields ?? fields.fields_clinical) as Record<string, unknown>;
  };

  it.each([
    'diagnosisType',
    'geneticType',
    'geneType',
    'diagnosis_type',
    'genetic_type',
    // On the safe list and NOT in the passport's key table, which is a
    // preference order for reading one value rather than a census of
    // spellings. The bridge writes both forms of every field.
    'gene_type',
  ])('states the origin beside 「%s」 in both modes', (key) => {
    for (const mode of ['strict', 'precise'] as const) {
      const blob = projected(mode, 'medical_record', { [key]: 'FSHD1' });
      // The label itself still reaches the model — it is a
      // classification, and withholding it was never the point.
      expect(blob[key]).toBe('FSHD1');
      expect(blob[`${key}_origin`]).toBe('not_read_off_a_laboratory_report');
    }
  });

  it('says it beside the siblings that already said it, and not alone', () => {
    // The rendered block, which is where the implication lived: one
    // cell silent among four that refuse.
    const blob = projected('strict', 'medical_record', {
      diagnosisType: 'FSHD1',
      d4z4Repeats: '3',
      haplotype: '4qA',
      methylationValue: '12%',
    });
    expect(blob.diagnosisType_origin).toBe('not_read_off_a_laboratory_report');
    expect(blob.d4z4Repeats_clinical).toBe('not_read_off_a_laboratory_report');
    expect(blob.haplotype_clinical).toBe('not_read_off_a_laboratory_report');
    expect(blob.methylationValue_origin).toBe('not_read_off_a_laboratory_report');
  });

  it('refuses nothing off the laboratory’s own report', () => {
    for (const mode of ['strict', 'precise'] as const) {
      const blob = projected(mode, 'genetic_report', { diagnosisType: 'FSHD1' });
      expect(blob.diagnosisType).toBe('FSHD1');
      expect(blob.diagnosisType_origin).toBeUndefined();
    }
  });

  // The class is closed by the passport's own key table rather than by
  // a substring, and 「gene」 is why: a substring match would sweep in
  // the verdict `_extract_genetic` used to compute and publish it with
  // a sibling beside it. It stays denied by default.
  it('does not promote the parser’s own verdict into a genetics cell', () => {
    const blob = projected('precise', 'medical_record', {
      geneticPositive: 'yes',
      genetic_positive: 'yes',
    });
    expect(blob.geneticPositive).toBeUndefined();
    expect(blob.genetic_positive).toBeUndefined();
    expect(blob.geneticPositive_origin).toBeUndefined();
    expect(blob.genetic_positive_origin).toBeUndefined();
  });

  // The same cell on the profile scope, where the autofill puts a
  // report's 分型 into the registration form's own box.
  it('states the origin of the profile’s own subtype cell in both modes', () => {
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields(
        { diagnosisType: 'FSHD1', d4z4: '3' },
        { scope: 'profile', mode },
      );
      expect(fields.diagnosisType).toBe('FSHD1');
      expect(fields.diagnosisType_origin).toBe('not_read_off_a_laboratory_report');
      expect(fields.d4z4_clinical).toBe('not_read_off_a_laboratory_report');
    }
    // And with the flag the retriever now writes, there is nothing to
    // refuse — nor does the flag itself reach a prompt.
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields(
        { diagnosisType: 'FSHD1', diagnosisTypeFromLaboratoryReport: true },
        { scope: 'profile', mode },
      );
      expect(fields.diagnosisType).toBe('FSHD1');
      expect(fields.diagnosisType_origin).toBeUndefined();
      expect(fields.diagnosisTypeFromLaboratoryReport).toBeUndefined();
    }
  });

  it('says nothing about a subtype cell that is not there', () => {
    const { fields } = redactFields({ gender: 'female' }, { scope: 'profile', mode: 'strict' });
    expect(fields.diagnosisType_origin).toBeUndefined();
  });
});

/**
 * THE PROFILE'S METHYLATION CELL, ONCE THE RETRIEVER ANSWERS FOR IT.
 *
 * `geneticCellsFromLaboratoryReport` computed the laboratory-origin
 * flag for `d4z4` and `haplotype` only, so `fields.methylation` arrived
 * with no flag beside it and an absent flag reads as `false`: the
 * prompt asserted `not_read_off_a_laboratory_report` about a value the
 * same request attributed to the laboratory report on five other
 * surfaces — INSIDE the same profile block as two sibling readings that
 * can only be minted when the flag is TRUE.
 */
describe('the profile block does not contradict itself about one document', () => {
  it('refuses nothing when the cell came off the laboratory report', () => {
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields(
        {
          d4z4: '3',
          d4z4FromLaboratoryReport: true,
          haplotype: '4qA',
          haplotypeFromLaboratoryReport: true,
          methylation: '12%',
          methylationFromLaboratoryReport: true,
          diagnosisType: 'FSHD1',
          diagnosisTypeFromLaboratoryReport: true,
        },
        { scope: 'profile', mode },
      );
      // The two readings that can only be minted off a laboratory
      // report...
      expect(fields.d4z4_clinical).toBe('within_fshd1_repeat_range');
      expect(fields.haplotype_clinical).toBe('permissive_haplotype');
      // ...and no sentence beside them saying the same document is not
      // one.
      expect(fields.methylation_origin).toBeUndefined();
      expect(fields.diagnosisType_origin).toBeUndefined();
      expect(JSON.stringify(fields)).not.toContain('not_read_off_a_laboratory_report');
    }
  });

  it('still refuses all four when no document supplied them', () => {
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields(
        { d4z4: '3', haplotype: '4qA', methylation: '12%', diagnosisType: 'FSHD1' },
        { scope: 'profile', mode },
      );
      expect(fields.d4z4_clinical).toBe('not_read_off_a_laboratory_report');
      expect(fields.haplotype_clinical).toBe('not_read_off_a_laboratory_report');
      expect(fields.methylation_origin).toBe('not_read_off_a_laboratory_report');
      expect(fields.diagnosisType_origin).toBe('not_read_off_a_laboratory_report');
    }
  });

  it('never lets a laboratory-origin flag reach a prompt', () => {
    const { fields } = redactFields(
      {
        d4z4: '3',
        d4z4FromLaboratoryReport: true,
        haplotype: '4qA',
        haplotypeFromLaboratoryReport: true,
        methylation: '12%',
        methylationFromLaboratoryReport: true,
        diagnosisType: 'FSHD1',
        diagnosisTypeFromLaboratoryReport: true,
      },
      { scope: 'profile', mode: 'precise' },
    );
    for (const flag of [
      'd4z4FromLaboratoryReport',
      'haplotypeFromLaboratoryReport',
      'methylationFromLaboratoryReport',
      'diagnosisTypeFromLaboratoryReport',
    ]) {
      expect(fields[flag]).toBeUndefined();
    }
  });
});

/**
 * THE DOCUMENT'S OWN PAGE DECIDES THE LABORATORY GATE ON THIS PATH TOO.
 *
 * `isLaboratoryGeneticReport` falls back to the type the UPLOADER
 * declared only where the page shows neither a clinical narrative nor a
 * laboratory's structure — and this projection was the one without the
 * page, so that fallback was every archived row. An archived 病历摘要
 * whose uploader ALSO picked 基因检测报告 was believed here and refused
 * on every other surface. `buildReportFields` carries the page now, and
 * the redactor asks the gate of its INPUT so that layer 1 can delete
 * the text immediately afterwards.
 */
describe('the laboratory gate reads the page the chunk now carries', () => {
  const DISCHARGE_PAGE =
    '出院小结\n主诉：双上肢抬举无力5年。现病史：患者于2019年起病。查体：翼状肩胛。' +
    '诊疗经过：外院基因检测提示 FSHD1。';

  const projected = (mode: RedactionMode, extra: Record<string, unknown>) => {
    const { fields } = redactFields(
      {
        // The uploader picked 基因检测报告 and the archived label agrees
        // — the exact state the gate could not see through.
        documentType: 'genetic_report',
        ...extra,
        fields: {
          classifiedType: 'genetic_report',
          documentType: 'genetic_report',
          d4z4Repeats: '3',
          haplotype: '4qA',
        },
      },
      { scope: 'reports', mode },
    );
    return {
      blob: (fields.fields ?? fields.fields_clinical) as Record<string, unknown>,
      all: JSON.stringify(fields),
    };
  };

  it('refuses a grade once the page shows a clinical narrative', () => {
    for (const mode of ['strict', 'precise'] as const) {
      const { blob } = projected(mode, { extractedText: DISCHARGE_PAGE });
      expect(blob.d4z4Repeats_clinical).toBe('not_read_off_a_laboratory_report');
      expect(blob.haplotype_clinical).toBe('not_read_off_a_laboratory_report');
    }
  });

  it('still grades the laboratory’s own report', () => {
    for (const mode of ['strict', 'precise'] as const) {
      const { blob } = projected(mode, {
        extractedText: '基因检测报告\n检测方法：Southern blot\n检测结论：D4Z4 3 拷贝',
      });
      expect(blob.d4z4Repeats_clinical).toBe('within_fshd1_repeat_range');
      expect(blob.haplotype_clinical).toBe('permissive_haplotype');
    }
  });

  it('publishes no part of the page in either mode', () => {
    for (const mode of ['strict', 'precise'] as const) {
      const { all } = projected(mode, { extractedText: DISCHARGE_PAGE });
      for (const fragment of ['出院小结', '主诉', '现病史', '查体', '诊疗经过', 'extractedText']) {
        expect(all).not.toContain(fragment);
      }
    }
  });

  it('deletes the page at layer 1 rather than dropping it at layer 3', () => {
    // The difference matters: layer 3 is an allowlist, and an
    // allowlist entry added later would publish the OCR full-text dump.
    // Layer 1 is unconditional, recursive and mode-independent.
    const { stats } = redactFields(
      {
        documentType: 'genetic_report',
        extractedText: DISCHARGE_PAGE,
        fields: {
          classifiedType: 'genetic_report',
          documentType: 'genetic_report',
          extracted_text: DISCHARGE_PAGE,
        },
      },
      { scope: 'reports', mode: 'precise' },
    );
    expect(stats.hardDeleted).toEqual(
      expect.arrayContaining(['extractedText', 'fields.extracted_text']),
    );
    expect(stats.notAllowed).not.toContain('extractedText');
  });
});

/**
 * A CELL HOLDING AN ARRAY OR AN OBJECT WAS PUBLISHED VERBATIM, AND THE
 * WALK THAT WAS SUPPOSED TO CLEAN IT NEVER LOOKED INSIDE.
 *
 * Two short-circuits, one on each layer, and each one written as a
 * declaration that the type it did not recognise was safe:
 *
 *   - layer 1 descended into plain objects only — 「arrays and primitives
 *     are left as-is — they cannot have keys to match」. An array cannot
 *     hold a key; an object inside one can.
 *   - `isUntrustworthyValue` opened `if (typeof value !== 'string')
 *     return false`, so an array and an object were declared trustworthy
 *     without being read.
 *
 * The extractor writes a cell as a list whenever a page prints two of
 * something, so `fields.d4z4Repeats = [{ patientName, idCard }]` walked
 * past both, was published raw by `publishGeneticCell` under precise
 * consent, and left `formatScalar` as JSON. The claim it broke is layer
 * 1's own: 「hard-delete keys never reach a prompt regardless of mode」.
 *
 * Driven through `renderChunkForPrompt` rather than asserted on the
 * field map, because the field map is not what the model receives — the
 * old defect was invisible on `fields.d4z4Repeats` being 「an array」 and
 * obvious on the line 「d4z4Repeats: {"patientName":"张三",…}」.
 */
describe('a container cell reaches no prompt unexamined', () => {
  const NAME = '张三';
  const ID_CARD = '110101199001011234';

  const chunkOf = (source: string, fields: Record<string, unknown>): RetrievedChunk => ({
    id: 'chunk-1',
    source,
    content: '',
    distance: null,
    metadata: { fields },
  });

  const CASES: Array<[string, string, Record<string, unknown>]> = [
    [
      'an array under a genetics cell',
      'patient_reports',
      {
        documentType: 'genetic_report',
        fields: {
          classifiedType: 'genetic_report',
          documentType: 'genetic_report',
          d4z4Repeats: [{ patientName: NAME, idCard: ID_CARD }, '3'],
        },
      },
    ],
    [
      'a nested object under the haplotype cell',
      'patient_reports',
      {
        documentType: 'genetic_report',
        fields: {
          classifiedType: 'genetic_report',
          documentType: 'genetic_report',
          haplotype: { probes: [{ patientName: NAME, idCard: ID_CARD }] },
        },
      },
    ],
    [
      'an array under an ordinary safe key',
      'patient_reports',
      {
        documentType: 'genetic_report',
        fields: {
          classifiedType: 'genetic_report',
          documentType: 'genetic_report',
          ecgSummary: [NAME, `住院号:${ID_CARD}`],
        },
      },
    ],
    [
      'an array under the profile scope genetics cell',
      'patient_profile',
      { d4z4FromLaboratoryReport: true, d4z4: [{ patientName: NAME, idCard: ID_CARD }] },
    ],
    [
      'a nested object under the profile scope haplotype cell',
      'patient_profile',
      {
        haplotypeFromLaboratoryReport: true,
        haplotype: { probes: [{ patientName: NAME, idCard: ID_CARD }] },
      },
    ],
  ];

  for (const [label, source, fields] of CASES) {
    for (const mode of ['strict', 'precise'] as const) {
      it(`publishes nothing of ${label} (${mode})`, () => {
        const rendered = renderChunkForPrompt(chunkOf(source, fields), { mode });
        expect(rendered.content).not.toContain(NAME);
        expect(rendered.content).not.toContain(ID_CARD);
        // Not merely absent from the rendered text: absent from the
        // field names the audit log records, so nothing downstream can
        // print the cell back from a name this pass let through.
        expect(rendered.fieldsUsed.join(',')).not.toContain(NAME);
      });
    }
  }

  it('records the hard delete at its position inside the array', () => {
    const { stats, fields } = redactFields(
      {
        documentType: 'genetic_report',
        fields: {
          classifiedType: 'genetic_report',
          documentType: 'genetic_report',
          ecgSummary: [{ patientName: NAME }, '窦性心律'],
        },
      },
      { scope: 'reports', mode: 'precise' },
    );
    // The path names the element, so a removal inside a list is visible
    // in the audit rather than silent.
    expect(stats.hardDeleted).toContain('fields.ecgSummary.0.patientName');
    expect(JSON.stringify(fields)).not.toContain(NAME);
  });

  /**
   * AND A CONTAINER IS NOT A CELL EVEN WHEN IT IS CLEAN. The reading
   * beside a cell does not stop the cell being printed: precise mode
   * went on publishing the probe list, so the prompt carried
   * 「单倍型: 4qA、4qB」 with `unspecified_haplotype` on the next line —
   * one line asserting a haplotype and the next refusing to read one.
   */
  it('prints no genetics cell that is not a scalar, in either mode', () => {
    for (const mode of ['strict', 'precise'] as const) {
      const { fields } = redactFields(
        {
          documentType: 'genetic_report',
          fields: {
            classifiedType: 'genetic_report',
            documentType: 'genetic_report',
            haplotype: ['4qA', '4qB'],
            d4z4Repeats: ['3'],
            diagnosisType: ['FSHD1'],
            ecoRIFragment: true,
          },
        },
        { scope: 'reports', mode },
      );
      const projected = (fields.fields ?? fields.fields_clinical) as Record<string, unknown>;
      expect(projected.haplotype).toBeUndefined();
      expect(projected.d4z4Repeats).toBeUndefined();
      expect(projected.diagnosisType).toBeUndefined();
      // A boolean is one type further in and the same self-contradiction:
      // `formatScalar` prints it 「是」, directly under a reading saying
      // the cell could not be read.
      expect(projected.ecoRIFragment).toBeUndefined();
      // ...and the refusal is still stated, so the model is not told the
      // report has no haplotype.
      expect(projected.haplotype_clinical).toBe('unspecified_haplotype');
      expect(projected.d4z4Repeats_clinical).toBe('unspecified');
    }
  });

  /**
   * A LIST OF SHORT STRINGS IS A REAL SHAPE HERE. `assistiveDevices` is
   * an array by construction, so the fix cannot be 「refuse every
   * container」 — what a container HOLDS is examined, and a clean one
   * survives.
   */
  it('keeps a clean list intact', () => {
    const { fields } = redactFields(
      { assistiveDevices: ['轮椅', '踝足矫形器'] },
      { scope: 'profile', mode: 'strict' },
    );
    expect(fields.assistiveDevices).toEqual(['轮椅', '踝足矫形器']);
  });

  /**
   * THE EXAMINATION IS TOTAL OVER THE REMAINING TYPES TOO. A number is
   * read as its printed form, because JSON carries an 18-digit ID card
   * as a number as readily as a string; a walk that cannot finish
   * answers 「refuse」 rather than 「pass」.
   */
  it('reads an identifier written as a number', () => {
    const { fields } = redactFields(
      { d4z4FromLaboratoryReport: true, d4z4: 110101199001011234 },
      { scope: 'profile', mode: 'precise' },
    );
    expect(fields.d4z4).toBeUndefined();
    expect(fields.d4z4_clinical).toBeUndefined();
    // A real repeat count is untouched by the same test.
    const ok = redactFields(
      { d4z4FromLaboratoryReport: true, d4z4: 3 },
      { scope: 'profile', mode: 'precise' },
    );
    expect(ok.fields.d4z4).toBe(3);
    expect(ok.fields.d4z4_clinical).toBe('within_fshd1_repeat_range');
  });

  it('refuses a cycle and a nesting deeper than the walk goes', () => {
    const cyclic: Record<string, unknown> = { patientName: NAME };
    cyclic.self = cyclic;
    const cycled = redactFields(
      {
        documentType: 'genetic_report',
        fields: {
          classifiedType: 'genetic_report',
          documentType: 'genetic_report',
          d4z4Repeats: cyclic,
        },
      },
      { scope: 'reports', mode: 'precise' },
    );
    expect(JSON.stringify(cycled.fields)).not.toContain(NAME);

    let deep: unknown = { patientName: NAME, idCard: ID_CARD };
    for (let i = 0; i < 30; i += 1) deep = [{ nest: deep }];
    const nested = redactFields(
      {
        documentType: 'genetic_report',
        fields: {
          classifiedType: 'genetic_report',
          documentType: 'genetic_report',
          d4z4Repeats: deep,
        },
      },
      { scope: 'reports', mode: 'precise' },
    );
    const serialised = JSON.stringify(nested.fields);
    expect(serialised).not.toContain(NAME);
    expect(serialised).not.toContain(ID_CARD);
  });
});

/**
 * LAYER 4 — THE THREE GATES ON FREE TEXT.
 *
 * `retrievers/patient-reports.test.ts` drives these through the real
 * retriever and the real renderer, which is where the product-visible
 * behaviour is pinned. What is pinned HERE is what belongs to the
 * redactor itself: that the two lists the eligibility gate is built out
 * of stay exhaustive over the classifier's own vocabulary, that the
 * identifier scrub really is positioned last — over everything layer 3
 * kept, on every scope, and not only over the impression — and that the
 * raw text a retriever offers is never what gets published.
 */
/**
 * WHAT THE CHANNEL ANSWERS ABOUT A CHUNK, SHAPED AS THE FIVE ROWS IT
 * WOULD PUBLISH — AND ASKED OF `gateReportImpression` RATHER THAN OF
 * `redactFields`.
 *
 * The channel is behind one switch, default OFF
 * (`REPORT_IMPRESSION_CHANNEL_ENABLED` in allowlist.ts). Driving the
 * gate suites through `redactFields` would make every one of them
 * assert `undefined` in the shipped configuration — a hundred tests
 * that pass by testing nothing, which is how the built thing rots.
 * `gateReportImpression` is the function `redactFields` calls when the
 * switch is on and there is no second copy of the wiring, so these
 * suites exercise the three gates on every run whichever way the switch
 * points. What the switch itself does is pinned in 「the switch on the
 * report-impression channel」 at the end of this file.
 *
 * Zeroes and nulls are dropped exactly as `put()` drops them, so an
 * assertion here reads as the prompt row it is about.
 */
const channelRows = (outcome: FreeTextOutcome | null): Record<string, unknown> => {
  if (!outcome) return {};
  const rows: Record<string, unknown> = {};
  if (outcome.text !== null) rows.reportImpression = outcome.text;
  if (outcome.withheld !== null) rows.reportImpressionWithheld = outcome.withheld;
  if (outcome.valuesMasked > 0) rows.reportImpressionValuesMasked = outcome.valuesMasked;
  if (outcome.identifiersRemoved > 0) {
    rows.reportImpressionIdentifiersRemoved = outcome.identifiersRemoved;
  }
  if (outcome.charactersCut > 0) rows.reportImpressionCharactersCut = outcome.charactersCut;
  return rows;
};

/** The channel's rows for a whole chunk, as the retriever offered it. */
const channelFor = (
  fields: Record<string, unknown>,
  mode: RedactionMode = 'precise',
): Record<string, unknown> => channelRows(gateReportImpression(fields, { mode }));

describe('layer 4 — free text', () => {
  const RESULT_REPORT = {
    documentType: 'muscle_mri',
    status: 'parsed',
    fields: { classifiedType: 'muscle_mri' },
  };

  it('partitions every type the classifier can conclude', async () => {
    // The eligibility gate is 「is this document a RESULT」, and it is
    // answered off `CLASSIFIED_REPORT_TYPES` — the list this repo
    // already keeps of what `_classify_report` can conclude, pinned
    // against that Python table by get-my-reports.test.ts. No new
    // document-type list is invented; what is added is which side of
    // the line each existing entry falls on, and this keeps that
    // decision exhaustive. A type added to the classifier fails here
    // rather than defaulting to eligible.
    const { CLASSIFIED_REPORT_TYPES } = await import('../tools/get-my-reports.js');
    const { NON_RESULT_DOCUMENT_TYPES } = await import('./pii-redactor.js');
    const undecided: string[] = [];
    const both: string[] = [];
    for (const type of CLASSIFIED_REPORT_TYPES) {
      const sends =
        channelFor({
          documentType: type,
          status: 'parsed',
          fields: { classifiedType: type },
          reportImpressionAsPrinted: '双侧大腿脂肪浸润。',
        }).reportImpression !== undefined;
      const listedAsNonResult = NON_RESULT_DOCUMENT_TYPES.has(type);
      if (sends && listedAsNonResult) both.push(type);
      if (!sends && !listedAsNonResult) undecided.push(type);
    }
    expect(both).toEqual([]);
    expect(undecided).toEqual([]);
    // ...and the three that do not send are the ones whose Chinese name
    // is itself an entry on CLINICAL_NARRATIVE_MARKERS (病历摘要, 体格检查)
    // plus the classifier saying it could not name the document.
    expect([...NON_RESULT_DOCUMENT_TYPES].sort()).toEqual([
      'medical_summary',
      'other',
      'physical_exam',
    ]);
  });

  it('never publishes the raw text a retriever offered', () => {
    // `reportImpressionAsPrinted` is on NEITHER allowlist. What reaches
    // a prompt is the gated form under a different key, and the raw
    // cell is reported as dropped so the audit row can show it.
    for (const mode of ['strict', 'precise'] as RedactionMode[]) {
      const { fields, stats } = redactFields(
        { ...RESULT_REPORT, reportImpressionAsPrinted: '双侧大腿脂肪浸润。' },
        { scope: 'reports', mode },
      );
      expect(fields.reportImpressionAsPrinted).toBeUndefined();
      expect(stats.notAllowed).toContain('reportImpressionAsPrinted');
      // ...and that is true of the raw cell whether or not the channel
      // publishes a gated form of it. What the gates make of it:
      expect(
        channelFor({ ...RESULT_REPORT, reportImpressionAsPrinted: '双侧大腿脂肪浸润。' }, mode)
          .reportImpression,
      ).toBe('双侧大腿脂肪浸润。');
    }
  });

  it('reads the names off the input, before layer 1 deletes the cells', () => {
    // The one mechanism that reaches a Chinese personal name with no
    // label in front of it. The cells themselves are hard-deleted and
    // never published; their VALUES are used to find their own
    // occurrences in the prose.
    const rows = channelFor({
      ...RESULT_REPORT,
      fields: { classifiedType: 'muscle_mri', patientName: '张三', doctorName: '王五' },
      reportImpressionAsPrinted: '张三，双侧大腿脂肪浸润，报告已交王五。',
    });
    expect(rows.reportImpression).toBe('[人名未共享]，双侧大腿脂肪浸润，报告已交[人名未共享]。');
  });

  it('scrubs identifiers out of every string layer 3 kept, on every scope', () => {
    // GATE 1 POSITIONED LITERALLY LAST. The channel above is not the
    // only path that produces text: a precise-mode OCR cell and the
    // patient's own free-typed 家族史 are strings too, and a field a
    // future retriever adds will be one. One implementation, at the
    // last point before anything leaves the server.
    // An OCR CELL is refused whole, one layer earlier and by the same
    // vocabulary: `isUntrustworthyValue` cannot publish half a cell, so
    // sharing the lists means a value the scrub would have taken
    // something out of never reaches layer 4 at all. That is the
    // stronger answer and it is asserted here so 「one vocabulary」 is
    // visible as a property rather than a claim.
    const report = redactFields(
      {
        ...RESULT_REPORT,
        fields: { classifiedType: 'muscle_mri', ecgSummary: '窦性心律，联系电话 13812345678' },
      },
      { scope: 'reports', mode: 'precise' },
    );
    const cells = report.fields.fields as Record<string, unknown>;
    expect(cells.ecgSummary).toBeUndefined();
    expect(cells.fieldsDroppedAsUnsafe).toBe(1);

    // A PROFILE CELL the patient typed is the case layer 4 exists for.
    // `familyHistory` / `onsetRegion` / `assistiveDevices` used to
    // travel from the retriever to layer 3 untouched by any layer of
    // this module — the gap `isUntrustworthyValue` names in as many
    // words — because layer 3 is a gate on KEYS and nothing looked at
    // the value.
    const profile = redactFields(
      { familyHistory: '母亲疑似，联系电话 13800000000' },
      { scope: 'profile', mode: 'strict' },
    );
    expect(String(profile.fields.familyHistory)).not.toContain('13800000000');
    expect(String(profile.fields.familyHistory)).toContain('母亲疑似');
    expect(profile.stats.identifiersScrubbed).toContain('familyHistory');
  });

  it('drops a kept string the scrub cannot make safe, and names it', () => {
    // Fail closed on that last pass too: a string this module cannot
    // account for is not published, and the audit row says which.
    const { fields, stats } = redactFields(
      { familyHistory: '母亲住院号：无' },
      { scope: 'profile', mode: 'strict' },
    );
    expect(fields.familyHistory).toBeUndefined();
    expect(stats.identifiersScrubbed).toContain('familyHistory (withheld)');
  });

  it('offers no free-text channel on a scope that has no document to judge', () => {
    // Gate 0 has nothing to read outside the reports scope, and a gate
    // that cannot tell fails closed — so there is no channel at all
    // there rather than an ungated one.
    const { fields } = redactFields(
      { reportImpressionAsPrinted: '双侧大腿脂肪浸润。', gender: 'female' },
      { scope: 'profile', mode: 'precise' },
    );
    expect(Object.keys(fields)).toEqual(['gender']);
  });
});

/**
 * LAYER 4 — THE REPAIRS, ONE DESCRIBE PER ROOT CAUSE.
 *
 * Every case below was executed against the implementation before the
 * repair and produced the wrong answer; each is pinned here so the
 * shape cannot come back. Where a class remains OPEN it is pinned as
 * OPEN rather than left unstated, so the residual is visible in the
 * suite instead of only in a comment.
 */
describe('layer 4 — the gates, repaired', () => {
  const RESULT_REPORT = {
    documentType: 'muscle_mri',
    status: 'parsed',
    fields: { classifiedType: 'muscle_mri' },
  };

  /** The impression a report printed, as the gates answer about it. See
   *  `channelRows`. */
  const gated = (impression: string, mode: RedactionMode = 'precise') =>
    channelFor({ ...RESULT_REPORT, reportImpressionAsPrinted: impression }, mode);

  const impressionOf = (impression: string, mode: RedactionMode = 'precise') =>
    gated(impression, mode).reportImpression as string | undefined;

  /** The same text typeset in full-width digits and Latin letters, which
   *  is what a Chinese hospital PDF and the OCR bridge routinely emit. */
  const fullWidth = (text: string) =>
    text
      .replace(/[0-9]/g, (d) => String.fromCharCode(0xff10 + d.charCodeAt(0) - 48))
      .replace(/[A-Za-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));

  describe('A — a confusable form defeats no gate, and none of them fails open', () => {
    it('reads a full-width ID card, mobile and date as the identifiers they are', () => {
      expect(impressionOf(`影像正常。身份证号${fullWidth('110101199003071234')}`)).toBe(
        '影像正常。身份证号[编号未共享]',
      );
      expect(impressionOf(`影像正常。联系电话${fullWidth('13812345678')}`)).toBe(
        '影像正常。联系电话[编号未共享]',
      );
      expect(impressionOf(fullWidth('2019') + '年' + fullWidth('3') + '月复查')).toBe(
        '[日期未共享]复查',
      );
    });

    it('reads a full-width measurement as a measurement under strict consent', () => {
      // This is the one that failed OPEN AND SILENT: the mask did not
      // fire, and the self-check re-scanned with the same ASCII regex
      // and therefore agreed that nothing was left unclassified.
      expect(impressionOf('脂肪浸润约' + fullWidth('45') + '%', 'strict')).toBe(
        '脂肪浸润约[数值未共享]',
      );
      expect(impressionOf('脂肪浸润约45%', 'strict')).toBe('脂肪浸润约[数值未共享]');
    });

    it('reads a full-width label as a label', () => {
      expect(impressionOf(`${fullWidth('ID')}号：${fullWidth('X12345')} 影像正常。`)).toBe(
        '[编号未共享] 影像正常。',
      );
    });

    it('sees through a zero-width character dropped inside a digit run', () => {
      expect(impressionOf('110101​19900307123​4 影像正常。')).toBe('[编号未共享] 影像正常。');
    });

    it('reads a superscript unit as the unit it is', () => {
      expect(impressionOf('BMI 22.5kg/m²。', 'strict')).toBe('BMI [数值未共享]。');
    });

    it('leaves the report own punctuation and typography alone', () => {
      // The fold is deliberately NOT the whole full-width block: 「，」
      // 「；」「：」「（）」 and the ideographic space are the report's own
      // typography and no identifier hides behind them.
      expect(impressionOf('右侧腓肠肌炎性改变　未见水肿')).toBe('右侧腓肠肌炎性改变　未见水肿');
      expect(impressionOf('结论：双侧大腿脂肪浸润；肩胛带肌未见异常。')).toBe(
        '结论：双侧大腿脂肪浸润；肩胛带肌未见异常。',
      );
    });

    it('refuses a CELL carrying a full-width identifier, on the same vocabulary', () => {
      const { fields } = redactFields(
        {
          ...RESULT_REPORT,
          fields: {
            classifiedType: 'muscle_mri',
            ecgSummary: `窦性心律 ${fullWidth('110101199003071234')}`,
          },
        },
        { scope: 'reports', mode: 'precise' },
      );
      const cells = fields.fields as Record<string, unknown>;
      expect(cells.ecgSummary).toBeUndefined();
      expect(cells.fieldsDroppedAsUnsafe).toBe(1);
    });
  });

  describe('B — the gate 2 self-check reads the string it is scanning', () => {
    it('masks every measurement when name spans sit AFTER the first mask', () => {
      // The spans used to be offsets into the RAW string, re-used while
      // iterating the MASKED one. The marker is seven characters and
      // replaces tokens as short as one, so a span after the first mask
      // was shifted — and a real measurement landing inside a stale span
      // was PUBLISHED under strict consent.
      expect(impressionOf('CK 890，4号染色体，LDH 300，10号染色体，PT 13.7', 'strict')).toBe(
        'CK [数值未共享]，4号染色体，LDH [数值未共享]，10号染色体，PT [数值未共享]',
      );
    });

    it('keeps every protected name when masks sit BEFORE the spans', () => {
      // The other direction of the same drift: a protected name falling
      // outside its own stale span, the field then failing the residual
      // check, and an eligible report silenced.
      const out = gated('CK 890 U/L，游离脂肪 45%，4号染色体缺失，10号染色体正常', 'strict');
      expect(out.reportImpressionWithheld).toBeUndefined();
      expect(out.reportImpression).toBe(
        'CK [数值未共享] U/L，游离脂肪 [数值未共享]，4号染色体缺失，10号染色体正常',
      );
      expect(out.reportImpressionValuesMasked).toBe(2);
    });
  });

  describe('C — the name scrub does not eat clinical prose', () => {
    it('KEEPS THE NEGATION after 受检者 / 被检者 / 受检人 / 技师', () => {
      // The defect this whole change exists to end, reintroduced by its
      // own guardrail: 「受检者[人名未共享]显异常」 published a ruled-out
      // finding as present.
      expect(impressionOf('受检者未见明显异常。')).toBe('受检者未见明显异常。');
      expect(impressionOf('被检者未见异常信号。')).toBe('被检者未见异常信号。');
      expect(impressionOf('受检人未见肌肉萎缩。')).toBe('受检人未见肌肉萎缩。');
      expect(impressionOf('技师操作规范。')).toBe('技师操作规范。');
      expect(impressionOf('主治医师查房后未见异常。')).toBe('主治医师查房后未见异常。');
    });

    it('keeps the analyte and the hedge after 患者', () => {
      expect(impressionOf('患者白细胞计数正常，高信号未见。')).toBe(
        '患者白细胞计数正常，高信号未见。',
      );
      expect(impressionOf('患者高信号区域局限。')).toBe('患者高信号区域局限。');
      expect(impressionOf('患者高度水肿，黄疸消退。')).toBe('患者高度水肿，黄疸消退。');
      expect(impressionOf('患者余各叶未见异常。')).toBe('患者余各叶未见异常。');
    });

    it('still takes a name after 患者 when both witnesses fire', () => {
      expect(impressionOf('患者张三，男，双侧大腿脂肪浸润。')).toBe(
        '患者[人名未共享]，男，双侧大腿脂肪浸润。',
      );
    });
  });

  describe('D — no value run crosses a label', () => {
    it('does not let an address swallow the 姓名 label and the name behind it', () => {
      expect(impressionOf('住址：北京市海淀区中关村大街1号 姓名：张三 影像所见正常。')).toBe(
        '[地点未共享] 姓名[人名未共享] 影像所见正常。',
      );
    });
  });

  describe('E — the label is the enumerable part, the value is not', () => {
    it('reaches the 医师 spellings the old list did not have', () => {
      for (const label of ['经治医师', '住院医师', '管床医师', '诊断医师', '医师', '医生']) {
        expect(impressionOf(`${label}李四。影像所见正常。`)).toBe(
          `${label}[人名未共享]。影像所见正常。`,
        );
      }
    });

    it('reaches the 号 spellings the old list did not have', () => {
      for (const label of ['门诊卡号', '就诊卡号', 'ID号', '检查编号']) {
        expect(impressionOf(`${label}：X12345 影像所见正常。`)).toBe('[编号未共享] 影像所见正常。');
      }
    });

    it('does not read an ordinary word ending in 号 as a label', () => {
      expect(impressionOf('T2高信号 3处，未见水肿。')).toContain('高信号');
    });

    it('takes the whole value after a label, whatever script and however many names', () => {
      expect(impressionOf('姓名：ZHANG SAN 影像所见正常。')).toBe(
        '姓名[人名未共享] 影像所见正常。',
      );
      expect(impressionOf('姓名：欧阳建国 影像所见正常。')).toBe('姓名[人名未共享] 影像所见正常。');
      expect(impressionOf('姓名：张三、李四 影像所见正常。')).toBe(
        '姓名[人名未共享] 影像所见正常。',
      );
      expect(impressionOf('姓名：阿依古丽 影像所见正常。')).toBe('姓名[人名未共享] 影像所见正常。');
    });
  });

  describe('F — gate 2 resolves its doubt toward withholding', () => {
    it('masks the measurements a unit list could never enumerate', () => {
      for (const [printed, expected] of [
        ['血压120/80mmHg。', '血压[数值未共享]。'],
        ['参考值890-1200U/L。', '参考值[数值未共享]。'],
        ['BMI 22.5kg/m2。', 'BMI [数值未共享]。'],
        ['体表面积1.73m2。', '体表面积[数值未共享]。'],
        ['LDL2.6。', '[数值未共享]。'],
      ] as const) {
        expect(impressionOf(printed, 'strict')).toBe(expected);
      }
    });

    it('keeps the Chinese digit-bearing names, not only the Latin ones', () => {
      expect(impressionOf('肌肉萎缩3级，FSHD 1型。', 'strict')).toBe('肌肉萎缩3级，FSHD 1型。');
      expect(impressionOf('第5腰椎滑脱，腰3-4椎间盘膨出。', 'strict')).toBe(
        '第5腰椎滑脱，腰3-4椎间盘膨出。',
      );
      expect(impressionOf('结论：1.双侧大腿脂肪浸润；2.肩胛带肌未见异常。', 'strict')).toBe(
        '结论：1.双侧大腿脂肪浸润；2.肩胛带肌未见异常。',
      );
      expect(impressionOf('肌力Ⅲ级，脂肪浸润3级。', 'strict')).toBe('肌力Ⅲ级，脂肪浸润3级。');
    });

    it('keeps a YEAR, which gate 1 leaves standing and this pipeline publishes', () => {
      expect(impressionOf('2019年检查所见未变。', 'strict')).toBe('2019年检查所见未变。');
    });

    it('keeps the Latin names and masks the value beside them', () => {
      expect(
        impressionOf('T2 高信号，C5-C6 椎间盘突出，4q35 缺失，4qA 单倍型，FSHD1。', 'strict'),
      ).toBe('T2 高信号，C5-C6 椎间盘突出，4q35 缺失，4qA 单倍型，FSHD1。');
      expect(impressionOf('FT3 4.1，T3 1.8，TSH 2.5。', 'strict')).toBe(
        'FT3 [数值未共享]，T3 [数值未共享]，TSH [数值未共享]。',
      );
      expect(impressionOf('V1-V3导联ST段抬高，aVR无异常。', 'strict')).toBe(
        'V1-V3导联ST段抬高，aVR无异常。',
      );
    });

    it('keeps the negation around a masked number', () => {
      expect(impressionOf('未检出3个重复单元。', 'strict')).toBe('未检出[数值未共享]个重复单元。');
    });

    it('prints all of it under precise consent', () => {
      expect(impressionOf('血压120/80mmHg，CK 890 U/L。', 'precise')).toBe(
        '血压120/80mmHg，CK 890 U/L。',
      );
    });
  });

  describe('G — an ordinary clinical word does not withhold the whole impression', () => {
    it('publishes an impression that merely CONTAINS a label word', () => {
      expect(impressionOf('腰椎年龄相关性退变。')).toBe('腰椎年龄相关性退变。');
      expect(impressionOf('建议电话随访。')).toBe('建议电话随访。');
      expect(impressionOf('地址不详，未见异常。')).toBe('地址不详，未见异常。');
    });

    it('still withholds when the label has a value behind it that survived', () => {
      // The state the residual check exists for: a scrub that did not
      // understand what it was looking at. `年龄:23` IS removed, so the
      // way to observe the check is a label the scrub cannot reach.
      expect(impressionOf('年龄:23岁，双侧大腿脂肪浸润。')).toBe(
        '[编号未共享]岁，双侧大腿脂肪浸润。',
      );
    });
  });

  describe('H — the cap runs before gate 2, and never cuts through a marker', () => {
    const longImpression = (pad: number) =>
      '所'.repeat(pad) + '住院号:R000001' + '结论：符合FSHD改变。';

    it('cuts at the same place in both modes', () => {
      for (const pad of [190, 193, 196]) {
        const strict = gated(longImpression(pad), 'strict');
        const precise = gated(longImpression(pad), 'precise');
        expect(strict.reportImpressionCharactersCut).toBe(precise.reportImpressionCharactersCut);
        expect(String(strict.reportImpression).replace(/\[数值未共享\]/g, '')).toBe(
          String(precise.reportImpression),
        );
      }
    });

    it('pulls the cut back rather than slicing a marker in half', () => {
      // pad 199 puts the 200th character inside 「[编号未共享]」.
      const out = String(gated(longImpression(199), 'precise').reportImpression);
      expect(out).not.toContain('[编号');
      expect(out.endsWith('[后续未列出]')).toBe(true);
      // no bracket is left open
      expect((out.match(/\[/g) ?? []).length).toBe((out.match(/\]/g) ?? []).length);
    });

    it('keeps the 结论 for a strict-consent reader when precise keeps it', () => {
      const text = '双侧大腿脂肪浸润约45%，'.repeat(12) + '结论：符合FSHD改变。';
      expect(String(impressionOf(text, 'strict'))).toContain('结论：符合FSHD改变。');
      expect(String(impressionOf(text, 'precise'))).toContain('结论：符合FSHD改变。');
    });
  });

  describe('I — the gates govern free text wherever it is, not one key', () => {
    it('applies gate 0 to a prose CELL on a narrative document', () => {
      const { fields, stats } = redactFields(
        {
          documentType: 'medical_summary',
          status: 'parsed',
          fields: {
            classifiedType: 'medical_summary',
            ecgSummary: '窦性心律，大致正常心电图',
            ecgRhythm: '窦性心律',
          },
          reportImpressionAsPrinted: '双侧大腿脂肪浸润。',
        },
        { scope: 'reports', mode: 'precise' },
      );
      const cells = fields.fields as Record<string, unknown>;
      // One chunk used to refuse the impression as a narrative about a
      // person and print that document's narrative prose beside it.
      expect(cells.ecgSummary).toBeUndefined();
      expect(stats.freeTextGated).toContain('fields.ecgSummary (narrative)');
      // ...and a short structured enum on the same blob is still a cell.
      expect(cells.ecgRhythm).toBe('窦性心律');
      expect(
        channelFor({
          documentType: 'medical_summary',
          status: 'parsed',
          fields: {
            classifiedType: 'medical_summary',
            ecgSummary: '窦性心律，大致正常心电图',
            ecgRhythm: '窦性心律',
          },
          reportImpressionAsPrinted: '双侧大腿脂肪浸润。',
        }).reportImpressionWithheld,
      ).toContain('clinical_narrative');
    });

    it('leaves the same cell alone on a result document', () => {
      const { fields } = redactFields(
        {
          documentType: 'ecg',
          status: 'parsed',
          fields: { classifiedType: 'ecg', ecgSummary: '窦性心律，大致正常心电图' },
        },
        { scope: 'reports', mode: 'precise' },
      );
      expect((fields.fields as Record<string, unknown>).ecgSummary).toBe(
        '窦性心律，大致正常心电图',
      );
    });

    it('applies gate 2 to familyHistory, which the patient typed', () => {
      // `FREE_TEXT_CHANNELS` read `profile: []`, so the one field on
      // both allowlists that is unbounded patient prose got no
      // measurement gate at all — the consent hole this design exists
      // to close.
      const strict = redactFields(
        { familyHistory: '外婆45岁发病，母亲30岁起病' },
        { scope: 'profile', mode: 'strict' },
      );
      expect(strict.fields.familyHistory).toBe('外婆[数值未共享]岁发病，母亲[数值未共享]岁起病');
      expect(strict.stats.freeTextGated).toContain('familyHistory');

      const precise = redactFields(
        { familyHistory: '外婆45岁发病，母亲30岁起病' },
        { scope: 'profile', mode: 'precise' },
      );
      expect(precise.fields.familyHistory).toBe('外婆45岁发病，母亲30岁起病');
    });

    it('does not mask a sentence this platform composed itself', () => {
      // The follow-ups scope carries no foreign prose — its own
      // allowlist denies `notes` and `description` in both modes — and
      // the numbers inside `eventSummary` are `count` and `spanDays`,
      // both of which sit on the STRICT allowlist by name.
      const { fields } = redactFields(
        { eventSummary: '跌倒（轻）×1，最近 3 天前', eventCount: 1 },
        { scope: 'followups', mode: 'strict' },
      );
      expect(fields.eventSummary).toBe('跌倒（轻）×1，最近 3 天前');
    });

    it('does not mask a refusal label this module minted', () => {
      const { fields } = redactFields(
        { d4z4: '9', haplotype: '4qA' },
        { scope: 'profile', mode: 'strict' },
      );
      expect(String(fields.d4z4_clinical)).not.toContain('[数值未共享]');
      expect(GENETIC_READING_REFUSALS.has(String(fields.haplotype_clinical))).toBe(true);
    });
  });

  describe('J — the shapes that were missing', () => {
    it('removes an email, using the pattern text-scrub.ts already owns', () => {
      expect(impressionOf('联系 doctor@hospital.com 咨询。')).toBe('联系 [编号未共享] 咨询。');
    });

    it('removes a date finer than a year in all four printed shapes', () => {
      for (const printed of ['2019年3月', '2019-03', '19-03-05', '05-Mar-2019']) {
        expect(impressionOf(`${printed}复查。`)).toBe('[日期未共享]复查。');
      }
    });

    it('removes the whole of an identifier an OCR space broke apart', () => {
      // The remainder that used to be published is the BIRTH-DATE field
      // of the card.
      expect(impressionOf('身份证号 110101 19900307 1234 影像正常。')).toBe(
        '[编号未共享] 影像正常。',
      );
      expect(impressionOf('身份证号 110101 19900307 1234 影像正常。')).not.toContain('19900307');
    });
  });

  describe('K — the marker says the true reason', () => {
    it('tells a positively classified narrative apart from an unrecognised label', () => {
      const narrative = channelFor({
        documentType: 'medical_summary',
        status: 'parsed',
        fields: { classifiedType: 'medical_summary' },
        reportImpressionAsPrinted: '影像所见正常。',
      });
      expect(narrative.reportImpressionWithheld).toBe(
        'impression_exists_but_this_document_is_a_clinical_narrative_about_a_person_not_a_test_result',
      );

      const unknown = channelFor({
        documentType: 'mri',
        status: 'parsed',
        fields: {},
        reportImpressionAsPrinted: '影像所见正常。',
      });
      expect(unknown.reportImpressionWithheld).toBe(
        'impression_exists_but_this_platform_cannot_tell_what_kind_of_document_this_is',
      );
    });
  });

  /**
   * THE CLASSES THAT REMAIN OPEN, PINNED AS OPEN.
   *
   * Each of these publishes rather than failing closed, and each is
   * named in `scrubIdentifiers`. They are asserted here so that
   * anything which starts catching them shows up as a changed test
   * rather than as a silent improvement nobody reviewed — and so that
   * the list cannot quietly grow.
   */
  describe('what still gets through — stated, not papered over', () => {
    it('OPEN: an unlabelled Chinese name in prose, with no label and no key', () => {
      expect(impressionOf('张三，男，双侧大腿未见脂肪浸润。')).toBe(
        '张三，男，双侧大腿未见脂肪浸润。',
      );
    });

    it('OPEN: a surname this file gave up because it opens a clinical word', () => {
      expect(impressionOf('患者黄明，双侧大腿脂肪浸润。')).toContain('黄明');
    });

    it('OPEN: a family member named on a RESULT document', () => {
      expect(impressionOf('其兄2019年因同病去世，本人未见异常。')).toContain('其兄');
    });

    it('OPEN: an address with no administrative chain, and an institution on purpose', () => {
      expect(impressionOf('中关村大街影像所见正常。')).toContain('中关村大街');
      expect(impressionOf('北京协和医院影像所见正常。')).toContain('北京协和医院');
    });

    it('CLOSED: the same name once the document filed it under a hard-delete key', () => {
      const rows = channelFor({
        ...RESULT_REPORT,
        fields: { classifiedType: 'muscle_mri', patientName: '张三' },
        reportImpressionAsPrinted: '张三，男，双侧大腿未见脂肪浸润。',
      });
      expect(rows.reportImpression).toBe('[人名未共享]，男，双侧大腿未见脂肪浸润。');
    });
  });
});

/**
 * THE SWITCH ON THE REPORT-IMPRESSION CHANNEL.
 *
 * The suites above ask what the gates ANSWER. This one asks what
 * reaches a prompt, which is a different question and the one the
 * switch decides. It is written to hold in both positions rather than
 * to pin the default, so flipping `REPORT_IMPRESSION_CHANNEL_ENABLED`
 * is a one-line change that leaves the suite green and honest.
 *
 * OFF is the shipped state and the strong claim: the impression key and
 * its four sibling markers do not reach the prompt AT ALL — not as an
 * empty value, not as a withheld marker, not as a label with nothing
 * under it. The model sees the structured cells, which is where every
 * number in an answer already comes from.
 */
describe('the switch on the report-impression channel', () => {
  const RESULT_REPORT = {
    documentType: 'muscle_mri',
    status: 'parsed',
    fields: { classifiedType: 'muscle_mri' },
  };

  const NARRATIVE_REPORT = {
    documentType: 'medical_summary',
    status: 'parsed',
    fields: { classifiedType: 'medical_summary' },
  };

  const IMPRESSION_KEYS = [
    'reportImpression',
    'reportImpressionWithheld',
    'reportImpressionValuesMasked',
    'reportImpressionIdentifiersRemoved',
    'reportImpressionCharactersCut',
  ];

  const publishedFor = (row: Record<string, unknown>, mode: RedactionMode) =>
    redactFields(row, { scope: 'reports', mode });

  it.each(['strict', 'precise'] as RedactionMode[])(
    'publishes the five keys in %s mode only while the switch is on',
    (mode) => {
      const { fields } = publishedFor(
        { ...RESULT_REPORT, reportImpressionAsPrinted: '张三，双侧大腿脂肪浸润约 60%。' },
        mode,
      );
      const present = IMPRESSION_KEYS.filter((key) => key in fields);
      if (REPORT_IMPRESSION_CHANNEL_ENABLED) {
        expect(present).toContain('reportImpression');
      } else {
        expect(present).toEqual([]);
      }
    },
  );

  it.each(['strict', 'precise'] as RedactionMode[])(
    'sends no WITHHELD marker either, in %s mode, when the switch is off',
    (mode) => {
      // A refused impression is the case a marker exists for, so it is
      // the case most likely to leak one past a switch that only
      // suppressed the text. The gates still answer — `channelRows`
      // above proves that — the answer simply goes nowhere.
      const { fields } = publishedFor(
        { ...NARRATIVE_REPORT, reportImpressionAsPrinted: '双侧大腿脂肪浸润。' },
        mode,
      );
      expect(
        gateReportImpression(
          { ...NARRATIVE_REPORT, reportImpressionAsPrinted: '双侧大腿脂肪浸润。' },
          { mode },
        )?.withheld,
      ).toContain('clinical_narrative');
      if (!REPORT_IMPRESSION_CHANNEL_ENABLED) {
        expect(IMPRESSION_KEYS.filter((key) => key in fields)).toEqual([]);
      }
    },
  );

  it('says nothing in the audit row about a channel that never ran', () => {
    // 「dropped fields not in PROMPT_ALLOWLIST」 is how an operator finds
    // a retriever surfacing something it should not. A default that
    // logged five of those on every report chunk would read as a
    // misconfiguration rather than as a decision.
    const { stats } = publishedFor(
      { ...RESULT_REPORT, reportImpressionAsPrinted: '双侧大腿脂肪浸润。' },
      'strict',
    );
    for (const key of IMPRESSION_KEYS) expect(stats.notAllowed).not.toContain(key);
    // The RAW cell is still reported as dropped: the retriever really
    // did offer it and layer 3 really did refuse it.
    expect(stats.notAllowed).toContain('reportImpressionAsPrinted');
  });

  it('leaves the allowlist, the label table and the description in step', async () => {
    const { PROMPT_ALLOWLIST } = await import('./allowlist.js');
    const { SCOPE_LABELS } = await import('./render.js');
    const { GetMyReportsTool } = await import('../tools/get-my-reports.js');
    const onTheAllowlist = IMPRESSION_KEYS.filter(
      (key) =>
        PROMPT_ALLOWLIST.reports.strict.includes(key) ||
        PROMPT_ALLOWLIST.reports.precise.includes(key),
    );
    const labelled = IMPRESSION_KEYS.filter((key) => key in SCOPE_LABELS.reports);
    const described = new GetMyReportsTool({} as never).description.includes(
      "the report's own impression exactly as the report printed it",
    );
    if (REPORT_IMPRESSION_CHANNEL_ENABLED) {
      expect(onTheAllowlist).toEqual(IMPRESSION_KEYS);
      expect(labelled).toEqual(IMPRESSION_KEYS);
      expect(described).toBe(true);
    } else {
      expect(onTheAllowlist).toEqual([]);
      expect(labelled).toEqual([]);
      expect(described).toBe(false);
    }
  });

  it('shows gate 0 the impression whether or not the channel publishes it', () => {
    // The switch is not a privacy change in either direction. Gate 0's
    // answer governs every other piece of prose on the chunk, and it is
    // computed from the page WITH the impression folded in — so a
    // 病历摘要 whose only narrative marker is inside the impression cell
    // still refuses the prose cell beside it with the channel off.
    const { fields, stats } = publishedFor(
      {
        documentType: 'other',
        status: 'parsed',
        fields: { classifiedType: 'other', ecgSummary: '窦性心律，大致正常心电图' },
        reportImpressionAsPrinted: '病历摘要：主诉双下肢无力3年，现病史如上。',
      },
      'precise',
    );
    expect((fields.fields as Record<string, unknown>).ecgSummary).toBeUndefined();
    expect(stats.freeTextGated).toContain('fields.ecgSummary (narrative)');
  });
});

/**
 * GATE 2 AND THE VOCABULARY THIS DISEASE IS DEFINED ON.
 *
 * Every case here was executed against the mask before the repair and
 * came back masked — that is, this platform telling a strict-consent
 * reader that the one fact the report was written to state is a number
 * they did not consent to see. They are fixed whether or not the
 * channel is switched on, because they are what decides whether it can
 * ever be switched on, and because gate 2 also runs over the prose
 * CELLS that travel today.
 *
 * Asked of `gateReportImpression` for the reason `channelRows` gives.
 */
describe('gate 2 keeps the clinical vocabulary', () => {
  const RESULT_REPORT = {
    documentType: 'genetic_report',
    status: 'parsed',
    fields: { classifiedType: 'genetic_report' },
  };

  const masked = (impression: string) =>
    gateReportImpression(
      { ...RESULT_REPORT, reportImpressionAsPrinted: impression },
      { mode: 'strict' },
    );

  it.each([
    // HGVS. This is the WHOLE content of an FSHD2 / SMCHD1 result.
    ['a coding variant', 'SMCHD1 基因检出杂合变异 c.1490G>A，临床意义未明。'],
    ['a protein variant', 'SMCHD1 基因检出杂合变异 p.Arg1234Cys，考虑致病。'],
    ['a one-letter protein variant', '检出 p.R1234C 变异。'],
    ['a transcript-qualified variant', '检出 NM_001723.7:c.1490G>A 杂合变异。'],
    ['a deletion range', '检出 c.1490_1492del 缺失。'],
    // The locus, at the resolution that discriminates this disease.
    ['a locus with a sub-band', '缺失片段定位于 4q35.2 区域。'],
    ['a haplotype with its allele size', '单倍型 4qA161/4qB163。'],
    // What Chinese radiology actually prints.
    ['an abbreviated vertebral level', 'C5-6 椎间盘轻度突出。'],
    ['two of them in a list', '颈椎 C5-6、C6-7 退变。'],
    ['a level range across two regions', 'T12-L1 水平椎管狭窄。'],
    // The fat-infiltration scale this cohort's MRI is reported on.
    ['a graded stage with a letter', '双侧大腿脂肪浸润 Mercuri 2a 级，臀大肌 3 级。'],
    ['the same grade with no Chinese classifier', '双侧大腿 Mercuri 2b，臀中肌 Mercuri 1。'],
  ])('publishes %s unmasked under strict consent', (_label, impression) => {
    const out = masked(impression);
    expect(out?.withheld).toBeNull();
    expect(out?.text).toBe(impression);
    expect(out?.valuesMasked).toBe(0);
  });

  it('masks a real measurement standing in front of an ordinary 、', () => {
    // THE ORDINAL SPAN WAS A PUNCTUATION SHAPE. It protected any one- or
    // two-digit number in front of a dot, a 、 or a bracket with no check
    // that a list existed, and 、 is an ordinary clause separator — so
    // this measurement was PUBLISHED under strict consent and
    // `valuesMasked` counted zero, which is the consent model failing
    // with the audit row saying nothing happened.
    const out = masked('双侧股四头肌脂肪分数 32、伴轻度水肿。');
    expect(out?.text).toBe('双侧股四头肌脂肪分数 [数值未共享]、伴轻度水肿。');
    expect(out?.valuesMasked).toBe(1);
  });

  it('still protects the ordinals of a real enumerated conclusion', () => {
    // A list is evidence of itself: the markers run from one and count
    // up. Both of these have that and neither loses a numeral.
    for (const impression of [
      '结论：1.双侧大腿脂肪浸润。2.肩胛带肌萎缩。',
      '结论：1.脂肪浸润。2.肌萎缩。3.未见水肿。',
    ]) {
      const out = masked(impression);
      expect(out?.text).toBe(impression);
      expect(out?.valuesMasked).toBe(0);
    }
  });

  it('masks a lone ordinal, and that is the stated cost', () => {
    // One marker is a number in front of a full stop, not a list. The
    // clause survives whole and the numeral carried nothing clinical;
    // the other side of this trade is publishing a measurement.
    const out = masked('结论：1.双侧大腿脂肪浸润。');
    expect(out?.text).toBe('结论：[数值未共享].双侧大腿脂肪浸润。');
  });

  it.each([
    ['a BMI with its unit welded on', 'BMI 22.5kg/m2，偏高。'],
    ['a blood pressure', '血压 120/80mmHg。'],
    ['an analyte welded to its value', 'LDL2.6 mmol/L。'],
    ['a reference range', 'CK 890-1200U/L。'],
    ['a decimal after a clause separator', '结论：脂肪分数 1.02、伴水肿。'],
    ['a value for an analyte this repo has no key for', 'XYZ4.1 升高。'],
  ])('still masks %s', (_label, impression) => {
    const out = masked(impression);
    expect(out?.valuesMasked).toBeGreaterThan(0);
    expect(out?.text).toContain('[数值未共享]');
  });
});
