import { buildCodingProvenance, verifiedCoding, type CodingProvenance } from './codings.js';
import type { ExportOmission, PortableExportEnvelope } from './envelope.js';
import {
  archiveOnlyGeneticCells,
  archivedGeneticCellCount,
  deterministicUuid,
  diagnosisTypeMarkerPath,
  diagnosisTypeSourceZh,
  diagnosisYearMarkerPath,
  fallsDiaryOmission,
  familyHistoryOmission,
  geneticConfirmationReasonZh,
  geneticEvidenceDocumentZh,
  instrumentOmission,
  originNoteZh,
  resourceUuid,
  GENETIC_ARCHIVE_CELL_LABELS_ZH,
  NO_ADMIN_FIELD_ORIGIN_NOTE_ZH,
  type NormalisedSource,
} from './export-source.js';
import { TRANSCRIBED_EVIDENCE_LABEL_ZH } from '../genetic-evidence.js';
import {
  DAILY_IMPACT_LABELS,
  DOCUMENT_TYPE_LABELS,
  FOLLOWUP_EVENT_LABELS,
  FOLLOWUP_EVENT_SEVERITY_LABELS,
  FUNCTION_TEST_LABELS,
  SIDE_LABELS,
  SYMPTOM_LABELS,
  UNNAMED_MEASUREMENT_SUBJECT_ZH,
  labelFor,
  measurementMovementZh,
  measurementSubjectZh,
  unnamedMeasurementNoteZh,
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
 * it is real: its `author` is the Patient, which in FHIR names who is
 * responsible for the information, not who typed each value — and
 * naming them is more accurate than inventing an Organization that
 * never touched them. Who typed a value is said per value, not here.
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
 * The Chinese rendering of each `ReportField['category']`.
 *
 * Every member of the union has a row, so adding a fourth category to
 * `ReportField` fails the build here rather than silently inheriting
 * 「检验」 — which is what the two-branch ternary this replaces did to the
 * `exam` member for as long as no spec used it.
 */
const REPORT_CATEGORY_LABELS_ZH: Readonly<Record<'laboratory' | 'exam' | 'imaging', string>> = {
  laboratory: '检验',
  exam: '体格检查',
  imaging: '影像',
};
/**
 * FHIR's own answer to 「there is no value here, and this is why」.
 *
 * Reached for rather than invented: `Observation.dataAbsentReason` is
 * the element R4 defines for a missing `value[x]`, its `unknown` means
 * 「the value is expected to exist but is not known」, and R4 forbids
 * the two from appearing together — so writing this is the same edit
 * as not writing a value, checked by a receiver's validator instead of
 * by us.
 *
 * WHY ONLY `unknown`, when the value set holds other codes and a
 * report saying 未检出 has told us more than 「不知道」. FHIR does offer
 * the finer answer — `interpretation` = `ND`, 「looked for and not
 * detected」 — and it is deliberately not written. The only thing that
 * could decide it is `CELL_REPORTS_ABSENCE`, a substring matcher whose
 * own contract is that it ONLY EVER WITHHOLDS: a cell it matches falls
 * to the copy written for a report that has not stated the item, and
 * nothing downstream may turn a negation into a sentence about a
 * result. Every surface that reads these cells today treats a negation
 * as no result and none of them states a negative finding. A code here
 * saying the laboratory looked and found nothing would make this
 * bundle the one place on this platform that says so, decided by a
 * regex, to the one audience that believes a code rather than a label.
 * What the cell says still travels, verbatim, in `text`.
 */
const DATA_ABSENT_REASON_SYSTEM = 'http://terminology.hl7.org/CodeSystem/data-absent-reason';

const OBSERVATION_INTERPRETATION_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation';

/**
 * THE LABORATORY'S OWN VERDICT, IN THE CODE SYSTEM A RECEIVER READS IT
 * FROM.
 *
 * `Observation.interpretation` is the R4 element for exactly this — 「a
 * categorical assessment of the observation value, e.g. high, low,
 * normal」 — and v3-ObservationInterpretation is its required-support
 * value set. `H`, `L` and `A` are the three members that correspond,
 * one to one, to what `_read_row_flag` reads off the row: an 「↑」 or a
 * bare 「H」, an 「↓」 or an 「L」, and a 提示 column that says 异常 without
 * saying which way.
 *
 * Every laboratory Observation in this bundle went out as `valueString`
 * alone. Measured on a synthetic 心肌酶谱: a CK of 693 against a stated
 * upper limit of 310 reached a registry as 「693U/L」 under 肌酸激酶（CK）
 * with no interpretation and no reference range — the same resource,
 * byte for byte, that a CK of 90 would produce. A receiver ingesting
 * that has no way to recover what the laboratory said, and this is the
 * audience with the strongest claim to it: an interpretation code is
 * machine-filterable in a way a Chinese label never is.
 *
 * A CLOSED MAP, AND NOTHING OUTSIDE IT IS EMITTED. A flag this file
 * cannot read is not one it may guess a code for; the value still
 * travels, and the omission is silent because there is no claim being
 * withheld — only a coding this bundle declines to invent.
 *
 * AND NO CODE FOR THE ABSENCE OF A FLAG. `N` (normal) exists in this
 * value set and is deliberately never written: a row the laboratory did
 * not mark is a row that was not marked, which is not the same
 * statement as 「the laboratory assessed this as normal」. Most rows on
 * a Chinese panel print no marker at all, including rows whose interval
 * this platform never read; emitting `N` for all of them would be this
 * exporter asserting a verdict nobody made.
 */
const OBSERVATION_INTERPRETATION_CODE: Readonly<
  Record<string, { code: string; display: string; textZh: string }>
> = {
  high: { code: 'H', display: 'High', textZh: '高于参考区间（报告标了异常）' },
  low: { code: 'L', display: 'Low', textZh: '低于参考区间（报告标了异常）' },
  abnormal_unspecified: {
    code: 'A',
    display: 'Abnormal',
    textZh: '报告标了异常，但没有写明偏高还是偏低',
  },
};

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

/** The `interpretation` element for a flag this file can read, or
 *  nothing — spread into the resource so that 「no readable flag」 and
 *  「no flag」 produce the same absence rather than a null member. */
const interpretationFor = (flag: string | null) => {
  const coded = flag ? OBSERVATION_INTERPRETATION_CODE[flag.trim().toLowerCase()] : undefined;
  if (!coded) return null;
  return {
    interpretation: [
      {
        coding: [
          {
            system: OBSERVATION_INTERPRETATION_SYSTEM,
            code: coded.code,
            display: coded.display,
          },
        ],
        text: coded.textZh,
      },
    ],
  };
};

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
    /** True for a genetic reading read off a document that is not the
     *  genetics laboratory's own report, which is why that Observation
     *  carries no `category`. */
    readonly transcribedGeneticReading?: boolean;
    /** True for a genetic cell this platform reads no result off, which
     *  is why that Observation carries no `value[x]`. */
    readonly geneticNonResult?: boolean;
    /** True for a cell this bundle DISPLAYS AND DOES NOT JUDGE — the
     *  EcoRI fragment and 甲基化. See `ReportField.notJudgedZh`. */
    readonly geneticNotJudged?: boolean;
  };
}

interface KeptDeclarations {
  readonly codingKeys: ReadonlySet<string>;
  readonly codingSystems: ReadonlySet<string>;
  readonly hasUndatedReportField: boolean;
  readonly hasTranscribedGeneticReading: boolean;
  readonly hasGeneticNonResult: boolean;
  readonly hasGeneticNotJudged: boolean;
}

/** Everything the envelope may assert about the bundle, read off the survivors. */
const declaredByKept = (kept: readonly ObservationCandidate[]): KeptDeclarations => {
  const codingKeys = new Set<string>();
  const codingSystems = new Set<string>();
  let hasUndatedReportField = false;
  let hasTranscribedGeneticReading = false;
  let hasGeneticNonResult = false;
  let hasGeneticNotJudged = false;
  kept.forEach(({ declares }) => {
    if (!declares) return;
    if (declares.codingKey) codingKeys.add(declares.codingKey);
    if (declares.codingSystem) codingSystems.add(declares.codingSystem);
    if (declares.undatedReportField) hasUndatedReportField = true;
    if (declares.transcribedGeneticReading) hasTranscribedGeneticReading = true;
    if (declares.geneticNonResult) hasGeneticNonResult = true;
    if (declares.geneticNotJudged) hasGeneticNotJudged = true;
  });
  return {
    codingKeys,
    codingSystems,
    hasUndatedReportField,
    hasTranscribedGeneticReading,
    hasGeneticNonResult,
    hasGeneticNotJudged,
  };
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
  // NAMES ALL FOUR IDENTIFIERS, NOT THREE. `Patient.identifier` was
  // missing from this list while the profile carries a platform patient
  // code (`patientCode`), and `Condition.asserter` was missing while it
  // carries the diagnosing physician's name — a third person. Both are
  // withheld on the same reasoning as the other three, and a list that
  // names three of five reads as the complete set of identifiers this
  // bundle holds back.
  omissions.push({
    field:
      'Patient.name / Patient.telecom / Patient.address / Patient.identifier / Condition.asserter',
    reasonZh:
      '直接身份信息一律不写入 FHIR 资源，无论是否请求本地留存版本——这样即使调用方把标志位传错，也不会从这里泄露身份信息。这里说的是：患者姓名与希望被称呼的名字、确诊医生 / 主诊医生的姓名（那是第三人的姓名，本 Bundle 不写 Condition.asserter，也不建 Practitioner 资源）、联系电话与邮箱、常住地区，以及本平台内部的患者编号。前三项只出现在 TREAT-NMD 对齐导出的 localOnly 节，且只在明确请求本地留存版本时出现；联系方式、常住地区与患者编号三份可携带导出都不承载，需要请直接向患者索取。',
  });

  // ---------------------------------------------------------- Condition
  //
  // THE SUBTYPE IS THE ONE THE PASSPORT PRINTS, and this resource is
  // one of the two that used to take a different one. `diagnosisType`
  // classifies the ARCHIVED string; `passportDiagnosisType` classifies
  // the evidence document's own 分型 cell first and the archive after
  // it, which is `buildClinicalPassportSummary`'s chain and therefore
  // what the patient and their neurologist are looking at on the
  // passport, the markdown export, the share page and the referral
  // pack. Over a profile whose questionnaire says FSHD1 and whose
  // genetics report reads FSHD2 — ordinary, because the read-time
  // autofill only ever fills an EMPTY slot — this `Condition` asserted
  // 158900 with a verified OMIM number while those four surfaces said
  // FSHD2. `diagnosisTypeSourceZh` in `note` is where the archived
  // string is still reported, so nothing is resolved silently.
  //
  // THE ANAESTHESIA CARD IS NOT IN THAT LIST, and the omission is the
  // point rather than an oversight: it prints a 分型 only on its
  // unconfirmed branch, so on a genetically confirmed profile it
  // carries none. See the note on `diagnosisTypeSourceZh`, whose
  // sentence named it until this round.
  const diseaseEntry =
    source.passportDiagnosisType === 'FSHD1'
      ? verifiedCoding('disease.fshd1')
      : source.passportDiagnosisType === 'FSHD2'
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
    : source.passportDiagnosisTypeRawZh
      ? `面肩肱型肌营养不良（记录的分型：${source.passportDiagnosisTypeRawZh}，未能明确归入 1 型或 2 型）`
      : '面肩肱型肌营养不良（未记录分型）';

  const conditionId = deterministicUuid(`condition:${profile.id}`);
  push({
    resourceType: 'Condition',
    id: conditionId,
    clinicalStatus: {
      coding: [{ system: CLINICAL_STATUS_SYSTEM, code: 'active' }],
      text: '现症',
    },
    // `confirmed` requires evidence, and the evidence is a result this
    // platform read off the genetics laboratory's own report. A
    // self-reported diagnosis is not that, and calling it confirmed
    // would be this export telling a clinician something we do not
    // know.
    //
    // WHAT DECIDES IT IS NOT A DOCUMENT COUNT. This read
    // `hasGeneticReport` — 「is ANY document on file the laboratory's
    // own report」 — which is true for a profile whose genetics report
    // read out nothing and whose repeat count this platform took off a
    // 病历摘要 beside it. That bundle went to a registry as
    // verificationStatus=confirmed while its own genetic Observations
    // carried no `category` because the reading was a transcription,
    // and while the patient's passport, referral pack and anesthesia
    // card all said 未经基因确诊. `geneticallyConfirmed` is the
    // passport's own answer, so there is one of it.
    verificationStatus: {
      coding: [
        {
          system: VERIFICATION_STATUS_SYSTEM,
          code: source.geneticallyConfirmed ? 'confirmed' : 'unconfirmed',
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
      //
      // The sentence is shared with the other two exports rather than
      // written here: a receiver holding this bundle beside the
      // TREAT-NMD document reads one account of what 基因确诊 means on
      // this platform, not two wordings of it.
      text: `${geneticConfirmationReasonZh(source)}。${geneticEvidenceDocumentZh(source)}`,
    },
    code: codeableText(conditionText),
    subject: { reference: patientRef },
    ...(source.diagnosisYear.kind === 'year'
      ? { recordedDate: String(source.diagnosisYear.year) }
      : {}),
    // `note` is the one conformant slot on a Condition for a sentence a
    // human has to read. What goes in it does not branch on the
    // `verificationStatus` arm above, so a receiver that never opens
    // the envelope sees these sentences on a confirmed Condition too.
    ...(() => {
      // Null when the year on this Condition is the year part of
      // `patient_profiles.diagnosis_date` — same reason as the 分型
      // path below.
      const yearMarkerPath = diagnosisYearMarkerPath(source);
      const yearOrigin = yearMarkerPath ? originNoteZh(source, yearMarkerPath) : null;
      // Null when the 分型 on this Condition came out of
      // `patient_profiles.genetic_mutation`: the marker is about the
      // baseline slot, that slot is empty in that state, and printing
      // its note here would put an administrator's name on a string
      // they never wrote. Asked through the shared answer so this note
      // and the TREAT-NMD provenance sentence cannot disagree.
      //
      // AND NULL AGAIN WHEN THE EVIDENCE DOCUMENT SUPPLIED THE 分型.
      // The marker is about a baseline slot; when the report answers,
      // that slot holds a DIFFERENT string from the one this resource
      // asserts, and an administrator's name folded in here would be
      // signed against a value they did not write and this document
      // does not print — the same failure the paragraph above is
      // written about, one store further along.
      const typeMarkerPath =
        source.geneticEvidenceReading.values.diagnosisType === null
          ? diagnosisTypeMarkerPath(source)
          : null;
      const typeOrigin = typeMarkerPath ? originNoteZh(source, typeMarkerPath) : null;
      const notes = [
        ...(source.diagnosisYear.kind === 'unknown'
          ? ['确诊年份：患者记不清了（已问过，不是未采集）。']
          : []),
        ...(yearOrigin ? [`确诊年份${yearOrigin}。`] : []),
        ...(typeOrigin ? [`FSHD 分型${typeOrigin}。`] : []),
        // UNCONDITIONAL. `Condition.code` is the element a registry
        // indexes on, and which string this platform classified into it
        // is not something a receiver can recover from the bundle. The
        // sentence is shared with the Phenopacket, which asserts the
        // same term with no note slot to put it in.
        diagnosisTypeSourceZh(source),
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
    // `measurementSubjectZh`, not `labelFor(MUSCLE_GROUP_LABELS, …)`.
    // The shipped 用力闭眼 self-test writes a row with NO muscle group on
    // every submission, `addMeasurement` stores it as the sentinel
    // 「custom」, and the raw-key fallback published `code.text` =
    // 「custom肌力（不分左右）」 — an MRC 4 on a muscle named 「custom」, with
    // the `metricKey` that says it was facial strength carried nowhere in
    // this bundle. See labels.ts.
    const subjectZh = measurementSubjectZh(measurement.muscleGroup, measurement.metricKey);
    const movementZh = measurementMovementZh(measurement.muscleGroup, measurement.metricKey);
    candidates.push({
      sortAt: sortKey(measurement.recordedAt),
      resource: {
        resourceType: 'Observation',
        id: resourceUuid(measurement.id, 'observation-measurement'),
        status: 'final',
        category: [
          { coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: 'exam' }], text: '体格检查' },
        ],
        code: codeableText(`${subjectZh ?? UNNAMED_MEASUREMENT_SUBJECT_ZH}${sideLabel}`),
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
          ...(movementZh ? [{ text: `记录时做的动作是「${movementZh}」。` }] : []),
          ...(subjectZh === null
            ? [
                {
                  text: unnamedMeasurementNoteZh(measurement.muscleGroup, measurement.metricKey),
                },
              ]
            : []),
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
        transcribedGeneticReading: field.transcribedGeneticReading,
        geneticNonResult: field.readsAsResult === false,
        geneticNotJudged: field.notJudgedZh !== null,
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
        // `category` is written ONLY when this bundle can name one
        // truthfully. The genetic specs are marked laboratory-category
        // because a repeat count IS a laboratory assay — but our copy
        // of it is not always the laboratory's page, and
        // `transcribedGeneticReading` is that question already asked of
        // the document this reading came off. Emitting `laboratory`
        // over a 病历摘要's transcription told a registry a laboratory
        // measured the number, with a `derivedFrom` pointing at the
        // very document that shows it did not; the observation-category
        // value set has no member that means 「read off a transcript」,
        // and inventing a code is what the rest of this file refuses to
        // do. The reading itself still ships — for some patients it is
        // the only copy of the number in existence — and the note plus
        // the omission below say what it is.
        ...(field.transcribedGeneticReading
          ? {}
          : {
              // A TABLE, not a two-branch ternary. Both branches read
              // 「imaging or else laboratory」, which was true while the
              // only two categories in use were those two — and
              // `ReportField['category']` has always had a THIRD member.
              // The MRC grades an examiner writes into 体格检查 are that
              // member: with the ternary they would have gone out coded
              // `exam` and labelled 「检验」, telling a receiver a
              // laboratory produced a hand-graded muscle test.
              category: [
                {
                  coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: field.category }],
                  text: REPORT_CATEGORY_LABELS_ZH[field.category],
                },
              ],
            }),
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
        //
        // AND ONLY WHERE THE CELL IS A RESULT AT ALL. `value[x]` is the
        // element a receiver ingests as this observation's answer, and
        // the genetic cells are the ones this platform's own parser
        // refuses — a 4q 单倍型 naming the laboratory's probes, a D4Z4
        // cell holding an interval or a length in kb, and the rest of
        // what `GENETIC_RESULT_ITEMS` reads no result off. Every one of
        // them went out as `valueString` under a code that says 「4q
        // 单倍型」 or 「D4Z4 重复单元数」, and 「未检出」 filed as a genotype
        // is indistinguishable from an allele name once ingested — the
        // one direction that cannot be caught downstream, and the one
        // the TREAT-NMD document already refuses for the same cell.
        // `readsAsResult` is that same reading, not a second one.
        //
        // `status` STAYS `final`, and so does the category. R4 defines
        // status as the lifecycle of the record — 「complete and there
        // are no further actions needed」 — not as a verdict on what the
        // cell holds; downgrading it to `preliminary` would tell a
        // receiver a result is still coming for a report that is
        // finished, which is a second false statement rather than a
        // repair of the first.
        ...(field.readsAsResult === false
          ? {
              dataAbsentReason: {
                coding: [{ system: DATA_ABSENT_REASON_SYSTEM, code: 'unknown' }],
                text: `报告上这一项写的是「${field.value}」，那是报告原文，不是这一项的检测结果：本平台从它读不出这一项的结果，因此本条不给出结果值。`,
              },
            }
          : {
              valueString: field.value,
              // THE VERDICT AND THE BRACKET, BESIDE THE NUMBER — the two
              // elements R4 defines for them, on the one resource that
              // was publishing neither.
              //
              // GATED WITH `value[x]` AND NOT BESIDE IT. Both of these
              // are assessments OF a value: an interpretation with no
              // value is a verdict about nothing, and a reference range
              // on a resource that has just said it cannot read a result
              // invites a receiver to compare a string it was told not
              // to ingest. So they ride the same branch, and the
              // `readsAsResult === false` cells — the genetic ones —
              // publish neither, which is also correct on its own terms:
              // no laboratory prints a reference interval for a
              // 4q 单倍型.
              ...(interpretationFor(field.flag) ?? {}),
              // `referenceRange.text` AND NOT `low` / `high`.
              //
              // The same reasoning as `valueString` two lines up, and it
              // is the stronger case: `field.referenceRange` is the
              // interval EXACTLY as the row printed it, and the shapes
              // that arrive are 「50-310」, 「<25」 and 「>9」. Splitting
              // those into `Quantity` bounds means this exporter
              // deciding which side an open interval is open on and
              // inventing the unit for both bounds — the unit is on the
              // VALUE string, glued to the number, and is not separately
              // parsed anywhere in this lane. R4 defines `text` for
              // exactly this: a range 「stated as text」 where the
              // structured form is not available.
              //
              // ABSENT WHEN THE REPORT PRINTED NONE, which is an
              // ordinary state and not an error — see
              // `ReportField.referenceRange`. An omitted referenceRange
              // says the report did not state one; it must never be
              // confused with a range this platform decided not to send,
              // and nothing here fabricates a bound to fill it.
              ...(field.referenceRange ? { referenceRange: [{ text: field.referenceRange }] } : {}),
            }),
        ...(documentRef ? { derivedFrom: [{ reference: documentRef }] } : {}),
        note: [
          {
            text: '由上传报告的自动识别（OCR）结构化解析得到，未经人工复核；原始报告见 derivedFrom。',
          },
          // THE GUIDELINE'S OWN QUALIFIER ON THIS RESULT, beside the
          // number instead of nowhere. The 8–10 unit gray zone reached
          // the patient's phone, the share page, the markdown export
          // and the referral pack, and did not reach this bundle or the
          // TREAT-NMD document — so a registry ingesting `valueString:
          // 「9」` under 「D4Z4 重复单元数」 saw an unqualified count,
          // while the patient holding the same profile was told the
          // guideline calls that number borderline. The receiver here
          // is the one who can act on it.
          //
          // `note` AND NOT `interpretation`. The R4 interpretation
          // value set is normal/abnormal/high/low against a reference
          // range, and a repeat count in the gray zone is none of
          // those: it is a result whose CLASSIFICATION is uncertain,
          // which that value set has no member for. Coding it as
          // `abnormal` would state a verdict the guideline explicitly
          // declines to state for 9–10 units. `field.geneticQualifier`
          // carries the machine-readable key for a receiver that wants
          // one; nothing here invents a code to put it in.
          ...(field.geneticQualifier
            ? [
                {
                  text: `本条结果带有一条按指南标注的限定，机器可读的键是「${field.geneticQualifier.kind}」。${field.geneticQualifier.noteZh}`,
                },
              ]
            : []),
          // WHY THIS NUMBER CHANGED NOTHING, beside the number.
          //
          // The EcoRI fragment and 甲基化 reach this bundle at all only
          // as of this change, and the reason they may is that they
          // reach it with this sentence attached. `note` and not
          // `interpretation`: this is a statement about what this
          // platform DID NOT DO, and the interpretation value set has
          // only verdicts in it. `dataAbsentReason` is not it either —
          // the value is present and is published; what is absent is a
          // judgement, and R4 has no element for that.
          ...(field.notJudgedZh ? [{ text: field.notJudgedZh }] : []),
          // HOW TO READ `valueString`, where its printed form is this
          // platform's own encoding rather than the report's. The MRC
          // cells fold both sides of a muscle into one string as
          // 「L4 / R3」; a receiver who takes the two in the other order
          // has the weak side and the strong side swapped, and that is
          // the direction a clinician acts on. See `ReportField.readingNoteZh`.
          ...(field.readingNoteZh ? [{ text: field.readingNoteZh }] : []),
          ...(field.transcribedGeneticReading
            ? [
                {
                  text: `本条不是实验室出具的基因报告上的结果：本平台把 derivedFrom 指向的那份上传件读作这份档案的基因证据，而它不是基因报告，来源标为「${TRANSCRIBED_EVIDENCE_LABEL_ZH}」，上面写着的内容是从别处转录来的。因此本条不写 category——observation-category 取值集里没有表示这种来源的编码，写成 laboratory 会把一段转录说成实验室的结论。`,
                },
              ]
            : []),
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
    author: [{ reference: patientRef, display: '患者本人' }],
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

  // Gated on the survivors for the same reason: this explains why
  // certain Observations IN THIS BUNDLE carry no `category`, and with
  // all of them evicted there is nothing in the bundle it is about.
  if (declared.hasTranscribedGeneticReading) {
    omissions.push({
      field: 'Observation.category（基因结果）',
      reasonZh: `本 Bundle 中的基因结果读自一份不是基因报告的上传件——本平台把它读作这份档案的基因证据，来源标为「${TRANSCRIBED_EVIDENCE_LABEL_ZH}」。observation-category 取值集里没有能表示这种来源的编码，而 laboratory 会把一段转录说成实验室的结论，因此这类 Observation 不写 category。读数照常给出：对一些患者来说，这是唯一一份写着这个数字的材料。请不要把它当作实验室的结论，也不要据它做需要基因确诊的分组。哪一份文件供的数，见该 Observation 的 derivedFrom。`,
    });
  }

  // Gated on the survivors for the same reason: this explains why
  // certain Observations IN THIS BUNDLE carry no `value[x]`, and an
  // element that is simply missing is otherwise indistinguishable from
  // an exporter that never had one.
  //
  // IT NO LONGER LISTS WHAT THOSE CELLS HOLD. The sentence used to walk
  // the receiver through a probe name, an interval and a 未检出 and end
  // 「都不是这一项的结果」 — a closed list of a set that is decided
  // elsewhere and had already grown past it: a length the report wrote
  // in kb and a repeat count of 0 both land here now, and neither was
  // in it. The one true statement is the one that was already in front
  // of the list, and each Observation's own `dataAbsentReason.text`
  // carries the cell it is about, verbatim, which is what a receiver
  // deciding what to do with it actually needs.
  if (declared.hasGeneticNonResult) {
    omissions.push({
      field: 'Observation.value[x]（基因结果）',
      reasonZh:
        '本 Bundle 中有基因结果的 Observation 没有给出结果值：报告上那一项写着东西，但本平台从它读不出这一项的结果。这类条目按 FHIR 的写法给出 dataAbsentReason（data-absent-reason 取值集，code=unknown），报告上那一项的原文原样放在同一个元素的 text 里供人阅读。请不要把那段原文当作该项的检测结果导入。',
    });
  }

  // Gated on the survivors like the three above, and for the same
  // reason. What it explains is not a missing element but a PRESENT
  // one that a receiver would otherwise read as a graded result.
  //
  // THE ABSENCE THIS REPLACES. `REPORT_FIELD_SPECS` had no entry for
  // 甲基化 and none for the EcoRI fragment, so this bundle dropped both
  // silently — the FSHD2 discriminator, and, for a report that states
  // its length in kb and gives no repeat count, the only size
  // measurement the laboratory made. The omissions list declared other
  // pipeline gaps and said nothing about either, so a registry
  // receiving the bundle saw a patient with a 4qA haplotype and no D4Z4
  // size measurement at all, which is a different patient from the one
  // the passport describes.
  if (declared.hasGeneticNotJudged) {
    omissions.push({
      field: 'Observation.interpretation（EcoRI 片段 / 甲基化）',
      reasonZh:
        '本 Bundle 中有基因结果的 Observation 给出了数值但不带任何判读：EcoRI 片段是以 kb 写的长度，本仓库内没有可核对的 kb 界限，本平台也不在 kb 和重复单元数之间做换算；甲基化则没有任何门槛读它，也没有解析器判断它是不是一项结果。这两项照原样带到接收方，是因为对一些患者来说本平台是唯一把它们结构化保存下来的地方；它们不参与本平台对这份档案的任何判定，本 Bundle 也不写 interpretation——observation-interpretation 取值集里只有「正常/异常/偏高/偏低」这类结论，而这里恰恰没有结论。逐条的说明写在各自 Observation 的 note 里。',
    });
  }

  // A GENETIC VALUE THE ARCHIVE HOLDS AND THE EVIDENCE DOCUMENT DOES
  // NOT STATE — carried by TREAT-NMD, declared by the Phenopacket, and
  // until now neither carried nor mentioned here.
  //
  // Every genetic Observation in this bundle is built from
  // `source.reportFields`, and a `ReportField` exists only where the
  // document `pickGeneticEvidenceDocument` named had a cell for it. A
  // 甲基化 answered on the baseline questionnaire, beside a report that
  // says nothing about methylation, therefore produced no Observation —
  // and the entry below this one used to end 「the readings themselves
  // all travel now」, which was true of the readings that come off the
  // document and false of this one. A receiver comparing this bundle
  // against the TREAT-NMD document for the same patient in the same hour
  // found a value in one and nothing in the other, with nothing here
  // accounting for the difference.
  //
  // UNCONDITIONAL, and the list of cells is in the sentence rather than
  // gated on which of them this profile has: a bundle built for a
  // patient with no archived genetic answers still has to tell its
  // receiver that this route exists and that this bundle does not carry
  // it, or 「no methylation Observation」 stays unreadable. The names of
  // the cells that ARE in this state are appended when there are any, so
  // the specific gap is nameable without the general rule going quiet.
  //
  // NOT EMITTED. An archived answer has no `derivedFrom`: nothing on
  // this platform can say which report it was copied off, or whether it
  // was copied off one at all. Publishing it as an Observation with no
  // provenance under a code a registry maps as a genotype is the exact
  // trade this file refuses everywhere else — see the `category` note on
  // the transcribed readings. TREAT-NMD can carry it because every one
  // of its items carries a `provenanceZh` saying what the value is; this
  // format has no element that means 「archived answer, source unknown」.
  const archivedOnly = archiveOnlyGeneticCells(source);
  omissions.push({
    field: 'Observation（只存在于档案里、报告上没有的基因读数）',
    reasonZh: `本 Bundle 里的基因结果 Observation 只来自本平台读作这份档案基因证据的那一份上传件：报告上有那一项，才有对应的 Observation。基线问卷另外为${GENETIC_ARCHIVE_CELL_LABELS_ZH.join('、')}各留了输入框，患者或本平台工作人员填进去的值存在档案里；这类值本 Bundle 一律不承载，因为它没有可指向的 derivedFrom——本平台没有记录它当初是从哪一份报告抄来的，甚至没有记录它是不是抄来的，而把一个来源不明的值写成 Observation 会被登记方当作实验室结果导入。${
      archivedOnly.length > 0
        ? `本次导出正处在这种状态的是：${archivedOnly.map((cell) => cell.labelZh).join('、')}。这些值连同各自的来源说明在 TREAT-NMD 对齐导出的 diagnosis 一节里给出。`
        : archivedGeneticCellCount(source) > 0
          ? '本次导出没有处在这种状态的项目：档案里填了值的那几项，报告上也都有，因此它们都以 Observation 出现在本 Bundle 里。'
          : '本次导出没有处在这种状态的项目，原因是这份档案的这三个输入框一个都没有值——不是「填了而且和报告一致」。'
    }请不要把这类项目在本 Bundle 里的缺席读成患者没有做过对应的检测。`,
  });

  // WHAT THE PASSPORT'S 诊断 BLOCK HOLDS AND THIS BUNDLE DOES NOT.
  //
  // Unconditional, because it is about what this exporter does and not
  // about which resources a particular profile produced. Every reading
  // the EVIDENCE DOCUMENT states travels now — 甲基化 and the EcoRI
  // fragment were the two that did not, and an archived answer the
  // document is silent about is declared in the entry immediately above
  // rather than carried — so what is left is this platform's judgement of
  // the report, the copy written around that judgement, the assay
  // method, and the patient's own answer about their diagnostic
  // journey. Declared rather than emitted for the reason the TREAT-NMD
  // document gives at the same point: the mappable part of the verdict
  // is already on `Condition.verificationStatus`, in the sentence all
  // three exports share, and the rest is copy written for a patient and
  // their own clinician holding the original report.
  omissions.push({
    field: 'Condition（临床护照的基因证据分级、检测方法与诊断进度）',
    reasonZh:
      '本 Bundle 承载报告上的读数与「是否基因确诊」这一判定，不承载临床护照上围绕它的其余内容：基因证据的分级（未检测 / 方法不适用 / 结果不全 / 转录件 / 单倍型非允许型 / 可用于入组）与面向患者的说明文字、随分级生成的《检查申请说明》及其指南出处、报告上写的检测方法（FHIR 的 Observation.method 是它的位置，本导出尚未填写），以及患者在基线问卷上自己勾选的「诊断进度」。判定本身在 Condition.verificationStatus 上，它的 text 与 TREAT-NMD 对齐导出中 diagnosis.geneticallyConfirmed 的 provenanceZh、Phenopacket 导出中对应的 omission 是同一句话。verificationStatus 只有 confirmed / unconfirmed 两个取值，「实验室读到的单倍型不是允许型」与「什么都没读到」都落在 unconfirmed 上——这两种情况的区别写在同一元素的 text 里，请读它，不要只读编码。',
  });

  // ------------------------------- the rest of what this bundle holds
  //
  // Everything below is a clinical fact `normaliseSource` or the DTO
  // holds, that R4 HAS a resource for, and that this bundle does not
  // emit. None of them used to be declared. An omissions list that
  // accounts for the LOINC codes, the observation cap and the walking
  // state and then says nothing about the family history or the
  // medication list is read as the complete account of what was left
  // out — envelope.ts on why that is the one thing this field may not
  // do.
  omissions.push(
    familyHistoryOmission(
      'FamilyMemberHistory（家族史）',
      // R4 DOES have the slot, which is exactly why the silence was
      // worse here than in the Phenopacket: a receiver that knows the
      // resource exists reads its absence as 「asked, and there is no
      // family history」. That is the opposite of what this platform
      // holds for a patient whose statement names an affected father.
      // The clause naming what this platform holds is NOT written here
      // — it derives, in the helper, because it is false for an archive
      // with an empty 家族史 box.
      'FHIR R4 有 FamilyMemberHistory 这个资源，本 Bundle 仍然不写它，所以这里要说清楚不写的原因不是格式装不下。另外，FamilyMemberHistory 要求逐个亲属给出 relationship 编码与 status，',
      source.familyHistoryStatement,
    ),
  );
  // MedicationStatement is the R4 resource for 「patient reports taking
  // this」, and it is unfilled. Declared unconditionally rather than
  // gated on the row count, because the sentence is about this
  // exporter's mapping; the count is inside it, where 0 is itself an
  // answer.
  omissions.push({
    field: 'MedicationStatement / MedicationRequest（用药记录）',
    reasonZh: `本 Bundle 不承载用药记录。本次导出持有 ${profile.medications.length} 条用药记录（药名、剂量、频次、给药途径、起止日期、状态与备注），R4 的 MedicationStatement 是它的位置，本导出尚未接入。这些记录三份可携带导出都不承载，需要请直接向患者索取，或改用不带 format 参数的数据导出。本 Bundle 里没有用药记录，不表示患者没有在用药。`,
  });
  // The baseline questionnaire's own findings. The bundle carries the
  // longitudinal self-ratings (symptomScores, dailyImpacts) and none of
  // these — a different block, entered once at registration, and the
  // one a clinician skims first. 面部肌无力 in particular: absent with
  // nothing said, a receiver reads 「no facial weakness」 for the
  // disease whose name starts with the face.
  //
  // 起病部位 is named here and nowhere else in these three documents,
  // which is stated rather than left for the reader to discover.
  omissions.push({
    field: 'Observation / DeviceUseStatement（基线问卷记录的身体状况与困难程度自评）',
    reasonZh: `本 Bundle 不承载基线问卷里的这几项：抬臂困难、面部肌无力、足下垂、呼吸相关症状（都是是 / 否），正在使用的辅助器具（R4 的 DeviceUseStatement 是它的位置，本导出尚未接入），起病部位，以及基线问卷的困难程度自评（本次导出持有 ${source.challenges.length} 项，与本 Bundle 里那些带日期的自评 Observation 不是同一批数据——那些是随访中反复记录的，这一批是建档时一次性填的）。以上各项在 TREAT-NMD 对齐导出里都有对应条目（患者答了的才会出现，没答的那一项就不出现）。它们在本 Bundle 里没有对应资源，不表示患者没有这些表现。`,
  });
  // The last of it: things with a perfectly good R4 home that this
  // exporter has never read. Grouped because they share one reason and
  // one instruction to the receiver, listed by name because 「some other
  // things」 is not a declaration anybody can act on.
  omissions.push({
    field: 'Observation（身高 / 体重 / 血型）/ Composition.section（日常记录、档案备注与基线备注）',
    reasonZh: `本 Bundle 不承载身高、体重与血型：R4 有这三项的写法（体格测量为 Observation，血型为一条实验室 Observation），本导出尚未接入，也不会拿它们去算 BMI 之类的派生值。同样不承载的还有 ${profile.activityLogs.length} 条患者自己写的日常记录（含心情评分），以及两处不同的自由文本备注——「档案备注」与基线问卷自己的「基线备注」（后台也能编辑），哪一个都不承载：那是自由文本，没有可核对的编码，把它塞进 Observation 的 valueString 会让接收系统把一段随笔当成一次测量的结果。这些内容三份可携带导出都不承载，需要请改用不带 format 参数的数据导出，或直接向患者索取。`,
  });

  omissions.push(
    fallsDiaryOmission(
      'Observation（跌倒日记的结构化明细）',
      // THIS is the bundle the entry matters most in. It emits one
      // 跌倒 Observation per fall event, `valueBoolean: true`, with the
      // date and the severity self-rating on `note` — which is exactly
      // enough to look like the complete record of that fall. R4 has
      // homes for all five answers (`component`, or a `bodySite` /
      // `Condition` for the injury), so this is a pipeline gap and not
      // a format limit, and the sentence has to say which.
      '本 Bundle 确实承载跌倒本身：每一次跌倒有一条 code.text 为「跌倒」的 Observation，valueBoolean 为 true，note 上带日期精度说明与患者自评的严重程度。缺的是上面那五项结构化明细——R4 本身有位置放它们（例如挂在同一条 Observation 的 component 上，受伤另可写成 Condition），本导出尚未接入，所以这是本导出管线的缺口，不是 FHIR 放不下。请不要把一条只有日期的跌倒 Observation 读成这次跌倒本平台只记了日期。',
    ),
  );

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
              )}。逐条见信封的 fieldOrigins；诊断相关的几项在 Condition.note 里也各自写明。把这些值当作患者自述会记错。`,
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
