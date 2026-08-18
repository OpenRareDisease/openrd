import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { diagnosisTypeSourceZh, normaliseSource } from './export-source.js';
import { buildPassportSharePage } from '../passport-share.html.js';
import { buildClinicalPassportExport, buildClinicalPassportSummary } from '../profile.passport.js';
import type { PatientProfileDTO } from '../profile.service.js';
import { buildReferralPack } from '../referral-pack.js';

/**
 * THE PROVENANCE SENTENCE NAMES OTHER DOCUMENTS. THIS FILE RENDERS
 * THEM.
 *
 * `diagnosisTypeSourceZh` ships one sentence into all three portable
 * exports — TREAT-NMD's `diagnosis.typeFromGeneticEvidence`, the FHIR
 * `Condition.note`, and the Phenopacket 「分型取自何处」 omission — and
 * that sentence tells a receiving registry that four other surfaces
 * print the same 分型. A registry uses exactly that to decide the value
 * is corroborated, so each named surface has to be BUILT here and read,
 * not reasoned about.
 *
 * IT NAMED FIVE UNTIL THIS ROUND. The fifth was 麻醉提示卡, and
 * `buildAnesthesiaCard` interpolates its 分型 clause into the
 * UNCONFIRMED branch only: on `confirmation === 'genetic'` — which is
 * the ordinary state for a profile whose evidence document states a
 * 分型, i.e. the very state that emits this sentence — the card's
 * diagnosis line is 「诊断：FSHD，基因确诊（D4Z4 重复数 N）」 and carries
 * no 分型 at all. The card lives in apps/mobile and cannot be rendered
 * from this suite, which is the second reason it is not named: a claim
 * this file cannot check is a claim that goes stale unwatched.
 */

/** A genetics report that states a 分型 of its own, so
 *  `geneticEvidenceReading.values.diagnosisType` is non-null and the
 *  sentence under test is the one that lists surfaces. */
const reportStating = (fields: Record<string, string>): PatientProfileDTO => ({
  ...EXPORT_FIXTURE_PROFILE,
  documents: [
    {
      ...EXPORT_FIXTURE_PROFILE.documents[0],
      ocrPayload: { fields: { reportTime: '2024-01-28', ...fields } },
    },
    ...EXPORT_FIXTURE_PROFILE.documents.slice(1),
  ],
});

/**
 * Both halves of the state space this sentence covers, because the
 * archive says FSHD1 in the fixture:
 *
 *  - `agrees` — the report repeats FSHD1. Confirmed, and the sentence
 *    ends 「档案里记录的分型与它逐字相同」.
 *  - `differs` — the report reads FSHD2 while the questionnaire still
 *    holds FSHD1. Confirmed, and every named surface has to print the
 *    REPORT's value, which is the case the list is really about.
 */
const CASES: ReadonlyArray<{ readonly name: string; readonly profile: PatientProfileDTO }> = [
  {
    name: '报告与档案一致',
    profile: reportStating({ diagnosisType: 'FSHD1', d4z4Repeats: '5', haplotype: '4qA' }),
  },
  {
    name: '报告与档案不一致',
    profile: reportStating({ diagnosisType: 'FSHD2', d4z4Repeats: '5', haplotype: '4qA' }),
  },
];

const NOW = new Date(FIXTURE_GENERATED_AT);

const sentenceFor = (profile: PatientProfileDTO) =>
  diagnosisTypeSourceZh(
    normaliseSource(profile, { includeLocalOnly: false, generatedAt: FIXTURE_GENERATED_AT }),
  );

const readingOf = (profile: PatientProfileDTO) =>
  normaliseSource(profile, { includeLocalOnly: false, generatedAt: FIXTURE_GENERATED_AT })
    .geneticEvidenceReading.values.diagnosisType;

describe('分型来源说明 —— 它点名的每一份文件都要真的印着这个值', () => {
  it.each(CASES)('$name：四份文件全部印出报告上的分型', ({ profile }) => {
    const reading = readingOf(profile);
    expect(reading).not.toBeNull();

    const summary = buildClinicalPassportSummary(profile, NOW);

    // 患者护照 —— the DTO the passport screen renders its 基因类型 cell
    // from. Asserted on the DTO because the screen is apps/mobile; the
    // value it prints is this field and nothing else.
    expect(summary.diagnosis.geneticType).toBe(reading);

    // markdown 导出
    expect(buildClinicalPassportExport(summary).markdown).toContain(`基因类型：${reading}`);

    // 分享页
    expect(buildPassportSharePage(summary, { expiresAt: '2026-02-15T08:00:00.000Z' })).toContain(
      String(reading),
    );

    // 转诊资料
    expect(buildReferralPack(profile, NOW).markdown).toContain(`基因类型：${reading}`);
  });

  it.each(CASES)('$name：说明句点名的正是这四份', ({ profile }) => {
    const sentence = sentenceFor(profile);
    for (const surface of ['患者护照', 'markdown 导出', '分享页', '转诊资料']) {
      expect(sentence).toContain(surface);
    }
  });

  /**
   * The regression itself. `buildAnesthesiaCard`'s confirmed branch
   * prints a repeat count and no 分型, so a sentence naming the card is
   * a false corroboration claim — and this profile is genetically
   * confirmed, which is the branch that was wrong.
   */
  it.each(CASES)('$name：不点名麻醉提示卡 —— 它在基因确诊这一支上不印分型', ({ profile }) => {
    expect(buildClinicalPassportSummary(profile, NOW).diagnosis.confirmation).toBe('genetic');
    expect(sentenceFor(profile)).not.toContain('麻醉提示卡');
  });

  /** The sentence only lists surfaces when there IS a reading to
   *  corroborate. With no 分型 on the evidence document there is
   *  nothing for another surface to agree with, and naming one would
   *  be the same defect pointed the other way. */
  it('报告上没有分型时，说明句不点名任何文件', () => {
    const sentence = sentenceFor(EXPORT_FIXTURE_PROFILE);
    for (const surface of ['患者护照', 'markdown 导出', '分享页', '转诊资料', '麻醉提示卡']) {
      expect(sentence).not.toContain(surface);
    }
  });
});
