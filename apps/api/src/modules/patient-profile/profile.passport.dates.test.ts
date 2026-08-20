import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { applyAdminBaselineWrite } from './baseline-provenance.js';
import { buildPassportSharePage } from './passport-share.html.js';
import {
  buildClinicalPassportExport,
  buildClinicalPassportSummary,
  formatProductDate,
  PRODUCT_TIME_ZONE,
  type ClinicalPassportSummaryDTO,
} from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';
import { buildReferralPack } from './referral-pack.js';

/**
 * ONE PROFILE, ONE CLOCK, FOUR DOCUMENTS, ONE DATE PER RECORD.
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
 * THE FOURTH DOCUMENT WAS NEVER IN THIS COMPARISON, AND IT DISAGREED.
 * ------------------------------------------------------------------
 * The three documents above are rendered by the SERVER, and this file
 * used to pin them against each other while letting the answer move
 * with `process.env.TZ` — 2026-03-06 under America/Los_Angeles and
 * 2026-03-07 under Asia/Shanghai for one instant. Agreeing with each
 * other was all that was asked of them, and they got it by all reading
 * the same ambient zone.
 *
 * The clinical passport PDF is rendered on the HANDSET, from the same
 * summary, and handed to the SAME CLINICIAN. It read the DEVICE's zone.
 * apps/api/Dockerfile sets no TZ and node:20-bookworm-slim is UTC while
 * the patients this ships to are at UTC+8, so in production the two
 * sides were EIGHT HOURS APART: every date on the printed sheet was a
 * day ahead of the share page open on the screen beside it, for any
 * report filed between 16:00 and 24:00 UTC. Rendered and measured, not
 * reasoned about — server at TZ=UTC, device at TZ=Asia/Shanghai, one
 * fixture: 生成时间 2026-03-06 / 03-07, 最近更新 2026-03-05 / 03-06,
 * 管理员录入 2026-01-15 / 01-16, and all five 最近来源 rows a day apart.
 *
 * So the assertions below are no longer 「the three agree, whatever the
 * host says」. They are 「all four print THIS day」 — the day in
 * `PRODUCT_TIME_ZONE`, which is a fact about the Chinese clinic the
 * document is being carried into and about nothing else. Setting TZ in
 * the Dockerfile would have made one deployment agree by accident;
 * these expectations are constants, so any host that changes an answer
 * fails here.
 *
 * WHY THE DEVICE SIDE IS A FORMATTER AND NOT THE PDF ITSELF.
 * apps/mobile/lib/clinical-passport-pdf.ts reaches AsyncStorage through
 * api.ts and cannot load outside jest-expo, so this file calls the
 * formatter the PDF's `safeDate` wraps — `formatProductDate` from
 * clinical-visuals.ts — on exactly the summary fields the PDF passes
 * it, in the same order.
 *
 * IT IS `formatProductDate` AND NOT `formatDateLabel`, and this block
 * said `formatDateLabel` for as long as that was true. The PDF stopped
 * printing the `MM-DD` chip when it stopped being a screen; a comment
 * here still naming the chip would have this file asserting that the
 * printed sheet drops its years while the sheet carries them. The whole
 * PDF is rendered, bytes and all, in
 * apps/mobile/test-support/passport-date-parity-suite.ts.
 *
 * WHAT `deviceDates` STILL CANNOT SEE. Four of the strings on that
 * sheet are built HERE and printed there verbatim — `summaryCards[]
 * .meta` — so they are not a formatter question at all and are pinned
 * separately below, against the same days.
 *
 * AND WHY THE TWO ZONES ARE RUN ONE AFTER THE OTHER RATHER THAN AT THE
 * SAME TIME. A Node process has one TZ, so a single run cannot put the
 * server in UTC and the device in Asia/Shanghai. It does not need to:
 * each side is asserted to give the SAME answer in both zones, and two
 * functions that are each invariant across zones agree in every
 * pairing. The production pairing was also rendered in two real
 * processes while this was written, along with UTC/UTC, LA/LA,
 * Shanghai/LA, and Lord_Howe/St_Johns for the half-hour offsets.
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

/**
 * THE DEVICE FORMATTER, LOADED OUT OF THE MOBILE APP FOR REAL.
 *
 * Not a copy of it — the point of this file is that the two sides
 * cannot drift, and a second implementation here would be the drift.
 * The specifier is built at runtime rather than written as a literal
 * because apps/api's `rootDir` is `src`, so a static import of a file
 * in apps/mobile is a TS6059 from `tsc -p tsconfig.test.json`. Vitest
 * resolves it fine, and `PRODUCT_TIME_ZONE` is asserted below — if this
 * ever stops loading the real module, that assertion fails rather than
 * this file quietly proving nothing.
 */
const deviceModulePath = new URL('../../../../mobile/lib/clinical-visuals.ts', import.meta.url)
  .href;
const device = (await import(deviceModulePath)) as {
  PRODUCT_TIME_ZONE: string;
  formatProductDate: (value?: string | null) => string | null;
};

/** What `safeDate` does with a value the summary did not carry. */
const deviceDate = (value?: string | null) => device.formatProductDate(value) ?? '—';

/**
 * Every date the mobile PDF prints, taken off the same summary and
 * through the same function the PDF puts them through.
 *
 * Mirrors `safeDate` in apps/mobile/lib/clinical-passport-pdf.ts — see
 * its 生成时间 / 最近更新 block, its `timeline-date` cell, its
 * `monitor-meta` line, its 代为录入 sentence and the two dated cells of
 * its info grid. All of these are RAW ISO INSTANTS in the summary the
 * handset receives, which is why the device's zone reached them at all.
 */
const deviceDates = (summary: ClinicalPassportSummaryDTO) => ({
  生成时间: deviceDate(summary.generatedAt),
  最近更新: deviceDate(summary.latestUpdatedAt),
  timeline: summary.timeline.map((item) => deviceDate(item.timestamp)),
  admin: summary.fieldOrigins
    .filter((origin) => origin.state === 'admin_entered')
    .map((origin) => deviceDate(origin.at)),
  mri: deviceDate(summary.imaging.latestMriDate),
  motor: deviceDate(summary.motor.latestActivityAt || summary.motor.latestMeasurementAt),
  monitoring: summary.monitoring.items.map((item) => deviceDate(item.latestDate)),
});

const build = (timeZone: string) => {
  process.env.TZ = timeZone;
  const summary = buildClinicalPassportSummary(profile(), NOW);
  return {
    summary,
    exported: buildClinicalPassportExport(summary),
    pack: buildReferralPack(profile(), NOW),
    share: buildPassportSharePage(summary, { expiresAt: T('2026-03-20') }),
    device: deviceDates(summary),
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

    it('prints no machine timestamp anywhere in the referral pack either', () => {
      // The 「不是本人填写」 list interpolated `origin.at` raw, so the
      // pack a neurologist reads carried 「本平台管理员于
      // 2026-01-15T18:00:00.000Z 代为录入」 while the other three
      // documents printed a calendar day for the same event.
      expect(built.pack.markdown.match(ISO_INSTANT) ?? []).toEqual([]);
    });

    it('all four documents print 生成时间 as the same clinic day', () => {
      const day = built.summary.generatedAt.slice(0, 10);
      // 2026-03-06T18:00Z is already the 7th in Beijing, and the clinic
      // this is carried into is in Beijing. Not conditional on the host
      // any more: the constant IS the assertion.
      const expected = '2026-03-07';
      // The instant is one instant; only the calendar day it lands on
      // moves. Guarding the raw field too, because 生成时间 reading the
      // wall clock instead of the injected one is the other half of the
      // defect and would still print a plausible day.
      expect(day).toBe('2026-03-06');
      expect(line(built.exported.markdown, '生成时间')).toBe(`- 生成时间：${expected}`);
      expect(built.pack.markdown).toContain(`- 生成时间：${expected}`);
      expect(built.share).toContain(`生成时间 ${expected}`);
      expect(built.device.生成时间).toBe(expected);
    });

    it('all four documents print 最近更新 as the same clinic day', () => {
      const expected = '2026-03-06';
      expect(line(built.exported.markdown, '最近更新')).toBe(`- 最近更新：${expected}`);
      expect(built.pack.markdown).toContain(`- 平台内最近更新：${expected}`);
      expect(built.device.最近更新).toBe(expected);
    });

    it('prints the same 最近来源 days, in the same order, on all four', () => {
      const dates = exportTimelineDates(built.exported.markdown);
      expect(dates.length).toBeGreaterThan(0);
      expect(dates).toEqual(shareTimelineDates(built.share));
      expect(dates).toEqual(['2026-03-05', '2026-03-03', '2026-02-15', '2026-02-13', '2026-02-11']);
      // The row the handset prints for the same record, in the same
      // order. This is the comparison that was missing.
      expect(built.device.timeline).toEqual(dates);
    });

    it('prints the administrator entry date the same way on all four', () => {
      const expected = '2026-01-16';
      expect(built.exported.markdown).toContain(`本平台管理员于 ${expected} 代为录入`);
      expect(built.share).toContain(`本平台管理员于 ${expected} 代为录入`);
      expect(built.pack.markdown).toContain(`本平台管理员于 ${expected} 代为录入`);
      expect(built.device.admin).toEqual([expected]);
    });

    it('hands the handset the same 最近 MRI and 最近监测 days the server printed', () => {
      // These reach the device already formatted, which is why they
      // survived the split — and they are asserted anyway, because the
      // fix must not have moved them either.
      expect(built.summary.imaging.latestMriDate).toBe('2026-02-13');
      expect(built.device.mri).toBe('2026-02-13');
      expect(built.summary.monitoring.items.map((item) => item.latestDate)).toEqual([
        null,
        '2026-02-15',
        null,
      ]);
      expect(built.device.monitoring).toEqual(['—', '2026-02-15', '—']);
      // 最近记录 in the info grid: an instant, so it was a day out.
      expect(built.device.motor).toBe('2026-03-05');
    });

    /**
     * THE FOUR STRINGS THE HANDSET CANNOT REPAIR.
     *
     * `summaryCards[].meta` leaves this module as a finished sentence
     * and apps/mobile/lib/clinical-passport-pdf.ts prints it verbatim
     * into `.metric-meta` at the head of the printed sheet. Three of
     * the four were built with `formatDateLabel`, the screens' `MM-DD`
     * chip, so one page carried 「诊断日期 2019-05-03」 beside
     * 「最近记录 03-03」, 「最近 MRI 02-13」 and 「最近监测 02-15」 — two
     * date formats in one row of four cards, three of them undatable
     * by the person holding the paper, above a 时间轴 spanning years.
     *
     * Pinned as whole strings rather than as「contains a year」: what a
     * clinician reads is the sentence.
     */
    it('每张卡片的 meta 都带年份 —— 这四句是原样印在纸上的', () => {
      expect(built.summary.summaryCards.map((card) => card.meta)).toEqual([
        '诊断日期 2019-05-03',
        '最近记录 2026-03-03',
        // 上传日期, and that word is the point. The MRI on this profile
        // carries no 报告时间, so the day beside it is the day the file
        // reached this platform — see `PassportDateBasis`. It read
        // 「最近 MRI 2026-02-13」 with nothing saying which of the two
        // days that was, on the card the printed sheet leads with.
        '最近 MRI 2026-02-13 上传日期',
        '最近监测 2026-02-15',
      ]);
      // The days themselves are the ones the other three documents
      // print for the same records, which is the whole point of
      // building them here.
      expect(built.summary.summaryCards.map((card) => card.meta).join('\n')).not.toMatch(
        /(?<![\d-])\d{2}-\d{2}(?![\d-])/,
      );
    });

    it('answers with the product calendar and not with the host', () => {
      // The whole file is this assertion, but stated once and directly:
      // both sides name the same zone, and neither `built` nor
      // `built.device` above changed when %s did.
      expect(PRODUCT_TIME_ZONE).toBe('Asia/Shanghai');
      expect(device.PRODUCT_TIME_ZONE).toBe(PRODUCT_TIME_ZONE);
      expect(process.env.TZ).toBe(timeZone);
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

/**
 * 确诊年份 IS A YEAR, AND EVERY DOCUMENT NOW SAYS SO.
 *
 * The baseline questionnaire's only diagnosis-time control takes four
 * digits. `upsertBaseline` (profile.service.ts) mirrors it into
 * `patient_profiles.diagnosis_date`, which is a `date` column, as
 * `${year}-01-01` — and this module read that column and printed the
 * pin back. So a patient who answered 「2014」 was handed a passport,
 * a share link, a markdown export and a printed PDF all stating a
 * diagnosis on 1 JANUARY 2014, a day nobody ever recorded, while the
 * two machine-readable exports of the same profile emitted the bare
 * year (`recordedDate: '2014'` in fhir-r4.ts, `{ year: 2014 }` in
 * treat-nmd.ts). export/occurrence-date.ts refuses exactly this pin
 * for wheelchair and NIV milestones and says why; 诊断日期 is the one
 * date a patient is asked for at every appointment.
 *
 * Rendered, not reasoned about: the three SERVER documents are built
 * here from one profile and the assertion is on the bytes each of them
 * carries. The handset's two strings are the summary fields its PDF
 * prints verbatim — see the proxy below, and the sheet itself in
 * apps/mobile/test-support/passport-date-parity-suite.ts.
 */
describe('a 确诊年份 the patient gave as a year', () => {
  const yearOnly = (over: Partial<PatientProfileDTO> = {}): PatientProfileDTO =>
    ({
      ...profile(),
      // What `upsertBaseline` writes for 确诊年份 = 2014.
      diagnosisDate: '2014-01-01',
      ...over,
    }) as unknown as PatientProfileDTO;

  /** The value cell of one 诊断证据 row, as the share page prints it. */
  const shareRow = (html: string, label: string) =>
    new RegExp(`<dt>${label}</dt>\\s*<dd>([\\s\\S]*?)</dd>`).exec(html)?.[1] ?? '';

  const documents = (p: PatientProfileDTO) => {
    const summary = buildClinicalPassportSummary(p, NOW);
    return {
      summary,
      exported: buildClinicalPassportExport(summary).markdown,
      share: buildPassportSharePage(summary, { expiresAt: T('2026-03-20') }),
      pack: buildReferralPack(p, NOW).markdown,
      device: buildClinicalPassportPdfHtmlProxy(summary),
    };
  };

  /** The PDF itself cannot load here (see the header). What it prints
   *  for this row is `summary.diagnosis.diagnosisDate` through
   *  `safeText`, i.e. verbatim, and its hero card prints
   *  `summaryCards[0].meta` verbatim — so those two strings ARE the
   *  handset's answer. The whole sheet is rendered in
   *  apps/mobile/test-support/passport-date-parity-suite.ts. */
  function buildClinicalPassportPdfHtmlProxy(summary: ClinicalPassportSummaryDTO) {
    return {
      诊断日期: summary.diagnosis.diagnosisDate,
      卡片: summary.summaryCards.find((card) => card.key === 'diagnosis')?.meta ?? '',
    };
  }

  it('prints the year, and no 1 January, on all four documents', () => {
    process.env.TZ = 'UTC';
    // The genetic report on this fixture states 2019-05-03, a different
    // date entirely, so nothing here corroborates a January day.
    const built = documents(yearOnly());

    expect(built.summary.diagnosis.diagnosisDate).toBe('2014 年');
    expect(built.exported).toContain('- 诊断日期：2014 年');
    expect(built.pack).toContain('- 诊断日期：2014 年');
    // The 诊断日期 <dd> itself, not just「2014 年」 loose in the page —
    // the 出处 citations further down carry 「… 2019 年 5 月 …」.
    expect(shareRow(built.share, '诊断日期')).toContain('2014 年');
    expect(built.device.诊断日期).toBe('2014 年');
    expect(built.device.卡片).toBe('诊断日期 2014 年');

    for (const document of [built.exported, built.share, built.pack]) {
      expect(document).not.toContain('2014-01-01');
    }
  });

  it('answers the same under every host zone — a year has no instant', () => {
    for (const timeZone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
      process.env.TZ = timeZone;
      expect(buildClinicalPassportSummary(yearOnly(), NOW).diagnosis.diagnosisDate).toBe('2014 年');
    }
  });

  /**
   * THE ONE 1 JANUARY THIS MAY NOT SWALLOW. `applyGeneticReportAutofill`
   * copies the evidence report's 诊断日期 into an empty column verbatim,
   * so a laboratory that really did print 2014-01-01 arrives in exactly
   * the same shape. Reducing that one would throw away a day a document
   * states, which is the opposite failure.
   */
  it('keeps 1 January when a report on file states that day', () => {
    process.env.TZ = 'UTC';
    const withReportedJanuaryFirst = yearOnly({
      documents: profile().documents.map((document) =>
        document.id === 'doc-gene'
          ? {
              ...document,
              ocrPayload: {
                fields: {
                  classifiedType: 'genetic_report',
                  d4z4RepeatCount: '5',
                  haplotype: '4qA',
                  diagnosisDate: '2014-01-01',
                },
              },
            }
          : document,
      ),
    } as Partial<PatientProfileDTO>);

    expect(
      buildClinicalPassportSummary(withReportedJanuaryFirst, NOW).diagnosis.diagnosisDate,
    ).toBe('2014-01-01');
  });

  it('leaves a date that is not a year start alone', () => {
    process.env.TZ = 'UTC';
    // The unmodified fixture: 2019-05-03 in the column, and a report
    // stating the same day.
    expect(buildClinicalPassportSummary(profile(), NOW).diagnosis.diagnosisDate).toBe('2019-05-03');
  });
});

/**
 * WHERE THE PRODUCT'S DAY STARTS, ON BOTH SIDES, TO THE MILLISECOND.
 *
 * The suites above would still pass if both sides shared a wrong offset
 * — the same hour in the wrong direction, or seven hours instead of
 * eight — because they only ever compare the two against each other and
 * against a fixture whose instants are all 18:00Z. Beijing midnight is
 * 16:00 UTC, so these four instants are the boundary itself.
 */
describe.each(['UTC', 'America/Los_Angeles', 'Asia/Shanghai', 'Australia/Lord_Howe'])(
  'the product day boundary under TZ=%s',
  (timeZone) => {
    beforeEach(() => {
      process.env.TZ = timeZone;
    });

    it('turns over at 16:00 UTC, which is 00:00 in Asia/Shanghai', () => {
      const summary = (generatedAt: string) =>
        line(
          buildClinicalPassportExport(
            buildClinicalPassportSummary(profile(), new Date(generatedAt)),
          ).markdown,
          '生成时间',
        );

      expect(summary('2026-03-06T15:59:59.999Z')).toBe('- 生成时间：2026-03-06');
      expect(summary('2026-03-06T16:00:00.000Z')).toBe('- 生成时间：2026-03-07');
      expect(deviceDate('2026-03-06T15:59:59.999Z')).toBe('2026-03-06');
      expect(deviceDate('2026-03-06T16:00:00.000Z')).toBe('2026-03-07');
    });

    it('does not shift a value that is already a calendar day', () => {
      // A `date` column and an OCR reading carry no instant, so there is
      // nothing to convert and converting is how the day gets lost.
      expect(formatProductDate('2019-05-03')).toBe('2019-05-03');
      expect(formatProductDate(' 2019-05-03 ')).toBe('2019-05-03');
      expect(deviceDate('2019-05-03')).toBe('2019-05-03');
      expect(deviceDate(' 2019-05-03 ')).toBe('2019-05-03');
    });
  },
);
