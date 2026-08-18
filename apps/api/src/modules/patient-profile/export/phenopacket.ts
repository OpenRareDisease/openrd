import {
  buildCodingProvenance,
  toCurie,
  verifiedCoding,
  type CodingProvenance,
} from './codings.js';
import type { ExportOmission, PortableExportEnvelope } from './envelope.js';
import {
  diagnosisTypeSourceZh,
  familyHistoryOmission,
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
  // UNCONDITIONAL, for the reason `phenotypicFeatures` below is. Gated
  // on the two counts, a packet built for a patient with no strength
  // readings said nothing at all about `measurements` — so a receiver
  // could not tell 「this format never carries them」 from 「this patient
  // has none」, and those are different instructions about whether to go
  // back to the patient. `Measurement` is a slot this format HAS, which
  // is the second half of what envelope.ts says an entry may be about.
  omissions.push({
    field: 'measurements',
    // 「完整保留」 CAME OFF THE LAST SENTENCE. The FHIR bundle caps its
    // Observations and declares the cut in its own omissions list, so
    // for a profile past that cap this packet was promising a
    // completeness the other document says it does not have — and a
    // receiver told 「it is all over there」 does not go looking for the
    // omission that says otherwise.
    reasonZh: `本次导出持有 ${profile.measurements.length} 条肌力记录与 ${profile.functionTests.length} 条功能测试记录。Phenopacket 的 Measurement.assay 必须是本体项（通常是 LOINC），而本导出没有为这两类记录建立任何经核对的本体映射，因此没有可写的 assay，整块不写入。本导出用了哪些编码、哪些因缺少可核对来源而留空，见 codingProvenance。这些数据在 FHIR 导出中以带显示名的形式给出，但那份导出对条目数有上限、超出时会截断并在它自己的 omissions 里说明；不受截断影响的完整时间序列在不带 format 参数的数据导出里。`,
  });
  // EVERY FINDING THAT WOULD NEED AN HPO TERM, NOT THE TWO THIS GATE
  // STARTED WITH.
  //
  // The gate asked `challenges` and `symptomScores` only, and the
  // sentence named 「症状」. Three other blocks of findings are in the
  // same position and were in neither: the ADL difficulty ratings
  // (`dailyImpacts`, which the FHIR bundle emits as Observations), the
  // baseline questionnaire's own body-state answers (抬臂困难 / 面部肌无力
  // / 足下垂 / 呼吸相关症状), and 起病部位. A profile whose only findings
  // are ADL ratings produced NO entry here at all, so the packet went
  // out with an omissions list that declared nothing about them — and
  // 面部肌无力 is a defining feature of this disease, so a receiver
  // reading a packet with no phenotypicFeatures and no omission naming
  // one reads 「no facial weakness」.
  //
  // AND IT IS UNCONDITIONAL NOW, because the sentence is about what this
  // format can express rather than about how many rows a particular
  // profile happens to have. Gated on the two counts, a profile whose
  // only findings are baseline answers produced no entry at all, and
  // 面部肌无力 is a defining feature of this disease: a receiver reading a
  // packet with no `phenotypicFeatures` and no omission naming one reads
  // 「no facial weakness」. The counts stay in the sentence, where 0 is
  // itself an answer a receiver can act on.
  omissions.push({
    field: 'phenotypicFeatures',
    reasonZh: `PhenotypicFeature.type 必须是 HPO 本体项，而本导出没有为症状项建立任何经核对的 HPO 映射，因此本文件不写 phenotypicFeatures，症状改由 TREAT-NMD 对齐导出与 FHIR 导出承载。本平台在这一类下持有的内容是：${profile.symptomScores.length} 条症状自评、${source.challenges.length} 项基线困难程度自评、${profile.dailyImpacts.length} 条日常活动困难程度记录，以及基线问卷记录的抬臂困难、面部肌无力、足下垂、呼吸相关症状与起病部位。其中基线问卷的困难程度自评、那几项身体状况与起病部位只在 TREAT-NMD 对齐导出里有对应条目（患者答了的才会出现）。请不要把它们在本文件里的缺席读成患者没有这些表现。本导出用了哪些编码、哪些因缺少可核对来源而留空，见 codingProvenance。`,
  });
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
  //
  // IT IS PUSHED HERE, IMMEDIATELY AFTER `interpretations`, AND THAT IS
  // THE WHOLE POINT OF THE POSITION. That entry ends 「…见下一条」 and for
  // one round the entry pushed next was the platform's JUDGEMENT of the
  // report, which says nothing about where the readings are; the entry
  // it means was two later. This comment block already sat above the
  // wrong push, which is how the two got swapped in the first place —
  // so the block and the push it describes now travel together, and
  // 「下一条」 resolves to the entry that answers it.
  omissions.push({
    field: 'diseases / measurements（基因报告上的读数）',
    reasonZh:
      '本文件不承载基因报告上的任何一项读数：D4Z4 重复单元数、4q 单倍型、EcoRI 片段与甲基化都不出现在这个 Phenopacket 里。Phenopacket v2 里能放这些的位置只有 interpretations 下的变异描述（上一条说明了为什么不写）与要求本体项的 Measurement，两者本导出都填不诚实。这四项连同各自的来源说明，完整出现在 TREAT-NMD 对齐导出的 diagnosis 一节与 FHIR 导出的 Observation 里——其中 EcoRI 片段与甲基化是照原样给出、本平台不作判断的读数，各自带着说明。请不要因为本文件里没有这些数据就认为患者没有做过这些检测。',
  });
  // The judgement half of the same sweep. This packet's only clinical
  // assertion is `Disease.term`, so everything the passport's 诊断 block
  // holds beyond that term is out of it — and the omissions list is
  // this format's only place to say so.
  //
  // WHERE IT SENDS THE READER FOR 是否基因确诊 DEPENDS ON WHETHER THERE
  // IS A TERM. The 诊断依据 entry is pushed only inside the `diseaseEntry`
  // branch, and this sentence pointed at it unconditionally — so for
  // every profile with no classifiable 分型 the pointer named an entry
  // that is not in this list, which is the false-sentence-in-an-
  // omissions-list failure this file's own note is about. With no term
  // there is no 「本文件断言的诊断」 to qualify either, so the sentence
  // says where the answer lives instead of pointing inside.
  omissions.push({
    field: 'diseases（临床护照的基因证据分级、检测方法与诊断进度）',
    reasonZh: `本文件在诊断这件事上${diseaseEntry ? '只写了一个本体项' : '什么都没有写'}。临床护照上围绕它的其余内容都不在这里：基因证据的分级（未检测 / 方法不适用 / 结果不全 / 转录件 / 单倍型非允许型 / 可用于入组）与面向患者的说明文字、随分级生成的《检查申请说明》及其指南出处、报告上写的检测方法，以及患者在基线问卷上自己勾选的「诊断进度」。是否基因确诊这一判定${diseaseEntry ? '见上面 diseases[].term（诊断依据）那一条，它' : '在本文件里没有承载位置，它'}与 FHIR 导出的 Condition.verificationStatus.text 和 TREAT-NMD 对齐导出中 diagnosis.geneticallyConfirmed 的 provenanceZh 是同一句话。`,
  });

  // ------------------------------------- the rest of what is held
  //
  // Everything below is a clinical fact `normaliseSource` or the DTO
  // holds that this packet does not carry. None of them used to be
  // declared, and an omissions list that declares the genetic cells and
  // the instruments and then goes silent on the family history and the
  // medication list reads as a complete one — which is the specific
  // failure envelope.ts says this field exists to prevent.
  omissions.push(
    familyHistoryOmission(
      'Family.pedigree（家族史）',
      // v2 has no family-history field anywhere on the `Phenopacket`
      // message. Its answer is a DIFFERENT top-level message — `Family`,
      // carrying a `Pedigree` of structured `Person` entries with
      // relationship and affected status per relative. What this
      // platform holds is one Chinese sentence, so filling that message
      // would mean inventing a relative-by-relative pedigree out of
      // 「父亲和姑姑都有类似的抬手困难」, which is the same fabrication
      // this file refuses for ontology ids.
      'Phenopacket 消息本身没有家族史字段：v2 里承载它的是另一个顶层消息 Family 及其 Pedigree，需要逐个亲属的结构化谱系（亲缘关系、是否患病），而本平台持有的是一段中文自述，把它拆成谱系条目等于替患者的亲属编造结构化病史。',
    ),
  );
  // TWO YEARS, AND NEITHER HAS A TRUTHFUL SLOT HERE.
  //
  // `Individual.dateOfBirth` is a protobuf Timestamp — an instant. This
  // platform holds a birth YEAR (`year-value.ts` keeps 已知 / 记不清了 /
  // 未采集 apart on purpose), and writing 1988-01-01T00:00:00Z would
  // manufacture a day and a month nobody stated. The FHIR bundle has
  // somewhere to put a year-only answer and uses it; this format does
  // not, which is a fact worth telling a receiver rather than hiding.
  //
  // `Disease.onset` is the trap on the other side: it is the slot a
  // reader reaches for when they see 确诊年份 missing, and it means
  // 发病 — when the disease STARTED. 确诊年份 is when a clinician named
  // it, routinely a decade later in this disease. Writing one into the
  // other would not be a rounding error; it would move this patient's
  // onset by ten years in every cohort built off the packet.
  omissions.push({
    field: 'subject.dateOfBirth / diseases[].onset（出生年份与确诊年份）',
    reasonZh:
      '本文件不写出生日期，也不写发病时间。本平台记录的是出生年份与确诊年份，而 Individual.dateOfBirth 是一个精确到时刻的时间戳——只知道年份却写成 1 月 1 日零点，等于凭空给出一个月份和一天。确诊年份也没有可写的位置：Disease.onset 说的是「发病」，不是「确诊」，FSHD 患者从起病到确诊常隔很多年，把确诊年份填进 onset 会让下游把这个人的发病时间整体挪早。出生年份只在 FHIR 导出里（Patient.birthDate 支持只写年份），TREAT-NMD 对齐导出也不承载它；确诊年份在 TREAT-NMD 对齐导出的 diagnosis.year（区分「记不清了」与「未采集」）与 FHIR 导出的 Condition.recordedDate 上。',
  });
  // MedicalAction is the v2 slot for all three of these, and all three
  // would need an ontology-coded agent or procedure to fill it — the
  // same wall `phenotypicFeatures` and `measurements` hit. Named
  // individually rather than as 「treatment data」: a receiver deciding
  // whether to ask the patient needs to know WHICH of these exists.
  omissions.push({
    field: 'medicalActions（用药、辅助器具与里程碑事件）',
    // The three milestone kinds are named in a sentence of their own,
    // and deliberately not folded into the counted one. One of them is
    // 开始使用轮椅, so the sentence naming them enters the claim class
    // reason-claims.ts defines and has to be approved by exact string
    // in phenopacket.test.ts — which only works if the string does not
    // move with the profile's row counts.
    reasonZh: `本文件不写 medicalActions。本次导出持有 ${profile.medications.length} 条用药记录、${source.currentStatus.assistiveDevices.length} 件基线问卷记录的正在使用的辅助器具，以及 ${source.milestones.length} 条里程碑事件。里程碑事件指本平台记录的三类转折点：开始使用轮椅、开始无创通气、开始使用踝足矫形器。MedicalAction 要求把治疗写成本体项（药物、操作或治疗方案），本导出没有为其中任何一类建立经核对的本体映射，因此整块不写入，也不用自由文本硬凑。辅助器具与里程碑事件在 TREAT-NMD 对齐导出里有，里程碑事件在 FHIR 导出里也有对应的 Observation；用药记录三份可携带导出都不承载，需要请直接向患者索取。`,
  });
  // The follow-up events that are NOT milestones: a fall, a first foot
  // drop, a first breathing discomfort. The FHIR bundle carries every
  // one of them as an Observation and the TREAT-NMD document as its own
  // section, so this packet is the only one of the three that drops
  // them — and dropping them silently makes the exported course of the
  // disease look like a straight line.
  omissions.push({
    field: 'phenotypicFeatures / medicalActions（随访事件）',
    reasonZh: `本文件不承载随访事件。本次导出持有 ${source.followupEvents.length} 条非里程碑的随访事件（跌倒、新出现的足下垂、新出现的抬臂困难、新出现的呼吸不适等，各自带患者自评的严重程度）。它们要写进本格式，同样需要 HPO 本体项或本体化的 MedicalAction，本导出两者都没有。完整内容见 TREAT-NMD 对齐导出的 followupEvents 与 FHIR 导出的 Observation。本文件里没有这些事件，不表示这些事件没有发生过。`,
  });
  // The remainder, in one entry because they share one reason: this
  // packet is deliberately id / subject / diseases / files / metaData,
  // and none of these has a slot on any of those five messages. Listed
  // by name anyway — 「we also hold some other things」 is not a
  // declaration a receiver can act on.
  omissions.push({
    field: 'subject / measurements（身份信息、体格测量、地区与日常记录）',
    reasonZh: `本文件只写 id、subject、diseases、files 与 metaData。本平台还持有下列内容，本次导出都不承载：患者姓名与希望被称呼的名字、确诊医生 / 主诊医生的姓名（第三人的姓名）、联系电话与邮箱、常住地区、本平台内部的患者编号、身高、体重、血型（Measurement 同样要求本体项，本导出没有可核对的映射）、档案备注，以及 ${profile.activityLogs.length} 条患者自己写的日常记录（含心情评分）。其中姓名、称呼与确诊医生姓名只出现在明确请求本地留存版本的 TREAT-NMD 对齐导出的 localOnly 节；联系方式、常住地区、患者编号、身高、体重、血型与日常记录三份可携带导出都不写，需要请直接向患者索取。subject.id 是本平台内部的标识，不是患者编号，也不含姓名。`,
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
