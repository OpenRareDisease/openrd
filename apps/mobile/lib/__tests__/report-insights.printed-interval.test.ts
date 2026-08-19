/**
 * ══════════════════════════════════════════════════════════════════════
 * 化验室没标、但超出它自己印的区间的那个数。
 * ══════════════════════════════════════════════════════════════════════
 *
 * 「CK 693U/L（参考区间 50-310）」 was the whole metric — on 报告详情 →
 * 检查结果, on 我的档案 and inside 病程's own 血检 line. A value at 2.2×
 * the upper limit of the interval printed two characters to its right,
 * with nothing saying the two do not fit, because the laboratory's own
 * 提示 column was blank on that row.
 *
 * Printing two numbers side by side, having already compared them, and
 * leaving the patient to redo the arithmetic is not neutrality. What is
 * added is in the FIRST PERSON and carries no severity — 「报告未标注异
 * 常，本平台比对：高于该区间」 — behind a semicolon that separates it
 * from everything the report wrote. Never 偏高: that is the
 * laboratory's word for the laboratory's verdict.
 *
 * AND IT IS WORD FOR WORD WHAT THE API PRINTS. 临床护照 is one tap from
 * this screen and is built off the same payload; the two disagreeing
 * about whether a number fits its own interval is the defect this
 * platform has already fixed twice in the other direction.
 *
 * SYNTHETIC. Payloads shaped like the ones the API bridge writes; no
 * real report was read.
 */

import { buildReportInsights } from '../report-insights';

const labReport = (fields: Record<string, unknown>) => ({
  id: 'doc-lab',
  documentType: 'muscle_enzyme',
  status: 'parsed',
  uploadedAt: '2026-03-05T00:00:00.000Z',
  ocrPayload: { fields: { reportTime: '2026-03-04', ...fields } },
});

const insights = (fields: Record<string, unknown>) =>
  buildReportInsights([labReport(fields)] as never, null);

const metric = (fields: Record<string, unknown>, label: string) =>
  insights(fields)
    .systemPanels.flatMap((panel) => panel.sections)
    .flatMap((section) => section.metrics)
    .find((item) => item.label === label);

const CLAUSE_HIGH = '报告未标注异常，本平台比对：高于该区间';
const CLAUSE_LOW = '报告未标注异常，本平台比对：低于该区间';

describe('没标注但超出区间的数值，屏幕上要说出来', () => {
  it('高于上限时说高于，并且说清楚是本平台在比对', () => {
    expect(metric({ ck: '693U/L', ckReference: '50-310' }, 'CK')?.value).toBe(
      `693U/L（参考区间 50-310；${CLAUSE_HIGH}）`,
    );
  });

  it('低于下限时说低于，方向不会说反', () => {
    expect(metric({ ck: '18U/L', ckReference: '50-310' }, 'CK')?.value).toBe(
      `18U/L（参考区间 50-310；${CLAUSE_LOW}）`,
    );
  });

  it('单边上限也算区间', () => {
    expect(metric({ ckmb: '30ng/mL', ckmbReference: '<25' }, 'CKMB')?.value).toBe(
      `30ng/mL（参考区间 <25；${CLAUSE_HIGH}）`,
    );
  });

  /** The laboratory's own word wins where it wrote one — a second
   *  opinion beside a first one is not this platform's to give. */
  it('化验室自己标了的行完全不变', () => {
    expect(metric({ ck: '693U/L', ckFlag: 'high', ckReference: '50-310' }, 'CK')?.value).toBe(
      '693U/L（偏高，参考区间 50-310）',
    );
  });

  /** 「在区间内」 would be a clean bill this platform does not issue.
   *  The interval alone is what lets a patient check for themselves. */
  it('区间内的数值一个字都不多说', () => {
    expect(metric({ ck: '120U/L', ckReference: '50-310' }, 'CK')?.value).toBe(
      '120U/L（参考区间 50-310）',
    );
  });

  it('定性结果不比 —— 阴性不在任何区间的上面或下面', () => {
    const item = metric({ ck: '阴性', ckReference: '阴性' }, 'CK');
    expect(item?.value).toBe('阴性（参考区间 阴性）');
  });

  it('没有区间可比的行和以前一模一样', () => {
    expect(metric({ ck: '693U/L' }, 'CK')?.value).toBe('693U/L');
  });

  it('病程的血检摘要也带上这一句 —— 它和护照读的是同一份载荷', () => {
    expect(insights({ ck: '693U/L', ckReference: '50-310' }).bloodSummary).toBe(
      `CK 693U/L（参考区间 50-310；${CLAUSE_HIGH}）`,
    );
  });

  /** The two spellings disagree, so no marker crosses and no interval
   *  is claimed for the picked value — which means nothing to compare
   *  against, and nothing said. */
  it('两个拼写的数不一样时既不取标记也不比对', () => {
    expect(
      metric({ ck: '693U/L', ckReference: '50-310', creatineKinase: '96U/L' }, 'CK')?.value,
    ).toBe('96U/L');
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════
 * 全角标点写的区间 —— 中国化验室实际打出来的那种。
 * ══════════════════════════════════════════════════════════════════════
 *
 * These classes shipped understanding the half-width spellings only, so
 * a report typed in a Chinese IME — 「50－310」 (U+FF0D), 「＜25」
 * (U+FF1C) — printed the value and the interval side by side with no
 * observation between them, which is the row the clause exists to end.
 *
 * The set is the parser's: `_read_row_reference` in
 * apps/report-manager/app/services/fshd_report_service.py returns the
 * interval RAW, so `_RANGE_DASHES` and `_COMPARATORS` are exactly what
 * arrives. Asserted here member by member, and identically to
 * apps/api/src/modules/patient-profile/
 * profile.passport.printed-interval.test.ts — 临床护照 is one tap from
 * 报告详情 and the two must not disagree about whether a number fits.
 */
describe('全角标点写的区间，手机上照样比得出来', () => {
  const DASHES = ['-', '~', '‐', '‑', '‒', '–', '—', '―', '−', '〜', '﹣', '－', '～'];

  it.each(DASHES)('两侧区间的分隔符 %s 都读得出来', (dash) => {
    expect(metric({ ck: '693U/L', ckReference: `50${dash}310` }, 'CK')?.value).toBe(
      `693U/L（参考区间 50${dash}310；${CLAUSE_HIGH}）`,
    );
    expect(metric({ ck: '18U/L', ckReference: `50${dash}310` }, 'CK')?.value).toBe(
      `18U/L（参考区间 50${dash}310；${CLAUSE_LOW}）`,
    );
  });

  /** 「<」 excludes its own limit and 「≤」 does not; a widening that
   *  collapses the two puts a reading sitting on the limit on the wrong
   *  side of it. */
  const CEILINGS: Array<[string, boolean]> = [
    ['<', true],
    ['＜', true],
    ['﹤', true],
    ['≤', false],
    ['⩽', false],
    ['≦', false],
  ];

  it.each(CEILINGS)('上限 %s 读得出来，开闭区间没被抹平', (mark, strict) => {
    expect(metric({ ckmb: '30ng/mL', ckmbReference: `${mark}25` }, 'CKMB')?.value).toBe(
      `30ng/mL（参考区间 ${mark}25；${CLAUSE_HIGH}）`,
    );
    expect(metric({ ckmb: '25ng/mL', ckmbReference: `${mark}25` }, 'CKMB')?.value).toBe(
      strict ? `25ng/mL（参考区间 ${mark}25；${CLAUSE_HIGH}）` : `25ng/mL（参考区间 ${mark}25）`,
    );
  });

  const FLOORS: Array<[string, boolean]> = [
    ['>', true],
    ['＞', true],
    ['﹥', true],
    ['≥', false],
    ['⩾', false],
    ['≧', false],
  ];

  it.each(FLOORS)('下限 %s 读得出来，开闭区间没被抹平', (mark, strict) => {
    expect(metric({ ldh: '4U/L', ldhReference: `${mark}9` }, 'LDH')?.value).toBe(
      `4U/L（参考区间 ${mark}9；${CLAUSE_LOW}）`,
    );
    expect(metric({ ldh: '9U/L', ldhReference: `${mark}9` }, 'LDH')?.value).toBe(
      strict ? `9U/L（参考区间 ${mark}9；${CLAUSE_LOW}）` : `9U/L（参考区间 ${mark}9）`,
    );
  });

  it('千分位逗号的两种宽度都是一个数', () => {
    expect(metric({ ck: '3，250U/L', ckReference: '1，000－2，000' }, 'CK')?.value).toBe(
      `3，250U/L（参考区间 1，000－2，000；${CLAUSE_HIGH}）`,
    );
  });

  /** The refusals widen with the acceptances. A result cell holding a
   *  full-width interval walked past `VALUE_IS_A_RANGE`, its low end
   *  was read as the reading, and a verdict was published about a
   *  number nobody measured. */
  it('结果格里装的是全角写法的区间时不比', () => {
    expect(metric({ ck: '0.5－1.2', ckReference: '50-310' }, 'CK')?.value).toBe(
      '0.5－1.2（参考区间 50-310）',
    );
  });

  it('数值本身是全角单边界限时不比 —— 那是检出限', () => {
    expect(metric({ ck: '＜0.01', ckReference: '0.05-0.5' }, 'CK')?.value).toBe(
      '＜0.01（参考区间 0.05-0.5）',
    );
  });

  it('全角区间上，病程摘要和指标卡说的是同一句话', () => {
    const fields = { ck: '693U/L', ckReference: '50－310' };
    const row = `CK 693U/L（参考区间 50－310；${CLAUSE_HIGH}）`;
    expect(insights(fields).bloodSummary).toBe(row);
    expect(metric(fields, 'CK')?.value).toBe(`693U/L（参考区间 50－310；${CLAUSE_HIGH}）`);
  });
});
