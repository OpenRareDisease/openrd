import { buildCodingProvenance, type CodingProvenance } from './codings.js';
import type { ExportOmission, PortableExportEnvelope } from './envelope.js';
import {
  diagnosisTypeSourceZh,
  diagnosisYearProvenanceZh,
  geneticCellSourceZh,
  geneticConfirmationReasonZh,
  geneticEvidenceDocumentZh,
  geneticEvidenceResultValue,
  geneticResultValue,
  geneticValueProvenanceZh,
  fallsDiaryOmission,
  heldDatePrecision,
  instrumentOmission,
  withOriginNote,
  ECORI_FRAGMENT_NOT_JUDGED_ZH,
  METHYLATION_NOT_JUDGED_ZH,
  NO_ADMIN_FIELD_ORIGIN_NOTE_ZH,
  type HeldDatePrecision,
  type MilestoneEvent,
  type NormalisedSource,
} from './export-source.js';
import {
  AMBULATION_LABELS,
  DAILY_IMPACT_LABELS,
  FOLLOWUP_EVENT_LABELS,
  FOLLOWUP_EVENT_SEVERITY_LABELS,
  FUNCTION_TEST_LABELS,
  MUSCLE_GROUP_LABELS,
  SIDE_LABELS,
  SYMPTOM_LABELS,
  labelFor,
} from './labels.js';
import type { OccurrenceDate } from './occurrence-date.js';
import { serialiseYear, type SerialisedYear } from './year-value.js';

/**
 * TREAT-NMD FSHD core dataset — alignment, not a conformance claim.
 *
 * WHAT IS VERIFIED. This repository's corpus establishes that the
 * dataset exists, who agreed it, when it was revised, and what its
 * MANDATORY content areas are:
 *
 *   「Since 2013, the UK FSHD Patient Registry has collected the
 *    TREAT-NMD Core Dataset for FSHD, a minimal list of data items
 *    agreed to at a 2010 European Neuro Muscular Centre workshop and
 *    updated in 2016. … The 2016 dataset contains mandatory questions
 *    on diagnosis, family history, symptoms, motor function,
 *    wheelchair use, and pregnancy history. An optional question on
 *    ethnicity is also included.」
 *
 *   — abstract P2.08, 2025 FSHD International Research Congress
 *     abstract book, held at
 *     content/medical-kb/source/FSHD_知识库/2025-IRC-ABSTRACT-BOOK.pdf
 *
 * The six sections below are those six areas, in that order, plus the
 * optional ethnicity item. That is the strongest statement about this
 * dataset that can be made from a source on this machine.
 *
 * WHAT IS NOT VERIFIED, AND IS THEREFORE NOT CLAIMED. This lane was
 * specified as 「Core Dataset v2 — the sixteen sections」. No source in
 * this repository uses a 「v2」 version label for this dataset, and none
 * enumerates sixteen sections or gives item numbers. So this
 * serialiser does not print a version number it cannot support, does
 * not invent sixteen section headings to fill a count, and does not
 * emit per-item dataset references like 「1a」 — a fabricated item
 * reference is worse than none, because a registry ingesting it will
 * map our data onto the wrong question. `conformanceZh` says all of
 * this in the output itself, where a receiver will actually see it.
 *
 * WHY THE 1a/1b/1c BLOCK IS STILL HELD BACK. The three direct
 * identifiers — the patient's name, their relatives, and the
 * diagnosing physician — are withheld by default regardless of what
 * their item numbers turn out to be, because the reasoning does not
 * depend on the numbering: identifiers stay with the collecting
 * registry, and family history is a statement about people who are
 * not our data subject.
 */

export type TreatNmdValue =
  | string
  | number
  | boolean
  | null
  | SerialisedYear
  | OccurrenceDate
  | readonly string[]
  | { readonly [key: string]: unknown }
  | ReadonlyArray<{ readonly [key: string]: unknown }>;

export interface TreatNmdItem {
  readonly key: string;
  readonly labelZh: string;
  readonly value: TreatNmdValue;
  /**
   * Where this value came from. Required on every item, because
   * 「患者自述」 and 「基因报告 OCR」 are not the same evidence and a
   * registry has to be able to weight them differently.
   */
  readonly provenanceZh: string;
}

export interface TreatNmdSection {
  readonly key: string;
  readonly titleZh: string;
  /**
   * False means「我们没有采集这个问题」, and it is emitted as its own
   * field rather than left to an empty `items` array. Absent and
   * negative are different answers: a registry reading an empty
   * pregnancy section must not record 「no pregnancies」.
   */
  readonly collected: boolean;
  readonly items: readonly TreatNmdItem[];
  readonly noteZh: string | null;
}

export interface TreatNmdDocument {
  readonly datasetZh: string;
  readonly datasetSourceZh: string;
  readonly subjectRef: string;
  readonly sections: readonly TreatNmdSection[];
  readonly localOnly: TreatNmdSection | null;
  readonly codingProvenance: CodingProvenance;
}

/**
 * WHERE THE EcoRI FRAGMENT SITS, which is: nowhere in the archive.
 *
 * Every other sentence in the 诊断 section opens by naming the store the
 * value came out of and goes on to say whether this platform's reading
 * of the evidence document agrees with it. That whole shape is wrong
 * for this item — there is no baseline slot for it, no box on any
 * patient form, and nothing for the read-time autofill to write — so it
 * says so first, before a reader carries the assumption over from the
 * four items above it.
 */
const ECORI_FRAGMENT_LOCATION_ZH =
  '这一项不在本平台的档案里：患者的表单不为它提供输入框，本平台读取档案时的自动补填也没有可写的栏位，所以它没有档案值可比对。这个值直接读自本平台读作这份档案基因证据的那一份文件，与患者护照、分享页和转诊资料上印的是同一次读取。';

/**
 * 出生时间, as this ARCHIVE holds it — not as the platform's schema
 * could hold it.
 *
 * 「出生年份（本平台按年份存，并区分「记不清了」与「未采集」）」 was one
 * string for every profile and it is false for any archive whose
 * `patient_profiles.date_of_birth` column is filled: that column is a
 * DATE, and the FHIR bundle built from the same `NormalisedSource` in
 * the same request prints the full date on `Patient.birthDate`. A
 * registry told this platform keeps only a year stops asking for a
 * date the platform has.
 *
 * 出生年份 stays in every arm's wording on purpose — it is the field
 * name a receiver (and omissions-coverage.test.ts) looks this entry up
 * by, and the year slot exists on the archive whatever it holds.
 */
const BIRTH_FIELD_ZH: Record<HeldDatePrecision, string> = {
  day: '出生年份与出生日期（这份档案上记录到日；本平台的出生年份栏位另外区分「记不清了」与「未采集」）',
  year: '出生年份（这份档案上有年份，本平台这一栏区分「记不清了」与「未采集」）',
  not_remembered:
    '出生年份（这份档案上没有出生日期，出生年份记的是「记不清了」——问过，患者记不清）',
  not_collected: '出生年份（这份档案上没有出生日期，出生年份是「未采集」——本平台没有问到过）',
};

/**
 * What `Patient.birthDate` in the FHIR export ACTUALLY shows for this
 * archive, verified by building both documents from one source:
 * 1988-04-02 for `day`, 1988 for `year`, and no element at all for the
 * two no-value arms. The old sentence sent every receiver to that
 * field with 「支持只写年份」 attached, including the receivers whose
 * bundle has no such element.
 */
const BIRTH_IN_FHIR_ZH: Record<HeldDatePrecision, string> = {
  day: '这份档案上的出生时间精确到日，那份导出的 Patient.birthDate 上写的就是完整日期；',
  year: '这份档案上只有出生年份，那份导出的 Patient.birthDate 上写的就是这个年份；',
  not_remembered:
    '这份档案上没有可写的出生时间，那份导出的 Patient.birthDate 也因此不出现——不要把它的缺席读成本平台没有问过；',
  not_collected:
    '这份档案上没有可写的出生时间，那份导出的 Patient.birthDate 也因此不出现——不要把它的缺席读成问过而患者答不上来；',
};

const NOT_COLLECTED_SECTION = (key: string, titleZh: string, noteZh: string): TreatNmdSection => ({
  key,
  titleZh,
  collected: false,
  items: [],
  noteZh,
});

/**
 * An item, or nothing at all when there is no value to report.
 *
 * `null` IS THE DROP AND NOT A VALUE. An item present with a null value
 * tells a registry this platform asked and got nothing; an absent item
 * tells it nothing was asked. `collected` on the section is where that
 * distinction is made for a whole section, and it is made per item by
 * emitting or not emitting one.
 *
 * One helper and not one per value type: the rule is the same for every
 * item in this file, and the second copy of it is where a third copy
 * comes from.
 */
const item = <T extends TreatNmdValue>(
  key: string,
  labelZh: string,
  value: T | null,
  provenanceZh: string,
): TreatNmdItem | null => (value === null ? null : { key, labelZh, value, provenanceZh });

const compact = (items: ReadonlyArray<TreatNmdItem | null>): TreatNmdItem[] =>
  items.filter((entry): entry is TreatNmdItem => entry !== null);

const milestoneItem = (milestone: MilestoneEvent): TreatNmdItem => ({
  key: `milestone.${milestone.kind}`,
  labelZh: milestone.labelZh,
  value: milestone.occurrence,
  // `value` IS the occurrence object for a milestone — there is no
  // `occurrence` key to descend into, unlike a followupEvents item
  // whose value carries eventType and severity beside it. The path in
  // this sentence used to be `occurrence.precision`, which resolves
  // against nothing on this item, and an unlocatable precision caveat
  // is a stored instant read as a day.
  provenanceZh: '患者在随访时间线上记录的事件；日期精度见本条目值里的 precision 与 noteZh',
});

export const buildTreatNmdExport = (
  source: NormalisedSource,
): PortableExportEnvelope<TreatNmdDocument> => {
  const { profile, options } = source;
  const omissions: ExportOmission[] = [];

  // ---------------------------------------------------------- 诊断
  const diagnosis: TreatNmdSection = {
    key: 'diagnosis',
    titleZh: '诊断',
    collected: true,
    items: compact([
      {
        key: 'diagnosis.type',
        labelZh: 'FSHD 分型',
        value: source.diagnosisType,
        // 「患者档案记录为「FSHD1」」 said where the value sits and
        // stopped, in a section where its three genetic siblings each
        // state whether this platform's own reading of the evidence
        // report supports the archived value. Same question, same
        // machinery: see GENETIC_BASELINE_VALUE_ORIGINS. The
        // 未采集到 branch keeps its own sentence — there is no archived
        // value to attribute, only a classification of its absence.
        provenanceZh:
          source.diagnosisTypeRawZh === null
            ? withOriginNote(
                source,
                'diseaseBackground.diagnosisType',
                '未采集到分型；unspecified 表示「未确定是哪一型」，不是默认为 1 型',
              )
            : geneticValueProvenanceZh(source, 'diagnosisType'),
      },
      // THE KEY IS WHAT A RECEIVER MAPS ON, so a subtype the evidence
      // document states needs a key of its own.
      //
      // `diagnosis.type` above is the ARCHIVE's, and its provenance
      // sentence does say when the evidence document reads otherwise —
      // in prose, which a registry ingesting `diagnosis.type` never
      // parses. Over a profile whose questionnaire says FSHD1 and whose
      // genetics report reads FSHD2 (ordinary: the read-time autofill
      // only fills an EMPTY slot, so an answer given before the report
      // was uploaded stays forever), a registry indexing this document
      // filed FSHD1 while the patient's own passport, share page,
      // referral pack and anaesthesia card said FSHD2 — and so did the
      // FHIR `Condition` and the Phenopacket `Disease.term`, which now
      // follow the report. This item is where this document says the
      // same thing in a field rather than in a paragraph.
      //
      // EMITTED ONLY WHEN THE DOCUMENT STATES ONE. `item` drops a null,
      // and a null here would say 「we asked the report and it answered
      // nothing」 — which is exactly right and exactly what the absence
      // means, with `diagnosis.type`'s own provenance sentence saying
      // so in words.
      item(
        'diagnosis.typeFromGeneticEvidence',
        'FSHD 分型（读自基因证据文件）',
        source.geneticEvidenceReading.values.diagnosisType === null
          ? null
          : source.passportDiagnosisType,
        `${diagnosisTypeSourceZh(source)}${geneticEvidenceDocumentZh(source)}`,
      ),
      {
        key: 'diagnosis.year',
        labelZh: '确诊年份',
        value: serialiseYear(source.diagnosisYear),
        // 「基线问卷的」 came off this sentence for the reason the
        // genetic three lost it: `applyGeneticReportAutofill` fills an
        // empty `foundation.diagnosisYear` from an uploaded report's
        // date, at read time, before this exporter sees the profile —
        // so the questionnaire is one possible author here, not the
        // author. What replaces it says the same thing the genetic
        // siblings say, from the same reading of the same document; the
        // year-against-a-date comparison is why it is its own sentence
        // rather than a fifth entry in their table.
        provenanceZh: diagnosisYearProvenanceZh(source),
      },
      {
        key: 'diagnosis.geneticallyConfirmed',
        labelZh: '是否基因确诊',
        value: source.geneticallyConfirmed,
        // THE KEY IS WHAT A RECEIVER MAPS ON, so the key is what the
        // value has to answer. This item was narrowed to 是否有基因报告
        // in its label and its provenance while `geneticallyConfirmed`
        // stayed in the key and 「is any document on file the
        // laboratory's report」 stayed in the value — a registry
        // ingesting the key never sees the label, so it received a
        // confirmation claim for a profile whose passport, referral
        // pack and anesthesia card all read 未经基因确诊, and whose three
        // genetic values two lines below name 转录自非基因报告文件 as
        // their source. Answered off the passport's own
        // `geneticallyConfirmed` now, which is the same answer the FHIR
        // Condition's verificationStatus carries.
        provenanceZh: `${geneticConfirmationReasonZh(source)}。${geneticEvidenceDocumentZh(source)}`,
      },
      // The three genetic results do not share one provenance sentence,
      // and geneticValueProvenanceZh is where the reason is written
      // down: 甲基化 and 单倍型 have no box on any patient form and no
      // back-office write either, so 基线问卷 named an author who cannot
      // exist for them.
      //
      // THE FIRST TWO ARE NOT BARE STRINGS, and the key is why: a
      // registry ingesting `diagnosis.haplotype` files what it finds
      // there as this patient's genotype. What it used to find was the
      // archived line and nothing else — including 「4qA/4qB」, which
      // names the laboratory's probes, and 「未检出」. `geneticResultValue`
      // keeps the line and adds this platform's own reading of it, which
      // is the passport's; 甲基化 has no such reading and stays a string.
      item(
        'diagnosis.d4z4',
        'D4Z4 重复单元数',
        geneticResultValue(source, 'd4z4'),
        geneticValueProvenanceZh(source, 'd4z4'),
      ),
      // …AND THE SAME CELL AS THE EVIDENCE DOCUMENT STATES IT, on the
      // terms `diagnosis.typeFromGeneticEvidence` above already
      // established for 分型.
      //
      // THE KEY IS WHAT A RECEIVER MAPS ON. `diagnosis.d4z4` is the
      // ARCHIVE's line, and where the two disagree it says so — but it
      // says so in an enum and a Chinese paragraph, and a registry
      // indexing 「this patient's D4Z4 repeat count」 reads the value.
      // Over the ordinary先填问卷、后传报告 profile it therefore filed
      // the questionnaire's count while the passport, the markdown
      // export, the share page, the referral pack and the FHIR
      // Observation all carried the laboratory's.
      //
      // AND THE GREY ZONE ONLY EXISTS HERE. The archive item's
      // `qualifier` is null whenever its `reading` is not `result`,
      // correctly — the 8–10 verdict belongs to the number the passport
      // graded — so in the disagreement case the one machine-readable
      // flag a trial site can filter on reached the FHIR bundle and not
      // this document. `geneticEvidenceResultValue` carries it on the
      // value it is about.
      item(
        'diagnosis.d4z4FromGeneticEvidence',
        'D4Z4 重复单元数（读自基因证据文件）',
        geneticEvidenceResultValue(source, 'd4z4'),
        `${geneticCellSourceZh(source, 'd4z4', 'diagnosis.d4z4')}${geneticEvidenceDocumentZh(source)}`,
      ),
      item(
        'diagnosis.haplotype',
        '4q 单倍型',
        geneticResultValue(source, 'haplotype'),
        geneticValueProvenanceZh(source, 'haplotype'),
      ),
      // THE 单倍型 IS THE WORST OF THE THREE TO GET FROM THE ARCHIVE,
      // because nothing else in the product contradicts it.
      // `readBaselineDiseaseBackground` in profile.passport.ts does not
      // read `diseaseBackground.haplotype` at all — 「nothing on the
      // passport family renders a 单倍型 value」 — so the archived
      // string reaches exactly one reader, this document, and reaches
      // it as a genotype. A stale 4qB sitting beside a report that read
      // 4qA is not a near miss: 4qB is the allele that argues against
      // the diagnosis this same document asserts, and no surface a
      // patient or clinician holds would have shown them the
      // disagreement.
      item(
        'diagnosis.haplotypeFromGeneticEvidence',
        '4q 单倍型（读自基因证据文件）',
        geneticEvidenceResultValue(source, 'haplotype'),
        `${geneticCellSourceZh(source, 'haplotype', 'diagnosis.haplotype')}${geneticEvidenceDocumentZh(source)}`,
      ),
      // 甲基化 IS NOT A BARE STRING ANY MORE EITHER, and for the reason
      // the two above are not: this is the FSHD2 discriminator, and a
      // registry ingesting `diagnosis.methylation` files what it finds
      // there as a graded result. It has no `SerialisedGeneticResult`
      // because it has no READING — nothing here refuses it and nothing
      // here reads it, which is exactly what `GENETIC_RESULT_ITEMS`
      // records by having no entry for it — so what it gains is the
      // refusal itself, in the provenance sentence, which is the slot
      // this item has. Same sentence the FHIR Observation's `note`
      // carries, so the two documents cannot describe one number
      // differently in one run.
      item(
        'diagnosis.methylation',
        '甲基化',
        source.geneticEvidence.methylation,
        `${geneticValueProvenanceZh(source, 'methylation')}${METHYLATION_NOT_JUDGED_ZH}`,
      ),
      // 甲基化 GETS THE SIBLING TOO, for the reason the two above do:
      // the passport resolves this cell document-first
      // (`methylationFromDocument || methylationFromBaseline`) and
      // prints the document's string on all four human-facing surfaces,
      // while this document carried the archive's. It is the FSHD2
      // discriminator, so 「which of the two numbers is this patient's」
      // is a question a registry acts on.
      //
      // A BARE STRING, like its archive sibling and for the same
      // reason: `GENETIC_RESULT_ITEMS` has no 甲基化 entry because
      // nothing here reads the cell and nothing here refuses it, so
      // there is no `readsAsResult` to report. What it gains is the
      // same refusal sentence, which is the whole of what this platform
      // has to say about the number.
      //
      // READ OFF `geneticEvidenceRecord.methylationValue`, which is the
      // passport's own record of the one document
      // `pickGeneticEvidenceDocument` named — the same field the
      // passport, the markdown export, the share page and the referral
      // pack print — and not a second parse.
      item(
        'diagnosis.methylationFromGeneticEvidence',
        '甲基化（读自基因证据文件）',
        source.geneticEvidenceRecord.methylationValue,
        `${geneticCellSourceZh(source, 'methylation', 'diagnosis.methylation')}${geneticEvidenceDocumentZh(source)}${METHYLATION_NOT_JUDGED_ZH}`,
      ),
      // THE ONE GENETIC READING WITH NO ARCHIVE LINE.
      //
      // 分型, D4Z4 重复数, 单倍型 and 甲基化 all have a baseline slot the
      // read-time autofill tops up, so all four reach this section by
      // way of the archive. The EcoRI fragment has none — no form on
      // this platform draws a box for it and the autofill has no field
      // to write — so it could not reach this section at all, and it
      // was in neither of the other two portable exports either. For a
      // report that states its length in kb and gives no repeat count,
      // that fragment is the ONLY size measurement the laboratory made:
      // it appears on the passport, the markdown export, the share page
      // and the referral pack, each with a sentence saying it is
      // displayed and not judged, and a registry receiving this
      // document saw a 4qA haplotype with no D4Z4 size measurement of
      // any kind.
      //
      // SO IT IS READ OFF THE EVIDENCE DOCUMENT AND SAID TO BE. The
      // reading is `geneticEvidenceRecord.ecoRIFragment`, which is the
      // passport's own record of the one document
      // `pickGeneticEvidenceDocument` named — not a second parse — and
      // its provenance sentence opens by saying the value is not in the
      // archive at all, because every other sentence in this section
      // describes an archived string and a reader would otherwise
      // assume this one does too.
      item(
        'diagnosis.ecoRIFragment',
        'EcoRI 片段',
        source.geneticEvidenceRecord.ecoRIFragment,
        `${ECORI_FRAGMENT_LOCATION_ZH}${geneticEvidenceDocumentZh(source)}${ECORI_FRAGMENT_NOT_JUDGED_ZH}`,
      ),
      // 起病部位, which no portable export carried and none declared.
      // `normaliseSource` is the only thing the three serialisers read,
      // and it did not lift this field at all — so it was unreachable
      // rather than declined. It belongs beside the diagnosis rather
      // than among the symptom self-ratings: it is a one-off answer
      // about how the illness began, not something re-recorded at each
      // follow-up, and in FSHD the region of onset is part of what the
      // diagnosis is built on.
      //
      // NOT CLASSIFIED. The baseline stores whatever the patient typed
      // and this document reproduces it; a mapping onto 面部 / 肩胛带 /
      // 下肢 would be this export deciding what 「胳膊抬不起来」 means.
      item(
        'diagnosis.onsetRegion',
        '起病部位（患者自述）',
        source.onsetRegion,
        withOriginNote(
          source,
          'diseaseBackground.onsetRegion',
          '患者在基线问卷上自述的起病部位，原文照录，本平台不作归类',
          '基线问卷上记录的起病部位，原文照录，本平台不作归类',
        ),
      ),
    ]),
    noteZh: null,
  };

  /**
   * WHAT THE PASSPORT'S 诊断 BLOCK HOLDS AND THIS SECTION DOES NOT.
   *
   * The four readings above are now the whole of what the evidence
   * document STATES about this patient — that was the gap 甲基化 and the
   * EcoRI fragment fell through. What is still on the passport and not
   * here is of a different kind: this platform's own JUDGEMENT of that
   * document, the patient's own answer about their diagnostic journey,
   * and two values derived from things this section already carries.
   * None of them is dropped silently any more, because an omissions
   * list that declares some gaps and not others reads as a complete
   * one.
   *
   * WHY THE GRADE IS DECLARED RATHER THAN CARRIED. 未检测 / 方法不适用 /
   * 结果不全 / 转录件 / 单倍型非允许型 / 可用于入组 is a verdict this
   * platform reaches from one photographed report, written for a patient
   * and their own clinician to act on with the original in front of
   * them. `diagnosis.geneticallyConfirmed` and its provenance sentence
   * are the part of it a registry may map — a boolean plus the reason,
   * shared verbatim with the other two exports — and the rest is copy,
   * not data. Emitting a six-state enum a receiver would filter cohorts
   * on would be this document handing over a judgement it makes for a
   * different reader.
   */
  omissions.push({
    field: 'sections.diagnosis（临床护照的诊断判定与检查申请说明）',
    reasonZh:
      '本节承载的是这份档案上的基因读数本身，不承载本平台对它们的判定。临床护照另有一组内容不随本导出发送：一是基因证据的分级（未检测 / 方法不适用 / 结果不全 / 转录件 / 单倍型非允许型 / 可用于入组）及其面向患者的说明文字；二是随分级生成的《检查申请说明》与它引用的指南出处；三是报告上写的检测方法。判定的可映射部分已经在 diagnosis.geneticallyConfirmed 上，连同它的 provenanceZh —— 那句话与 FHIR 导出的 Condition.verificationStatus.text 和 Phenopacket 导出的对应 omission 是同一句。此外，患者在基线问卷上自己勾选的「诊断进度」（临床诊断 / 已做基因检测等）也不在本导出中：它与 diagnosis.geneticallyConfirmed 回答的不是同一个问题（「你告诉我们什么」与「证据显示什么」），本平台在护照上两者并列不作调和，而本导出没有能同时承载两者又不被误读为一个的位置。',
  });
  omissions.push({
    field: 'diagnosis（基因证据来自哪一份文件、有多旧）',
    reasonZh:
      '本导出不含上传文件清单，因此本节的基因读数没有可指向的文件条目：本节各项的 provenanceZh 说明了它们读自本平台认定为这份档案基因证据的那一份文件，但没有给出那份文件的标识或日期，本导出也不给出临床护照上按该日期算出的「新鲜度」。需要知道这些读数出自哪一份、什么时候上传的，请改用 FHIR 导出（DocumentReference.date 与 Observation.derivedFrom）或 Phenopacket 导出（files[].fileAttributes.uploadedAt）。另外，临床护照上的「证据摘要」是把分型、单倍型、EcoRI 片段与 D4Z4 重复数拼成的一行展示文本，本导出不拼它——各项分别在上面，拼接会把来源不同的几项塞进一个无法归因的字符串。',
  });

  // ------------------------------------------------------- 家族史
  //
  // Present as a section either way, so the receiver can tell 「按规则
  // 未随本次导出发送」 apart from 「患者没有家族史」.
  const familyHistory: TreatNmdSection = options.includeLocalOnly
    ? {
        key: 'familyHistory',
        titleZh: '家族史',
        collected: source.familyHistoryStatement !== null,
        items: compact([
          item(
            'familyHistory.statement',
            '患者对自身家族史的陈述',
            source.familyHistoryStatement,
            withOriginNote(
              source,
              'diseaseBackground.familyHistory',
              '患者自述。这是患者关于其亲属的陈述，不是亲属本人的病历，也未经亲属本人确认',
              // 患者自述 is dropped rather than qualified when the field
              // is marked: the rest of the sentence is still true of an
              // administrator's transcription, that half is not.
              '这是关于患者亲属的陈述，不是亲属本人的病历，也未经亲属本人确认',
            ),
          ),
        ]),
        noteZh:
          '家族史涉及患者以外的第二数据主体（亲属）。本节仅在本地留存场景下输出，默认不随分享链接外发。',
      }
    : NOT_COLLECTED_SECTION(
        'familyHistory',
        '家族史',
        '本节按默认规则未随本次导出发送：家族史是关于患者亲属的陈述，亲属是第二数据主体，未就此导出作出同意。collected=false 表示「未发送」，不表示「无家族史」。',
      );
  if (!options.includeLocalOnly) {
    omissions.push({
      field: 'sections.familyHistory',
      reasonZh: '家族史涉及第二数据主体（亲属），默认不外发。',
    });
  }

  // --------------------------------------------------------- 症状
  const latestSymptomByKey = new Map<string, (typeof profile.symptomScores)[number]>();
  profile.symptomScores.forEach((score) => {
    const previous = latestSymptomByKey.get(score.symptomKey);
    if (!previous || Date.parse(score.recordedAt) > Date.parse(previous.recordedAt)) {
      latestSymptomByKey.set(score.symptomKey, score);
    }
  });

  // THE ADL RATINGS BELONG HERE, AND WERE IN NO PORTABLE EXPORT BUT ONE.
  //
  // `dailyImpacts` is the 日常活动困难程度 series — 洗头, 穿衣, 上下楼梯 —
  // and it reached the FHIR bundle as Observations and reached this
  // document nowhere. Not declared either: this file's omissions list
  // named the pregnancy section, the instruments and the family history
  // and said nothing about a whole series of self-ratings, which is the
  // reading a receiver cannot recover from. It sits in 症状 beside
  // `challenge.*` because it is the same kind of answer from the same
  // person on the same scale idea — the difference is that a challenge
  // is filled once at registration and this is recorded again at each
  // follow-up, which is what the two provenance sentences say.
  const latestDailyImpactByKey = new Map<string, (typeof profile.dailyImpacts)[number]>();
  profile.dailyImpacts.forEach((impact) => {
    const previous = latestDailyImpactByKey.get(impact.adlKey);
    if (!previous || Date.parse(impact.recordedAt) > Date.parse(previous.recordedAt)) {
      latestDailyImpactByKey.set(impact.adlKey, impact);
    }
  });

  const symptoms: TreatNmdSection = {
    key: 'symptoms',
    titleZh: '症状',
    collected:
      latestSymptomByKey.size > 0 ||
      source.challenges.length > 0 ||
      latestDailyImpactByKey.size > 0,
    items: [
      ...[...latestSymptomByKey.values()].map((score) => ({
        key: `symptom.${score.symptomKey}`,
        labelZh: labelFor(SYMPTOM_LABELS, score.symptomKey),
        value: {
          score: score.score,
          scaleMin: score.scaleMin,
          scaleMax: score.scaleMax,
          recordedAt: score.recordedAt,
        },
        provenanceZh: `患者自评，量表范围 ${score.scaleMin}–${score.scaleMax}`,
      })),
      ...source.challenges.map((challenge) => ({
        key: `challenge.${challenge.key}`,
        labelZh: challenge.labelZh,
        value: challenge.score,
        provenanceZh: '基线问卷的困难程度自评，建档时填写一次',
      })),
      ...[...latestDailyImpactByKey.values()].map((impact) => ({
        key: `dailyImpact.${impact.adlKey}`,
        labelZh: `${labelFor(DAILY_IMPACT_LABELS, impact.adlKey)}困难程度`,
        value: {
          difficultyLevel: impact.difficultyLevel,
          needsAssistance: impact.needsAssistance,
          recordedAt: impact.recordedAt,
        },
        // `needsAssistance` is nullable in the column and the null is
        // not a 「no」: it is the answer not given on that occasion. Said
        // here because this item has no other slot to say it in, and a
        // registry that reads null as false records a patient as
        // independent at an activity they were never asked about.
        provenanceZh:
          '患者在随访中自评的日常活动困难程度；needsAssistance 为 null 表示这一次没有回答是否需要他人协助，不表示不需要',
      })),
    ],
    noteZh:
      '每个症状与每项日常活动只取最近一次记录；完整时间序列在 PIPL 数据导出的 submissions 中，本格式不重复承载。challenge.* 是建档时的一次性自评，dailyImpact.* 是随访中反复记录的，两者不要合并统计。',
  };

  // ----------------------------------------------------- 运动功能
  const motorFunction: TreatNmdSection = {
    key: 'motorFunction',
    titleZh: '运动功能',
    collected:
      source.currentStatus.ambulation !== null ||
      profile.functionTests.length > 0 ||
      profile.measurements.length > 0,
    items: compact([
      source.currentStatus.ambulation === null
        ? null
        : {
            key: 'motor.ambulation',
            labelZh: '当前行走能力',
            value: source.currentStatus.ambulation,
            // 「基线问卷记录的」 is gone from the fallback here and in
            // 轮椅使用 below. `InstrumentsService` writes this exact
            // field with a nested jsonb_set when a patient ticks
            // 「把结果同步到我的档案」 on a Vignos administration, so the
            // questionnaire is not the only author — and this document
            // says so itself, in the omission a few lines down.
            provenanceZh:
              AMBULATION_LABELS[source.currentStatus.ambulation] ?? '档案中记录的行走状态',
          },
      item(
        'motor.armRaiseDifficulty',
        '上举手臂困难',
        source.currentStatus.armRaiseDifficulty,
        '患者自述',
      ),
      item('motor.facialWeakness', '面部肌无力', source.currentStatus.facialWeakness, '患者自述'),
      item('motor.footDrop', '足下垂', source.currentStatus.footDrop, '患者自述'),
      item(
        'motor.breathingSymptoms',
        '呼吸相关症状',
        source.currentStatus.breathingSymptoms,
        '患者自述',
      ),
      source.currentStatus.assistiveDevices.length === 0
        ? null
        : {
            key: 'motor.assistiveDevices',
            labelZh: '正在使用的辅助器具',
            value: source.currentStatus.assistiveDevices,
            provenanceZh: '患者自述',
          },
      profile.functionTests.length === 0
        ? null
        : {
            key: 'motor.functionTests',
            labelZh: '功能测试（每类最近一次）',
            value: latestFunctionTests(profile.functionTests),
            provenanceZh:
              '患者自行完成并记录，非临床环境下的标准化测试；notApplicable 表示「尝试后当天做不了」，与「未测」不同',
          },
      // MRC STRENGTH, WHICH THIS SECTION COUNTED AND DID NOT CARRY.
      //
      // `collected` above has always included `profile.measurements`,
      // so this section reported itself collected on the strength of a
      // series it emitted no item for — and the omissions list said
      // nothing about it either. The other two exports both carry these
      // (FHIR as `exam` Observations, and the Phenopacket declares
      // them by count), so this document, the one whose 运动功能 area a
      // registry actually maps, was the only one where a set of muscle
      // grades vanished without trace.
      //
      // Latest per muscle group AND side, not per group: a left
      // deltoid and a right deltoid are two different measurements in
      // this disease, which is asymmetric far more often than not, and
      // collapsing them would publish one side's grade for both.
      //
      // `entryMode` rides each row rather than being summarised in the
      // sentence, because the rows differ: one clinician-entered grade
      // among self-tests is exactly the row a registry weights
      // differently, and one provenance sentence for the item cannot
      // say which.
      profile.measurements.length === 0
        ? null
        : {
            key: 'motor.muscleStrength',
            labelZh: '徒手肌力（每个肌群 / 每侧最近一次）',
            value: latestMeasurements(profile.measurements),
            provenanceZh:
              'MRC 分级 0–5，5 为正常；每一条的 entryMode 说明这一条是谁做的：clinician_entered 为临床人员录入，其余为患者自评或在应用引导下自测，不是临床环境下的标准化徒手肌力测试',
          },
    ]),
    // 运动功能 is one of the six mandatory areas, and it is the section
    // a reader would use to decide whether this record has anything
    // comparable in it. Saying nothing here while Brooke and Vignos
    // sit un-exported is the whole defect; the full reason is in
    // `omissions`, and this line makes sure the reader gets to it.
    noteZh:
      '本节不含 Brooke 上肢分级与 Vignos 下肢分级——本平台采集这两项，但它们尚未接入本导出。详见 omissions 中的 sections.motorFunction.instruments。',
  };

  omissions.push(
    instrumentOmission(
      'sections.motorFunction.instruments',
      // This format is the only one of the three that carries a
      // walking state at all, so it is the only one whose reason may
      // point at a section — and it has to name every section that
      // holds one. Naming 运动功能 alone undercounted. The count is not
      // restated here because restating it is how it goes stale:
      // treat-nmd.test.ts derives the set from `document.sections` and
      // fails if this sentence names fewer, or names one that does not
      // hold the state.
      '若患者在填写 Vignos 时选择了同步到基线，由分级推出的行走状态会出现在 sections.motorFunction 的 motor.ambulation 与 sections.wheelchairUse 的 wheelchair.currentState，分级本身仍然不在。',
    ),
  );

  // ----------------------------------------------------- 轮椅使用
  const wheelchairMilestones = source.milestones.filter(
    (milestone) => milestone.kind === 'wheelchair',
  );
  const wheelchairUse: TreatNmdSection = {
    key: 'wheelchairUse',
    titleZh: '轮椅使用',
    collected: source.currentStatus.ambulation !== null || wheelchairMilestones.length > 0,
    items: compact([
      source.currentStatus.ambulation === null
        ? null
        : {
            key: 'wheelchair.currentState',
            labelZh: '当前状态',
            value: source.currentStatus.ambulation,
            provenanceZh:
              source.currentStatus.ambulation === 'assisted'
                ? '注意：2022 年迁移 022 之前，「需要辅助」是无法行走者唯一可选的答案，历史值不能当作「借助器具仍可行走」的证据'
                : (AMBULATION_LABELS[source.currentStatus.ambulation] ?? '档案中记录的行走状态'),
          },
      ...wheelchairMilestones.map(milestoneItem),
    ]),
    noteZh:
      wheelchairMilestones.length > 0
        ? '开始使用轮椅的日期来自随访事件，来源字段无法表示「只知道年份」，请以 occurrence 中的说明为准。'
        : null,
  };

  // ----------------------------------------------------- 其他里程碑
  const otherMilestones = source.milestones.filter((milestone) => milestone.kind !== 'wheelchair');
  const milestones: TreatNmdSection = {
    key: 'milestones',
    titleZh: '其他里程碑事件（NIV / AFO）',
    collected: otherMilestones.length > 0,
    items: otherMilestones.map(milestoneItem),
    noteZh: '本节不属于该核心数据集列出的强制性内容，作为附加信息提供；日期精度限制同轮椅事件。',
  };

  // --------------------------------------------------- 其他随访事件
  //
  // Falls, a first foot drop, a first breathing symptom. Not part of
  // the six mandatory areas, and said to be so — but leaving them out
  // would make the exported course of the disease look like a
  // straight line from diagnosis to wheelchair, which is not what
  // happened to this person.
  const followupEvents: TreatNmdSection = {
    key: 'followupEvents',
    titleZh: '其他随访事件',
    collected: source.followupEvents.length > 0,
    items: source.followupEvents.map((event) => ({
      key: `event.${event.eventId}`,
      labelZh: labelFor(FOLLOWUP_EVENT_LABELS, event.eventType),
      value: {
        eventType: event.eventType,
        occurrence: event.occurrence,
        severity: event.severity,
        severityZh:
          event.severity === null ? null : labelFor(FOLLOWUP_EVENT_SEVERITY_LABELS, event.severity),
        descriptionZh: event.descriptionZh,
      },
      provenanceZh: '患者自行记录的随访事件；日期精度限制同里程碑事件',
    })),
    // 跌倒 is the event type this section most often carries, and this
    // section is where a reader would go looking for what the patient
    // recorded ABOUT a fall. Saying nothing here while the diary's five
    // answers sit un-exported is what let a dated 跌倒 item read as the
    // whole record; the full reason is in `omissions`, and this line
    // makes sure the reader gets to it. Same discipline as the 运动功能
    // section's Brooke / Vignos line.
    noteZh:
      '本节不属于该核心数据集列出的强制性内容，作为附加信息提供。已撤回（软删除）的事件不会出现在这里。本节的跌倒条目只有日期与患者自评的严重程度，不含本平台跌倒日记里的当时活动、室内外、手里是否拿着东西、能否自行起身、是否受伤这五项。详见 omissions 中的 sections.followupEvents.fallsDiary。',
  };

  omissions.push(
    fallsDiaryOmission(
      'sections.followupEvents.fallsDiary',
      // This format DOES carry the fall, in a section of its own, with
      // the patient's severity self-rating and their free-text note on
      // it. Naming the section is what keeps the entry from reading as
      // 「no falls in this document」.
      '本文件确实承载跌倒本身：每一次跌倒在 sections.followupEvents 里有一条对应条目，带日期（精度说明随条目）、患者自评的严重程度与患者自己写的说明；缺的是上面那五项结构化明细。',
    ),
  );

  // ------------------------------------------------------- 妊娠史
  const pregnancyHistory = NOT_COLLECTED_SECTION(
    'pregnancyHistory',
    '妊娠史',
    '本平台目前不采集妊娠史。collected=false 表示「没有采集这个问题」，不表示「没有妊娠史」。',
  );
  omissions.push({
    field: 'sections.pregnancyHistory',
    reasonZh: '该核心数据集的强制性内容之一，但本平台目前没有采集妊娠史的表单。',
  });

  // --------------------------------------------------- 民族（可选项）
  const ethnicity = NOT_COLLECTED_SECTION(
    'ethnicity',
    '民族 / 族群（可选项）',
    '本平台不采集民族信息。',
  );

  const localOnly: TreatNmdSection | null = options.includeLocalOnly
    ? {
        key: 'localOnly',
        titleZh: '仅本地留存（直接身份信息）',
        collected: true,
        items: compact([
          // These two say where the value is kept, not who put it
          // there. `fieldProvenance` marks administrator writes and
          // nothing else, so an unmarked field is not thereby the
          // patient's own — arguing otherwise means arguing from a list
          // of writers, and this file is downstream of every one of
          // them. Where a marker IS present the note is appended, which
          // is the one authorship statement the export can make.
          item(
            'local.fullName',
            '姓名',
            profile.fullName,
            withOriginNote(source, 'foundation.fullName', '本平台档案中记录的姓名'),
          ),
          item(
            'local.preferredName',
            '希望被称呼的名字',
            profile.preferredName,
            withOriginNote(source, 'foundation.preferredName', '本平台档案中记录的称呼'),
          ),
          item(
            'local.diagnosingPhysician',
            '确诊医生 / 主诊医生',
            profile.primaryPhysician,
            '患者填写。这是第三人的姓名，仅本地留存',
          ),
        ]),
        noteZh:
          '直接身份信息按该数据集的规则留在采集方本地，不随注册研究用途外发。本节只在明确请求本地留存版本时出现。',
      }
    : null;
  if (!options.includeLocalOnly) {
    omissions.push({
      field: 'localOnly',
      reasonZh: '姓名、称呼与确诊医生姓名属于直接身份信息，按数据集规则留在采集方本地。',
    });
  }

  // --------------------------------- the rest of what the档案 holds
  //
  // Two entries for everything this document holds back that is not
  // covered above. They are unconditional and they name each field,
  // because the point of them is that a receiver reading this list can
  // tell 「not sent」 from 「not held」 — and until now the list accounted
  // for the pregnancy section, the instruments, the family history and
  // the identifiers, and went silent on a medication list, a diary and
  // a whole demographic block. An omissions list that declares four
  // gaps and not the other six reads as the complete set.
  // 「本平台按年份存」 WAS NOT TRUE OF EVERY ARCHIVE, and this document
  // is where a registry reads it. `patient_profiles.date_of_birth` is a
  // DATE column filled to the day on ordinary profiles, and the FHIR
  // bundle built from this same `NormalisedSource` in this same request
  // prints that full date on `Patient.birthDate` — so a receiver told
  // the platform keeps only a year stops asking for a date the platform
  // has. The parenthesis therefore states THIS archive's precision, and
  // the FHIR pointer beside it says what that export will actually show.
  const birthPrecision = heldDatePrecision(profile.dateOfBirth, source.birthYear);
  omissions.push({
    field: 'subject（出生年份、性别、常住地区、体格测量与联系方式）',
    reasonZh: `本文件按该核心数据集的六个强制性内容领域加一个可选的民族项组织，下列内容不在这些领域里，本导出因此不承载：${BIRTH_FIELD_ZH[birthPrecision]}、性别、常住地区、身高、体重、血型、联系电话与邮箱，以及本平台内部的患者编号。出生时间与性别在 FHIR 导出里各有对应字段（Patient.birthDate 与 Patient.gender），本文件两个都没有；${BIRTH_IN_FHIR_ZH[birthPrecision]}联系方式、常住地区与患者编号属于直接身份信息或近似标识，三份可携带导出都不写；身高、体重与血型三份都不写，需要请改用不带 format 参数的数据导出，或直接向患者索取。subjectRef 是本平台内部的档案标识，不是患者编号。`,
  });
  omissions.push({
    field: 'sections（用药记录、日常记录、档案备注与基线备注）',
    reasonZh: `本文件不承载三类内容：${profile.medications.length} 条用药记录（药名、剂量、频次、给药途径、起止日期与状态）、${profile.activityLogs.length} 条患者自己写的日常记录（含心情评分），以及两处自由文本备注——「档案备注」（档案上的备注栏）与「基线备注」（基线问卷自己的备注栏，后台也能编辑）。这是两个不同的存储，本文件哪一个都不承载。该核心数据集列出的强制性领域里没有这三类，本导出也没有为它们建立对齐位置；自由文本尤其不适合塞进带 provenanceZh 的条目里当作一次记录来读。三份可携带导出都不承载它们——本文件里没有用药记录，不表示患者没有在用药。完整内容请改用不带 format 参数的数据导出。`,
  });

  return {
    format: 'TREAT-NMD FSHD core dataset',
    conformanceZh:
      '按 TREAT-NMD FSHD 核心数据集的六个强制性内容领域（诊断、家族史、症状、运动功能、轮椅使用、妊娠史）与可选的民族项组织。这是一次「对齐」，不是一致性声明：本仓库内没有该数据集的规范原文，因此本导出不标注版本号、不编造章节数、也不给出逐项的数据集条目编号。接收方在导入前应对照规范原文核对字段映射。',
    generatedAt: options.generatedAt,
    document: {
      datasetZh: 'TREAT-NMD FSHD 核心数据集（2010 年 ENMC 工作会议议定，2016 年修订）',
      datasetSourceZh:
        '2025 FSHD 国际研究大会摘要集 P2.08（content/medical-kb/source/FSHD_知识库/2025-IRC-ABSTRACT-BOOK.pdf）：该数据集的强制性问题涵盖诊断、家族史、症状、运动功能、轮椅使用与妊娠史，并含一个可选的民族问题。',
      subjectRef: profile.id,
      sections: [
        diagnosis,
        familyHistory,
        symptoms,
        motorFunction,
        wheelchairUse,
        milestones,
        followupEvents,
        pregnancyHistory,
        ethnicity,
      ],
      localOnly,
      codingProvenance: buildCodingProvenance([]),
    },
    omissions,
    fieldOrigins: source.fieldOrigins,
    notes: {
      年份字段:
        '所有年份字段都有三种答案：已知 / 记不清了 / 未采集。「记不清了」是一个真实答案，表示问过而患者记不清，不要与「未采集」合并处理。',
      // THE PATH IN THIS NOTE IS THE ONE THE ITEMS ACTUALLY HAVE.
      // It read 「每条事件的 occurrence.noteZh」, and the milestone items
      // this sentence is ABOUT do not have an `occurrence` key at all:
      // `milestone.wheelchair`, `milestone.niv` and `milestone.afo`
      // serialise the occurrence object AS the item value, so the note
      // sits at `value.noteZh`. Only the followupEvents items nest it,
      // because their value carries eventType and severity beside it.
      // A receiver following the old path on a milestone found nothing
      // and had no reason to look further — a date-precision caveat
      // that cannot be located is a date read as a day.
      日期精度:
        '里程碑事件与随访事件的日期都来自一个只能存完整时间点的字段。每一条都带着自己的 noteZh：里程碑条目（不论它出现在哪一节）直接写在 value.noteZh 上，随访事件条目写在 value.occurrence.noteZh 上。请读它，不要把这些时间当作精确到天的观察。',
      // The 来源 half of this line is the shared sentence, not a wording
      // of its own: this format, the FHIR bundle and the Phenopacket
      // describe the same empty `fieldOrigins`, and a receiver holding
      // two of the three must not find one of them making the stronger
      // claim about who typed the values.
      数据性质:
        source.fieldOrigins.length === 0
          ? `本导出中的绝大多数内容为患者自述或自评，不是临床测量。每个条目的 provenanceZh 写明了来源。${NO_ADMIN_FIELD_ORIGIN_NOTE_ZH}`
          : `本导出中的绝大多数内容为患者自述或自评，不是临床测量。每个条目的 provenanceZh 写明了来源。注意：本次导出中有 ${source.fieldOrigins.length} 个基线字段不是患者本人填写的（由本平台管理员代为录入，或来源记录读不出来），逐条列在信封的 fieldOrigins 中，相关条目的 provenanceZh 也各自标注了。不要把这些值当作患者自述来统计。`,
    },
  };
};

/**
 * Latest MRC grade per muscle group AND side.
 *
 * Keyed on both, for the reason stated at the call site: FSHD is
 * asymmetric, and a map keyed on the group alone publishes whichever
 * side happened to be measured last as the grade for the muscle.
 * `side` is nullable in the column, so the key falls back to a literal
 * that cannot collide with a side value.
 */
const latestMeasurements = (measurements: NormalisedSource['profile']['measurements']) => {
  const latest = new Map<string, (typeof measurements)[number]>();
  measurements.forEach((measurement) => {
    const key = `${measurement.muscleGroup}::${measurement.side ?? 'unspecified'}`;
    const previous = latest.get(key);
    if (!previous || Date.parse(measurement.recordedAt) > Date.parse(previous.recordedAt)) {
      latest.set(key, measurement);
    }
  });
  return [...latest.values()].map((measurement) => ({
    muscleGroup: measurement.muscleGroup,
    muscleGroupLabelZh: labelFor(MUSCLE_GROUP_LABELS, measurement.muscleGroup),
    side: measurement.side,
    sideLabelZh: measurement.side === null ? null : labelFor(SIDE_LABELS, measurement.side),
    strengthScore: measurement.strengthScore,
    entryMode: measurement.entryMode,
    recordedAt: measurement.recordedAt,
  }));
};

const latestFunctionTests = (tests: NormalisedSource['profile']['functionTests']) => {
  const latest = new Map<string, (typeof tests)[number]>();
  tests.forEach((test) => {
    const previous = latest.get(test.testType);
    if (!previous || Date.parse(test.performedAt) > Date.parse(previous.performedAt)) {
      latest.set(test.testType, test);
    }
  });
  return [...latest.values()].map((test) => ({
    testType: test.testType,
    testLabelZh: labelFor(FUNCTION_TEST_LABELS, test.testType),
    measuredValue: test.measuredValue,
    unit: test.unit,
    notApplicable: test.notApplicable === true,
    assistanceRequired: test.assistanceRequired,
    performedAt: test.performedAt,
  }));
};
