import { describe, expect, it } from 'vitest';

import { BASELINE_PROVENANCE_KEY, applyAdminBaselineWrite } from './baseline-provenance.js';
import { applyGeneticReportAutofill } from './profile.autofill.js';
import { buildClinicalPassportExport, buildClinicalPassportSummary } from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';

/**
 * The passport is designed to be printed and handed to a neurologist
 * who may see three FSHD patients in a career. A confident, well
 * typeset page headed FSHD anchors them — and anchoring is the
 * mechanism behind the ~10-year diagnostic odyssey this population
 * already lives through, with a majority misdiagnosed on the way.
 *
 * So the one thing this document must never do is present the
 * patient's own guess in the same register as a genetic result. These
 * tests pin that boundary, because the fields are easy to confuse:
 * `geneticType` looks like evidence and falls back to
 * `patient_profiles.genetic_mutation`, a free-text column that the
 * patient's own profile endpoint writes and that profile.autofill.ts
 * fills from OCR when it is empty.
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

/**
 * A baseline that already carries a back-office marker on the paths
 * named, written literally rather than through
 * `applyAdminBaselineWrite`.
 *
 * The helper refuses the genetic paths, so a marker on one of them is
 * something on disk rather than something a request can be made to
 * produce. The renderers still have to say who is on it, which is what
 * the tests reached through here pin.
 */
const storedMarkers = (
  baseline: Record<string, unknown>,
  paths: readonly string[],
  by: { adminUserId: string; at: Date },
): Record<string, unknown> => ({
  ...baseline,
  [BASELINE_PROVENANCE_KEY]: Object.fromEntries(
    paths.map((path) => [
      path,
      { source: 'admin_entered', adminUserId: by.adminUserId, at: by.at.toISOString() },
    ]),
  ),
});

describe('护照的诊断确认状态', () => {
  it('什么都没有时是 none', () => {
    const s = buildClinicalPassportSummary(base());
    expect(s.diagnosis.confirmation).toBe('none');
    expect(s.diagnosis.ready).toBe(false);
  });

  it('患者自己填的分型不算确诊', () => {
    // geneticMutation 是 patient_profiles.genetic_mutation 这一列的自由
    // 文本，不是证据。这个 profile 没有任何文档，所以 autofill 不可能写过
    // 它 —— 来源判定见文件末尾的「每个诊断值自带来源」。
    const s = buildClinicalPassportSummary(base({ geneticMutation: 'FSHD1' } as never));
    expect(s.diagnosis.confirmation).toBe('self_reported');
    expect(s.diagnosis.ready).toBe(false);
  });

  it('患者自己填的诊断日期同样不算', () => {
    const s = buildClinicalPassportSummary(base({ diagnosisDate: '2023-05-01' } as never));
    expect(s.diagnosis.confirmation).toBe('self_reported');
    expect(s.diagnosis.ready).toBe(false);
  });

  it('确诊要报告同时写明长度和允许型单倍型，只有其中一项不算', () => {
    // The guideline this platform quotes on the same document says it in
    // its own words: 「只有 4qA 是允许型，缺了这一项，重复单元数本身不足
    // 以下结论」. A repeat count on its own used to come out 基因确诊 /
    // 完整度 4/4 anyway.
    const countOnly = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: '6' })] } as never),
    );
    expect(countOnly.diagnosis.confirmation).not.toBe('genetic');
    expect(countOnly.diagnosis.ready).toBe(false);

    const both = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: '6', haplotype: '4qA' })] } as never),
    );
    expect(both.diagnosis.confirmation).toBe('genetic');
    expect(both.diagnosis.ready).toBe(true);
  });

  /**
   * EcoRI 片段是以 kb 写的长度，指南给的界限写在重复单元数上，而本仓库
   * 引到的两句 kb —— 「单个 D4Z4 单元长 3.3 kb」和指南自己的「10–20 kb
   * or 1–4 repeats」—— 换算不到一起，所以推不出一个能用的 kb 界限。
   * 以 kb 写的长度照常印在护照上（带自己的来源括号），但不参与确诊、
   * 不参与分级、不参与灰区、也不撑任何一条建议。
   */
  it('两项都齐、但长度是 kb 时不算确诊 —— kb 只印不判', () => {
    // Annotated rather than inferred. An inline array of two object literals
    // with disjoint keys widens to `{haplotype: string; ecoRIFragment?:
    // undefined} | {ecoRIFragment: string; haplotype?: undefined}`, and
    // `Record<string, string>` refuses the synthesised `?: undefined` members
    // (TS2345). vitest could not see it — esbuild strips types without
    // checking them — so this was red only under `npm run typecheck`, which is
    // the hole tsconfig.test.json exists to close. The annotation gives each
    // literal a contextual type, so no `?: undefined` is synthesised.
    const halves: Record<string, string>[] = [{ haplotype: '4qA' }, { ecoRIFragment: '18kb' }];
    for (const f of halves) {
      const s = buildClinicalPassportSummary(base({ documents: [geneticReport(f)] } as never));
      // Name the arm. The loop aborts on the first failing iteration, so a
      // bare toBe reports `expected 'genetic' not to be 'genetic'` and nothing
      // about which half stopped being enough on its own.
      expect(s.diagnosis.confirmation, Object.keys(f).join(',')).not.toBe('genetic');
    }

    const fragmentAndHaplotype = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ ecoRIFragment: '18kb', haplotype: '4qA' })] } as never),
    );
    expect(fragmentAndHaplotype.diagnosis.confirmation).not.toBe('genetic');
    // 数还在页面上，只是没有判它 —— 并且说了为什么没判。
    expect(fragmentAndHaplotype.diagnosis.geneEvidence).toContain('18kb');
    expect(fragmentAndHaplotype.diagnosis.geneticEvidence.reason).toContain(
      '报告上以 kb 写的长度（18kb）照常展示',
    );
    expect(fragmentAndHaplotype.diagnosis.geneticEvidence.reason).toContain(
      '本平台不在 kb 和重复单元数之间做换算',
    );
    // kb 也不能被当成「基因确诊；D4Z4 重复数 …」里的那个数。
    expect(fragmentAndHaplotype.diagnosis.laboratoryRepeatCount).toBeNull();
  });

  it('未确诊时卡片明说「未经基因确诊」，不留给读者去推断', () => {
    const s = buildClinicalPassportSummary(base({ geneticMutation: 'FSHD1' } as never));
    const card = s.summaryCards.find((c) => c.key === 'diagnosis');
    expect(card?.summary).toContain('未经基因确诊');
  });

  it('完整度不因自述而上升', () => {
    const none = buildClinicalPassportSummary(base());
    const claimed = buildClinicalPassportSummary(base({ geneticMutation: 'FSHD1' } as never));
    expect(claimed.completion.completed).toBe(none.completion.completed);
  });
});

describe('the fourth source — a value our own back office typed (§B3)', () => {
  const ADMIN_ID = '11111111-2222-3333-4444-555555555555';
  const AT = new Date('2026-08-13T04:11:07.912Z');

  /** What an administrator's edit actually leaves on disk: the values
   *  plus the provenance block, exactly as `applyAdminBaselineWrite`
   *  writes it. Built with the real helper rather than hand-rolled, so
   *  a reshape of the block breaks this test instead of passing it. */
  const adminEdited = (previous: Record<string, unknown>, next: Record<string, unknown>) =>
    applyAdminBaselineWrite(previous, next, { adminUserId: ADMIN_ID, at: AT });

  const stored = (baseline: Record<string, unknown>, paths: readonly string[]) =>
    storedMarkers(baseline, paths, { adminUserId: ADMIN_ID, at: AT });

  const adminTypedDiagnosis = () =>
    base({
      // The column `upsertBaseline` mirrors `foundation.diagnosisYear`
      // into, which is what puts a date on the passport at all.
      diagnosisDate: '2014-01-01',
      baseline: adminEdited(
        { foundation: { fullName: '测试' } },
        {
          foundation: { fullName: '测试', diagnosisYear: 2014 },
          diseaseBackground: { familyHistory: '母亲也有类似症状' },
        },
      ),
    });

  it('does not print 本人填写 over a diagnosis an administrator typed', () => {
    const summary = buildClinicalPassportSummary(adminTypedDiagnosis());

    expect(summary.diagnosis.confirmation).toBe('admin_entered');
    const card = summary.summaryCards.find((item) => item.key === 'diagnosis');
    // The sentence this replaced, verbatim. It said the patient wrote
    // something they have never seen — and 以下 covered the whole block.
    expect(card?.summary).not.toContain('以下为本人填写');
    expect(card?.summary).toContain('诊断日期（管理员代填）');
    expect(summary.diagnosis.valueOrigins.diagnosisDate).toMatchObject({
      kind: 'admin_entered',
      adminUserId: ADMIN_ID,
      at: AT.toISOString(),
    });
  });

  /**
   * AND DOES NOT PRINT IT OVER THE PATIENT'S OWN TYPING EITHER, because
   * it cannot tell that apart from the two other ways a value reaches
   * this column. `confirmation` still moves — that enum is derived from
   * the marker on 确诊年份 and an unmarked field really is 「no
   * administrator on record」 — but the bracket beside the printed date
   * is a claim about authorship, and no store this platform keeps
   * records the patient writing one.
   */
  it('does not print 本人填写 over an unmarked date either', () => {
    const summary = buildClinicalPassportSummary(
      base({
        diagnosisDate: '2014-01-01',
        baseline: { foundation: { diagnosisYear: 2014 } },
      }),
    );

    expect(summary.diagnosis.confirmation).toBe('self_reported');
    expect(summary.diagnosis.valueOrigins.diagnosisDate.kind).toBe('indeterminate');
    expect(summary.summaryCards.find((item) => item.key === 'diagnosis')?.summary).toContain(
      '诊断日期（来源无法确定）',
    );
    expect(summary.summaryCards.find((item) => item.key === 'diagnosis')?.summary).not.toContain(
      '本人填写',
    );
  });

  it('names every marked field, with who and when, on the passport and in the export', () => {
    const summary = buildClinicalPassportSummary(adminTypedDiagnosis());

    expect(summary.fieldOrigins).toEqual([
      {
        path: 'diseaseBackground.familyHistory',
        labelZh: '家族史',
        state: 'admin_entered',
        adminUserId: ADMIN_ID,
        at: '2026-08-13T04:11:07.912Z',
        detail: null,
      },
      {
        path: 'foundation.diagnosisYear',
        labelZh: '确诊年份',
        state: 'admin_entered',
        adminUserId: ADMIN_ID,
        at: '2026-08-13T04:11:07.912Z',
        detail: null,
      },
    ]);

    // §B3 again: 「不能只在 App 里区分而导出里抹平」. 家族史 has no row
    // in the diagnosis block, so the list is the only place it is named
    // — which is the case that would go missing if the section were
    // derived from the printed rows instead of from the block.
    const markdown = buildClinicalPassportExport(summary).markdown;
    expect(markdown).toContain('这些字段不是本人填写的');
    expect(markdown).toContain('家族史');
    expect(markdown).toContain(ADMIN_ID);
  });

  it('does not tell the PATIENT they filled in a diagnosis our staff typed', () => {
    // 待补项 is read by the patient, and this is the reader most likely
    // not to know the value is in their record at all.
    const step = buildClinicalPassportSummary(adminTypedDiagnosis()).nextSteps.find(
      (item) => item.title === '补充基因检测报告',
    );

    expect(step?.description).not.toContain('由本人填写');
    expect(step?.description).toContain('诊断日期（管理员代填）');
    expect(step?.description).toContain('管理员代你录入');
    // 确诊年份 has a box on 建档表单, and the sentence about it names
    // that box rather than the row — the row is a date and the box
    // takes a year. 家族史 is marked on this profile too and is not
    // named: it has no row in the diagnosis block for the sentence to
    // be about.
    expect(step?.description).toContain('那张表单上和它有关的只有「确诊年份」，只能填 4 位年份');
    expect(step?.description).not.toContain(
      '诊断日期如果不对，你可以在「我的 → 编辑资料」里自己改',
    );
    expect(step?.description).not.toContain('家族史');
  });

  /**
   * THE PASSPORT NAMES THE VALUE AND ITS SOURCE. IT DOES NOT SAY WHAT
   * TO DO ABOUT 甲基化.
   *
   * Whether 「open the report and press 识别有误？手动修正」 works depends
   * on the report's status, and no passport surface holds it: the
   * summary is built from a profile, while the control is drawn by
   * 报告详情 off the document row, for `parsed` and `needs_review` only.
   * Four rounds of patches wrote the instruction anyway, and it was
   * false wherever the only report had not parsed.
   *
   * So this profile — marked 分型 and marked 甲基化, no document at all —
   * gets a bracket on both values, an instruction for the one with a
   * text box, and nothing at all for the one without. The reduction is
   * the point: 甲基化 costs its owner one extra tap through 我的报告, and
   * the page stops asserting something it cannot check.
   *
   * Reached here through `stored`, because a marker on 甲基化 is a
   * marker on disk rather than one this platform can be made to write.
   */
  it('names 甲基化 and its source, and tells nobody to go press anything', () => {
    const step = buildClinicalPassportSummary(
      base({
        baseline: stored({ diseaseBackground: { diagnosisType: 'FSHD1', methylation: '25%' } }, [
          'diseaseBackground.diagnosisType',
          'diseaseBackground.methylation',
        ]),
      }),
    ).nextSteps.find((item) => item.title === '补充基因检测报告');

    // Both values are on the page and both carry their bracket. That is
    // what this surface knows, and it stays.
    expect(step?.description).toContain('分型（管理员代填）');
    expect(step?.description).toContain('甲基化（管理员代填）');
    // 分型 has a box on the patient's own form, so it keeps its one
    // instruction.
    expect(step?.description).toContain('分型如果不对，你可以在「我的 → 编辑资料」里自己改');
    // 甲基化 gets no instruction of any shape — not the control, not the
    // report it might be corrected on, not a second upload, and not a
    // pointer at 我的报告 either. This profile holds no document, so
    // 「go and look at that report」 would be false on its face.
    for (const route of [
      '识别有误',
      '手动修正',
      '打开已经传过的那份报告',
      '传一份新的',
      '我的报告',
      '报告详情',
      '甲基化在「编辑资料」里没有这一栏',
    ]) {
      expect(step?.description).not.toContain(route);
    }
  });

  /**
   * THE STATE THAT MADE THE DELETED SENTENCE FALSE, RUN RATHER THAN
   * DESCRIBED.
   *
   * The report exists, so 「打开已经传过的那份报告」 named something real
   * — and it is in `parse_failed`, where 报告详情 draws no correction
   * control at all and the correction endpoint refuses the patch. The
   * instruction had no way to know that, because the status is on the
   * document row and this summary is built from a profile.
   */
  it('says nothing about correcting a report that never parsed', () => {
    const step = buildClinicalPassportSummary(
      base({
        baseline: stored({ diseaseBackground: { methylation: '25%', diagnosisType: 'FSHD1' } }, [
          'diseaseBackground.methylation',
        ]),
        documents: [{ ...geneticReport({}), status: 'parse_failed', ocrPayload: null }],
      } as never),
    ).nextSteps.find((item) => item.title === '补充基因检测报告');

    expect(step?.description).toContain('甲基化（管理员代填）');
    for (const route of ['识别有误', '手动修正', '打开', '那份报告']) {
      expect(step?.description).not.toContain(route);
    }
  });

  /**
   * 「改过之后那一项就记回你名下」 WAS A CLAIM ABOUT THE BRACKET, AND THE
   * BRACKET DOES NOT ALWAYS FOLLOW.
   *
   * The two halves of the old sentence had different truth conditions.
   * The value moving is a question about the text box; the attribution
   * moving is a question about `ocrCouldHaveFilled`, which nothing the
   * patient types can turn off. This runs both states of the same
   * profile: marked, then the marker released and the year changed, the
   * way `applyPatientBaselineWrite` leaves it after the patient's own
   * PUT. The date moves. 「本人填写」 never arrives.
   */
  it('promises the value will change, not that it will be credited to the patient', () => {
    const withReportedDate = (over: Record<string, unknown>) =>
      base({
        documents: [geneticReport({ diagnosisDate: '2021-06-01' })],
        ...over,
      } as never);

    const before = buildClinicalPassportSummary(
      withReportedDate({
        diagnosisDate: '2019-01-01',
        baseline: stored({ foundation: { diagnosisYear: 2019 } }, ['foundation.diagnosisYear']),
      }),
    );
    const after = buildClinicalPassportSummary(
      withReportedDate({
        diagnosisDate: '2020-01-01',
        baseline: { foundation: { diagnosisYear: 2020 } },
      }),
    );

    const step = (summary: ReturnType<typeof buildClinicalPassportSummary>) =>
      summary.nextSteps.find((item) => item.title === '补充基因检测报告')?.description;

    // The instruction is on the page before the edit, and it is true:
    // the printed date is the one the box governs, and it changes —
    // to 1 January of the year typed, which is what the sentence says
    // and the only thing the box can produce.
    expect(step(before)).toContain('那张表单上和它有关的只有「确诊年份」，只能填 4 位年份');
    expect(before.diagnosis.diagnosisDate).toBe('2019-01-01');
    expect(after.diagnosis.diagnosisDate).toBe('2020-01-01');

    // What the deleted clause promised, and what actually happens: the
    // patient types the date themselves and the passport still declines
    // to credit them, because a document on file carries a date too.
    expect(after.diagnosis.valueOrigins.diagnosisDate.kind).toBe('indeterminate');
    expect(step(after)).not.toContain('记回你名下');
    expect(step(after)).toContain('可能是你自己填的');
  });

  /**
   * THE SENTENCE ABOUT 确诊年份 IS READ BY SOMEBODY WHOSE 确诊年份 IS
   * EMPTY.
   *
   * `applyGeneticReportAutofill` fills `foundation.diagnosisYear` from
   * `patient_profiles.diagnosis_date` at read time, so for most
   * profiles the box holds the printed date's year by the time the form
   * loads. It returns the profile untouched when the evidence report
   * yields nothing at all — and a 诊断日期 reaches the column through
   * the patient's own profile endpoint without passing through that
   * field. The profile below is that state: the only genetics report
   * parsed to a 检测方法 and nothing else, the date sitting on a 病历摘要
   * that `pickGeneticEvidenceDocument` does not even consider a
   * candidate. The autofill is run here rather than described, because
   * the whole state depends on it declining to write.
   *
   * The old sentence told this reader the printed date 「对应的是「确诊
   * 年份」」 and promised 「那一年的 1 月 1 日」. Both presuppose a year in
   * the box. What survives says what the box is, what it can hold, and
   * what saving a year into it does — true with the box full or empty.
   */
  it('does not tell the patient the printed date is sitting in an empty 确诊年份 box', () => {
    const documents = [
      geneticReport({ geneticTestMethod: 'Southern blot' }),
      {
        ...geneticReport({ diagnosisDate: '2019-05-03', classifiedType: 'medical_record' }),
        id: 'd2',
        documentType: 'medical_record',
        uploadedAt: '2026-03-01T00:00:00.000Z',
      },
    ];
    const stored = { diagnosisDate: '2019-05-03', geneticMutation: null, baseline: {} };
    const read = applyGeneticReportAutofill(stored, documents as never);
    // The premise: nothing refilled the box.
    expect((read.baseline as Record<string, unknown> | null)?.foundation).toBeUndefined();

    const summary = buildClinicalPassportSummary(
      base({ diagnosisDate: read.diagnosisDate, baseline: read.baseline, documents } as never),
    );
    const step = summary.nextSteps.find((item) => item.title === '补充基因检测报告')?.description;

    expect(summary.diagnosis.diagnosisDate).toBe('2019-05-03');
    expect(step).toContain('没有一个直接显示它的框');
    expect(step).toContain('里面填的未必就是这里印的日期');
    // The two claims that were false here, gone rather than qualified.
    expect(step).not.toContain('诊断日期在「我的 → 编辑资料」里对应的是「确诊年份」');
    expect(step).not.toContain('保存之后，护照上的诊断日期会变成那一年的 1 月 1 日');
    // What is left still tells them what to do, and it still works: the
    // instruction survives into the state where the box IS full.
    expect(step).toContain('在那里填一个年份并保存');
  });

  /**
   * THE HALF WITH NO BOX GETS NO ADDRESS TO WRITE TO — AND NO OTHER
   * ADDRESS EITHER.
   *
   * 甲基化 is outside `ADMIN_WRITABLE_BASELINE_FIELDS`, so
   * `applyAdminBaselineWrite` refuses both a write and a clear of it —
   * the sibling test below runs that refusal rather than asserting it
   * from a list. Nobody at this platform can type the value, so a
   * sentence sending the patient to an inbox or a phone number asks
   * them to request something no one here can perform, about a value a
   * clinician is reading off the same page.
   *
   * The inbox was never the answer, and neither is the report: this
   * step now sends the patient nowhere at all about this value.
   */
  it('sends the patient nowhere about a value it cannot vouch for', () => {
    const step = buildClinicalPassportSummary(
      base({
        baseline: stored({ diseaseBackground: { diagnosisType: 'FSHD1', methylation: '25%' } }, [
          'diseaseBackground.diagnosisType',
          'diseaseBackground.methylation',
        ]),
      }),
    ).nextSteps.find((item) => item.title === '补充基因检测报告');

    // Not the inbox: nobody there can write this field, so the phone
    // number was an answer that goes nowhere.
    for (const route of ['找我们', '《隐私政策》第 1 条', '邮箱', '电话']) {
      expect(step?.description).not.toContain(route);
    }
    // Not a re-upload, and not the correction on a report already
    // uploaded either. Both were written as routes that always exist;
    // both depend on a report status this summary never sees.
    for (const route of ['重新上传', '传一份新的', '识别有误', '手动修正']) {
      expect(step?.description).not.toContain(route);
    }
    // And no account of where the value came from beyond its bracket.
    // 「来自你的档案」 was written to avoid claiming a report as the
    // source; with no instruction left to justify, the bracket says it.
    expect(step?.description).toContain('甲基化（管理员代填）');
    expect(step?.description).not.toContain('它是从你上传的基因报告里读出来的');
    expect(step?.description).not.toContain('这条路不会动「字段来源」里的记录');
  });

  it('refuses the back-office write and the back-office clear of 甲基化', () => {
    for (const next of [
      { diseaseBackground: { methylation: '30%' } },
      { diseaseBackground: { methylation: null } },
    ]) {
      expect(() =>
        applyAdminBaselineWrite({ diseaseBackground: { methylation: '25%' } }, next, {
          adminUserId: ADMIN_ID,
          at: AT,
        }),
      ).toThrow('甲基化');
    }
  });

  /**
   * The route the step no longer names, still working.
   *
   * Deleting the sentence did not delete the mechanism: a report this
   * platform can read 甲基化 off still wins over the baseline, so the
   * printed value and its bracket both move. What changed is who says
   * so — 报告详情 is rendered from the document row and knows whether
   * the correction is reachable on it; this page does not, so it prints
   * the value and its source and leaves the instruction there.
   *
   * The 字段来源 row is written off the baseline field, which the upload
   * leaves alone, so it survives the value being superseded.
   *
   * AND THE STEP ITSELF IS GONE FROM THIS PROFILE, which is the point
   * the last review made about it: 「补充基因检测报告」 was asked of a
   * reader whose genetics report is on file, was read, and put
   * 甲基化 31%（报告读取）on the same page — and the report is listed in
   * 最近来源 under it. The report is graded on what it stated instead.
   */
  it('a report carrying 甲基化 still changes the printed value and its bracket', () => {
    const summary = buildClinicalPassportSummary(
      base({
        baseline: stored({ diseaseBackground: { diagnosisType: 'FSHD1', methylation: '25%' } }, [
          'diseaseBackground.diagnosisType',
          'diseaseBackground.methylation',
        ]),
        documents: [geneticReport({ methylationValue: '31%' })],
      } as never),
    );

    expect(summary.diagnosis.methylationValue).toBe('31%');
    expect(summary.diagnosis.valueOrigins.methylationValue.kind).toBe('report');

    expect(summary.nextSteps.map((item) => item.title)).not.toContain('补充基因检测报告');
    const everything = [
      ...summary.nextSteps.map((item) => `${item.title}${item.description}`),
      summary.diagnosis.geneticEvidence.reason,
      buildClinicalPassportExport(summary).markdown,
    ].join('\n');
    expect(everything).not.toContain('还没有上传过基因报告');
    expect(everything).not.toContain('上传基因检测报告');

    expect(summary.fieldOrigins.map((field) => field.labelZh)).toContain('甲基化');
  });

  it('says nothing about self-service when every marked value has a box', () => {
    const step = buildClinicalPassportSummary(
      base({
        baseline: stored({ diseaseBackground: { diagnosisType: 'FSHD1' } }, [
          'diseaseBackground.diagnosisType',
        ]),
      }),
    ).nextSteps.find((item) => item.title === '补充基因检测报告');

    expect(step?.description).toContain('分型如果不对，你可以在「我的 → 编辑资料」里自己改');
    expect(step?.description).not.toContain('App 里没有给你填');
  });

  it('leaves an unmarked profile with an empty list and no extra section', () => {
    const summary = buildClinicalPassportSummary(
      base({ baseline: { foundation: { diagnosisYear: 2014 } } }),
    );

    expect(summary.fieldOrigins).toEqual([]);
    expect(buildClinicalPassportExport(summary).markdown).not.toContain('这些字段不是本人填写的');
  });

  it('renders a marker it cannot parse as 来源不明, never as the patient’s', () => {
    // A hand-written UPDATE, or a half-applied future shape. The
    // tempting fallback — treat it as no entry — is the one that puts
    // an administrator's value in the patient's mouth.
    const summary = buildClinicalPassportSummary(
      base({
        diagnosisDate: '2014-01-01',
        baseline: {
          foundation: { diagnosisYear: 2014 },
          fieldProvenance: { 'foundation.diagnosisYear': { source: 'who knows' } },
        },
      }),
    );

    expect(summary.diagnosis.confirmation).toBe('admin_entered');
    expect(summary.fieldOrigins[0]).toMatchObject({ state: 'unreadable', adminUserId: null });
    expect(buildClinicalPassportExport(summary).markdown).toContain('只能确定不是本人填写');
  });

  it('a marker on 确诊年份 does not sign the values it cannot have written', () => {
    // `confirmation` is derived from THIS one field's provenance entry.
    // The 分型 on this passport came off an uploaded report, and the
    // administrator has no way to write the column it falls back to
    // (`patient_profiles.genetic_mutation`) either.
    const summary = buildClinicalPassportSummary(
      base({
        diagnosisDate: '2014-01-01',
        baseline: adminEdited(
          { foundation: { fullName: '测试' } },
          { foundation: { fullName: '测试', diagnosisYear: 2014 } },
        ),
        documents: [geneticReport({ diagnosisType: 'FSHD1' })],
      } as never),
    );

    expect(summary.diagnosis.confirmation).toBe('admin_entered');
    expect(summary.diagnosis.valueOrigins.diagnosisDate.kind).toBe('admin_entered');
    expect(summary.diagnosis.valueOrigins.geneticType).toMatchObject({
      kind: 'report',
      documentId: 'd1',
    });
  });

  it('dates the ladder line by its actual origin instead of asserting 本人填写', () => {
    const patient = buildClinicalPassportSummary(
      base({ baseline: { diseaseBackground: { diagnosisLadder: 'clinical_only' } } }),
    );
    expect(patient.diagnosis.ladderOriginZh).toBe('本人填写');
    expect(buildClinicalPassportExport(patient).markdown).toContain('诊断进度（本人填写）');

    // The ladder is not in ADMIN_WRITABLE_BASELINE_FIELDS, so no admin
    // write can mark it. A hand-written UPDATE can, and the markdown
    // line used to assert 本人填写 with nothing behind the claim.
    const tampered = buildClinicalPassportSummary(
      base({
        baseline: {
          diseaseBackground: { diagnosisLadder: 'clinical_only' },
          fieldProvenance: {
            'diseaseBackground.diagnosisLadder': {
              source: 'admin_entered',
              adminUserId: ADMIN_ID,
              at: AT.toISOString(),
            },
          },
        },
      }),
    );
    expect(tampered.diagnosis.ladderOriginZh).toBe('管理员代填');
    expect(buildClinicalPassportExport(tampered).markdown).toContain('诊断进度（管理员代填）');
  });
});

/**
 * WHERE EACH PRINTED VALUE CAME FROM.
 *
 * `fieldProvenance` records administrator writes and nothing else, so
 * its absence proves only 「no administrator wrote this baseline
 * field」 — never 「the patient typed this value」. Five review rounds
 * produced the same defect in five renderers because each of them
 * derived authorship from that absence. The summariser answers it per
 * value now, and every fixture here goes through the summariser
 * because a literal DTO cannot express a source.
 */
describe('每个诊断值自带来源', () => {
  it('报告里读出来的分型是报告的，即使这份报告不足以构成基因确诊', () => {
    // A report parsed to `diagnosisType` alone does not reach
    // `genetic` — 分型 is not one of the items that grade is decided on
    // — so this landed in `self_reported`, and every renderer printed
    // 「本人填写」 over a string nobody typed.
    const summary = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ diagnosisType: 'FSHD1' })] } as never),
    );

    expect(summary.diagnosis.confirmation).toBe('self_reported');
    expect(summary.diagnosis.geneticType).toBe('FSHD1');
    expect(summary.diagnosis.valueOrigins.geneticType).toMatchObject({
      kind: 'report',
      labelZh: '报告读取',
      documentId: 'd1',
    });
  });

  it('基因确诊时的分型可能是患者自己打的字 —— 但确定不了，所以不这么写', () => {
    // The mirror of the case above: the D4Z4 count earns `genetic`
    // while 分型 is the free-text column, and no document carries a
    // 分型 field for the autofill to have copied. That last clause used
    // to buy the row 「本人填写」; it buys nothing, because
    // `applyGeneticReportAutofill` also writes that column and its
    // source report can be deleted or re-parsed afterwards. Two rows,
    // two sources, and the grade belongs to neither of them.
    const summary = buildClinicalPassportSummary(
      base({
        geneticMutation: '我猜是 FSHD1',
        documents: [geneticReport({ d4z4Repeats: '4', haplotype: '4qA' })],
      } as never),
    );

    expect(summary.diagnosis.confirmation).toBe('genetic');
    expect(summary.diagnosis.valueOrigins.geneticType.kind).toBe('indeterminate');
    expect(summary.diagnosis.valueOrigins.geneticType.labelZh).toBe('来源无法确定');
    expect(summary.diagnosis.valueOrigins.d4z4Repeats).toMatchObject({
      kind: 'report',
      documentId: 'd1',
    });
  });

  it('档案里空着、报告里有日期时，日期是报告的', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ diagnosisDate: '2019-05-03' })] } as never),
    );

    expect(summary.diagnosis.diagnosisDate).toBe('2019-05-03');
    expect(summary.diagnosis.valueOrigins.diagnosisDate.kind).toBe('report');
  });

  it('两边都有日期时是 indeterminate —— 自动回填不留记录，分不清就说分不清', () => {
    // profile.autofill.ts fills an empty `patient_profiles.diagnosis_date`
    // from an uploaded report at read time, before this summariser sees
    // the profile, and records nothing about having done it. Both
    // answers would be a guess, and one of them is the guess this
    // module exists to stop.
    const summary = buildClinicalPassportSummary(
      base({
        diagnosisDate: '2019-05-03',
        documents: [geneticReport({ diagnosisDate: '2019-05-03' })],
      } as never),
    );

    expect(summary.diagnosis.valueOrigins.diagnosisDate.kind).toBe('indeterminate');
    expect(summary.diagnosis.valueOrigins.diagnosisDate.detail).toContain('分不清');
  });

  /**
   * 「没有任何报告带日期」 IS NOT 「没有任何报告带过日期」.
   *
   * This state used to be the one road to 「本人填写」, on the reasoning
   * that with nothing on file carrying a date there was nothing for the
   * autofill to have copied. The reasoning holds only for the documents
   * on file NOW: the autofill runs at read time, the registration form
   * saves the profile it returns, and the report behind the write can be
   * deleted or re-parsed to nothing afterwards — which lands exactly
   * here. The detail says where the value is and that nothing recorded
   * how it arrived, and stops.
   */
  it('没有任何报告带日期时，也只能说值在档案里，说不出是谁填的', () => {
    const summary = buildClinicalPassportSummary(
      base({
        diagnosisDate: '2019-05-03',
        documents: [geneticReport({ d4z4Repeats: '4' })],
      } as never),
    );

    expect(summary.diagnosis.valueOrigins.diagnosisDate.kind).toBe('indeterminate');
    expect(summary.diagnosis.valueOrigins.diagnosisDate.detail).toContain('值在档案里');
    // Not the other two 「来源无法确定」 sentences: this row's box exists,
    // and no report on file carries a date.
    expect(summary.diagnosis.valueOrigins.diagnosisDate.detail).not.toContain('没有输入框');
    expect(summary.diagnosis.valueOrigins.diagnosisDate.detail).not.toContain('分不清');
  });

  it('没有值的行是 absent，不是「本人填写」', () => {
    const summary = buildClinicalPassportSummary(base());
    expect(summary.diagnosis.valueOrigins.geneticType.kind).toBe('absent');
    expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('absent');
    expect(summary.diagnosis.valueOrigins.methylationValue.kind).toBe('absent');
    expect(summary.diagnosis.valueOrigins.diagnosisDate.kind).toBe('absent');
  });

  it('证据摘要是拼起来的一行 —— 分型不是报告的，整行就归不到报告上', () => {
    // 「我猜是FSHD1 · 4」 printed under a heading a clinician reads as
    // laboratory evidence: the D4Z4 count is the report's, the 分型
    // next to it is the free-text column, and the row is neither.
    const markdown = buildClinicalPassportExport(
      buildClinicalPassportSummary(
        base({
          geneticMutation: '我猜是FSHD1',
          documents: [geneticReport({ d4z4Repeats: '4' })],
        } as never),
      ),
    ).markdown;

    expect(markdown).toContain('- 证据摘要：我猜是FSHD1 · 4（来源无法确定）');
  });

  it('拼起来只有分型时，证据摘要跟分型那一行写同一个来源', () => {
    // 单倍型, EcoRI 片段 and D4Z4 重复数 are all absent, so the join is
    // 分型 and nothing else. Two different brackets on one page over the
    // same string is the page disagreeing with itself in front of a
    // clinician, whatever the two say.
    const markdown = buildClinicalPassportExport(
      buildClinicalPassportSummary(base({ geneticMutation: '我猜是FSHD1' } as never)),
    ).markdown;

    expect(markdown).toContain('- 基因类型：我猜是FSHD1（来源无法确定）');
    expect(markdown).toContain('- 证据摘要：我猜是FSHD1（来源无法确定）');
  });

  it('拼进去的每一项都来自报告时，证据摘要才写「报告读取」', () => {
    const markdown = buildClinicalPassportExport(
      buildClinicalPassportSummary(
        base({
          documents: [geneticReport({ diagnosisType: 'FSHD1', d4z4Repeats: '4' })],
        } as never),
      ),
    ).markdown;

    expect(markdown).toContain('- 证据摘要：FSHD1 · 4（报告读取）');
  });

  it('一项都没读出来时，证据摘要后面不挂来源', () => {
    const markdown = buildClinicalPassportExport(buildClinicalPassportSummary(base())).markdown;
    expect(markdown).toContain('- 证据摘要：暂无可直接展示的基因证据\n');
  });

  it('导出的 markdown 也逐项带来源，不能只在 App 里区分（§B3）', () => {
    const markdown = buildClinicalPassportExport(
      buildClinicalPassportSummary(
        base({
          diagnosisDate: '2019-05-03',
          documents: [geneticReport({ diagnosisType: 'FSHD1', d4z4Repeats: '4' })],
        } as never),
      ),
    ).markdown;

    expect(markdown).toContain('- 基因类型：FSHD1（报告读取）');
    expect(markdown).toContain('- D4Z4 重复数：4（报告读取）');
    expect(markdown).toContain('- 诊断日期：2019-05-03（来源无法确定）');
    // Nothing to attribute, so nothing in brackets.
    expect(markdown).toContain('- 甲基化值：—\n');
  });
});

/**
 * 基线里的基因数值 —— 报告之外的第二个来源。
 *
 * `diseaseBackground.{d4z4,methylation,diagnosisType}` 由患者自己的登记
 * 表写入。这三个值都印在诊断证据这一节里，而这一节的下面就是 §B3 那份
 * 「这些字段不是本人填的」清单 —— 清单用的正是 「D4Z4 重复数」「甲基化」
 * 这两个词。
 *
 * 只读报告的话，同一页会同时写着 「D4Z4 重复数：—」 和一份带着 6 和 4qA
 * 的 TREAT-NMD 导出 —— 确诊 FSHD1 的那一对，出自同一次调用。拿着转诊资
 * 料的神经内科医生据此判断要不要重测。
 */
describe('基线里的基因数值：印出来，并且印明是谁填的', () => {
  const ADMIN_ID = '11111111-2222-3333-4444-555555555555';
  const AT = new Date('2026-08-01T02:03:04.000Z');
  const GENETICS = { d4z4: '6', haplotype: '4qA', methylation: '25%', diagnosisType: 'FSHD1' };
  const GENETIC_PATHS = [
    'diseaseBackground.d4z4',
    'diseaseBackground.methylation',
    'diseaseBackground.diagnosisType',
  ];

  /** 基线里三个基因数值上都压着后台的来源记录，一份报告都没传。
   *  `diagnosisDate` 是 `upsertBaseline` 把 `foundation.diagnosisYear`
   *  镜像进去的那一列。 */
  const markedGenetics = (over: Partial<PatientProfileDTO> = {}) =>
    base({
      diagnosisDate: '2019-01-01',
      baseline: storedMarkers(
        { foundation: { diagnosisYear: 2019 }, diseaseBackground: { ...GENETICS } },
        GENETIC_PATHS,
        { adminUserId: ADMIN_ID, at: AT },
      ),
      ...over,
    });

  /** 同样三个值在基线里，没有任何来源记录压着 —— 而这不等于三个都是患者
   *  自己填的。登记表为 分型 和 D4Z4 重复数 画了框，甲基化 没有：那一格只
   *  能是自动补全从某份报告里写进去的，而这份档案上一份报告都没有，报告
   *  被删掉或重新识别之后就是这个样子。 */
  const patientTypedGenetics = () =>
    base({
      diagnosisDate: '2019-01-01',
      baseline: { foundation: { diagnosisYear: 2019 }, diseaseBackground: { ...GENETICS } },
    });

  it('压着来源记录的数值印在护照上，每一个都带「管理员代填」', () => {
    const summary = buildClinicalPassportSummary(markedGenetics());

    expect(summary.diagnosis.d4z4Repeats).toBe('6');
    expect(summary.diagnosis.methylationValue).toBe('25%');
    expect(summary.diagnosis.geneticType).toBe('FSHD1');
    for (const key of ['d4z4Repeats', 'methylationValue', 'geneticType'] as const) {
      expect(summary.diagnosis.valueOrigins[key]).toMatchObject({
        kind: 'admin_entered',
        labelZh: '管理员代填',
        adminUserId: ADMIN_ID,
        at: AT.toISOString(),
      });
    }
  });

  /**
   * 印出来不等于升级成证据。`confirmation` 是证据等级，靠的是本平台从
   * 实验室报告上读到的那两格写着什么；档案里的一个数字不是报告。这一条
   * 要是反了，转诊资料上会直接写「基因确诊」。
   */
  it('代填的数值不会把诊断升级成基因确诊', () => {
    const summary = buildClinicalPassportSummary(markedGenetics());

    // `confirmation` 只看 确诊年份 那一个标记，这份档案上它没有 —— 三个
    // 基因值上的标记既不把这一档升上去，也不把它拉下来。
    expect(summary.diagnosis.confirmation).toBe('self_reported');
    expect(summary.diagnosis.ready).toBe(false);
  });

  /**
   * 三个值都印出来，三个都标「来源无法确定」，但说不出口的原因不一样：
   * D4Z4 和 分型 在建档表单上有框，患者可能真的是自己敲的 —— 只是本平台
   * 没有任何记录能证明；甲基化 连框都没有，患者根本无从录入。两种情况在
   * `detail` 里是两句话，在括号里是同一个词。
   */
  it('三项都印出来，且没有一项被记到患者名下', () => {
    const summary = buildClinicalPassportSummary(patientTypedGenetics());

    expect(summary.diagnosis.d4z4Repeats).toBe('6');
    expect(summary.diagnosis.methylationValue).toBe('25%');
    for (const key of ['d4z4Repeats', 'geneticType', 'methylationValue'] as const) {
      expect(summary.diagnosis.valueOrigins[key].kind).toBe('indeterminate');
      expect(summary.diagnosis.valueOrigins[key].labelZh).toBe('来源无法确定');
    }
    // 有框的那两项：说得出「可能是你自己填的」。
    expect(summary.diagnosis.valueOrigins.d4z4Repeats.detail).toContain('值在档案里');
    // 没框的那一项：连这个可能性都不能提。
    expect(summary.diagnosis.valueOrigins.methylationValue.detail).toContain('没有输入框');
    expect(summary.diagnosis.confirmation).toBe('self_reported');
    expect(summary.diagnosis.ready).toBe(false);
  });

  it('报告和基线都有值时，印报告的那个，标「报告读取」', () => {
    const summary = buildClinicalPassportSummary(
      markedGenetics({
        documents: [geneticReport({ d4z4Repeats: '4', methylationValue: '10%' })],
      } as never),
    );

    expect(summary.diagnosis.d4z4Repeats).toBe('4');
    expect(summary.diagnosis.methylationValue).toBe('10%');
    expect(summary.diagnosis.valueOrigins.d4z4Repeats).toMatchObject({
      kind: 'report',
      documentId: 'd1',
    });
    expect(summary.diagnosis.valueOrigins.methylationValue.kind).toBe('report');
  });

  /**
   * `confirmation` 是证据分级，不回答「这一行是谁写上去的」。报告足以确诊
   * 的时候，页面上照样可以有后台代填的值，那一格的括号必须还是它自己的。
   */
  it('报告已经确诊时，没有从报告读到的那些值仍标「管理员代填」', () => {
    const summary = buildClinicalPassportSummary(
      markedGenetics({
        documents: [geneticReport({ d4z4Repeats: '4', haplotype: '4qA' })],
      } as never),
    );

    expect(summary.diagnosis.confirmation).toBe('genetic');
    // 报告读到的那个数印出来、标「报告读取」，并且是结论那一句可以带的
    // 唯一一个数。
    expect(summary.diagnosis.d4z4Repeats).toBe('4');
    expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('report');
    expect(summary.diagnosis.laboratoryRepeatCount).toBe('4');
    // 报告里没有的那一格照旧是后台代填的。
    expect(summary.diagnosis.methylationValue).toBe('25%');
    expect(summary.diagnosis.valueOrigins.methylationValue.kind).toBe('admin_entered');
  });

  /**
   * `patient_profiles.genetic_mutation` 是患者自己那个接口写的自由文本，
   * `upsertBaseline` 碰都不碰它。基线上 `diseaseBackground.diagnosisType`
   * 的标记说的是另一个值 —— 盖到这一行上，就等于把管理员的名字按在患者
   * 自己打的字上面。
   */
  it('分型回退到 genetic_mutation 时，不拿基线的标记盖在上面', () => {
    const summary = buildClinicalPassportSummary(
      base({
        geneticMutation: '我猜是 FSHD1',
        baseline: storedMarkers(
          { diseaseBackground: { diagnosisType: 'FSHD2' } },
          ['diseaseBackground.diagnosisType'],
          { adminUserId: ADMIN_ID, at: AT },
        ),
        documents: [geneticReport({ d4z4Repeats: '4' })],
      } as never),
    );

    // 基线自己有值，所以印的是基线那个，标记也是它自己的。
    expect(summary.diagnosis.geneticType).toBe('FSHD2');
    expect(summary.diagnosis.valueOrigins.geneticType.kind).toBe('admin_entered');

    // 基线这一项空着时才回退到那一列，而那时没有任何标记可用。
    const fallback = buildClinicalPassportSummary(
      base({
        geneticMutation: '我猜是 FSHD1',
        baseline: applyAdminBaselineWrite(
          null,
          { foundation: { fullName: '测试' } },
          { adminUserId: ADMIN_ID, at: AT },
        ),
        documents: [geneticReport({ d4z4Repeats: '4' })],
      } as never),
    );

    expect(fallback.diagnosis.geneticType).toBe('我猜是 FSHD1');
    // 那一列上没有标记可用 —— 而「没有标记」不是「患者自己填的」：
    // `applyGeneticReportAutofill` 也写这一列，写完不留记录。
    expect(fallback.diagnosis.valueOrigins.geneticType.kind).toBe('indeterminate');
    expect(fallback.diagnosis.valueOrigins.geneticType.adminUserId).toBeNull();
  });

  it('导出的 markdown 上，值和来源印在同一行', () => {
    const markdown = buildClinicalPassportExport(
      buildClinicalPassportSummary(markedGenetics()),
    ).markdown;

    expect(markdown).toContain('- D4Z4 重复数：6（管理员代填）');
    expect(markdown).toContain('- 甲基化值：25%（管理员代填）');
    expect(markdown).toContain('- 基因类型：FSHD1（管理员代填）');
  });

  /**
   * 值印出来之后，「本护照内没有 D4Z4 重复数」 就和三行之下那个数字互相
   * 打架了。这句话要说的一直是「没有从报告里读出来的证据」。
   */
  it('概览那句话说的是报告，不是「这页上没有这个数」', () => {
    for (const profile of [patientTypedGenetics(), markedGenetics()]) {
      const card = buildClinicalPassportSummary(profile).summaryCards.find(
        (item) => item.key === 'diagnosis',
      );

      expect(card?.summary).toContain('没有从基因报告里读出来的');
      expect(card?.summary).not.toContain('本护照内没有 D4Z4 重复数');
    }
  });
});

describe('日历日不会因为服务器时区少一天', () => {
  const inTimeZone = <T>(zone: string, run: () => T): T => {
    const original = process.env.TZ;
    process.env.TZ = zone;
    try {
      return run();
    } finally {
      // `process.env.TZ = undefined` stores the STRING 'undefined', and
      // TZ is unset in an ordinary shell — so the restoring assignment
      // handed Node a zone name it cannot resolve and every later test
      // in this process ran in GMT instead of the host's own zone.
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  };

  it('诊断日期在负时区上不倒退一天', () => {
    // `patient_profiles.diagnosis_date` is a `date` column and arrives
    // as `YYYY-MM-DD`. `new Date('2019-05-03')` is UTC midnight, and
    // reading it back with `getDate()` on a host west of Greenwich gave
    // the 2nd — on the passport, on the share page, and in every export
    // built from them.
    const summary = inTimeZone('America/New_York', () =>
      buildClinicalPassportSummary(base({ diagnosisDate: '2019-05-03' })),
    );
    expect(summary.diagnosis.diagnosisDate).toBe('2019-05-03');
  });

  it('东西两个时区给出同一个日历日', () => {
    const west = inTimeZone('America/New_York', () =>
      buildClinicalPassportSummary(base({ diagnosisDate: '2019-05-03' })),
    );
    const east = inTimeZone('Asia/Shanghai', () =>
      buildClinicalPassportSummary(base({ diagnosisDate: '2019-05-03' })),
    );
    expect(west.diagnosis.diagnosisDate).toBe(east.diagnosis.diagnosisDate);
  });

  it('报告里的日期同样不倒退', () => {
    const summary = inTimeZone('America/New_York', () =>
      buildClinicalPassportSummary(
        base({ documents: [geneticReport({ diagnosisDate: '2019-05-03' })] } as never),
      ),
    );
    expect(summary.diagnosis.diagnosisDate).toBe('2019-05-03');
  });
});
