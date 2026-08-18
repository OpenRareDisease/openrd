/**
 * @jest-environment ./test-support/west-of-utc-environment.js
 */

// The PDF builder reads `readPassportValueOrigins` out of api.ts, which
// pulls in AsyncStorage through session-storage, and that has no native
// module under jest. Same stub api-transport.test.ts uses.
jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

import { buildAnesthesiaCard } from '../anesthesia-card';
import type { ClinicalPassportSummary } from '../api';
import { buildClinicalPassportPdfHtml } from '../clinical-passport-pdf';
import { formatDateLabel } from '../clinical-visuals';
import { buildReportInsights } from '../report-insights';
import { buildSurveillanceSchedule } from '../surveillance-schedule';

/**
 * WEST OF UTC IS THE WHOLE POINT OF THIS FILE — see the docblock above,
 * and test-support/west-of-utc-environment.js for why it takes an
 * environment rather than a `process.env.TZ` assignment.
 *
 * The API hands calendar dates over as bare 「YYYY-MM-DD」 — every
 * monitoring slot's `latestDate`, `imaging.latestMriDate`, the
 * diagnosis date — because they come out of `date` columns and off
 * report pages, and a calendar day carries no instant and no zone.
 * `new Date('2025-05-09')` is UTC midnight, so reading it back with
 * `getMonth` / `getDate` gives the PREVIOUS DAY on every device west
 * of Greenwich. The mobile PDF is the sheet a clinician holds, and it
 * printed 05-08 for a report the passport share page and the API's own
 * markdown export both dated 05-09.
 *
 * China is UTC+8, so the product's own timezone can never show this.
 *
 * AN INSTANT IS NOW READ ON THE PRODUCT'S CALENDAR TOO, NOT THE
 * DEVICE'S. The values the API hands over that DO carry a time —
 * `generatedAt`, a timeline row's `timestamp`, the moment an
 * administrator typed a baseline field — used to be resolved here with
 * the device's zone, and the note above this file's instant case said
 * 「there a zone is exactly the right thing to apply」. A zone is; THIS
 * zone is not. The server resolved the same instants in its own zone,
 * and apps/api/Dockerfile sets no TZ while node:20-bookworm-slim runs
 * UTC — so against a handset in China the two were eight hours apart
 * and printed different DAYS for one report, on a sheet handed to the
 * clinician who is already looking at the share page. See
 * `PRODUCT_TIME_ZONE` in ../clinical-visuals and the four-document
 * comparison in apps/api's profile.passport.dates.test.ts.
 */
const DAY = '2025-05-09';

/**
 * An instant, not a calendar day.
 *
 * Chosen because the three zones give three different answers: 01-31 in
 * Los Angeles (which is where these tests run), 02-01 in UTC, and 02-01
 * in Asia/Shanghai. It is the product's calendar that decides, so the
 * answer is 02-01 on every device.
 */
const INSTANT = '2026-02-01T00:00:00.000Z';

/** Beijing midnight, so a shift in the wrong direction or of the wrong
 *  size cannot pass: 15:59:59.999Z is still the 8th in Shanghai. */
const BOUNDARY_BEFORE = '2026-02-08T15:59:59.999Z';
const BOUNDARY_AFTER = '2026-02-08T16:00:00.000Z';

const summary = {
  generatedAt: '2026-08-05T02:00:00.000Z',
  passportId: 'FSHD-TZ',
  patientName: '测试',
  hasRecordedData: true,
  latestUpdatedAt: DAY,
  completion: { completed: 1, total: 4 },
  metrics: [],
  summaryCards: [],
  diagnosis: {
    ready: false,
    confirmation: 'none',
    latestSourceDate: null,
    latestDocumentId: null,
    freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
    geneticType: '—',
    d4z4Repeats: '—',
    methylationValue: '—',
    diagnosisDate: DAY,
    geneEvidence: '—',
  },
  motor: {
    ready: false,
    average: '—',
    latestMeasurementAt: DAY,
    latestActivityAt: null,
    summary: '—',
    highlights: [],
    bodyRegions: {},
    activitySummary: '—',
  },
  imaging: {
    ready: true,
    latestMriDate: DAY,
    latestDocumentId: null,
    freshness: { label: '较新', tone: 'positive', date: null, daysSince: null },
    summary: '—',
    highlights: [],
    bodyRegions: {},
  },
  monitoring: {
    ready: true,
    items: [
      {
        key: 'respiratory',
        title: '肺功能',
        available: true,
        state: 'present',
        summary: 'FVC 78%',
        latestDate: DAY,
        latestDocumentId: null,
        freshness: { label: '较新', tone: 'positive', date: null, daysSince: null },
        note: null,
      },
      {
        key: 'cardiac',
        title: '心脏检查',
        available: true,
        state: 'present',
        summary: 'LVEF 60%',
        latestDate: DAY,
        latestDocumentId: null,
        freshness: { label: '较新', tone: 'positive', date: null, daysSince: null },
        note: null,
      },
    ],
  },
  nextSteps: [],
  timeline: [
    { id: 't1', title: '最近活动记录', description: '走了 2km', timestamp: DAY, tag: '活动' },
  ],
} as unknown as ClinicalPassportSummary;

const matchAll = (html: string, pattern: RegExp) =>
  [...html.matchAll(pattern)].map((match) => match[1].trim());

describe('只有年月日的日期，设备时区不能改掉它', () => {
  // If this ever fails, the environment stopped applying and every
  // assertion below went back to proving nothing.
  it('这些用例确实跑在 UTC 以西', () => {
    expect(new Date(DAY).getDate()).toBe(8);
  });

  it('formatDateLabel 不会把 2025-05-09 读成 05-08', () => {
    expect(formatDateLabel(DAY)).toBe('05-09');
    expect(formatDateLabel(` ${DAY} `)).toBe('05-09');
  });

  // A value that really does carry a time gets converted — onto the
  // product's calendar, which is the one the server printed it on and
  // the one the clinic reading it runs on. Not this handset's.
  it('带时刻的值按产品时区换算，不跟着手机走', () => {
    expect(formatDateLabel(INSTANT)).toBe('02-01');
    expect(formatDateLabel(BOUNDARY_BEFORE)).toBe('02-08');
    expect(formatDateLabel(BOUNDARY_AFTER)).toBe('02-09');
  });

  it('护照 PDF 里带时刻的字段也按产品时区换算', () => {
    // 生成时间 is 02:00Z, which is 08-05 in Beijing and 08-04 here. The
    // PDF is the one document in this product rendered off-server, and
    // this line is the whole reason it stopped agreeing with the other
    // three.
    const html = buildClinicalPassportPdfHtml(summary);

    expect(matchAll(html, /生成时间：([^<\n]+)/g)).toEqual(['2026-08-05']);
    expect(html).not.toContain('08-04');
  });

  // WITH THE YEAR, because this is the one document that gets printed
  // and handed over. `formatDateLabel` — the `MM-DD` chip the screens
  // use — was rendering every date on it, so the 生成时间 of a sheet
  // going into a referral folder, and every row of its 时间轴, arrived
  // yearless. The server's markdown export of the SAME summary prints
  // `YYYY-MM-DD`, and the clinician holding this is reading that too.
  // Whole-document parity lives in passport-date-parity.test.ts.
  it('导出的护照 PDF 印出的是报告上的那一天，带年份', () => {
    const html = buildClinicalPassportPdfHtml(summary);

    expect(matchAll(html, /最近日期：([^<\n]+)/g)).toEqual(['2025-05-09', '2025-05-09']);
    expect(matchAll(html, /class="timeline-date">([^<\n]+)/g)).toEqual(['2025-05-09']);
    expect(matchAll(html, /最近更新：([^<\n]+)/g)).toEqual(['2025-05-09']);
    // 诊断日期, 最近记录 and 最近 MRI — the three dated info cells, in
    // page order. 诊断日期 joins the list now that the cells carry
    // years: it is a `date` column the API already sliced, and the
    // rule for it is that nothing here converts it.
    expect(matchAll(html, /class="info-value">(\d{4}-\d\d-\d\d)/g)).toEqual([
      '2025-05-09',
      '2025-05-09',
      '2025-05-09',
    ]);
    expect(html).not.toContain('05-08');
  });

  it('麻醉卡上的检查日期是报告上的那一天', () => {
    const card = buildAnesthesiaCard(summary, new Date('2026-08-05T02:00:00.000Z'));
    const dated = card.patientLines.filter((line) => line.startsWith('最近'));

    expect(dated).toEqual([
      '最近肺功能：FVC 78%（2025-05-09）',
      '最近心脏检查：LVEF 60%（2025-05-09）',
    ]);
  });

  it('随访计划里的检查日期是报告上的那一天', () => {
    const schedule = buildSurveillanceSchedule(summary, null, new Date('2026-08-05T02:00:00.000Z'));
    const serialized = JSON.stringify(schedule);

    expect([...new Set(serialized.match(/2025-\d{2}-\d{2}/g) ?? [])]).toEqual(['2025-05-09']);
  });

  // `diagnosis_date` is a `date` column and 报告日期 is whatever the
  // parser read off the page; both reach this bundle as bare digits.
  it('我的档案读出的诊断日期和报告日期是报告上的那一天', () => {
    const insights = buildReportInsights(
      [
        {
          id: 'd1',
          documentType: 'muscle_mri',
          uploadedAt: '2026-01-02T00:00:00.000Z',
          ocrPayload: {
            fields: { classifiedType: 'muscle_mri', reportTime: DAY },
            extractedText: '前锯肌脂肪浸润',
          },
        },
      ] as never,
      { diagnosisDate: DAY } as never,
    );

    expect(insights.diagnosisDate).toBe(DAY);
    expect(insights.latestMriDate).toBe(DAY);
  });
});
