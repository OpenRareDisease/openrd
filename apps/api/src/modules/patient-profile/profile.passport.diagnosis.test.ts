import { describe, expect, it } from 'vitest';

import { BASELINE_PROVENANCE_KEY, applyAdminBaselineWrite } from './baseline-provenance.js';
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

  it('报告里提取出 D4Z4 重复数才算确诊', () => {
    const s = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: '6' })] } as never),
    );
    expect(s.diagnosis.confirmation).toBe('genetic');
    expect(s.diagnosis.ready).toBe(true);
  });

  it('4q 单倍型或 EcoRI 片段也算', () => {
    // Annotated rather than inferred. An inline array of two object literals
    // with disjoint keys widens to `{haplotype: string; ecoRIFragment?:
    // undefined} | {ecoRIFragment: string; haplotype?: undefined}`, and
    // `Record<string, string>` refuses the synthesised `?: undefined` members
    // (TS2345). vitest could not see it — esbuild strips types without
    // checking them — so this was red only under `npm run typecheck`, which is
    // the hole tsconfig.test.json exists to close. The annotation gives each
    // literal a contextual type, so no `?: undefined` is synthesised.
    const geneticEvidence: Record<string, string>[] = [
      { haplotype: '4qA' },
      { ecoRIFragment: '18kb' },
    ];
    for (const f of geneticEvidence) {
      const s = buildClinicalPassportSummary(base({ documents: [geneticReport(f)] } as never));
      // Name the arm. The loop aborts on the first failing iteration, so a
      // bare toBe reports `expected 'none' to be 'genetic'` and nothing about
      // which of the two kinds of evidence stopped counting; with the label
      // the same run reads `haplotype: expected 'none' to be 'genetic'`.
      expect(s.diagnosis.confirmation, Object.keys(f).join(',')).toBe('genetic');
    }
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

  it('still says 本人填写 when the patient really did type it', () => {
    const summary = buildClinicalPassportSummary(
      base({
        diagnosisDate: '2014-01-01',
        baseline: { foundation: { diagnosisYear: 2014 } },
      }),
    );

    expect(summary.diagnosis.confirmation).toBe('self_reported');
    expect(summary.diagnosis.valueOrigins.diagnosisDate.kind).toBe('patient');
    expect(summary.summaryCards.find((item) => item.key === 'diagnosis')?.summary).toContain(
      '诊断日期（本人填写）',
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
    // 确诊年份 has a box on 建档表单, so the promise names that value and
    // nothing else. 家族史 is marked on this profile too and is not
    // named: it has no row in the diagnosis block for the sentence to
    // be about.
    expect(step?.description).toContain('诊断日期如果不对，你可以在「我的 → 编辑资料」里自己改');
    expect(step?.description).not.toContain('家族史');
  });

  /**
   * 「改过之后那一项就记回你名下」 IS A CLAIM ABOUT A TEXT BOX.
   *
   * `applyPatientBaselineWrite` releases a marker when the patient's own
   * PUT changes that leaf path, so the promise holds only for the paths
   * 建档表单 posts. 甲基化 is printed in this block and has no control
   * anywhere in the patient's app, so a sentence covering every value
   * sends its owner hunting for a box that does not exist and leaves
   * the bracket on the page a clinician reads.
   *
   * Reached here through `stored`, because a marker on 甲基化 is a
   * marker on disk rather than one this platform can be made to write.
   */
  it('does not promise self-service on a value the patient has no box for', () => {
    const step = buildClinicalPassportSummary(
      base({
        baseline: stored({ diseaseBackground: { diagnosisType: 'FSHD1', methylation: '25%' } }, [
          'diseaseBackground.diagnosisType',
          'diseaseBackground.methylation',
        ]),
      }),
    ).nextSteps.find((item) => item.title === '补充基因检测报告');

    // Both values are on the page and both are marked.
    expect(step?.description).toContain('分型（管理员代填）');
    expect(step?.description).toContain('甲基化（管理员代填）');
    // 分型 has a box; 甲基化 does not, and the two get opposite
    // instructions rather than one that is half true.
    expect(step?.description).toContain('分型如果不对，你可以在「我的 → 编辑资料」里自己改');
    expect(step?.description).toContain('App 里没有给你填甲基化的地方');
    expect(step?.description).toContain('《隐私政策》第 1 条');
    expect(step?.description).not.toContain('甲基化如果不对，你可以');
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
    // `genetic` — that takes a D4Z4 count, a haplotype or an EcoRI
    // fragment — so this landed in `self_reported`, and every renderer
    // printed 「本人填写」 over a string nobody typed.
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

  it('基因确诊时的分型仍可能是患者自己打的字', () => {
    // The mirror of the case above: the D4Z4 count earns `genetic`
    // while 分型 is the free-text column, and no document carries a
    // 分型 field for the autofill to have copied.
    const summary = buildClinicalPassportSummary(
      base({
        geneticMutation: '我猜是 FSHD1',
        documents: [geneticReport({ d4z4Repeats: '4' })],
      } as never),
    );

    expect(summary.diagnosis.confirmation).toBe('genetic');
    expect(summary.diagnosis.valueOrigins.geneticType.kind).toBe('patient');
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

  it('没有任何报告带日期时，档案里的日期才算本人填写', () => {
    const summary = buildClinicalPassportSummary(
      base({
        diagnosisDate: '2019-05-03',
        documents: [geneticReport({ d4z4Repeats: '4' })],
      } as never),
    );

    expect(summary.diagnosis.valueOrigins.diagnosisDate.kind).toBe('patient');
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
    // 分型 and nothing else. Two brackets on one page over the same
    // string — 「本人填写」 on 基因类型 and 「来源无法确定」 on 证据摘要 —
    // is the page disagreeing with itself in front of a clinician.
    const markdown = buildClinicalPassportExport(
      buildClinicalPassportSummary(base({ geneticMutation: '我猜是FSHD1' } as never)),
    ).markdown;

    expect(markdown).toContain('- 基因类型：我猜是FSHD1（本人填写）');
    expect(markdown).toContain('- 证据摘要：我猜是FSHD1（本人填写）');
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
    expect(markdown).toContain('- 诊断日期：2019-05-03（本人填写）');
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

  /** 同样三个值，患者自己在登记表里填的。 */
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
   * 上传的报告里读到的 D4Z4 / 单倍型 / EcoRI 片段；档案里的一个数字不是
   * 报告。这一条要是反了，转诊资料上会直接写「基因确诊」。
   */
  it('代填的数值不会把诊断升级成基因确诊', () => {
    const summary = buildClinicalPassportSummary(markedGenetics());

    // `confirmation` 只看 确诊年份 那一个标记，这份档案上它没有 —— 三个
    // 基因值上的标记既不把这一档升上去，也不把它拉下来。
    expect(summary.diagnosis.confirmation).toBe('self_reported');
    expect(summary.diagnosis.ready).toBe(false);
  });

  it('患者自己填的同样印出来，标的是「本人填写」', () => {
    const summary = buildClinicalPassportSummary(patientTypedGenetics());

    expect(summary.diagnosis.d4z4Repeats).toBe('6');
    expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('patient');
    expect(summary.diagnosis.valueOrigins.methylationValue.kind).toBe('patient');
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
   * 报告里只有单倍型的时候，`confirmation` 已经是 `genetic` 了，而印在
   * 「D4Z4 重复数」那一行上的仍然是后台代填的数字。这两件事必须各说各的。
   */
  it('报告只够确诊、数字来自基线时，数字仍标「管理员代填」', () => {
    const summary = buildClinicalPassportSummary(
      markedGenetics({ documents: [geneticReport({ haplotype: '4qA' })] } as never),
    );

    expect(summary.diagnosis.confirmation).toBe('genetic');
    expect(summary.diagnosis.d4z4Repeats).toBe('6');
    expect(summary.diagnosis.valueOrigins.d4z4Repeats.kind).toBe('admin_entered');
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
    expect(fallback.diagnosis.valueOrigins.geneticType.kind).toBe('patient');
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
