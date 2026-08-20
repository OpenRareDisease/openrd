import { describe, expect, it } from 'vitest';

import { BASELINE_PROVENANCE_KEY } from './baseline-provenance.js';
import { buildPassportSharePage } from './passport-share.html.js';
import { applyGeneticReportAutofill } from './profile.autofill.js';
import { buildClinicalPassportExport, buildClinicalPassportSummary } from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';
import { buildReferralPack } from './referral-pack.js';

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
  // BOTH LABELS, BECAUSE THE PIPELINE STORES BOTH. `classifiedType` is
  // the parser's; `documentType` inside `fields` is the uploader's own
  // declaration, stamped there by every OCR provider before any
  // classification exists and overwritten by nothing — unlike the
  // column above, which `updateDocumentOcrResult` replaces with the
  // classification. `isLaboratoryGeneticReport` reads the cell as the
  // declaration, and it is what separates this fixture from an archived
  // 门诊病历摘要 the old keyword classifier scored `genetic_report`:
  // that row carries `documentType: other` in the same blob.
  //
  // This briefly carried `geneticTestMethod: southern_blot` for the
  // same job. That was the wrong witness: a stated 检测方法 is graded,
  // so it changes the clinical state the fixture describes, and a real
  // laboratory report very often has none read off it.
  ocrPayload: {
    fields: { classifiedType: 'genetic_report', documentType: 'genetic_report', ...fields },
  },
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
   * 以 kb 写的长度也不触发，理由和上面那些都不一样：这一格没读错，它读
   * 的是另一个单位。同一句指南把界限的 kb 形式写成 10–20、重复单元形式
   * 写成 1–4，「3kb」要落进 1–4 只能靠一次两边都没写过的换算。
   *
   * 单独一条而不是并进上面那张表：那张表叫「读不准」，而这一格读得很准。
   * `isLargeD4Z4Deletion` 的注释说这条 kb 规则同时进了两份手抄件的两张
   * 表 —— apps/mobile/lib/surveillance-schedule.ts 那份进了，这一份没有，
   * 于是那句话自己成了本仓库里唯一没被钉住的说法。
   */
  it.each([['3kb'], ['3 kb']])('%s 是以 kb 写的长度，不触发', (raw) => {
    expect(readsAsLargeDeletion(raw)).toBe(false);
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
      // Ends on the one thing that is true whatever the picker did.
      expect(step?.description).toContain('报告原件');
    });

    /**
     * ONE STORED PROFILE, TWO HISTORIES, AND THE PAGE MAY NOT PICK ONE.
     *
     * The first fixture is what the registration form produces: a
     * number typed into the baseline with no document anywhere. The
     * second is the same stored profile reached the other way — a
     * genetics report filled the empty baseline at read time
     * (`applyGeneticReportAutofill` leaves no record that it did), the
     * form loaded that profile and the patient saved it, and the report
     * was then deleted. Nothing on disk separates them, which is why
     * both must come out 「来源无法确定」: the passport used to print
     * 「本人填写」 over both, and over the second it was naming an author
     * for a number the patient never typed.
     */
    it('登记表里填的重复数，和报告删掉后剩下的那个，本平台分不出来', () => {
      const typed = base({ baseline: { diseaseBackground: { d4z4: '3' } } as never });
      const autofilledThenDeleted = base({
        baseline: autofilledFrom([geneticReport({ d4z4Repeats: '3' })]) as never,
      });

      for (const profile of [typed, autofilledThenDeleted]) {
        const summary = buildClinicalPassportSummary(profile);

        expect(summary.diagnosis.d4z4Repeats).toBe('3');
        expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('indeterminate');
        expect(summary.diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('来源无法确定');
        expect(summary.nextSteps.map((step) => step.title)).not.toContain('问一次眼底检查');

        const step = retinaStep(profile);
        expect(step?.title).toBe('眼底检查这一条要看报告原件');
        expect(step?.description).toContain('3（来源无法确定）');
        expect(step?.description).not.toContain('本人填写');
        expect(step?.description).not.toContain('属于指南所说的大片段缺失');
        expect(step?.description).toContain('报告原件');
      }
    });

    it('OCR 补进基线的重复数：那份报告不在档案里之后，这个数不再作数', () => {
      // The sizing report's count was copied into the empty baseline at
      // read time, and that report has since been deleted. What is still
      // on file is an FSHD2 methylation workup, which carries no count —
      // so the number on the page is the archive's, and this platform
      // cannot say whether the archive got it from a report.
      //
      // THE SIZING REPORT IS OFF THE DOCUMENT LIST, NOT OUTRANKED. This
      // fixture used to keep it on file and rely on the later workup
      // outranking it. It no longer does, and must not:
      // `pickGeneticEvidenceDocument` puts a report that states a D4Z4
      // length above one that does not, precisely so a later workup that
      // never measured the array cannot delete a count this platform
      // holds. With both on file the count is read off the sizing report
      // and this step does not arise at all — which is the point of that
      // rule, and is covered in genetic-evidence.test.ts.
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
        documents: [later] as never,
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

    it('档案里有报告、但那份报告没有这个数：登记表里的数字仍然作不了数', () => {
      // Same document on file, but the count in the baseline is the
      // patient's own typing. The passport cannot tell this apart from
      // the case above, and says so rather than picking one.
      const later = geneticReport(
        { methylationValue: '25%' },
        { id: 'fshd2', uploadedAt: LATER_REPORT_AT },
      );
      const profile = base({
        baseline: { diseaseBackground: { d4z4: '3' } } as never,
        documents: [later] as never,
      });
      const summary = buildClinicalPassportSummary(profile);

      expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('indeterminate');
      expect(summary.nextSteps.map((step) => step.title)).not.toContain('问一次眼底检查');

      /**
       * NO ARM OF THIS STEP NAMES THE REPORT THAT WAS READ.
       *
       * It used to end 「把写着重复数的那份基因报告上传上来（本平台只读
       * 最新的一份基因报告），这一条就会有答案」.
       * `pickGeneticEvidenceDocument` ranks the genetics laboratory's
       * own report above a document quoting one, a landed parse above
       * an unlanded one and a richer report above a thinner one before
       * it looks at upload time at all — so the newest report is
       * routinely not the one that was read, and an upload carrying the
       * count wins nothing automatically. Both halves are gone rather
       * than reworded: the picker's order is not a rule this paragraph
       * can restate without going stale again.
       */
      const step = retinaStep(profile);
      expect(step?.description).not.toContain('最新');
      expect(step?.description).not.toContain('就会有答案');
      expect(step?.description).toContain('这句话要医生看着报告原件说。');
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

/**
 * 待补项 IS A CLINICIAN-FACING DOCUMENT, AND IT USED TO CONTRADICT THE
 * OTHER TWO BUILT FROM THE SAME DTO IN THE SAME REQUEST.
 *
 * The pulmonary step was gated on `!hasMeaningfulValue(respiratorySummary)`
 * — two states — while `buildMonitoringItem` forty lines above it
 * derives three. A patient who uploaded a pulmonary function report the
 * parser read nothing structured out of has `state: 'unreadable'`, an
 * empty summary, AND a `latestDocumentId`; the old gate saw only the
 * empty summary and printed 「补充肺功能基线：指南建议所有 FSHD 患者做
 * 一次肺功能基线」 into the markdown export's 待补项, the share page's
 * 「按指南，这位患者值得确认的事」 and the mobile PDF's 待补项 — telling
 * a clinician to order a test whose report is in the patient's bag,
 * while `buildReferralPack` and `buildAnesthesiaCard`, reading `state`
 * off the same object, said 「已上传…但未能自动读出数值 —— 请向患者索取
 * 原件」.
 *
 * `absent` and `unreadable` ask different people for different things.
 * The step must not collapse them again.
 */
describe('肺功能待补项：三种状态，不是两种', () => {
  const pft = (fields: Record<string, string>) => ({
    id: '88888888-8888-4888-8888-888888888882',
    documentType: 'pulmonary_function',
    title: null,
    fileName: 'pft.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1,
    storageUri: 'local://pft',
    status: 'parsed',
    uploadedAt: '2026-02-09T00:00:00.000Z',
    checksum: null,
    submissionId: null,
    ocrPayload: { fields: { classifiedType: 'pulmonary_function', ...fields } },
  });

  const unreadable = () => base({ documents: [pft({ reportTime: '2026-02-09' })] } as never);

  it('没有任何肺功能报告时，仍然索要基线 [AAN Level B]', () => {
    const item = itemFor(base(), 'respiratory');
    expect(item?.state).toBe('absent');
    expect(stepTitles(base())).toContain('补充肺功能基线');
  });

  it('报告已上传但读不出时，不说「补充基线」—— 那份检查可能已经做过了', () => {
    expect(itemFor(unreadable(), 'respiratory')?.state).toBe('unreadable');
    expect(stepTitles(unreadable())).not.toContain('补充肺功能基线');
  });

  it('读不出时改为索要报告原件，和转诊包、麻醉卡说同一句话', () => {
    const step = buildClinicalPassportSummary(unreadable()).nextSteps.find((s) =>
      s.title.includes('肺功能'),
    );
    expect(step?.kind).toBe('clinical');
    expect(step?.description).toContain('未能自动读出');
    expect(step?.description).toContain('原件');
    // 「指南建议所有 FSHD 患者做一次肺功能基线（FVC / FEV1）」 as a
    // standing instruction is what an anesthetist acts on by ordering
    // the test. The Level B fact may still be named, but not as this
    // patient's outstanding gap.
    expect(step?.description).not.toContain('指南建议所有 FSHD 患者做一次肺功能基线');
  });

  it('读出了数值时，两条都不出现', () => {
    const readable = base({ documents: [pft({ fvcPredPct: 'FVC 78%' })] } as never);
    expect(itemFor(readable, 'respiratory')?.state).toBe('present');
    expect(stepTitles(readable).some((title) => title.includes('肺功能'))).toBe(false);
  });

  it('这一条出现在导出、分享页和 PDF 共用的 nextSteps 里，不是某一面自己拼的', () => {
    // The three clinician documents render `nextSteps` verbatim, so the
    // markdown export is a sufficient witness for all of them.
    const { markdown } = buildClinicalPassportExport(buildClinicalPassportSummary(unreadable()));
    const section = markdown.split('## 待补项')[1]?.split('\n## ')[0] ?? '';
    expect(section).not.toBe('');
    expect(section).not.toContain('补充肺功能基线');
    expect(section).toContain('原件');
  });
});

/**
 * THE 系统监测 CARD SAYS WHAT THE SLOTS SAY.
 *
 * The card is the first line of the panel on screen, and it is one row
 * of the markdown export's 核心摘要 table — the table a clinician reads
 * before anything else on the sheet. Its not-ready copy asserted 「还没
 * 有上传过肺功能、心脏或血检报告」 off `available`, which is a question
 * about a VALUE, while `buildMonitoringItem` had already answered the
 * question about a REPORT three states deep.
 *
 * Rendered for a patient whose pulmonary function report is on file but
 * did not parse, one export said all three of these at once:
 *
 *   核心摘要 :「还没有上传过肺功能、心脏或血检报告」
 *   card meta:「最近监测 2026-02-09」
 *   待补项  :「你上传过肺功能报告，但本平台未能自动读出其中的数值」
 *
 * Same defect as 补充肺功能基线, same slot, same fix: read `state`.
 */
describe('系统监测卡片：读 state，不读摘要字符串', () => {
  const unparsed = (documentType: string) => ({
    id: `card-${documentType}`,
    documentType,
    title: null,
    fileName: 'scan.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1,
    storageUri: 'local://scan',
    status: 'parsed',
    uploadedAt: '2026-02-09T00:00:00.000Z',
    checksum: null,
    submissionId: null,
    ocrPayload: { extractedText: '××市第一人民医院 检验科 报告单' },
  });

  const cardFor = (profile: PatientProfileDTO) =>
    buildClinicalPassportSummary(profile).summaryCards.find((c) => c.key === 'monitoring');

  it('一份读不出的报告在册时，不说「还没有上传过」', () => {
    const profile = base({ documents: [unparsed('pulmonary_function')] } as never);
    expect(
      buildClinicalPassportSummary(profile).monitoring.items.find((i) => i.key === 'respiratory')
        ?.state,
    ).toBe('unreadable');
    expect(cardFor(profile)?.summary).not.toContain('还没有上传过');
    expect(cardFor(profile)?.summary).toContain('肺功能');
    expect(cardFor(profile)?.summary).toContain('未能自动读出');
  });

  it('卡片不再和自己的 meta 打架 —— meta 印着日期就不能说没上传过', () => {
    const card = cardFor(base({ documents: [unparsed('pulmonary_function')] } as never));
    expect(card?.meta).toContain('2026-02-09');
    expect(card?.summary).not.toContain('还没有上传过');
  });

  it('读不出的槽位逐个点名，没上传的不点名', () => {
    const profile = base({
      documents: [unparsed('pulmonary_function'), unparsed('ecg')],
    } as never);
    const summary = cardFor(profile)?.summary ?? '';
    expect(summary).toContain('肺功能');
    expect(summary).toContain('心脏检查');
    expect(summary).not.toContain('血检指标');
  });

  it('真的什么都没上传过时，原话不变', () => {
    // The sentence is correct for exactly this profile, and 空面板的措辞
    // above pins the rest of it.
    expect(cardFor(base())?.summary).toBe('还没有上传过肺功能、心脏或血检报告');
  });

  it('这一行同时是 markdown 导出核心摘要表的一格', () => {
    const { markdown } = buildClinicalPassportExport(
      buildClinicalPassportSummary(base({ documents: [unparsed('pulmonary_function')] } as never)),
    );
    const table = markdown.split('## 核心摘要')[1]?.split('\n## ')[0] ?? '';
    expect(table).not.toBe('');
    expect(table).not.toContain('还没有上传过');
    expect(table).toContain('未能自动读出');
  });

  it('读出了数值时，卡片列已就绪的槽位', () => {
    const parsed = {
      ...unparsed('pulmonary_function'),
      ocrPayload: { fields: { classifiedType: 'pulmonary_function', fvcPredPct: 'FVC 78%' } },
    };
    const card = cardFor(base({ documents: [parsed] } as never));
    expect(card?.ready).toBe(true);
    expect(card?.summary).toContain('肺功能');
    expect(card?.summary).not.toContain('未能自动读出');
  });
});

/** A parsed report of a given class carrying exactly these fields.
 *  Local to the two describes below; the `unparsedDoc` further up is
 *  the opposite fixture (text, no fields) and is scoped to its own. */
const parsedDoc = (
  documentType: string,
  fields: Record<string, string>,
  at: { id?: string; uploadedAt?: string } = {},
) => ({
  id: at.id ?? `d-${documentType}`,
  documentType,
  title: null,
  fileName: 'scan.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1,
  storageUri: 'local://scan',
  status: 'parsed',
  uploadedAt: at.uploadedAt ?? '2026-03-03T00:00:00.000Z',
  checksum: null,
  submissionId: null,
  ocrPayload: { fields: { classifiedType: documentType, ...fields } },
});

/**
 * A VALUE ON THIS PANEL IS NEVER A BARE NUMBER.
 *
 * 心脏 and 肺功能 were built by joining `pickField` results with a slash
 * — a POSITIONAL join, where the name of each value lived only in the
 * order of the array and nothing was printed. An echocardiogram
 * therefore reached a clinician as 「窦性心律 / 各房室内径正常 / 58 / 430」:
 * an ejection fraction and a QTc as two anonymous numbers.
 *
 * The join was positional AND gap-closing, which is the worse half.
 * `filter(Boolean)` removes a metric that did not parse, so a report
 * with no LVEF printed 「窦性心律 / 430」 and a reader with no way to see
 * that a slot had vanished reads the QTc as the ejection fraction. An
 * EF of 43% is a referral; a QTc of 430 ms is normal.
 */
describe('心肺面板：每个数值都带名字和单位', () => {
  const doc = parsedDoc;

  it('心脏：LVEF 和 QTc 都被命名，不再是两个裸数字', () => {
    const item = itemFor(
      base({
        documents: [
          doc('ecg', {
            ecgSummary: '窦性心律',
            echoSummary: '各房室内径正常',
            LVEF: '58',
            QTc: '430',
          }),
        ],
      } as never),
      'cardiac',
    );
    expect(item?.summary).toContain('LVEF 58%');
    expect(item?.summary).toContain('QTc 430 ms');
    // The shape that made the numbers anonymous.
    expect(item?.summary).not.toContain('/ 58 /');
  });

  it('心脏：缺一项时剩下的那项不会顶替它的位置', () => {
    const item = itemFor(
      base({ documents: [doc('ecg', { ecgSummary: '窦性心律', QTc: '430' })] } as never),
      'cardiac',
    );
    // 430 is a QTc and says so, on a report carrying no ejection
    // fraction at all.
    expect(item?.summary).toContain('QTc 430 ms');
    expect(item?.summary).not.toContain('LVEF');
  });

  it('报告本身带了单位时不会重复追加', () => {
    const item = itemFor(
      base({ documents: [doc('ecg', { LVEF: '58%', QTc: '430 ms' })] } as never),
      'cardiac',
    );
    expect(item?.summary).toContain('LVEF 58%');
    expect(item?.summary).not.toContain('58%%');
  });

  /** The parser reads 「限制性通气功能障碍」 off a Chinese report and
   *  stores `restrictive`; printing that back to the patient is this
   *  platform translating a Chinese report into English for a Chinese
   *  reader. */
  it('肺功能：通气模式用中文，不是 wire enum', () => {
    const item = itemFor(
      base({
        documents: [
          doc('pulmonary_function', { ventilatoryPattern: 'restrictive', fvcPredPct: '62' }),
        ],
      } as never),
      'respiratory',
    );
    expect(item?.summary).toContain('限制性通气功能障碍');
    expect(item?.summary).not.toContain('restrictive');
    expect(item?.summary).toContain('FVC 占预计值 62%');
  });

  it('肺功能：没收录的取值原样透出，不吞掉', () => {
    const item = itemFor(
      base({
        documents: [doc('pulmonary_function', { ventilatoryPattern: 'something_new' })],
      } as never),
      'respiratory',
    );
    expect(item?.summary).toContain('something_new');
  });
});

/**
 * THE 血检指标 ROW IS BUILT FROM A DOCUMENT THAT HAS BLOOD IN IT.
 *
 * `latestBlood` picked the newest document among ten classified types —
 * one of which is 腹部超声 — and the row was built from that ONE
 * document with no fallback. So an abdominal ultrasound uploaded after
 * a biochemistry panel took the slot, produced no CK, and blanked the
 * row. Worse than blank: a document id HAD been found, so `state` came
 * out `unreadable`, and the passport went from printing the patient's
 * real CK to telling a reader their panel could not be read. The panel
 * was fine and still on file.
 */
describe('血检指标：挑的是真的有血检值的那份报告', () => {
  const doc = (
    id: string,
    documentType: string,
    uploadedAt: string,
    fields: Record<string, string>,
  ) => parsedDoc(documentType, fields, { id, uploadedAt });

  const panel = doc('d-blood', 'biochemistry', '2026-03-01T00:00:00.000Z', {
    creatineKinase: '980 U/L',
    LDH: '310 U/L',
  });
  const ultrasound = doc('d-us', 'abdominal_ultrasound', '2026-03-05T00:00:00.000Z', {
    impressionText: '肝胆胰脾未见明显异常',
  });

  it('后传的腹部超声不会清空前面的生化结果', () => {
    const item = itemFor(base({ documents: [panel, ultrasound] } as never), 'blood');
    expect(item?.summary).toContain('CK 980 U/L');
    expect(item?.summary).toContain('LDH 310 U/L');
    // And the state must not accuse the panel of being unreadable.
    expect(item?.state).toBe('present');
  });

  it('腹部超声本身带 CK 时仍然算数', () => {
    // The type list is broad on purpose; the filter is on the FIELD, so
    // breadth is kept rather than traded away.
    const usWithCk = doc('d-us2', 'abdominal_ultrasound', '2026-03-05T00:00:00.000Z', {
      creatineKinase: '640 U/L',
    });
    expect(itemFor(base({ documents: [usWithCk] } as never), 'blood')?.summary).toContain(
      'CK 640 U/L',
    );
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE LABORATORY SAID MORE THAN THE NUMBER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A muscle-enzyme row prints three things — the analyte, the value, and
 * the laboratory's own verdict on that value against its own interval —
 * and the parser reads all three. `buildMonitoringSummary` read the
 * first two, so a CK of 693 against a stated upper limit of 310 printed
 * 「CK 693」, in the same words and the same weight a CK of 90 would
 * print, on the row that goes into the referral pack, onto the share
 * page a clinician opens, and onto the PDF the patient hands over.
 *
 * SYNTHETIC. The payload below is shaped like the one
 * `services/ocr/embedded-report-ocr.ts` writes from a parse of
 * 「*14肌酸激酶(CK) 693 ↑ 50-310 U/L」 — the row quoted in that file's own
 * flag/interval note. No real patient's report was read.
 */
describe('血检指标：报告标了异常，这一栏就得说', () => {
  const bloodReport = (fields: Record<string, string>, uploadedAt = '2026-07-01T00:00:00.000Z') =>
    ({
      id: 'lab-1',
      documentType: 'muscle_enzyme',
      title: null,
      fileName: 'ck.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1,
      storageUri: 'local://ck',
      status: 'parsed',
      uploadedAt,
      checksum: null,
      submissionId: null,
      ocrPayload: {
        fields: { classifiedType: 'muscle_enzyme', documentType: 'muscle_enzyme', ...fields },
      },
    }) as unknown as PatientProfileDTO['documents'][number];

  const bloodSummaryFor = (fields: Record<string, string>) =>
    itemFor(base({ documents: [bloodReport(fields)] } as never), 'blood')?.summary ?? '';

  it('印出偏高和参考区间，不再让一个 2.2 倍上限的 CK 长得像正常值', () => {
    expect(bloodSummaryFor({ ck: '693', ckFlag: 'high', ckReference: '50-310' })).toBe(
      'CK 693（偏高，参考区间 50-310）',
    );
  });

  it('只有标记没有区间时也照说 —— 那仍然是化验室自己的判断', () => {
    expect(bloodSummaryFor({ ck: '693', ckFlag: 'high' })).toBe('CK 693（偏高）');
  });

  it('只有区间没有标记时印出区间 —— 让读的人自己核对，而不是让他相信', () => {
    expect(bloodSummaryFor({ ck: '120', ckReference: '50-310' })).toBe('CK 120（参考区间 50-310）');
  });

  it('两样都没有的行和以前一模一样', () => {
    expect(bloodSummaryFor({ ck: '120' })).toBe('CK 120');
  });

  it('本平台读不懂的标记不印 —— 不替化验室改写它的判断', () => {
    expect(bloodSummaryFor({ ck: '693', ckFlag: 'critically_elevated' })).toBe('CK 693');
  });

  /**
   * The bridge writes the flag under the CAMEL spelling only while the
   * value is on the payload under both, so a value picked off the snake
   * key has to find its own siblings. Reading them off a second key
   * list would let one report's flag land beside another report's
   * value; `pickLabReading` is what makes it the same cell.
   */
  it('值从蛇形拼写上读到时，标记仍然跟着它 —— 桥只写驼峰那一个', () => {
    expect(bloodSummaryFor({ uric_acid: '520', uricAcidFlag: 'high' })).toBe('UA 520（偏高）');
  });

  it('每一项自己带自己的标记，不会串到隔壁那一项上', () => {
    expect(bloodSummaryFor({ ck: '693', ckFlag: 'high', ldh: '210' })).toBe(
      'CK 693（偏高），LDH 210',
    );
  });

  /**
   * ════════════════════════════════════════════════════════════════
   * THE ARCHIVE, WHICH IS THE CASE THAT WAS ACTUALLY ON SCREEN.
   * ════════════════════════════════════════════════════════════════
   *
   * `BLOOD_METRICS` is headed by `creatineKinase`, and for the whole
   * life of this archive the bridge minted that key as a VALUE-ONLY
   * twin of `ck` — the marker stayed under `ckFlag`. So the picker took
   * the twin, found no siblings beside it, and printed the row bare:
   * every stored document in this deployment, on the passport, the
   * share page, the referral pack and the PDF. The bridge writes the
   * twin's siblings now, but nothing reparses what is already on disk,
   * so the READ side has to cross the spelling — and every key in one
   * spec's list is a spelling of the same cell on the same document,
   * which is what makes that safe.
   */
  it('归档载荷：值在 creatineKinase 上、标记在 ckFlag 上，也要印出来', () => {
    expect(
      bloodSummaryFor({
        ck: '693U/L',
        ckFlag: 'high',
        ckReference: '50-310',
        creatineKinase: '693U/L',
      }),
    ).toBe('CK 693U/L（偏高，参考区间 50-310）');
  });

  /** The same crossing where the twin is the ONLY spelling holding the
   *  value — an archived payload whose `ck` was hand-corrected away, or
   *  one written before the parser named the cell. */
  it('归档载荷：只有 twin 带值时，标记仍从解析器那个拼写上找回来', () => {
    expect(bloodSummaryFor({ ckFlag: 'high', creatineKinase: '693U/L' })).toBe('CK 693U/L（偏高）');
  });

  /**
   * AND THE CROSSING STOPS AT A DISAGREEMENT.
   *
   * Two spellings of one cell holding different numbers is the state
   * `withholdUnsafeReadings` calls `contradictory_aliases` — the payload
   * does not know what the laboratory printed. A marker read across that
   * gap would be a verdict attached to a number it was not about, so the
   * value prints alone.
   */
  it('两个拼写的数不一样时不跨拼写取标记 —— 那是给错的数配了判断', () => {
    expect(bloodSummaryFor({ ck: '693U/L', ckFlag: 'high', creatineKinase: '96U/L' })).toBe(
      'CK 96U/L',
    );
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════
 * 报告日期 AND 上传日期 ARE NOT THE SAME DAY.
 * ══════════════════════════════════════════════════════════════════════
 *
 * See `PassportDateBasis` in profile.passport.ts. A report whose OCR
 * carried no 报告时间 is dated by the day it reached this platform, and
 * the badge beside it read 最新 either way — so 「this test is recent」
 * and 「we received this file recently」 were the same sentence.
 */
describe('最近日期：这一天是化验室写的，还是我们收到文件的那天', () => {
  const NOW = new Date('2026-08-05T00:00:00.000Z');

  const pulmonaryReport = (fields: Record<string, string>, uploadedAt: string) =>
    ({
      id: 'pft-1',
      documentType: 'pulmonary_function',
      title: null,
      fileName: 'pft.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1,
      storageUri: 'local://pft',
      status: 'parsed',
      uploadedAt,
      checksum: null,
      submissionId: null,
      ocrPayload: {
        fields: {
          classifiedType: 'pulmonary_function',
          documentType: 'pulmonary_function',
          ...fields,
        },
      },
    }) as unknown as PatientProfileDTO['documents'][number];

  const respiratoryFor = (fields: Record<string, string>, uploadedAt: string) =>
    buildClinicalPassportSummary(
      base({ documents: [pulmonaryReport(fields, uploadedAt)] } as never),
      NOW,
    ).monitoring.items.find((item) => item.key === 'respiratory');

  it('化验室写了报告时间时，那一天就是报告日期', () => {
    const item = respiratoryFor(
      { fvcPredPct: '78', reportTime: '2026-07-20' },
      '2026-08-01T00:00:00.000Z',
    );
    expect(item?.latestDate).toBe('2026-07-20');
    expect(item?.freshness.basis).toBe('report');
    expect(item?.freshness.label).toBe('最新');
  });

  /**
   * THE CASE THE BADGE WAS LYING ABOUT. A 2019 test uploaded last week
   * is 最新 by the only day this platform has, and the verdict is not
   * degraded — an upload day is a real bound and 过期 read off one
   * would be true. What was missing is the word saying which day it is.
   */
  it('没有报告时间时，那一天是上传日期，并且明说是上传日期', () => {
    const item = respiratoryFor({ fvcPredPct: '78' }, '2026-08-01T00:00:00.000Z');
    expect(item?.latestDate).toBe('2026-08-01');
    expect(item?.freshness.basis).toBe('upload');
    expect(item?.freshness.label).toBe('最新');
  });

  it('一天都没有时不认领任何一种 —— 那是在说本平台的记录，不是在说哪一天', () => {
    const item = buildClinicalPassportSummary(base(), NOW).monitoring.items.find(
      (entry) => entry.key === 'respiratory',
    );
    expect(item?.latestDate).toBeNull();
    expect(item?.freshness.basis).toBeNull();
    expect(item?.freshness.label).toBe('缺失');
  });

  it('导出的 markdown 把这个词印出来 —— 算了不给人看的判断等于没算', () => {
    const summary = buildClinicalPassportSummary(
      base({
        documents: [pulmonaryReport({ fvcPredPct: '78' }, '2026-08-01T00:00:00.000Z')],
      } as never),
      NOW,
    );
    const markdown = buildClinicalPassportExport(summary).markdown;
    expect(markdown).toContain('（2026-08-01 上传日期，最新）');
  });

  /**
   * The genetics slot was the one of the five that never asked for the
   * report's own day at all, and it is the longest-lived document on
   * this page: a laboratory report from 2019 is still the answer in
   * 2026, and dating it by the upload put 最新 on a seven-year-old test.
   */
  it('基因报告也读它自己的日期 —— 这一格以前只看上传时间', () => {
    const summary = buildClinicalPassportSummary(
      base({
        documents: [
          geneticReport(
            { d4z4Repeats: '3', haplotype: '4qA', reportTime: '2019-03-11' },
            {
              uploadedAt: '2026-07-30T00:00:00.000Z',
            },
          ),
        ],
      } as never),
      NOW,
    );
    expect(summary.diagnosis.latestSourceDate).toBe('2019-03-11');
    expect(summary.diagnosis.freshness.basis).toBe('report');
    expect(summary.diagnosis.freshness.label).toBe('过期');
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════
 * 一页两段的入院常规：手机上读得出，护照上说「没有」。
 * ══════════════════════════════════════════════════════════════════════
 *
 * An 入院常规 printout carries 血常规 and 尿常规 under their own
 * headings, and the parser reads both off it — `_classify_report` lands
 * on `blood_routine` (the page prints haemoglobin and platelets, so the
 * specimen rule that rescues a pure urine report cannot fire) and
 * `_split_blood_and_urine_sections` runs both extractors. The payload
 * reaches the phone with a WBC carrying the laboratory's own ↑ and the
 * interval it was read against, and 我的档案 → 血常规 shows it.
 *
 * The passport's 血检指标 row is built by picking a document that is
 * BOTH of a listed class AND carrying a listed analyte. `blood_routine`
 * was on the class list from the start; not one row of a blood count was
 * on the analyte list, which held six 生化/肌酶 cells. So no document
 * could be picked, `latestBloodDocumentId` stayed null, and
 * `buildMonitoringItem` read that as `absent` — 「本平台没有该类报告的
 * 记录」 in the referral pack a neurologist reads, 缺失 on the share
 * page a clinician opens, 还没有上传过…血检报告 on the summary card and
 * the same absence in the markdown export handed across a desk.
 *
 * All four surfaces are asserted here, because all four made the claim
 * and each renders the slot in its own words.
 */
describe('入院常规（血常规＋尿常规同页）：护照不能说这份报告不存在', () => {
  const NOW_2026 = new Date('2026-06-01T00:00:00.000Z');

  /** SYNTHETIC. Every reading invented; the shape is what
   *  `buildFields` writes — the value, its flag and its interval. */
  const admissionPanel = {
    id: 'd-admission',
    documentType: 'blood_panel',
    title: null,
    fileName: 'admission.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1,
    storageUri: 'local://admission',
    status: 'parsed',
    uploadedAt: '2026-05-13T00:00:00.000Z',
    checksum: null,
    submissionId: null,
    ocrPayload: {
      extractedText: '合成医院 入院常规 血常规 尿常规',
      fields: {
        documentType: 'blood_panel',
        classifiedType: 'blood_routine',
        reportTypeLabel: '血常规报告',
        reportTime: '2026-05-12',
        wbc: '14.2 10^9/L',
        wbcFlag: 'high',
        wbcReference: '3.5-9.5',
        hgb: '121 g/L',
        hgbReference: '115-150',
        plt: '232 10^9/L',
        pltReference: '125-350',
        urineProtein: '+1',
        urineOccultBlood: '阴性',
      },
    },
  };

  const profile = () => base({ documents: [admissionPanel] } as never);

  it('槽位状态是 present，不是 absent', () => {
    const item = itemFor(profile(), 'blood');
    expect(item?.state).toBe('present');
    expect(item?.available).toBe(true);
    expect(item?.latestDocumentId).toBe('d-admission');
  });

  it('实验室自己标的异常跟着数值一起印出来', () => {
    // The one thing a clinician opens this row to see. 「WBC 14.2」 in
    // the same words a normal count would print is the defect the
    // flag/interval pair was added for.
    const summary = itemFor(profile(), 'blood')?.summary ?? '';
    expect(summary).toContain('WBC 14.2 10^9/L');
    expect(summary).toContain('偏高');
    expect(summary).toContain('参考区间 3.5-9.5');
  });

  it('尿常规的行不会当成血检读数印出来', () => {
    // The page carries both panels. 血检指标 reports on the blood one;
    // a urine sediment reading published as a blood result is the
    // defect the parser's own specimen rule exists to prevent, and it
    // must not be reintroduced from this end.
    const summary = itemFor(profile(), 'blood')?.summary ?? '';
    expect(summary).not.toContain('尿');
  });

  it('核心摘要卡不再说「还没有上传过…血检报告」', () => {
    const card = buildClinicalPassportSummary(profile(), NOW_2026).summaryCards.find(
      (c) => c.key === 'monitoring',
    );
    expect(card?.summary).not.toContain('还没有上传过');
    expect(card?.ready).toBe(true);
  });

  it('markdown 导出的系统监测一节印的是读数和报告日期', () => {
    const markdown = buildClinicalPassportExport(
      buildClinicalPassportSummary(profile(), NOW_2026),
    ).markdown;
    const section = markdown.split('## 系统监测')[1]?.split('\n## ')[0] ?? '';
    expect(section).toContain('WBC 14.2 10^9/L');
    expect(section).toContain('2026-05-12 报告日期');
  });

  it('转诊包不说「本平台没有该类报告的记录」', () => {
    const slot = buildReferralPack(profile(), NOW_2026).monitoring.find(
      (item) => item.key === 'blood',
    );
    expect(slot?.state).toBe('present');
    expect(slot?.statement).not.toContain('没有该类报告的记录');
    expect(slot?.statement).toContain('WBC 14.2 10^9/L');
  });

  it('分享页的检查结果一节印的是读数，不是缺失', () => {
    const html = buildPassportSharePage(buildClinicalPassportSummary(profile(), NOW_2026), {
      expiresAt: '2026-06-08T00:00:00.000Z',
    });
    expect(html).toContain('WBC 14.2 10^9/L');
    expect(html).not.toContain('暂无可自动读取的血检结果');
  });

  /**
   * The same defect, one class over. 甲功 and 凝血 are on the class list
   * too and had no analytes on the reading list either, so a patient
   * whose only laboratory upload is one of those got the same denial.
   * 尿常规 / 感染筛查 / 粪便 / 腹部超声 stay off the reading list on
   * purpose — they are on the class list as possible carriers of a blood
   * analyte, not as panels this row reports on.
   */
  it.each([
    [
      'thyroid_function',
      { tsh: '6.8 mIU/L', tshFlag: 'high', tshReference: '0.55-4.78' },
      'TSH 6.8 mIU/L',
    ],
    ['coagulation', { aptt: '44.1 s', apttFlag: 'high', apttReference: '25-38' }, 'APTT 44.1 s'],
  ] as const)('%s 也读得出来', (classifiedType, fields, expected) => {
    const item = itemFor(
      base({
        documents: [
          {
            ...admissionPanel,
            id: `d-${classifiedType}`,
            ocrPayload: {
              extractedText: '合成医院 检验报告单',
              fields: { classifiedType, reportTime: '2026-05-12', ...fields },
            },
          },
        ],
      } as never),
      'blood',
    );
    expect(item?.state).toBe('present');
    expect(item?.summary).toContain(expected);
  });
});
