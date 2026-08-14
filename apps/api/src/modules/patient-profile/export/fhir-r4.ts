import { buildCodingProvenance, verifiedCoding, type CodingProvenance } from './codings.js';
import type { ExportOmission, PortableExportEnvelope } from './envelope.js';
import {
  deterministicUuid,
  instrumentOmission,
  originNoteZh,
  resourceUuid,
  withOriginNote,
  NO_ADMIN_FIELD_ORIGIN_NOTE_ZH,
  type NormalisedSource,
} from './export-source.js';
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
 * THE ONE THING THIS FILE IS ABOUT. A clinical concept here acquires a
 * `coding` only where codings.ts holds a verified entry for it, and
 * today it holds none that FHIR may emit — so today every one of them
 * is a `CodeableConcept` with `text` and no `coding`. That is valid
 * FHIR — `CodeableConcept.text` is exactly the element for a
 * human-readable rendering when no code is available — and it is the
 * only honest option available to us today. See codings.ts for why
 * the five LOINC codes this lane was scoped around are not emitted:
 * no LOINC release and no LOINC-bearing document exists anywhere in
 * this repository to check them against, and a receiving system
 * believes a code in a way it does not believe a label.
 *
 * 「Today」 is load-bearing in that paragraph, so the bundle does not
 * repeat it as a fact. The three places this envelope tells a receiver
 * what terminology it uses — the `CodeableConcept.coding (LOINC)`
 * omission, `conformanceZh` and `notes.编码` — are all derived from the
 * `codingSystems` set that `declaredByKept` returns, and that function
 * is handed `kept`, the observations that survived the MAX_OBSERVATIONS
 * cut, NOT the candidate pool the report-field loop appends to.
 * Promoting a code in codings.ts therefore cannot leave this document
 * declaring an absence it contradicts, and neither can a cut that
 * evicts the one coded Observation out of a bundle whose envelope has
 * already announced its system. Every statement in this envelope that
 * is ABOUT the document is read off what the document ended up
 * containing.
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
 * missing. So: every candidate observation is pooled and ranked by
 * the observation time it actually publishes, the newest survive, and
 * the number dropped is reported in `omissions`. A candidate with no
 * usable observation time ranks LAST — see
 * `NO_KNOWN_OBSERVATION_TIME`. Pooling first is what makes 「newest
 * first」 true across categories rather than only within whichever
 * category happened to be built first — otherwise a patient with 500
 * strength readings would export no symptom scores at all and the
 * export would not say so.
 */
export const MAX_OBSERVATIONS = 500;

const codeableText = (text: string): FhirCodeableConcept => ({ text });

/**
 * Where a candidate with no usable observation time is ranked.
 *
 * Last, so that a record which does not say when it was measured
 * cannot evict one that does. Two kinds land here and they deserve the
 * same treatment: a timestamp that will not parse, and a report field
 * whose date OCR never found. The second is the dangerous one — its
 * `observedAt` is the UPLOAD time, and the Observation built from it
 * deliberately publishes no `effectiveDateTime` at all, so ranking it
 * on `observedAt` would put a stack of old reports photographed this
 * morning at the very top of the bundle and push genuinely recent
 * symptom scores and strength readings off the end of the cut.
 */
const NO_KNOWN_OBSERVATION_TIME = Number.NEGATIVE_INFINITY;

const sortKey = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? NO_KNOWN_OBSERVATION_TIME : parsed;
};

interface ObservationCandidate {
  readonly sortAt: number;
  readonly resource: FhirResource;
  /** Set for observations parsed out of an uploaded report. */
  readonly documentId?: string;
  /**
   * What this candidate would make the envelope SAY about the bundle,
   * if it survives the cut.
   *
   * Carried here rather than accumulated while the pool is being
   * filled, because each of these becomes a sentence about what the
   * document contains. A candidate the cut evicts contributes no
   * resource, so it must contribute no sentence either: before this,
   * a single coded Observation ranked 501st still made all three
   * terminology declarations name a system no reader could find in the
   * bundle, and `codingProvenance.emitted` cite a code that was not
   * there. Read once, after the cut, by `declaredByKept`.
   */
  readonly declares?: {
    /** Ledger key whose coding was written onto `resource.code`. */
    readonly codingKey?: string;
    /** That coding's `system`, for the envelope's terminology lines. */
    readonly codingSystem?: string;
    /** True for a report field whose report stated no date of its own. */
    readonly undatedReportField?: boolean;
  };
}

interface KeptDeclarations {
  readonly codingKeys: ReadonlySet<string>;
  readonly codingSystems: ReadonlySet<string>;
  readonly hasUndatedReportField: boolean;
}

/** Everything the envelope may assert about the bundle, read off the survivors. */
const declaredByKept = (kept: readonly ObservationCandidate[]): KeptDeclarations => {
  const codingKeys = new Set<string>();
  const codingSystems = new Set<string>();
  let hasUndatedReportField = false;
  kept.forEach(({ declares }) => {
    if (!declares) return;
    if (declares.codingKey) codingKeys.add(declares.codingKey);
    if (declares.codingSystem) codingSystems.add(declares.codingSystem);
    if (declares.undatedReportField) hasUndatedReportField = true;
  });
  return { codingKeys, codingSystems, hasUndatedReportField };
};

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
      // This text says what evidence backs the status and where the
      // value sits. It names no author, because nothing here can:
      // `fieldProvenance` records administrator writes, so its absence
      // is not a signature, and `applyGeneticReportAutofill` fills
      // `diseaseBackground.diagnosisType` and its fallback column
      // `patient_profiles.genetic_mutation` off an uploaded report, at
      // read time, before this exporter is handed the profile, leaving
      // nothing behind that says it did. Who typed a baseline value, as
      // far as it can be known, rides the envelope — `fieldOrigins` and
      // notes.字段来源 (contract §B3).
      text: source.geneticEvidence.hasGeneticReport
        ? '患者已上传基因检测报告（报告内容未经本平台人工复核）'
        : withOriginNote(
            source,
            'diseaseBackground.diagnosisType',
            '未上传基因检测报告；诊断信息来自档案记录',
          ),
    },
    code: codeableText(conditionText),
    subject: { reference: patientRef },
    ...(source.diagnosisYear.kind === 'year'
      ? { recordedDate: String(source.diagnosisYear.year) }
      : {}),
    // `note` is the one conformant slot on a Condition for a sentence a
    // human has to read. Both facts belong in it, so a receiver that
    // never opens the envelope still sees them.
    ...(() => {
      const yearOrigin = originNoteZh(source, 'foundation.diagnosisYear');
      const notes = [
        ...(source.diagnosisYear.kind === 'unknown'
          ? ['确诊年份：患者记不清了（已问过，不是未采集）。']
          : []),
        ...(yearOrigin ? [`确诊年份${yearOrigin}。`] : []),
      ];
      return notes.length > 0 ? { note: notes.map((text) => ({ text })) } : {};
    })(),
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
    // The one place an OCR-derived value can acquire an external code.
    // `fhirSystem === null` means the ledger holds the code but has
    // decided it must not travel as a machine-resolvable Coding (the
    // OMIM entries), so it degrades to text like an unledgered key.
    const ledgered = field.codingKey ? verifiedCoding(field.codingKey) : null;
    const coding = ledgered?.fhirSystem
      ? { system: ledgered.fhirSystem, code: ledgered.code, display: ledgered.label }
      : null;
    candidates.push({
      // Recorded, not accumulated: whether this coding gets to be
      // announced by the envelope depends on whether the Observation
      // below survives the cut.
      declares: {
        ...(coding && ledgered ? { codingKey: ledgered.key, codingSystem: coding.system } : {}),
        undatedReportField: field.observedAtIsUploadTime,
      },
      // Not `sortKey(field.observedAt)`: for an undated report field
      // that value is the upload time, and this Observation is about
      // to refuse to publish it as the measurement time. Ranking on a
      // date the resource itself declines to state is how the cut
      // below would keep the dateless rows and drop the dated ones.
      sortAt: field.observedAtIsUploadTime ? NO_KNOWN_OBSERVATION_TIME : sortKey(field.observedAt),
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
        code: coding ? { coding: [coding], text: field.labelZh } : codeableText(field.labelZh),
        subject: { reference: patientRef },
        // `effectiveDateTime` is written ONLY when the report stated
        // its own date. When OCR read none, `field.observedAt` is the
        // upload time, and putting that here would date a report
        // printed in 2019 to the week it was photographed — a
        // receiver has no way to recover the difference afterwards,
        // and a current-looking FVC%pred is exactly what makes a
        // clinician defer a respiratory reassessment. Leaving the
        // element out says 「不知道是什么时候测的」, which is true;
        // the upload time is still readable, correctly labelled, on
        // the DocumentReference this Observation derives from.
        ...(field.observedAtIsUploadTime ? {} : { effectiveDateTime: field.observedAt }),
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
          ...(field.observedAtIsUploadTime
            ? [
                {
                  text: '报告上没有识别到检查或报告日期，因此本条不给出 effectiveDateTime——测量时间未知，不是「等于上传时间」。derivedFrom 指向的 DocumentReference.date 是患者上传该文件的时间。',
                },
              ]
            : []),
        ],
      },
    });
  });

  const ranked = [...candidates].sort((a, b) => b.sortAt - a.sortAt);
  const kept = ranked.slice(0, MAX_OBSERVATIONS);
  const dropped = ranked.length - kept.length;
  const declared = declaredByKept(kept);

  const observationRefs = kept.map(({ resource }) => push(resource));

  if (dropped > 0) {
    omissions.push({
      field: 'Observation',
      reasonZh: `本次导出的观察条目上限为 ${MAX_OBSERVATIONS} 条。所有候选条目按各自写明的观察时间排序后取最新的 ${MAX_OBSERVATIONS} 条；没有写明观察时间的条目（例如报告上没有识别到日期的解析项）一律排在最后，不会挤掉写明了时间的记录。其余 ${dropped} 条未写入。完整时间序列仍可从不带 format 参数的数据导出取得。`,
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
    // Same rule as the Observations above: the report's own stated
    // date or nothing. Falling back to `document.uploadedAt` here
    // would put the wrong date back on the record through the parent
    // resource after the children had correctly refused it.
    const statedAt =
      fieldsForDocument.find((field) => !field.observedAtIsUploadTime)?.observedAt ?? null;
    reportRefs.push(
      push({
        resourceType: 'DiagnosticReport',
        id: deterministicUuid(`diagnostic-report:${documentId}`),
        status: 'final',
        code: codeableText(
          `${labelFor(DOCUMENT_TYPE_LABELS, document?.documentType ?? 'other')}（自动解析结果）`,
        ),
        subject: { reference: patientRef },
        ...(statedAt ? { effectiveDateTime: statedAt } : {}),
        result: resultRefs.map((reference) => ({ reference })),
        conclusion: statedAt
          ? '本条目由自动识别结果汇总生成，不含医师结论；请以原始报告与主诊医师意见为准。'
          : '本条目由自动识别结果汇总生成，不含医师结论；请以原始报告与主诊医师意见为准。原始报告上没有识别到日期，因此本条不给出 effectiveDateTime。',
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

  // Gated on the survivors for the same reason as the terminology
  // declarations below: this omission explains why certain Observations
  // IN THIS BUNDLE carry no `effectiveDateTime`. If the cut evicted
  // every one of them, there is no such entry to explain, and raising
  // it anyway would send a reader hunting the bundle for a resource
  // that is not in it. The general rule stays stated unconditionally in
  // `notes.日期`.
  if (declared.hasUndatedReportField) {
    omissions.push({
      field: 'Observation.effectiveDateTime（报告自动解析项）',
      reasonZh:
        '有报告没有被识别出检查或报告日期。这类条目不写 effectiveDateTime，也不用上传时间代替——一份 2019 年打印、上周才拍照上传的报告，若标成上周，接收方读到的就是一个「当前」的结果。上传时间见对应 DocumentReference.date，它是上传时间而不是检查时间。',
    });
  }

  // The three statements this bundle makes about external terminology
  // — this omission, `conformanceZh` and `notes.编码` — are derived
  // from the codings that are IN the bundle, not written down once and
  // left. They used to be hardcoded 「没有外部编码」, so the five-line
  // promotion codings.ts advertises would have shipped a document
  // carrying a LOINC code while its own omissions told the receiving
  // hospital there were none anywhere in it. They were then derived
  // from every candidate the report-field loop built, which has the
  // same shape of error one step later: a coded Observation that
  // MAX_OBSERVATIONS evicts is not in the bundle, and a receiver told
  // to look for its system would find nothing. An omission that
  // contradicts the document is worse than no omission list: it is the
  // one part of the envelope a receiver is asked to trust.
  const codedSystemsZh = [...declared.codingSystems].sort().join('、');
  const hasExternalCodings = declared.codingSystems.size > 0;

  omissions.push({
    field: 'CodeableConcept.coding (LOINC)',
    reasonZh: hasExternalCodings
      ? `除以下已核对来源的编码系统外，本 Bundle 的临床概念都以 text + 显示名给出，不附带外部编码：${codedSystemsZh}。未经核对的编码一律不写入，因为写入会让接收系统「确信」一个可能错误的映射——这比不给编码更糟。已写入的编码见 codingProvenance.emitted（含核对来源），仍然留空的见 codingProvenance.withheld。`
      : '所有临床概念都以 text + 显示名给出，不附带 LOINC 等外部编码。本仓库内没有可核对的 LOINC 来源，写入未经核对的编码会让接收系统「确信」一个可能错误的映射——这比不给编码更糟。具体见 codingProvenance.withheld。',
  });

  omissions.push(
    instrumentOmission(
      'Observation（Brooke 上肢分级 / Vignos 下肢分级）',
      // What is missing is the BASELINE walking state: nothing in this
      // file reads `source.currentStatus`, so that value reaches no
      // resource here. The earlier wording claimed the bundle held no
      // ambulation resource of any kind, which this same bundle
      // contradicts — 10 米步行计时 is in it, and 6 分钟步行距离,
      // 起立行走计时（TUG） and 户外行走困难程度 can be. A receiver
      // reading 「不含任何行走能力资源」 and then 「请向患者索取」 would
      // go back to the patient for walking ability this document
      // measured. So the claim is narrowed to the state, and each
      // neighbour that is present gets the disambiguation
      // `started_wheelchair` already had: a timing and a self-rating
      // are one day's readings, a milestone is a point in time, and
      // none of the three is the baseline state.
      '本 Bundle 不含基线记录的行走状态（ambulation）：即使患者在填写 Vignos 时选择了同步到基线，基线里的行走状态也不会出现在本 Bundle 的任何位置。本 Bundle 里凡是与走路有关的 Observation，都不是行走状态本身——「10 米步行计时」「6 分钟步行距离」「起立行走计时（TUG）」是某一天的一次计时，「户外行走困难程度」是一项自评，「开始使用轮椅」等随访事件记录的是一个时点，把其中任何一项读作基线行走状态都会读错。基线行走状态不在本 Bundle 中；需要它请向患者索取，或改用 TREAT-NMD 对齐导出。',
    ),
  );

  return {
    format: 'HL7 FHIR R4 document Bundle',
    conformanceZh: hasExternalCodings
      ? `按 FHIR R4 的资源结构序列化为 type=document 的 Bundle（首个条目为 Composition），未经官方校验器校验。临床概念以 CodeableConcept.text 给出；其中来源已核对的项目另附外部术语编码（${codedSystemsZh}），其余不附带。`
      : '按 FHIR R4 的资源结构序列化为 type=document 的 Bundle（首个条目为 Composition），未经官方校验器校验。所有临床概念使用 CodeableConcept.text，不附带外部术语编码。',
    generatedAt: options.generatedAt,
    document: bundle,
    omissions,
    fieldOrigins: source.fieldOrigins,
    notes: {
      // §B3. FHIR validators reject unknown fields, so there is no
      // conformant place inside the Bundle for a per-field 「our staff
      // typed this, not the patient」 — which is exactly why the
      // envelope exists (envelope.ts).
      字段来源:
        source.fieldOrigins.length === 0
          ? NO_ADMIN_FIELD_ORIGIN_NOTE_ZH
          : `本次导出中有 ${source.fieldOrigins.length} 个基线字段不是患者本人填写的（由本平台管理员代为录入，或来源记录读不出来）：${source.fieldOrigins
              .map((origin) => origin.labelZh)
              .join(
                '、',
              )}。逐条见信封的 fieldOrigins。FHIR 的资源结构里没有可以承载这一区分的合规位置，所以它在信封上而不在 Bundle 里；把这些值当作患者自述会记错。`,
      编码: hasExternalCodings
        ? `本 Bundle 中出现的 system，除已核对来源的第三方术语（${codedSystemsZh}）之外，均为 FHIR R4 规范自身定义的取值集（condition-clinical、condition-ver-status、observation-category）。哪些是第三方术语、各自的核对来源，见 codingProvenance.emitted。`
        : '本 Bundle 中出现的 system 均为 FHIR R4 规范自身定义的取值集（condition-clinical、condition-ver-status、observation-category），不是第三方术语。',
      文件: 'DocumentReference 只给出本平台的 API 路径，不含文件内容，也不含对象存储的内部地址。',
      日期: '里程碑事件若在来源中正好落在某一年的第一毫秒，会以「YYYY」输出而不是「YYYY-01-01」——FHIR 的 date/dateTime 允许只写年份，这样才不会凭空给出一个 1 月 1 日。报告自动解析出的项目只在报告本身写明日期时才带 effectiveDateTime；没写明的一律不给日期，也不用上传时间顶替。',
    },
    codingProvenance: buildCodingProvenance([...declared.codingKeys]),
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
