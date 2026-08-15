import { describe, expect, it } from 'vitest';

import { BASELINE_PROVENANCE_KEY, applyAdminBaselineWrite } from './baseline-provenance.js';
import {
  buildPassportSharePage,
  buildPickupFormPage,
  buildPickupUnavailablePage,
} from './passport-share.html.js';
import { MAX_PICKUP_ATTEMPTS, PICKUP_TTL_MINUTES } from './passport-share.service.js';
import {
  buildClinicalPassportSummary,
  type ClinicalPassportSummaryDTO,
} from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';

/**
 * This page is opened by a neurologist who may meet three FSHD patients
 * in a career, on their own phone, in a consulting room, having been
 * handed a link by a patient they have two minutes for.
 *
 * A clean, confident page headed FSHD is exactly the anchoring
 * mechanism that produces the ten-year diagnostic odysseys this
 * population already lives through. So the confirmation state is not a
 * detail in a table here — it is above the fold, and these tests keep
 * it there.
 */

const summary = (over: Record<string, unknown> = {}): ClinicalPassportSummaryDTO =>
  ({
    generatedAt: '2026-08-05T00:00:00.000Z',
    passportId: 'FSHD-TEST',
    patientName: '张三',
    hasRecordedData: true,
    latestUpdatedAt: null,
    completion: { completed: 2, total: 4 },
    metrics: [],
    summaryCards: [],
    fieldOrigins: [],
    diagnosis: {
      ready: true,
      confirmation: 'genetic',
      latestSourceDate: null,
      latestDocumentId: null,
      freshness: { label: '最新', tone: 'success', date: null, daysSince: null },
      geneticType: 'FSHD1',
      d4z4Repeats: '4',
      methylationValue: '—',
      diagnosisDate: '2023-05-01',
      // Present only so the renderer has something to read. A literal
      // cannot express where a value came from — which is the whole
      // question — so every assertion about a source lives in the
      // block below this one, built from a profile through the real
      // summariser.
      valueOrigins: {
        geneticType: { kind: 'report', labelZh: '报告读取', documentId: 'd1' },
        d4z4Repeats: { kind: 'report', labelZh: '报告读取', documentId: 'd1' },
        methylationValue: { kind: 'absent', labelZh: '未填' },
        diagnosisDate: { kind: 'report', labelZh: '报告读取', documentId: 'd1' },
      },
      geneEvidence: 'D4Z4 4 拷贝',
      geneEvidenceOrigin: { kind: 'report', labelZh: '报告读取', documentId: 'd1' },
    },
    motor: {
      ready: true,
      average: '3.4',
      latestMeasurementAt: '2026-07-31T00:00:00.000Z',
      latestActivityAt: null,
      summary: '肩带明显受累',
      highlights: ['左肩带', '右肩带'],
      bodyRegions: {},
      activitySummary: '—',
    },
    imaging: {
      ready: false,
      latestMriDate: null,
      latestDocumentId: null,
      freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
      summary: '—',
      highlights: [],
      bodyRegions: {},
    },
    monitoring: {
      ready: false,
      items: [
        {
          key: 'cardiac',
          title: '心脏检查',
          available: false,
          summary: '暂无心脏检查数据',
          latestDate: null,
          latestDocumentId: null,
          freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
          state: 'absent',
          note: '没有症状的 FSHD 患者不需要常规做心电图或心脏超声。',
        },
      ],
    },
    nextSteps: [
      { title: '问一次眼底检查', description: '大片段缺失这一组风险更高。', kind: 'clinical' },
      { title: '上传 MRI 报告', description: '补齐后才能展示受累分布。', kind: 'record' },
    ],
    timeline: [
      {
        id: 't1',
        title: '肌力自测',
        description: '举手过头 4 分',
        timestamp: '2026-07-31T00:00:00.000Z',
        tag: '肌力',
      },
    ],
    ...over,
  }) as unknown as ClinicalPassportSummaryDTO;

/**
 * The one <div class="row"> whose <dt> is `label`, so an assertion can
 * name the row it means. Page-wide `toContain` was how the aggregated
 * authorship bug hid: 「（管理员代填）appears somewhere」 was true whether
 * it sat on the field the administrator wrote or on the one they could
 * not have.
 */
const rowOf = (html: string, label: string): string => {
  const rows = html.match(/<div class="row">[\s\S]*?<\/div>/g) ?? [];
  const row = rows.find((candidate) => candidate.includes(`<dt>${label}</dt>`));
  if (row === undefined) throw new Error(`no row labelled ${label}`);
  return row;
};

const page = (over: Record<string, unknown> = {}) =>
  buildPassportSharePage(summary(over), { expiresAt: '2026-08-12T12:00:00.000Z' });

/* ----------------------------------------------------------------
 * Reading the page the way the phone reads it.
 *
 * The self-reported marking is a CSS rule, and a CSS rule that selects
 * nothing is invisible to `expect(html).toContain('class="reported"')`
 * — which is exactly how `dd.reported` shipped against a class the code
 * only ever puts on a <span> INSIDE the <dd>. So these helpers resolve
 * a value's effective `color` / `font-variant-numeric` through the
 * page's own <style> block instead of asserting on the markup.
 *
 * Only what this page uses is supported: type and class compounds,
 * descendant combinators, specificity then source order. Anything with
 * a child/attribute/pseudo combinator is skipped rather than guessed
 * at, and @media blocks are dropped (nothing in them touches a value).
 * ---------------------------------------------------------------- */

type El = { tag: string; classes: string[] };

const styleRules = (html: string) => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const flat = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors, body]) =>
    selectors.split(',').map((selector) => ({ selector: selector.trim(), body })),
  );
};

const matchesCompound = (compound: string, el: El): boolean => {
  const tag = compound.match(/^[a-z][a-z0-9]*/i)?.[0];
  if (tag && tag !== el.tag) return false;
  return [...compound.matchAll(/\.([\w-]+)/g)].every(([, name]) => el.classes.includes(name));
};

const specificity = (selector: string) =>
  (selector.match(/\.[\w-]+/g)?.length ?? 0) * 10 + (selector.match(/(^|\s)[a-z]/gi)?.length ?? 0);

const matchesSelector = (selector: string, chain: El[], index: number): boolean => {
  if (/[>+~:[]/.test(selector)) return false;
  const parts = selector.split(/\s+/).filter(Boolean);
  if (!matchesCompound(parts[parts.length - 1], chain[index])) return false;
  let cursor = index - 1;
  for (let part = parts.length - 2; part >= 0; part -= 1) {
    while (cursor >= 0 && !matchesCompound(parts[part], chain[cursor])) cursor -= 1;
    if (cursor < 0) return false;
    cursor -= 1;
  }
  return true;
};

/** The value of an INHERITED property as the browser would resolve it:
 *  the innermost element in the chain that declares it wins. */
const effective = (html: string, chain: El[], property: string): string | null => {
  const rules = styleRules(html);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const matched = rules
      .filter((rule) => matchesSelector(rule.selector, chain, index))
      .sort((a, b) => specificity(a.selector) - specificity(b.selector));
    let found: string | null = null;
    for (const rule of matched) {
      for (const declaration of rule.body.split(';')) {
        const [name, ...value] = declaration.split(':');
        if (value.length && name.trim() === property) found = value.join(':').trim();
      }
    }
    if (found) return found;
  }
  return null;
};

/** The chain down to the element that actually carries a row's value.
 *  Everything above the <dd> is fixed page chrome; the <dd> and whatever
 *  it wraps the value in are read back out of the rendered HTML, because
 *  the wrapper is the thing under test. */
const valueChain = (html: string, label: string): El[] => {
  const row = html.match(new RegExp(`<dt>${label}</dt><dd([^>]*)>([\\s\\S]*?)</dd>`));
  if (!row) throw new Error(`no row rendered for ${label}`);
  const classesOf = (attributes: string) => [
    ...(attributes.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean),
  ];
  const chain: El[] = [
    { tag: 'body', classes: [] },
    { tag: 'div', classes: ['wrap'] },
    { tag: 'dl', classes: [] },
    { tag: 'div', classes: ['row'] },
    { tag: 'dd', classes: classesOf(row[1]) },
  ];
  const inner = row[2].match(/^<(\w+)([^>]*)>/);
  if (inner) chain.push({ tag: inner[1], classes: classesOf(inner[2]) });
  return chain;
};

describe('确诊状态必须在数值之前出现', () => {
  it('自填诊断时，警示横幅排在第一个数值前面', () => {
    const html = page({
      diagnosis: { ...summary().diagnosis, confirmation: 'self_reported' },
    });
    const banner = html.indexOf('未经基因确诊');
    const firstValue = html.indexOf('FSHD1');
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(firstValue);
  });

  it('逐个列出不是本人填写的字段，带管理员账号和时间', () => {
    const html = page({
      fieldOrigins: [
        {
          path: 'diseaseBackground.diagnosisType',
          labelZh: 'FSHD 分型',
          state: 'admin_entered',
          adminUserId: '11111111-2222-3333-4444-555555555555',
          at: '2026-08-13T04:11:07.912Z',
          detail: null,
        },
      ],
    });

    expect(html).toContain('这些字段不是患者本人填的');
    expect(html).toContain('FSHD 分型');
    expect(html).toContain('2026-08-13');
  });

  it('没有标记时不印那一节 —— 一个写着「无」的标题会教人跳过它', () => {
    expect(page({})).not.toContain('这些字段不是患者本人填的');
  });

  it('页脚说这一页的内容从哪来时，把那一节也算进去', () => {
    const origin = (state: 'admin_entered' | 'unreadable') => ({
      path: 'foundation.diagnosisYear',
      labelZh: '确诊年份',
      state,
      adminUserId: '11111111-2222-3333-4444-555555555555',
      at: '2026-08-13T04:11:07.912Z',
      detail: null,
    });
    // The footer sentence is what a clinician reads to know what they
    // are holding; it cannot name fewer places than the page shows.
    for (const state of ['admin_entered', 'unreadable'] as const) {
      const html = page({ fieldOrigins: [origin(state)] });
      const sentence = html.slice(html.indexOf('本页由患者本人主动分享'));
      expect(sentence.slice(0, sentence.indexOf('未经医疗机构核验'))).toContain(
        '一节逐条列出的字段',
      );
    }
    const clean = page({});
    expect(clean).toContain('本页由患者本人主动分享');
    expect(clean).not.toContain('一节逐条列出的字段');
  });

  it('运动功能那两行也一样 —— 它们连「（本人填写）」都没有，CSS 是唯一的信号', () => {
    // 概况 and 受累部位 are patient self-measurement wrapped in the same
    // class with no inline text marker, so if the rule does not bite,
    // they read with the typographic authority of the MRI summary two
    // sections below.
    const html = page();
    expect(effective(html, valueChain(html, '概况'), 'color')).toBe('var(--soft)');
    expect(effective(html, valueChain(html, 'MRI 摘要'), 'color')).toBe('var(--ink)');
  });

  it('什么依据都没有时也有横幅，不是留白', () => {
    const html = page({ diagnosis: { ...summary().diagnosis, confirmation: 'none' } });
    expect(html).toContain('这份摘要里没有诊断依据');
    // And it says so about the page, not about every report the
    // patient has ever uploaded — this renderer is handed one document's
    // worth of readings.
    expect(html).not.toContain('本平台尚无诊断依据记录');
  });
});

/* ----------------------------------------------------------------
 * 诊断这一段，从真的 summariser 走一遍。
 *
 * Every test above hands `buildPassportSharePage` a literal summary,
 * which can say what a value IS but not where it came from — and where
 * it came from is the whole question. `summary.diagnosis.geneticType`
 * is `geneticRecord.geneticType || profile.geneticMutation` and
 * `diagnosisDate` is `patient_profiles.diagnosis_date ||` the report's
 * own date, so a fixture that fixes the string fixes nothing about its
 * source. Everything below builds the summary from a profile: the
 * documents, the columns and the provenance block are the inputs, and
 * the bracket the page prints is the output.
 * ---------------------------------------------------------------- */

const profile = (over: Partial<PatientProfileDTO> = {}): PatientProfileDTO =>
  ({
    id: 'p1',
    userId: 'u1',
    fullName: '张三',
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

const rendered = (p: PatientProfileDTO) =>
  buildPassportSharePage(buildClinicalPassportSummary(p), {
    expiresAt: '2026-08-12T12:00:00.000Z',
  });

const ADMIN_ID = '11111111-2222-3333-4444-555555555555';
const ADMIN_AT = new Date('2026-08-13T04:11:07.912Z');

/** What an administrator's edit leaves on disk, written by the real
 *  helper so a reshape of the provenance block breaks these tests
 *  instead of passing them. */
const adminEdited = (previous: Record<string, unknown>, next: Record<string, unknown>) =>
  applyAdminBaselineWrite(previous, next, { adminUserId: ADMIN_ID, at: ADMIN_AT });

/** A baseline that already carries a back-office marker on the paths
 *  named, written literally. `applyAdminBaselineWrite` refuses the
 *  genetic paths, so a marker on one of them is what is on disk rather
 *  than something a request can produce — and this page still has to
 *  say who is on it. */
const storedMarkers = (
  baseline: Record<string, unknown>,
  paths: readonly string[],
): Record<string, unknown> => ({
  ...baseline,
  [BASELINE_PROVENANCE_KEY]: Object.fromEntries(
    paths.map((path) => [
      path,
      { source: 'admin_entered', adminUserId: ADMIN_ID, at: ADMIN_AT.toISOString() },
    ]),
  ),
});

describe('诊断这一段：每一行印自己的来源，一行都不靠推断', () => {
  it('报告里只读到分型时，标「报告读取」，不是「本人填写」', () => {
    // The report says FSHD1 and nothing else. That is not enough for
    // 基因确诊 (which takes a D4Z4 count, a haplotype or an EcoRI
    // fragment), so this profile lands in `self_reported` — and that
    // branch printed 「（本人填写）」 over a string nobody typed, under a
    // banner that said the same thing about the whole block.
    const p = profile({ documents: [geneticReport({ diagnosisType: 'FSHD1' })] } as never);
    const html = rendered(p);

    expect(buildClinicalPassportSummary(p).diagnosis.confirmation).toBe('self_reported');
    expect(rowOf(html, '分型')).toContain('FSHD1（报告读取）');
    expect(html).not.toContain('本人填写');
    // The two banner sentences this replaced, verbatim. The second one
    // is false about this profile in a second way: a genetic report IS
    // on file, it just did not parse to anything that confirms.
    expect(html).not.toContain('下面的分型和日期是患者自己在应用里填的');
    expect(html).not.toContain('本平台尚未收到该患者的基因检测报告');
  });

  it('基因确诊时分型仍可能是患者打的字 —— 标出来，且不排进化验值那一档', () => {
    // 确诊 is decided by the D4Z4 count alone. The report carries no
    // 分型 at all and no document carries one, so the value on the page
    // is the patient's own free text — under a banner that used to say
    // the whole diagnosis block had been read off the report.
    const p = profile({
      geneticMutation: '我猜是 FSHD1',
      documents: [geneticReport({ d4z4Repeats: '4' })],
    } as never);
    const html = rendered(p);

    expect(buildClinicalPassportSummary(p).diagnosis.confirmation).toBe('genetic');
    // Not 「本人填写」 either: `patient_profiles.genetic_mutation` is
    // written by the patient's own endpoint AND by the read-time
    // autofill, and nothing records which — see `resolveValueOrigin`.
    expect(rowOf(html, '分型')).toContain('我猜是 FSHD1（来源无法确定）');
    expect(rowOf(html, 'D4Z4 重复数')).toContain('4（报告读取）');
    expect(html).not.toContain('以下诊断信息来自患者上传的基因检测报告，由系统自动读取');
  });

  it('只有报告读出来的值排进化验值那一档，其余用另一种字体', () => {
    // `expect(html).toContain('class="reported"')` was the assertion
    // here once, and it stayed green while the only rule for the class
    // was `dd.reported` — a selector that matches a <dd> carrying the
    // class, never the <span> inside one. Resolve both rows through the
    // page's own stylesheet instead.
    const html = rendered(
      profile({
        geneticMutation: '我猜是 FSHD1',
        documents: [geneticReport({ d4z4Repeats: '4' })],
      } as never),
    );
    const typed = valueChain(html, '分型');
    const extracted = valueChain(html, 'D4Z4 重复数');

    expect(effective(html, extracted, 'color')).toBe('var(--ink)');
    expect(effective(html, typed, 'color')).toBe('var(--soft)');
    expect(effective(html, extracted, 'font-variant-numeric')).toBe('tabular-nums');
    expect(effective(html, typed, 'font-variant-numeric')).toBe('normal');
  });

  it('分型来自报告时，基因证据那一行也回到化验值那一档', () => {
    // 基因证据 is 分型 + 单倍型 + EcoRI + D4Z4 joined, so it inherits
    // 分型's uncertainty when 分型 is a text box.
    const fromReport = rendered(
      profile({
        documents: [geneticReport({ diagnosisType: 'FSHD1', d4z4Repeats: '4' })],
      } as never),
    );
    const fromTextBox = rendered(
      profile({
        geneticMutation: '我猜是 FSHD1',
        documents: [geneticReport({ d4z4Repeats: '4' })],
      } as never),
    );

    expect(effective(fromReport, valueChain(fromReport, '基因证据'), 'color')).toBe('var(--ink)');
    expect(effective(fromTextBox, valueChain(fromTextBox, '基因证据'), 'color')).toBe(
      'var(--soft)',
    );
  });

  it('基因确诊的横幅不能说「只有标报告读取的来自那份报告」 —— 基因证据那一行就不是', () => {
    // 基因确诊 is earned by the D4Z4 count while 分型 is the free-text
    // column, so 基因证据 joins one value from the report with one that
    // is not, and the row is marked 来源无法确定. A banner promising that
    // the report's contribution is confined to the 报告读取 rows is
    // contradicted by a row on the same page.
    const html = rendered(
      profile({
        geneticMutation: '我猜是FSHD1',
        documents: [geneticReport({ d4z4Repeats: '4' })],
      } as never),
    );

    expect(html).toContain('基因确诊');
    expect(rowOf(html, '基因证据')).toContain('我猜是FSHD1 · 4（来源无法确定）');
    expect(html).not.toContain('只有标「报告读取」的来自那份报告');
  });

  it('基因证据只剩分型时，跟分型那一行印同一个来源', () => {
    // Nothing was read off a report at all, so the joined row IS 分型.
    // Two different brackets over one string, two lines apart, is the
    // page disagreeing with itself in front of a clinician.
    const html = rendered(profile({ geneticMutation: '我猜是FSHD1' } as never));

    expect(rowOf(html, '分型')).toContain('我猜是FSHD1（来源无法确定）');
    expect(rowOf(html, '基因证据')).toContain('我猜是FSHD1（来源无法确定）');
  });

  it('横幅不替没读过的报告说话', () => {
    // The page reads ONE genetic document, and `pickGeneticDocument`
    // picks the one that fills the most of the block rather than the
    // newest — so the report that loses can still be the only one
    // carrying a repeat count. That is the residue of reading a single
    // report instead of merging several, and it is what makes
    // 「没有从该患者上传的任何报告里读到」 a claim this page cannot make:
    // it is a claim about every report, and one of them was not opened.
    const html = rendered(
      profile({
        geneticMutation: 'FSHD1',
        documents: [
          {
            ...geneticReport({ d4z4Repeats: '4' }),
            id: 'd-old',
            uploadedAt: '2019-05-03T00:00:00.000Z',
          },
          {
            ...geneticReport({ diagnosisType: 'FSHD1', diagnosisDate: '2026-01-09' }),
            id: 'd-new',
          },
        ],
      } as never),
    );

    expect(html).toContain('未经基因确诊');
    expect(html).not.toContain('上传的任何报告');
    expect(html).toContain('这份摘要里没有从基因报告里读出来的基因结果');
    expect(html).toContain('患者手里可能还有本平台没有读过的报告');
  });

  it('档案里没有诊断日期、报告里有时，标「报告读取」', () => {
    const html = rendered(
      profile({ documents: [geneticReport({ diagnosisDate: '2019-05-03' })] } as never),
    );
    expect(rowOf(html, '诊断日期')).toContain('2019-05-03（报告读取）');
    expect(rowOf(html, '诊断日期')).not.toContain('本人填写');
  });

  it('档案里有日期、任何报告都没带日期时，也还是说不出是谁填的', () => {
    // 「手上一份报告都没带日期」 rules out today's documents and not the
    // history: the autofill writes this column at read time and its
    // source report can be deleted or re-parsed afterwards, which lands
    // exactly here. This used to be the one road to 「本人填写」.
    const html = rendered(
      profile({
        diagnosisDate: '2019-05-03',
        documents: [geneticReport({ d4z4Repeats: '4' })],
      } as never),
    );
    expect(rowOf(html, '诊断日期')).toContain('2019-05-03（来源无法确定）');
    expect(rowOf(html, '诊断日期')).not.toContain('本人填写');
  });

  it('两边都有日期时说「来源无法确定」，不猜', () => {
    // profile.autofill.ts fills an empty `patient_profiles.diagnosis_date`
    // from a report at read time and leaves nothing behind saying it
    // did, so a date that a report also carries is equally consistent
    // with the patient having typed it. Both answers would be a guess.
    const html = rendered(
      profile({
        diagnosisDate: '2019-05-03',
        documents: [geneticReport({ diagnosisDate: '2019-05-03' })],
      } as never),
    );
    expect(rowOf(html, '诊断日期')).toContain('（来源无法确定）');
    expect(rowOf(html, '诊断日期')).not.toContain('本人填写');
  });

  it('管理员代填的确诊年份只落在诊断日期那一行，不牵连分型', () => {
    // §B3's fourth source. `confirmation` is derived from THIS field's
    // marker alone, and the banner used to write 「以下诊断由本平台工作
    // 人员代填」 over a block whose 分型 came off an uploaded report.
    const p = profile({
      diagnosisDate: '2014-01-01',
      baseline: adminEdited(
        { foundation: { fullName: '张三' } },
        { foundation: { fullName: '张三', diagnosisYear: 2014 } },
      ),
      documents: [geneticReport({ diagnosisType: 'FSHD1' })],
    } as never);
    const html = rendered(p);

    expect(buildClinicalPassportSummary(p).diagnosis.confirmation).toBe('admin_entered');
    expect(rowOf(html, '诊断日期')).toContain('（管理员代填）');
    expect(rowOf(html, '分型')).toContain('FSHD1（报告读取）');
    expect(rowOf(html, '分型')).not.toContain('管理员代填');
    // The banner names the field the marker is actually on.
    expect(html).toContain('档案里的「确诊年份」由本平台工作人员代填');
    expect(html).not.toContain('以下诊断由本平台工作人员代填');
  });

  it('来源记录读不出来时，只说不是本人填的，不发明一个管理员', () => {
    const p = profile({
      diagnosisDate: '2014-01-01',
      baseline: {
        foundation: { diagnosisYear: 2014 },
        fieldProvenance: { 'foundation.diagnosisYear': { source: 'who knows' } },
      },
    } as never);
    const html = rendered(p);

    expect(buildClinicalPassportSummary(p).diagnosis.confirmation).toBe('admin_entered');
    expect(rowOf(html, '诊断日期')).toContain('（非本人填写，来源不明）');
    expect(rowOf(html, '诊断日期')).not.toContain('（管理员代填）');
    expect(html).toContain('来源记录读不出来');
    expect(html).not.toContain('根据患者的电话或消息转述录入');
  });

  it('只解析出甲基化的报告：不能说「既未上传基因报告，也未填写诊断信息」', () => {
    // 甲基化 is in none of the three tests that earn 基因确诊, and it is
    // not 分型 or 诊断日期 either, so this profile lands in `none` —
    // with a value from an uploaded report printed on the page.
    const p = profile({ documents: [geneticReport({ methylationValue: '32%' })] } as never);
    const html = rendered(p);

    expect(buildClinicalPassportSummary(p).diagnosis.confirmation).toBe('none');
    expect(rowOf(html, '甲基化')).toContain('32%（报告读取）');
    expect(html).not.toContain('该患者既未上传基因报告');
  });

  it('诊断日期不会因为服务器所在时区而少一天', () => {
    // `patient_profiles.diagnosis_date` is a calendar date, and
    // `new Date('2019-05-03')` is UTC midnight — read back through
    // `getDate()` on any host west of Greenwich it is the 2nd. The
    // passport printed 2019-05-02 for a diagnosis dated 2019-05-03, on
    // the page a clinician reads.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const html = rendered(profile({ diagnosisDate: '2019-05-03' } as never));
      expect(rowOf(html, '诊断日期')).toContain('2019-05-03');
      expect(rowOf(html, '诊断日期')).not.toContain('2019-05-02');
    } finally {
      process.env.TZ = original;
    }
  });

  it('检查结果那一栏的日期也一样 —— 它已经是日历日，不能再解析一次', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const html = rendered(
        profile({
          documents: [
            {
              ...geneticReport({}),
              id: 'd2',
              documentType: 'pulmonary_function',
              ocrPayload: {
                fields: {
                  classifiedType: 'pulmonary_function',
                  reportTime: '2026-02-10',
                  fvcPredPct: '78%',
                },
              },
            },
          ],
        } as never),
      );
      expect(html).toContain('最近日期：2026-02-10');
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('运动功能不能读起来像查体', () => {
  it('标题写明是患者自测', () => {
    expect(page()).toContain('运动功能（患者自测）');
  });

  it('页脚再说一次，因为打印出来的第二页可能没有标题', () => {
    expect(page()).toContain('运动功能一栏为患者自测，不是查体所得');
  });
});

describe('这是一个页面，不是一个应用', () => {
  it('不含任何脚本', () => {
    const html = page();
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/on(click|load|error)=/i);
  });

  it('不请求任何外部资源', () => {
    // CSP forbids it and the GFW would eat it. A page that half-renders
    // in a hospital corridor is worse than a plain one.
    const html = page();
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<link');
  });

  it('声明不可索引', () => {
    expect(page()).toContain('noindex');
  });

  it('写明失效日期，让医生知道这份东西不是永久的', () => {
    expect(page()).toContain('2026-08-12');
  });
});

describe('转义', () => {
  it('姓名里的尖括号不会变成标签', () => {
    const html = page({ patientName: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('OCR 读出来的自由文本同样转义', () => {
    const html = page({
      diagnosis: { ...summary().diagnosis, geneEvidence: '"><img src=x onerror=1>' },
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('给医生的部分', () => {
  it('渲染指南类建议，不渲染「去上传一份 MRI」', () => {
    const html = page();
    expect(html).toContain('问一次眼底检查');
    // A record-completeness chore is the patient's homework, not
    // something to spend a clinician's two minutes on.
    expect(html).not.toContain('上传 MRI 报告');
  });

  it('监测槽位带上「是否需要做」的说明', () => {
    expect(page()).toContain('不需要常规做心电图');
  });
});

/* ================================================================
 * The pickup pages.
 *
 * Read for about eight seconds by someone standing up in a consulting
 * room, in WeChat's X5 webview or a hospital Android that may be older
 * than the patient's diagnosis. Two hard rules:
 *
 *   - NO SCRIPT. A plain form POST or nothing.
 *   - The failure page names no reason. Which failure it was is the
 *     one fact that would tell a guesser they guessed a real patient.
 * ================================================================ */

describe('取件码表单页', () => {
  const page = buildPickupFormPage('/s/passport/pickup');

  it('是个不带脚本的普通表单 —— X5 里必须能用', () => {
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/\son[a-z]+=/i);
    expect(page).toContain('<form method="post" action="/s/passport/pickup"');
  });

  it('两个输入框都在，且都是 required', () => {
    expect(page).toMatch(/id="code"[^>]*required/);
    expect(page).toMatch(/id="dob"[^>]*required/);
  });

  it('把 Crockford 的折叠规则直接写给医生看', () => {
    // Otherwise a doctor who reads「0」as「O」types it, fails, and
    // spends one of three attempts on a rule nobody told them.
    expect(page).toContain('I、L 按 1 输，O 按 0 输也可以');
  });

  it('页面上的分钟数和次数来自常量，不是打字打上去的', () => {
    // These were literals, and so were the assertions — so changing
    // PICKUP_TTL_MINUTES to 10 left this page telling a clinician 15
    // with the whole suite green. Read the number back OUT of the page
    // and compare it to the constant that enforces it.
    expect(page).toContain(`${PICKUP_TTL_MINUTES} 分钟内有效，只能用一次`);
    const ttlOnPage = page.match(/取件码 (\d+) 分钟内有效/)?.[1];
    expect(ttlOnPage).toBe(String(PICKUP_TTL_MINUTES));
    const attemptsOnPage = page.match(/出生日期输错 (\d+) 次/)?.[1];
    expect(attemptsOnPage).toBe(String(MAX_PICKUP_ATTEMPTS));
  });

  it('说的是「出生日期输错 3 次」，不是「输错 3 次」', () => {
    // Only a wrong BIRTHDATE increments the counter. A wrong code
    // matches no row, so there is nothing to count on — see
    // db/migrations/024. The in-app card had this right and this page,
    // the one a doctor actually reads, did not.
    expect(page).toContain(`出生日期输错 ${MAX_PICKUP_ATTEMPTS} 次`);
    expect(page).toContain(`取件码本身打错不计入这 ${MAX_PICKUP_ATTEMPTS} 次`);
    // The old sentence, which claimed any wrong entry burned the code.
    expect(page).not.toMatch(/[。，、]输错 \d+ 次/);
  });

  it('说清楚出生日期那一栏是干什么的', () => {
    // A doctor asked for a patient's birthdate with no explanation
    // reasonably wonders whether we are collecting it.
    expect(page).toContain('确认你打开的是眼前这位患者的记录');
  });

  it('不进索引、不带 Referer 出去', () => {
    expect(page).toContain('name="robots" content="noindex, nofollow, noarchive"');
    expect(page).toContain('name="referrer" content="no-referrer"');
  });

  it('action 是转义过的，不能被挂载路径注入', () => {
    const injected = buildPickupFormPage('/s/"><script>alert(1)</script>');
    expect(injected).not.toContain('<script>alert(1)</script>');
    expect(injected).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('取件码失败页 —— 一种页面回答所有失败', () => {
  const page = buildPickupUnavailablePage('/s/passport/pickup');

  it('列出可能性，但不说是哪一种', () => {
    expect(page).toContain('可能是取件码输错了');
    expect(page).toContain('不会告诉你上面哪一种情况才是真的');
    // The words that would identify a specific failure must not appear
    // as an assertion about THIS attempt.
    expect(page).not.toContain('取件码不存在');
    expect(page).not.toContain('出生日期错误');
  });

  it('给出下一步，而不是让人对着死页面站着', () => {
    expect(page).toContain('再生成一个取件码');
    expect(page).toContain('再输一次');
  });

  it('也不带脚本', () => {
    expect(page).not.toMatch(/<script/i);
  });
});

/**
 * 基线里的基因数值，在医生扫码打开的这一页上。
 *
 * 这一页的下半部分就是 §B3 那份 「这些字段不是患者本人填的」 清单，用的
 * 词是 「D4Z4 重复数」「甲基化」 —— 和上面那两行的标签一模一样。上面印
 * 「—」、下面点名同一个字段，是同一屏之内自相矛盾。
 */
describe('基线里的基因数值印在分享页上', () => {
  /** 三个基因数值上都压着后台的来源记录的那种档案。 */
  const genetics = (over: Partial<PatientProfileDTO> = {}) =>
    profile({
      diagnosisDate: '2019-01-01',
      baseline: storedMarkers(
        {
          foundation: { diagnosisYear: 2019 },
          diseaseBackground: {
            d4z4: '6',
            haplotype: '4qA',
            methylation: '25%',
            diagnosisType: 'FSHD1',
          },
        },
        [
          'diseaseBackground.d4z4',
          'diseaseBackground.methylation',
          'diseaseBackground.diagnosisType',
        ],
      ),
      ...over,
    });

  it('值和「管理员代填」印在同一行上', () => {
    const html = rendered(genetics());

    expect(rowOf(html, 'D4Z4 重复数')).toContain('6（管理员代填）');
    expect(rowOf(html, '甲基化')).toContain('25%（管理员代填）');
    expect(rowOf(html, '分型')).toContain('FSHD1（管理员代填）');
  });

  it('上面的值和下面那份清单说的是同一批字段', () => {
    const html = rendered(genetics());

    expect(html).toContain('这些字段不是患者本人填的');
    expect(rowOf(html, 'D4Z4 重复数')).not.toContain('<dd>—</dd>');
    expect(rowOf(html, '甲基化')).not.toContain('<dd>—</dd>');
  });

  it('横幅说的是没有报告可读，不是「这页上没有这个数」', () => {
    const html = rendered(genetics());

    expect(html).toContain('没有从基因报告里读出来的');
    expect(html).not.toContain('没有可作确诊依据的基因结果（D4Z4 重复数');
  });

  /**
   * 代填的数字不是化验值，排版上也不能是 —— 一个排得漂亮的数字本身就在
   * 说「这是测出来的」。走这一页自己的样式表解析，别看 class 名字：
   * `class="reported"` 那个断言曾经在选择器根本选不中的时候一直是绿的。
   */
  it('代填的数字不排进化验值那一档', () => {
    const html = rendered(genetics());
    const typed = valueChain(html, 'D4Z4 重复数');

    expect(effective(html, typed, 'color')).toBe('var(--soft)');
    expect(effective(html, typed, 'font-variant-numeric')).toBe('normal');
  });

  it('没有来源记录时，每一行都标「来源无法确定」，一行都不记到患者名下', () => {
    const html = rendered(
      profile({
        diagnosisDate: '2019-01-01',
        baseline: {
          foundation: { diagnosisYear: 2019 },
          diseaseBackground: { d4z4: '6', methylation: '25%', diagnosisType: 'FSHD1' },
        },
      } as never),
    );

    // 「没有来源记录」 是关于本平台记了什么的一句话，不是关于这个值是谁
    // 敲进去的。医生扫码看到的这一行如果写着「本人填写」，那是本平台替
    // 患者认下了一件自己查不出来的事。
    expect(rowOf(html, 'D4Z4 重复数')).toContain('6（来源无法确定）');
    expect(rowOf(html, '分型')).toContain('FSHD1（来源无法确定）');
    expect(rowOf(html, '甲基化')).toContain('25%（来源无法确定）');
    expect(html).not.toContain('本人填写');
  });

  /**
   * 后台只代填了基因数值、没碰确诊年份的时候，`confirmation` 落在
   * `self_reported`（它只看 确诊年份 那一个标记），而页面上已经有几行
   * 带着 「管理员代填」。这一档的横幅要是把来源列成一张单子，那张单子就
   * 漏掉了这一页正印着的那一种。
   */
  it('横幅不把来源列成一张漏项的单子', () => {
    const html = rendered(
      profile({
        baseline: storedMarkers({ diseaseBackground: { d4z4: '6', diagnosisType: 'FSHD1' } }, [
          'diseaseBackground.d4z4',
          'diseaseBackground.diagnosisType',
        ]),
      }),
    );

    expect(rowOf(html, 'D4Z4 重复数')).toContain('6（管理员代填）');
    expect(html).not.toContain(
      '有的是患者自己填的，有的是系统从上传的报告里读出来的，还有的本平台无法确定',
    );
  });

  it('报告里有数时印报告那个', () => {
    const html = rendered(genetics({ documents: [geneticReport({ d4z4Repeats: '4' })] } as never));

    expect(rowOf(html, 'D4Z4 重复数')).toContain('4（报告读取）');
    expect(rowOf(html, 'D4Z4 重复数')).not.toContain('6');
  });
});

describe('取件码打开的临床记录页', () => {
  it('不印一个失效日期 —— 这个凭证已经花在这次打开上了', () => {
    const viaPickup = buildPassportSharePage(summary(), { viaPickup: true });
    expect(viaPickup).toContain('取件码是一次性的');
    expect(viaPickup).not.toContain('本链接将于');
  });

  it('链接打开的那一版仍然印失效日期', () => {
    const viaLink = buildPassportSharePage(summary(), {
      expiresAt: '2026-08-12T12:00:00.000Z',
    });
    expect(viaLink).toContain('本链接将于 2026-08-12 失效');
    expect(viaLink).not.toContain('取件码是一次性的');
  });
});
