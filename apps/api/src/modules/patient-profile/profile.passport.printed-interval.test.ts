/**
 * ══════════════════════════════════════════════════════════════════════
 * A READING OUTSIDE THE INTERVAL THE REPORT ITSELF PRINTED, ON A ROW THE
 * LABORATORY DID NOT MARK.
 * ══════════════════════════════════════════════════════════════════════
 *
 * 「CK 693（参考区间 50-310）」 was the whole row — on the passport, on
 * the share page a clinician opens from a link, in the referral pack
 * handed across a desk and in the markdown export a patient downloads.
 * A value at 2.2× the upper limit of the interval printed two
 * characters to its right, and nothing anywhere on the sheet saying the
 * two do not fit. The laboratory's own 提示 column was blank on that
 * row, so there was no flag to localise and this platform said nothing.
 *
 * SAYING NOTHING THERE IS NOT NEUTRALITY. The read-path guard in
 * profile.service.ts has already run this exact comparison and filed it
 * as `outside_reference_interval`; printing the two numbers side by side
 * and stopping asks the reader to redo arithmetic this product did.
 *
 * WHAT MAY BE SAID, AND IN WHOSE VOICE. Not 偏高 — that is the
 * laboratory's word for the laboratory's own verdict. The clause is in
 * the first person, behind a semicolon that separates it from
 * everything the report wrote, and it carries no severity: 「报告未标注
 * 异常，本平台比对：高于该区间」. It appears only where the row was
 * unmarked, and only in the outside direction — an 「in range」 note
 * would be a clean bill this platform has always refused to issue.
 *
 * ALL FOUR SURFACES AT ONCE. They are asserted here in one file because
 * they are one string: the share page, the referral pack and the
 * markdown export all print `monitoring.items[].summary`, which
 * `buildMonitoringSummary` composes. A surface that grew its own
 * bracket would fail these.
 *
 * SYNTHETIC. Every payload below was written for this file, shaped like
 * the ones services/ocr/embedded-report-ocr.ts writes. No real
 * patient's report was read.
 */

import { describe, expect, it } from 'vitest';

import { buildPassportSharePage } from './passport-share.html.js';
import {
  buildClinicalPassportExport,
  buildClinicalPassportSummary,
  compareWithPrintedInterval,
} from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';
import { buildReferralPack } from './referral-pack.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');

const labReport = (fields: Record<string, string>) =>
  ({
    id: 'lab-1',
    documentType: 'muscle_enzyme',
    title: null,
    fileName: 'panel.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1,
    storageUri: 'local://panel',
    status: 'parsed',
    uploadedAt: '2026-08-01T00:00:00.000Z',
    checksum: null,
    submissionId: null,
    ocrPayload: {
      fields: {
        classifiedType: 'muscle_enzyme',
        documentType: 'muscle_enzyme',
        reportTime: '2026-07-30',
        ...fields,
      },
    },
  }) as unknown as PatientProfileDTO['documents'][number];

const profileWith = (fields: Record<string, string>): PatientProfileDTO =>
  ({
    id: 'p1',
    userId: 'u1',
    fullName: '测试用例',
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
    documents: [labReport(fields)],
    medications: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as unknown as PatientProfileDTO;

const bloodRowFor = (fields: Record<string, string>) =>
  buildClinicalPassportSummary(profileWith(fields), NOW).monitoring.items.find(
    (item) => item.key === 'blood',
  )?.summary ?? '';

const UNMARKED_HIGH = { ck: '693', ckReference: '50-310' };

describe('化验室没标、但超出它自己印的区间的数值', () => {
  it('护照说出来了 —— 并且说清楚是本平台在比对，不是化验室在判', () => {
    expect(bloodRowFor(UNMARKED_HIGH)).toBe(
      'CK 693（参考区间 50-310；报告未标注异常，本平台比对：高于该区间）',
    );
  });

  it('低于下限时说低于，方向不会说反', () => {
    expect(bloodRowFor({ ck: '18', ckReference: '50-310' })).toBe(
      'CK 18（参考区间 50-310；报告未标注异常，本平台比对：低于该区间）',
    );
  });

  /**
   * 「<25」 is the whole of what a CKMB row prints, and it is still an
   * interval a number can be outside of. `<` excludes its own limit and
   * `≤` does not — collapsing the two would put a reading sitting
   * exactly on the limit on the wrong side of it.
   */
  it('单边上限也算区间：<25 上的 30 是高于', () => {
    expect(bloodRowFor({ ckmb: '30', ckmbReference: '<25' })).toBe(
      'CKMB 30（参考区间 <25；报告未标注异常，本平台比对：高于该区间）',
    );
  });

  it('单边下限也算区间：>9 上的 4 是低于', () => {
    expect(bloodRowFor({ ldh: '4', ldhReference: '>9' })).toBe(
      'LDH 4（参考区间 >9；报告未标注异常，本平台比对：低于该区间）',
    );
  });

  /**
   * THE LABORATORY'S OWN WORD WINS WHERE IT WROTE ONE. A second opinion
   * beside a first one is noise at best and a contradiction at worst,
   * and 偏高 already says the thing this platform would be adding.
   */
  it('化验室自己标了的行完全不变 —— 本平台不在旁边再判一次', () => {
    expect(bloodRowFor({ ck: '693', ckFlag: 'high', ckReference: '50-310' })).toBe(
      'CK 693（偏高，参考区间 50-310）',
    );
  });

  /**
   * 「在区间内」 would be this platform issuing a clean bill on a
   * laboratory row. The interval alone is what lets a reader check for
   * themselves, and that is where this stops.
   */
  it('区间内的数值一个字都不多说', () => {
    expect(bloodRowFor({ ck: '120', ckReference: '50-310' })).toBe('CK 120（参考区间 50-310）');
  });

  it('没有区间可比的行和以前一模一样', () => {
    expect(bloodRowFor({ ck: '693' })).toBe('CK 693');
  });

  it('一行说了不影响隔壁那一行', () => {
    expect(
      bloodRowFor({
        ck: '693',
        ckReference: '50-310',
        ldh: '319',
        ldhFlag: 'high',
        ldhReference: '120-250',
        creatinine: '72',
        creatinineReference: '57-97',
      }),
    ).toBe(
      'CK 693（参考区间 50-310；报告未标注异常，本平台比对：高于该区间），' +
        'LDH 319（偏高，参考区间 120-250），Cr 72（参考区间 57-97）',
    );
  });
});

/**
 * The four documents are built off one summary, so the clause reaching
 * one of them and not another would mean a surface had grown its own
 * bracket. That is the failure this describe exists to catch.
 */
describe('四个面都拿到同一句话', () => {
  const summary = buildClinicalPassportSummary(profileWith(UNMARKED_HIGH), NOW);
  const CLAUSE = '报告未标注异常，本平台比对：高于该区间';

  it('markdown 导出', () => {
    const line = buildClinicalPassportExport(summary)
      .markdown.split('\n')
      .find((row) => row.startsWith('- 血检指标'));
    expect(line).toContain('CK 693（参考区间 50-310；' + CLAUSE + '）');
  });

  it('分享页', () => {
    const html = buildPassportSharePage(summary, { viaPickup: true });
    expect(html).toContain('CK 693（参考区间 50-310；' + CLAUSE + '）');
  });

  it('转诊包', () => {
    const slot = buildReferralPack(profileWith(UNMARKED_HIGH), NOW).monitoring.find(
      (item) => item.key === 'blood',
    );
    expect(slot?.statement).toContain('CK 693（参考区间 50-310；' + CLAUSE + '）');
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE COMPARISON REFUSES EVERYTHING IT CANNOT PLACE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This output becomes a sentence about a patient's laboratory result. A
 * guess here would be a sentence about a patient's laboratory result
 * that nobody checked, so every unreadable shape answers null and the
 * row prints exactly as it stands.
 */
describe('比不了的就不比', () => {
  it('区间内 / 区间外 / 边界，两侧闭合', () => {
    expect(compareWithPrintedInterval('50', '50-310')).toBeNull();
    expect(compareWithPrintedInterval('310', '50-310')).toBeNull();
    expect(compareWithPrintedInterval('49.9', '50-310')).toBe('below');
    expect(compareWithPrintedInterval('310.1', '50-310')).toBe('above');
  });

  it('「<」 排除自己的界，「≤」 不排除', () => {
    expect(compareWithPrintedInterval('25', '<25')).toBe('above');
    expect(compareWithPrintedInterval('25', '≤25')).toBeNull();
    expect(compareWithPrintedInterval('9', '>9')).toBe('below');
    expect(compareWithPrintedInterval('9', '≥9')).toBeNull();
  });

  it('数值本身是一个单边界限时不比 —— 那是检出限，不是一个能落在区间上的数', () => {
    expect(compareWithPrintedInterval('<0.01', '0.05-0.5')).toBeNull();
  });

  it('定性结果不比', () => {
    expect(compareWithPrintedInterval('阴性', '阴性')).toBeNull();
    expect(compareWithPrintedInterval('阳性', '0-1')).toBeNull();
  });

  it('读不出来的区间不比', () => {
    expect(compareWithPrintedInterval('693', '正常')).toBeNull();
    expect(compareWithPrintedInterval('693', '50-310 U/L')).toBeNull();
    expect(compareWithPrintedInterval('693', '')).toBeNull();
    expect(compareWithPrintedInterval('693', null)).toBeNull();
  });

  it('上下界颠倒的区间不比 —— 那份报告的这一格本身读错了', () => {
    expect(compareWithPrintedInterval('693', '310-50')).toBeNull();
  });

  /** The unit is glued to the value and the interval never carries one:
   *  they are two cells of the SAME row, so the number at the head of
   *  the value is the number to place. */
  it('值上粘着单位时读它开头的那个数', () => {
    expect(compareWithPrintedInterval('693U/L', '50-310')).toBe('above');
    expect(compareWithPrintedInterval('5.2×10⁹/L', '3.5-9.5')).toBeNull();
  });

  /** 「3,250」 is one number; a scan that stopped at the first group
   *  would read 3 and call a grossly raised CK 「low」. */
  it('带千分位的数是一个数，不是 3', () => {
    expect(compareWithPrintedInterval('3,250', '50-310')).toBe('above');
  });

  /** A result cell holding an interval is the reference column landing
   *  in the wrong column — placing its low end would be comparing a
   *  number nobody measured. */
  it('结果格里装的是一个区间时不比', () => {
    expect(compareWithPrintedInterval('0.5-1.2', '50-310')).toBeNull();
    expect(compareWithPrintedInterval('120-250', '50-310')).toBeNull();
  });
});
