import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BASELINE_PROVENANCE_KEY, applyAdminBaselineWrite } from './baseline-provenance.js';
// The pack and the FHIR bundle are built from one profile in one run
// below, because the milestone-date defect was invisible to either
// side's own suite: each document was self-consistent and they
// disagreed with each other.
import { FIXTURE_GENERATED_AT } from './export/__fixtures__/profile.fixture.js';
import { normaliseSource } from './export/export-source.js';
import { buildFhirExport } from './export/fhir-r4.js';
// The pack's own source for the two sentences below: these tests assert
// the pack carries the passport's wording rather than a copy of it, so
// a change to either has to move both.
import { buildClinicalPassportSummary } from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';
import {
  REFERRAL_MAX_POINTS_PER_SERIES,
  REFERRAL_PROVENANCE_NOTE,
  buildReferralPack,
} from './referral-pack.js';
import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../config/logger.js';
import { errorHandler } from '../../middleware/error-handler.js';

/**
 * The module doubles exist for the second half of this file — the
 * end-to-end tests that put GET /me/referral-pack through Express.
 *
 * They are hoisted, so they apply to the whole file. That is safe:
 * everything above imports `./profile.service.js` for its TYPES only,
 * which TypeScript erases, and `buildReferralPack` never touches a
 * pool.
 */
const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock('../../db/pool.js', () => ({
  getPool: () => ({ query: (...args: unknown[]) => queryMock(...args) }),
}));

const getProfileByUserId = vi.fn();
vi.mock('./profile.service.js', () => ({
  PatientProfileService: class {
    getProfileByUserId = (...args: unknown[]) => getProfileByUserId(...args);
    // Called once at router construction by the stuck-OCR sweep and
    // the deletion purge. They must resolve or the router logs an
    // unhandled rejection and the real assertions get buried.
    sweepStuckProcessingDocuments = async () => 0;
    purgeDueAccountDeletions = async () => 0;
  },
}));

vi.mock('../../services/audit/retention.js', () => ({
  startRetentionSweep: () => ({ unref: () => undefined }) as unknown as NodeJS.Timeout,
}));

/**
 * What these tests are actually guarding.
 *
 * The pack is one page that leaves the app and lands in front of a
 * neurologist. Nothing on it can be checked by the reader against the
 * patient in the ten seconds they have, so every collapse this file
 * asserts against is a false statement made to someone who will act on
 * it:
 *
 *   - 「上传了但读不出」 rendered as 「没做过」 (the same collapse
 *     PassportMonitoringItemDTO.state and the anesthesia card exist to
 *     prevent, one reader further along the chain).
 *   - 「当天做不了」 rendered as a missing row. Migration 017 separated
 *     these in the database; a serialiser that drops `notApplicable`
 *     rows undoes that at the last step.
 *   - 「基线问卷里一项都没勾」 rendered as 「无辅具」, and 「从来没填过」
 *     rendered as either of the other two.
 *   - 「开始使用轮椅（2023-04）」 rendered as a present-tense device.
 *   - a self-reported diagnosis rendered in the same register as a
 *     genetic one.
 *
 * Every fixture timestamp is midday UTC, not midnight. The pack formats
 * dates with local-time accessors (deliberately — see `formatDate` in
 * referral-pack.ts), so a midnight-UTC fixture prints as the previous
 * day on any machine west of Greenwich and these tests would pass or
 * fail depending on where they run. Midday absorbs every real offset.
 */

const base = (over: Partial<PatientProfileDTO> = {}): PatientProfileDTO =>
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
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...over,
  }) as unknown as PatientProfileDTO;

const functionTest = (over: Record<string, unknown>) =>
  ({
    id: `ft-${Math.random()}`,
    testType: 'ten_meter_walk',
    measuredValue: 12.5,
    side: null,
    protocol: null,
    unit: 'sec',
    deviceUsed: null,
    assistanceRequired: null,
    notes: null,
    performedAt: '2026-03-01T12:00:00.000Z',
    createdAt: '2026-03-01T12:00:00.000Z',
    ...over,
  }) as unknown as PatientProfileDTO['functionTests'][number];

const followupEvent = (over: Record<string, unknown>) =>
  ({
    id: `ev-${Math.random()}`,
    eventType: 'started_wheelchair',
    severity: null,
    occurredAt: '2024-04-01T12:00:00.000Z',
    resolvedAt: null,
    description: null,
    linkedDocumentId: null,
    createdAt: '2024-04-01T12:00:00.000Z',
    submissionId: null,
    ...over,
  }) as unknown as PatientProfileDTO['followupEvents'][number];

const geneticReport = (fields: Record<string, string>) =>
  ({
    id: 'doc-gene',
    documentType: 'genetic_report',
    title: null,
    fileName: 'g.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1,
    storageUri: 'local://g',
    status: 'parsed',
    uploadedAt: '2026-02-01T12:00:00.000Z',
    checksum: null,
    submissionId: null,
    ocrPayload: { fields: { classifiedType: 'genetic_report', ...fields } },
  }) as unknown as PatientProfileDTO['documents'][number];

/** A report of a class the passport recognises, with nothing readable
 *  in it. Produces the `unreadable` monitoring state. */
const unreadablePulmonaryReport = () =>
  ({
    id: 'doc-pft',
    documentType: 'other',
    title: '肺功能报告',
    fileName: 'pft.jpg',
    mimeType: 'image/jpeg',
    fileSizeBytes: 1,
    storageUri: 'local://pft',
    status: 'parsed',
    uploadedAt: '2026-02-10T12:00:00.000Z',
    checksum: null,
    submissionId: null,
    ocrPayload: { fields: { classifiedType: 'pulmonary_function' } },
  }) as unknown as PatientProfileDTO['documents'][number];

const NOW = new Date('2026-08-05T12:00:00.000Z');

const pack = (profile: PatientProfileDTO) => buildReferralPack(profile, NOW);

/* ------------------------------------------------------------------ */

describe('转诊包 — the document itself', () => {
  it('leads with the catalogue entry and the document number, verbatim', () => {
    const result = pack(base());
    expect(result.catalogue.itemNumber).toBe(25);
    expect(result.catalogue.documentNumber).toBe('国卫医政发〔2023〕26号');
    expect(result.markdown).toContain(
      '《第二批罕见病目录》序号 25，国卫医政发〔2023〕26号（2023-09-18）',
    );
  });

  it('prints the provenance note before any patient data', () => {
    const result = pack(base());
    const noteIndex = result.markdown.indexOf(REFERRAL_PROVENANCE_NOTE);
    expect(noteIndex).toBeGreaterThan(-1);
    expect(noteIndex).toBeLessThan(result.markdown.indexOf('## 一、诊断依据'));
  });

  it('names the file and the document after the patient', () => {
    const result = pack(base());
    expect(result.fileName).toBe('张三-referral-pack.md');
    expect(result.documentTitle).toContain('罕见病诊疗协作网转诊资料');
    expect(result.contentType).toBe('text/markdown');
  });
});

describe('诊断依据 — a claim must never be typeset as evidence', () => {
  it('marks a self-reported diagnosis as such, in the printed line', () => {
    // `geneticMutation` is `patient_profiles.genetic_mutation`, a
    // free-text column. The passport calls a profile with no genetic
    // measurement `self_reported`; the pack must not upgrade it.
    const result = pack(base({ geneticMutation: 'FSHD1' } as Partial<PatientProfileDTO>));
    expect(result.diagnosis.confirmation).toBe('self_reported');
    expect(result.diagnosis.statement).toContain('请勿按已确诊处理');
    expect(result.markdown).toContain('请勿按已确诊处理');
  });

  it('speaks about this document, not about every report the patient uploaded', () => {
    // `buildReportInsights` opens ONE genetic document — the one that
    // fills the most of the diagnosis block — so a repeat count that
    // only a lower-ranked report carries is never read. That residue is
    // inherent to reading one report rather than merging several, and
    // it is why 「未从任何上传的报告里读到 D4Z4 重复数」 would be false
    // about exactly this patient. It is the sentence a neurologist
    // decides on.
    const result = pack(
      base({
        geneticMutation: 'FSHD1',
        documents: [
          {
            ...geneticReport({ d4z4Repeats: '4' }),
            id: 'doc-old',
            uploadedAt: '2019-05-03T12:00:00.000Z',
          },
          {
            ...geneticReport({ diagnosisType: 'FSHD1', diagnosisDate: '2026-01-09' }),
            id: 'doc-new',
          },
        ],
      } as never),
    );

    expect(result.diagnosis.confirmation).toBe('self_reported');
    expect(result.diagnosis.d4z4Repeats).toBe('—');
    expect(result.diagnosis.statement).not.toContain('任何上传的报告');
    expect(result.diagnosis.statement).toContain(
      '本资料里没有从基因报告里读出来的、可作确诊依据的基因结果',
    );
    // And it hands the reader the question this document cannot answer.
    expect(result.markdown).toContain('患者手里可能还有本平台没有读过的报告');
  });

  /**
   * THE DATE UNDER THE DIAGNOSIS BLOCK BELONGS TO THE DOCUMENT THE
   * VALUES WERE READ OFF, AND THAT IS NOT ALWAYS THE NEWEST ONE.
   *
   * `pickGeneticEvidenceDocument` ranks a candidate by what it carries
   * before its upload time, so a thin report uploaded this month loses
   * to a full assay from two years ago. The line was labelled 「最近一份
   * 诊断相关报告」 and fed that older date — printing, in the section a
   * 协作网 neurologist uses to decide whether the workup is current,
   * that this patient has brought nothing since 2019.
   */
  it('dates the report the values were read off, and does not call it the most recent', () => {
    const result = pack(
      base({
        documents: [
          {
            ...geneticReport({ d4z4Repeats: '4', haplotype: '4qA', methylationValue: '32%' }),
            id: 'doc-full',
            uploadedAt: '2019-05-03T12:00:00.000Z',
          },
          {
            ...geneticReport({ d4z4Repeats: '4' }),
            id: 'doc-thin',
            uploadedAt: '2026-02-01T12:00:00.000Z',
          },
        ],
      } as never),
    );

    // The premise: the picked document is the older, fuller one.
    expect(result.diagnosis.valueOrigins.d4z4Repeats.documentId).toBe('doc-full');
    expect(result.markdown).toContain('本平台读作基因证据的报告：2019-05-03');
    expect(result.markdown).not.toContain('最近一份诊断相关报告');
  });

  /**
   * AND THAT ROW MAY NOT CALL A 病历摘要 A REPORT.
   *
   * 报告 was hardcoded into the label. `pickGeneticEvidenceDocument`
   * takes a 病历摘要 quoting the results when the genetics report read
   * out nothing — for this patient there is no genetics report at all —
   * so the last line of 诊断依据 dated a laboratory report that was
   * never uploaded, in the row a neurologist reads to decide whether
   * the workup is current, three lines under a 结论 saying no genetic
   * reading exists.
   */
  it('把病历摘要写成文件而不是报告，并带上它的来源', () => {
    const transcription = {
      ...geneticReport({ d4z4Repeats: '3', haplotype: '4qA' }),
      id: 'doc-summary',
      documentType: 'medical_record',
      uploadedAt: '2026-03-01T12:00:00.000Z',
      ocrPayload: {
        fields: { classifiedType: 'medical_record', d4z4Repeats: '3', haplotype: '4qA' },
      },
    };
    const result = pack(base({ documents: [transcription] } as never));

    // The premise: this is the document the values come off, and it is
    // not the laboratory's.
    expect(result.diagnosis.valueOrigins.d4z4Repeats.documentId).toBe('doc-summary');
    expect(result.diagnosis.latestSourceKind).toBe('transcribed');

    expect(result.markdown).toContain(
      '本平台读作基因证据的文件（转录自非基因报告文件）：2026-03-01',
    );
    expect(result.markdown).not.toContain('本平台读作基因证据的报告');
    // The date is still printed — refusing to call the document a report
    // is not the same as withholding when it arrived.
    expect(result.markdown).toContain('2026-03-01');
  });

  it('没有任何可读作基因证据的文件时，那一行也不承诺一份报告', () => {
    const result = pack(base());
    expect(result.diagnosis.latestSourceKind).toBe('none');
    expect(result.markdown).toContain('本平台读作基因证据的文件：本平台无记录');
    expect(result.markdown).not.toContain('本平台读作基因证据的报告');
  });

  it('says what is missing, not that nothing was ever uploaded', () => {
    const result = pack(base());
    expect(result.diagnosis.confirmation).toBe('none');
    expect(result.diagnosis.statement).toContain('没有可展示的分型或诊断日期');
  });

  it('a methylation-only report still lands in none — so the line may not claim nothing was uploaded', () => {
    // 甲基化 is in none of the three tests that earn 基因确诊, and it is
    // neither 分型 nor 诊断日期, so this profile is `none` with a value
    // from an uploaded report printed three lines below the 结论. The
    // old line said 「本平台尚无任何诊断依据记录 —— 以下内容仅为患者自述
    // 与自测」 over exactly that.
    const result = pack(base({ documents: [geneticReport({ methylationValue: '32%' })] } as never));

    expect(result.diagnosis.confirmation).toBe('none');
    expect(result.diagnosis.statement).not.toContain('仅为患者自述与自测');
    expect(result.markdown).toContain('- 甲基化：32%（报告读取）');
    // AND THE 结论 MAY NOT DENY THE ROW UNDER IT. The flat 「也没有从基因
    // 报告里读出来的基因结果」 was printed over exactly this pack: a
    // 甲基化 this platform read off the genetics report, three lines
    // below, carrying 报告读取 as its source. What is missing is a
    // result that earns a confirmation, and 甲基化 is not one.
    expect(result.diagnosis.statement).toContain('可作确诊依据的基因结果');
    expect(result.markdown).not.toContain('也没有从基因报告里读出来的基因结果 ——');
  });

  /**
   * THE 结论 DOES NOT KEEP ITS OWN COPY OF THE CONFIRMATION RULE.
   *
   * These lines named the three tests that earn 基因确诊. That is
   * `confirmation`'s definition restated in prose, on a page that gets
   * printed and read weeks later, and it drifts the moment the rule
   * moves — a report that names both probes rather than stating a
   * haplotype has a 4q 单倍型 on it and confirms nothing, so a pack
   * promising the neurologist those three names tells them a report
   * they can see was never read.
   */
  it('未确诊的结论不复述「哪三项能构成确诊」', () => {
    (['self_reported', 'admin_entered', 'none'] as const).forEach((expected) => {
      const profile =
        expected === 'self_reported'
          ? base({ geneticMutation: 'FSHD1' } as never)
          : expected === 'none'
            ? base()
            : base({
                diagnosisDate: '2014-01-01',
                baseline: applyAdminBaselineWrite(
                  { foundation: { fullName: '张三' } },
                  { foundation: { fullName: '张三', diagnosisYear: 2014 } },
                  {
                    adminUserId: '11111111-2222-3333-4444-555555555555',
                    at: new Date('2026-08-13T04:11:07.912Z'),
                  },
                ),
              } as never);
      const result = pack(profile);
      expect(result.diagnosis.confirmation).toBe(expected);
      expect(result.diagnosis.statement).not.toContain('EcoRI 片段');
      expect(result.diagnosis.statement).not.toContain('4q 单倍型');
      expect(result.diagnosis.statement).toContain('可作确诊依据的基因结果');
    });
  });

  it('prints each diagnosis value with its own source, not one sentence for the block', () => {
    // The report carries 分型 and nothing else, so 分型 is the report's
    // and 诊断日期 is the patient's — two sources, one section. The
    // 结论 line used to say 「本人填报」 about both.
    const result = pack(
      base({
        diagnosisDate: '2019-05-03',
        documents: [geneticReport({ diagnosisType: 'FSHD1' })],
      } as never),
    );

    expect(result.diagnosis.confirmation).toBe('self_reported');
    expect(result.diagnosis.statement).not.toContain('本人填报');
    // A genetic report IS on file — it just carried nothing that
    // confirms — so the line may not say none was received.
    expect(result.diagnosis.statement).not.toContain('本平台未收到基因报告');
    expect(result.markdown).toContain('- 基因类型：FSHD1（报告读取）');
    // Two sources on one section, and neither of them is the patient by
    // name: the column behind 诊断日期 is written by the patient's own
    // endpoint and by the read-time autofill alike, with nothing
    // recording which.
    expect(result.markdown).toContain('- 诊断日期：2019-05-03（来源无法确定）');
  });

  it('an administrator marker lands on 诊断日期 alone and names the field it is on', () => {
    const result = pack(
      base({
        diagnosisDate: '2014-01-01',
        baseline: applyAdminBaselineWrite(
          { foundation: { fullName: '张三' } },
          { foundation: { fullName: '张三', diagnosisYear: 2014 } },
          {
            adminUserId: '11111111-2222-3333-4444-555555555555',
            at: new Date('2026-08-13T04:11:07.912Z'),
          },
        ),
        documents: [geneticReport({ diagnosisType: 'FSHD1' })],
      } as never),
    );

    expect(result.diagnosis.confirmation).toBe('admin_entered');
    expect(result.diagnosis.statement).toContain('「确诊年份」不是患者本人填写的');
    expect(result.markdown).toContain('- 诊断日期：2014-01-01（管理员代填）');
    expect(result.markdown).toContain('- 基因类型：FSHD1（报告读取）');
  });

  it('says 来源无法确定 when the column and an uploaded report both carry the date', () => {
    // profile.autofill.ts writes an empty `patient_profiles.diagnosis_date`
    // from a report at read time without recording that it did, so this
    // value is equally consistent with either source.
    const result = pack(
      base({
        diagnosisDate: '2019-05-03',
        documents: [geneticReport({ diagnosisDate: '2019-05-03' })],
      } as never),
    );

    expect(result.markdown).toContain('- 诊断日期：2019-05-03（来源无法确定）');
  });

  it('states the genetic result when there is one, and drops the warning', () => {
    const result = pack(
      base({ documents: [geneticReport({ d4z4Repeats: '6', haplotype: '4qA' })] } as never),
    );

    expect(result.diagnosis.confirmation).toBe('genetic');
    expect(result.diagnosis.statement).toContain('基因确诊');
    expect(result.diagnosis.statement).toContain('6');
    expect(result.markdown).not.toContain('请勿按已确诊处理');
  });

  it('puts the confirmation question at the top of the sheet only when unconfirmed', () => {
    const unconfirmed = pack(base({ geneticMutation: 'FSHD1' } as Partial<PatientProfileDTO>));
    expect(unconfirmed.questions[0]?.id).toBe('confirm-diagnosis');
    expect(unconfirmed.questions[0]?.hint).toContain(
      '本资料里没有从基因报告里读出来的、可作确诊依据的基因结果',
    );

    const confirmed = pack(
      base({ documents: [geneticReport({ d4z4Repeats: '6', haplotype: '4qA' })] } as never),
    );
    expect(confirmed.questions.some((question) => question.id === 'confirm-diagnosis')).toBe(false);
  });

  /**
   * A LABORATORY DID READ THIS PATIENT'S SAMPLE, so the unconfirmed
   * copy next door is false for them in both directions: it offers a
   * report this platform has not seen, and it asks them to upload the
   * one it has already read.
   */
  it('单倍型非允许型时，结论和提示都不当作「还没做过检测」来写', () => {
    const result = pack(
      base({
        documents: [geneticReport({ d4z4Repeats: '3', haplotype: '4qB' })],
      } as never),
    );

    expect(result.diagnosis.confirmation).toBe('genetic_non_permissive');
    expect(result.diagnosis.statement).toContain('不是允许型 4qA');
    expect(result.diagnosis.statement).toContain('请勿按已确诊处理');
    // Not a confirmation, and the repeat count is not set bare after the
    // diagnosis name where it would read as one.
    expect(result.diagnosis.statement).not.toContain('基因确诊；');
    // The row below still prints it, with the report named as its
    // source — refusing the confirmation is not withholding the result.
    expect(result.markdown).toContain('- D4Z4 重复数：3（报告读取）');

    const hint = result.questions.find((question) => question.id === 'confirm-diagnosis')?.hint;
    expect(hint).toContain('不是允许型 4qA');
    expect(hint).not.toContain('把报告带上或上传，这一行就会改');
  });

  /**
   * 这张纸印着一个读数，又在两行之上说本资料里没有可作确诊依据的基因
   * 结果 —— 拿着它的是罕见病诊疗协作网的神经内科医生，十秒钟之内没法
   * 跟患者核对任何一行。护照那一段已经把这句话写好了，这张纸此前只从
   * 那一段里取了「来源是哪一类文件」。
   */
  it.each([
    ['以 kb 写的长度', { d4z4Repeats: '18kb' }, '18kb', '本平台不在 kb 和重复单元数之间做换算'],
    ['读到 0 的重复数', { d4z4Repeats: '0' }, '0', '本平台读不通这个数'],
  ])('结论下面就写着那个数为什么什么都没换来：%s', (_name, fields, cell, sentence) => {
    const result = pack(
      base({
        geneticMutation: 'FSHD1',
        documents: [geneticReport(fields as Record<string, string>)],
      } as never),
    );

    expect(result.diagnosis.confirmation).not.toBe('genetic');
    expect(result.markdown).toContain(`- D4Z4 重复数：${cell}（报告读取）`);
    expect(result.diagnosis.readingsNotJudged).toContain(sentence);
    expect(result.markdown).toContain(`- ${result.diagnosis.readingsNotJudged}`);
    // 紧接着它要解释的那一句，而不是排在四行值的后面。
    const noteIndex = result.markdown.indexOf(result.diagnosis.readingsNotJudged ?? '');
    expect(noteIndex).toBeGreaterThan(result.markdown.indexOf('- 结论：'));
    expect(noteIndex).toBeLessThan(result.markdown.indexOf('- 基因类型：'));
  });

  it('确诊那一档没有这一行 —— 那一档什么都没扣下', () => {
    const result = pack(
      base({
        documents: [geneticReport({ d4z4Repeats: '6', haplotype: '4qA', ecoRIFragment: '18kb' })],
      } as never),
    );
    expect(result.diagnosis.confirmation).toBe('genetic');
    expect(result.diagnosis.readingsNotJudged).toBeNull();
    expect(result.markdown).not.toContain('本平台不在 kb 和重复单元数之间做换算');
  });

  /**
   * 上面那一行只管本平台什么都没拿来衡量的读数 —— 以 kb 写的长度、读到
   * 0 的那一格。一个 30 不是这两种：它解析得出来，是实验室自己的数，而且
   * 本平台确实拿指南写的界限衡量过它，是它没过。于是这张纸印着 「本资料
   * 里没有从基因报告里读出来的、可作确诊依据的基因结果」，四行之下印着
   * 「D4Z4 重复数：30（报告读取）」，中间照旧没有一句话。
   */
  it.each([
    ['大于指南所说的 10', { d4z4Repeats: '30', haplotype: '4qA' }, '30'],
    ['报告没写单倍型', { d4z4Repeats: '6' }, '6'],
  ])('结论否认的那个重复数，下面就写着它为什么没换来确诊：%s', (_name, fields, cell) => {
    const profile = base({
      geneticMutation: 'FSHD1',
      documents: [geneticReport(fields as Record<string, string>)],
    } as never);
    const result = pack(profile);
    const evidence = buildClinicalPassportSummary(profile).diagnosis.geneticEvidence;

    expect(result.diagnosis.confirmation).not.toBe('genetic');
    expect(result.markdown).toContain(`- D4Z4 重复数：${cell}（报告读取）`);
    // 护照自己写好的那一句，原样搬过来 —— 不另起一套措辞。
    expect(result.diagnosis.repeatCountNotConfirming).toBe(evidence.headline);
    expect(result.markdown).toContain(`- ${result.diagnosis.repeatCountNotConfirming}`);
    const noteIndex = result.markdown.indexOf(result.diagnosis.repeatCountNotConfirming ?? '');
    expect(noteIndex).toBeGreaterThan(result.markdown.indexOf('- 结论：'));
    expect(noteIndex).toBeLessThan(result.markdown.indexOf('- 基因类型：'));
  });

  it('一份报告同时欠两句话时，两句都印 —— 它们不是二选一', () => {
    const result = pack(
      base({
        geneticMutation: 'FSHD1',
        documents: [geneticReport({ d4z4Repeats: '30', ecoRIFragment: '18kb' })],
      } as never),
    );
    expect(result.diagnosis.repeatCountNotConfirming).toContain('大于指南所说的 10');
    expect(result.diagnosis.readingsNotJudged).toContain('不在 kb 和重复单元数之间做换算');
    expect(result.markdown).toContain(`- ${result.diagnosis.repeatCountNotConfirming}`);
    expect(result.markdown).toContain(`- ${result.diagnosis.readingsNotJudged}`);
  });

  it.each([
    ['确诊那一档', { d4z4Repeats: '6', haplotype: '4qA' }],
    ['单倍型非允许型那一档 —— 结论开头就是这句话', { d4z4Repeats: '6', haplotype: '4qB' }],
  ])('结论自己已经说清楚的，不再复读一遍：%s', (_name, fields) => {
    const result = pack(
      base({ documents: [geneticReport(fields as Record<string, string>)] } as never),
    );
    expect(result.diagnosis.repeatCountNotConfirming).toBeNull();
  });

  /**
   * 灰区那一段护照屏幕印、待办里印、导出的 markdown 里也印，唯独这张纸
   * 不印 —— 而这张纸是罕见病诊疗协作网的神经内科医生手里那一份。一份读
   * 到 D4Z4 9 / 4qA 的报告，患者自己那份护照上带着「这一项结果本身带着
   * 不确定性」，递到医生手里的这份只有「基因确诊；D4Z4 重复数 9」。
   */
  it.each([
    ['确诊那一档', { d4z4Repeats: '9', haplotype: '4qA' }, 'genetic'],
    ['报告没写单倍型', { d4z4Repeats: '9' }, 'self_reported'],
  ])('灰区里的重复数，两份材料说的是同一句话：%s', (_name, fields, confirmation) => {
    const profile = base({
      geneticMutation: 'FSHD1',
      documents: [geneticReport(fields as Record<string, string>)],
    } as never);
    const result = pack(profile);
    const evidence = buildClinicalPassportSummary(profile).diagnosis.geneticEvidence;

    expect(result.diagnosis.confirmation).toBe(confirmation);
    expect(result.diagnosis.greyZoneNote).toBe(evidence.greyZoneNote);
    // 导出的 markdown 给这一段的前缀，一模一样地照用。
    expect(result.markdown).toContain(`- 灰区提示：${evidence.greyZoneNote}`);
    const noteIndex = result.markdown.indexOf('- 灰区提示：');
    expect(noteIndex).toBeGreaterThan(result.markdown.indexOf('- 结论：'));
    expect(noteIndex).toBeLessThan(result.markdown.indexOf('- 基因类型：'));
  });

  it('不在灰区就不提灰区', () => {
    const result = pack(
      base({ documents: [geneticReport({ d4z4Repeats: '6', haplotype: '4qA' })] } as never),
    );
    expect(result.diagnosis.greyZoneNote).toBeNull();
    expect(result.markdown).not.toContain('灰区提示');
  });

  /**
   * 「做过基因检测的话，把报告带上或上传」对着一个报告已经传上来、也已经
   * 被读过的人是一句假话 —— 4qB 那一档早就因为这个理由把它去掉了，而
   * `confirmation` 分不出这两种人：以 kb 写的长度、读到 0 的重复数、缺
   * 单倍型的重复数，落到的都是 self_reported。
   */
  it('报告已经在平台上读过时，不再让人去传一份已经传过的报告', () => {
    const readAlready = pack(
      base({
        geneticMutation: 'FSHD1',
        documents: [geneticReport({ d4z4Repeats: '18kb' })],
      } as never),
    );
    const hint = readAlready.questions.find((q) => q.id === 'confirm-diagnosis')?.hint;
    expect(readAlready.diagnosis.confirmation).toBe('self_reported');
    expect(hint).toContain('本资料里没有从基因报告里读出来的、可作确诊依据的基因结果');
    expect(hint).not.toContain('把报告带上或上传');

    // 转录件和「一份都没有」这两种人照旧要被问一句 —— 对他们这句话是真的。
    const transcribed = pack(
      base({
        geneticMutation: 'FSHD1',
        documents: [
          {
            ...geneticReport({ d4z4Repeats: '6', haplotype: '4qA' }),
            documentType: 'medical_record',
            ocrPayload: {
              fields: {
                classifiedType: 'medical_record',
                d4z4Repeats: '6',
                haplotype: '4qA',
              },
            },
          },
        ],
      } as never),
    );
    expect(transcribed.questions.find((q) => q.id === 'confirm-diagnosis')?.hint).toContain(
      '把报告带上或上传',
    );
    expect(
      pack(base({ geneticMutation: 'FSHD1' } as Partial<PatientProfileDTO>)).questions.find(
        (q) => q.id === 'confirm-diagnosis',
      )?.hint,
    ).toContain('把报告带上或上传');
  });
});

/**
 * 基线里的基因数值，落在这张纸上。
 *
 * 拿着这张纸的是罕见病诊疗协作网的神经内科医生，他十秒钟之内没有办法
 * 跟患者核对任何一行。只读上传报告的话，这一节会同时印着 「结论：…… 本
 * 资料里没有 D4Z4 重复数、4q 单倍型或 EcoRI 片段」 和四行之下的 「D4Z4
 * 重复数：—」，而同一份档案的 TREAT-NMD 导出里带着 6 和 4qA —— 确诊
 * FSHD1 的那一对。国内能做长片段检测的中心只有几家，那句假话的代价是
 * 一次重测或一次错过的入组转诊。
 */
describe('基线里的基因数值印在转诊资料上', () => {
  const ADMIN_ID = '11111111-2222-3333-4444-555555555555';
  const AT = new Date('2026-08-01T02:03:04.000Z');

  /** 三个基因数值上都压着后台的来源记录。`applyAdminBaselineWrite` 不收
   *  这几条路径，所以这个块是照着盘上的样子写死的 —— 而这张纸仍然要把
   *  记录上的名字印出来。 */
  const storedMarkers = (
    baseline: Record<string, unknown>,
    paths: readonly string[],
  ): Record<string, unknown> => ({
    ...baseline,
    [BASELINE_PROVENANCE_KEY]: Object.fromEntries(
      paths.map((path) => [
        path,
        { source: 'admin_entered', adminUserId: ADMIN_ID, at: AT.toISOString() },
      ]),
    ),
  });

  const markedGenetics = (over: Partial<PatientProfileDTO> = {}) =>
    base({
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
    } as Partial<PatientProfileDTO>);

  it('值印出来，每一行后面写着是谁填的', () => {
    const result = pack(markedGenetics());

    expect(result.markdown).toContain('- D4Z4 重复数：6（管理员代填）');
    expect(result.markdown).toContain('- 甲基化：25%（管理员代填）');
    expect(result.markdown).toContain('- 基因类型：FSHD1（管理员代填）');
    expect(result.markdown).not.toContain('- D4Z4 重复数：—');
  });

  it('结论说的是没有报告可读，不是「这份资料里没有这个数」', () => {
    const result = pack(markedGenetics());

    // `confirmation` 只看 确诊年份 那一个标记，这份档案上它没有。
    expect(result.diagnosis.confirmation).toBe('self_reported');
    expect(result.diagnosis.statement).toContain('没有从基因报告里读出来的');
    expect(result.diagnosis.statement).toContain('请勿按已确诊处理');
    // 这句话与三行之下的 「D4Z4 重复数：6（管理员代填）」 直接矛盾。
    expect(result.diagnosis.statement).not.toContain('本资料里没有 D4Z4 重复数、');
  });

  /**
   * §B3 那份清单和上面那几行说的是同一批字段。清单里出现 「D4Z4 重复数」
   * 而值那一行印着 「—」，是同一页纸自己跟自己打架。
   */
  it('§B3 清单里点名的字段，上面都印着值', () => {
    const result = pack(markedGenetics());
    const section = result.markdown.split('## 二、')[0];

    expect(section).toContain('### 这些字段不是本人填写的');
    expect(section).toContain('D4Z4 重复数：本平台管理员');
    expect(section).toContain('甲基化：本平台管理员');
    expect(section).toContain('- D4Z4 重复数：6（管理员代填）');
    expect(section).toContain('- 甲基化：25%（管理员代填）');
  });

  it('没有来源记录时，每一行都标「来源无法确定」', () => {
    const result = pack(
      base({
        diagnosisDate: '2019-01-01',
        baseline: {
          foundation: { diagnosisYear: 2019 },
          diseaseBackground: { d4z4: '6', methylation: '25%', diagnosisType: 'FSHD1' },
        },
      } as Partial<PatientProfileDTO>),
    );

    // 这份资料是递到接诊医生手上的。「没有来源记录」说的是本平台没记，
    // 不是这些值由患者本人录入 —— 档案里的基因数值也可能是读取时由报告
    // 自动补进去的，那份报告事后还可以被删掉。
    expect(result.diagnosis.confirmation).toBe('self_reported');
    expect(result.markdown).toContain('- D4Z4 重复数：6（来源无法确定）');
    expect(result.markdown).toContain('- 基因类型：FSHD1（来源无法确定）');
    expect(result.markdown).toContain('- 甲基化：25%（来源无法确定）');
  });

  it('报告里有数时印报告那个，标「报告读取」', () => {
    const result = pack(
      markedGenetics({
        documents: [geneticReport({ d4z4Repeats: '4' })],
      } as unknown as Partial<PatientProfileDTO>),
    );

    expect(result.markdown).toContain('- D4Z4 重复数：4（报告读取）');
    expect(result.markdown).not.toContain('- D4Z4 重复数：6');
  });

  /**
   * 报告里只有单倍型时 `confirmation` 已经是 `genetic`，而 「D4Z4 重复数」
   * 那一行印的仍是后台代填的数字。把那个数字接在 「基因确诊；」 后面，等于
   * 把实验室的分量借给了一个电话里念来的数 —— 那一行自己带着括号，结论
   * 不再重复它。
   */
  /**
   * 后台只代填了基因数值、没碰确诊年份时，`confirmation` 落在
   * `self_reported` —— 它只看 确诊年份 那一个标记。而这一档给患者的那句
   * 提示要是把来源列成「要么你自己填的，要么你上传的报告」，就等于当着
   * 患者的面否掉了同一页上那几行 「管理员代填」。
   */
  it('给患者的提示不把来源列成一张漏项的单子', () => {
    const result = pack(
      base({
        baseline: storedMarkers({ diseaseBackground: { d4z4: '6', diagnosisType: 'FSHD1' } }, [
          'diseaseBackground.d4z4',
          'diseaseBackground.diagnosisType',
        ]),
      } as Partial<PatientProfileDTO>),
    );

    expect(result.diagnosis.confirmation).toBe('self_reported');
    expect(result.markdown).toContain('- D4Z4 重复数：6（管理员代填）');
    expect(result.questions[0]?.hint).not.toContain(
      '有的是你自己填的，有的是系统从你上传的报告里读出来的',
    );
  });

  it('结论里的重复数只写实验室报告自己写明的那一个', () => {
    const result = pack(
      markedGenetics({
        documents: [geneticReport({ haplotype: '4qA', d4z4Repeats: '4' })],
      } as unknown as Partial<PatientProfileDTO>),
    );

    expect(result.diagnosis.confirmation).toBe('genetic');
    expect(result.diagnosis.statement).toBe(
      '面肩肱型肌营养不良症（FSHD），基因确诊；D4Z4 重复数 4',
    );
    // 后台代填的那个数没有接在「基因确诊；」后面 —— 它在下面那一行，
    // 带着自己的括号。
    expect(result.diagnosis.statement).not.toContain('6');
    expect(result.markdown).toContain('- D4Z4 重复数：4（报告读取）');
  });

  /**
   * 「结论」那一句问的是这一格写着什么，不是这一行是从哪来的。
   *
   * 这里以前问的是 `valueOrigins.d4z4Repeats.kind === 'report'` —— 那是
   * 在问「这一行是不是从某份文件里读出来的」。报告的重复数那一格写着区间
   * 「1-10」、确诊是 EcoRI 片段挣来的时候，递到协作网神经内科医生手上的
   * 那一句就是「面肩肱型肌营养不良症（FSHD），基因确诊；D4Z4 重复数
   * 1-10」。
   */
  it('报告那一格是区间时，结论里不带这个数', () => {
    const result = pack(
      base({
        documents: [
          geneticReport({ d4z4Repeats: '1-10', ecoRIFragment: '18kb', haplotype: '4qA' }),
        ],
      } as unknown as Partial<PatientProfileDTO>),
    );

    // kb 不参与确诊，所以这一行根本到不了「基因确诊」。
    expect(result.diagnosis.confirmation).not.toBe('genetic');
    expect(result.diagnosis.statement).not.toContain('基因确诊；');
    // 区间照旧印在它自己那一行上，带着「报告读取」。
    expect(result.markdown).toContain('- D4Z4 重复数：1-10（报告读取）');
  });
});

/**
 * The fourth source (§B3, baseline-provenance.ts). It was added to
 * `PassportDiagnosisConfirmation` without this file being told, and
 * referral-pack.ts dropped it into the last arm of the branches that
 * had only ever seen three: the 结论 printed 「本平台尚无任何诊断依据
 * 记录 —— 以下内容仅为患者自述与自测」 four lines above the 诊断日期 an
 * administrator had typed, and the 提问清单 told the patient 「本平台
 * 没有任何诊断依据记录」 about lines the neurologist was reading on the
 * same sheet.
 *
 * The `never` defaults that replaced those ternaries fail the build on
 * a fifth state; these tests are the other half — they fail if someone
 * adds the branch and gives it the `none` wording anyway.
 */
describe('第四种来源 — a value our own back office typed', () => {
  const ADMIN_ID = '11111111-2222-3333-4444-555555555555';
  const AT = new Date('2026-08-13T04:11:07.912Z');

  /** Built with the real helper rather than a hand-written provenance
   *  block, so a reshape of that block breaks this test instead of
   *  passing it. */
  const adminTypedDiagnosis = () =>
    base({
      // What makes the passport consider a diagnosis claimed at all.
      diagnosisDate: '2014-01-01',
      baseline: applyAdminBaselineWrite(
        { foundation: { fullName: '张三' } },
        {
          foundation: { fullName: '张三', diagnosisYear: 2014 },
          diseaseBackground: { familyHistory: '母亲也有类似症状' },
        },
        { adminUserId: ADMIN_ID, at: AT },
      ),
    } as Partial<PatientProfileDTO>);

  it('does not print 尚无任何诊断依据记录 over a diagnosis an administrator typed', () => {
    const result = pack(adminTypedDiagnosis());

    expect(result.diagnosis.confirmation).toBe('admin_entered');
    // The two sentences the old else arm printed, verbatim. Both were
    // false about this patient, and the second attributed our own
    // staff's transcription to them.
    expect(result.diagnosis.statement).not.toContain('尚无任何诊断依据记录');
    expect(result.diagnosis.statement).not.toContain('患者自述与自测');
    expect(result.markdown).not.toContain('尚无任何诊断依据记录');

    expect(result.diagnosis.statement).toContain('不是患者本人填写');
    expect(result.diagnosis.statement).toContain('请勿按已确诊处理');
    // Not 「管理员代为录入」: `confirmation` alone cannot prove who
    // typed the value. Who and when is the 字段来源 list below.
    expect(result.diagnosis.statement).not.toContain('管理员');
    expect(result.markdown).toContain(result.diagnosis.statement);
  });

  it('tells the patient the diagnosis lines are there and are not theirs', () => {
    const result = pack(adminTypedDiagnosis());
    const hint = result.questions[0];

    expect(hint?.id).toBe('confirm-diagnosis');
    // 「本平台没有任何诊断依据记录」 would hide from the patient the very
    // lines the neurologist is reading on the same sheet.
    expect(hint?.hint).not.toContain('本平台没有任何诊断依据记录');
    expect(hint?.hint).toContain('不是你自己填的');
    expect(hint?.hint).not.toContain('管理员');
    // The hint sends the patient to a list. It has to be on the page —
    // and it must not promise a name or a time, because this state also
    // covers a marker that is present and unparseable, where the list
    // says 来源记录读不出来 and no name exists to find.
    expect(hint?.hint).toContain('第一节末尾');
    expect(hint?.hint).not.toContain('是谁');
    expect(hint?.hint).not.toContain('什么时候');
    expect(result.markdown).toContain('### 这些字段不是本人填写的');
  });

  it('lists the marked fields in 一、诊断依据, with who and when', () => {
    const result = pack(adminTypedDiagnosis());

    expect(result.markdown).toContain('### 这些字段不是本人填写的');
    expect(result.markdown).toContain('确诊年份');
    // 家族史 has no row of its own anywhere in 一、诊断依据, so the list
    // is the only place a reader meets it — which is the entry that
    // would go missing if the section were derived from the printed
    // rows instead of from the provenance block.
    expect(result.markdown).toContain('家族史');
    expect(result.markdown).toContain(ADMIN_ID);
    // THE DAY, NOT THE INSTANT. This line asserted `AT.toISOString()`,
    // which is what the pack printed: 「本平台管理员于
    // 2026-08-13T04:11:07.912Z 代为录入」, a machine timestamp on a sheet
    // a neurologist reads, while the markdown export, the share page
    // and the mobile PDF each printed a calendar day for the same
    // event. See formatFieldOriginLine in referral-pack.ts and the
    // four-document comparison in profile.passport.dates.test.ts.
    expect(result.markdown).toContain('本平台管理员于 2026-08-13 代为录入');
    expect(result.markdown).not.toContain(AT.toISOString());

    // The note at the top promises the list is 「在第一节末尾」. It has to
    // be there, not after 功能测试.
    const listIndex = result.markdown.indexOf('### 这些字段不是本人填写的');
    expect(listIndex).toBeGreaterThan(result.markdown.indexOf('## 一、诊断依据'));
    expect(listIndex).toBeLessThan(result.markdown.indexOf('## 二、功能测试'));
  });

  /**
   * The other half of `admin_entered`: a marker that is there and does
   * not parse. `applyAdminBaselineWrite` cannot produce one, so this
   * fixture writes the block by hand — the only way it happens in
   * production too (a hand-written UPDATE, a half-applied shape).
   */
  const unreadableDiagnosisMarker = () =>
    base({
      diagnosisDate: '2014-01-01',
      baseline: {
        foundation: { fullName: '张三', diagnosisYear: 2014 },
        [BASELINE_PROVENANCE_KEY]: {
          'foundation.diagnosisYear': {
            source: 'admin_entered',
            adminUserId: 'not-a-user-id',
            at: AT.toISOString(),
          },
        },
      },
    } as Partial<PatientProfileDTO>);

  it('names nobody when the marker is there and cannot be read', () => {
    const result = pack(unreadableDiagnosisMarker());

    // Same state — the one thing it may never fall back to is 「本人填写」.
    expect(result.diagnosis.confirmation).toBe('admin_entered');
    // And here the platform cannot say who typed it. The 字段来源 list
    // at the end of the same section says 「读不出来」 about this very
    // field, so a 结论 naming an administrator would contradict it
    // across one sheet of paper handed to one neurologist.
    expect(result.diagnosis.statement).not.toContain('管理员');
    expect(result.questions[0]?.hint).not.toContain('管理员');
    expect(result.markdown).toContain('确诊年份：来源记录读不出来');
  });

  it('prints no such heading for a patient whose baseline nobody else touched', () => {
    const result = pack(base({ baseline: { foundation: { diagnosisYear: 2014 } } } as never));

    expect(result.markdown).not.toContain('这些字段不是本人填写的');
    expect(result.markdown).not.toContain(ADMIN_ID);
  });
});

describe('功能测试 —「当天做不了」 is a row, not a gap', () => {
  it('keeps a notApplicable attempt as its own dated observation', () => {
    const result = pack(
      base({
        functionTests: [
          functionTest({ performedAt: '2026-01-05T12:00:00.000Z', measuredValue: 11 }),
          functionTest({
            performedAt: '2026-05-05T12:00:00.000Z',
            measuredValue: null,
            notApplicable: true,
          }),
        ] as unknown as PatientProfileDTO['functionTests'],
      }),
    );

    const series = result.functionTests.find((entry) => entry.testType === 'ten_meter_walk');
    expect(series?.points).toHaveLength(2);
    expect(series?.points[1]?.outcome).toBe('unable');
    expect(series?.hasUnableEntries).toBe(true);
    expect(result.markdown).toContain('2026-05-05：当天尝试后无法完成');
  });

  it('adds a question about the tests the patient can no longer complete', () => {
    const result = pack(
      base({
        functionTests: [
          functionTest({
            testType: 'sit_to_stand',
            measuredValue: null,
            notApplicable: true,
          }),
        ] as unknown as PatientProfileDTO['functionTests'],
      }),
    );

    const question = result.questions.find((entry) => entry.id === 'unable-tests');
    expect(question).toBeDefined();
    expect(question?.prompt).toContain('坐站转换');
  });

  it('does not add that question when every attempt produced a value', () => {
    const result = pack(
      base({
        functionTests: [functionTest({})] as unknown as PatientProfileDTO['functionTests'],
      }),
    );
    expect(result.questions.some((entry) => entry.id === 'unable-tests')).toBe(false);
  });

  it('orders each series oldest first so it reads as a trend', () => {
    const result = pack(
      base({
        functionTests: [
          functionTest({ performedAt: '2026-06-01T12:00:00.000Z', measuredValue: 20 }),
          functionTest({ performedAt: '2026-01-01T12:00:00.000Z', measuredValue: 10 }),
        ] as unknown as PatientProfileDTO['functionTests'],
      }),
    );

    const series = result.functionTests[0];
    expect(series?.points.map((point) => point.measuredValue)).toEqual([10, 20]);
  });

  it('caps a long series and says how many rows were dropped', () => {
    const many = Array.from({ length: REFERRAL_MAX_POINTS_PER_SERIES + 4 }, (_, index) =>
      functionTest({
        performedAt: `2026-0${(index % 9) + 1}-0${(index % 9) + 1}T12:00:00.000Z`,
        measuredValue: index + 1,
      }),
    );

    const result = pack(
      base({ functionTests: many as unknown as PatientProfileDTO['functionTests'] }),
    );
    const series = result.functionTests[0];

    expect(series?.points).toHaveLength(REFERRAL_MAX_POINTS_PER_SERIES);
    expect(series?.omittedEarlierCount).toBe(4);
    expect(result.markdown).toContain('另有 4 次更早的记录未列出');
  });

  it('says so plainly when there are no function tests at all', () => {
    const result = pack(base());
    expect(result.functionTests).toHaveLength(0);
    expect(result.markdown).toContain('本平台没有功能测试记录 —— 不等于没有做过');
  });

  it('renders the unit, side and assistance qualifiers a clinician needs', () => {
    const result = pack(
      base({
        functionTests: [
          functionTest({
            testType: 'six_minute_walk',
            measuredValue: 320,
            unit: 'm',
            side: 'bilateral',
            assistanceRequired: true,
            deviceUsed: 'AFO',
          }),
        ] as unknown as PatientProfileDTO['functionTests'],
      }),
    );

    expect(result.markdown).toContain('6 分钟步行');
    expect(result.markdown).toContain('320米');
    expect(result.markdown).toContain('需要他人协助');
    expect(result.markdown).toContain('器械：AFO');
  });
});

describe('辅具 — three record states, none of them 「无辅具」', () => {
  it('lists devices the patient selected', () => {
    const result = pack(
      base({
        baseline: { currentStatus: { assistiveDevices: ['AFO', '轮椅'] } } as Record<
          string,
          unknown
        >,
      }),
    );

    expect(result.devices.state).toBe('listed');
    expect(result.devices.devices).toEqual(['AFO', '轮椅']);
    expect(result.markdown).toContain('辅具：AFO、轮椅');
  });

  it('distinguishes 「问卷交了，一项没勾」 from 「这一节没填过」', () => {
    const noneSelected = pack(
      base({
        baseline: { currentStatus: { assistiveDevices: [] } } as Record<string, unknown>,
      }),
    );
    expect(noneSelected.devices.state).toBe('none_selected');
    expect(noneSelected.devices.note).toContain('这不等于患者说自己不需要辅具');

    const notRecorded = pack(base());
    expect(notRecorded.devices.state).toBe('not_recorded');
    expect(notRecorded.devices.note).toContain('不等于没有使用辅具');

    expect(noneSelected.devices.note).not.toBe(notRecorded.devices.note);
  });

  it('never prints an absence as a fact about the patient', () => {
    const result = pack(base());
    expect(result.markdown).not.toContain('无辅具使用');
    expect(result.markdown).toContain('本平台无可列出的辅具');
  });

  it('keeps 「开始使用轮椅」 as a dated transition, not a current device', () => {
    const result = pack(
      base({
        followupEvents: [
          followupEvent({
            eventType: 'started_wheelchair',
            occurredAt: '2024-04-01T12:00:00.000Z',
          }),
        ] as unknown as PatientProfileDTO['followupEvents'],
      }),
    );

    expect(result.devices.devices).toEqual([]);
    expect(result.devices.startEvents).toHaveLength(1);
    expect(result.devices.startEvents[0]?.label).toBe('开始使用轮椅');
    expect(result.markdown).toContain('开始使用轮椅：2024-04-01');
    expect(result.markdown).toContain('不代表目前的使用情况');
  });

  /**
   * A YEAR-ONLY ANSWER IS NOT A 1 JANUARY OBSERVATION.
   *
   * `patient_followup_events.occurred_at` is TIMESTAMPTZ NOT NULL and
   * has no precision column beside it, so a patient who says they
   * started using a wheelchair 「2019 年」 produces the first instant of
   * 2019. This pack used to put that instant through `formatDate` and
   * print a calendar day — and, formatting a UTC instant through
   * local-time accessors, print a day in the WRONG YEAR on any host
   * behind Greenwich — and then assert underneath it that the record is
   * of 「某一天发生过的转变」. The portable exports resolve the same
   * column through `resolveOccurrenceDate` and tell their receiver
   * `pinnedToYearStart: true` and 「请不要把它当作精确到天的观察」; the
   * FHIR bundle emits the bare year. One profile, one run, and the two
   * documents disagreed about when this person started using a
   * wheelchair — in front of the 协作网 neurologist least able to check
   * which was right.
   */
  it('只知道年份的起始事件，只印年份 —— 不印 1 月 1 日，也不说某一天', () => {
    const result = pack(
      base({
        followupEvents: [
          followupEvent({
            eventType: 'started_wheelchair',
            occurredAt: '2019-01-01T00:00:00.000Z',
          }),
        ] as unknown as PatientProfileDTO['followupEvents'],
      }),
    );

    expect(result.devices.startEvents[0]?.occurrence).toMatchObject({
      timestamp: '2019-01-01T00:00:00.000Z',
      precision: 'unrecorded',
      pinnedToYearStart: true,
      storedYear: 2019,
    });
    expect(result.markdown).toContain('开始使用轮椅：2019 年');
    expect(result.markdown).not.toContain('2019-01-01');
    expect(result.markdown).not.toContain('2018-12-31');
    // The tail no longer asserts a precision the column cannot carry.
    expect(result.markdown).not.toContain('某一天发生过的转变');
    expect(result.markdown).toContain('请不要当作精确到天的观察');
    expect(result.markdown).toContain('不写 1 月 1 日');
  });

  /**
   * AND A REAL MID-YEAR INSTANT KEEPS ITS DAY. `pinnedToYearStart` is a
   * fact about the stored value, not a guess at what the patient meant;
   * rounding an unpinned row down would throw away precision this
   * platform actually has, and the marker would then be on a row it is
   * false of.
   */
  it('真正落在年中的起始事件，照常印日期，且不标「仅到年份」', () => {
    const result = pack(
      base({
        followupEvents: [
          followupEvent({ eventType: 'started_afo', occurredAt: '2021-06-09T02:00:00.000Z' }),
        ] as unknown as PatientProfileDTO['followupEvents'],
      }),
    );

    expect(result.devices.startEvents[0]?.occurrence.pinnedToYearStart).toBe(false);
    expect(result.markdown).not.toContain('仅到年份');
    expect(result.markdown).not.toContain('不写 1 月 1 日');
    // Still says the precision is unrecorded, because it is: the
    // column has no precision for ANY row.
    expect(result.markdown).toContain('请不要当作精确到天的观察');
  });

  /**
   * ONE PROFILE, ONE RUN, TWO READERS — the check the per-file suites
   * on either side could not make. The pack's answer and the FHIR
   * bundle's answer come off the same `occurred_at`, and the whole
   * defect was that they were computed by two different renderers.
   * They share a resolver now, so this asserts the outputs agree rather
   * than that the call was made.
   */
  it('同一份档案同一次运行里，转诊资料和 FHIR 说的是同一个时间', () => {
    const profile = base({
      followupEvents: [
        followupEvent({ eventType: 'started_wheelchair', occurredAt: '2019-01-01T00:00:00.000Z' }),
      ] as unknown as PatientProfileDTO['followupEvents'],
    });
    const result = pack(profile);
    const wheelchair = buildFhirExport(
      normaliseSource(profile, { includeLocalOnly: false, generatedAt: FIXTURE_GENERATED_AT }),
    )
      .document.entry.map((entry) => entry.resource)
      .find(
        (resource) => (resource.code as { text?: string } | undefined)?.text === '开始使用轮椅',
      );

    // FHIR reduces a year-pinned instant to a bare 「2019」; the pack
    // prints 「2019 年」. Same year, same claim, neither a day.
    expect(wheelchair?.effectiveDateTime).toBe('2019');
    expect(result.markdown).toContain(`开始使用轮椅：${wheelchair?.effectiveDateTime} 年`);
  });

  it('warns that a migrated 「需要辅助」 may mean 「走不了」', () => {
    const assisted = pack(
      base({
        baseline: { currentStatus: { independentlyAmbulatory: 'assisted' } } as Record<
          string,
          unknown
        >,
      }),
    );
    expect(assisted.devices.ambulation).toBe('assisted');
    expect(assisted.devices.ambulationCaveat).toContain('无法行走的患者当时只能选');
    expect(assisted.markdown).toContain('无法行走的患者当时只能选');

    const unable = pack(
      base({
        baseline: { currentStatus: { independentlyAmbulatory: 'unable' } } as Record<
          string,
          unknown
        >,
      }),
    );
    expect(unable.devices.ambulationCaveat).toBeNull();
    expect(unable.devices.ambulationLabel).toContain('无法行走');
  });

  it('does not claim normal walking when nothing was recorded', () => {
    const result = pack(base());
    expect(result.devices.ambulation).toBeNull();
    expect(result.devices.ambulationLabel).toContain('不等于行走正常');
  });
});

describe('呼吸支持', () => {
  it('reports an NIV start date without claiming current use', () => {
    const result = pack(
      base({
        followupEvents: [
          followupEvent({ eventType: 'started_niv', occurredAt: '2025-09-15T12:00:00.000Z' }),
        ] as unknown as PatientProfileDTO['followupEvents'],
      }),
    );

    expect(result.respiratory.nivStart?.timestamp).toBe('2025-09-15T12:00:00.000Z');
    expect(result.respiratory.statement).toContain('2025-09-15');
    expect(result.respiratory.statement).toContain('请当面核实');
    // The NIV event is respiratory support, not an assistive device.
    expect(result.devices.startEvents).toHaveLength(0);
  });

  it('does not read a missing NIV record as「不需要通气」', () => {
    const result = pack(base());
    expect(result.respiratory.nivStart).toBeNull();
    expect(result.respiratory.statement).toContain('不等于没有使用');
  });

  /** The NIV start reads off the same column as the device milestones
   *  and was printed by the same `formatDate`, so it carried the same
   *  fabricated day. 呼吸支持 and 辅具 must not answer this differently:
   *  they are one kind of record. */
  it('只知道年份的无创通气起始时间，也只印年份', () => {
    const result = pack(
      base({
        followupEvents: [
          followupEvent({ eventType: 'started_niv', occurredAt: '2022-01-01T00:00:00.000Z' }),
        ] as unknown as PatientProfileDTO['followupEvents'],
      }),
    );

    expect(result.respiratory.nivStart).toMatchObject({
      timestamp: '2022-01-01T00:00:00.000Z',
      precision: 'unrecorded',
      pinnedToYearStart: true,
    });
    expect(result.respiratory.statement).toContain('时间 2022 年');
    expect(result.respiratory.statement).not.toContain('2022-01-01');
    expect(result.respiratory.statement).not.toContain('2021-12-31');
    expect(result.respiratory.statement).toContain('请不要当作精确到天的观察');
    expect(result.respiratory.statement).toContain('请当面核实');
  });

  it('carries the patient-reported breathing symptom answer as three states', () => {
    expect(pack(base()).respiratory.breathingSymptomsRecorded).toBeNull();
    expect(
      pack(
        base({
          baseline: { currentStatus: { breathingSymptoms: false } } as Record<string, unknown>,
        }),
      ).respiratory.breathingSymptomsRecorded,
    ).toBe(false);
    expect(
      pack(
        base({
          baseline: { currentStatus: { breathingSymptoms: true } } as Record<string, unknown>,
        }),
      ).respiratory.breathingSymptomsRecorded,
    ).toBe(true);
    expect(pack(base()).markdown).toContain('呼吸相关症状（患者自填）：未填写');
  });
});

describe('系统监测三项 — present / unreadable / absent survive to the page', () => {
  it('emits all three slots', () => {
    const result = pack(base());
    expect(result.monitoring.map((slot) => slot.key)).toEqual(['blood', 'respiratory', 'cardiac']);
  });

  it('says 「未能读出」 for a report that is on file but unparsed', () => {
    const result = pack(
      base({
        documents: [unreadablePulmonaryReport()] as unknown as PatientProfileDTO['documents'],
      }),
    );

    const respiratory = result.monitoring.find((slot) => slot.key === 'respiratory');
    expect(respiratory?.state).toBe('unreadable');
    expect(respiratory?.statement).toContain('已上传该类报告');
    expect(respiratory?.statement).toContain('请向患者索取原件');
    expect(respiratory?.statement).not.toContain('没有该类报告的记录');
    expect(result.respiratory.pulmonary.state).toBe('unreadable');
  });

  it('says 「不等于没有做过」 for a slot with nothing on file', () => {
    const result = pack(base());
    const cardiac = result.monitoring.find((slot) => slot.key === 'cardiac');
    expect(cardiac?.state).toBe('absent');
    expect(cardiac?.statement).toContain('不等于没有做过');
  });

  it('never disagrees with itself about the date of one report', () => {
    // The passport hands `latestDate` over as a bare YYYY-MM-DD. Feeding
    // that back through a Date parser reads it as UTC midnight and then
    // prints it in local time, so the slot's statement lost a day while
    // its own `latestDate` field kept it — one report, two dates, on the
    // page a neurologist reads.
    const result = pack(base({ documents: [unreadablePulmonaryReport()] } as never));
    const respiratory = result.monitoring.find((slot) => slot.key === 'respiratory');
    expect(respiratory?.latestDate).toBeTruthy();
    expect(respiratory?.statement).toContain(respiratory!.latestDate!);
  });

  it('keeps the passport note that says whether a test is indicated', () => {
    const result = pack(base());
    const cardiac = result.monitoring.find((slot) => slot.key === 'cardiac');
    // The passport attaches an AAN-derived note to the cardiac slot so
    // the panel does not read as three tests everyone owes. If the
    // passport stops attaching one, this test says so rather than the
    // pack silently reverting to a to-do list.
    expect(cardiac?.note).toBeTruthy();
    expect(result.markdown).toContain(cardiac?.note ?? '');
  });

  it('prints how old the result is, not just when it was taken', () => {
    // The freshness verdict was carried on every slot of this DTO and
    // printed nowhere: 过期 occurred ZERO times in a pack whose newest
    // result was 251 days old, while the passport markdown and the
    // mobile PDF built from the same summary object both said so. This
    // is the one document in the product that is physically handed to
    // the neurologist deciding whether the workup is current.
    const result = pack(base({ documents: [unreadablePulmonaryReport()] } as never));
    const respiratory = result.monitoring.find((slot) => slot.key === 'respiratory');
    expect(respiratory?.freshnessLabel).toBe('待更新');
    // Inside the date bracket, in the shape and with the words
    // `buildClinicalPassportExport` uses — one claim, not two wordings.
    expect(respiratory?.statement).toContain('（2026-02-10，待更新）');
    expect(result.markdown).toContain('（2026-02-10，待更新）');
    // 呼吸支持 reads the same slot object, so 最近肺功能 carries it too.
    expect(result.respiratory.pulmonary.statement).toContain('待更新');
  });

  it('没有日期的那一格不写「缺失」—— 那读起来像在评价患者，不是在说本平台', () => {
    const result = pack(base());
    const cardiac = result.monitoring.find((slot) => slot.key === 'cardiac');
    expect(cardiac?.freshnessLabel).toBe('缺失');
    // The sentence already says 本平台没有该类报告的记录 —— 不等于没有做
    // 过. Appending 缺失 to that adds nothing and turns a statement about
    // this platform's records into what reads as a verdict.
    expect(cardiac?.statement).not.toContain('缺失');
  });
});

describe('新鲜度算在调用方的时钟上，不是墙上时钟', () => {
  it('11 天前的报告不会被这份资料说成「过期」', () => {
    // `buildReferralPack` stamped 生成时间 from the clock it was handed
    // and then called `buildClinicalPassportSummary` with NONE, so every
    // freshness label, every 最新/过期 judgement and the age gate on the
    // guideline steps inside the pack were computed against the wall
    // clock instead. The system time below is years away from the
    // caller's clock; if the clock stops being threaded through, this
    // pack calls an eleven-day-old lung-function report 过期.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2031-01-01T00:00:00.000Z'));
      const caller = new Date('2026-02-21T00:00:00.000Z');
      const result = buildReferralPack(
        base({ documents: [unreadablePulmonaryReport()] } as never),
        caller,
      );
      const respiratory = result.monitoring.find((slot) => slot.key === 'respiratory');
      expect(respiratory?.latestDate).toBe('2026-02-10');
      expect(respiratory?.freshnessLabel).toBe('最新');
      expect(result.markdown).toContain('（2026-02-10，最新）');
      // And 生成时间 is the same clock it judged against — the whole
      // reason the parameter exists.
      expect(result.generatedAt).toBe(caller.toISOString());
      expect(result.markdown).toContain('- 生成时间：2026-02-21');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('我想问的问题', () => {
  it('gives every prompt a source, and every prompt is a question', () => {
    const result = pack(base());
    expect(result.questions.length).toBeGreaterThan(5);
    for (const question of result.questions) {
      expect(question.source.trim().length).toBeGreaterThan(0);
      expect(question.prompt).toMatch(/[？?]/);
    }
  });

  it('quotes the 协作网 registry obligation by document number', () => {
    const result = pack(base());
    const registry = result.questions.find((question) => question.id === 'registry');
    expect(registry?.source).toContain('国卫办医函〔2019〕157号');
  });

  it('prints a blank for each question so it can be filled in beforehand', () => {
    const result = pack(base());
    const blanks = result.markdown.split('我的情况 / 想问的：').length - 1;
    expect(blanks).toBe(result.questions.length);
  });
});

/* ------------------------------------------------------------------ */
/* The wiring                                                          */
/* ------------------------------------------------------------------ */

/**
 * WHY THESE LIVE HERE AND NOT IN profile.controller.test.ts
 * ---------------------------------------------------------
 * Everything above proves the serialiser is right. None of it proved a
 * patient could reach it: `referral-pack.ts` shipped with 730 green
 * lines, no route, no controller and no client, and「测试是绿的」read
 * as「功能可用」for a module that had never met a request.
 *
 * So these go through Express, not through the controller method
 * directly, because the three ways this feature can be unreachable are
 * all outside the handler:
 *
 *   1. the route is never registered (the actual failure this lane
 *      exists to fix);
 *   2. the route is registered ABOVE `router.use(authMiddleware)` and
 *      serves one patient's clinical record to anybody who asks;
 *   3. the pack survives `buildReferralPack` and then loses its
 *      three-state monitoring fields to JSON serialisation — the one
 *      step between the tested function and the reader.
 */

const logger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => logger,
} as unknown as AppLogger;

const JWT_SECRET = 'referral-pack-test-secret-value';

const env = {
  JWT_SECRET,
  // Keeps the router off the Python OCR path and off MinIO; neither is
  // reachable from this endpoint, but both are constructed eagerly.
  OCR_PROVIDER: 'mock',
  STORAGE_PROVIDER: 'local',
} as unknown as AppEnv;

const { createPatientProfileRouter } = await import('./profile.routes.js');

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/patients', createPatientProfileRouter({ env, logger }));
  app.use(errorHandler({ logger }));
  return app;
};

const tokenFor = (userId: string) => jwt.sign({ sub: userId, role: 'patient' }, JWT_SECRET);

/** A fresh user id per test: the rate limiter's store is module-level
 *  and keyed by user, so reusing one id would leak a budget between
 *  tests and make failures depend on execution order. */
let userSeq = 0;
const nextUser = () => `u-referral-${(userSeq += 1)}`;

beforeEach(() => {
  getProfileByUserId.mockReset();
  queryMock.mockClear();
});

describe('GET /me/referral-pack — the route exists at all', () => {
  it('answers 200 with the built pack, provenance note first', async () => {
    const userId = nextUser();
    getProfileByUserId.mockResolvedValue(
      base({ documents: [geneticReport({ d4z4Repeats: '6' })] }),
    );

    const res = await request(makeApp())
      .get('/api/patients/me/referral-pack')
      .set('Authorization', `Bearer ${tokenFor(userId)}`);

    expect(res.status).toBe(200);
    expect(getProfileByUserId).toHaveBeenCalledWith(userId);
    expect(res.body.markdown).toContain(REFERRAL_PROVENANCE_NOTE);
    expect(res.body.catalogue.documentNumber).toBe('国卫医政发〔2023〕26号');
    expect(res.body.contentType).toBe('text/markdown');
  });

  it('reads the caller from the token, never from the query string', async () => {
    getProfileByUserId.mockResolvedValue(base());
    const userId = nextUser();

    await request(makeApp())
      .get(`/api/patients/me/referral-pack?userId=someone-else`)
      .set('Authorization', `Bearer ${tokenFor(userId)}`);

    expect(getProfileByUserId).toHaveBeenCalledTimes(1);
    expect(getProfileByUserId).toHaveBeenCalledWith(userId);
  });

  it('refuses an unauthenticated request without touching the profile', async () => {
    const res = await request(makeApp()).get('/api/patients/me/referral-pack');
    expect(res.status).toBe(401);
    expect(getProfileByUserId).not.toHaveBeenCalled();
  });

  it('404s when there is no profile yet, instead of an empty pack', async () => {
    // An empty pack would be a document asserting「本平台没有记录」about
    // every section for someone who has not registered — printed under
    // a real patient name the serialiser would take from nothing.
    getProfileByUserId.mockResolvedValue(null);

    const res = await request(makeApp())
      .get('/api/patients/me/referral-pack')
      .set('Authorization', `Bearer ${tokenFor(nextUser())}`);

    expect(res.status).toBe(404);
    expect(res.body.markdown).toBeUndefined();
  });
});

describe('GET /me/referral-pack — what survives JSON', () => {
  it('carries present / unreadable / absent through the wire, all three', async () => {
    getProfileByUserId.mockResolvedValue(
      base({ documents: [unreadablePulmonaryReport()] } as never),
    );

    const res = await request(makeApp())
      .get('/api/patients/me/referral-pack')
      .set('Authorization', `Bearer ${tokenFor(nextUser())}`);

    const slots = res.body.monitoring as Array<{ key: string; state: string; statement: string }>;
    const respiratory = slots.find((slot) => slot.key === 'respiratory');
    const cardiac = slots.find((slot) => slot.key === 'cardiac');

    // The distinction profile.passport.ts spends a page defending, one
    // reader further along: 「上传了但读不出」 must not arrive as
    // 「没上传」, and neither may arrive as an absence of the field.
    expect(respiratory?.state).toBe('unreadable');
    expect(respiratory?.statement).toContain('请向患者索取原件');
    expect(cardiac?.state).toBe('absent');
    expect(cardiac?.statement).toContain('不等于没有做过');
  });

  it('keeps 「当天做不了」 rows as rows, with a null value rather than no row', async () => {
    getProfileByUserId.mockResolvedValue(
      base({
        functionTests: [
          functionTest({ performedAt: '2026-05-01T12:00:00.000Z' }),
          functionTest({
            performedAt: '2026-06-01T12:00:00.000Z',
            measuredValue: null,
            notApplicable: true,
          }),
        ],
      } as never),
    );

    const res = await request(makeApp())
      .get('/api/patients/me/referral-pack')
      .set('Authorization', `Bearer ${tokenFor(nextUser())}`);

    const series = res.body.functionTests[0] as {
      hasUnableEntries: boolean;
      points: Array<{ outcome: string; measuredValue: number | null }>;
    };
    expect(series.points).toHaveLength(2);
    expect(series.hasUnableEntries).toBe(true);
    // JSON keeps an explicit null; it is `undefined` that would vanish
    // and turn 「做不了」 into a row with no reading at all.
    expect(series.points[1]).toMatchObject({ outcome: 'unable', measuredValue: null });
  });
});

describe('GET /me/referral-pack — the throttle', () => {
  it('lets a patient press the button twenty times and stops the twenty-first', async () => {
    // Not a cooldown: someone in a waiting room who pressed twice must
    // not be told to wait a minute. See referralPackLimiter.
    getProfileByUserId.mockResolvedValue(base());
    const app = makeApp();
    const auth = `Bearer ${tokenFor(nextUser())}`;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ok = await request(app)
        .get('/api/patients/me/referral-pack')
        .set('Authorization', auth);
      expect(ok.status).toBe(200);
    }

    const blocked = await request(app)
      .get('/api/patients/me/referral-pack')
      .set('Authorization', auth);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain('过于频繁');
  });

  it('is keyed per account, so one busy patient cannot lock out another', async () => {
    getProfileByUserId.mockResolvedValue(base());
    const app = makeApp();
    const busy = `Bearer ${tokenFor(nextUser())}`;
    const bystander = `Bearer ${tokenFor(nextUser())}`;

    for (let attempt = 0; attempt < 21; attempt += 1) {
      await request(app).get('/api/patients/me/referral-pack').set('Authorization', busy);
    }

    const res = await request(app)
      .get('/api/patients/me/referral-pack')
      .set('Authorization', bystander);
    expect(res.status).toBe(200);
  });
});
