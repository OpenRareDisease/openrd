/**
 * ══════════════════════════════════════════════════════════════════════
 * THE SAME INTERVAL, SPELLED FIFTEEN WAYS, ON EVERY SURFACE THAT PRINTS
 * IT — AND THE MMT CELL THAT MUST NOT BECOME A NUMBER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * profile.passport.printed-interval.test.ts pins the CLAUSE — its
 * wording, its register, and the fact that all four surfaces carry the
 * identical string. This file pins the NOTATION: that the clause fires,
 * and the refusals fire, on every spelling in the vocabulary rather
 * than on the ones whoever last touched a class happened to think of.
 *
 * THE TWO THINGS BEING PROTECTED ARE OPPOSITE IN DIRECTION.
 *
 *   A reference interval this file cannot read is SILENCE — the row
 *   prints as it stands and the reader does the arithmetic. Bad, and
 *   survivable.
 *
 *   A RESULT cell this file cannot read as an interval is worse than
 *   silence: 「0.5至1.2」 in the result column is the reference column
 *   mis-parsed, its low end reaches the comparison, and the platform
 *   publishes 「本平台比对：低于该区间」 about a number nobody measured.
 *   That one is the reason the words 至/到 are in the set.
 *
 *   And an MMT cell this file cannot read as an interval is the same
 *   defect in the motor row: 「4‐5级」 is an examiner declining to
 *   choose between grade 4 and grade 5, and reading it as the
 *   determinate grade 4 votes a fabricated number into 平均肌力.
 *
 * SYNTHETIC. Every payload below was written for this file. No real
 * patient's report was read.
 */

import { describe, expect, it } from 'vitest';

import { buildPassportSharePage } from './passport-share.html.js';
import {
  buildClinicalPassportExport,
  buildClinicalPassportSummary,
  compareWithPrintedInterval,
  parseD4Z4Reading,
} from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';
import { buildReferralPack } from './referral-pack.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');

const documentOf = (documentType: string, fields: Record<string, string>) =>
  ({
    id: `doc-${documentType}`,
    documentType,
    title: null,
    fileName: 'synthetic.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1,
    storageUri: 'local://synthetic',
    status: 'parsed',
    uploadedAt: '2026-08-01T00:00:00.000Z',
    checksum: null,
    submissionId: null,
    ocrPayload: {
      fields: { classifiedType: documentType, documentType, reportTime: '2026-07-30', ...fields },
    },
  }) as unknown as PatientProfileDTO['documents'][number];

const profileWith = (documentType: string, fields: Record<string, string>): PatientProfileDTO =>
  ({
    id: 'p1',
    userId: 'u1',
    fullName: '合成用例',
    preferredName: null,
    gender: null,
    birthDate: null,
    phone: null,
    region: null,
    heightCm: null,
    weightKg: null,
    diagnosisStatus: null,
    diagnosisDate: null,
    geneticType: null,
    onsetAge: null,
    familyHistory: null,
    mobilityLevel: null,
    careNotes: null,
    baseline: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    documents: [documentOf(documentType, fields)],
    activityLogs: [],
    measurements: [],
    symptomLogs: [],
    medications: [],
    appointments: [],
    instrumentAdministrations: [],
    falls: [],
  }) as unknown as PatientProfileDTO;

const bloodRow = (fields: Record<string, string>) =>
  buildClinicalPassportSummary(profileWith('muscle_enzyme', fields), NOW).monitoring.items.find(
    (item) => item.key === 'blood',
  )?.summary;

/** 平均肌力 is not on the passport summary object as a number; it is
 *  composed into the markdown export's 运动功能 row, which is where a
 *  clinician actually reads it. */
const motorAverage = (cell: string) => {
  const summary = buildClinicalPassportSummary(
    profileWith('physical_exam', { deltoidStrength: cell, bicepsStrength: '5级' }),
    NOW,
  );
  const row = buildClinicalPassportExport(summary)
    .markdown.split('\n')
    .find((line) => line.startsWith('| 运动功能'));
  return /平均 ([\d.—]+) 级/.exec(row ?? '')?.[1] ?? null;
};

const RANGE_SEPARATORS = [
  ['U+002D', '-'],
  ['U+007E', '~'],
  ['U+2010', '‐'],
  ['U+2011', '‑'],
  ['U+2012', '‒'],
  ['U+2013', '–'],
  ['U+2014', '—'],
  ['U+2015', '―'],
  ['U+2212', '−'],
  ['U+301C', '〜'],
  ['U+FE63', '﹣'],
  ['U+FF0D', '－'],
  ['U+FF5E', '～'],
  ['到', '到'],
  ['至', '至'],
] as const;

const CLAUSE_HIGH = '报告未标注异常，本平台比对：高于该区间';
const CLAUSE_LOW = '报告未标注异常，本平台比对：低于该区间';

describe('参考区间的每一种写法都读得出来', () => {
  it.each(RANGE_SEPARATORS)('%s 写的区间上，CK 693 判为高于', (_name, separator) => {
    expect(bloodRow({ ck: '693', ckReference: `50${separator}310` })).toBe(
      `CK 693（参考区间 50${separator}310；${CLAUSE_HIGH}）`,
    );
  });

  it.each(RANGE_SEPARATORS)('%s 写的区间上，CK 18 判为低于，方向不会说反', (_name, separator) => {
    expect(bloodRow({ ck: '18', ckReference: `50${separator}310` })).toBe(
      `CK 18（参考区间 50${separator}310；${CLAUSE_LOW}）`,
    );
  });

  it.each(RANGE_SEPARATORS)('%s 写的区间内一个字都不多说', (_name, separator) => {
    expect(bloodRow({ ck: '120', ckReference: `50${separator}310` })).toBe(
      `CK 120（参考区间 50${separator}310）`,
    );
  });

  /** An inverted interval is a cell this file cannot trust; the honest
   *  answer is the row as it stands, in every spelling. */
  it.each(RANGE_SEPARATORS)('%s 写的上下界颠倒时不比', (_name, separator) => {
    expect(compareWithPrintedInterval('693', `310${separator}50`)).toBeNull();
  });
});

describe('结果格里装的是区间时，一个数都不许比', () => {
  /**
   * THIS IS THE ONE THAT WAS WORSE THAN SILENCE. 至/到 were outside the
   * class, so 「0.5至1.2」 in the result column walked past
   * `VALUE_IS_A_RANGE`, `LEADING_NUMBER` handed 0.5 to the comparison,
   * and 「低于该区间」 was published about a number nobody measured.
   */
  it.each(RANGE_SEPARATORS)('%s 写的区间被塞进结果格时不比', (_name, separator) => {
    expect(compareWithPrintedInterval(`0.5${separator}1.2`, '50-310')).toBeNull();
    expect(bloodRow({ ck: `0.5${separator}1.2`, ckReference: '50-310' })).toBe(
      `CK 0.5${separator}1.2（参考区间 50-310）`,
    );
  });
});

describe('单边界限，开闭区间不许抹平', () => {
  const CEILINGS = [
    ['U+003C', '<', 'exclusive'],
    ['U+FF1C', '＜', 'exclusive'],
    ['U+FE64', '﹤', 'exclusive'],
    ['U+2264', '≤', 'inclusive'],
    ['U+2A7D', '⩽', 'inclusive'],
    ['U+2266', '≦', 'inclusive'],
    ['digraph <=', '<=', 'inclusive'],
    ['digraph =<', '=<', 'inclusive'],
  ] as const;

  const FLOORS = [
    ['U+003E', '>', 'exclusive'],
    ['U+FF1E', '＞', 'exclusive'],
    ['U+FE65', '﹥', 'exclusive'],
    ['U+2265', '≥', 'inclusive'],
    ['U+2A7E', '⩾', 'inclusive'],
    ['U+2267', '≧', 'inclusive'],
    ['digraph >=', '>=', 'inclusive'],
    ['digraph =>', '=>', 'inclusive'],
  ] as const;

  it.each(CEILINGS)('上限 %s 读得出来，并且限值本身落在正确的一侧', (_name, mark, kind) => {
    expect(compareWithPrintedInterval('30', `${mark}25`)).toBe('above');
    expect(compareWithPrintedInterval('20', `${mark}25`)).toBeNull();
    expect(compareWithPrintedInterval('25', `${mark}25`)).toBe(
      kind === 'exclusive' ? 'above' : null,
    );
  });

  it.each(FLOORS)('下限 %s 读得出来，并且限值本身落在正确的一侧', (_name, mark, kind) => {
    expect(compareWithPrintedInterval('4', `${mark}9`)).toBe('below');
    expect(compareWithPrintedInterval('10', `${mark}9`)).toBeNull();
    expect(compareWithPrintedInterval('9', `${mark}9`)).toBe(kind === 'exclusive' ? 'below' : null);
  });

  /** A reading that is itself a bound is a DETECTION LIMIT, not a
   *  number that sits anywhere on an interval — in every spelling,
   *  digraphs included. */
  it.each([...CEILINGS, ...FLOORS])('数值本身写成 %s 时是检出限，不比', (_name, mark) => {
    expect(compareWithPrintedInterval(`${mark}0.01`, '0.05-0.5')).toBeNull();
  });
});

describe('四个面拿到的是同一句话，不管区间怎么写', () => {
  /** They are one string: the share page, the referral pack and the
   *  markdown export all print `monitoring.items[].summary`. A surface
   *  that grew its own bracket fails here. */
  it.each([
    ['至', '至'],
    ['到', '到'],
    ['U+2010', '‐'],
  ] as const)('%s 写的区间上，四个面一致', (_name, separator) => {
    const fields = { ck: '693', ckReference: `50${separator}310` };
    const profile = profileWith('muscle_enzyme', fields);
    const summary = buildClinicalPassportSummary(profile, NOW);
    const row = `CK 693（参考区间 50${separator}310；${CLAUSE_HIGH}）`;

    expect(bloodRow(fields)).toBe(row);
    expect(buildPassportSharePage(summary, { viaPickup: true })).toContain(row);
    expect(
      buildReferralPack(profile, NOW).monitoring.find((item) => item.key === 'blood')?.statement,
    ).toContain(row);
    expect(
      buildClinicalPassportExport(summary)
        .markdown.split('\n')
        .find((line) => line.startsWith('- 血检指标')),
    ).toContain(row);
  });

  /** The share page is HTML, so a digraph containing 「<」 arrives
   *  escaped. Escaped is the SAME row — asserted rather than left to
   *  look like a surface that dropped the clause. */
  it('分享页把 「<=」 转义后仍然是同一行', () => {
    const summary = buildClinicalPassportSummary(
      profileWith('muscle_enzyme', { ck: '30', ckReference: '<=25' }),
      NOW,
    );
    expect(bloodRow({ ck: '30', ckReference: '<=25' })).toBe(
      `CK 30（参考区间 <=25；${CLAUSE_HIGH}）`,
    );
    expect(buildPassportSharePage(summary, { viaPickup: true })).toContain(
      `CK 30（参考区间 &lt;=25；${CLAUSE_HIGH}）`,
    );
  });
});

describe('肌力格里写的是区间时，不许变成一个数', () => {
  /**
   * 「4‐5级」 (U+2010) is what an OCR pass hands back for a printed
   * dash, and the MMT class did not carry it — so the cell was read as
   * the determinate grade 4 and voted into 平均肌力 on the passport, the
   * share page, the referral pack and the markdown export. With the
   * deltoid excluded and only the biceps 5级 left, the average is 5.0.
   */
  it.each(RANGE_SEPARATORS)('%s 写的 「4x5级」 不进平均', (_name, separator) => {
    expect(motorAverage(`4${separator}5级`)).toBe('5.0');
  });

  /** All four API surfaces read the average off the same
   *  `motor.average`, and the cell itself still PRINTS verbatim on
   *  every one of them — what a range loses is its vote, not its place
   *  on the page. */
  it('四个面上，区间格照原样显示，平均值里却没有它', () => {
    const profile = profileWith('physical_exam', {
      deltoidStrength: '4至5级',
      bicepsStrength: '5级',
    });
    const summary = buildClinicalPassportSummary(profile, NOW);
    expect(summary.motor.average).toBe('5.0');
    expect(summary.motor.summary).toBe('三角肌4至5级，肱二头肌5级');
    expect(buildPassportSharePage(summary, { viaPickup: true })).toContain(
      '三角肌4至5级，肱二头肌5级',
    );
    expect(buildClinicalPassportExport(summary).markdown).toContain(
      '平均 5.0 级 · 三角肌4至5级，肱二头肌5级',
    );
    expect(JSON.stringify(buildReferralPack(profile, NOW))).not.toContain('4.0');
  });

  /** And the ± modifier still reads, because every dash the modifier
   *  accepts is inside the range class — which is what keeps 「4-5级」
   *  from being read as grade four MINUS and averaged as 3.7, a number
   *  below both bounds of the interval it came off. */
  it.each([
    ['4-级', '4.3'],
    ['4−级', '4.3'],
    ['4﹣级', '4.3'],
    ['4－级', '4.3'],
    ['4+级', '4.7'],
    ['4＋级', '4.7'],
    ['4﹢级', '4.7'],
    ['4/5级', '4.5'],
    ['4级', '4.5'],
  ] as const)('%s 仍然读成一个确定的等级', (cell, average) => {
    expect(motorAverage(cell)).toBe(average);
  });
});

describe('D4Z4 格里写的是界限或区间时，不许变成一个计数', () => {
  it.each([
    '<10',
    '＜10',
    '﹤10',
    '≤10',
    '⩽10',
    '≦10',
    '<=10',
    '=<10',
    '>10',
    '＞10',
    '﹥10',
    '≥10',
    '⩾10',
    '≧10',
    '>=10',
    '=>10',
    '大于10',
    '小于10',
    '10 以上',
    '10 以内',
    '至少10',
  ])('%s 不是计数', (cell) => {
    const reading = parseD4Z4Reading(cell);
    expect(reading.value).toBeNull();
    expect(reading.isRange).toBe(true);
  });

  it.each(RANGE_SEPARATORS)('%s 写的 「1x10」 不是计数', (_name, separator) => {
    const reading = parseD4Z4Reading(`1${separator}10 个重复单元`);
    expect(reading.value).toBeNull();
    expect(reading.isRange).toBe(true);
  });

  /** The plain hyphen is the one member this class drops, because the
   *  cell it scans is full of hyphenated NAMES. A determinate count
   *  beside one still reads. */
  it('连字符写的名字不会把确定的计数吃掉', () => {
    expect(parseD4Z4Reading('8 个重复单元').value).toBe(8);
  });
});
