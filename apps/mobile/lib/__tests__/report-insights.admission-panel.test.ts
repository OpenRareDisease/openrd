/**
 * ══════════════════════════════════════════════════════════════════════
 * 入院常规：一页两段，而分类只有一个词。
 * ══════════════════════════════════════════════════════════════════════
 *
 * An 入院常规 printout carries 血常规 and 尿常规 under their own
 * headings on one sheet. `_split_blood_and_urine_sections` in
 * apps/report-manager/app/services/fshd_report_service.py splits on
 * those headings and runs BOTH extractors — whichever of the two labels
 * the classifier landed on — so the payload holds `hgb` AND
 * `urineProtein`.
 *
 * The CLASSIFICATION is a single string, and the page scores
 * `blood_routine`: it prints haemoglobin and platelets, so the specimen
 * rule that rescues a pure urine report cannot fire. This module's
 * per-metric `docTypes` gate then asked whether the document's ONE type
 * was `urinalysis`, and filtered every 尿蛋白, 尿潜血, 尿糖, 尿比重 and
 * 尿 pH the parser had just extracted straight back out — off 报告详情
 * → 检查结果, off 我的档案 and off 病程. The parser-side fix landed and
 * stopped at the screen.
 *
 * THE GATE IS NOT REMOVED, only widened to the two labels that describe
 * the same sheet. A biochemistry panel still supplies no urine row.
 *
 * SYNTHETIC. Every payload below was written for this file.
 */

import { buildReportInsights } from '../report-insights';

const page = (classifiedType: string, fields: Record<string, unknown>) => ({
  id: 'doc-1',
  documentType: classifiedType,
  status: 'parsed',
  uploadedAt: '2026-08-01T00:00:00.000Z',
  ocrPayload: { fields: { classifiedType, reportTime: '2026-07-30', ...fields } },
});

const sectionsOf = (classifiedType: string, fields: Record<string, unknown>) =>
  buildReportInsights([page(classifiedType, fields)] as never, null).systemPanels.flatMap(
    (panel) => panel.sections,
  );

const labelsIn = (classifiedType: string, fields: Record<string, unknown>, sectionKey: string) =>
  sectionsOf(classifiedType, fields)
    .filter((section) => section.key === sectionKey)
    .flatMap((section) => section.metrics)
    .map((metric) => metric.label);

/** Both panels, as the parser leaves them on one page. */
const ADMISSION_PAGE = {
  wbc: '6.1',
  hgb: '98',
  hgbFlag: 'low',
  hgbReference: '130-175',
  plt: '236',
  urineProtein: '阴性',
  urineOccultBlood: '阳性',
  urineGlucose: '阴性',
  urineSpecificGravity: '1.025',
  urinePh: '5.0',
};

describe('同页血常规 + 尿常规', () => {
  it('页面被判成 blood_routine 时，尿常规那几行照样上屏', () => {
    expect(labelsIn('blood_routine', ADMISSION_PAGE, 'urinalysis')).toEqual([
      '尿蛋白',
      '尿潜血',
      '尿糖',
      '尿比重',
      '尿 pH',
    ]);
  });

  it('同一页被判成 urinalysis 时，血常规那几行也照样上屏', () => {
    expect(labelsIn('urinalysis', ADMISSION_PAGE, 'blood_routine')).toEqual(['WBC', 'HGB', 'PLT']);
  });

  it('两段都在的时候两个分段都建出来，不是二选一', () => {
    const keys = sectionsOf('blood_routine', ADMISSION_PAGE).map((section) => section.key);
    expect(keys).toContain('blood_routine');
    expect(keys).toContain('urinalysis');
  });

  it('化验室在血常规那一段标的异常仍然跟着它自己那一行', () => {
    const hgb = sectionsOf('blood_routine', ADMISSION_PAGE)
      .flatMap((section) => section.metrics)
      .find((metric) => metric.label === 'HGB');
    expect(hgb?.value).toBe('98（偏低，参考区间 130-175）');
  });

  /**
   * THE GATE STILL REFUSES EVERY OTHER TYPE. Widening it to the two
   * labels that describe one sheet is not the same as trusting any
   * document that happens to carry a urine key — a biochemistry panel
   * does not get to supply a urine sediment row.
   */
  it('生化报告仍然拿不到尿常规那一段', () => {
    const keys = sectionsOf('biochemistry', {
      creatinine: '72',
      urineProtein: '阴性',
    }).map((section) => section.key);
    expect(keys).not.toContain('urinalysis');
  });

  it('只印尿常规的报告和以前一样', () => {
    expect(labelsIn('urinalysis', { urineProtein: '阴性', urinePh: '5.0' }, 'urinalysis')).toEqual([
      '尿蛋白',
      '尿 pH',
    ]);
  });
});
