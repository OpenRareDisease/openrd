import { describe, expect, it } from 'vitest';

import { BASELINE_PROVENANCE_KEY } from './baseline-provenance.js';
import { applyGeneticReportAutofill } from './profile.autofill.js';
import { buildClinicalPassportExport, buildClinicalPassportSummary } from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';

const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Every assertion in this file traces to one of two primary sources,
 * both in the corpus under `content/medical-kb/source/FSHD_知识库/
 * 02.临床管理与治疗/`:
 *
 *   [AAN] AAN/AANEM 2015 evidence-based guideline summary for
 *         clinicians, "Evaluation, Diagnosis, and Management of FSHD"
 *   [NL]  Dutch FSHD guideline, Spierziekten Nederland 2018 (44 pp.)
 *
 * The reason these are tests and not just comments: the passport told
 * every patient to go get an ECG, an echo and a QTc, and framed the
 * absence as a 「系统监测维度缺口」 in their completion score. [AAN]
 * Level C says the opposite in as many words — routine cardiac
 * screening is not essential absent signs or symptoms, and routine
 * ECG/echo is 「unnecessary in patients with FSHD who are
 * asymptomatic」. [NL] runs 44 pages without using the word cardiac.
 *
 * That nudge did not come from a source. It came from the surveillance
 * schedule of the dystrophies people know better — DMD, myotonic
 * dystrophy — where it is correct. FSHD is where it is not, and these
 * are out-of-pocket tests for the patients using this app.
 *
 * If a future change puts cardiac back on the list, it needs a citation
 * that outranks these two, not an intuition about muscular dystrophy.
 */

const base = (over: Partial<PatientProfileDTO> = {}): PatientProfileDTO =>
  ({
    id: 'p1',
    userId: 'u1',
    fullName: '测试',
    preferredName: null,
    dateOfBirth: '1990-01-01',
    gender: 'male',
    patientCode: 'P0001',
    diagnosisStage: null,
    diagnosisDate: null,
    geneticMutation: null,
    heightCm: null,
    weightKg: null,
    bloodType: null,
    contactPhone: null,
    contactEmail: null,
    primaryPhysician: null,
    regionProvince: null,
    regionCity: null,
    regionDistrict: null,
    baseline: null,
    notes: null,
    measurements: [],
    functionTests: [],
    symptomScores: [],
    dailyImpacts: [],
    followupEvents: [],
    activityLogs: [],
    documents: [],
    medications: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as unknown as PatientProfileDTO;

const geneticReport = (
  fields: Record<string, string>,
  at: { id?: string; uploadedAt?: string } = {},
) => ({
  id: at.id ?? 'd1',
  documentType: 'genetic_report',
  title: null,
  fileName: 'g.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1,
  storageUri: 'local://g',
  status: 'parsed',
  uploadedAt: at.uploadedAt ?? '2026-02-01T00:00:00.000Z',
  checksum: null,
  submissionId: null,
  ocrPayload: { fields: { classifiedType: 'genetic_report', ...fields } },
});

const stepTitles = (profile: PatientProfileDTO) =>
  buildClinicalPassportSummary(profile).nextSteps.map((step) => step.title);

const itemFor = (profile: PatientProfileDTO, key: 'blood' | 'respiratory' | 'cardiac') =>
  buildClinicalPassportSummary(profile).monitoring.items.find((item) => item.key === key);

/** Does an uploaded report printing `raw` earn the AAN Level B retinal
 *  recommendation? The whole path, not the predicate on its own. */
const readsAsLargeDeletion = (raw: string) =>
  stepTitles(base({ documents: [geneticReport({ d4z4Repeats: raw })] } as never)).includes(
    '问一次眼底检查',
  );

describe('心脏：不向无症状患者索要检查 [AAN Level C]', () => {
  it('没有心脏数据时不产生待补项', () => {
    const steps = stepTitles(base());
    expect(steps.some((title) => title.includes('心脏'))).toBe(false);
  });

  it('槽位仍然保留，但说明的是「不需要」而不是「还没做」', () => {
    // Deleting the slot would lose the patient who legitimately has an
    // echo on file. What had to go is the demand, not the display.
    const cardiac = itemFor(base(), 'cardiac');
    expect(cardiac).toBeDefined();
    expect(cardiac?.available).toBe(false);
    expect(cardiac?.note).toContain('不需要常规');
  });

  it('说明里带上就医的触发条件，否则真有心悸的人什么也读不到', () => {
    const note = itemFor(base(), 'cardiac')?.note ?? '';
    expect(note).toContain('心悸');
    expect(note).toContain('胸痛');
  });

  it('必须写明术前是例外', () => {
    // Routine surveillance and preoperative evaluation are separate
    // questions. Mani et al. (AANA J, Oct 2025) call ECG and echo
    // essential parts of the preoperative workup in FSHD — incomplete
    // RBBB in ~30%, mitral valve prolapse in ~25%. A note that says
    // only 「不需要常规」 is something a patient can hand to a pre-op
    // clinic as grounds to skip the ECG.
    const note = itemFor(base(), 'cardiac')?.note ?? '';
    expect(note).toContain('手术前');
  });

  it('说明跟着 markdown 导出走', () => {
    // 「心脏检查：暂无数据，缺失」 on its own reads as an overdue test.
    const { markdown } = buildClinicalPassportExport(buildClinicalPassportSummary(base()));
    expect(markdown).toContain('不需要常规');
  });
});

describe('肺功能：所有人一次基线，复查才有条件 [AAN Level B]', () => {
  it('缺基线时提示，但不承诺「长期随访闭环」', () => {
    const step = buildClinicalPassportSummary(base()).nextSteps.find((s) =>
      s.title.includes('肺功能'),
    );
    expect(step).toBeDefined();
    // 「monitored regularly IF they have abnormal baseline ... severe
    // proximal weakness, kyphoscoliosis, wheelchair dependence」——
    // the condition is the recommendation, so it has to be visible.
    expect(step?.description).toContain('轮椅');
    expect(step?.description).toContain('不是每个人都要长期反复做');
  });

  it('槽位说明里带上术前那一条', () => {
    // Level B: patients not on regular PFT should be tested before
    // general anesthesia — respiratory involvement can be silent.
    expect(itemFor(base(), 'respiratory')?.note).toContain('全身麻醉');
  });
});

describe('血检：展示已上传的，不索要定期复查', () => {
  it('不产生血检待补项', () => {
    expect(stepTitles(base()).some((title) => title.includes('血检'))).toBe(false);
  });

  it('说明里写明没有指南支持靠抽血追踪进展', () => {
    expect(itemFor(base(), 'blood')?.note).toContain('没有指南');
  });
});

describe('眼底：只给大片段缺失的那一组 [AAN Level B]', () => {
  it('重复数 ≤4 时提示', () => {
    const steps = stepTitles(base({ documents: [geneticReport({ d4z4Repeats: '3' })] } as never));
    expect(steps).toContain('问一次眼底检查');
  });

  it('重复数较大时不提示', () => {
    const steps = stepTitles(base({ documents: [geneticReport({ d4z4Repeats: '8' })] } as never));
    expect(steps.some((title) => title.includes('眼底'))).toBe(false);
  });

  it('没有基因报告时不提示', () => {
    expect(stepTitles(base()).some((title) => title.includes('眼底'))).toBe(false);
  });

  describe('重复数读不准时不提示 —— 这一条决定是否让人去挂眼科', () => {
    // The value is OCR'd off a genetics report, so it arrives however
    // the lab chose to print it. Driven through an uploaded report
    // rather than by calling the predicate on a string: `ReportReadD4Z4`
    // now has no string constructor, and going through the document is
    // what proves the table still governs the recommendation.
    it.each([
      ['1-10', '范围'],
      ['≤10', '比较符'],
      ['4~7', '波浪范围'],
      ['1 至 10', '中文范围'],
      ['', '空'],
      ['—', '占位符'],
      ['未检出', '纯文字'],
      ['0', '不成立的等位基因'],
    ])('%s（%s）不触发', (raw) => {
      expect(readsAsLargeDeletion(raw)).toBe(false);
    });

    it.each([['1'], ['2'], ['3'], ['4'], ['3个']])('%s 触发', (raw) => {
      expect(readsAsLargeDeletion(raw)).toBe(true);
    });

    it('5 及以上不触发 —— 指南写的是 1–4 repeats', () => {
      expect(readsAsLargeDeletion('5')).toBe(false);
    });
  });

  /**
   * THE INVARIANT, AT EVERY STATE A REPEAT COUNT CAN REACH THIS PAGE
   * IN.
   *
   * A value that was not read out of an uploaded report may be
   * displayed, with its origin beside it. It may never decide a
   * recommendation, a threshold, a guideline citation or a screening
   * interval. Every state below except the report's prints a number
   * this platform never read off a report, and each of them prints 3 —
   * the middle of the range the guideline calls a large deletion. Only
   * the report's may earn 「问一次眼底检查」.
   *
   * What each of the others must ALSO do is say so. Dropping the step
   * would leave the page showing the number and silently withholding
   * the one recommendation keyed to it, which a reader takes for
   * 「不适用」.
   */
  describe('这个数是从哪来的，决定它能不能作数', () => {
    const SIZING_REPORT_AT = '2025-02-01T00:00:00.000Z';
    const LATER_REPORT_AT = '2026-04-01T00:00:00.000Z';

    /** The read-time step this passport is handed the output of:
     *  `getPatientProfile` runs it before building anything, and it
     *  copies a report's value into an empty baseline field without
     *  recording that it did. */
    const autofilledFrom = (documents: unknown[]) =>
      applyGeneticReportAutofill(
        { diagnosisDate: null, geneticMutation: null, baseline: null },
        documents as never,
      ).baseline;

    const retinaStep = (profile: PatientProfileDTO) =>
      buildClinicalPassportSummary(profile).nextSteps.find((step) => step.title.includes('眼底'));

    it('压着来源记录的重复数：显示，带来源，但换不来眼底检查那一条', () => {
      // The count sits in the archive under a back-office marker, and
      // nobody here has opened a report for it.
      const profile = base({
        baseline: {
          diseaseBackground: { d4z4: '3' },
          [BASELINE_PROVENANCE_KEY]: {
            'diseaseBackground.d4z4': {
              source: 'admin_entered',
              adminUserId: ADMIN_ID,
              at: '2026-05-01T00:00:00.000Z',
            },
          },
        } as never,
      });
      const summary = buildClinicalPassportSummary(profile);

      expect(summary.diagnosis.d4z4Repeats).toBe('3');
      expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('admin_entered');
      expect(summary.nextSteps.map((step) => step.title)).not.toContain('问一次眼底检查');

      const step = retinaStep(profile);
      expect(step?.title).toBe('眼底检查这一条要看报告原件');
      // Displayed with its origin beside it, and never classified.
      expect(step?.description).toContain('3（管理员代填）');
      expect(step?.description).not.toContain('属于指南所说的大片段缺失');
      // Names what would change it.
      expect(step?.description).toContain('上传');
      expect(step?.description).toContain('报告原件');
    });

    it('患者自己填进登记表的重复数：显示，标「本人填写」，同样换不来那一条', () => {
      // The state the registration form actually produces: a number in
      // the baseline, no document anywhere, so nothing for the read-time
      // autofill to have copied it out of.
      const profile = base({ baseline: { diseaseBackground: { d4z4: '3' } } as never });
      const summary = buildClinicalPassportSummary(profile);

      expect(summary.diagnosis.d4z4Repeats).toBe('3');
      expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('patient');
      expect(summary.nextSteps.map((step) => step.title)).not.toContain('问一次眼底检查');

      const step = retinaStep(profile);
      expect(step?.title).toBe('眼底检查这一条要看报告原件');
      expect(step?.description).toContain('3（本人填写）');
      expect(step?.description).not.toContain('属于指南所说的大片段缺失');
      expect(step?.description).toContain('报告原件');
    });

    it('OCR 补进基线的重复数：报告被后一份盖过之后，这个数不再作数', () => {
      // The sizing report's count was copied into the empty baseline at
      // read time. A later FSHD2 methylation workup is now the newest
      // genetic report, and the passport only ever opens that one — so
      // the number on the page is the archive's, and this platform
      // cannot say whether the archive got it from a report.
      const sizing = geneticReport(
        { d4z4Repeats: '3' },
        { id: 'sizing', uploadedAt: SIZING_REPORT_AT },
      );
      const later = geneticReport(
        { methylationValue: '25%' },
        { id: 'fshd2', uploadedAt: LATER_REPORT_AT },
      );
      const profile = base({
        baseline: autofilledFrom([sizing]) as never,
        documents: [sizing, later] as never,
      });
      const summary = buildClinicalPassportSummary(profile);

      // The autofill really is what put it there.
      expect((summary.diagnosis as { d4z4Repeats: string }).d4z4Repeats).toBe('3');
      expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('indeterminate');
      expect(summary.nextSteps.map((step) => step.title)).not.toContain('问一次眼底检查');

      const step = retinaStep(profile);
      expect(step?.description).toContain('3（来源无法确定）');
      // 「本平台这次没有从基因报告里读出这个数」 and NOT 「这个数不是从
      // 报告里读出来的」: here it demonstrably came out of one.
      expect(step?.description).toContain('这次没有从基因报告里读出这个数');
      expect(step?.description).not.toContain('不是本平台从基因报告里读出来的');
    });

    it('新报告盖过旧报告：旧报告上的数字还在档案里，但不再是本护照读到的', () => {
      // Same document pair, but the count in the baseline is the
      // patient's own typing. The passport cannot tell this apart from
      // the case above, and says so rather than picking one.
      const sizing = geneticReport(
        { d4z4Repeats: '3' },
        { id: 'sizing', uploadedAt: SIZING_REPORT_AT },
      );
      const later = geneticReport(
        { methylationValue: '25%' },
        { id: 'fshd2', uploadedAt: LATER_REPORT_AT },
      );
      const profile = base({
        baseline: { diseaseBackground: { d4z4: '3' } } as never,
        documents: [sizing, later] as never,
      });
      const summary = buildClinicalPassportSummary(profile);

      expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('indeterminate');
      expect(summary.nextSteps.map((step) => step.title)).not.toContain('问一次眼底检查');
      expect(retinaStep(profile)?.description).toContain('本平台只读最新的一份基因报告');
    });

    it('报告里读出来的重复数：这一条才成立，句子里引的也是报告上的数', () => {
      const profile = base({ documents: [geneticReport({ d4z4Repeats: '3' })] as never });
      const summary = buildClinicalPassportSummary(profile);

      expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('report');
      const step = retinaStep(profile);
      expect(step?.title).toBe('问一次眼底检查');
      expect(step?.description).toContain('你的 D4Z4 重复数为 3');
      expect(step?.description).toContain('散瞳间接检眼镜');
    });

    it('基线的数和报告的数不一样时，引用的是报告的那个', () => {
      // The merged string prefers the report, so this passes either
      // way today — it is here so that a future change to that
      // preference cannot quietly put the baseline's number inside an
      // AAN Level B sentence.
      const profile = base({
        baseline: { diseaseBackground: { d4z4: '9' } } as never,
        documents: [geneticReport({ d4z4Repeats: '3' })] as never,
      });
      expect(retinaStep(profile)?.description).toContain('你的 D4Z4 重复数为 3');
      expect(retinaStep(profile)?.description).not.toContain('9');
    });
  });
});

describe('听力：只给学龄前儿童 [AAN Level B]', () => {
  const yearsAgo = (n: number) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.toISOString().slice(0, 10);
  };

  it('4 岁提示', () => {
    expect(stepTitles(base({ dateOfBirth: yearsAgo(4) } as never))).toContain('每年做一次听力筛查');
  });

  it('成年人不提示', () => {
    const steps = stepTitles(base({ dateOfBirth: yearsAgo(34) } as never));
    expect(steps.some((title) => title.includes('听力'))).toBe(false);
  });

  it('没有出生日期时不提示', () => {
    const steps = stepTitles(base({ dateOfBirth: null } as never));
    expect(steps.some((title) => title.includes('听力'))).toBe(false);
  });
});

/**
 * The three monitoring summaries used to fall back to the first 88
 * characters of `extractedText` when OCR pulled no structured field out
 * of the report. That is the hospital letterhead on any failed parse,
 * and it is not a display-only problem: a non-empty summary passes
 * `hasMeaningfulValue`, so the slot goes `available: true` and the
 * anesthesia card prints it under 「最近肺功能」 — the one line on that
 * card meant to stop an unassessed patient reaching general anesthesia.
 * An anesthetist reading a hospital name in that position has no way to
 * tell it apart from a reading.
 */
describe('OCR 没读出结构化字段时，槽位不能拿报告信头顶上 [麻醉卡]', () => {
  const LETTERHEAD =
    '××市第一人民医院 检验科 报告单 门诊号 0001234 送检医师 张×× 采样时间 2026-03-02 打印时间 2026-03-03';

  const unparsedDoc = (documentType: string) => ({
    id: `d-${documentType}`,
    documentType,
    title: null,
    fileName: 'scan.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1,
    storageUri: 'local://scan',
    status: 'parsed',
    uploadedAt: '2026-03-03T00:00:00.000Z',
    checksum: null,
    submissionId: null,
    // Exactly the shape a failed parse leaves behind: text came out of
    // OCR, no field did.
    ocrPayload: { extractedText: LETTERHEAD },
  });

  const slots = [
    ['respiratory', 'pulmonary_function'],
    ['cardiac', 'ecg'],
    ['blood', 'biochemistry'],
  ] as const;

  it.each(slots)('%s：摘要里不出现信头原文', (key, documentType) => {
    const item = itemFor(base({ documents: [unparsedDoc(documentType)] } as never), key);
    expect(item?.summary).not.toContain('医院');
    expect(item?.summary).not.toContain('门诊号');
    expect(item?.summary).toContain('暂无');
  });

  it.each(slots)('%s：槽位保持 available=false —— 麻醉卡据此说「未做过或未上传」', (key, type) => {
    // buildAnesthesiaCard falls back to 未做过或未上传 on exactly this
    // flag. If a sentinel ever stops starting with 暂无,
    // hasMeaningfulValue flips it back to true and the card starts
    // printing the sentinel as if it were a finding.
    expect(itemFor(base({ documents: [unparsedDoc(type)] } as never), key)?.available).toBe(false);
  });

  it('信头也不能从 markdown 导出的系统监测一节漏出去', () => {
    const { markdown } = buildClinicalPassportExport(
      buildClinicalPassportSummary(
        base({
          documents: slots.map(([, documentType]) => unparsedDoc(documentType)),
        } as never),
      ),
    );
    // Scoped to 系统监测 on purpose. The 最近来源 timeline still quotes
    // `extractedText` — there it is captioned as「你上传的这份报告长这样」
    // under a 报告 tag, not offered as a reading, and it is not what the
    // anesthesia card reads.
    const monitoringSection = markdown.split('## 系统监测')[1]?.split('\n## ')[0] ?? '';
    expect(monitoringSection).not.toBe('');
    expect(monitoringSection).not.toContain('××市第一人民医院');
  });

  it('真读出结构化字段时照常显示', () => {
    // The guard is 「no structured field」, not 「no document」 —
    // a parsed report still has to reach the card.
    const parsed = {
      ...unparsedDoc('pulmonary_function'),
      ocrPayload: { extractedText: LETTERHEAD, fields: { fvcPredPct: 'FVC 78%' } },
    };
    const item = itemFor(base({ documents: [parsed] } as never), 'respiratory');
    expect(item?.available).toBe(true);
    expect(item?.summary).toContain('FVC 78%');
  });
});

describe('空面板的措辞', () => {
  it('不说「仍缺核心监测」', () => {
    // Of the three slots only the pulmonary baseline is expected of
    // everyone; calling all three 核心监测 is what manufactured the gap.
    const card = buildClinicalPassportSummary(base()).summaryCards.find(
      (c) => c.key === 'monitoring',
    );
    expect(card?.summary).not.toContain('缺');
    expect(card?.summary).toContain('还没有上传过');
  });
});

describe('两类待办不能混在一个列表里', () => {
  it('上传类是 record', () => {
    const steps = buildClinicalPassportSummary(base()).nextSteps;
    expect(steps.find((s) => s.title.includes('基因'))?.kind).toBe('record');
    expect(steps.find((s) => s.title.includes('MRI'))?.kind).toBe('record');
    expect(steps.find((s) => s.title.includes('肌力'))?.kind).toBe('record');
  });

  it('指南建议类是 clinical', () => {
    // 「问一次眼底检查」 rendered under 「可以优先补这些记录」 with a
    // warning triangle and a 「去数据录入补齐」 button is no longer the
    // recommendation the guideline made.
    const steps = buildClinicalPassportSummary(
      base({
        dateOfBirth: '2021-01-01',
        documents: [geneticReport({ d4z4Repeats: '2' })],
      } as never),
    ).nextSteps;
    expect(steps.find((s) => s.title.includes('眼底'))?.kind).toBe('clinical');
    expect(steps.find((s) => s.title.includes('听力'))?.kind).toBe('clinical');
    expect(steps.find((s) => s.title.includes('肺功能'))?.kind).toBe('clinical');
  });

  it('每一条都必须标了 kind', () => {
    const steps = buildClinicalPassportSummary(
      base({
        dateOfBirth: '2021-01-01',
        documents: [geneticReport({ d4z4Repeats: '2' })],
      } as never),
    ).nextSteps;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.kind === 'record' || s.kind === 'clinical')).toBe(true);
  });
});
