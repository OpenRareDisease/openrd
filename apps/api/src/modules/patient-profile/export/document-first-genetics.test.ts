import { describe, expect, it } from 'vitest';

import {
  EXPORT_FIXTURE_PROFILE,
  EXPORT_FIXTURE_PROFILE_REPORT_DISAGREES,
  FIXTURE_GENERATED_AT,
} from './__fixtures__/profile.fixture.js';
import { normaliseSource } from './export-source.js';
import { buildFhirExport } from './fhir-r4.js';
import { buildTreatNmdExport, type TreatNmdItem } from './treat-nmd.js';
import { applyAdminBaselineWrite, applyPatientBaselineWrite } from '../baseline-provenance.js';
import { buildPassportSharePage } from '../passport-share.html.js';
import { buildClinicalPassportExport, buildClinicalPassportSummary } from '../profile.passport.js';
import { baselineProfileSchema } from '../profile.schema.js';
import type { PatientProfileDTO } from '../profile.service.js';
import { buildReferralPack } from '../referral-pack.js';

/**
 * ONE PROFILE, SEVEN DOCUMENTS, ONE ANSWER PER GENETIC CELL.
 *
 * The owner's precedence rule is that where the evidence document
 * states a genetic cell and the questionnaire's archived answer differs,
 * the DOCUMENT's value is what the product states. The clinical surfaces
 * have followed it for a while — `buildClinicalPassportSummary` resolves
 * every one of these cells document-first — and so did the two exports
 * that carry genetics as document readings.
 *
 * THE TREAT-NMD DOCUMENT DID NOT, and it is the one that reaches a
 * registry. `diagnosis.type` had already been given a sibling carrying
 * the report's reading for exactly this reason; `diagnosis.d4z4`,
 * `diagnosis.haplotype` and `diagnosis.methylation` had not, so the
 * registry filed the questionnaire's repeat count, the questionnaire's
 * allele and the questionnaire's methylation while the patient's own
 * phone showed the laboratory's three.
 *
 * 单倍型 was the worst of them: `readBaselineDiseaseBackground` in
 * profile.passport.ts does not read `diseaseBackground.haplotype` at all
 * (「nothing on the passport family renders a 单倍型 value」), so the
 * archived allele reached exactly one reader — this document — and
 * reached it as a genotype, with no surface a patient or clinician holds
 * able to contradict it.
 *
 * SO THE CHECK IS A RENDER, NOT AN ARGUMENT. Every surface named is
 * BUILT here, over a profile whose report and questionnaire disagree on
 * all four cells, and read.
 */

const NOW = new Date(FIXTURE_GENERATED_AT);
const OPTIONS = { includeLocalOnly: false, generatedAt: FIXTURE_GENERATED_AT } as const;

const treatNmdItems = (profile: PatientProfileDTO): readonly TreatNmdItem[] => {
  const document = buildTreatNmdExport(normaliseSource(profile, OPTIONS)).document;
  const diagnosis = document.sections.find((section) => section.key === 'diagnosis');
  if (!diagnosis) throw new Error('no diagnosis section');
  return diagnosis.items;
};

const treatNmdItem = (profile: PatientProfileDTO, key: string): TreatNmdItem | null =>
  treatNmdItems(profile).find((item) => item.key === key) ?? null;

/** The FHIR Observation for one genetic cell, by its Chinese code text
 *  — the same label the report-field spec gives it. */
const fhirObservationValue = (profile: PatientProfileDTO, codeText: string): string | null => {
  const bundle = buildFhirExport(normaliseSource(profile, OPTIONS)).document;
  for (const entry of bundle.entry) {
    const resource = entry.resource as Record<string, unknown>;
    if (resource.resourceType !== 'Observation') continue;
    const code = resource.code as { text?: string } | undefined;
    if (code?.text !== codeText) continue;
    return typeof resource.valueString === 'string' ? resource.valueString : null;
  }
  return null;
};

describe('报告与问卷不一致时，七份产物说的是同一个值', () => {
  const profile = EXPORT_FIXTURE_PROFILE_REPORT_DISAGREES;
  const summary = buildClinicalPassportSummary(profile, NOW);
  const markdown = buildClinicalPassportExport(summary).markdown;
  const sharePage = buildPassportSharePage(summary, { expiresAt: '2026-02-15T08:00:00.000Z' });
  const referralPack = buildReferralPack(profile, NOW).markdown;

  /** The fixture's premise. If the autofill ever starts correcting a
   *  full slot, this stops being the state under test and every
   *  assertion below becomes vacuous — so it is asserted, not assumed. */
  it('前提：档案里留着与报告不同的旧答案', () => {
    const source = normaliseSource(profile, OPTIONS);
    expect(source.diagnosisTypeRawZh).toBe('FSHD1');
    expect(source.geneticEvidence).toEqual({
      d4z4: '5 个重复单元',
      haplotype: '4qB',
      methylation: '甲基化水平 32%',
    });
    expect(source.geneticEvidenceReading.values).toMatchObject({
      diagnosisType: 'FSHD2',
      d4z4: '9',
      haplotype: '4qA',
      methylation: '甲基化指数 0.31',
    });
  });

  it('FSHD 分型：七份都说 FSHD2', () => {
    expect(summary.diagnosis.geneticType).toBe('FSHD2');
    expect(markdown).toContain('基因类型：FSHD2');
    expect(sharePage).toContain('FSHD2');
    expect(referralPack).toContain('基因类型：FSHD2');
    expect(treatNmdItem(profile, 'diagnosis.typeFromGeneticEvidence')?.value).toBe('FSHD2');
    // The FHIR Condition and the Phenopacket Disease.term follow the
    // report already; codings.test.ts and phenopacket.test.ts hold that.
    expect(
      (
        buildFhirExport(normaliseSource(profile, OPTIONS)).document.entry.find(
          (entry) => (entry.resource as { resourceType?: string }).resourceType === 'Condition',
        )?.resource as { code?: { text?: string } }
      )?.code?.text,
    ).toContain('FSHD2');
  });

  it('D4Z4 重复单元数：七份都说 9，灰区限定也一起走', () => {
    expect(summary.diagnosis.d4z4Repeats).toBe('9');
    expect(markdown).toContain('D4Z4 重复数：9');
    expect(sharePage).toContain('9');
    expect(referralPack).toContain('D4Z4 重复数：9');
    expect(fhirObservationValue(profile, 'D4Z4 重复单元数')).toBe('9');

    const sibling = treatNmdItem(profile, 'diagnosis.d4z4FromGeneticEvidence');
    expect(sibling?.value).toMatchObject({ statedZh: '9', readsAsResult: true });

    // THE QUALIFIER IS THE HALF THAT USED TO REACH NO REGISTRY. The
    // archive item's `qualifier` is null whenever its `reading` is not
    // `result`, correctly — the 8–10 verdict belongs to the number the
    // passport graded — so in exactly this disagreement case the one
    // machine-readable flag a trial site can filter on existed in the
    // FHIR bundle and nowhere in the document a registry ingests.
    expect(summary.diagnosis.geneticEvidence.record.greyZone).toBe(true);
    expect((sibling?.value as { qualifier?: { kind?: string } }).qualifier?.kind).toBe(
      'grey_zone_8_10',
    );
    expect(treatNmdItem(profile, 'diagnosis.d4z4')?.value).toMatchObject({
      reading: 'not_read',
      qualifier: null,
    });
  });

  it('4q 单倍型：档案里的 4qB 不再是这份文件对外说的基因型', () => {
    expect(summary.diagnosis.geneticEvidence.record.haplotype).toBe('4qA');
    expect(fhirObservationValue(profile, '4q 单倍型')).toBe('4qA');

    const sibling = treatNmdItem(profile, 'diagnosis.haplotypeFromGeneticEvidence');
    expect(sibling?.value).toMatchObject({ statedZh: '4qA', readsAsResult: true });

    // The archived allele still travels — it is the patient's record and
    // dropping it would be this export deciding a question it says it
    // does not decide — but it travels flagged, with the reading beside
    // it and the document's own value in a key of its own.
    const archived = treatNmdItem(profile, 'diagnosis.haplotype');
    expect(archived?.value).toMatchObject({ recordedZh: '4qB', reading: 'not_read' });
    expect(archived?.provenanceZh).toContain('那一份的这一项是「4qA」');
    expect(sibling?.provenanceZh).toContain('档案里另外记录着「4qB」');
    expect(sibling?.provenanceZh).toContain('diagnosis.haplotype');
  });

  it('甲基化：七份都说报告上的那个读数', () => {
    expect(summary.diagnosis.methylationValue).toBe('甲基化指数 0.31');
    expect(markdown).toContain('甲基化值：甲基化指数 0.31');
    expect(sharePage).toContain('甲基化指数 0.31');
    expect(referralPack).toContain('甲基化：甲基化指数 0.31');
    expect(fhirObservationValue(profile, '甲基化')).toBe('甲基化指数 0.31');
    expect(treatNmdItem(profile, 'diagnosis.methylationFromGeneticEvidence')?.value).toBe(
      '甲基化指数 0.31',
    );

    // 甲基化 keeps its refusal on BOTH copies. A graded-looking number
    // in a registry field is the failure this platform states it will
    // not produce, and the sibling is a registry field.
    expect(
      treatNmdItem(profile, 'diagnosis.methylationFromGeneticEvidence')?.provenanceZh,
    ).toContain('本平台对甲基化没有任何判读界限');
  });

  /**
   * The sibling says 「read off the document」, so there has to BE a
   * document reading. With none, an item asserting one would be this
   * export answering a question the report never answered.
   */
  it('报告上没有这一项时，不发这个条目', () => {
    // The shared fixture's report states D4Z4 and 单倍型 and no 甲基化.
    const keys = treatNmdItems(EXPORT_FIXTURE_PROFILE).map((entry) => entry.key);
    expect(keys).toContain('diagnosis.d4z4FromGeneticEvidence');
    expect(keys).toContain('diagnosis.haplotypeFromGeneticEvidence');
    expect(keys).not.toContain('diagnosis.methylationFromGeneticEvidence');

    // …and with no evidence document at all, none of the three.
    const noReport: PatientProfileDTO = {
      ...EXPORT_FIXTURE_PROFILE,
      documents: EXPORT_FIXTURE_PROFILE.documents.filter(
        (document) => document.documentType !== 'genetic_report',
      ),
    };
    const withoutReport = treatNmdItems(noReport).map((entry) => entry.key);
    for (const key of [
      'diagnosis.typeFromGeneticEvidence',
      'diagnosis.d4z4FromGeneticEvidence',
      'diagnosis.haplotypeFromGeneticEvidence',
      'diagnosis.methylationFromGeneticEvidence',
    ]) {
      expect(withoutReport).not.toContain(key);
    }
  });

  /** A cell the platform reads and does NOT read as a result may not
   *  arrive in the sibling looking like one. 「4qA/4qB」 names the
   *  laboratory's probes; it is a string and it is not a haplotype. */
  it('报告上那一行读不出结果时，条目照发但不说它是结果', () => {
    const probeList: PatientProfileDTO = {
      ...EXPORT_FIXTURE_PROFILE_REPORT_DISAGREES,
      documents: [
        {
          ...EXPORT_FIXTURE_PROFILE_REPORT_DISAGREES.documents[0],
          ocrPayload: {
            fields: { reportTime: '2024-01-28', d4z4Repeats: '9', haplotype: '4qA/4qB' },
          },
        },
        ...EXPORT_FIXTURE_PROFILE_REPORT_DISAGREES.documents.slice(1),
      ],
    };
    expect(treatNmdItem(probeList, 'diagnosis.haplotypeFromGeneticEvidence')?.value).toMatchObject({
      statedZh: '4qA/4qB',
      readsAsResult: false,
      qualifier: null,
    });
  });
});

/**
 * THE PROVENANCE SENTENCE FOR 单倍型 AND 甲基化 IS A CLAIM ABOUT THE
 * WRITE PATHS. THIS RUNS THEM.
 *
 * It used to assert 「患者的表单不为这一项提供输入框，本平台后台也不允许
 * 代填（服务端拒绝写入并点名字段），所以它不是患者填写的问卷答案。」 —
 * two premises and a conclusion. The back-office premise is true. The
 * patient premise is true of the SCREEN and false of the ENDPOINT, and
 * the conclusion is drawn from the endpoint.
 *
 * That mattered because the conclusion is what routed both fields onto
 * the tail that ATTRIBUTED the archived string to the evidence document
 * — 「所以这个值是基因报告的解析结果」 — sent to a registry, which is the
 * reader that treats such a sentence as corroboration.
 *
 * The claims are re-executed here rather than described, because both
 * halves live in files this lane does not own and either can move.
 */
describe('单倍型 / 甲基化 的来源句：把它声称的写入路径真的跑一遍', () => {
  const CELLS = ['haplotype', 'methylation'] as const;

  it('患者本人的基线接口接受这两栏并原样保留', () => {
    const parsed = baselineProfileSchema.parse({
      diseaseBackground: { haplotype: '4qA', methylation: '甲基化水平 12%' },
    }) as Record<string, unknown>;

    // The schema is what `PUT /me/baseline` parses, whole, from any
    // client. It knows both keys, so neither is stripped.
    expect(parsed.diseaseBackground).toEqual({
      haplotype: '4qA',
      methylation: '甲基化水平 12%',
    });

    // …and `applyPatientBaselineWrite` — the only thing between the
    // parse and `upsertBaseline` — has no allowlist. The allowlist in
    // this module is the ADMINISTRATOR's.
    const written = applyPatientBaselineWrite(
      { diseaseBackground: { haplotype: null, methylation: null } },
      parsed,
    ) as { diseaseBackground: Record<string, unknown> };
    expect(written.diseaseBackground.haplotype).toBe('4qA');
    expect(written.diseaseBackground.methylation).toBe('甲基化水平 12%');
  });

  it('后台代填这两栏会被拒绝，并且点名字段', () => {
    expect(() =>
      applyAdminBaselineWrite(
        { diseaseBackground: { haplotype: null, methylation: null } },
        { diseaseBackground: { haplotype: '4qA', methylation: '甲基化水平 12%' } },
        { adminUserId: '99999999-9999-4999-8999-999999999999' },
      ),
    ).toThrow(/单倍型.*甲基化/);
  });

  it('来源句只排除管理员，不排除患者本人', () => {
    const items = treatNmdItems(EXPORT_FIXTURE_PROFILE_REPORT_DISAGREES);
    for (const cell of CELLS) {
      const key = cell === 'haplotype' ? 'diagnosis.haplotype' : 'diagnosis.methylation';
      const sentence = items.find((item) => item.key === key)?.provenanceZh ?? '';
      expect(sentence).toContain('本平台后台不允许代填');
      expect(sentence).toContain('PUT /me/baseline');
      expect(sentence).toContain('不能排除患者自己写入');
      // The two claims that were false, in the words they were false in.
      expect(sentence).not.toContain('所以它不是患者填写的问卷答案');
      expect(sentence).not.toContain('这个值是基因报告的解析结果 ——');
    }
  });

  /**
   * The state the attributing tail was reachable in: the archive holds
   * exactly what the report reads. That is what the autofill produces on
   * its own, and it is equally what a patient produces by PUTting the
   * same string — so the sentence may not pick one.
   */
  it('档案值与报告读数完全相同时，也不把作者判给报告', () => {
    const matching: PatientProfileDTO = {
      ...EXPORT_FIXTURE_PROFILE,
      baseline: {
        ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
        diseaseBackground: {
          ...((EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>)
            .diseaseBackground as Record<string, unknown>),
          haplotype: '4qA',
        },
      },
    };
    const sentence = treatNmdItem(matching, 'diagnosis.haplotype')?.provenanceZh ?? '';
    expect(sentence).toContain('那一份的这一项与档案里这个值完全相同');
    expect(sentence).toContain('本平台区分不了');
    expect(sentence).not.toContain('只是没有记录能指出是哪一次读取写进去的');
  });
});
