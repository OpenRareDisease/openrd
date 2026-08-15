import { describe, expect, it } from 'vitest';

import {
  EXPORT_FIXTURE_PROFILE,
  FIXTURE_GENERATED_AT,
} from './export/__fixtures__/profile.fixture.js';
import { normaliseSource } from './export/export-source.js';
import { buildFhirExport } from './export/fhir-r4.js';
import { buildPhenopacketExport } from './export/phenopacket.js';
import { buildTreatNmdExport } from './export/treat-nmd.js';
import { buildClinicalPassportSummary } from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';
import { buildReferralPack } from './referral-pack.js';

/**
 * 基因确诊 IS ONE ANSWER, AND EVERY SURFACE THAT PRINTS IT READS THAT
 * ONE.
 *
 * Each of these files used to decide for itself. The passport graded a
 * laboratory record; the referral pack and the anesthesia card read the
 * passport's `confirmation`; and the three portable exports read
 * `hasGeneticReport`, which asked a different question — 「is ANY
 * document on file the genetics laboratory's own report」. The two
 * answers are not the same answer, and the profile below separates
 * them: a genetics report that read out nothing, on file beside a
 * 病历摘要 quoting the repeat count. That patient's FHIR bundle went to
 * a registry as verificationStatus=confirmed and their TREAT-NMD
 * document as diagnosis.geneticallyConfirmed=true, while their
 * passport, their referral pack and the card they hand an anesthetist
 * all read 未经基因确诊.
 *
 * WHY THIS FILE IS NOT IN export/ OR BESIDE THE PACK. The defect is not
 * inside any one serialiser — each was self-consistent — it is that
 * five documents built from one profile disagreed. A test that can see
 * only one of them cannot see that, which is how this survived the
 * per-file suites on both sides.
 *
 * The anesthesia card is not rendered here because it lives in the
 * mobile bundle and cannot be imported. It reads
 * `diagnosis.confirmation` off the wire and asks it exactly one
 * question, so what pins it is the passport column below plus
 * lib/__tests__/anesthesia-card.test.ts.
 */

const document = (
  over: Partial<PatientProfileDTO['documents'][number]>,
): PatientProfileDTO['documents'][number] => ({
  ...EXPORT_FIXTURE_PROFILE.documents[0],
  ...over,
});

const profileWith = (documents: PatientProfileDTO['documents']): PatientProfileDTO => ({
  ...EXPORT_FIXTURE_PROFILE,
  documents,
});

/** Every surface's answer to the one question, plus the sentence each
 *  of the machine formats states it in. */
const render = (profile: PatientProfileDTO) => {
  const source = normaliseSource(profile, {
    includeLocalOnly: false,
    generatedAt: FIXTURE_GENERATED_AT,
  });
  const summary = buildClinicalPassportSummary(profile);
  const pack = buildReferralPack(profile, new Date(FIXTURE_GENERATED_AT));

  const condition = buildFhirExport(source)
    .document.entry.map((entry) => entry.resource)
    .find((resource) => resource.resourceType === 'Condition') as unknown as {
    verificationStatus: { coding: Array<{ code: string }>; text: string };
  };

  const treatNmd = buildTreatNmdExport(source);
  const diagnosisSection = treatNmd.document.sections.find(
    (section) => section.key === 'diagnosis',
  );
  const item = diagnosisSection?.items.find(
    (entry) => entry.key === 'diagnosis.geneticallyConfirmed',
  );

  const basis =
    buildPhenopacketExport(source).omissions.find((entry) =>
      entry.field.startsWith('diseases[].term'),
    )?.reasonZh ?? '';

  return {
    passport: summary.diagnosis.confirmation === 'genetic',
    // 「，基因确诊」 and not 「基因确诊」: every unconfirmed sentence on this
    // page contains the word inside 未经基因确诊 or 不把这份报告算作已确认
    // 的分子遗传学诊断, so the bare substring is true in every state.
    pack: pack.diagnosis.statement.includes('），基因确诊'),
    fhir: condition.verificationStatus.coding[0].code === 'confirmed',
    treatNmd: item?.value === true,
    phenopacket: basis.includes('本平台把这份档案判定为基因确诊'),
    sentences: {
      fhir: condition.verificationStatus.text,
      treatNmd: item?.provenanceZh ?? '',
      phenopacket: basis,
    },
    packStatement: pack.diagnosis.statement,
  };
};

const laboratoryReport = (fields: Record<string, string>) =>
  document({
    id: '88888888-8888-4888-8888-888888888881',
    documentType: 'genetic_report',
    status: 'parsed',
    ocrPayload: { fields },
  });

const transcription = (fields: Record<string, string>) =>
  document({
    id: '88888888-8888-4888-8888-888888888883',
    documentType: 'medical_record',
    title: '病历摘要',
    status: 'parsed',
    uploadedAt: '2024-03-01T06:00:00.000Z',
    ocrPayload: { fields },
  });

/**
 * Every state worth separating, and what 基因确诊 is in it.
 *
 * `confirmed` is the whole expectation for all five surfaces at once —
 * one column, because there is one answer. A state that needs two
 * columns is the defect this file exists to fail on.
 */
const CASES: ReadonlyArray<{
  readonly name: string;
  readonly documents: PatientProfileDTO['documents'];
  readonly confirmed: boolean;
}> = [
  {
    name: '实验室报告读出了重复数和允许型单倍型',
    documents: [laboratoryReport({ d4z4Repeats: '5', haplotype: '4qA' })],
    confirmed: true,
  },
  {
    // The state that separated the passport from the exports: a report
    // IS on file, and it is not what this platform read.
    name: '报告在档但读出来的是转录件',
    documents: [
      laboratoryReport({ reportTime: '2024-01-28' }),
      transcription({ d4z4Repeats: '5', haplotype: '4qA' }),
    ],
    confirmed: false,
  },
  {
    // The state the grading lane separated: the laboratory determined
    // the haplotype and the answer argues against the FSHD1 mechanism.
    name: '实验室报告读到的单倍型是非允许型 4qB',
    documents: [laboratoryReport({ d4z4Repeats: '3', haplotype: '4qB' })],
    confirmed: false,
  },
  {
    // A report naming its probes has stated no haplotype at all.
    name: '报告的单倍型栏写的是探针名而不是结果',
    documents: [laboratoryReport({ haplotype: '4qA/4qB' })],
    confirmed: false,
  },
  {
    name: '只有一份转录件',
    documents: [transcription({ d4z4Repeats: '5', haplotype: '4qA' })],
    confirmed: false,
  },
  { name: '什么都没上传', documents: [], confirmed: false },
];

describe('基因确诊 — 五个界面读同一个答案', () => {
  CASES.forEach(({ name, documents, confirmed }) => {
    it(`${name} → ${confirmed ? '确诊' : '未确诊'}，五处一致`, () => {
      const rendered = render(profileWith(documents));
      expect({
        passport: rendered.passport,
        pack: rendered.pack,
        fhir: rendered.fhir,
        treatNmd: rendered.treatNmd,
        phenopacket: rendered.phenopacket,
      }).toEqual({
        passport: confirmed,
        pack: confirmed,
        fhir: confirmed,
        treatNmd: confirmed,
        phenopacket: confirmed,
      });
    });
  });

  /**
   * ONE WORDING, NOT THREE. A receiver can hold two of these documents
   * at once, and two accounts of what this platform means by 基因确诊 is
   * two things to keep true — the failure mode this whole lane is
   * about, one level up from the flag.
   */
  it('三份机器可读导出用的是同一句话，不是三种写法', () => {
    CASES.forEach(({ name, documents }) => {
      const { sentences } = render(profileWith(documents));
      expect(sentences.treatNmd, name).toBe(sentences.fhir);
      expect(sentences.phenopacket, name).toContain(sentences.fhir);
    });
  });

  /**
   * WHAT THE NEGATIVE MAY NOT SAY. 「没有基因报告」 is the claim the
   * retired flag made, and it is false for a patient whose genetics
   * report is on file and unreadable, or on file and silent. They are
   * holding it; a registry told none exists sends somebody to re-order
   * a test that has already been paid for.
   */
  it('未确诊时不声称这位患者没有报告', () => {
    const rendered = render(
      profileWith([
        laboratoryReport({ reportTime: '2024-01-28' }),
        transcription({ d4z4Repeats: '5', haplotype: '4qA' }),
      ]),
    );
    Object.entries(rendered.sentences).forEach(([format, sentence]) => {
      expect(sentence, format).toContain('也不表示他手里没有报告');
      expect(sentence, format).not.toContain('没有在该患者的上传件中认定出基因检测报告');
    });
    // And each names the document the values actually came off.
    expect(rendered.sentences.fhir).toContain('转录自非基因报告文件');
  });

  /**
   * NO SURFACE RESTATES THE RULE IT IS GRADED BY. 「D4Z4 重复数、4q
   * 单倍型或 EcoRI 片段」 was printed as the reason on the pack, on the
   * card and in the export prose — a copy of `confirmation`'s own
   * definition, free to drift from it, and already false in two
   * directions: a 甲基化 read off the report is a genetic result that
   * earns nothing, and a report stating 4qB has a 4q 单倍型 on it and
   * confirms nothing.
   */
  it('没有一处把「哪几项能构成确诊」抄进给人看的句子里', () => {
    CASES.forEach(({ name, documents }) => {
      const rendered = render(profileWith(documents));
      [...Object.values(rendered.sentences), rendered.packStatement].forEach((sentence) => {
        expect(sentence, name).not.toContain('EcoRI 片段');
      });
    });
  });
});
