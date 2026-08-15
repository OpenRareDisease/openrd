import { buildCodingProvenance, type CodingProvenance } from './codings.js';
import type { ExportOmission, PortableExportEnvelope } from './envelope.js';
import {
  diagnosisYearProvenanceZh,
  geneticValueProvenanceZh,
  instrumentOmission,
  withOriginNote,
  NO_ADMIN_FIELD_ORIGIN_NOTE_ZH,
  type MilestoneEvent,
  type NormalisedSource,
} from './export-source.js';
import {
  AMBULATION_LABELS,
  FOLLOWUP_EVENT_LABELS,
  FOLLOWUP_EVENT_SEVERITY_LABELS,
  FUNCTION_TEST_LABELS,
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

const NOT_COLLECTED_SECTION = (key: string, titleZh: string, noteZh: string): TreatNmdSection => ({
  key,
  titleZh,
  collected: false,
  items: [],
  noteZh,
});

const boolItem = (
  key: string,
  labelZh: string,
  value: boolean | null,
  provenanceZh: string,
): TreatNmdItem | null => (value === null ? null : { key, labelZh, value, provenanceZh });

const textItem = (
  key: string,
  labelZh: string,
  value: string | null,
  provenanceZh: string,
): TreatNmdItem | null => (value === null ? null : { key, labelZh, value, provenanceZh });

const compact = (items: ReadonlyArray<TreatNmdItem | null>): TreatNmdItem[] =>
  items.filter((item): item is TreatNmdItem => item !== null);

const milestoneItem = (milestone: MilestoneEvent): TreatNmdItem => ({
  key: `milestone.${milestone.kind}`,
  labelZh: milestone.labelZh,
  value: milestone.occurrence,
  provenanceZh: '患者在随访时间线上记录的事件；日期精度见 occurrence.precision',
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
        labelZh: '是否有基因报告',
        value: source.geneticEvidence.hasGeneticReport,
        provenanceZh: '依据患者是否上传过基因检测报告文件判断，不代表报告内容已被人工核对',
      },
      // The three genetic results do not share one provenance sentence,
      // and geneticValueProvenanceZh is where the reason is written
      // down: 甲基化 and 单倍型 have no box on any patient form and no
      // back-office write either, so 基线问卷 named an author who cannot
      // exist for them.
      textItem(
        'diagnosis.d4z4',
        'D4Z4 重复单元数',
        source.geneticEvidence.d4z4,
        geneticValueProvenanceZh(source, 'd4z4'),
      ),
      textItem(
        'diagnosis.haplotype',
        '4q 单倍型',
        source.geneticEvidence.haplotype,
        geneticValueProvenanceZh(source, 'haplotype'),
      ),
      textItem(
        'diagnosis.methylation',
        '甲基化',
        source.geneticEvidence.methylation,
        geneticValueProvenanceZh(source, 'methylation'),
      ),
    ]),
    noteZh: null,
  };

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
          textItem(
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

  const symptoms: TreatNmdSection = {
    key: 'symptoms',
    titleZh: '症状',
    collected: latestSymptomByKey.size > 0 || source.challenges.length > 0,
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
        provenanceZh: '基线问卷的困难程度自评',
      })),
    ],
    noteZh:
      '每个症状只取该症状最近一次记录；完整时间序列在 PIPL 数据导出的 submissions 中，本格式不重复承载。',
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
      boolItem(
        'motor.armRaiseDifficulty',
        '上举手臂困难',
        source.currentStatus.armRaiseDifficulty,
        '患者自述',
      ),
      boolItem(
        'motor.facialWeakness',
        '面部肌无力',
        source.currentStatus.facialWeakness,
        '患者自述',
      ),
      boolItem('motor.footDrop', '足下垂', source.currentStatus.footDrop, '患者自述'),
      boolItem(
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
    noteZh:
      '本节不属于该核心数据集列出的强制性内容，作为附加信息提供。已撤回（软删除）的事件不会出现在这里。',
  };

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
          textItem(
            'local.fullName',
            '姓名',
            profile.fullName,
            withOriginNote(source, 'foundation.fullName', '本平台档案中记录的姓名'),
          ),
          textItem(
            'local.preferredName',
            '希望被称呼的名字',
            profile.preferredName,
            withOriginNote(source, 'foundation.preferredName', '本平台档案中记录的称呼'),
          ),
          textItem(
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
      日期精度:
        '里程碑事件的日期来自一个只能存完整时间点的字段。请阅读每条事件的 occurrence.noteZh，不要把它当作精确到天的观察。',
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
