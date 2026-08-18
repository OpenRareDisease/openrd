import {
  buildCodingProvenance,
  toCurie,
  verifiedCoding,
  type CodingProvenance,
} from './codings.js';
import type { ExportOmission, PortableExportEnvelope } from './envelope.js';
import {
  diagnosisTypeSourceZh,
  geneticConfirmationReasonZh,
  geneticEvidenceDocumentZh,
  instrumentOmission,
  resourceUuid,
  NO_ADMIN_FIELD_ORIGIN_NOTE_ZH,
  type NormalisedSource,
} from './export-source.js';

/**
 * GA4GH Phenopacket v2.
 *
 * WHAT MAKES THIS FORMAT HARD TO BE HONEST IN. Phenopacket is
 * ontology-first by design: `PhenotypicFeature.type`,
 * `Measurement.assay`, `Disease.term` and `MedicalAction`'s agents are
 * all `OntologyClass`, and an `OntologyClass` is an id plus a label —
 * there is no "I know what this is but not its code" slot anywhere in
 * the schema. That is a good property for a research exchange format
 * and a bad one for a data holder who cannot verify codes.
 *
 * The consequence is stated plainly rather than worked around: this
 * exporter emits the parts of the schema it can fill truthfully
 * (`id`, `subject`, `diseases` where the OMIM term is verified,
 * `files`, `metaData`) and omits the ontology-mandatory parts
 * entirely, listing each omission and its reason in the envelope. A
 * Phenopacket with fewer messages is still a Phenopacket. A
 * Phenopacket whose `phenotypicFeatures` carry HPO ids someone
 * half-remembered is a research artefact that quietly poisons a
 * cohort, and the person it is about will never know.
 *
 * WHAT IS DELIBERATELY NOT HERE — `interpretations`. FSHD1 is a
 * contraction of the D4Z4 macrosatellite repeat array on 4q35 on a
 * permissive 4qA haplotype. It is NOT a sequence variant in DUX4, and
 * `GenomicInterpretation` / `VariationDescriptor` / `geneContext` are
 * built to describe sequence variants in genes. Putting DUX4 in
 * `gene-studied` would make the packet validate against a genomics
 * profile and would misstate the disease mechanism to every consumer
 * downstream. The report's readings travel instead as what they are —
 * in the TREAT-NMD alignment and in FHIR text — and this omission is
 * recorded explicitly so it reads as a decision rather than a gap.
 *
 * ALL FOUR OF THEM, and the count is why this paragraph was edited.
 * 「the repeat count and haplotype」 named two members of a set with
 * four in it: the EcoRI fragment and 甲基化 are readings off the same
 * cell block, and for a report that states its length only in kb the
 * fragment is the only size measurement the laboratory made. Naming a
 * subset told a receiver the rest did not exist.
 */

export interface PhenopacketOntologyClass {
  readonly id: string;
  readonly label: string;
}

export interface PhenopacketDocument {
  readonly id: string;
  readonly subject: {
    readonly id: string;
    readonly sex: PhenopacketSex;
    readonly timeAtLastEncounter?: { readonly timestamp: string };
  };
  readonly diseases?: ReadonlyArray<{ readonly term: PhenopacketOntologyClass }>;
  readonly files?: ReadonlyArray<{
    readonly uri: string;
    readonly fileAttributes: Record<string, string>;
  }>;
  readonly metaData: {
    readonly created: string;
    readonly createdBy: string;
    readonly resources: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly namespacePrefix: string;
      readonly url: string;
      readonly version: string;
      readonly iriPrefix: string;
    }>;
    readonly phenopacketSchemaVersion: string;
  };
}

/**
 * The v2 `Sex` enum. This is part of the schema itself, not an
 * external terminology, so it is not ledgered — but the MAPPING is a
 * judgement and is written down here rather than inlined.
 *
 * `prefer_not_to_say` maps to UNKNOWN_SEX, not to OTHER_SEX. Declining
 * to answer is not a statement about sex, and OTHER_SEX would turn a
 * privacy choice into a recorded clinical characteristic.
 */
export type PhenopacketSex = 'UNKNOWN_SEX' | 'FEMALE' | 'MALE' | 'OTHER_SEX';

export const toPhenopacketSex = (gender: string | null): PhenopacketSex => {
  switch (gender) {
    case 'male':
      return 'MALE';
    case 'female':
      return 'FEMALE';
    case 'non_binary':
      return 'OTHER_SEX';
    default:
      return 'UNKNOWN_SEX';
  }
};

export interface PhenopacketEnvelopeExtras {
  readonly codingProvenance: CodingProvenance;
}

export const buildPhenopacketExport = (
  source: NormalisedSource,
): PortableExportEnvelope<PhenopacketDocument> & PhenopacketEnvelopeExtras => {
  const { profile, options } = source;
  const omissions: ExportOmission[] = [];

  /**
   * THE SUBTYPE IS THE ONE THE PASSPORT PRINTS.
   *
   * `Disease.term` is an ontology term — the single most machine-usable
   * assertion this packet makes, and the field a registry indexes on.
   * It used to be classified from the ARCHIVE
   * (`diseaseBackground.diagnosisType`, else
   * `patient_profiles.genetic_mutation`) while the patient's passport,
   * markdown export, share page, referral pack and anaesthesia card
   * were all built off the evidence REPORT. Over a profile whose
   * questionnaire says FSHD1 and whose genetics report reads FSHD2 —
   * ordinary, because `applyGeneticReportAutofill` only fills an EMPTY
   * slot — this packet asserted `OMIM:158900` while all five of those
   * said FSHD2. FSHD1 is a contracted D4Z4 array on a permissive 4qA
   * allele; FSHD2 is a different mechanism, and a cohort built on this
   * term would have filed the patient under the wrong one.
   *
   * `passportDiagnosisType` is that build's own chain, carried rather
   * than re-derived. Which string was classified, and what the archive
   * still holds if it differs, is stated in the omission below —
   * `Disease` has no note slot, and this format's answer to 「the
   * schema has nowhere to say this」 is the omissions list.
   */
  const diseaseKey =
    source.passportDiagnosisType === 'FSHD1'
      ? 'disease.fshd1'
      : source.passportDiagnosisType === 'FSHD2'
        ? 'disease.fshd2'
        : null;
  const diseaseEntry = diseaseKey ? verifiedCoding(diseaseKey) : null;

  if (!diseaseEntry) {
    omissions.push({
      field: 'diseases',
      reasonZh:
        source.passportDiagnosisTypeRawZh === null
          ? `本平台没有可写入的 FSHD 分型。Phenopacket 的 Disease.term 必须是一个本体项，没有可核对的分型就没有可写的本体项——留空而不是默认写成最常见的 1 型。${diagnosisTypeSourceZh(source)}`
          : `记录的分型「${source.passportDiagnosisTypeRawZh}」无法明确归入 FSHD1 或 FSHD2，因此不写 Disease 条目。${diagnosisTypeSourceZh(source)}`,
    });
  } else {
    /**
     * WHAT A `Disease.term` IN THIS PACKET DOES NOT SAY.
     *
     * The v2 `Disease` message carries `term`, `excluded`, onset,
     * resolution, stage, TNM finding, primary site and laterality —
     * and nothing that records HOW the diagnosis was established.
     * `excluded` is the wrong slot to reach for: it means the disease
     * was RULED OUT, and its default false is not a confirmation.
     *
     * So a bare term made a genetically confirmed patient and a patient
     * whose repeat count this platform read off a 病历摘要 into the same
     * packet, and nothing anywhere in the envelope said so. The FHIR
     * bundle answers this on `Condition.verificationStatus`; this
     * omission is the same answer, from `geneticallyConfirmed`, in the
     * one place this format leaves for it.
     *
     * WHICH DOCUMENT WAS READ IS ASKED SEPARATELY, AND FIRST. This
     * branched on 「is a report on file」 before it branched on which
     * document supplied the values, so the transcription disclosure was
     * written only in the state where no report existed — the half of
     * the state space that has no transcription in it. The state it was
     * written FOR is the other half: a genetics report on file that
     * read out nothing is exactly when the picker falls through to a
     * 病历摘要, and that packet went out naming a laboratory report and
     * saying nothing about the page the numbers actually came off.
     * `geneticEvidenceDocumentZh` asks the reading, so the three states
     * a receiver acts differently on stay apart.
     */
    omissions.push({
      field: 'diseases[].term（诊断依据）',
      // 「档案记录的分型」 CAME OFF THIS SENTENCE. The term is now
      // classified from the evidence document's own 分型 cell when it
      // states one, so a promise that this packet's `Disease.term` is
      // the archive's value went false the day that changed — and a
      // false sentence in an omissions list is worse than no sentence,
      // because the omissions list is the one part of this envelope a
      // receiver is asked to trust. Which string it IS classified from
      // is `diagnosisTypeSourceZh`, in the omission directly above.
      reasonZh: `Phenopacket 的 Disease 消息只有 term、excluded、发病与分期等字段，没有记录「这个诊断是怎么确立的」的位置；excluded 表示「已排除该病」，它取默认值 false 不是一次确认。因此本文件里的 Disease.term 只表示本平台记录的分型归一到了这个本体项，不表示基因确诊；分型取自何处见下一条 omission。${geneticConfirmationReasonZh(source)}。${geneticEvidenceDocumentZh(source)}这个判定与 FHIR 导出的 Condition.verificationStatus 以及 TREAT-NMD 对齐导出中 diagnosis.geneticallyConfirmed 出自同一个答案；档案里那个分型值本身如何进入档案，见 TREAT-NMD 对齐导出中 diagnosis.type 的 provenanceZh 与本信封的 fieldOrigins。`,
    });
    // WHICH STRING BECAME THIS TERM. Shared verbatim with the FHIR
    // bundle's `Condition.note`, so a receiver holding both documents
    // reads one account of it and not two wordings of one.
    //
    // AFTER the 诊断依据 entry and not before it, deliberately: both
    // fields open `diseases[].term`, and the parity check that asserts
    // the three exports state 基因确诊 in one wording finds this list's
    // first entry under that prefix. The confirmation sentence is the
    // one that has to be found there.
    omissions.push({
      field: 'diseases[].term（分型取自何处）',
      reasonZh: diagnosisTypeSourceZh(source),
    });
  }

  // Phenotypic features / measurements: both require an OntologyClass
  // we cannot supply. Recorded per-category so the receiver knows
  // that data EXISTS here and was withheld for lack of a code, rather
  // than that the patient has no findings and no results.
  //
  // Both reasons are stated as facts about THIS export's mappings
  // rather than about what the repository happens to hold today. The
  // earlier wording — 「本仓库内没有可核对的 LOINC/HPO 来源」 — is a
  // claim a single promotion in codings.ts falsifies, in a document
  // this file would not be re-read while making.
  if (profile.measurements.length > 0 || profile.functionTests.length > 0) {
    omissions.push({
      field: 'measurements',
      reasonZh: `本次导出持有 ${profile.measurements.length} 条肌力记录与 ${profile.functionTests.length} 条功能测试记录。Phenopacket 的 Measurement.assay 必须是本体项（通常是 LOINC），而本导出没有为这两类记录建立任何经核对的本体映射，因此没有可写的 assay，整块不写入。本导出用了哪些编码、哪些因缺少可核对来源而留空，见 codingProvenance。这些数据在 FHIR 导出中以带显示名的形式完整保留。`,
    });
  }
  if (source.challenges.length > 0 || profile.symptomScores.length > 0) {
    omissions.push({
      field: 'phenotypicFeatures',
      reasonZh:
        'PhenotypicFeature.type 必须是 HPO 本体项，而本导出没有为症状项建立任何经核对的 HPO 映射，因此症状不以本体项形式写入，改由 TREAT-NMD 对齐导出与 FHIR 导出承载。本导出用了哪些编码、哪些因缺少可核对来源而留空，见 codingProvenance。',
    });
  }
  omissions.push(
    instrumentOmission(
      'measurements（Brooke 上肢分级 / Vignos 下肢分级）',
      // This packet is id / subject / diseases / files / metaData. It
      // holds no mobility data of any kind, so there is no section to
      // point a receiver at and it must not sound as though there is.
      '本文件不含任何行走能力或运动功能数据：即使患者在填写 Vignos 时选择了同步到基线，基线里的行走状态也不会出现在本文件的任何位置。需要行走状态请向患者索取，或改用 TREAT-NMD 对齐导出。',
    ),
  );
  omissions.push({
    field: 'interpretations',
    reasonZh:
      'FSHD1 是 4q35 上 D4Z4 重复序列的缩短（且需要允许型 4qA 单倍型），不是 DUX4 的序列变异。把 DUX4 填进 geneContext / gene-studied 会让本文件通过基因组学 profile 的校验，却向下游谎报了致病机制，因此不写 interpretations。基因报告上的各项读数按其本来面目呈现在另外两份导出里，见下一条。',
  });
  // NAMES THE CELLS, AND NAMES ALL OF THEM.
  //
  // The `interpretations` omission above used to end 「D4Z4 重复数与单倍型
  // 在 TREAT-NMD 对齐导出中按其本来面目呈现」 — a two-item list of a set
  // that has four members. 甲基化 travelled to TREAT-NMD and was not
  // named here; the EcoRI fragment travelled to no portable export at
  // all and was named nowhere. A receiver reading that sentence and
  // finding a 4qA haplotype with no size measurement had no way to tell
  // 「this patient has none」 from 「this document does not carry it」,
  // and for a report stating its length only in kb those two are
  // opposite facts about the same person.
  //
  // The sentence lists the cells rather than the values, because this
  // packet holds none of them: it is id / subject / diseases / files /
  // metaData, and there is no message on it a repeat count could go in
  // without a `VariationDescriptor` this file refuses to fabricate.
  // The judgement half of the same sweep. This packet's only clinical
  // assertion is `Disease.term`, so everything the passport's 诊断 block
  // holds beyond that term is out of it — and the omissions list is
  // this format's only place to say so.
  omissions.push({
    field: 'diseases（临床护照的基因证据分级、检测方法与诊断进度）',
    reasonZh:
      '本文件在诊断这件事上只写了一个本体项。临床护照上围绕它的其余内容都不在这里：基因证据的分级（未检测 / 方法不适用 / 结果不全 / 转录件 / 单倍型非允许型 / 可用于入组）与面向患者的说明文字、随分级生成的《检查申请说明》及其指南出处、报告上写的检测方法，以及患者在基线问卷上自己勾选的「诊断进度」。是否基因确诊这一判定见上面 diseases[].term（诊断依据）那一条，它与 FHIR 导出的 Condition.verificationStatus.text 和 TREAT-NMD 对齐导出中 diagnosis.geneticallyConfirmed 的 provenanceZh 是同一句话。',
  });
  omissions.push({
    field: 'diseases / measurements（基因报告上的读数）',
    reasonZh:
      '本文件不承载基因报告上的任何一项读数：D4Z4 重复单元数、4q 单倍型、EcoRI 片段与甲基化都不出现在这个 Phenopacket 里。Phenopacket v2 里能放这些的位置只有 interpretations 下的变异描述（上一条说明了为什么不写）与要求本体项的 Measurement，两者本导出都填不诚实。这四项连同各自的来源说明，完整出现在 TREAT-NMD 对齐导出的 diagnosis 一节与 FHIR 导出的 Observation 里——其中 EcoRI 片段与甲基化是照原样给出、本平台不作判断的读数，各自带着说明。请不要因为本文件里没有这些数据就认为患者没有做过这些检测。',
  });

  const emittedCodingKeys = diseaseEntry && diseaseKey ? [diseaseKey] : [];

  const document: PhenopacketDocument = {
    id: `openrd-profile-${resourceUuid(profile.id, 'phenopacket')}`,
    subject: {
      id: resourceUuid(profile.id, 'subject'),
      sex: toPhenopacketSex(profile.gender),
    },
    ...(diseaseEntry
      ? {
          diseases: [
            {
              term: { id: toCurie(diseaseEntry), label: diseaseEntry.label },
            },
          ],
        }
      : {}),
    ...(profile.documents.length > 0
      ? {
          files: profile.documents.map((document_) => ({
            // NOT `storageUri`. That is an internal `local://` or
            // MinIO path; publishing it would hand a receiver a
            // pointer into our object store and tell them nothing
            // they can use. The API path is what actually resolves,
            // for a caller holding the patient's own credentials.
            uri: `/patient-profiles/me/documents/${document_.id}`,
            fileAttributes: {
              documentType: document_.documentType,
              uploadedAt: document_.uploadedAt,
              // `fileAttributes` is map<string,string>; a null title
              // would serialise as the string "null".
              ...(document_.title ? { title: document_.title } : {}),
              ...(document_.mimeType ? { mimeType: document_.mimeType } : {}),
            },
          })),
        }
      : {}),
    metaData: {
      created: options.generatedAt,
      createdBy: 'openrd 肌愈通 patient-held export',
      resources: diseaseEntry
        ? [
            {
              id: 'omim',
              name: 'Online Mendelian Inheritance in Man',
              namespacePrefix: 'OMIM',
              url: 'https://www.omim.org',
              // Empty on purpose. We verified the two entry numbers
              // against papers in this repository's corpus, not
              // against a dated OMIM release, and we will not invent
              // a release string to fill the field.
              version: '',
              iriPrefix: 'https://www.omim.org/entry/',
            },
          ]
        : [],
      phenopacketSchemaVersion: '2.0',
    },
  };

  return {
    format: 'GA4GH Phenopacket v2',
    conformanceZh:
      '按 Phenopacket v2 的消息结构序列化，未经官方校验器校验。只填写了能够如实填写的部分；所有因缺少可核对本体项而未写入的内容都列在 omissions 中，并说明了原因与替代承载位置。',
    generatedAt: options.generatedAt,
    document,
    omissions,
    fieldOrigins: source.fieldOrigins,
    notes: {
      // §B3. A Phenopacket is protobuf-with-a-JSON-mapping; there is no
      // field on any of its messages for 「this particular answer was
      // typed by our staff rather than by the patient」, and inventing
      // one would make the document non-conformant. So it rides the
      // envelope — see envelope.ts on why that is the honest place
      // rather than a hidden one.
      字段来源:
        source.fieldOrigins.length === 0
          ? NO_ADMIN_FIELD_ORIGIN_NOTE_ZH
          : `本次导出中有 ${source.fieldOrigins.length} 个基线字段不是患者本人填写的（由本平台管理员代为录入，或来源记录读不出来）：${source.fieldOrigins
              .map((origin) => origin.labelZh)
              .join('、')}。逐条见信封的 fieldOrigins。不要把这些值当作患者自述来统计。`,
      本体项:
        'Phenopacket 的多数字段要求本体项（id + label），没有「知道是什么但没有编码」的位置。本导出不会为了让文件更完整而填入未经核对的本体 id。',
      文件路径:
        'files[].uri 是本平台的 API 路径，需要患者本人的凭据才能取到原件；导出中不包含对象存储的内部地址。',
      本地留存: options.includeLocalOnly
        ? '本次为本地留存版本，但 Phenopacket 部分本身不承载姓名等直接身份信息。'
        : 'subject.id 是内部标识，不含姓名等直接身份信息。',
    },
    codingProvenance: buildCodingProvenance(emittedCodingKeys),
  };
};
