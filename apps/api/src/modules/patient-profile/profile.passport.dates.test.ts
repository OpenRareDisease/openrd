import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { applyAdminBaselineWrite } from './baseline-provenance.js';
import { buildPassportSharePage } from './passport-share.html.js';
import { buildClinicalPassportExport, buildClinicalPassportSummary } from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';
import { buildReferralPack } from './referral-pack.js';

/**
 * ONE PROFILE, ONE CLOCK, THREE DOCUMENTS, ONE DATE PER RECORD.
 *
 * The markdown export, the share page and the referral pack are built
 * from the same summary in the same request and are meant to be read
 * side by side — the patient downloads the markdown, opens the share
 * link on the clinician's screen, and hands over the pack. Every one of
 * them prints 生成时间, 最近更新, the same 最近来源 rows and the same
 * 「不是本人填写」 list.
 *
 * The export interpolated the summary's RAW ISO INSTANTS while the
 * other two put the same values through a calendar-date formatter. Two
 * failures at once:
 *
 *   - a machine timestamp with a Z suffix —「2026-02-10T18:00:00.000Z」—
 *     in a markdown file a patient downloads and gives to a doctor;
 *   - under any process timezone east of UTC, a DIFFERENT DAY from the
 *     other two documents for the same record. referral-pack.ts says in
 *     as many words why that is the failure to avoid: 「two documents
 *     from one app disagreeing about the date of one report is a worse
 *     failure in front of a clinician than both being off by the same
 *     day」.
 *
 * FIXTURE TIMESTAMPS ARE 18:00 UTC, NOT MIDDAY. Midday absorbs every
 * real offset, which is what the other suites in this module want and
 * exactly what this one must not have: 18:00Z is the previous calendar
 * day in America/Los_Angeles and the next one in Asia/Shanghai, so a
 * renderer that skips the formatter cannot hide.
 */
const T = (day: string) => `${day}T18:00:00.000Z`;

const ADMIN_ID = '11111111-2222-4333-8444-555555555555';

/** 生成时间 for all three documents. Injected rather than read off the
 *  wall clock so that any disagreement below is a FORMATTER
 *  disagreement and never a difference in when the document was made. */
const NOW = new Date(T('2026-03-06'));

const adminBaseline = applyAdminBaselineWrite(
  {},
  { foundation: { diagnosisYear: 2019 } },
  { adminUserId: ADMIN_ID, at: new Date(T('2026-01-15')) },
);

const profile = (): PatientProfileDTO =>
  ({
    id: 'p1',
    userId: 'u1',
    fullName: '张三',
    preferredName: null,
    dateOfBirth: '1990-01-01',
    gender: 'male',
    patientCode: 'P0001',
    diagnosisStage: null,
    diagnosisDate: '2019-05-03',
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
    baseline: adminBaseline,
    notes: null,
    measurements: [
      {
        id: 'm1',
        muscleGroup: 'deltoid',
        side: 'left',
        strengthScore: '4',
        romDegrees: null,
        notes: null,
        recordedAt: T('2026-03-02'),
        createdAt: T('2026-03-02'),
      },
    ],
    functionTests: [],
    symptomScores: [],
    dailyImpacts: [],
    followupEvents: [],
    activityLogs: [
      {
        id: 'a1',
        activityType: 'exercise',
        content: '走了二十分钟',
        logDate: T('2026-03-04'),
        createdAt: T('2026-03-04'),
      },
    ],
    documents: [
      {
        id: 'doc-gene',
        documentType: 'genetic_report',
        title: null,
        fileName: 'g.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1,
        storageUri: 'local://g',
        status: 'parsed',
        uploadedAt: T('2026-02-10'),
        checksum: null,
        submissionId: null,
        ocrPayload: {
          fields: {
            classifiedType: 'genetic_report',
            d4z4RepeatCount: '5',
            haplotype: '4qA',
            diagnosisDate: '2019-05-03',
          },
        },
      },
      {
        id: 'doc-mri',
        documentType: 'mri_report',
        title: null,
        fileName: 'mri.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1,
        storageUri: 'local://mri',
        status: 'parsed',
        uploadedAt: T('2026-02-12'),
        checksum: null,
        submissionId: null,
        ocrPayload: { fields: { classifiedType: 'mri_report', conclusion: '双侧大腿受累' } },
      },
      {
        id: 'doc-pft',
        documentType: 'other',
        title: '肺功能报告',
        fileName: 'pft.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1,
        storageUri: 'local://pft',
        status: 'parsed',
        uploadedAt: T('2026-02-14'),
        checksum: null,
        submissionId: null,
        ocrPayload: { fields: { classifiedType: 'pulmonary_function', fvc: '82%' } },
      },
    ],
    medications: [],
    createdAt: T('2026-01-01'),
    updatedAt: T('2026-03-05'),
  }) as unknown as PatientProfileDTO;

/**
 * `process.env.TZ` is honoured by Node for every `Date` created after
 * it is assigned, which is what lets one suite render the same fixture
 * in Shanghai and in Los Angeles. Restored afterwards so this file
 * cannot leak a timezone into whatever runs next in the same worker.
 */
const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const build = (timeZone: string) => {
  process.env.TZ = timeZone;
  const summary = buildClinicalPassportSummary(profile(), NOW);
  return {
    summary,
    exported: buildClinicalPassportExport(summary),
    pack: buildReferralPack(profile(), NOW),
    share: buildPassportSharePage(summary, { expiresAt: T('2026-03-20') }),
  };
};

/** Every 最近来源 row's date, in the order the document prints them. */
const exportTimelineDates = (markdown: string) =>
  [...markdown.matchAll(/^- \[[^\]]+\] .*?（([^）]*)）：/gmu)].map((m) => m[1]);

const shareTimelineDates = (html: string) =>
  [...html.matchAll(/tl-date">([^<]*)</g)].map((m) => m[1]);

const line = (markdown: string, label: string) =>
  markdown.split('\n').find((row) => row.startsWith(`- ${label}：`)) ?? '';

const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/g;

describe.each(['Asia/Shanghai', 'America/Los_Angeles'])(
  'passport dates under TZ=%s',
  (timeZone) => {
    let built: ReturnType<typeof build>;

    beforeEach(() => {
      built = build(timeZone);
    });

    it('prints no machine timestamp anywhere in the markdown a patient downloads', () => {
      // Not a spot check on the three known lines: a Z-suffixed instant
      // is never a thing to show a patient or a clinician, so the whole
      // document is the assertion.
      expect(built.exported.markdown.match(ISO_INSTANT) ?? []).toEqual([]);
    });

    it('agrees with the share page and the referral pack on 生成时间', () => {
      const day = built.summary.generatedAt.slice(0, 10);
      const expected =
        timeZone === 'Asia/Shanghai'
          ? '2026-03-07' // 2026-03-06T18:00Z is already the 7th in Beijing
          : '2026-03-06';
      // The instant is one instant; only the calendar day it lands on
      // moves. Guarding the raw field too, because 生成时间 reading the
      // wall clock instead of the injected one is the other half of the
      // defect and would still print a plausible day.
      expect(day).toBe('2026-03-06');
      expect(line(built.exported.markdown, '生成时间')).toBe(`- 生成时间：${expected}`);
      expect(built.pack.markdown).toContain(`- 生成时间：${expected}`);
      expect(built.share).toContain(`生成时间 ${expected}`);
    });

    it('agrees with the referral pack on 最近更新', () => {
      const expected = timeZone === 'Asia/Shanghai' ? '2026-03-06' : '2026-03-05';
      expect(line(built.exported.markdown, '最近更新')).toBe(`- 最近更新：${expected}`);
      expect(built.pack.markdown).toContain(`- 平台内最近更新：${expected}`);
    });

    it('prints the same 最近来源 days, in the same order, as the share page', () => {
      const dates = exportTimelineDates(built.exported.markdown);
      expect(dates.length).toBeGreaterThan(0);
      expect(dates).toEqual(shareTimelineDates(built.share));
      expect(dates).toEqual(
        timeZone === 'Asia/Shanghai'
          ? ['2026-03-05', '2026-03-03', '2026-02-15', '2026-02-13', '2026-02-11']
          : ['2026-03-04', '2026-03-02', '2026-02-14', '2026-02-12', '2026-02-10'],
      );
    });

    it('prints the administrator entry date the way the share page does', () => {
      const expected = timeZone === 'Asia/Shanghai' ? '2026-01-16' : '2026-01-15';
      expect(built.exported.markdown).toContain(`本平台管理员于 ${expected} 代为录入`);
      expect(built.share).toContain(`本平台管理员于 ${expected} 代为录入`);
    });

    it('reports the generation instant it actually rendered', () => {
      // Was a third reading of the wall clock, so the DTO field and the
      // 生成时间 line were two different moments stated as one.
      expect(built.exported.generatedAt).toBe(built.summary.generatedAt);
      expect(built.exported.generatedAt).toBe(NOW.toISOString());
    });
  },
);

describe('the summary clock', () => {
  it('is the injected one, so two documents from one generation cannot disagree', () => {
    process.env.TZ = 'Asia/Shanghai';
    const summary = buildClinicalPassportSummary(profile(), NOW);
    expect(summary.generatedAt).toBe(NOW.toISOString());
    // Same profile, same clock, twice — byte-identical, which is what
    // makes 生成时间 comparable across the documents at all.
    expect(buildClinicalPassportSummary(profile(), NOW).generatedAt).toBe(summary.generatedAt);
  });

  it('still falls back to the wall clock for callers that pass nothing', () => {
    const before = Date.now();
    const generated = Date.parse(buildClinicalPassportSummary(profile()).generatedAt);
    expect(generated).toBeGreaterThanOrEqual(before);
    expect(generated).toBeLessThanOrEqual(Date.now());
  });
});
