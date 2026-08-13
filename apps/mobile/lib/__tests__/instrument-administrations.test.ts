/**
 * The instrument boundary: catalogue in, administrations in.
 *
 * The engine deploys independently of this bundle, so both parsers are
 * written to answer「what can I actually render?」rather than「is this
 * the shape I expected?」. Two rules carry clinical weight:
 *
 *  1. **A level with no words is dropped.** The anchor sentence IS the
 *     measurement; a catalogue entry whose levels arrived without
 *     `labelZh` would put a row of numbers on screen whose meaning is
 *     nowhere, and a stored row whose `levelLabelZh` is null must stay
 *     null rather than degrading to the bare grade.
 *  2. **An unreadable value is null, never 0.** Brooke's best grade is
 *     1 and Vignos's is 1; 0 is not on either scale, so a coerced 0 is
 *     a value no patient could have chosen.
 */

// api.ts pulls in AsyncStorage through session-storage, which has no
// native module under jest. Same stub api-transport.test.ts uses.
jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

import { normalizeInstrumentAdministrations, normalizeInstrumentCatalogue } from '../api';

const level = (value: number, labelZh: string) => ({ value, labelZh, sourceEn: 'en' });

const entry = (over: Record<string, unknown> = {}) => ({
  key: 'brooke_upper_extremity',
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
  limitationsZh: ['地板效应明显。'],
  selfReportEvidenceZh: 'ICC 0.66。',
  items: [
    {
      code: 'brooke_grade',
      version: 'v1',
      promptZh: '请选择最符合你目前上肢情况的一条',
      levels: [level(1, '能把手举过头顶。'), level(2, '要弯肘才能举过头顶。')],
    },
  ],
  ...over,
});

describe('the catalogue', () => {
  it('reads the real envelope', () => {
    const parsed = normalizeInstrumentCatalogue({ instruments: [entry()] });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].items[0].levels[1].labelZh).toBe('要弯肘才能举过头顶。');
    expect(parsed[0].limitationsZh).toEqual(['地板效应明显。']);
    expect(parsed[0].selfReportEvidenceZh).toBe('ICC 0.66。');
    expect(parsed[0].sourceCitation).toContain('Muscle Nerve');
  });

  it('accepts a bare array and rejects anything else', () => {
    expect(normalizeInstrumentCatalogue([entry()])).toHaveLength(1);
    for (const payload of [null, undefined, 0, 'nope', {}, { instruments: 'nope' }]) {
      expect(normalizeInstrumentCatalogue(payload)).toEqual([]);
    }
  });

  it('drops a level that arrived without its sentence', () => {
    const parsed = normalizeInstrumentCatalogue({
      instruments: [
        entry({
          items: [
            {
              code: 'brooke_grade',
              version: 'v1',
              promptZh: 'p',
              levels: [level(1, '能举过头顶。'), { value: 2, labelZh: '   ' }, { value: 3 }],
            },
          ],
        }),
      ],
    });
    expect(parsed[0].items[0].levels.map((entryLevel) => entryLevel.value)).toEqual([1]);
  });

  it('drops an entry with no usable levels rather than offering an empty picker', () => {
    expect(
      normalizeInstrumentCatalogue({
        instruments: [entry({ items: [{ code: 'x', version: 'v1', promptZh: 'p', levels: [] }] })],
      }),
    ).toEqual([]);
    expect(normalizeInstrumentCatalogue({ instruments: [entry({ items: [] })] })).toEqual([]);
  });

  it('drops an entry with no key — nothing can be posted against it', () => {
    expect(normalizeInstrumentCatalogue({ instruments: [entry({ key: '' })] })).toEqual([]);
  });

  it('never invents caveats or a citation', () => {
    const parsed = normalizeInstrumentCatalogue({
      instruments: [entry({ limitationsZh: undefined, selfReportEvidenceZh: undefined })],
    });
    expect(parsed[0].limitationsZh).toEqual([]);
    expect(parsed[0].selfReportEvidenceZh).toBe('');
  });
});

describe('administrations', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    instrumentKey: 'brooke_upper_extremity',
    instrumentVersion: 'v1',
    instrumentNameZh: 'Brooke 上肢功能分级',
    rawScore: 3,
    scoredValue: 3,
    scoringMethod: 'brooke_v1_single_grade',
    completeness: 1,
    assistedBy: 'none',
    source: 'self',
    supersedesId: null,
    supersededById: null,
    administeredAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    levelLabelZh: '手举不到头顶上方。',
    responses: [
      {
        itemCode: 'brooke_grade',
        itemVersion: 'v1',
        responseValue: 3,
        skipped: false,
        notApplicable: false,
      },
    ],
    ...over,
  });

  it('reads the real envelope', () => {
    const [parsed] = normalizeInstrumentAdministrations({ administrations: [row()] });
    expect(parsed.scoredValue).toBe(3);
    expect(parsed.levelLabelZh).toBe('手举不到头顶上方。');
    expect(parsed.administeredAt).toBe('2026-08-01T00:00:00.000Z');
    expect(parsed.responses[0].responseValue).toBe(3);
  });

  it('keeps a null levelLabelZh null', () => {
    // The server sends null when the stored version is not in its
    // registry. Substituting the number here is the exact failure the
    // whole feature is built to avoid.
    const [parsed] = normalizeInstrumentAdministrations({
      administrations: [row({ levelLabelZh: null })],
    });
    expect(parsed.levelLabelZh).toBeNull();
  });

  it('nulls an unreadable score instead of coercing it to 0', () => {
    for (const value of [undefined, null, '', 'three', {}, Number.NaN, Infinity]) {
      const [parsed] = normalizeInstrumentAdministrations({
        administrations: [row({ scoredValue: value })],
      });
      expect(parsed.scoredValue).toBeNull();
    }
  });

  it('parses a numeric string score — pg returns NUMERIC as text', () => {
    const [parsed] = normalizeInstrumentAdministrations({
      administrations: [row({ scoredValue: '4' })],
    });
    expect(parsed.scoredValue).toBe(4);
  });

  it('carries the superseded pointer through, so a correction can be filtered', () => {
    const [parsed] = normalizeInstrumentAdministrations({
      administrations: [row({ supersededById: 'a2' })],
    });
    expect(parsed.supersededById).toBe('a2');
  });

  it('never invents an administeredAt', () => {
    const [parsed] = normalizeInstrumentAdministrations({
      administrations: [row({ administeredAt: null })],
    });
    expect(parsed.administeredAt).toBeNull();
  });

  it('skips non-object rows and drops responses with no item code', () => {
    const parsed = normalizeInstrumentAdministrations({
      administrations: [
        null,
        7,
        row({ responses: [{ responseValue: 3 }, { itemCode: 'brooke_grade' }] }),
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].responses).toHaveLength(1);
    expect(parsed[0].responses[0].responseValue).toBeNull();
  });

  it('yields an empty list for a payload it cannot read', () => {
    for (const payload of [null, undefined, 'nope', {}, { administrations: 'nope' }]) {
      expect(normalizeInstrumentAdministrations(payload)).toEqual([]);
    }
  });
});
