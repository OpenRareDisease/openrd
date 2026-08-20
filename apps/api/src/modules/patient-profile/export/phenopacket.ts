import {
  buildCodingProvenance,
  toCurie,
  verifiedCoding,
  type CodingProvenance,
} from './codings.js';
import type { ExportOmission, PortableExportEnvelope } from './envelope.js';
import {
  diagnosisTypeSourceZh,
  fallsDiaryOmission,
  familyHistoryOmission,
  geneticConfirmationReasonZh,
  geneticEvidenceDocumentZh,
  instrumentOmission,
  reportReadingsOmission,
  resourceUuid,
  heldDatePrecision,
  NO_ADMIN_FIELD_ORIGIN_NOTE_ZH,
  REPORT_READING_KEYS,
  type HeldDatePrecision,
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

/**
 * WHY EVERY ARM STILL OMITS, including `day`.
 *
 * `Individual.dateOfBirth` is a protobuf Timestamp — an INSTANT. A
 * full 1988-04-02 does not become writable by being complete: a
 * Timestamp still needs a time of day, and the product calendar is
 * Asia/Shanghai, so 「midnight」 is both an invented instant and a
 * choice of offset that can move the printed day. There is no
 * precision at which this element can be filled from what this
 * platform holds, so the value is never emitted and only the REASON
 * derives. `Patient.birthDate` in the FHIR bundle is a `date`, not an
 * instant, which is why that one may carry it and this one may not.
 *
 * The FHIR pointers below are stated per-arm because they resolve
 * per-arm — verified by building both documents from one
 * `NormalisedSource`: `Patient.birthDate` is 1988-04-02 for `day`,
 * 1988 for `year`, and ABSENT for both no-value arms.
 */
const BIRTH_DATE_REASON_ZH: Record<HeldDatePrecision, string> = {
  day: '本档案上不只有出生年份，还有精确到日的出生日期（这里不复述它的值：本文件本就不写出生日期，在说明里印出来等于绕开这一条）。即便如此本文件也不写，因为 Individual.dateOfBirth 是一个精确到时刻的时间戳，写成当天零点仍要补出一个没人记录过的时刻。完整的出生日期在 FHIR 导出的 Patient.birthDate 上，该字段按档案的实际精度写出（档案只有年份时写年份，有完整日期时写完整日期）；TREAT-NMD 对齐导出不承载它。',
  year: '本档案上只有出生年份，没有精确到日的出生日期，而 Individual.dateOfBirth 是一个精确到时刻的时间戳——只知道年份却写成 1 月 1 日零点，等于凭空给出一个月份和一天。这个年份写在 FHIR 导出的 Patient.birthDate 上（该字段按档案的实际精度写出，这份档案上写出来的就是年份）；TREAT-NMD 对齐导出不承载它。',
  not_remembered:
    '本档案上没有出生日期，也没有出生年份：这一项问过，患者记不清。所以这一条不是「有值而不写」——本平台此刻没有可写的出生时间，FHIR 导出的 Patient.birthDate 因此也是空的（那份文件里根本没有这个字段），TREAT-NMD 对齐导出本就不承载它。日后即使补上，Individual.dateOfBirth 仍是一个精确到时刻的时间戳，本文件不会为它补出一个没人记录过的时刻。',
  not_collected:
    '本档案上没有出生日期，也没有出生年份，本平台没有采集到——这不等于问过而患者答不上来。所以这一条不是「有值而不写」：本平台此刻没有可写的出生时间，FHIR 导出的 Patient.birthDate 因此也是空的（那份文件里根本没有这个字段），TREAT-NMD 对齐导出本就不承载它。日后即使补上，Individual.dateOfBirth 仍是一个精确到时刻的时间戳，本文件不会为它补出一个没人记录过的时刻。',
};

/**
 * The same four arms for 确诊时间, and the pointers differ in the same
 * way — verified by building all three documents from one source:
 * TREAT-NMD's `diagnosis.year` serialises 已知 / 记不清了 / 未采集 by
 * name in every arm, while FHIR's `Condition.recordedDate` is spread
 * ONLY on 已知 and is absent from the resource otherwise. Sending a
 * receiver to `recordedDate` for a 记不清了 archive is sending them to
 * an element that is not there.
 */
const DIAGNOSIS_DATE_REASON_ZH: Record<HeldDatePrecision, string> = {
  day: '确诊年份在 TREAT-NMD 对齐导出的 diagnosis.year（区分「记不清了」与「未采集」）与 FHIR 导出的 Condition.recordedDate 上——但这两处都只写到年。本档案上的确诊日期是精确到日的，临床护照、Markdown 导出、分享页与转诊资料都按日打印；确诊日期的月和日三份可携带导出都不承载，需要请直接向患者索取。',
  year: '确诊年份在 TREAT-NMD 对齐导出的 diagnosis.year（区分「记不清了」与「未采集」）与 FHIR 导出的 Condition.recordedDate 上，两处都只写到年——本档案上本来也只有年份，没有精确到日的确诊日期。',
  not_remembered:
    '本档案上没有确诊日期，也没有确诊年份：这一项问过，患者记不清。TREAT-NMD 对齐导出的 diagnosis.year 会把这个答案原样写成「记不清了」，FHIR 导出的 Condition.recordedDate 则整个不出现——两处都不要读成本平台没有问过。',
  not_collected:
    '本档案上没有确诊日期，也没有确诊年份，本平台没有采集到。TREAT-NMD 对齐导出的 diagnosis.year 写成「未采集」，FHIR 导出的 Condition.recordedDate 整个不出现——两处都不要读成问过而患者答不上来。',
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
    reasonZh: `PhenotypicFeature.type 必须是 HPO 本体项，而本导出没有为症状项建立任何经核对的 HPO 映射，因此本文件不写 phenotypicFeatures，症状改由 TREAT-NMD 对齐导出与 FHIR 导出承载。本平台在这一类下的栏位是这些，本次导出实际持有的条数写在各自前面：${profile.symptomScores.length} 条症状自评、${source.challenges.length} 项基线困难程度自评、${profile.dailyImpacts.length} 条日常活动困难程度记录，另有基线问卷的抬臂困难、面部肌无力、足下垂、呼吸相关症状与起病部位几项（患者答了才有值，这份档案上有没有值本文件不说）。其中基线问卷的困难程度自评、那几项身体状况与起病部位只在 TREAT-NMD 对齐导出里有对应条目（患者答了的才会出现）。请不要把它们在本文件里的缺席读成患者没有这些表现。本导出用了哪些编码、哪些因缺少可核对来源而留空，见 codingProvenance。`,
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
      'FSHD1 是 4q35 上 D4Z4 重复序列的缩短（且需要允许型 4qA 单倍型），不是 DUX4 的序列变异。把 DUX4 填进 geneContext / gene-studied 会让本文件通过基因组学 profile 的校验，却向下游谎报了致病机制，因此不写 interpretations。基因报告上凡是本平台读到过的读数，都按其本来面目呈现在另外两份导出里，见下一条。',
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
  //
  // AND THE POINTER SENTENCE NO LONGER PROMISES SOMETHING THE FHIR
  // BUNDLE DOES NOT DO. It read 「凡是本平台从这份档案上读到过或档案里记着的，
  // 都…出现在 TREAT-NMD 对齐导出的 diagnosis 一节与 FHIR 导出的
  // Observation 里」, and the second half of that 「或」 is false: the FHIR
  // bundle builds its genetic Observations out of `reportFields`, which
  // exist only where the evidence DOCUMENT had a cell. A 甲基化 answered
  // on the baseline questionnaire beside a report that never mentions
  // methylation is in TREAT-NMD and in neither of the other two — so
  // this document was sending its receiver to a bundle that does not
  // hold the value, which is worse than the silence it replaced: a
  // receiver who follows a pointer and finds nothing concludes the
  // patient has nothing. The two routes are now named separately, and
  // the FHIR bundle declares the archive-only case in its own omissions
  // (`archiveOnlyGeneticCells` in export-source.ts is the one reading
  // both files ask).
  omissions.push({
    field: 'diseases / measurements（基因报告上的读数）',
    reasonZh:
      '本文件不承载基因报告上的任何一项读数：D4Z4 重复单元数、4q 单倍型、EcoRI 片段与甲基化都不出现在这个 Phenopacket 里。Phenopacket v2 里能放这些的位置只有 interpretations 下的变异描述（上一条说明了为什么不写）与要求本体项的 Measurement，两者本导出都填不诚实。这四项在另外两份导出里分两条路走，请按路找：本平台从这份档案的基因证据文件上直接读到的那几项，连同各自的来源说明，出现在 TREAT-NMD 对齐导出的 diagnosis 一节与 FHIR 导出的 Observation 里；只记在本平台档案里、而那份报告上没有的那几项（基线问卷为 D4Z4 重复单元数、4q 单倍型与甲基化各留了输入框），只出现在 TREAT-NMD 对齐导出里，FHIR 导出不承载它们并在它自己的 omissions 里说明原因。哪一项都没有的，三份导出里都没有条目，不要把它们的缺席读成本文件把它们藏起来了。其中 EcoRI 片段与甲基化是照原样给出、本平台不作判断的读数，各自带着说明。请不要因为本文件里没有这些数据就认为患者没有做过这些检测。',
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
      // this file refuses for ontology ids. The clause naming what this
      // platform holds is NOT written here — it derives, in the helper,
      // because it is false for an archive with an empty 家族史 box.
      'Phenopacket 消息本身没有家族史字段：v2 里承载它的是另一个顶层消息 Family 及其 Pedigree，需要逐个亲属的结构化谱系（亲缘关系、是否患病），',
      source.familyHistoryStatement,
    ),
  );
  // TWO DATES, AND NEITHER HAS A TRUTHFUL SLOT HERE.
  //
  // `Individual.dateOfBirth` is a protobuf Timestamp — an instant, so
  // this format writes nothing either way: a Timestamp needs a time of
  // day, and midnight is as invented as 1 January.
  //
  // WHAT THE SENTENCE MAY NOT SAY IS WHY IT BRANCHES. It used to open
  // 「本平台记录的是出生年份与确诊年份」 for every profile, and that is
  // a claim about the PLATFORM which two DATE columns falsify:
  // `patient_profiles.date_of_birth` and `patient_profiles.diagnosis_date`
  // are both filled to the day on ordinary archives. `year-value.ts`
  // keeps 已知 / 记不清了 / 未采集 apart for the questionnaire's
  // 出生年份, and that is the answer this exporter's `birthYear` sees —
  // but the FHIR bundle built from the SAME `NormalisedSource` in the
  // same request reads `profile.dateOfBirth` first and prints
  // 1988-04-02 on `Patient.birthDate`. A receiver told the platform
  // records only a year stops asking for a date the platform has.
  //
  // THE VALUES ARE NOT QUOTED HERE. This packet withholds the birth
  // date on purpose and the reason travels inside the same JSON, so
  // printing the date to explain not printing it would hand the
  // receiver the exact thing the field refuses. The branch states the
  // PRECISION held, never the value.
  //
  // `Disease.onset` is the trap on the other side: it is the slot a
  // reader reaches for when they see 确诊年份 missing, and it means
  // 发病 — when the disease STARTED. 确诊年份 is when a clinician named
  // it, routinely a decade later in this disease. Writing one into the
  // other would not be a rounding error; it would move this patient's
  // onset by ten years in every cohort built off the packet.
  //
  // AND THE MONTH AND DAY OF 确诊日期 REACH NO PORTABLE EXPORT.
  // `Condition.recordedDate` is `String(source.diagnosisYear.year)` and
  // TREAT-NMD's `diagnosis.year` is the same answer, so an archive
  // holding 2014-06-01 — printed in full on the passport, the markdown
  // export, the share page and the referral pack — arrives at all three
  // documents as 2014. Nothing declared that, in any of the three. This
  // entry declares it for the one document it belongs to; the pointer
  // it hands a receiver (「去 Condition.recordedDate 取确诊年份」) is
  // this file's sentence to keep honest.
  //
  // FOUR STATES PER DATE, NOT TWO, and the two the earlier branch did
  // not have are the ones where the archive holds NOTHING. Rendered
  // over a profile with no baseline and no date column, the 「只有年份」
  // arm told a registry 本档案上记录的是出生年份与确诊年份 and then sent
  // it to `Patient.birthDate` and `Condition.recordedDate` for the
  // values — and this same request's FHIR bundle emits NEITHER element
  // for that profile (fhir-r4.ts: `birthDate` falls through to
  // undefined, `recordedDate` is only spread when
  // `diagnosisYear.kind === 'year'`). A pointer to an element that is
  // not in the document is the same defect as the false holding claim
  // it was written to fix, one surface further out.
  //
  // 记不清了 AND 未采集 STAY APART here for the reason year-value.ts
  // states: one says the question was put to the patient and they do
  // not know, the other says it was never put. Collapsed into 「没有」,
  // a registry reads a gap where there is an answer.
  const birthPrecision = heldDatePrecision(profile.dateOfBirth, source.birthYear);
  const diagnosisPrecision = heldDatePrecision(profile.diagnosisDate, source.diagnosisYear);
  omissions.push({
    field: 'subject.dateOfBirth / diseases[].onset（出生年份与确诊年份）',
    reasonZh: [
      '本文件不写出生日期，也不写发病时间。',
      BIRTH_DATE_REASON_ZH[birthPrecision],
      '确诊时间同样没有可写的位置：Disease.onset 说的是「发病」，不是「确诊」，FSHD 患者从起病到确诊常隔很多年，把确诊年份填进 onset 会让下游把这个人的发病时间整体挪早。',
      DIAGNOSIS_DATE_REASON_ZH[diagnosisPrecision],
    ].join(''),
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
    // 「完整内容见 …」 WAS FALSE AND IS GONE. It sent a receiver to the
    // other two documents for the whole of a fall, and neither of them
    // holds the falls diary's five structured answers either — nothing
    // does. A cross-reference that promises completeness the referenced
    // document does not have is the same class of error as an empty
    // omissions array: it tells the receiver to stop asking. What those
    // two documents actually carry is now stated, and the diary gets
    // its own entry below.
    reasonZh: `本文件不承载随访事件。本次导出持有 ${source.followupEvents.length} 条非里程碑的随访事件（跌倒、新出现的足下垂、新出现的抬臂困难、新出现的呼吸不适等，各自带患者自评的严重程度）。它们要写进本格式，同样需要 HPO 本体项或本体化的 MedicalAction，本导出两者都没有。这些事件本身见 TREAT-NMD 对齐导出的 followupEvents 与 FHIR 导出的 Observation——但那两份也只有日期、事件类型与患者自评的严重程度；跌倒另有五项结构化明细，三份可携带导出都不承载，见下一条。本文件里没有这些事件，不表示这些事件没有发生过。`,
  });
  omissions.push(
    fallsDiaryOmission(
      'phenotypicFeatures / medicalActions（跌倒日记的结构化明细）',
      // This packet is id / subject / diseases / files / metaData. It
      // carries no follow-up event of any kind, so there is no sibling
      // item in this document to point at, and the sentence must not
      // sound as though there is.
      '本文件连跌倒这件事本身都不承载（见上一条），因此这里没有可供参照的条目；跌倒的日期与严重程度见 TREAT-NMD 对齐导出的 followupEvents 与 FHIR 导出的 Observation，上面那五项则哪一份都没有。',
    ),
  );
  // THE READINGS PARSED OFF THE PATIENT'S OWN UPLOADED REPORTS.
  //
  // `measurements` above declares the STRENGTH and FUNCTION TEST rows —
  // the ones the patient or a clinician entered through this product —
  // and it was read for years as if it covered everything a Measurement
  // could have held. It did not: CK, 肌红蛋白, LDH, CK-MB, FVC%pred,
  // TLC%pred, DLCO%pred, LVEF, QTc, 前锯肌脂肪化等级 and the five MRC
  // grades this platform parses off uploaded reports are a different
  // store, reached through `source.reportFields`, which this file has
  // never read. Same failure shape as the falls diary two entries below:
  // a declaration that is true about a neighbouring fact reads as
  // covering the one beside it.
  //
  // Its own entry rather than a clause on `measurements` for exactly
  // that reason — and because the reason differs. Those rows have no
  // assay term; these have a report, a date and a laboratory behind
  // them, and one of them (FVC%pred) does have a ledgered LOINC. What
  // stops them is the same ontology-first constraint applied to a set
  // codings.ts has verified only a corner of, so publishing the corner
  // as `measurements` and dropping the rest would be worse than
  // declaring the set.
  omissions.push(
    reportReadingsOmission(
      'measurements（检验、肺功能、心脏、影像与体格检查的报告解析读数）',
      source.reportFields.filter((field) => REPORT_READING_KEYS.includes(field.key)).length,
      'Phenopacket 的 Measurement.assay 必须是本体项（通常是 LOINC）。codings.ts 为其中几项登记了候选的 LOINC 编码，但一条都没有通过核对——本仓库内没有 LOINC 发行版，也没有任何带 LOINC 的文件可以对照，每一条候选都写着自己为什么没被核对。因此这些项目一个都没有可写的 assay，整块不写入。本导出用了哪些编码、哪些因缺少可核对来源而留空，见 codingProvenance。这些读数连同各自的来源文件在 FHIR 导出里以 Observation 给出（那份导出同样不写编码，只写显示名；TREAT-NMD 对齐导出则两者都不承载，并在它自己的 omissions 里说明）。',
    ),
  );
  // The remainder, in one entry because they share one reason: this
  // packet is deliberately id / subject / diseases / files / metaData,
  // and none of these has a slot on any of those five messages. Listed
  // by name anyway — 「we also hold some other things」 is not a
  // declaration a receiver can act on.
  omissions.push({
    field: 'subject / measurements（身份信息、体格测量、地区与日常记录）',
    reasonZh: `本文件只写 id、subject、diseases、files 与 metaData。本平台为下列内容各留了栏位，这份档案上填没填是另一回事，本次导出一概不承载：患者姓名与希望被称呼的名字、确诊医生 / 主诊医生的姓名（第三人的姓名）、联系电话与邮箱、常住地区、本平台内部的患者编号、身高、体重、血型（Measurement 同样要求本体项，本导出没有可核对的映射）、档案备注与基线问卷自己的基线备注（这是两处不同的自由文本存储，都不承载），以及 ${profile.activityLogs.length} 条患者自己写的日常记录（含心情评分）。其中姓名、称呼与确诊医生姓名只出现在明确请求本地留存版本的 TREAT-NMD 对齐导出的 localOnly 节；联系方式、常住地区、患者编号、身高、体重、血型与日常记录三份可携带导出都不写，需要请直接向患者索取。subject.id 是本平台内部的标识，不是患者编号，也不含姓名。`,
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
