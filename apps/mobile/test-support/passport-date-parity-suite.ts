/**
 * ONE PROFILE, TWO DOCUMENTS, ONE DATE PER RECORD — the handset half.
 *
 * apps/api's profile.passport.dates.test.ts pins the three SERVER
 * documents (markdown export, share page, referral pack) to the day in
 * `PRODUCT_TIME_ZONE`. This is the fourth document: the clinical
 * passport PDF, which is rendered on the phone, printed, and handed to
 * the same clinician who is reading the markdown export the patient
 * downloaded.
 *
 * WHERE THE EXPECTED STRINGS COME FROM. They are not derived here and
 * they are not a second implementation of the server's formatter —
 * both of those are how the two sides drift. They were MEASURED: the
 * fixture below is the summary `buildClinicalPassportSummary` produces
 * for one profile at 2026-03-06T18:00:00.000Z, and every constant in
 * `SERVER` is a string lifted out of `buildClinicalPassportExport`'s
 * markdown and `buildReferralPack`'s markdown for that same profile,
 * rendered with the server process at TZ=UTC. Re-measure with:
 *
 *   apps/api/src/modules/patient-profile/profile.passport.dates.test.ts
 *
 * WHY THE FIXTURE'S INSTANTS ARE 18:00 UTC. Midday absorbs every real
 * offset. 18:00Z is the previous calendar day in America/Los_Angeles
 * and the NEXT one in Asia/Shanghai, so a renderer reading the ambient
 * zone cannot hide in either environment this suite runs under.
 *
 * WHY THE TIMELINE SPANS THREE YEARS. The genetic report is from 2024,
 * the pulmonary and MRI reports and the strength entry from 2025, the
 * activity log from 2026. Printed through the screens' `MM-DD` chip
 * they were five yearless rows in one column, and a clinician could
 * not see that the genetics is two years older than everything under
 * it. That is the defect these assertions are here to hold shut.
 */

import type { ClinicalPassportSummary, PatientProfile } from '../lib/api';
import { buildClinicalPassportPdfHtml } from '../lib/clinical-passport-pdf';
import { buildSurveillanceSchedule } from '../lib/surveillance-schedule';

const T = (day: string) => `${day}T18:00:00.000Z`;

const ADMIN_ID = '11111111-2222-4333-8444-555555555555';

/** The generation clock the server built the fixture summary with. */
const NOW = new Date(T('2026-03-06'));

/**
 * What apps/api printed for this profile, verbatim.
 *
 * Every one of these is a `YYYY-MM-DD` on the product's calendar. The
 * instants that produced them are in the fixture below; the pairing is
 * the whole point, so they are written out rather than computed.
 */
const SERVER = {
  生成时间: '2026-03-07', // from 2026-03-06T18:00:00.000Z
  最近更新: '2026-03-06', // from 2026-03-05T18:00:00.000Z
  管理员录入: '2026-01-16', // from 2026-01-15T18:00:00.000Z
  最近MRI: '2025-02-13', // a `date` the API already formatted
  最近记录: '2026-03-05', // from 2026-03-04T18:00:00.000Z
  肺功能日期: '2025-02-15',
  timeline: ['2026-03-05', '2025-03-03', '2025-02-15', '2025-02-13', '2024-02-11'],
  // The four `summaryCards[].meta` sentences, which the API builds whole
  // and this sheet prints verbatim. Three of them used to be `MM-DD`.
  meta: [
    '诊断日期 2019-05-03',
    '最近记录 2025-03-03',
    '最近 MRI 2025-02-13',
    '最近监测 2025-02-15',
  ],
  // referral-pack.ts `milestoneDateZh` over the same two rows of
  // `patient_followup_events`.
  轮椅: '2019 年',
  无创通气: '2025-11-21', // from 2025-11-20T16:30:00.000Z
} as const;

const summary = () =>
  ({
    generatedAt: T('2026-03-06'),
    passportId: 'FSHD-PARITY',
    patientName: '张三',
    hasRecordedData: true,
    latestUpdatedAt: T('2026-03-05'),
    completion: { completed: 2, total: 4 },
    metrics: [],
    /**
     * SERVER-AUTHORED SENTENCES, PASTED IN EXACTLY AS THE API BUILT
     * THEM for this profile.
     *
     * The three `meta` strings here used to carry a bare `MM-DD`,
     * because profile.passport.ts built them with its own
     * `formatDateLabel` — the screens' chip — while 诊断日期 went
     * through `formatDate`. This sheet prints them verbatim, so one
     * printed page read 「诊断日期 2019-05-03」 beside 「最近记录 03-03」.
     * They are pasted in rather than left out precisely so the sweep
     * below runs against what the sheet really carries; now that the
     * API stops slicing them, the sweep covers them too.
     */
    summaryCards: [
      {
        key: 'diagnosis',
        title: '诊断证据',
        ready: false,
        summary: '未经基因确诊 —— 诊断日期（管理员代填）',
        meta: SERVER.meta[0],
      },
      {
        key: 'motor',
        title: '运动功能',
        ready: true,
        summary: '平均 4.0 级',
        meta: SERVER.meta[1],
      },
      {
        key: 'imaging',
        title: 'MRI 受累',
        ready: true,
        summary: '双侧大腿受累',
        meta: SERVER.meta[2],
      },
      {
        key: 'monitoring',
        title: '系统监测',
        ready: true,
        summary: 'FVC 82%',
        meta: SERVER.meta[3],
      },
    ],
    diagnosis: {
      ready: true,
      confirmation: 'genetic',
      latestSourceDate: null,
      latestDocumentId: null,
      freshness: { label: '较新', tone: 'positive', date: null, daysSince: null },
      geneticType: 'FSHD1',
      d4z4Repeats: '5',
      laboratoryRepeatCount: '5',
      methylationValue: '—',
      diagnosisDate: '2019-05-03',
      geneEvidence: 'D4Z4 5 个重复，4qA',
      valueOrigins: {},
    },
    fieldOrigins: [
      {
        path: 'foundation.diagnosisYear',
        labelZh: '确诊年份',
        state: 'admin_entered',
        adminUserId: ADMIN_ID,
        at: T('2026-01-15'),
        detail: null,
      },
    ],
    motor: {
      ready: true,
      average: '4.0',
      latestMeasurementAt: T('2025-03-02'),
      latestActivityAt: T('2026-03-04'),
      summary: '—',
      highlights: [],
      bodyRegions: {},
      activitySummary: '走了二十分钟',
    },
    imaging: {
      ready: true,
      latestMriDate: '2025-02-13',
      latestDocumentId: null,
      freshness: { label: '过期', tone: 'neutral', date: null, daysSince: null },
      summary: '双侧大腿受累',
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
          summary: 'FVC 82%',
          latestDate: SERVER.肺功能日期,
          latestDocumentId: null,
          freshness: { label: '过期', tone: 'neutral', date: null, daysSince: null },
          note: null,
        },
      ],
    },
    nextSteps: [],
    timeline: [
      {
        id: 't1',
        title: '最近活动记录',
        description: '走了二十分钟',
        timestamp: T('2026-03-04'),
        tag: '活动',
      },
      {
        id: 't2',
        title: '肌力更新',
        description: '共 1 组，平均 4.0 级',
        timestamp: T('2025-03-02'),
        tag: '肌力',
      },
      {
        id: 't3',
        title: '肺功能报告',
        description: 'pft.pdf',
        timestamp: T('2025-02-14'),
        tag: '报告',
      },
      {
        id: 't4',
        title: '临床报告',
        description: 'mri.pdf',
        timestamp: T('2025-02-12'),
        tag: '报告',
      },
      {
        id: 't5',
        title: '基因报告',
        description: 'g.pdf',
        timestamp: T('2024-02-10'),
        tag: '报告',
      },
    ],
  }) as unknown as ClinicalPassportSummary;

/**
 * The same two `patient_followup_events` rows the referral pack read.
 *
 * `started_wheelchair` is pinned to the first instant of 2019 — the
 * shape 「只知道 2019 年」 takes in a TIMESTAMPTZ NOT NULL column.
 * `started_niv` carries A REAL TIME OF DAY, which is what
 * `followupEventSchema.occurredAt` (`isoDateString`) accepts and what
 * the comment defending the UTC read used to say could not happen.
 * 16:30 UTC is the 20th in UTC and the 21st in Shanghai.
 */
const profile = () =>
  ({
    dateOfBirth: '1990-01-01',
    followupEvents: [
      { id: 'f1', eventType: 'started_wheelchair', occurredAt: '2019-01-01T00:00:00.000Z' },
      { id: 'f2', eventType: 'started_niv', occurredAt: '2025-11-20T16:30:00.000Z' },
    ],
    symptomScores: [],
    medications: [],
  }) as unknown as PatientProfile;

const matchAll = (html: string, pattern: RegExp) =>
  [...html.matchAll(pattern)].map((match) => match[1].trim());

/** Every `label → value` pair of the PDF's info cards, in page order. */
const infoCards = (html: string) =>
  [...html.matchAll(/class="info-label">([^<]*)<\/p>\s*<p class="info-value">([^<]*)</g)].map(
    (match) => [match[1].trim(), match[2].trim()] as const,
  );

const infoCard = (html: string, label: string) =>
  infoCards(html).find(([name]) => name === label)?.[1] ?? null;

/** Every 时间轴 row of the PDF, as「tag｜title｜date」. */
const pdfTimelineRows = (html: string) =>
  [...html.matchAll(/<li class="timeline-item">([\s\S]*?)<\/li>/g)].map((match) => {
    const block = match[1];
    const title = /<strong>([^<]*)<\/strong>/.exec(block)?.[1] ?? '';
    const tag = /class="timeline-tag">([^<]*)</.exec(block)?.[1] ?? '';
    const date = /class="timeline-date">([^<]*)</.exec(block)?.[1] ?? '';
    return `${tag}｜${title}｜${date}`;
  });

/**
 * A bare `MM-DD` anywhere in the rendered document.
 *
 * Two digits, a hyphen, two digits, with no four-digit year in front
 * and nothing dated behind — which is what every date on this sheet
 * looked like before. The CSS is scanned too, deliberately: the sweep
 * is over the bytes the reader receives, not over the call sites this
 * file happens to know about.
 */
const bareMonthDay = (html: string) =>
  [...html.matchAll(/(?<![\d-])\d{2}-\d{2}(?![\d-])/g)].map((m) => m[0]);

/**
 * @param deviceZone the zone the jest environment pinned this run to,
 *        for the test names. The assertions are constants: the whole
 *        claim is that they do not move with it.
 */
export const runPassportDateParitySuite = (deviceZone: string) => {
  describe(`护照 PDF 的日期（设备时区 ${deviceZone}）`, () => {
    it('这一轮确实跑在预期的时区里', () => {
      // If the environment ever stops applying, every assertion below
      // goes back to proving nothing.
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(deviceZone);
    });

    it('生成时间、最近更新、代为录入的日期与服务端 markdown 逐字一致', () => {
      const html = buildClinicalPassportPdfHtml(summary());

      expect(matchAll(html, /生成时间：([^<\n]+)/g)).toEqual([SERVER.生成时间]);
      expect(matchAll(html, /最近更新：([^<\n]+)/g)).toEqual([SERVER.最近更新]);
      expect(matchAll(html, /管理员于 ([^<\n]+?) 代为录入/g)).toEqual([SERVER.管理员录入]);
    });

    it('监测槽位与影像/运动那两格的日期与服务端一致', () => {
      const html = buildClinicalPassportPdfHtml(summary());

      expect(matchAll(html, /最近日期：([^<\n]+)/g)).toEqual([SERVER.肺功能日期]);
      // The two dated cells of 影像受累与功能变化's info grid, found by
      // their labels rather than by position: the 诊断证据 grid above
      // them prints 诊断日期 into the same kind of cell.
      expect(infoCard(html, '最近记录')).toBe(SERVER.最近记录);
      expect(infoCard(html, '最近 MRI')).toBe(SERVER.最近MRI);
    });

    /**
     * THE ROW A READER HAS TO BE ABLE TO DATE. Five records over three
     * years in one column: printed as「03-05 / 03-03 / 02-15 / 02-13 /
     * 02-11」 nothing on the sheet said the genetic report was two
     * years older than the strength entry above it.
     */
    it('时间轴的每一行都带年份，顺序和日期与服务端 markdown 一致', () => {
      const rows = pdfTimelineRows(buildClinicalPassportPdfHtml(summary()));

      expect(rows).toEqual([
        `活动｜最近活动记录｜${SERVER.timeline[0]}`,
        `肌力｜肌力更新｜${SERVER.timeline[1]}`,
        `报告｜肺功能报告｜${SERVER.timeline[2]}`,
        `报告｜临床报告｜${SERVER.timeline[3]}`,
        `报告｜基因报告｜${SERVER.timeline[4]}`,
      ]);
    });

    /**
     * THE WHOLE SHEET, INCLUDING THE PARTS THIS APP DID NOT WRITE.
     *
     * This assertion used to run over the document with the
     * `.metric-meta` lines cut out, because three of the four carried a
     * server-built `MM-DD` that no change here could reach. The API
     * stopped slicing them (profile.passport.ts, `summaryCards`), so
     * the exemption is gone and the sweep is over the bytes a reader
     * receives — which is what it always claimed to be.
     */
    it('这张纸上没有一个日期不带年份 —— 包括服务端拼好的那四句', () => {
      expect(bareMonthDay(buildClinicalPassportPdfHtml(summary()))).toEqual([]);
    });

    /**
     * `summaryCards[].meta` ARRIVES FINISHED AND IS PRINTED VERBATIM.
     *
     * The API builds these four sentences whole in profile.passport.ts
     * and this file prints the string it is given — pulling a date back
     * out of a server-authored sentence here to re-render it would be a
     * second date parser on the far side of a wire, which is the exact
     * mistake surveillance-schedule.ts's D4Z4 note is a monument to.
     * The fix for the three yearless ones belonged where the sentence
     * is built, and that is where it was made; this pins that the
     * renderer neither repairs nor damages what it receives.
     *
     * The days are the same days the 时间轴 and the info grid below
     * print for the same records: 2025-03-03 is timeline[1] and
     * 2025-02-13 is 最近MRI.
     */
    it('服务端拼好的 meta 原样印出，四句都带年份', () => {
      expect(
        matchAll(buildClinicalPassportPdfHtml(summary()), /class="metric-meta">([^<]*)</g),
      ).toEqual([...SERVER.meta]);
    });

    /**
     * 确诊年份 IS A YEAR, AND THIS SHEET MAY NOT DRESS IT AS A DAY.
     *
     * `patient_profiles.diagnosis_date` is a `date` column and
     * `upsertBaseline` mirrors the questionnaire's four-digit 确诊年份
     * into it as `${year}-01-01`; profile.passport.ts reduces that pin
     * back to 「2014 年」 before anything renders it. What this file has
     * to hold is that the renderer passes the string through — a
     * document that re-parsed it into a date would put the fabricated
     * 1 January back on the one page that gets printed.
     */
    it('只知道年份的诊断日期，原样印成年份，不补出 1 月 1 日', () => {
      const yearOnly = {
        ...summary(),
        diagnosis: { ...summary().diagnosis, diagnosisDate: '2014 年' },
        summaryCards: summary().summaryCards.map((card) =>
          card.key === 'diagnosis' ? { ...card, meta: '诊断日期 2014 年' } : card,
        ),
      } as unknown as ClinicalPassportSummary;
      const html = buildClinicalPassportPdfHtml(yearOnly);

      expect(infoCard(html, '诊断日期')).toBe('2014 年');
      expect(matchAll(html, /class="metric-meta">([^<]*)</g)[0]).toBe('诊断日期 2014 年');
      expect(html).not.toContain('2014-01-01');
    });

    // 诊断日期 comes off a `date` column the API already sliced, so it
    // has no instant and nothing to convert. It is asserted anyway:
    // 「不要转换」 is a rule the renderer has to keep, not one it gets
    // for free.
    it('诊断日期原样印出，还是那一天', () => {
      expect(infoCard(buildClinicalPassportPdfHtml(summary()), '诊断日期')).toBe('2019-05-03');
    });
  });

  describe(`随访里程碑的日期（设备时区 ${deviceZone}）`, () => {
    const evidence = (rowId: string) => {
      const found = buildSurveillanceSchedule(summary(), profile(), NOW)
        .groups.flatMap((group) => group.rows)
        .find((row) => row.id === rowId);
      if (!found) throw new Error(`no row ${rowId}`);
      return found.evidence;
    };

    it('只记到年份的轮椅记录印年份，和转诊包一个字不差', () => {
      expect(evidence('pulmonary_repeat')).toContain(`（${SERVER.轮椅}）`);
      expect(evidence('pulmonary_repeat')).not.toContain('01-01');
    });

    /**
     * THE DEFECT THIS ROW WAS WRITTEN FOR. `occurredAt` is
     * `isoDateString` — `z.string().trim().refine(Date.parse)` — so a
     * full timestamp goes in and comes back out. Read with the UTC
     * accessors this printed 2025-11-20 while the referral pack built
     * from the same row printed 2025-11-21: two documents from one
     * profile disagreeing about when this patient started nocturnal
     * ventilation.
     */
    it('带时刻的无创通气记录按产品日历印，和转诊包同一天', () => {
      expect(evidence('sleep_referral')).toContain(`（${SERVER.无创通气}）`);
      expect(evidence('sleep_referral')).not.toContain('2025-11-20');
    });
  });
};
