/**
 * Brooke / Vignos — the rules that keep a grade from being printed as a
 * bare number.
 *
 * The failure this file exists to prevent is not a crash. It is a
 * passport that reads「上肢 Brooke 3 级」and is handed to a neurologist
 * who sees three FSHD patients a year. Brooke runs 1-6 and Vignos 1-10,
 * both counting upward toward worse; the MRC strength score on the same
 * record runs 0-5 counting upward toward better. A 3 with no sentence
 * beside it is three different patients depending on the assumed scale.
 *
 * So the invariant is: a reading either carries its behavioural anchor
 * or it does not exist. There is no third state, and the anchor is
 * never manufactured client-side — it comes from the server, which
 * resolves it against the instrument version the patient answered.
 */

import type { InstrumentAdministration, InstrumentCatalogueEntry } from '../../../lib/api';
import {
  instrumentDisplayName,
  readingFromAdministration,
  summarizeInstrument,
  summarizeInstruments,
} from '../instruments';

const BROOKE_KEY = 'brooke_upper_extremity';
const VIGNOS_KEY = 'vignos_lower_extremity';

const DAY_MS = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => new Date(Date.UTC(2026, 0, 1) - daysAgo * DAY_MS).toISOString();

const BROOKE_L3 = '手举不到头顶上方，但能把一杯约 240 毫升（8 盎司）的水端到嘴边。';
const BROOKE_L2 = '只有先把手肘弯起来，才能把手举过头顶。';

const administration = (
  over: Partial<InstrumentAdministration> = {},
): InstrumentAdministration => ({
  id: 'a1',
  instrumentKey: BROOKE_KEY,
  instrumentVersion: 'v1',
  instrumentNameZh: 'Brooke 上肢功能分级',
  scoredValue: 3,
  levelLabelZh: BROOKE_L3,
  source: 'self',
  assistedBy: 'none',
  supersededById: null,
  administeredAt: at(0),
  createdAt: at(0),
  responses: [{ itemCode: 'brooke_grade', responseValue: 3, skipped: false, notApplicable: false }],
  ...over,
});

const catalogueEntry = (
  over: Partial<InstrumentCatalogueEntry> = {},
): InstrumentCatalogueEntry => ({
  key: BROOKE_KEY,
  version: 'v1',
  nameZh: 'Brooke 上肢功能分级',
  descriptionZh: '一个国际通用的上肢功能分级。',
  licenceStatus: 'free_with_attribution',
  sourceCitation: 'Brooke MH, et al. Muscle Nerve. 1981;4(3):186-97.',
  scoreMin: 1,
  scoreMax: 6,
  higherIsWorse: true,
  recallPeriod: 'current',
  adminMinutes: 2,
  limitationsZh: ['这个分级最初是为杜氏肌营养不良设计的。'],
  selfReportEvidenceZh: 'ICC 0.66（95% CI 0.58-0.72）。',
  items: [
    {
      code: 'brooke_grade',
      version: 'v1',
      promptZh: '请选择最符合你目前上肢情况的一条',
      levels: [
        { value: 2, labelZh: BROOKE_L2, sourceEn: null },
        { value: 3, labelZh: BROOKE_L3, sourceEn: null },
      ],
    },
  ],
  ...over,
});

describe('the anchor is not optional', () => {
  it('uses the sentence the SERVER resolved for the grade', () => {
    const summary = summarizeInstrument(BROOKE_KEY, [administration()]);
    expect(summary).not.toBeNull();
    expect(summary!.latest.level).toBe(3);
    expect(summary!.latest.anchor).toBe(BROOKE_L3);
  });

  it('renders nothing when the server could not name the grade', () => {
    // levelLabelZh is null when the stored version is not in the
    // server's registry — a rollback, or a row written by a newer
    // deploy. The server refuses to fabricate the sentence; so does
    // this, rather than falling back to the number.
    expect(summarizeInstrument(BROOKE_KEY, [administration({ levelLabelZh: null })])).toBeNull();
  });

  it('falls back to the catalogue only when the versions match', () => {
    const entry = catalogueEntry();
    // Same version: the words the patient saw are the words on file.
    expect(
      summarizeInstrument(BROOKE_KEY, [administration({ levelLabelZh: null })], entry)!.latest
        .anchor,
    ).toBe(BROOKE_L3);
    // Different version: the catalogue's current wording is NOT what
    // this patient answered, so it must not be used to describe it.
    expect(
      summarizeInstrument(
        BROOKE_KEY,
        [administration({ levelLabelZh: null, instrumentVersion: 'v2' })],
        entry,
      ),
    ).toBeNull();
  });

  it('renders nothing for an unreadable grade', () => {
    expect(summarizeInstrument(BROOKE_KEY, [administration({ scoredValue: null })])).toBeNull();
  });

  it('drops a superseded row — a correction must not appear as a data point', () => {
    // A mis-tap and its correction drawn as two points is a cliff that
    // never happened.
    const summary = summarizeInstrument(BROOKE_KEY, [
      administration({
        id: 'wrong',
        scoredValue: 6,
        supersededById: 'right',
        administeredAt: at(0),
      }),
      administration({ id: 'right', scoredValue: 3, administeredAt: at(0) }),
    ]);
    expect(summary!.latest.level).toBe(3);
    expect(summary!.comparison).toBeNull();
  });
});

describe('the passport headline', () => {
  it('reads 上肢 Brooke 3 级（去年同期 2 级）', () => {
    const summary = summarizeInstrument(BROOKE_KEY, [
      administration({ id: 'now', administeredAt: at(0) }),
      administration({
        id: 'then',
        scoredValue: 2,
        levelLabelZh: BROOKE_L2,
        administeredAt: at(365),
      }),
    ]);
    expect(summary!.headline).toBe('上肢 Brooke 3 级（去年同期 2 级）');
    // Last year's grade carries its own sentence too — otherwise the
    // reader learns that something moved but not what moved.
    expect(summary!.comparison!.reading.anchor).toBe(BROOKE_L2);
  });

  it('names the lower-limb scale 下肢 Vignos', () => {
    const summary = summarizeInstrument(VIGNOS_KEY, [
      administration({
        instrumentKey: VIGNOS_KEY,
        scoredValue: 4,
        levelLabelZh: '能自己走路，但上不了楼梯。',
      }),
    ]);
    expect(summary!.headline).toBe('下肢 Vignos 4 级');
  });

  it('falls back to the catalogue name for an instrument it has no short name for', () => {
    const summary = summarizeInstrument(
      'motor_function_measure',
      [administration({ instrumentKey: 'motor_function_measure' })],
      catalogueEntry({ key: 'motor_function_measure', nameZh: 'MFM 运动功能量表' }),
    );
    expect(summary!.headline).toBe('MFM 运动功能量表 3 级');
    expect(instrumentDisplayName('unknown_scale', null)).toBe('unknown_scale');
  });

  it('carries no comparison when there is only one administration', () => {
    const summary = summarizeInstrument(BROOKE_KEY, [administration()]);
    expect(summary!.comparison).toBeNull();
    expect(summary!.headline).toBe('上肢 Brooke 3 级');
  });
});

describe('去年同期 means 去年同期', () => {
  const pair = (olderDaysAgo: number) => [
    administration({ id: 'now', administeredAt: at(0) }),
    administration({
      id: 'then',
      scoredValue: 2,
      levelLabelZh: BROOKE_L2,
      administeredAt: at(olderDaysAgo),
    }),
  ];

  it('accepts a reading inside the ±120 day window', () => {
    expect(summarizeInstrument(BROOKE_KEY, pair(300))!.comparison!.label).toBe('去年同期');
  });

  it('refuses to call a four-month-old reading 去年同期', () => {
    const summary = summarizeInstrument(BROOKE_KEY, pair(120));
    expect(summary!.comparison!.label).not.toBe('去年同期');
    expect(summary!.comparison!.label).toMatch(/^上次 \d{2}-\d{2}$/);
    expect(summary!.headline).toContain('（上次 ');
  });

  it('picks the reading nearest the anniversary when several qualify', () => {
    const summary = summarizeInstrument(BROOKE_KEY, [
      administration({ id: 'a', scoredValue: 3, administeredAt: at(0) }),
      administration({ id: 'b', scoredValue: 2, levelLabelZh: BROOKE_L2, administeredAt: at(300) }),
      administration({ id: 'c', scoredValue: 2, levelLabelZh: BROOKE_L2, administeredAt: at(366) }),
      administration({ id: 'd', scoredValue: 2, levelLabelZh: BROOKE_L2, administeredAt: at(430) }),
    ]);
    expect(summary!.comparison!.label).toBe('去年同期');
    expect(summary!.comparison!.reading.administeredAt).toBe(at(366));
  });

  it('falls back to 上次 with no usable dates', () => {
    const summary = summarizeInstrument(BROOKE_KEY, [
      administration({ id: 'a', administeredAt: null }),
      administration({ id: 'b', scoredValue: 2, levelLabelZh: BROOKE_L2, administeredAt: null }),
    ]);
    expect(summary!.comparison!.label).toBe('上次');
  });
});

describe('defensive against an independently deployed engine', () => {
  it('returns null for empty, null and non-array input', () => {
    expect(summarizeInstrument(BROOKE_KEY, [])).toBeNull();
    expect(summarizeInstrument(BROOKE_KEY, null)).toBeNull();
    expect(summarizeInstrument(BROOKE_KEY, undefined)).toBeNull();
  });

  it('ignores administrations belonging to a different instrument', () => {
    const summary = summarizeInstrument(BROOKE_KEY, [
      administration({ instrumentKey: VIGNOS_KEY, scoredValue: 9 }),
    ]);
    expect(summary).toBeNull();
  });

  it('re-sorts when the endpoint does not return newest first', () => {
    // The endpoint orders administered_at DESC. If that ever slips,
    // printing last year's grade as this year's is the worst thing this
    // screen can do.
    const summary = summarizeInstrument(BROOKE_KEY, [
      administration({
        id: 'then',
        scoredValue: 2,
        levelLabelZh: BROOKE_L2,
        administeredAt: at(365),
      }),
      administration({ id: 'now', scoredValue: 3, administeredAt: at(0) }),
    ]);
    expect(summary!.latest.level).toBe(3);
    expect(summary!.comparison!.reading.level).toBe(2);
  });

  it('sinks undated readings below dated ones instead of treating them as ancient', () => {
    const summary = summarizeInstrument(BROOKE_KEY, [
      administration({
        id: 'undated',
        scoredValue: 2,
        levelLabelZh: BROOKE_L2,
        administeredAt: null,
      }),
      administration({ id: 'dated', scoredValue: 3, administeredAt: at(10) }),
    ]);
    expect(summary!.latest.level).toBe(3);
    expect(summary!.comparison!.reading.level).toBe(2);
  });

  it('survives null rows', () => {
    expect(readingFromAdministration(null, null)).toBeNull();
    expect(readingFromAdministration(undefined, null)).toBeNull();
  });
});

describe('summarizeInstruments', () => {
  it('is driven by what came back, not by a hard-coded pair', () => {
    const summaries = summarizeInstruments(
      [
        administration({ id: 'b', instrumentKey: BROOKE_KEY }),
        administration({
          id: 'v',
          instrumentKey: VIGNOS_KEY,
          scoredValue: 4,
          levelLabelZh: '能自己走路，但上不了楼梯。',
        }),
      ],
      [catalogueEntry(), catalogueEntry({ key: VIGNOS_KEY, nameZh: 'Vignos 下肢功能分级' })],
    );
    expect(summaries.map((summary) => summary.instrumentKey)).toEqual([BROOKE_KEY, VIGNOS_KEY]);
  });

  it('still renders an instrument the catalogue did not describe', () => {
    // The catalogue read is allowed to fail on its own — the stored row
    // already carries the anchor the patient answered against.
    const summaries = summarizeInstruments([administration()], []);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].entry).toBeNull();
    expect(summaries[0].latest.anchor).toBe(BROOKE_L3);
  });

  it('returns nothing when nothing is usable', () => {
    expect(summarizeInstruments([], [])).toEqual([]);
    expect(summarizeInstruments(null, null)).toEqual([]);
    expect(summarizeInstruments([administration({ levelLabelZh: null })], [])).toEqual([]);
  });
});
