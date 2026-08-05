import { describe, expect, it } from 'vitest';

import {
  buildClinicalPassportExport,
  buildClinicalPassportSummary,
  isLargeD4Z4Deletion,
} from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';

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

const geneticReport = (fields: Record<string, string>) => ({
  id: 'd1',
  documentType: 'genetic_report',
  title: null,
  fileName: 'g.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1,
  storageUri: 'local://g',
  status: 'parsed',
  uploadedAt: '2026-02-01T00:00:00.000Z',
  checksum: null,
  submissionId: null,
  ocrPayload: { fields: { classifiedType: 'genetic_report', ...fields } },
});

const stepTitles = (profile: PatientProfileDTO) =>
  buildClinicalPassportSummary(profile).nextSteps.map((step) => step.title);

const itemFor = (profile: PatientProfileDTO, key: 'blood' | 'respiratory' | 'cardiac') =>
  buildClinicalPassportSummary(profile).monitoring.items.find((item) => item.key === key);

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
    // the lab chose to print it.
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
      expect(isLargeD4Z4Deletion(raw)).toBe(false);
    });

    it.each([['1'], ['2'], ['3'], ['4'], ['3个']])('%s 触发', (raw) => {
      expect(isLargeD4Z4Deletion(raw)).toBe(true);
    });

    it('5 及以上不触发 —— 指南写的是 1–4 repeats', () => {
      expect(isLargeD4Z4Deletion('5')).toBe(false);
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
