import { describe, expect, it } from 'vitest';

import { applyAdminBaselineWrite } from './baseline-provenance.js';
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
 * `geneticType` looks like evidence and falls back to a free-text
 * field on the baseline form.
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

describe('护照的诊断确认状态', () => {
  it('什么都没有时是 none', () => {
    const s = buildClinicalPassportSummary(base());
    expect(s.diagnosis.confirmation).toBe('none');
    expect(s.diagnosis.ready).toBe(false);
  });

  it('患者自己填的分型不算确诊', () => {
    // geneticMutation 是基线表里的自由文本框，不是证据。
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

  const adminTypedDiagnosis = () =>
    base({
      // The column `upsertBaseline` mirrors `foundation.diagnosisYear`
      // into, which is what puts a date on the passport at all.
      diagnosisDate: '2014-01-01',
      baseline: adminEdited(
        { foundation: { fullName: '测试' } },
        {
          foundation: { fullName: '测试', diagnosisYear: 2014 },
          diseaseBackground: { diagnosisType: 'FSHD1' },
        },
      ),
    });

  it('does not print 本人填写 over a diagnosis an administrator typed', () => {
    const summary = buildClinicalPassportSummary(adminTypedDiagnosis());

    expect(summary.diagnosis.confirmation).toBe('admin_entered');
    const card = summary.summaryCards.find((item) => item.key === 'diagnosis');
    // The sentence this replaced, verbatim. It said the patient wrote
    // something they have never seen.
    expect(card?.summary).not.toContain('以下为本人填写');
    expect(card?.summary).toContain('管理员代填');
    expect(card?.summary).toContain('不是患者本人填写');
  });

  it('still says 本人填写 when the patient really did type it', () => {
    const summary = buildClinicalPassportSummary(
      base({
        diagnosisDate: '2014-01-01',
        baseline: { foundation: { diagnosisYear: 2014 } },
      }),
    );

    expect(summary.diagnosis.confirmation).toBe('self_reported');
    expect(summary.summaryCards.find((item) => item.key === 'diagnosis')?.summary).toContain(
      '本人填写',
    );
  });

  it('names every marked field, with who and when, on the passport and in the export', () => {
    const summary = buildClinicalPassportSummary(adminTypedDiagnosis());

    expect(summary.fieldOrigins).toEqual([
      {
        path: 'diseaseBackground.diagnosisType',
        labelZh: 'FSHD 分型',
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

    // §B3 again: 「不能只在 App 里区分而导出里抹平」.
    const markdown = buildClinicalPassportExport(summary).markdown;
    expect(markdown).toContain('这些字段不是本人填写的');
    expect(markdown).toContain('FSHD 分型');
    expect(markdown).toContain(ADMIN_ID);
  });

  it('does not tell the PATIENT they filled in a diagnosis our staff typed', () => {
    // 待补项 is read by the patient, and this is the reader most likely
    // not to know the value is in their record at all.
    const step = buildClinicalPassportSummary(adminTypedDiagnosis()).nextSteps.find(
      (item) => item.title === '补充基因检测报告',
    );

    expect(step?.description).not.toContain('由本人填写');
    expect(step?.description).toContain('管理员代你录入');
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
