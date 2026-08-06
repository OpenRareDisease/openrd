import { buildCodingProvenance, verifiedCoding, type CodingProvenance } from './codings.js';
import type { ExportOmission, PortableExportEnvelope } from './envelope.js';
import { deterministicUuid, resourceUuid, type NormalisedSource } from './export-source.js';
import {
  DAILY_IMPACT_LABELS,
  DOCUMENT_TYPE_LABELS,
  FOLLOWUP_EVENT_LABELS,
  FOLLOWUP_EVENT_SEVERITY_LABELS,
  FUNCTION_TEST_LABELS,
  MUSCLE_GROUP_LABELS,
  SIDE_LABELS,
  SYMPTOM_LABELS,
  labelFor,
} from './labels.js';
import { toPartialFhirDate } from './occurrence-date.js';

/**
 * FHIR R4 document bundle.
 *
 * THE ONE THING THIS FILE IS ABOUT. Every clinical concept here is
 * emitted as a `CodeableConcept` with `text` and NO `coding`. That is
 * valid FHIR — `CodeableConcept.text` is exactly the element for a
 * human-readable rendering when no code is available — and it is the
 * only honest option available to us today. See codings.ts for why
 * the five LOINC codes this lane was scoped around are not emitted:
 * no LOINC release and no LOINC-bearing document exists anywhere in
 * this repository to check them against, and a receiving system
 * believes a code in a way it does not believe a label.
 *
 * WHAT *IS* CODED, AND WHY THAT IS NOT A CONTRADICTION. A handful of
 * `system` + `code` pairs below point at
 * `http://terminology.hl7.org/CodeSystem/...` and at FHIR's own
 * required-binding value sets (`Observation.status`, `Bundle.type`,
 * `DocumentReference.status`). Those are part of the FHIR R4
 * specification itself — the same artefact that defines the field
 * names around them — not a third-party vocabulary bound into it.
 * Getting `verificationStatus` right is how the bundle says whether
 * the diagnosis is confirmed, which is honesty-critical, so it is
 * emitted rather than dropped.
 *
 * ON `Bundle.type = "document"`. A document bundle's first entry must
 * be a Composition; a bundle of clinical resources without one is not
 * a document, whatever its `type` says. So a Composition is built and
 * it is real: its `author` is the Patient, because these data ARE the
 * patient's own record of themselves, and saying so in the structure
 * is more accurate than inventing an Organization that never touched
 * them.
 *
 * NO NON-STANDARD FIELDS. Nothing in this bundle carries an
 * `_openrd*` key or any other private extension. Everything we want
 * to say that FHIR has no slot for is said in the envelope around the
 * bundle (see envelope.ts), so that `document` can be handed to a
 * validator untouched.
 */

// --------------------------------------------------------------- types

export interface FhirCodeableConcept {
  readonly coding?: ReadonlyArray<{ system: string; code: string; display?: string }>;
  readonly text: string;
}

export interface FhirResource {
  readonly resourceType: string;
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface FhirBundle {
  readonly resourceType: 'Bundle';
  readonly id: string;
  readonly type: 'document';
  readonly timestamp: string;
  readonly entry: ReadonlyArray<{ fullUrl: string; resource: FhirResource }>;
}

// ------------------------------------------------------------ constants

const CLINICAL_STATUS_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
const VERIFICATION_STATUS_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-ver-status';
const OBSERVATION_CATEGORY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/observation-category';

/**
 * How many Observations the bundle will carry.
 *
 * A patient who has been logging for ten years has tens of thousands
 * of rows, and a FHIR document bundle is one JSON body held whole in
 * memory at both ends. Some bound is unavoidable — but a SILENT bound
 * hands a researcher a complete-looking record with its oldest half
 * missing. So: every candidate observation is pooled and sorted by
 * its own effective time before the cut, the newest survive, and the
 * number dropped is reported in `omissions`. Pooling first is what
 * makes 「newest first」 true across categories rather than only
 * within whichever category happened to be built first — otherwise a
 * patient with 500 strength readings would export no symptom scores
 * at all and the export would not say so.
 */
const MAX_OBSERVATIONS = 500;

const codeableText = (text: string): FhirCodeableConcept => ({ text });

const sortKey = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  // Unparseable timestamps sort last rather than throwing or sorting
  // first: a bad timestamp must not be able to evict good records.
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

interface ObservationCandidate {
  readonly sortAt: number;
  readonly resource: FhirResource;
  /** Set for observations parsed out of an uploaded report. */
  readonly documentId?: string;
}

// --------------------------------------------------------------- builder

export const buildFhirExport = (
  source: NormalisedSource,
): PortableExportEnvelope<FhirBundle> & { codingProvenance: CodingProvenance } => {
  const { profile, options } = source;
  const omissions: ExportOmission[] = [];

  const patientId = resourceUuid(profile.id, 'patient');
  const patientRef = `urn:uuid:${patientId}`;

  const entries: Array<{ fullUrl: string; resource: FhirResource }> = [];
  const push = (resource: FhirResource) => {
    const fullUrl = `urn:uuid:${resource.id}`;
    entries.push({ fullUrl, resource });
    return fullUrl;
  };

  // ------------------------------------------------------------ Patient
  //
  // `birthDate` uses FHIR's partial-date support: a profile that only
  // knows the birth YEAR emits "1988", not "1988-01-01". This is the
  // one place in these three formats where 「只知道年份」 is
  // expressible without an extension, and using it is the difference
  // between a true record and a fabricated January date.
  const birthDate =
    profile.dateOfBirth ??
    (source.birthYear.kind === 'year' ? String(source.birthYear.year) : undefined);

  push({
    resourceType: 'Patient',
    id: patientId,
    ...(profile.gender ? { gender: toFhirGender(profile.gender) } : {}),
    ...(birthDate ? { birthDate } : {}),
    // Name, phone, email and address are NEVER emitted here, not even
    // in the local-only variant. This bundle is the artefact most
    // likely to be handed to a third party, and a resource that can
    // never contain a direct identifier cannot leak one because a
    // flag was wrong somewhere upstream.
  });
  omissions.push({
    field: 'Patient.name / Patient.telecom / Patient.address',
    reasonZh:
      '直接身份信息一律不写入 FHIR 资源，无论是否请求本地留存版本——这样即使调用方把标志位传错，也不会从这里泄露身份信息。姓名等只出现在 TREAT-NMD 对齐导出的 localOnly 节。',
  });

  // ---------------------------------------------------------- Condition
  const diseaseEntry =
    source.diagnosisType === 'FSHD1'
      ? verifiedCoding('disease.fshd1')
      : source.diagnosisType === 'FSHD2'
        ? verifiedCoding('disease.fshd2')
        : null;

  const conditionText = diseaseEntry
    ? // The OMIM number travels INSIDE the human-readable text, with
      // its label attached, rather than as a `coding` carrying an
      // OMIM `system` URI. Which URI is canonical for OMIM in FHIR is
      // exactly the sort of thing this exporter refuses to guess at,
      // and a number inside a sentence cannot be consumed by a
      // machine as an assertion the way system+code can.
      `${diseaseEntry.labelZh}（OMIM ${diseaseEntry.code}）`
    : source.diagnosisTypeRawZh
      ? `面肩肱型肌营养不良（档案记录分型：${source.diagnosisTypeRawZh}，未能明确归入 1 型或 2 型）`
      : '面肩肱型肌营养不良（未记录分型）';

  const conditionId = deterministicUuid(`condition:${profile.id}`);
  push({
    resourceType: 'Condition',
    id: conditionId,
    clinicalStatus: {
      coding: [{ system: CLINICAL_STATUS_SYSTEM, code: 'active' }],
      text: '现症',
    },
    // `confirmed` requires evidence. A genetic report on file is that
    // evidence; a self-reported diagnosis is not, and calling it
    // confirmed would be this export telling a clinician something we
    // do not know.
    verificationStatus: {
      coding: [
        {
          system: VERIFICATION_STATUS_SYSTEM,
          code: source.geneticEvidence.hasGeneticReport ? 'confirmed' : 'unconfirmed',
        },
      ],
      text: source.geneticEvidence.hasGeneticReport
        ? '患者已上传基因检测报告（报告内容未经本平台人工复核）'
        : '患者自述诊断，未上传基因检测报告',
    },
    code: codeableText(conditionText),
    subject: { reference: patientRef },
    ...(source.diagnosisYear.kind === 'year'
      ? { recordedDate: String(source.diagnosisYear.year) }
      : {}),
    ...(source.diagnosisYear.kind === 'unknown'
      ? { note: [{ text: '确诊年份：患者记不清了（已问过，不是未采集）。' }] }
      : {}),
  });

  // ------------------------------------------- DocumentReference first
  //
  // Built before the observations so a report-derived Observation can
  // point at its source document with `derivedFrom`.
  const documentRefById = new Map<string, string>();
  const documentRefs: string[] = [];
  profile.documents.forEach((document) => {
    const ref = push({
      resourceType: 'DocumentReference',
      id: resourceUuid(document.id, 'document-reference'),
      status: 'current',
      type: codeableText(labelFor(DOCUMENT_TYPE_LABELS, document.documentType)),
      subject: { reference: patientRef },
      date: document.uploadedAt,
      content: [
        {
          attachment: {
            ...(document.mimeType ? { contentType: document.mimeType } : {}),
            ...(document.title ? { title: document.title } : {}),
            ...(document.fileSizeBytes !== null ? { size: document.fileSizeBytes } : {}),
            // Points at this platform's API, not at the object store.
            // `Attachment.hash` is deliberately absent: FHIR defines
            // it as base64 of a SHA-1 digest, our `checksum` column is
            // not that, and putting one where the other is expected
            // makes a receiver's integrity check fail in a way that
            // looks like file corruption.
            url: `/patient-profiles/me/documents/${document.id}`,
          },
        },
      ],
      description: '原件需要患者本人的凭据方可取得；本导出不包含文件内容。',
    });
    documentRefById.set(document.id, ref);
    documentRefs.push(ref);
  });

  // ------------------------------------------------- Observation pool
  const candidates: ObservationCandidate[] = [];

  profile.measurements.forEach((measurement) => {
    const sideLabel = measurement.side ? `（${labelFor(SIDE_LABELS, measurement.side)}）` : '';
    candidates.push({
      sortAt: sortKey(measurement.recordedAt),
      resource: {
        resourceType: 'Observation',
        id: resourceUuid(measurement.id, 'observation-measurement'),
        status: 'final',
        category: [
          { coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: 'exam' }], text: '体格检查' },
        ],
        code: codeableText(
          `${labelFor(MUSCLE_GROUP_LABELS, measurement.muscleGroup)}肌力${sideLabel}`,
        ),
        subject: { reference: patientRef },
        effectiveDateTime: measurement.recordedAt,
        valueQuantity: { value: measurement.strengthScore, unit: 'MRC 分级（0–5，5 为正常）' },
        note: [
          {
            text:
              measurement.entryMode === 'clinician_entered'
                ? '由临床人员录入。'
                : '患者自评或在应用引导下自测，非临床环境下的标准化徒手肌力测试。',
          },
        ],
      },
    });
  });

  profile.functionTests.forEach((test) => {
    const unable = test.notApplicable === true;
    candidates.push({
      sortAt: sortKey(test.performedAt),
      resource: {
        resourceType: 'Observation',
        id: resourceUuid(test.id, 'observation-function-test'),
        status: 'final',
        category: [
          { coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: 'activity' }], text: '活动能力' },
        ],
        code: codeableText(labelFor(FUNCTION_TEST_LABELS, test.testType)),
        subject: { reference: patientRef },
        effectiveDateTime: test.performedAt,
        // 「今天做不了」 is an observation, not a missing value, and
        // FHIR has the right slot for it. Emitting neither a value nor
        // a dataAbsentReason would turn a clinical finding into a gap.
        ...(unable
          ? { dataAbsentReason: codeableText('患者当天尝试后无法完成该测试（不是未测）') }
          : test.measuredValue !== null
            ? {
                valueQuantity: {
                  value: test.measuredValue,
                  ...(test.unit ? { unit: test.unit } : {}),
                },
              }
            : { dataAbsentReason: codeableText('未记录测量值') }),
        ...(test.assistanceRequired === null
          ? {}
          : {
              note: [
                {
                  text: test.assistanceRequired
                    ? '完成时需要他人或器具协助。'
                    : '独立完成，无协助。',
                },
              ],
            }),
      },
    });
  });

  profile.symptomScores.forEach((score) => {
    candidates.push({
      sortAt: sortKey(score.recordedAt),
      resource: {
        resourceType: 'Observation',
        id: resourceUuid(score.id, 'observation-symptom'),
        status: 'final',
        category: [
          { coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: 'survey' }], text: '自评问卷' },
        ],
        code: codeableText(labelFor(SYMPTOM_LABELS, score.symptomKey)),
        subject: { reference: patientRef },
        effectiveDateTime: score.recordedAt,
        valueQuantity: {
          value: score.score,
          unit: `分（量表范围 ${score.scaleMin}–${score.scaleMax}）`,
        },
        note: [{ text: '患者自评。' }],
      },
    });
  });

  profile.dailyImpacts.forEach((impact) => {
    candidates.push({
      sortAt: sortKey(impact.recordedAt),
      resource: {
        resourceType: 'Observation',
        id: resourceUuid(impact.id, 'observation-daily-impact'),
        status: 'final',
        category: [
          { coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: 'survey' }], text: '自评问卷' },
        ],
        code: codeableText(`${labelFor(DAILY_IMPACT_LABELS, impact.adlKey)}困难程度`),
        subject: { reference: patientRef },
        effectiveDateTime: impact.recordedAt,
        valueInteger: impact.difficultyLevel,
        ...(impact.needsAssistance === null
          ? {}
          : { note: [{ text: impact.needsAssistance ? '需要他人协助。' : '不需要他人协助。' }] }),
      },
    });
  });

  // Milestones (wheelchair / NIV / AFO). Observations rather than
  // Procedures because what we hold is the patient's statement that a
  // transition happened, not a clinical procedure record. Their dates
  // go through toPartialFhirDate, so a milestone pinned to the first
  // instant of a year is emitted as "2019" and not as "2019-01-01".
  source.milestones.forEach((milestone) => {
    candidates.push({
      sortAt: sortKey(milestone.occurrence.timestamp),
      resource: {
        resourceType: 'Observation',
        id: resourceUuid(milestone.eventId, 'observation-milestone'),
        status: 'final',
        category: [
          { coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: 'survey' }], text: '自评问卷' },
        ],
        code: codeableText(milestone.labelZh),
        subject: { reference: patientRef },
        effectiveDateTime: toPartialFhirDate(milestone.occurrence),
        valueBoolean: true,
        note: [
          { text: milestone.occurrence.noteZh },
          ...(milestone.descriptionZh ? [{ text: milestone.descriptionZh }] : []),
        ],
      },
    });
  });

  // Falls and other follow-up events. Same Observation shape as the
  // milestones and the same date-precision caveat, so the note travels
  // with each one rather than living in a header a consumer may drop.
  source.followupEvents.forEach((event) => {
    candidates.push({
      sortAt: sortKey(event.occurrence.timestamp),
      resource: {
        resourceType: 'Observation',
        id: resourceUuid(event.eventId, 'observation-followup'),
        status: 'final',
        category: [
          { coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: 'survey' }], text: '自评问卷' },
        ],
        code: codeableText(labelFor(FOLLOWUP_EVENT_LABELS, event.eventType)),
        subject: { reference: patientRef },
        effectiveDateTime: toPartialFhirDate(event.occurrence),
        valueBoolean: true,
        note: [
          { text: event.occurrence.noteZh },
          ...(event.severity
            ? [
                {
                  text: `严重程度：${labelFor(FOLLOWUP_EVENT_SEVERITY_LABELS, event.severity)}（患者自评）。`,
                },
              ]
            : []),
          ...(event.descriptionZh ? [{ text: event.descriptionZh }] : []),
        ],
      },
    });
  });

  source.reportFields.forEach((field) => {
    const documentRef = documentRefById.get(field.documentId);
    candidates.push({
      sortAt: sortKey(field.observedAt),
      documentId: field.documentId,
      resource: {
        resourceType: 'Observation',
        id: deterministicUuid(`observation:${field.documentId}:${field.key}`),
        status: 'final',
        category: [
          {
            coding: [
              {
                system: OBSERVATION_CATEGORY_SYSTEM,
                code: field.category === 'imaging' ? 'imaging' : field.category,
              },
            ],
            text: field.category === 'imaging' ? '影像' : '检验',
          },
        ],
        code: codeableText(field.labelZh),
        subject: { reference: patientRef },
        effectiveDateTime: field.observedAt,
        // valueString, not valueQuantity: what OCR extracted is a
        // rendered string («1245 U/L», «45%»), and splitting it into a
        // number and a unit would be this exporter guessing at the
        // unit rather than reading it.
        valueString: field.value,
        ...(documentRef ? { derivedFrom: [{ reference: documentRef }] } : {}),
        note: [
          {
            text: '由上传报告的自动识别（OCR）结构化解析得到，未经人工复核；原始报告见 derivedFrom。',
          },
        ],
      },
    });
  });

  const ranked = [...candidates].sort((a, b) => b.sortAt - a.sortAt);
  const kept = ranked.slice(0, MAX_OBSERVATIONS);
  const dropped = ranked.length - kept.length;

  const observationRefs = kept.map(({ resource }) => push(resource));

  if (dropped > 0) {
    omissions.push({
      field: 'Observation',
      reasonZh: `本次导出的观察条目上限为 ${MAX_OBSERVATIONS} 条。所有候选条目按各自的观察时间排序后取最新的 ${MAX_OBSERVATIONS} 条，其余 ${dropped} 条未写入。完整时间序列仍可从不带 format 参数的数据导出取得。`,
    });
  }

  // -------------------------------------------------- DiagnosticReport
  //
  // One per uploaded report that actually yielded structured fields,
  // and its `result` lists only the Observations that SURVIVED the cut
  // above — a DiagnosticReport referencing a resource absent from the
  // bundle would be a dangling reference in a document bundle.
  const reportRefs: string[] = [];
  const survivingByDocument = new Map<string, string[]>();
  kept.forEach((candidate, index) => {
    if (!candidate.documentId) return;
    const list = survivingByDocument.get(candidate.documentId) ?? [];
    list.push(observationRefs[index]);
    survivingByDocument.set(candidate.documentId, list);
  });

  survivingByDocument.forEach((resultRefs, documentId) => {
    const document = profile.documents.find((candidate) => candidate.id === documentId);
    const fieldsForDocument = source.reportFields.filter(
      (field) => field.documentId === documentId,
    );
    reportRefs.push(
      push({
        resourceType: 'DiagnosticReport',
        id: deterministicUuid(`diagnostic-report:${documentId}`),
        status: 'final',
        code: codeableText(
          `${labelFor(DOCUMENT_TYPE_LABELS, document?.documentType ?? 'other')}（自动解析结果）`,
        ),
        subject: { reference: patientRef },
        effectiveDateTime: fieldsForDocument[0]?.observedAt ?? document?.uploadedAt,
        result: resultRefs.map((reference) => ({ reference })),
        conclusion: '本条目由自动识别结果汇总生成，不含医师结论；请以原始报告与主诊医师意见为准。',
      }),
    );
  });

  // -------------------------------------------------------- Composition
  const composition: FhirResource = {
    resourceType: 'Composition',
    id: deterministicUuid(`composition:${profile.id}:${options.generatedAt}`),
    status: 'final',
    type: codeableText('患者自持的疾病记录摘要（面肩肱型肌营养不良）'),
    subject: { reference: patientRef },
    date: options.generatedAt,
    author: [{ reference: patientRef, display: '患者本人（本记录由患者自行采集与自述）' }],
    title: '肌愈通 患者自持记录导出',
    section: [
      { title: '诊断', entry: [{ reference: `urn:uuid:${conditionId}` }] },
      ...(observationRefs.length > 0
        ? [
            {
              title: '观察与自评记录',
              entry: observationRefs.map((reference) => ({ reference })),
            },
          ]
        : []),
      ...(reportRefs.length > 0
        ? [{ title: '报告自动解析结果', entry: reportRefs.map((reference) => ({ reference })) }]
        : []),
      ...(documentRefs.length > 0
        ? [{ title: '已上传的报告文件', entry: documentRefs.map((reference) => ({ reference })) }]
        : []),
    ],
  };

  const bundle: FhirBundle = {
    resourceType: 'Bundle',
    id: deterministicUuid(`bundle:${profile.id}:${options.generatedAt}`),
    type: 'document',
    timestamp: options.generatedAt,
    // Composition first — that ordering is what makes this a document
    // rather than a bag of resources.
    entry: [{ fullUrl: `urn:uuid:${composition.id}`, resource: composition }, ...entries],
  };

  omissions.push({
    field: 'CodeableConcept.coding (LOINC)',
    reasonZh:
      '所有临床概念都以 text + 显示名给出，不附带 LOINC 等外部编码。本仓库内没有可核对的 LOINC 来源，写入未经核对的编码会让接收系统「确信」一个可能错误的映射——这比不给编码更糟。具体见 codingProvenance.withheld。',
  });

  return {
    format: 'HL7 FHIR R4 document Bundle',
    conformanceZh:
      '按 FHIR R4 的资源结构序列化为 type=document 的 Bundle（首个条目为 Composition），未经官方校验器校验。所有临床概念使用 CodeableConcept.text，不附带外部术语编码。',
    generatedAt: options.generatedAt,
    document: bundle,
    omissions,
    notes: {
      编码: '本 Bundle 中出现的 system 均为 FHIR R4 规范自身定义的取值集（condition-clinical、condition-ver-status、observation-category），不是第三方术语。',
      文件: 'DocumentReference 只给出本平台的 API 路径，不含文件内容，也不含对象存储的内部地址。',
      日期: '里程碑事件若在来源中正好落在某一年的第一毫秒，会以「YYYY」输出而不是「YYYY-01-01」——FHIR 的 date/dateTime 允许只写年份，这样才不会凭空给出一个 1 月 1 日。',
    },
    codingProvenance: buildCodingProvenance([]),
  };
};

/**
 * FHIR `AdministrativeGender`: male | female | other | unknown.
 *
 * Same reasoning as the Phenopacket mapping: `prefer_not_to_say`
 * becomes `unknown`, not `other`. Declining to answer is not a
 * statement about gender, and `other` would turn a privacy choice
 * into a recorded characteristic.
 */
export const toFhirGender = (gender: string): 'male' | 'female' | 'other' | 'unknown' => {
  switch (gender) {
    case 'male':
      return 'male';
    case 'female':
      return 'female';
    case 'non_binary':
      return 'other';
    default:
      return 'unknown';
  }
};
