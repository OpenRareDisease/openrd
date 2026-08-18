import { describe, expect, it } from 'vitest';

import { buildClinicalPassportExport, buildClinicalPassportSummary } from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';

/**
 * 平均肌力 — the number, not the cells it is averaged from.
 *
 * `parseScore` reads an MMT cell OCR'd off an uploaded 体格检查 /
 * 肌力评估 report, and the resulting average is printed as this
 * patient's 平均肌力 on the passport tile, in the markdown export's
 * 运动功能 section, on the share page and in the referral pack's motor
 * row. A clinician reads it as a measurement.
 *
 * IT READ A RANGE AS A COUNT. The parser took the first number in the
 * cell and any following 「+」/「-」 as the MRC modifier, so an examiner's
 * 「三角肌4-5级」 — a refusal to choose between 4 and 5 — came out 3.7,
 * and 「3-4级」 came out 2.7: BELOW both bounds of the interval it was
 * read off. That is the same defect `parseD4Z4Reading` carries its bound
 * class for, one cell type over, and in the same direction — a number
 * nobody measured, printed as a measurement, and biased toward more
 * weakness than the examiner recorded.
 *
 * The cell itself is still printed verbatim in `motor.summary`. What a
 * range loses is its vote in the average.
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

const exam = (fields: Record<string, string>) => ({
  id: 'd-exam',
  documentType: 'physical_exam',
  title: null,
  fileName: 'exam.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1,
  storageUri: 'local://exam',
  status: 'parsed',
  uploadedAt: '2026-02-01T00:00:00.000Z',
  checksum: null,
  submissionId: null,
  ocrPayload: { fields: { classifiedType: 'physical_exam', ...fields } },
});

const averageFor = (cell: string) =>
  buildClinicalPassportSummary(base({ documents: [exam({ deltoidStrength: cell })] } as never))
    .motor.average;

describe('MMT 单元格：区间不是计数', () => {
  it.each([
    ['4-5级', '连字符区间'],
    ['3-4级', '连字符区间，读出来比两端都低'],
    ['2~3级', '波浪区间'],
    ['2～3级', '全角波浪区间'],
    ['4 至 5 级', '中文区间'],
    ['3到4级', '中文区间'],
  ])('%s（%s）不产生平均值', (cell) => {
    expect(averageFor(cell)).toBe('—');
  });

  it('区间照常原样印在摘要里 —— 丢掉的是它在平均值里的一票', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [exam({ deltoidStrength: '4-5级' })] } as never),
    );
    expect(summary.motor.summary).toContain('4-5级');
    expect(summary.motor.average).toBe('—');
    // 有报告可看，这一栏就不是空的。
    expect(summary.motor.ready).toBe(true);
  });

  it('导出里也不出现那个没人测过的数', () => {
    const { markdown } = buildClinicalPassportExport(
      buildClinicalPassportSummary(
        base({ documents: [exam({ deltoidStrength: '3-4级' })] } as never),
      ),
    );
    expect(markdown).toContain('- 平均肌力：— 级');
    expect(markdown).not.toContain('2.7');
  });
});

describe('MMT 单元格：MRC 的 ± 仍然是 ±', () => {
  it.each([
    ['4级', '4.0'],
    ['4+', '4.3'],
    ['4-', '3.7'],
    ['5-', '4.7'],
    ['0级', '0.0'],
    // 4 out of 5 —— 分数线不是区间号，这是最常见的单个等级写法。
    ['4/5', '4.0'],
  ])('%s → %s', (cell, expected) => {
    expect(averageFor(cell)).toBe(expected);
  });

  it('全角的 ＋ 和半角的 + 是同一个记号 —— 体检单是全角输入法打的', () => {
    expect(averageFor('4＋')).toBe(averageFor('4+'));
    expect(averageFor('4－')).toBe(averageFor('4-'));
  });
});

describe('App 内录入的肌力不受影响', () => {
  const measurement = (score: number, muscleGroup: string) => ({
    id: `m-${muscleGroup}`,
    muscleGroup,
    metricKey: null,
    bodyRegion: null,
    side: 'left',
    strengthScore: score,
    method: null,
    entryMode: 'manual',
    deviceUsed: null,
    notes: null,
    recordedAt: '2026-03-01T00:00:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
    submissionId: null,
  });

  it('结构化评分照常平均', () => {
    const summary = buildClinicalPassportSummary(
      base({ measurements: [measurement(2, 'deltoid'), measurement(5, 'biceps')] } as never),
    );
    expect(summary.motor.average).toBe('3.5');
  });
});
