import { describe, expect, it } from 'vitest';

import { buildClinicalPassportSummary } from './profile.passport.js';
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
