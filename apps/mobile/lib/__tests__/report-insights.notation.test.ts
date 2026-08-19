/**
 * ══════════════════════════════════════════════════════════════════════
 * 同一个区间的每一种写法，在手机这一侧读出来的必须和 API 一模一样。
 * ══════════════════════════════════════════════════════════════════════
 *
 * report-insights.printed-interval.test.ts pins the CLAUSE. This file
 * pins the NOTATION, and it is the mobile half of the table in
 * apps/api/src/utils/clinical-notation.test.ts — the two exist as two
 * files because a handset bundle cannot import a server module. The
 * exact workspace change that would collapse them into one is written
 * out above `RANGE_DASHES` in ../report-insights.ts.
 *
 * UNTIL THEN THIS TABLE IS THE ONLY THING HOLDING THE TWO SIDES
 * TOGETHER. 报告详情 and 临床护照 are one tap apart and are built off
 * the same payload; a mark added on one side and not the other is two
 * screens disagreeing about whether a number fits its own row, which is
 * the defect this repo has now fixed three times.
 *
 * SYNTHETIC. Payloads shaped like the ones the API bridge writes; no
 * real report was read.
 */

import { buildReportInsights, buildStrengthSummary } from '../report-insights';

const labReport = (fields: Record<string, unknown>) => ({
  id: 'doc-lab',
  documentType: 'muscle_enzyme',
  status: 'parsed',
  uploadedAt: '2026-03-05T00:00:00.000Z',
  ocrPayload: { fields: { reportTime: '2026-03-04', ...fields } },
});

const metric = (fields: Record<string, unknown>, label: string) =>
  buildReportInsights([labReport(fields)] as never, null)
    .systemPanels.flatMap((panel) => panel.sections)
    .flatMap((section) => section.metrics)
    .find((item) => item.label === label)?.value;

const CLAUSE_HIGH = '报告未标注异常，本平台比对：高于该区间';
const CLAUSE_LOW = '报告未标注异常，本平台比对：低于该区间';

const RANGE_SEPARATORS: ReadonlyArray<readonly [string, string]> = [
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
];

const CEILINGS: ReadonlyArray<readonly [string, string, 'exclusive' | 'inclusive']> = [
  ['U+003C', '<', 'exclusive'],
  ['U+FF1C', '＜', 'exclusive'],
  ['U+FE64', '﹤', 'exclusive'],
  ['U+2264', '≤', 'inclusive'],
  ['U+2A7D', '⩽', 'inclusive'],
  ['U+2266', '≦', 'inclusive'],
  ['digraph <=', '<=', 'inclusive'],
  ['digraph =<', '=<', 'inclusive'],
];

const FLOORS: ReadonlyArray<readonly [string, string, 'exclusive' | 'inclusive']> = [
  ['U+003E', '>', 'exclusive'],
  ['U+FF1E', '＞', 'exclusive'],
  ['U+FE65', '﹥', 'exclusive'],
  ['U+2265', '≥', 'inclusive'],
  ['U+2A7E', '⩾', 'inclusive'],
  ['U+2267', '≧', 'inclusive'],
  ['digraph >=', '>=', 'inclusive'],
  ['digraph =>', '=>', 'inclusive'],
];

describe('参考区间的每一种写法都读得出来', () => {
  it.each(RANGE_SEPARATORS)('%s 写的区间上，CK 693 判为高于', (_name, separator) => {
    expect(metric({ ck: '693U/L', ckReference: `50${separator}310` }, 'CK')).toBe(
      `693U/L（参考区间 50${separator}310；${CLAUSE_HIGH}）`,
    );
  });

  it.each(RANGE_SEPARATORS)('%s 写的区间上，CK 18 判为低于', (_name, separator) => {
    expect(metric({ ck: '18U/L', ckReference: `50${separator}310` }, 'CK')).toBe(
      `18U/L（参考区间 50${separator}310；${CLAUSE_LOW}）`,
    );
  });

  it.each(RANGE_SEPARATORS)('%s 写的区间内一个字都不多说', (_name, separator) => {
    expect(metric({ ck: '120U/L', ckReference: `50${separator}310` }, 'CK')).toBe(
      `120U/L（参考区间 50${separator}310）`,
    );
  });
});

describe('结果格里装的是区间时，一个数都不许比', () => {
  /** 至/到 were outside the class, so 「0.5至1.2」 in the result column
   *  walked past the guard, its low end was compared, and 报告详情
   *  published a verdict about a number nobody measured. */
  it.each(RANGE_SEPARATORS)('%s 写的区间被塞进结果格时不比', (_name, separator) => {
    expect(metric({ ck: `0.5${separator}1.2`, ckReference: '50-310' }, 'CK')).toBe(
      `0.5${separator}1.2（参考区间 50-310）`,
    );
  });
});

describe('单边界限，开闭区间不许抹平', () => {
  it.each(CEILINGS)('上限 %s 读得出来，限值本身落在正确的一侧', (_name, mark, kind) => {
    expect(metric({ ckmb: '30ng/mL', ckmbReference: `${mark}25` }, 'CKMB')).toBe(
      `30ng/mL（参考区间 ${mark}25；${CLAUSE_HIGH}）`,
    );
    expect(metric({ ckmb: '25ng/mL', ckmbReference: `${mark}25` }, 'CKMB')).toBe(
      kind === 'exclusive'
        ? `25ng/mL（参考区间 ${mark}25；${CLAUSE_HIGH}）`
        : `25ng/mL（参考区间 ${mark}25）`,
    );
  });

  it.each(FLOORS)('下限 %s 读得出来，限值本身落在正确的一侧', (_name, mark, kind) => {
    expect(metric({ ckmb: '4ng/mL', ckmbReference: `${mark}9` }, 'CKMB')).toBe(
      `4ng/mL（参考区间 ${mark}9；${CLAUSE_LOW}）`,
    );
    expect(metric({ ckmb: '9ng/mL', ckmbReference: `${mark}9` }, 'CKMB')).toBe(
      kind === 'exclusive'
        ? `9ng/mL（参考区间 ${mark}9；${CLAUSE_LOW}）`
        : `9ng/mL（参考区间 ${mark}9）`,
    );
  });

  it.each([...CEILINGS, ...FLOORS])('数值本身写成 %s 时是检出限，不比', (_name, mark) => {
    expect(metric({ ckmb: `${mark}0.01`, ckmbReference: '0.05-0.5' }, 'CKMB')).toBe(
      `${mark}0.01（参考区间 0.05-0.5）`,
    );
  });
});

describe('肌力格里写的是区间时，不许变成一个数', () => {
  /**
   * THIS SIDE HAD NO RANGE GUARD AT ALL. It read the first run of
   * digits and stopped, so 「4-5级」 — an examiner declining to choose —
   * became grade 4 here and was excluded from the average by 临床护照,
   * and 「4-级」 became 4 here and 3.7 there. The patient sees this one
   * first.
   */
  it.each(RANGE_SEPARATORS)('%s 写的 「4x5级」 不进平均', (_name, separator) => {
    expect(
      buildStrengthSummary({ deltoidStrength: `4${separator}5级`, bicepsStrength: '5级' }).average,
    ).toBe(5);
  });

  it.each([
    ['4-级', 4.3],
    ['4−级', 4.3],
    ['4﹣级', 4.3],
    ['4－级', 4.3],
    ['4+级', 4.7],
    ['4＋级', 4.7],
    ['4﹢级', 4.7],
    ['4/5级', 4.5],
    ['4级', 4.5],
  ] as ReadonlyArray<readonly [string, number]>)(
    '%s 仍然读成一个确定的等级，和护照一致',
    (cell, average) => {
      expect(buildStrengthSummary({ deltoidStrength: cell, bicepsStrength: '5级' }).average).toBe(
        average,
      );
    },
  );

  /** A range still PRINTS verbatim — what it loses is its vote in the
   *  average, not its place on the page. */
  it('区间格本身照原样显示', () => {
    expect(
      buildStrengthSummary({ deltoidStrength: '4至5级', bicepsStrength: '5级' }).summary,
    ).toContain('三角肌4至5级');
  });
});
