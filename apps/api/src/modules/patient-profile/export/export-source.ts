import { createHash } from 'node:crypto';

import type { ExportFieldOrigin, ExportOmission } from './envelope.js';
import { baselineFieldLabelZh, listBaselineFieldOrigins } from '../baseline-provenance.js';
import {
  GENETIC_FIELD_KEYS,
  TRANSCRIBED_EVIDENCE_LABEL_ZH,
  pickReading,
  readGeneticEvidence,
} from '../genetic-evidence.js';
import { MUSCLE_GROUP_LABELS, labelFor } from './labels.js';
import { resolveOccurrenceDate, type OccurrenceDate } from './occurrence-date.js';
import {
  VENTILATORY_PATTERN_ZH,
  buildClinicalPassportSummary,
  isDeterminateRepeatCount,
  pickLabReading,
  readSizeCell,
  type PassportDiagnosisConfirmation,
  type PassportGeneticRecordDTO,
} from '../profile.passport.js';
import { decodeFirstYearFrom, type YearAnswer } from './year-value.js';
import type { PatientDocumentDTO, PatientProfileDTO } from '../profile.service.js';

/**
 * One reading of the profile, shared by all three serialisers.
 *
 * The three formats disagree about almost everything — sections vs
 * protobuf messages vs resource graph — but they agree on WHAT is
 * true about the patient. Reading the baseline JSONB three times, in
 * three files, with three sets of key aliases, is how they would
 * start to disagree about that too. So the reading happens once here
 * and the serialisers only ever see the normalised result.
 */

export interface ExportOptions {
  /**
   * Whether the local-only block may be rendered.
   *
   * Two separate reasons live behind this one flag, and both point
   * the same way:
   *
   *   - Direct identifiers (name, the diagnosing physician's name)
   *     are, by the FSHD core dataset's own rules, held at the
   *     collecting registry and not shipped onward.
   *   - Family history is a statement about the patient's RELATIVES.
   *     Those people are a second data subject who never consented to
   *     anything here. What we hold is not their medical record; it
   *     is 「患者对自身家族史的陈述」, and it is recorded and labelled
   *     as exactly that.
   *
   * Default OFF. A share link must never carry this block: the
   * patient chose to show a clinician their own record, which is not
   * consent on their sibling's behalf.
   */
  readonly includeLocalOnly: boolean;
  /** Injected so goldens are deterministic and so does not drift per call. */
  readonly generatedAt: string;
}

export type FshdDiagnosisType = 'FSHD1' | 'FSHD2' | 'unspecified';

/**
 * The two stores a 确诊年份 can be read out of, named so the walk that
 * picks between them can hand back which one answered.
 *
 * `baseline` — `baseline.foundation.diagnosisYear`, the questionnaire's
 *   own slot. Also what `applyGeneticReportAutofill` tops up from the
 *   evidence document's 诊断日期, and the one of the two that
 *   `ADMIN_WRITABLE_BASELINE_FIELDS` covers.
 * `profileColumn` — `patient_profiles.diagnosis_date`, read for its
 *   year part when that slot is empty. `upsertBaseline` mirrors the
 *   slot into this column on every write AND on every clear, so this
 *   store answering is itself the statement that no standing baseline
 *   write put the year there.
 */
export type DiagnosisYearStore = 'baseline' | 'profileColumn';

export interface MilestoneEvent {
  readonly kind: 'wheelchair' | 'niv' | 'afo';
  readonly labelZh: string;
  readonly eventId: string;
  readonly occurrence: OccurrenceDate;
  readonly descriptionZh: string | null;
}

/**
 * A follow-up event that is not one of the three milestones — a fall,
 * a first foot drop, a first breathing symptom.
 *
 * Carried separately rather than folded into `milestones` because the
 * milestones answer 「what assistive step has this person reached」
 * and these answer 「what has been happening to them」. They share the
 * same date-precision limitation, so they carry the same
 * `OccurrenceDate`.
 */
export interface FollowupEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurrence: OccurrenceDate;
  readonly severity: string | null;
  readonly descriptionZh: string | null;
}

export interface ReportField {
  readonly key: string;
  readonly labelZh: string;
  readonly value: string;
  /**
   * THE LABORATORY'S OWN VERDICT ON `value`, AND THE INTERVAL IT WAS
   * REACHED AGAINST — the two halves of a reading that had no way out
   * of this file.
   *
   * `flag` is the parser's closed vocabulary (`high`, `low`,
   * `abnormal_unspecified`); `referenceRange` is the interval exactly as
   * the row printed it — 「50-310」, 「<25」, 「>9」 — and neither is
   * parsed or recomputed anywhere in this lane. Resolved by
   * `pickLabReading` off the SAME key the value was picked from, so a
   * marker cannot be attached to a number it was not about.
   *
   * NULL IS AN ORDINARY STATE FOR BOTH, and the serialisers must treat
   * it as one: a row the laboratory did not mark carries no flag, and a
   * great many rows print no interval at all. A missing interval is NOT
   * a statement that the value is in range — it is the report declining
   * to say — so no serialiser may synthesise one, and none may emit a
   * 「normal」 interpretation from its absence.
   */
  readonly flag: string | null;
  readonly referenceRange: string | null;
  readonly documentId: string;
  readonly documentType: string;
  /**
   * The best timestamp available for this reading — the report's own
   * stated time when OCR read one, otherwise the upload time. Safe to
   * ORDER BY; not safe to publish as the observation time without
   * checking `observedAtIsUploadTime` first.
   */
  readonly observedAt: string;
  /**
   * True when OCR found no date on the report and `observedAt` is
   * therefore only the moment the patient photographed it.
   *
   * `reportTime` is genuinely often absent, so this is not an edge
   * case: a pulmonary function report printed in 2019 and uploaded
   * this week would otherwise be exported as an FVC%pred measured
   * this week, and a clinician reading a current-looking number
   * defers the reassessment that number was supposed to trigger.
   * Serialisers must either label the date or leave it out.
   */
  readonly observedAtIsUploadTime: boolean;
  readonly category: 'laboratory' | 'exam' | 'imaging';
  /**
   * True when this is a GENETIC result and the document it was read off
   * is not the genetics laboratory's own report —
   * `isLaboratoryGeneticReport` asked, through
   * `readGeneticEvidence`, of the one document
   * `pickGeneticEvidenceDocument` named.
   *
   * `category` above says what KIND of reading this is and the genetic
   * specs say `laboratory`, which is true of the assay and false of our
   * copy of it when the copy is a 病历摘要 quoting one. A serialiser
   * that emitted the category anyway told a registry a laboratory
   * measured a number this platform read off a transcription — beside a
   * `derivedFrom` pointing at the very document that shows it did not.
   * So the flag travels with the field and the serialisers decide what
   * their own format may still say.
   *
   * FALSE FOR EVERY NON-GENETIC FIELD, whatever kind of document it
   * came off. A CK value on a 血液检验报告 is a laboratory result
   * measured by that laboratory; nothing about it is transcribed, and a
   * flag that spread to it would strip the category off the readings it
   * is correct for.
   */
  readonly transcribedGeneticReading: boolean;
  /**
   * WHETHER THIS PLATFORM READS THIS CELL AS A RESULT FOR ITS ITEM —
   * the passport's own answer, carried here rather than asked again,
   * and `null` for every field that has no such answer.
   *
   * Only the two genetic items have one, and `GENETIC_RESULT_ITEMS` is
   * where it is answered — a 4q 单倍型 cell naming the laboratory's
   * probes, a D4Z4 cell holding an interval or a length in kb, and the
   * rest of what a real report puts in those two boxes. The passport
   * prints every one of them and grades the profile as carrying no
   * confirmatory reading, so a serialiser that published one as the
   * observation's value would hand a receiver prose under a key it maps
   * as data, in the one direction that cannot be caught downstream.
   * Same reading as `geneticResultValue` reports to the TREAT-NMD
   * document, so the two exports cannot describe one cell differently
   * in one run.
   *
   * NULL FOR EVERY OTHER FIELD, and that is not 「not filled in yet」:
   * nothing on this platform refuses a CK string, so there is no
   * reading to report and inventing one here would be this module
   * answering a question nothing else asks — the reason 甲基化 has none
   * either, although 甲基化 now travels.
   */
  readonly readsAsResult: boolean | null;
  /**
   * WHY THIS NUMBER CHANGED NOTHING — the sentence that must ride
   * beside a cell this platform DISPLAYS AND DOES NOT JUDGE, or null
   * for a cell it does judge.
   *
   * Two cells have one: the EcoRI fragment, which is a length in kb and
   * which no boundary in this repository is written against, and 甲基化,
   * which no gate here reads and no parser here refuses. Both of them
   * used to reach a registry through no export at all — see
   * `REPORT_FIELD_SPECS` — and the fix that carries the number without
   * this sentence is worse than the omission it replaces: an
   * unqualified 18 kb under 「EcoRI 片段」 is a size measurement a
   * receiver will compare against a threshold this platform refused to
   * derive.
   */
  readonly notJudgedZh: string | null;
  /**
   * WHAT THE GUIDELINE SAYS ABOUT THIS CELL'S RESULT — the same
   * qualifier `geneticResultValue` hands the TREAT-NMD document, taken
   * off the same `GENETIC_RESULT_ITEMS` entry so the FHIR Observation
   * and the TREAT-NMD item cannot describe one number differently in
   * one run.
   *
   * Null for every non-genetic field, for the genetic cells the
   * guideline says nothing extra about, and for a cell this platform
   * reads no result off at all — a qualifier on a value the same
   * resource is publishing a `dataAbsentReason` for would be a verdict
   * on a number that is not there.
   */
  readonly geneticQualifier: SerialisedGeneticQualifier | null;
  /**
   * HOW TO READ `value`, for a cell whose printed form is this
   * platform's own encoding rather than the report's.
   *
   * Almost every reading here is the report's own rendered string — 「1245
   * U/L」, 「78%」 — and needs no gloss. The MRC cells are the exception:
   * `formatAggregateStrength` (embedded-report-ocr.ts) folds the two
   * sides of one muscle into ONE string, 「L4 / R3」, and 「L」 and 「R」 are
   * ours. A receiver who reads that as a range, or as 「left/right」 in the
   * other order, has the weak side and the strong side swapped — which is
   * exactly the reading a clinician acts on. So the notation is stated
   * beside the value in the only three places a value travels.
   *
   * Null for every cell whose printed form is the report's own.
   */
  readonly readingNoteZh: string | null;
  /**
   * The ledger key a coding WOULD be looked up under. Null where no
   * candidate exists at all. Never a code — see codings.ts.
   */
  readonly codingKey: string | null;
}

export interface NormalisedSource {
  readonly profile: PatientProfileDTO;
  readonly options: ExportOptions;
  /**
   * THE ARCHIVE'S 分型, CLASSIFIED — `diseaseBackground.diagnosisType`,
   * else `patient_profiles.genetic_mutation`.
   *
   * This is the value the TREAT-NMD item `diagnosis.type` is about: its
   * provenance sentence names the store the string sits in and states
   * whether this platform's reading of the evidence document agrees
   * with it. IT IS NOT THE SUBTYPE THIS PATIENT'S CLINICAL SURFACES
   * PRINT — see `passportDiagnosisType`, and see
   * `diagnosisTypeSourceZh` for what happens when the two differ.
   */
  readonly diagnosisType: FshdDiagnosisType;
  readonly diagnosisTypeRawZh: string | null;
  /**
   * THE 分型 EVERY PATIENT- AND CLINICIAN-FACING SURFACE PRINTS,
   * CLASSIFIED: the evidence document's own 分型 cell when it states
   * one, and the archived string otherwise.
   *
   * NOT A SECOND PRECEDENCE RULE. `buildClinicalPassportSummary`
   * resolves 分型 as 「the document `pickGeneticEvidenceDocument` named,
   * then the baseline slot, then `patient_profiles.genetic_mutation`」
   * and prints the answer on the passport, the markdown export, the
   * share page, the referral pack and the anaesthesia card. The cell
   * read here is `geneticEvidenceRecord.geneticType`, which is that
   * same build's record — so the head of the chain cannot come apart
   * from the passport's, and the tail is `diagnosisTypeRawZh`, which is
   * the rest of it.
   *
   * THE DEFECT THIS CLOSES. `applyGeneticReportAutofill` fills an EMPTY
   * archive slot and never corrects a full one, so a patient who
   * answered the questionnaire before uploading the corrected report
   * keeps their old answer forever — an ordinary state, not an edge
   * case. Over exactly that profile (问卷 FSHD1, 基因报告 FSHD2) the five
   * surfaces above all printed FSHD2 while the FHIR `Condition.code`
   * and the Phenopacket `Disease.term` asserted FSHD1, each with a
   * verified OMIM number beside it and neither document saying the
   * report read otherwise. FSHD1 is a contracted D4Z4 array on a
   * permissive 4qA allele and FSHD2 is a different mechanism entirely;
   * the ontology term is the field a registry indexes on, so that was
   * the one copy of the answer that could not be checked downstream.
   */
  readonly passportDiagnosisType: FshdDiagnosisType;
  readonly passportDiagnosisTypeRawZh: string | null;
  /**
   * WHICH STORE THE PRINTED 分型 CAME OUT OF.
   *
   * `diagnosisTypeRawZh` resolves the baseline questionnaire's own slot
   * first and `patient_profiles.genetic_mutation` after it, and for one
   * round it threw away which one answered. Everything downstream then
   * described the first: the provenance sentence said the value sits in
   * the questionnaire slot and that the read-time autofill tops that
   * slot up, and `withOriginNote` looked up the marker for that slot —
   * so a 分型 that came off the free-text column was described by a
   * paragraph about an empty box, and could be stamped with an
   * administrator's name recorded against a value nobody was looking
   * at. The passport already carries this (`DiagnosisValueSlot`), and
   * carrying it here is what lets the two agree.
   *
   * `none` when nothing is on record, which is neither store.
   */
  readonly diagnosisTypeStore: 'baseline' | 'profile_column' | 'none';
  readonly diagnosisYear: YearAnswer;
  /**
   * WHICH STORE THE PRINTED 确诊年份 CAME OUT OF, on the same terms.
   *
   * `null` when neither answered — 记不清了 and 未采集 both land here,
   * and neither has an author to describe.
   */
  readonly diagnosisYearStore: DiagnosisYearStore | null;
  readonly birthYear: YearAnswer;
  readonly geneticEvidence: {
    readonly d4z4: string | null;
    readonly haplotype: string | null;
    readonly methylation: string | null;
  };
  /**
   * HOW WELL BACKED THE DIAGNOSIS IS, as the clinical passport answers
   * it — `buildClinicalPassportSummary`'s `diagnosis.confirmation`,
   * carried whole rather than reduced to a yes/no here.
   *
   * THE STATE THE BOOLEAN BELOW CANNOT HOLD is the one where a
   * laboratory read the 4q haplotype and it is not the permissive
   * allele. Flattened to 「not confirmed」, that profile received the
   * same sentence as a profile with no report at all — 「本平台没有从基因
   * 检测报告里读到可作确诊依据的基因结果」 — so a registry could not tell
   * a negative finding from an absent one, and the receiver of the
   * first is the one who has to act on it. See
   * `geneticConfirmationReasonZh`, which branches on this rather than
   * on the boolean.
   */
  readonly diagnosisConfirmation: PassportDiagnosisConfirmation;
  /**
   * WHETHER THIS PROFILE IS GENETICALLY CONFIRMED — the member above
   * reduced to the one bit the two formats with a boolean slot emit,
   * reduced ONCE, in `normaliseSource`, so that neither of them writes
   * its own `=== 'genetic'`.
   *
   * THE THREE SERIALISERS BELOW ARE NOT ALLOWED A FOURTH ANSWER. Each
   * of them used to ask `hasGeneticReport`, which was 「is ANY document
   * on file the laboratory's own report」 — a different question, and
   * true in states this platform will not call confirmed. A genetics
   * report that read out nothing, on file beside a 病历摘要 quoting the
   * repeat count, answered it true: the FHIR Condition went out as
   * verificationStatus=confirmed and TREAT-NMD's
   * diagnosis.geneticallyConfirmed as true, for the same profile whose
   * passport, referral pack and anesthesia card all said 未经基因确诊
   * and whose exported genetic values name
   * `TRANSCRIBED_EVIDENCE_LABEL_ZH` as their source.
   *
   * Taken off the passport and not off the documents because the rule
   * is not 「a report exists」: it is that the graded evidence came off
   * the laboratory's own report AND states a result the guideline
   * accepts. That rule lives in one place, it moves, and a registry
   * receiving `confirmed` has to move with it.
   *
   * WHAT IT IS NOT. It says nothing about whether a report is on file
   * — a patient with an unreadable one is unconfirmed here and still
   * has it — and nothing about who typed any archived value. Which
   * document was READ is `geneticEvidenceReading`, and authorship is
   * `fieldOrigins` and the provenance sentences.
   */
  readonly geneticallyConfirmed: boolean;
  /**
   * What this platform reads for those same three fields right now, off
   * the ONE document that is this profile's genetic evidence.
   *
   * Not a second copy of `geneticEvidence`: that one is the archive's
   * value, which is what the exports print, and this one is the
   * report's reading, which is what decides whether the archive's value
   * can be attributed to anything. See `geneticValueProvenanceZh`.
   *
   * `documentId` travels with the values because the prose needs it.
   * 「no reading」 has two causes a receiver must not have merged — this
   * platform holds no report it reads these off at all, and the one it
   * does read is silent about this item — and a sentence written from
   * the values alone cannot tell them apart.
   */
  readonly geneticEvidenceReading: {
    readonly documentId: string | null;
    /**
     * Whether that one document is the genetics laboratory's own
     * report, carried off `readGeneticEvidence` rather than re-derived.
     *
     * Read by the provenance sentences, which used to end 「所以这个值是
     * 基因报告的解析结果」 in every state. `pickGeneticEvidenceDocument`
     * takes a 病历摘要 quoting a repeat count when the genetics report
     * read out nothing, so for those profiles the sentence put a
     * laboratory behind a transcription — three lines under this same
     * export's 是否有基因报告, answered false off the same documents.
     */
    readonly laboratory: boolean;
    readonly values: Record<GeneticBaselineField, string | null>;
    /**
     * The 诊断日期 the same document states, as it printed it.
     *
     * Beside `values` rather than inside it: it is not a genetic result
     * and `GeneticBaselineField` is what the genetic sentences are
     * keyed by, but it comes off the same one document, through the
     * same reader, and it is what `applyGeneticReportAutofill` puts in
     * an empty 确诊年份. See `diagnosisYearProvenanceZh`.
     */
    readonly diagnosisDate: string | null;
  };
  /**
   * WHAT THIS PLATFORM READS THOSE CELLS AS — the passport's own
   * `diagnosis.geneticEvidence.record`, carried whole rather than
   * re-parsed here.
   *
   * A DIFFERENT QUESTION FROM `geneticEvidenceReading`, which holds the
   * STRINGS the evidence document prints. A 4q 单倍型 cell reading
   * 「4qA/4qB」 is a string and it is not a haplotype: it names the
   * probes the laboratory used, and `permissiveHaplotype` is null for
   * it. A D4Z4 cell reading 「1-10」 or 「未检出」 is a string and it is
   * not a count. Those answers are what the passport's gates are
   * computed from, and a second reading of the same cells written here
   * — a regex of this module's own — is how a registry would come to
   * receive a genotype the passport does not print. See
   * `geneticResultValue`.
   */
  readonly geneticEvidenceRecord: PassportGeneticRecordDTO;
  /**
   * THE 8–10 UNIT GRAY-ZONE SENTENCE the passport wrote for this
   * profile, or null — `diagnosis.geneticEvidence.greyZoneNote`,
   * carried here for the same reason the record above is carried whole.
   *
   * THE FLAG IS ALREADY HERE and it is `geneticEvidenceRecord.greyZone`
   * — this member is the COPY, which lives one level up on the evidence
   * DTO rather than on the record and so could not ride along with it.
   * Both travel because the qualifier needs both: a key a registry can
   * filter on, and the sentence a human reads. See
   * `SerialisedGeneticQualifier`.
   *
   * NON-NULL ONLY WHERE THE PASSPORT WROTE ONE, which is where a
   * LABORATORY's report states an 8–10 repeat count and does not state
   * 4qB. All three conditions are the passport's, asked once, in
   * profile.passport.ts. Nothing in this lane re-asks them.
   */
  readonly geneticGreyZoneNoteZh: string | null;
  /**
   * The patient's own statement about their relatives.
   *
   * READ BY ONE SERIALISER AND DECLARED BY ALL THREE. treat-nmd.ts
   * emits it in the local-retention variant only; the other two never
   * carry it and say so through `familyHistoryOmission` below, which is
   * where the reasoning lives. For one round they did neither, which is
   * what that helper's header is about.
   */
  readonly familyHistoryStatement: string | null;
  /**
   * 起病部位 — where the patient says the weakness started.
   *
   * Read here because it was on the DTO, held, and reachable by no
   * serialiser: `normaliseSource` is the only thing the three of them
   * read, so a baseline field this file does not lift is a field that
   * cannot be emitted OR described, and it was neither. In this disease
   * that is not a minor field — the 面部 → 肩胛带 → 上臂 progression is
   * what the name says, and 起病部位 is the patient's own answer about
   * the first half of it.
   *
   * Free text, and carried as free text: the questionnaire does not
   * constrain it to an enum, so nothing here classifies it.
   */
  readonly onsetRegion: string | null;
  readonly currentStatus: {
    readonly ambulation: string | null;
    readonly armRaiseDifficulty: boolean | null;
    readonly facialWeakness: boolean | null;
    readonly footDrop: boolean | null;
    readonly breathingSymptoms: boolean | null;
    readonly assistiveDevices: readonly string[];
  };
  readonly challenges: ReadonlyArray<{ key: string; labelZh: string; score: number }>;
  readonly milestones: readonly MilestoneEvent[];
  readonly followupEvents: readonly FollowupEvent[];
  readonly reportFields: readonly ReportField[];
  /**
   * Contract §B3: which baseline fields somebody other than the patient
   * entered. Read ONCE here, like everything else in this file, so the
   * three serialisers cannot disagree about who typed a value.
   *
   * Empty for the overwhelming majority of profiles, and empty is a
   * claim — see PortableExportEnvelope.fieldOrigins.
   */
  readonly fieldOrigins: readonly ExportFieldOrigin[];
}

/**
 * The one sentence a serialiser appends beside a value that somebody
 * other than the patient typed, or `null` when no marker is on record
 * for that path.
 *
 * `null` IS NOT 「the patient typed it」. `listBaselineFieldOrigins`
 * emits a row only for a marked field, so absence here is the absence
 * of a marker and nothing more — the same rule
 * NO_ADMIN_FIELD_ORIGIN_NOTE_ZH below is worded around. A serialiser
 * may append this sentence when it is non-null; on `null` it may print
 * no authorship claim at all.
 *
 * Takes the baseline PATH rather than an item key, because the path is
 * what the provenance block is keyed by; a serialiser that invented its
 * own key would be free to get the mapping wrong in the one direction
 * that matters.
 */
export const originNoteZh = (source: NormalisedSource, fieldPath: string): string | null => {
  const origin = source.fieldOrigins.find((entry) => entry.path === fieldPath);
  if (!origin) return null;
  return origin.state === 'admin_entered'
    ? `；此项由本平台管理员于 ${origin.at ?? '未记录时间'} 代患者录入，不是患者本人填写，患者可能未核对过`
    : `；此项的来源记录读不出来（${origin.detail ?? '原因未记录'}），只能确定不是患者本人填写`;
};

/**
 * `originNoteZh` folded onto a provenance string, so every call site
 * reads the same and none of them can forget the separator.
 *
 * `whenMarkedZh` exists because concatenation alone can produce a
 * self-contradicting sentence: a `provenanceZh` that CLAIMS THE PATIENT
 * TYPED THE VALUE (「患者本人填写」, 「患者自述」) followed by the marker's
 * 「不是患者本人填写」 says both things in one field, and a receiver has
 * no way to tell which half is current. A call site whose base sentence
 * makes that claim passes the sentence to use instead when the field
 * carries a marker; one whose base sentence says only WHERE the value
 * sits (「本平台档案中记录的姓名」) stays true either way and omits it.
 *
 * 「Says only where it sits」 is narrower than it looks, and a sentence
 * that merely AVOIDS naming the patient can still contradict the note.
 * 「本平台没有留下这个值如何进入档案的记录」 names nobody and is refuted
 * by a marker, which is exactly such a record. Read the base sentence
 * against both marker states, not against the patient alone.
 */
export const withOriginNote = (
  source: NormalisedSource,
  fieldPath: string,
  provenanceZh: string,
  whenMarkedZh?: string,
): string => {
  const note = originNoteZh(source, fieldPath);
  if (!note) return provenanceZh;
  return `${whenMarkedZh ?? provenanceZh}${note}`;
};

/**
 * What an EMPTY `fieldOrigins` is allowed to claim, in one sentence the
 * three serialisers share.
 *
 * The claim is about the marker block and nothing else.
 * `fieldProvenance` records administrator writes
 * (baseline-provenance.ts), so a baseline field without an entry is not
 * thereby the patient's own: values reach the baseline along paths that
 * neither the patient typed into that field nor this block marks. The
 * sentence therefore says what is absent from the record and claims
 * nothing about who authored the rest.
 *
 * Shared rather than copied into three files: three copies of one claim
 * are three chances for one of them to be the stronger one.
 */
export const NO_ADMIN_FIELD_ORIGIN_NOTE_ZH = '本次导出的基线字段没有本平台工作人员代填的记录。';

/**
 * The three genetic results a serialiser reads out of
 * `diseaseBackground`, and who could have put one there.
 *
 * WHY THIS IS NOT ONE SENTENCE. All three used to be labelled 「基线
 * 问卷或基因报告结构化解析」, and for two of them the first half names
 * an author who cannot exist. 建档表单
 * (apps/mobile/screens/p-register_profile) draws a D4Z4 重复数 box out
 * of this section and draws none for 单倍型 or 甲基化; it spreads the
 * baseline it loaded, so those two round-trip through a save untouched
 * and no sequence of taps puts a patient's typing into either. The
 * other desk is not a fallback: neither is in
 * `ADMIN_WRITABLE_BASELINE_FIELDS`, and `applyAdminBaselineWrite`
 * refuses a write that changes one — a clear counts as a change. A
 * registry weights a questionnaire answer differently from a
 * laboratory reading, and the disjunction told it to take the former
 * as live for a value nobody at this platform can type. Meanwhile the
 * referral pack and the passport print 来源无法确定 over the same
 * value, so the same app was shipping two answers about it.
 *
 * WHAT THE SENTENCE IS BUILT FROM. Two things, and the box is only the
 * first.
 *
 * The box is a fact about the software: whether the patient's own app
 * draws a control for the field at all. A field with a control has two
 * live origins and no way to tell them apart; a field without one has
 * neither of the two authors this platform can name.
 *
 * The second is the origin of the value actually in front of the
 * reader, which this module CAN see and for one round did not look at.
 * `geneticEvidenceReading` is what the evidence report says today, and
 * when the archive's value is that reading, 「来源无法确定」 is a denial
 * the same read refutes: `collectReportFields` is at that moment
 * attributing 4q 单倍型 to a named document, the FHIR bundle emits it as
 * an Observation of that document, and the passport prints 「报告读取」
 * over the same string. One app was shipping two answers about one
 * value again, in the opposite direction from the one this block was
 * written to fix.
 *
 * NO SENTENCE CLAIMS THE PATIENT TYPED THE NUMBER, including the one
 * for a field that has a box. The box arrives PRE-FILLED from the
 * baseline the form loaded, and that baseline has been through
 * `applyGeneticReportAutofill` — so a report's reading lands in the
 * box, gets posted back by an ordinary save, and is thereafter stored
 * with nothing recording how. 「患者填写」 over that value would be
 * this export inventing self-report out of an OCR read. Which is also
 * why matching the report leaves the field WITH a box at 「区分不了」:
 * the patient could have typed that same string.
 *
 * THE BOX DECIDES THE CONCLUSION, NOT WHETHER THE REPORT IS CONSULTED.
 * It used to decide both, and the field that has a box is the one whose
 * value a registry is most likely to receive twice: this export printed
 * D4Z4 4 out of the archive while the passport, the PDF and the share
 * page printed D4Z4 7 off the report, and the only sentence attached to
 * the 4 described the autofill mechanism in the abstract — the same
 * string for a profile whose report reads 7, for one whose report reads
 * 4, and for one with no report at all. Every field now carries what
 * the reading says; the box decides only what may be concluded from a
 * match.
 *
 * A `Record` over all three rather than a list of the ones with a box,
 * so a fourth genetic field fails the build until somebody has
 * answered the question for it.
 */
export type GeneticBaselineField = 'diagnosisType' | 'd4z4' | 'haplotype' | 'methylation';

/**
 * THE BASELINE PATH WHOSE PROVENANCE MARKER DESCRIBES THE 分型 THIS
 * EXPORT PRINTED, or null when none does.
 *
 * `diseaseBackground.diagnosisType` and
 * `patient_profiles.genetic_mutation` are two different values, and the
 * marker belongs to whichever one is on the page. Attaching the
 * baseline slot's marker to a value the column supplied stamps an
 * administrator's name onto a string they never saw — and the state it
 * happens in is the one where that slot is EMPTY, so the marker being
 * looked up is about a value this document does not contain.
 *
 * Shared rather than restated because two files ask it: the value's own
 * provenance sentence and the FHIR Condition's 分型 note, which is a
 * second rendering of the same marker on the same value.
 */
export const diagnosisTypeMarkerPath = (source: NormalisedSource): string | null =>
  source.diagnosisTypeStore === 'baseline' ? 'diseaseBackground.diagnosisType' : null;

/**
 * THE BASELINE PATH WHOSE PROVENANCE MARKER DESCRIBES THE 确诊年份 THIS
 * EXPORT PRINTED, or null when none does.
 *
 * The same rule as `diagnosisTypeMarkerPath` over the other pair of
 * stores. Null ONLY when the printed year came off
 * `patient_profiles.diagnosis_date`: there the questionnaire's slot is
 * empty, so its marker is about a value this document does not carry.
 * Where nothing was printed at all — 记不清了, 未采集 — the sentence is
 * about the slot itself and the marker is about the same slot, so it
 * still applies; an administrator writing 「记不清了」 into it is a state
 * this export must be able to report.
 *
 * Shared for the reason its sibling is: the provenance sentence and the
 * FHIR Condition's 确诊年份 note are two renderings of one marker.
 */
export const diagnosisYearMarkerPath = (source: NormalisedSource): string | null =>
  source.diagnosisYearStore === 'profileColumn' ? null : 'foundation.diagnosisYear';

/**
 * 分型 IS IN THIS TABLE, and joined it for the reason the other three
 * are in it.
 *
 * 诊断 printed 「患者档案记录为「FSHD1」」 beside it — where the value
 * sits, and not one word about who could have put it there — directly
 * above three siblings that each spell out whether this platform's own
 * reading of the evidence report supports the archived value. A
 * registry reading that section saw two registers in one block and no
 * statement of which fields were in which. And the question is the same
 * question: `applyGeneticReportAutofill` fills
 * `diseaseBackground.diagnosisType` from the evidence report's own
 * 分型 reading, at read time, before this module sees the profile, and
 * leaves nothing behind saying it did.
 *
 * `archived` and `locationZh` are per field because 分型 is the one
 * whose exported value is not the archived string: `value` is the
 * classified enum, so the sentence has to name the string it was
 * classified from. The other three print the archived string itself.
 */
const GENETIC_BASELINE_VALUE_ORIGINS: Record<
  GeneticBaselineField,
  {
    /**
     * The baseline path whose provenance marker is about THE VALUE THIS
     * SENTENCE PRINTS, or null when no marker is about it.
     *
     * A function rather than a string because 分型 is the one whose
     * printed value does not always sit in the baseline: see
     * `diagnosisTypeMarkerPath`.
     */
    readonly markerPath: (source: NormalisedSource) => string | null;
    /** The archived value this sentence is about, as the export holds
     *  it — the string compared against the report's reading. */
    readonly archived: (source: NormalisedSource) => string | null;
    /** How the sentence opens: where the value sits. */
    readonly locationZh: (source: NormalisedSource) => string;
    /** What follows the location: which store holds the value and who
     *  can write that store. Per field, and for 分型 per store. */
    readonly storeClauseZh: (source: NormalisedSource) => string;
  }
> = {
  diagnosisType: {
    markerPath: diagnosisTypeMarkerPath,
    archived: (source) => source.diagnosisTypeRawZh,
    locationZh: (source) =>
      `本平台档案中记录的「${source.diagnosisTypeRawZh}」，本次导出的分型由它归一而来`,
    storeClauseZh: (source) =>
      source.diagnosisTypeStore === 'profile_column'
        ? GENETIC_TYPE_FROM_PROFILE_COLUMN_CLAUSE_ZH
        : GENETIC_VALUE_WITH_BOX_CLAUSE_ZH,
  },
  d4z4: {
    markerPath: () => 'diseaseBackground.d4z4',
    archived: (source) => source.geneticEvidence.d4z4,
    locationZh: () => GENETIC_VALUE_LOCATION_ZH,
    storeClauseZh: () => GENETIC_VALUE_WITH_BOX_CLAUSE_ZH,
  },
  haplotype: {
    markerPath: () => 'diseaseBackground.haplotype',
    archived: (source) => source.geneticEvidence.haplotype,
    locationZh: () => GENETIC_VALUE_LOCATION_ZH,
    storeClauseZh: () => GENETIC_VALUE_NO_FORM_BOX_CLAUSE_ZH,
  },
  methylation: {
    markerPath: () => 'diseaseBackground.methylation',
    archived: (source) => source.geneticEvidence.methylation,
    locationZh: () => GENETIC_VALUE_LOCATION_ZH,
    storeClauseZh: () => GENETIC_VALUE_NO_FORM_BOX_CLAUSE_ZH,
  },
};

/** The base sentence when a marker IS on record. Location only: the
 *  marker's own note says who, and every branched sentence below denies
 *  the marker in one clause or another. */
const GENETIC_VALUE_LOCATION_ZH = '本平台档案中记录的值';

/** What follows the location for a field the patient's own form draws a
 *  box for. Stops before any conclusion: what a match is worth is the
 *  tail's business, and the tail is where the reading is. */
const GENETIC_VALUE_WITH_BOX_CLAUSE_ZH =
  '基线问卷为这一项提供输入框；同时本平台在读取档案时会用这份档案基因证据的解析结果补上档案里空着的这一项，不留记录，而问卷的输入框预填的正是读取到的档案值，保存时一并写回。';

/**
 * What follows the location for a 分型 that is NOT in the baseline
 * questionnaire's slot.
 *
 * The slot is empty and the printed string is
 * `patient_profiles.genetic_mutation`, which is a different field with
 * a different set of writers: the patient's own profile endpoint, and
 * the same read-time autofill, which fills that column off the evidence
 * document's 分型 in the same pass and with the same silence. It says
 * what is absent from the marker block rather than naming an author,
 * because `fieldOrigins` covers baseline paths only — so this value's
 * absence from that list is not evidence about it either way, and a
 * sentence that let a reader take it as such would be the same false
 * signature the marker itself would have been.
 */
const GENETIC_TYPE_FROM_PROFILE_COLUMN_CLAUSE_ZH =
  '这个值不在基线问卷的分型栏位里——那一栏是空的——而在患者档案主记录上的基因突变自由文本栏；本平台在读取档案时也会用这份档案基因证据的解析结果补上空着的这一栏，不留记录。本导出的基线字段来源清单（fieldOrigins）只覆盖基线问卷的栏位，不覆盖这一栏，所以这个值没有出现在那份清单上并不说明它是谁写的。';

/**
 * What follows the location for 单倍型 and 甲基化: no box on the
 * patient's form, and a write path that takes them anyway.
 *
 * THE SENTENCE THIS REPLACES SAID THE OPPOSITE, and a registry acts on
 * the difference. It read 「患者的表单不为这一项提供输入框，本平台后台也
 * 不允许代填（服务端拒绝写入并点名字段），所以它不是患者填写的问卷答案。」
 * — two premises and a conclusion drawn from both. Checked by running
 * each half:
 *
 *   THE BACK-OFFICE HALF IS TRUE. `applyAdminBaselineWrite` refuses a
 *   changed `diseaseBackground.haplotype` / `.methylation` with a 400
 *   naming the field in Chinese: 「管理员不能代填这些基因结果：单倍型、
 *   甲基化。」 That half is kept below, in the same words, because it is
 *   the half a receiver can rely on.
 *
 *   THE PATIENT HALF IS FALSE. `PUT /me/baseline` parses the whole of
 *   `baselineProfileSchema` from whatever client calls it, and that
 *   schema carries both cells; `applyPatientBaselineWrite` carries the
 *   provenance block and does not filter the payload, so the parsed
 *   value is what `upsertBaseline` writes. The shipped registration
 *   screen draws no input for either — which is what the old first
 *   clause was really describing — but it also spreads the loaded
 *   `diseaseBackground` into every save, so even the shipped client
 *   posts both cells back on the patient's own credentials. A screen
 *   is not a write path.
 *
 * WHY IT MATTERED MORE THAN A WRONG WORD. The conclusion 「所以它不是
 * 患者填写的问卷答案」 is what routed these two fields onto
 * `geneticValueFromEvidenceTailZh`, whose last clause ATTRIBUTES the
 * archived string to the evidence document —— 「所以这个值是基因报告的
 * 解析结果」. Over an archive cell holding a string a patient had typed
 * that happens to match the report, a registry was told the value came
 * off a laboratory report, on the strength of a refusal that only
 * covers the back office. Both fields now reach
 * `geneticValueMatchesEvidenceTailZh` like the other two — the tail
 * that says this platform cannot tell the two apart — and the
 * attributing branch is gone rather than re-pointed.
 *
 * WHAT IS STILL NOT SAID. Nothing here claims the value IS the
 * patient's; the archive keeps no record either way, which is what the
 * tails go on to say. It states which doors exist.
 */
const GENETIC_VALUE_NO_FORM_BOX_CLAUSE_ZH =
  '患者的注册表单不为这一项提供输入框，但患者本人的基线保存接口（PUT /me/baseline）接受这一栏并原样写入档案，所以患者用自己的凭据仍然可以把值写进来，写进来之后与读取报告补上的值在库里没有区别；本平台后台不允许代填（服务端拒绝写入并点名字段），所以可以排除的是管理员代填，不能排除患者自己写入。';

/**
 * HOW FAR THIS PLATFORM'S READING REACHES, in the sentences that report
 * it. Every tail below opens with it.
 *
 * The tails used to open 「本平台此刻从该患者已上传的基因报告里读到的
 * 这一项…」 — a claim about the patient's uploads, written from one
 * document. `pickGeneticEvidenceDocument` names ONE, and the rest of
 * the patient's reports are not read for these items at all. Rendered
 * against a profile whose 甲基化 sits on a 病历摘要 the picker declined:
 * the export told a registry 「本平台此刻也没有从该患者已上传的基因报告里
 * 读到这一项」 about a value that is printed, with a correction control
 * beside it, on that document's own page — while the passport, the
 * share page and the referral pack carried the hedged 「不是本平台此刻能
 * 从报告里读到的值」 over the same string. One 甲基化, two accounts of
 * where it came from, decided by which surface the reader was holding.
 *
 * The scope is stated rather than implied, because a receiver cannot
 * see the picker: without this clause 「那一份没有这一项」 reads as 「no
 * report of this patient's has it」, which is the claim that was false.
 *
 * SAYS 文件 AND NOT 报告, for the reason `DIAGNOSIS_DATE_READ_SCOPE_ZH`
 * below already said 「那一份上面的」: the document this platform reads
 * as a profile's genetic evidence is not always a genetics report, and
 * a clause that draws it out of 「该患者上传的报告」 has put a laboratory
 * behind a 病历摘要 before the sentence reaches its verb.
 */
const GENETIC_EVIDENCE_READ_SCOPE_ZH =
  '本平台只从该患者上传的文件中被认定为这份档案基因证据的那一份读取这几项基因结果，其余上传件不参与';

/** …and there is no such document at all. Distinct from the evidence
 *  being silent: nothing was declined and nothing was read, and a
 *  sentence that merged the two would send a receiver looking for a
 *  report to ask about. */
const GENETIC_VALUE_NO_EVIDENCE_REPORT_TAIL_ZH =
  '本平台此刻没有可作为这份档案基因证据来读的文件，所以这一项没有任何来自上传件的读数。它当初如何进入档案，本平台没有留下记录，来源无法确定。';

/** …and the evidence document is silent about this item. */
const GENETIC_VALUE_EVIDENCE_SILENT_TAIL_ZH = `${GENETIC_EVIDENCE_READ_SCOPE_ZH}；那一份没有这一项。这不等于该患者手里没有写着这一项的报告。它当初如何进入档案，本平台没有留下记录，来源无法确定。`;

/**
 * WHAT THE DOCUMENT THE READING CAME OFF IS, in the clause that
 * attributes a value to it.
 *
 * Every tail that reports a reading ended by naming 基因报告, and the
 * document is one only when `laboratory` says so. Rendered against a
 * profile whose one upload is a 病历摘要 quoting a repeat count and a
 * haplotype: 诊断 told a registry 「所以这个值是基因报告的解析结果」 under
 * 4q 单倍型, four items below its own 是否有基因报告 answered false off
 * the same documents — one export, two accounts of whether a laboratory
 * exists, and the false one attached to the number.
 *
 * The transcription branch names the source with the phrase every other
 * surface uses for it, so a receiver holding this beside the passport
 * or the referral pack reads one claim and not two wordings of one.
 */
const evidenceParseZh = (laboratory: boolean) =>
  laboratory ? '基因报告的解析结果' : '本平台对那一份的解析结果';

/**
 * …and what 那一份 is, in the same sentence, whenever it is not the
 * laboratory's report.
 *
 * Its own trailing sentence rather than a clause inside the
 * attribution: 「还是本平台对那一份的解析结果，本平台区分不了」 has a
 * verb waiting at the end of it, and a parenthetical about the document
 * wedged in front of that verb is a sentence a receiver has to read
 * twice. Appended by every tail that reports a READING — an absence has
 * nothing to attribute, so the silent and no-document tails say nothing
 * about the register of a document they read nothing off.
 */
const EVIDENCE_IS_TRANSCRIPTION_NOTE_ZH = `那一份不是基因报告：本平台给它标的来源是「${TRANSCRIBED_EVIDENCE_LABEL_ZH}」，上面写着的内容是从别处转录来的，不是实验室出的结论。`;

/** The note, or nothing, folded on where a tail ends. */
const transcriptionNoteZh = (laboratory: boolean) =>
  laboratory ? '' : EVIDENCE_IS_TRANSCRIPTION_NOTE_ZH;

/**
 * WHAT 基因确诊 MEANS ON THIS PLATFORM, in the one wording every export
 * states it in.
 *
 * `diagnosisConfirmation` is one answer and the three formats each have
 * a slot that has to explain it — FHIR on `Condition.verificationStatus.text`,
 * TREAT-NMD on the item's `provenanceZh`, Phenopacket in the omission
 * that stands in for a field the format does not have. Three wordings
 * of one rule is three things to keep true, and a receiver holding two
 * of these exports side by side would be reading them against each
 * other.
 *
 * IT DOES NOT ENUMERATE THE TESTS THAT EARN IT. 「D4Z4 重复数、4q 单倍型
 * 或 EcoRI 片段」 is the rule restated, and a restatement is a second
 * copy that goes stale the first time the rule moves — a report naming
 * both probes rather than stating a haplotype has a 4q 单倍型 on it and
 * is not a confirmation, so a sentence promising the reader those three
 * names starts lying at that point. What each of these documents does
 * carry is the readings themselves, item by item, with the document
 * they came off named beside them.
 *
 * 可作确诊依据的基因结果 is the anesthesia card's phrase, unchanged: one
 * patient can be holding that card and this export at the same desk.
 */
export const GENETICALLY_CONFIRMED_REASON_ZH =
  '本平台把这份档案判定为基因确诊：作为这份档案基因证据来读的那一份是基因检测报告，且报告上有可作确诊依据的基因结果。文件类型以解析器的判定为准，解析未落地时按上传时声明的类型；报告内容未经本平台人工复核';

/**
 * …and the negative, which is a statement about what this platform HAS
 * READ and about nothing else.
 *
 * 「没有基因报告」 is what this sentence must not say, and what the flag
 * it replaced did say. A genetics report can be on file and unreadable,
 * or on file and silent about every result; the patient is holding it
 * either way, and an export that tells a registry no report exists
 * sends somebody to re-order a test that has already been run.
 *
 * NOR MAY IT COVER THE STATE WHERE THE LABORATORY DID ANSWER. It said
 * 没有读到 for a report whose 4q 单倍型 is an unambiguous 4qB — a result
 * this platform read, printed, and graded — so a registry received the
 * same sentence for 「we have read nothing」 and for 「we have read a
 * finding that argues against this mechanism」. Those two receivers do
 * different things next. The one below is the second one's.
 */
export const NOT_GENETICALLY_CONFIRMED_REASON_ZH =
  '本平台没有把这份档案判定为基因确诊：本平台没有从基因检测报告里读到可作确诊依据的基因结果。这不表示该患者没有做过基因检测，也不表示他手里没有报告 —— 只表示本平台没有读到';

/**
 * …and the state where a laboratory answered, and the answer was 4qB.
 *
 * NOT AN ABSENCE, and the sentence opens by saying so, because the
 * whole defect it closes is a receiver reading it as one. FSHD1 is a
 * contracted D4Z4 array on a PERMISSIVE 4qA allele, so a contraction
 * reported on 4qB is not less evidence towards the diagnosis — it is a
 * finding pointing the other way, and it is on the report the patient
 * is holding.
 *
 * AND IT REFUSES THE OPPOSITE CONCLUSION IN THE SAME BREATH. A registry
 * told 「非允许型」 with nothing after it can file this patient as 排除
 * FSHD. The report states the haplotype of the allele it looked at;
 * whether that rules the disease out is not a question this platform
 * answers, and it says so. Same two refusals the share banner and the
 * referral pack make, in the export's own register.
 */
export const NON_PERMISSIVE_HAPLOTYPE_REASON_ZH =
  '本平台没有把这份档案判定为基因确诊：作为这份档案基因证据来读的那一份是基因检测报告，报告上的 4q 单倍型不是允许型 4qA。这是读到的一条结果，不是没有读到 —— FSHD1 指的是 D4Z4 重复序列在允许型 4qA 等位基因上的缩短，所以这一条不构成可作确诊依据的基因结果。这也不表示已排除 FSHD：报告写的是它所检测的那条等位基因，这份结果如何解读以报告原件与临床判断为准';

/**
 * One of the three, chosen by the shared answer.
 *
 * A `switch` and not a chain of ternaries: a state added to
 * `PassportDiagnosisConfirmation` has to fail the build here rather
 * than fall into the negative, which is how the 4qB state came to be
 * described as an absence on three exports at once.
 */
export const geneticConfirmationReasonZh = (source: NormalisedSource): string => {
  switch (source.diagnosisConfirmation) {
    case 'genetic':
      return GENETICALLY_CONFIRMED_REASON_ZH;
    case 'genetic_non_permissive':
      return NON_PERMISSIVE_HAPLOTYPE_REASON_ZH;
    // The three states in which nothing was read off a laboratory's
    // report at all. They differ in who typed the archived values, which
    // is `fieldOrigins` and the provenance sentences, not this one.
    case 'self_reported':
    case 'admin_entered':
    case 'none':
      return NOT_GENETICALLY_CONFIRMED_REASON_ZH;
    default: {
      const _never: never = source.diagnosisConfirmation;
      return _never;
    }
  }
};

/**
 * WHICH DOCUMENT THIS PLATFORM ACTUALLY READ THE GENETIC VALUES OFF,
 * as a sentence, for the formats that have room for one.
 *
 * A SEPARATE QUESTION FROM CONFIRMATION, AND ASKED SEPARATELY. The two
 * were folded together and the fold is what produced the defect: a
 * disclosure that branched on 「is a report on file」 wrote the
 * transcription warning only when no report existed — the half of the
 * state space where there is no transcription to warn about — and
 * stayed silent in the half where the values on the page were read off
 * a 病历摘要 while a silent genetics report sat beside it.
 *
 * THREE STATES, because a receiver acts differently on each. Nothing
 * read at all is not the same as read off a transcription, and neither
 * is the same as read off the laboratory's own report.
 */
/**
 * WHERE THE 分型 ON THIS DOCUMENT CAME FROM, and — when the archive
 * holds a different one — that it does.
 *
 * The two formats that assert a subtype as an ONTOLOGY TERM have to say
 * this, and they have to say it in one wording: a receiver holding the
 * FHIR bundle beside the Phenopacket reads one account of which string
 * this platform classified, not two. FHIR sets it on `Condition.note`,
 * which is the one conformant slot on that resource for a sentence a
 * human has to read; Phenopacket has no note slot on `Disease` at all
 * and carries it in the omission that already stands in for one.
 *
 * IT NAMES THE DISAGREEMENT RATHER THAN RESOLVING IT SILENTLY. The
 * ontology term now follows the report, because that is what every
 * clinical surface prints and what the laboratory actually measured —
 * but the archived string is still the value the TREAT-NMD item
 * carries, and a registry that ingests both is entitled to know it is
 * looking at two answers and why the older one is still there.
 *
 * SAYS 那一份 AND NOT 报告, for the same reason every read-scope clause
 * in this file does: `pickGeneticEvidenceDocument` takes a 病历摘要
 * quoting the results when that is the only copy, and a sentence
 * calling it a report puts a laboratory behind a transcription.
 * `geneticEvidenceDocumentZh` is where which-kind-of-document is
 * stated, and both callers already print it beside this one.
 *
 * THE LIST OF CORROBORATING SURFACES IS A CHECKED LIST, AND THE
 * ANAESTHESIA CARD IS NOT ON IT. This sentence used to name five
 * surfaces — 患者护照, markdown 导出, 分享页, 转诊资料 and 麻醉提示卡 —
 * as all printing this 分型. Rendered: `buildAnesthesiaCard`
 * (apps/mobile/lib/anesthesia-card.ts) interpolates its 分型 clause
 * into the UNCONFIRMED branch only; on `confirmation === 'genetic'` the
 * diagnosis line is 「诊断：FSHD，基因确诊（D4Z4 重复数 N）」 and carries
 * no 分型 at all. So over a genetically confirmed profile whose
 * evidence document states a 分型 — precisely the state in which this
 * sentence is emitted — the card named here printed nothing to
 * corroborate, and a registry reading the sentence would have counted
 * a fifth agreeing document that does not exist. Naming a document
 * that does not carry the value is worse than naming none.
 *
 * The four that remain are all built in this app and are re-rendered
 * by provenance-surface-claims.test.ts on every run, so this list
 * cannot go stale silently. The card is deliberately NOT re-added with
 * a conditional clause: it lives in apps/mobile and no test on this
 * side can render it, and an unenforceable claim about another app's
 * branch is the same defect one wording further along.
 */
export const diagnosisTypeSourceZh = (source: NormalisedSource): string => {
  const reading = source.geneticEvidenceReading.values.diagnosisType;
  const archived = source.diagnosisTypeRawZh;
  if (reading === null) {
    return archived === null
      ? '本文件没有写入 FSHD 分型：档案里没有记录，本平台读作这份档案基因证据的那一份上也没有这一项。'
      : `本文件的 FSHD 分型由档案里记录的「${archived}」归一而来；本平台读作这份档案基因证据的那一份上没有这一项。`;
  }
  const head = `本文件的 FSHD 分型由本平台读作这份档案基因证据的那一份上写着的「${reading}」归一而来 —— 患者护照、markdown 导出、分享页与转诊资料印的都是这一项，本文件与它们取自同一处。`;
  if (archived === null) return `${head}档案里没有另外记录的分型。`;
  if (archived === reading) return `${head}档案里记录的分型与它逐字相同。`;
  return `${head}档案里另外记录着「${archived}」，与那一份上写的不一致。本平台在读取档案时只会用那一份的解析结果补上档案里空着的栏位，不会改写已经填着的栏位，所以一份先填问卷、后上传报告的档案会一直留着旧答案 —— 这不是错误状态，本文件也不据此判断哪一个对。档案里那个值原样出现在 TREAT-NMD 对齐导出的 diagnosis.type 上，连同它自己的来源说明。`;
};

export const geneticEvidenceDocumentZh = (source: NormalisedSource): string => {
  const { documentId, laboratory } = source.geneticEvidenceReading;
  if (documentId === null) {
    return '本平台此刻没有可作为这份档案基因证据来读的文件。';
  }
  return laboratory
    ? '本平台读作这份档案基因证据的那一份是基因检测报告。'
    : `本平台读作这份档案基因证据的那一份不是基因报告，来源标为「${TRANSCRIBED_EVIDENCE_LABEL_ZH}」，上面写着的基因结果是从别处转录来的，不是实验室出的结论。`;
};

/**
 * …and the evidence document reads the same thing.
 *
 * ONE TAIL, BECAUSE THE ANSWER IS THE SAME FOR ALL FOUR FIELDS. There
 * used to be a second one — `geneticValueFromEvidenceTailZh` — taken
 * whenever the patient's form drew no box, and it ended in an
 * ATTRIBUTION: 「所以这个值是基因报告的解析结果 —— 只是没有记录能指出是
 * 哪一次读取写进去的。」 That branch was reachable for 单倍型 and 甲基化
 * only, and it rested entirely on the claim that a patient could not
 * have written those two cells. `PUT /me/baseline` accepts both (see
 * `GENETIC_VALUE_NO_FORM_BOX_CLAUSE_ZH`), so the
 * attribution was a laboratory's name on a string this platform cannot
 * tell from a patient's own entry — and it went to the receiver most
 * likely to treat it as corroboration.
 *
 * WHAT IS LEFT IS WHAT IS KNOWN: the archived string and the document's
 * reading are identical, and nothing recorded which write put the
 * string there. The receiver is still told the reading AGREES, which is
 * what keeps this sentence different from the one for the state where
 * it does not.
 *
 * DO NOT RE-ADD AN ATTRIBUTING BRANCH for a field on the ground that no
 * screen renders a box for it. The archive believes the endpoint, not
 * the screen, and `applyPatientBaselineWrite` filters nothing.
 */
const geneticValueMatchesEvidenceTailZh = (laboratory: boolean) =>
  `${GENETIC_EVIDENCE_READ_SCOPE_ZH}；那一份的这一项与档案里这个值完全相同。所以这个值是患者自己写进去的，还是${evidenceParseZh(laboratory)}，本平台区分不了。${transcriptionNoteZh(laboratory)}`;

/**
 * …and the evidence document supplies a DIFFERENT reading.
 *
 * Prints the reading, because this document is going to a registry that
 * receives the report's value too — the FHIR bundle emits it as an
 * Observation of the document it came off, and every clinical surface
 * prints it — and 「来源无法确定」 beside a silently different number is
 * the state a receiver resolves by guessing.
 *
 * SAYS HOW THE TWO WERE COMPARED, because 「不同」 alone invites the
 * wrong reading of the commonest case. The comparison is exact and over
 * the strings as recorded: the shared fixture holds 「5 个重复单元」
 * against a report reading 「5」, one measurement written two ways, and
 * a bare 「与档案里这个值不同」 over that pair tells a registry the
 * laboratory and the archive disagree about a repeat count. Loosening
 * the comparison instead would be worse — it is the direction in which
 * 5 and 15 become the same reading — so the export states the rule and
 * hands the receiver both strings.
 */
const geneticValueReportDiffersTailZh = (reading: string, laboratory: boolean) =>
  `${GENETIC_EVIDENCE_READ_SCOPE_ZH}；那一份的这一项是「${reading}」，与档案里这个值不完全一致（本平台按两边记录的原样逐字比对，不做单位换算或写法归一），所以档案里这一份不是那次读取的结果。它当初如何进入档案，本平台没有留下记录，来源无法确定。${transcriptionNoteZh(laboratory)}`;

/**
 * The provenance sentence for one genetic baseline value, marker
 * folded in.
 *
 * Goes through `withOriginNote` like every other provenance string, and
 * passes `whenMarkedZh` because EVERY branch contradicts a marker: one
 * offers the patient as a possible author, one attributes the value to
 * a report, and the rest say no record exists of how it arrived.
 */
export const geneticValueProvenanceZh = (
  source: NormalisedSource,
  field: GeneticBaselineField,
): string => {
  const spec = GENETIC_BASELINE_VALUE_ORIGINS[field];
  const printed = spec.archived(source);
  const { documentId, laboratory, values } = source.geneticEvidenceReading;
  const reading = values[field];
  // The order below only ever decides between the states a RENDERED
  // value can be in. A null `printed` beside a live reading is not
  // reachable through the service — `getProfileByUserId` runs the
  // autofill before this module sees the baseline, so a report's
  // reading is already sitting in the slot — and `textItem` drops an
  // item with no value, so no sentence is shown for it either way.
  //
  // The reading is consulted for every field, and the three states it
  // can be in are the three tails. Reading it on one branch and
  // discarding it on the other is what left D4Z4 with a single sentence
  // for three different states.
  const tail =
    reading === null
      ? documentId === null
        ? GENETIC_VALUE_NO_EVIDENCE_REPORT_TAIL_ZH
        : GENETIC_VALUE_EVIDENCE_SILENT_TAIL_ZH
      : reading === printed
        ? geneticValueMatchesEvidenceTailZh(laboratory)
        : geneticValueReportDiffersTailZh(reading, laboratory);
  const base = `${spec.locationZh(source)}。${spec.storeClauseZh(source)}${tail}`;
  const markerPath = spec.markerPath(source);
  // No marker is about this value, so no marker is folded in. The store
  // clause is what says so — it names the store the value sits in and
  // states that the marker block does not cover it, which is a claim a
  // reader can check against `fieldOrigins` rather than infer from an
  // absence.
  if (!markerPath) return base;
  // The marked sentence keeps the location and drops everything after
  // it — including 分型's own longer location, which says which string
  // the exported value was classified from and stays true of an
  // administrator's entry.
  return withOriginNote(source, markerPath, base, spec.locationZh(source));
};

/**
 * ONE ARCHIVED GENETIC RESULT, TOGETHER WITH WHETHER THIS PLATFORM
 * READS IT AS ONE.
 *
 * THE FAILURE THIS SHAPE PREVENTS. These items used to be the archived
 * string and nothing else, in a field a registry ingests as this
 * patient's genotype. A 4q 单倍型 whose cell reads 「4qA/4qB」 went out
 * as that patient's haplotype; so did 「未检出」, and so did a D4Z4
 * 重复单元数 of 「1-10」. Every one of those is a string this platform's
 * own parser refuses to read as a result — the passport prints them
 * with 报告读取 in a bracket and grades the profile as having no
 * confirmatory reading — so the export was handing a receiver prose
 * under a key it maps as data, and doing it in the one direction that
 * cannot be caught downstream: 「未检出」 ingested as a genotype is
 * indistinguishable from a real allele name.
 *
 * SO THE STRING STAYS AND THE CLAIM GOES. `recordedZh` is the archive's
 * own line, verbatim, unnormalised — the Phenopacket export tells its
 * receiver these readings appear here 「按其本来面目」 and that has to
 * stay true — and `reading` is the only part of this value a receiver
 * may map as a result.
 *
 * THE READING IS THE PASSPORT'S, NOT A SECOND ONE. `reading` is
 * `result` only when the archived line IS the line this platform read
 * off the profile's genetic evidence AND that read produced a result.
 * The two halves are separate on purpose:
 *
 *   `no_result` — read, and not a result: a probe list, a 未检出, an
 *     interval, a length the report wrote in kb. `GENETIC_RESULT_ITEMS`
 *     is where that is decided. This is a statement about that string.
 *   `not_read` — the archive holds something this platform has not
 *     read: no evidence document supplied it, or the one that did says
 *     something else. It is NOT a statement about the string, and
 *     merging it into `no_result` would make one — over, for instance,
 *     a repeat count a patient typed into their own registration form,
 *     which this platform has no report for and no quarrel with.
 *     `provenanceZh` beside the item says which of those two it is.
 *
 * 甲基化 IS NOT IN HERE, and its absence is not an oversight: no gate
 * on this platform reads it and no parser refuses it, so there is no
 * reading to report and the archived string is the whole of what is
 * known. A `reading` invented for it would be this module answering a
 * question nothing else asks.
 */
/**
 * WHAT THE GUIDELINE SAYS ABOUT THE NUMBER, once the number is a
 * result — carried beside `reading` because `reading` answers 「may a
 * receiver map this as a result」 and this answers 「what does the
 * result mean」, and only one of those two questions had an answer in
 * these documents.
 *
 * THE DEFECT THIS CLOSES. The 8–10 unit gray zone was computed on the
 * clinical passport summary the exports are built from, and reached
 * the passport DTO, the markdown export, the share page, the mobile
 * PDF and the referral pack — every surface a patient or their own
 * clinician reads — and reached NEITHER portable export. So the two
 * artefacts that go to a registry and to a trial site, the two readers
 * who can actually ACT on 「this result carries its own uncertainty」,
 * received the bare integer 9 under 「D4Z4 重复单元数」 with nothing
 * beside it, while the patient's own phone showed the qualifier. One
 * profile, one run, and the reader best placed to act was the only one
 * not told.
 *
 * `kind` IS THE PART A REGISTRY MAPS. `noteZh` is the patient-facing
 * sentence and a registry ingesting Chinese prose is a registry that
 * drops it; a stable key is what lets a trial site filter on the zone
 * without reading a word of it. The two are emitted together so the
 * human reading the same document sees why.
 *
 * NOT RE-DERIVED HERE. `kind` and `noteZh` are the passport's own
 * `record.greyZone` and `geneticEvidence.greyZoneNote`, carried the way
 * `isAResult` carries `isDeterminateRepeatCount`. A second reading of
 * the same cell written in this module is how a registry comes to
 * receive a classification the patient's own page does not print — and
 * the zone in particular is a classification of a 4qA array read off a
 * LABORATORY's report, three conditions this module has no business
 * re-checking.
 */
export type SerialisedGeneticQualifier = {
  readonly kind: 'grey_zone_8_10';
  readonly noteZh: string;
};

/* A `type` and not an `interface`, so it stays assignable to the
 * TREAT-NMD document's own value union — an interface has no implicit
 * index signature and would have to be listed there by name. */
export type SerialisedGeneticResult = {
  /** The archived line, verbatim. */
  readonly recordedZh: string;
  readonly reading: 'result' | 'no_result' | 'not_read';
  /** The same answer in the language the rest of this document is in. */
  readonly readingZh: string;
  /**
   * What the guideline says about this result, or null when it says
   * nothing about it. See `SerialisedGeneticQualifier`.
   *
   * NULL WHENEVER `reading` IS NOT `result`, and that is not tidiness.
   * The zone flag is the passport's classification of the cell on the
   * evidence REPORT; `not_read` means the archived line is a different
   * string, and hanging a guideline's verdict off a line this document
   * has just said it never read would attribute the verdict to the
   * wrong number.
   */
  readonly qualifier: SerialisedGeneticQualifier | null;
};

const GENETIC_RESULT_READING_LABELS_ZH: Record<SerialisedGeneticResult['reading'], string> = {
  result: '本平台把档案里这一行读作这一项的检测结果',
  no_result:
    '档案里这一行就是本平台从这份档案的基因证据上读到的那一行，但本平台从它读不出这一项的结果',
  not_read: '本平台没有读过档案里这一行：它不是本平台从这份档案的基因证据上读到的那一行',
};

/**
 * Which of the two items this shape covers, and what answers it for
 * each — both answers taken off `geneticEvidenceRecord`, which is the
 * passport's own read.
 *
 * NEITHER ANSWER IS WRITTEN HERE. `isDeterminateRepeatCount` is the
 * passport's own rule for the repeat-count cell, and
 * `permissiveHaplotype` is the passport's own verdict on the haplotype
 * cell — true only for an unambiguous 4qA, false only for an
 * unambiguous 4qB, null for a missing cell and for one naming the
 * probes. A predicate of this module's own would be a second reading of
 * a cell the passport has already read, which is how a registry comes
 * to receive a genotype the patient's own page does not print.
 *
 * AND THE HAPLOTYPE IS NOT ROUTED THROUGH `haplotypeDetermined`, which
 * is the same expression over the same field and a DIFFERENT QUESTION:
 * it asks 「is this report missing an item」, to decide what the passport
 * still owes a patient to go and ask a laboratory for. They agree
 * today. They must not be wired together, because the day an ambiguous
 * cell comes to count as 「the item is present, take it up with the
 * laboratory」 is not the day it becomes a genotype a registry may
 * ingest — that is the shape of the defect this whole table exists to
 * close, one predicate standing in for a question it was not written
 * to answer.
 *
 * THE REPEAT COUNT ASKED 「does the cell parse to a number」 FOR ONE
 * ROUND, which is not that rule. A cell the report wrote in kb parses,
 * and so does a 0 — so a length the passport prints and judges by
 * nothing went out as this patient's D4Z4 重复单元数, and so did a
 * reading the passport flags for a clinician to check against the
 * original. See `isDeterminateRepeatCount` for why neither is a count.
 *
 * `isAResult` HAS TWO CALLERS AND ONE ANSWER. `geneticResultValue`
 * asks it about the line in the archive, for the TREAT-NMD item;
 * `collectReportFields` asks it about the same cell on the evidence
 * report, for `ReportField.readsAsResult`. Both readings are this one,
 * so the two documents built from one profile in one run cannot say
 * different things about one cell.
 */
const GENETIC_RESULT_ITEMS: Record<
  'd4z4' | 'haplotype',
  {
    readonly evidenceLineZh: (record: PassportGeneticRecordDTO) => string | null;
    readonly isAResult: (record: PassportGeneticRecordDTO) => boolean;
    /**
     * The guideline's own qualifier on this item's result, read off the
     * passport, on the same terms as `isAResult`.
     *
     * TWO CALLERS AND ONE ANSWER, again. `geneticResultValue` asks it
     * for the TREAT-NMD item; `collectReportFields` asks it for the
     * FHIR Observation built off the same cell. A qualifier written
     * twice is two documents from one run disagreeing about whether
     * this patient's number is borderline.
     *
     * 单倍型 HAS NONE, and that is not an oversight: 4qA and 4qB are the
     * two answers and neither is borderline. The zone is a statement
     * about a repeat COUNT.
     */
    readonly qualifier: (
      record: PassportGeneticRecordDTO,
      greyZoneNoteZh: string | null,
    ) => SerialisedGeneticQualifier | null;
  }
> = {
  d4z4: {
    evidenceLineZh: (record) => record.d4z4?.raw ?? null,
    isAResult: (record) => isDeterminateRepeatCount(record.d4z4),
    // Both halves required. The flag is the passport's gate and the
    // sentence is the passport's copy for it; emitting a `kind` with an
    // invented sentence, or a sentence with no key to filter on, is
    // each half of the thing this qualifier exists to carry.
    qualifier: (record, greyZoneNoteZh) =>
      record.greyZone && greyZoneNoteZh !== null
        ? { kind: 'grey_zone_8_10', noteZh: greyZoneNoteZh }
        : null,
  },
  haplotype: {
    evidenceLineZh: (record) => record.haplotype,
    isAResult: (record) => record.permissiveHaplotype !== null,
    qualifier: () => null,
  },
};

/**
 * EVERYTHING THIS PLATFORM HAS TO SAY ABOUT ONE GENETIC CELL ON THE
 * EVIDENCE DOCUMENT, for the reader that is building a resource out of
 * it rather than an item out of the archive.
 *
 * `GENETIC_RESULT_ITEMS` above is keyed by the two items that have an
 * ARCHIVE line to compare a reading against. This is keyed by the CELL,
 * and there are four of them: the two above plus the EcoRI fragment and
 * 甲基化, neither of which has a baseline slot the autofill could ever
 * fill — the questionnaire draws no box for either, so neither can
 * reach the archive at all, so neither can reach the TREAT-NMD item
 * table that reads the archive. That is why they were missing
 * everywhere and not only from one document.
 */
interface GeneticCellSpec {
  /** The passport's own answer to 「may a receiver map this cell as this
   *  item's result」, or null where nothing here reads the cell at all.
   *  See `ReportField.readsAsResult`. */
  readonly readsAsResult: (record: PassportGeneticRecordDTO) => boolean | null;
  readonly qualifier: (
    record: PassportGeneticRecordDTO,
    greyZoneNoteZh: string | null,
  ) => SerialisedGeneticQualifier | null;
  /** See `ReportField.notJudgedZh`. Null for a cell this platform does
   *  judge — both of the `GENETIC_RESULT_ITEMS` cells are judged, and a
   *  refusal printed beside a graded number would be false. */
  readonly notJudgedZh: string | null;
}

/** The cell spec for an item `GENETIC_RESULT_ITEMS` answers for.
 *  Delegates rather than restating, so `ReportField.readsAsResult` and
 *  the TREAT-NMD item's `reading` stay one answer — see the note on
 *  `isAResult` about its two callers. */
const geneticResultCell = (item: 'd4z4' | 'haplotype'): GeneticCellSpec => ({
  readsAsResult: (record) => GENETIC_RESULT_ITEMS[item].isAResult(record),
  qualifier: (record, greyZoneNoteZh) =>
    GENETIC_RESULT_ITEMS[item].qualifier(record, greyZoneNoteZh),
  notJudgedZh: null,
});

/** The value for one such item, or null when the archive holds nothing
 *  — which is the drop, not a `reading` of its own: there is no line to
 *  report a reading of. */
export const geneticResultValue = (
  source: NormalisedSource,
  field: 'd4z4' | 'haplotype',
): SerialisedGeneticResult | null => {
  const recordedZh = GENETIC_BASELINE_VALUE_ORIGINS[field].archived(source);
  if (recordedZh === null) return null;
  const spec = GENETIC_RESULT_ITEMS[field];
  const record = source.geneticEvidenceRecord;
  const reading: SerialisedGeneticResult['reading'] =
    recordedZh !== spec.evidenceLineZh(record)
      ? 'not_read'
      : spec.isAResult(record)
        ? 'result'
        : 'no_result';
  return {
    recordedZh,
    reading,
    readingZh: GENETIC_RESULT_READING_LABELS_ZH[reading],
    qualifier: reading === 'result' ? spec.qualifier(record, source.geneticGreyZoneNoteZh) : null,
  };
};

/**
 * THE SAME CELL AS THE EVIDENCE DOCUMENT STATES IT — the value every
 * clinical surface prints, in a FIELD rather than in a paragraph.
 *
 * WHY THIS EXISTS. `geneticResultValue` above serialises the ARCHIVE's
 * line. Where the archive and the evidence document disagree it says so
 * — `reading: 'not_read'` — and the provenance sentence prints the
 * document's string. But a registry ingests `diagnosis.d4z4` as this
 * patient's repeat count and `diagnosis.haplotype` as this patient's
 * genotype, and neither the enum nor the Chinese paragraph is a field
 * it can index. So over the ordinary profile whose questionnaire was
 * answered before the report was uploaded — `applyGeneticReportAutofill`
 * fills an EMPTY slot and never corrects a full one — the registry
 * filed the questionnaire's answer while the patient's own passport,
 * markdown export, share page and referral pack all printed the
 * laboratory's.
 *
 * Rendered against one synthetic profile (报告 D4Z4 9 / 4qA / 甲基化
 * 指数 0.31, 问卷 5 个重复单元 / 4qB / 甲基化水平 32%): the passport DTO,
 * the markdown export, the share page, the referral pack and the FHIR
 * Observations carried the report's three values; the TREAT-NMD
 * document carried the questionnaire's three, and 4qB is the allele
 * that argues AGAINST the diagnosis the same document asserts.
 *
 * THE GREY ZONE WENT WITH IT. `SerialisedGeneticResult.qualifier` is
 * null whenever `reading` is not `result`, which is correct — the
 * guideline's verdict belongs to the number the passport graded, not to
 * a different string — but the effect was that the one 8–10 flag a
 * trial site can filter on reached the FHIR bundle and NOT the registry
 * document, in exactly the disagreement case. It is carried here, on
 * the value it is actually about.
 *
 * NOT A SECOND READING. `evidenceLineZh`, `isAResult` and `qualifier`
 * are `GENETIC_RESULT_ITEMS`' — the same three answers
 * `collectReportFields` asks for the FHIR Observation and the same
 * record the passport printed. A predicate of this function's own is
 * how a registry would come to receive a genotype the patient's page
 * does not print.
 *
 * NULL WHEN THE DOCUMENT STATES NOTHING, which is the drop: an item
 * here would assert 「we asked the report and it answered nothing」 in a
 * slot a receiver reads as a result. The archive item's own provenance
 * sentence says so in words.
 */
export type SerialisedGeneticEvidenceResult = {
  /** The evidence document's line for this cell, as it printed it. */
  readonly statedZh: string;
  /** The passport's answer to 「may a receiver map this as a result」. */
  readonly readsAsResult: boolean;
  readonly readingZh: string;
  readonly qualifier: SerialisedGeneticQualifier | null;
};

const GENETIC_EVIDENCE_READING_LABELS_ZH: Record<'result' | 'no_result', string> = {
  result: '本平台把这份档案基因证据上的这一行读作这一项的检测结果',
  no_result: '本平台从这份档案基因证据上的这一行读不出这一项的结果',
};

export const geneticEvidenceResultValue = (
  source: NormalisedSource,
  field: 'd4z4' | 'haplotype',
): SerialisedGeneticEvidenceResult | null => {
  const spec = GENETIC_RESULT_ITEMS[field];
  const record = source.geneticEvidenceRecord;
  const statedZh = spec.evidenceLineZh(record);
  if (statedZh === null) return null;
  const readsAsResult = spec.isAResult(record);
  return {
    statedZh,
    readsAsResult,
    readingZh: GENETIC_EVIDENCE_READING_LABELS_ZH[readsAsResult ? 'result' : 'no_result'],
    qualifier: readsAsResult ? spec.qualifier(record, source.geneticGreyZoneNoteZh) : null,
  };
};

/**
 * The provenance sentence for one of those siblings.
 *
 * IT NAMES NO CORROBORATING SURFACE, and `diagnosisTypeSourceZh` —
 * which does name four — is why the difference is deliberate rather
 * than an omission. That list is a CHECKED list: 分型 really is printed
 * on the passport, the markdown export, the share page and the referral
 * pack, and provenance-surface-claims.test.ts re-renders all four every
 * run. Rendering the same four for these three cells: D4Z4 and 甲基化
 * appear on all of them; 4q 单倍型 appears on NONE of them as a row of
 * its own — `readBaselineDiseaseBackground` in profile.passport.ts says
 * so in as many words (「nothing on the passport family renders a
 * 单倍型 value」), and the string reaches a human only inside the joined
 * 基因证据 line. A shared sentence naming four surfaces would therefore
 * be false for one of the three, which is the anaesthesia-card defect
 * again; a per-field list is a claim that goes stale the next time a
 * row moves. What every branch below states instead is checkable from
 * this document alone: which document the value was read off, and what
 * the archive holds beside it.
 */
export const geneticCellSourceZh = (
  source: NormalisedSource,
  field: GeneticBaselineField,
  archiveItemKey: string,
): string => {
  const reading = source.geneticEvidenceReading.values[field];
  const archived = GENETIC_BASELINE_VALUE_ORIGINS[field].archived(source);
  const head = `本条目的值直接读自这份档案的基因证据文件：${GENETIC_EVIDENCE_READ_SCOPE_ZH}。`;
  if (archived === null) return `${head}档案里没有另外记录这一项。`;
  if (archived === reading) return `${head}档案里记录的这一项与它逐字相同。`;
  return `${head}档案里另外记录着「${archived}」，与那一份上写的不一致（本平台按两边记录的原样逐字比对，不做单位换算或写法归一）。本平台在读取档案时只会用那一份的解析结果补上档案里空着的栏位，不会改写已经填着的栏位，所以一份先填问卷、后上传报告的档案会一直留着旧答案 —— 这不是错误状态，本文件也不据此判断哪一个对。档案里那个值原样出现在本导出的 ${archiveItemKey} 上，连同它自己的来源说明。`;
};

/**
 * WHY A LENGTH IN kb ON THIS DOCUMENT CHANGED NOTHING.
 *
 * The passport writes this refusal for the reader of a page (see
 * `KB_LENGTH_NOT_JUDGED_ZH` in profile.passport.ts, whose sentence
 * names the lengths and reaches the four human-facing surfaces through
 * `geneticEvidence.readingsNotJudged`). This is the same refusal in the
 * export register, and it is written here rather than taken off that
 * DTO field for a reason that is checkable by running the builder: the
 * passport composes that sentence only when the grade WITHHELD
 * something, so a report that earns 可用于入组 while also stating an
 * EcoRI fragment prints the kb number on every surface with
 * `readingsNotJudged` null. An Observation is not a paragraph on a
 * graded page — it carries one cell and travels alone — so the cell's
 * caveat has to be as unconditional as the cell.
 *
 * IT STATES NO BOUNDARY, and states that there is none. The two kb
 * statements this repository carries — 「单个 D4Z4 单元长 3.3 kb」 and the
 * guideline's 「10–20 kb or 1–4 repeats」 — do not agree as a conversion,
 * so there is no kb threshold to derive and none is derived here. It
 * also says what the number is NOT, because the failure mode is a
 * receiver filing a fragment size under a repeat count: the two are
 * different measurements and only one of them has a guideline written
 * against it.
 */
export const ECORI_FRAGMENT_NOT_JUDGED_ZH =
  '这是报告上以 kb 写的片段长度，本文件照原样给出，但本平台没有对它作任何判断：指南给出的界限是按 D4Z4 重复单元数写的，本仓库内没有可核对的 kb 界限，本平台也不在 kb 和重复单元数之间做换算。它不参与本平台对这份报告的任何判定，接收方也不要把它当作 D4Z4 重复单元数导入 —— 那是另一项测量。';

/**
 * …and the same refusal for 甲基化, which is refused for a different
 * reason and therefore gets its own sentence rather than a shared one.
 *
 * THE ECORI CELL HAS NO BOUNDARY THIS PLATFORM COULD DERIVE. 甲基化 HAS
 * NO READING AT ALL: no gate on this platform consumes it, no parser
 * here refuses it, and `GENETIC_RESULT_ITEMS` deliberately has no entry
 * for it — so 「本平台读不出结果」 would be false and 「结果正常/异常」
 * would be this document grading a value nothing else here grades. What
 * is true is that the archived string is the whole of what is known.
 *
 * THE GUIDELINE CLAUSE IS QUOTED AND NOT APPLIED. It is the reason this
 * reading is worth carrying at all — it is the FSHD2 discriminator, and
 * the profile where it matters most is a repeat count above 10, which
 * is the profile whose own passport tells the patient to go and have
 * this analysis done. Quoting the instruction is not grading the value,
 * and the sentence says who does.
 */
export const METHYLATION_NOT_JUDGED_ZH =
  '这是报告上的 D4Z4 甲基化读数，本文件照原样给出。本平台对甲基化没有任何判读界限：没有门槛读它，也没有解析器判断它是不是一项结果，所以本平台既不说它正常也不说它异常，它不参与这份档案的任何判定。指南写明：重复单元数大于 10 而临床仍高度怀疑时，需加做 D4Z4 甲基化分析与 SMCHD1 测序以评估 FSHD2 —— 这一条要由医生看着报告原件说，本平台只负责把这个数字原样带到这里。';

/**
 * 确诊年份, WHICH IS THE SAME QUESTION IN A DIFFERENT SHAPE.
 *
 * It sat beside the genetic three with 「档案中的确诊年份；该栏位缺失时
 * 回退到确诊日期的年份部分」 — where the value sits, and nothing about
 * what could have put it there — while they each stated whether this
 * platform's own reading supports the archived value. The autofill
 * fills `foundation.diagnosisYear` from the evidence report's 诊断日期,
 * at read time, leaving no record, exactly as it fills the other four.
 *
 * WHY THIS IS NOT `geneticValueProvenanceZh` WITH A FIFTH ENTRY. That
 * function concludes from an exact string comparison, and the two
 * strings here are not the same shape: the export prints a YEAR and the
 * report states a DATE. 「与档案里这个值不完全一致，所以档案里这一份不是
 * 那次读取的结果」 over 2014 against 2014-03-02 is a false conclusion
 * drawn from a true comparison, and loosening the comparison for one
 * caller would loosen it for the four that need it exact. So this
 * sentence prints the report's date and draws no conclusion from
 * comparing them — the receiver has both, and 「本平台没有留下记录」
 * holds whether they agree or not.
 */
const DIAGNOSIS_YEAR_RULE_ZH = '档案中的确诊年份；该栏位缺失时回退到确诊日期的年份部分';

/**
 * WHERE THE YEAR ON THE PAGE ACTUALLY CAME FROM, which is not the same
 * sentence as the rule above.
 *
 * `DIAGNOSIS_YEAR_RULE_ZH` states the fallback chain and stops, and
 * everything that followed it described the FIRST link: the
 * questionnaire draws a box for that slot, the autofill tops that slot
 * up, so the platform cannot tell the two apart. The decoder prefers
 * that slot and only falls back — so whenever the fallback answered,
 * the slot it describes is EMPTY, and 「区分不了」 was this export
 * declining to state something it knows. A registry reading two
 * profiles could not tell 「the patient answered the question」 from
 * 「nobody ever answered it and we took the year off a date column」.
 *
 * So each store opens with where the printed year sits, and the rule
 * itself is kept for the answers that are not a year: 记不清了 and
 * 未采集 have no store and no author, only a rule that was applied to
 * nothing.
 */
const DIAGNOSIS_YEAR_LOCATION_ZH: Record<DiagnosisYearStore, string> = {
  baseline: '档案中基线问卷的确诊年份栏位',
  profileColumn:
    '基线问卷的确诊年份栏位是空的，本次导出的年份取自患者档案主记录上的确诊日期的年份部分',
};

const DIAGNOSIS_YEAR_BOX_CLAUSE_ZH =
  '基线问卷为这一项提供输入框；同时本平台在读取档案时会用这份档案基因证据上的诊断日期补上档案里空着的这一项，不留记录，而问卷的输入框预填的正是读取到的档案值，保存时一并写回。';

/**
 * …and the same, for the year that came off `patient_profiles
 * .diagnosis_date` instead.
 *
 * NAMES WHAT THE EMPTY SLOT RULES OUT. `upsertBaseline` writes that
 * column from `foundation.diagnosisYear` on every save AND on every
 * clear, so a standing baseline answer cannot leave the slot empty and
 * the column full — which is why this branch can say the year is not a
 * questionnaire answer at all, where the branch above can only say it
 * might be. What is left is the patient's own profile endpoint and the
 * read-time autofill, and nothing on record separates them.
 *
 * The marker block is not consulted on this branch and the clause says
 * so: `foundation.diagnosisYear` is admin-writable, its marker would
 * still be in the baseline, and it would be about the empty slot.
 */
const DIAGNOSIS_YEAR_PROFILE_COLUMN_CLAUSE_ZH =
  '基线问卷为确诊年份提供输入框，但这份档案的那一栏是空的；保存基线时那一栏会连同确诊日期一起写入或一起清空，所以本次导出的这个年份不是问卷里填的答案。确诊日期这一栏由患者自己的档案接口写入，本平台在读取档案时也会用这份档案基因证据上的诊断日期补上空着的它，不留记录。本导出的基线字段来源清单（fieldOrigins）说的是基线问卷的栏位，不覆盖这一栏。';

/** The read scope, plus the clause that puts 诊断日期 inside it — the
 *  shared constant enumerates the genetic results, and a receiver
 *  cannot be left to assume the date came off the same document.
 *
 *  Says 「那一份上面的」 rather than 「报告上的」: the document this
 *  platform reads as a profile's genetic evidence is not always a
 *  genetics report — `pickGeneticEvidenceDocument` takes a 病历摘要
 *  quoting the results when that is the only copy — and a sentence
 *  calling it one puts a laboratory behind a transcription. */
const DIAGNOSIS_DATE_READ_SCOPE_ZH = `${GENETIC_EVIDENCE_READ_SCOPE_ZH}，那一份上面的诊断日期同样只从它读取`;

const DIAGNOSIS_YEAR_EVIDENCE_SILENT_TAIL_ZH = `${DIAGNOSIS_DATE_READ_SCOPE_ZH}；那一份没有诊断日期。这不等于该患者手里没有写着确诊时间的报告。这个年份当初如何进入档案，本平台没有留下记录，来源无法确定。`;

/**
 * The four-digit year inside a 诊断日期 as the evidence document
 * printed it, or null when no year can be read out of it.
 *
 * DELIBERATELY CONSERVATIVE. It is used for ONE comparison — 「could the
 * exported year have come off this document's date」 — and a wrong
 * answer in the permissive direction re-creates the defect the
 * comparison exists to close. A cell this cannot read a year out of
 * yields null and the sentence says it made no comparison, rather than
 * guessing.
 */
const YEAR_IN_DATE = /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/;
const documentDiagnosisYear = (reading: string): number | null => {
  const match = YEAR_IN_DATE.exec(reading);
  return match ? Number(match[1]) : null;
};

/**
 * …and the evidence document states a 诊断日期.
 *
 * TWO QUESTIONS, AND ONLY ONE OF THEM WAS ASKED. The store decides
 * WHICH AUTHORS are possible — the 问卷 arm offers the patient's box and
 * the autofill, the column arm offers the profile endpoint and the
 * autofill, see `DIAGNOSIS_YEAR_PROFILE_COLUMN_CLAUSE_ZH`. Whether the
 * autofill is possible AT ALL is a different question, and this
 * sentence used to answer it 「yes」 unconditionally.
 *
 * THE DEFECT THAT LEFT. `applyGeneticReportAutofill` writes
 * `foundation.diagnosisYear` from the year of
 * `profile.diagnosisDate ?? 那一份的诊断日期`, and only into an EMPTY
 * slot. So over a profile whose questionnaire says 2014 and whose
 * evidence document states 2019-05-03 — the same 先填问卷、后传报告 shape
 * the genetic cells have — the exported year is 2014 and the sentence
 * beside it read 「那一份的诊断日期是「2019-05-03」，本平台取其中的年份。
 * 所以这个年份是患者在问卷里填的，还是某一次读取用那个日期补上的，本平台
 * 没有留下记录，区分不了。」 Both halves are false of that pair: this
 * platform did NOT take the year out of that date, and no read could
 * have produced 2014 from it. A registry reading it is told a 2014 it
 * received may have come off a document it can see is dated 2019.
 *
 * SO THE YEARS ARE COMPARED, on the same terms the genetic sentences
 * compare their strings: the comparison is stated, and where the two
 * disagree the receiver gets both numbers and 来源无法确定 rather than a
 * possibility that is arithmetically closed.
 */
const diagnosisYearFromReportTailZh = (
  reading: string,
  laboratory: boolean,
  store: DiagnosisYearStore,
  exportedYear: number,
) => {
  const documentYear = documentDiagnosisYear(reading);
  const head = `${DIAGNOSIS_DATE_READ_SCOPE_ZH}；那一份的诊断日期是「${reading}」`;
  if (documentYear === null) {
    return `${head}，本平台没有从这个写法里读出可比对的年份，所以不能说本次导出的年份是不是取自它。这个年份当初如何进入档案，本平台没有留下记录，来源无法确定。${transcriptionNoteZh(laboratory)}`;
  }
  if (documentYear !== exportedYear) {
    return `${head}，其中的年份是 ${documentYear}，与本次导出的 ${exportedYear} 不一致。读取档案时的自动补填只会在这一项空着时用那个日期的年份补上，不会改写已经填着的年份，所以本次导出的这个年份不可能取自那一份 —— 一份先填年份、后上传报告的档案会一直留着旧答案，这不是错误状态，本文件也不据此判断哪一个对。它当初如何进入档案，本平台没有留下记录，来源无法确定。${transcriptionNoteZh(laboratory)}`;
  }
  return `${head}，其中的年份与本次导出的年份相同。${
    store === 'baseline'
      ? '所以这个年份是患者在问卷里填的，还是某一次读取用那个日期补上的，本平台没有留下记录，区分不了。'
      : '所以这个确诊日期是患者自己在档案里填的，还是某一次读取用那个日期补上的，本平台没有留下记录，区分不了。'
  }${transcriptionNoteZh(laboratory)}`;
};

export const diagnosisYearProvenanceZh = (source: NormalisedSource): string => {
  // 记不清了 and 「never asked」 are answers about the question, not
  // values with an author: there is nothing for a report reading to
  // have supplied and nothing for the autofill to have written. Neither
  // names a store either, so what is printed is the rule, and the
  // marker still rides along — an administrator can write 记不清了 into
  // the slot that holds it.
  const store = source.diagnosisYearStore;
  const markerPath = diagnosisYearMarkerPath(source);
  if (source.diagnosisYear.kind !== 'year' || store === null) {
    return markerPath
      ? withOriginNote(source, markerPath, DIAGNOSIS_YEAR_RULE_ZH)
      : DIAGNOSIS_YEAR_RULE_ZH;
  }
  const locationZh = DIAGNOSIS_YEAR_LOCATION_ZH[store];
  const { documentId, laboratory, diagnosisDate } = source.geneticEvidenceReading;
  const tail =
    diagnosisDate === null
      ? documentId === null
        ? GENETIC_VALUE_NO_EVIDENCE_REPORT_TAIL_ZH
        : DIAGNOSIS_YEAR_EVIDENCE_SILENT_TAIL_ZH
      : diagnosisYearFromReportTailZh(diagnosisDate, laboratory, store, source.diagnosisYear.year);
  const clauseZh =
    store === 'baseline' ? DIAGNOSIS_YEAR_BOX_CLAUSE_ZH : DIAGNOSIS_YEAR_PROFILE_COLUMN_CLAUSE_ZH;
  const base = `${locationZh}。${clauseZh}${tail}`;
  // The marker is about `foundation.diagnosisYear`. On the column
  // branch that slot is empty and holds a different value from the one
  // printed, so no marker describes this year and none is folded in —
  // the clause above is where the reader is told the block does not
  // cover it.
  if (!markerPath) return base;
  return withOriginNote(source, markerPath, base, locationZh);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const section = (baseline: Record<string, unknown> | null, key: string) => {
  const raw = baseline?.[key];
  return isRecord(raw) ? raw : null;
};

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/**
 * FSHD1 vs FSHD2 vs 「说不上是哪一型」.
 *
 * `unspecified` is a real answer here, not a fallback for missing
 * data. A large share of this population carries a clinical diagnosis
 * with no genetic subtype ever established, and the export has to be
 * able to say that rather than silently defaulting to FSHD1, which is
 * the common form and therefore the plausible-looking wrong answer.
 */
export const classifyDiagnosisType = (raw: string | null): FshdDiagnosisType => {
  if (!raw) return 'unspecified';
  const normalised = raw.replace(/\s|-|_/g, '').toUpperCase();
  // Check FSHD2 first: 「FSHD2」 contains 「FSHD」 and a naive FSHD1
  // test on a 2 would have to be ordered by luck.
  if (/FSHD2|2型|TYPE2|II型/.test(normalised) || normalised === '2') return 'FSHD2';
  if (/FSHD1|1型|TYPE1|I型/.test(normalised) || normalised === '1') return 'FSHD1';
  return 'unspecified';
};

const MILESTONE_EVENTS: Record<string, { kind: MilestoneEvent['kind']; labelZh: string }> = {
  started_wheelchair: { kind: 'wheelchair', labelZh: '开始使用轮椅' },
  started_niv: { kind: 'niv', labelZh: '开始使用无创通气（NIV）' },
  started_afo: { kind: 'afo', labelZh: '开始使用踝足矫形器（AFO）' },
};

const CHALLENGE_LABELS: Record<string, string> = {
  fatigue: '疲劳',
  pain: '疼痛',
  stairs: '上下楼梯',
  dressing: '穿衣',
  reachingUp: '上举手臂',
  walkingStability: '行走稳定性',
};

/**
 * OCR field aliases.
 *
 * The genetic entries take their keys from `GENETIC_FIELD_KEYS`, which
 * is the one table the passport reads from too. The laboratory and
 * pulmonary aliases below are still copied from profile.passport.ts
 * rather than shared, and until they are, what must NOT happen is this
 * file quietly recognising a KEY that the passport does not, so that
 * the anesthesia card and the registry export disagree about the same
 * report. Every alias below is copied, and nothing has been invented.
 *
 * `geneticCell` marks the entries that may be read ONLY off the
 * document `pickGeneticEvidenceDocument` names, and carries everything
 * this platform has to say about that cell. ONE member and not four:
 * the document rule, the reading, the guideline's qualifier and the
 * refusal to judge are all about the same cell, and flags that have to
 * move together are flags that can stop moving together. See
 * `collectReportFields`.
 *
 * WHAT WAS MISSING FROM THIS TABLE, AND WHAT IT COST. It had entries
 * for CK, myoglobin, LDH, CK-MB, FVC, TLC, DLCO, LVEF, QTc, the
 * serratus fat grade, D4Z4 重复数 and 单倍型 — and no entry for 甲基化 or
 * for the EcoRI fragment. Both readings are available, both are printed
 * on every human-facing surface, and the FHIR bundle builds its
 * Observations from this table, so both were dropped from it silently:
 * its omissions list declares other pipeline gaps and said nothing
 * about either.
 *
 *   甲基化 is the FSHD2 discriminator. The profile where it matters most
 *     is the one where it was dropped — a repeat count above 10, whose
 *     own passport grade tells the patient to go and add D4Z4 甲基化分析
 *     and SMCHD1 测序. TREAT-NMD emits the reading; the bundle did not.
 *   EcoRI 片段 is, for a report that states its length in kb and gives no
 *     repeat count, the ONLY size measurement the laboratory made. A
 *     registry receiving that bundle saw a patient with a 4qA haplotype
 *     and no D4Z4 size measurement of any kind — a different patient
 *     from the one the passport describes.
 *
 * NEITHER TRAVELS BARE. `notJudgedZh` is why: an export that emits a kb
 * length or a 甲基化 percentage with no caveat is worse than one that
 * omits it, because the number then looks like a result something here
 * weighed.
 */
/**
 * HOW `formatAggregateStrength` WRITES A MUSCLE'S GRADE, said out loud.
 *
 * The parser publishes one `muscle_strength` entry per muscle per side;
 * `embedded-report-ocr.ts` folds them into one cell as 「L4 / R3」, and
 * writes only 「4」 when the examiner graded the muscle without a side.
 * The 「L」/「R」 are this platform's, not the report's, and a receiver who
 * reads them in the other order has the weak side and the strong side
 * swapped. The grade text itself is the examiner's, including a range
 * (「4-5级」) or a modifier (「4+」) the parser declined to type.
 */
const MRC_SIDE_NOTATION_NOTE_ZH =
  '本条是本平台从上传的报告原文中解析出的徒手肌力（MRC）分级，0–5，5 为正常。左右写在同一个值里：「L」后面是左侧、「R」后面是右侧，用「 / 」隔开（例如「L4 / R3」表示左侧 4 级、右侧 3 级）；只有一个数字表示报告上没有分左右记。这个 L/R 写法是本平台的记法，不是报告上的原文。分级本身照报告原样给出，包括报告写成区间（如「4-5级」）或带正负号（如「4+」）的情况——本平台不把这类写法折算成一个数。';

const mrcReportSpec = (
  key: string,
  muscleGroup: keyof typeof MUSCLE_GROUP_LABELS | string,
): {
  keys: readonly string[];
  key: string;
  labelZh: string;
  category: ReportField['category'];
  codingKey: string | null;
  readingNoteZh: string;
} => ({
  key,
  // BOTH SPELLINGS, and the reason the list is not one string: the
  // camelCase key is what `embedded-report-ocr.ts` writes today and the
  // snake_case one is what archived payloads hold — the app's own
  // report table (apps/mobile/lib/report-insights.ts) reads the pair,
  // and an export that read only the current spelling would be blank
  // for exactly the patients whose reports are oldest.
  keys: [`${key}Strength`, `${key}_strength`],
  // The muscle name is taken from `MUSCLE_GROUP_LABELS` rather than
  // written out, so the muscle a receiver sees on a report-derived grade
  // and the muscle it sees on a questionnaire grade for the same body
  // part cannot differ.
  //
  // AND THE QUALIFIER IS LOAD-BEARING. Without it this label is
  // character-for-character the label the BASELINE measurement carries
  // (fhir-r4.ts writes `三角肌肌力（左侧）` off `profile.measurements`), and
  // they are two different facts about two different events: an examiner
  // grading a limb in clinic, transcribed off a report, versus the
  // patient grading themselves at home through this app. A bundle with
  // both, under one name, is a bundle a receiver merges into one series
  // — and the two do not even carry the same value type, one being a
  // `valueQuantity` of 4 and the other a `valueString` of 「L4 / R3」.
  //
  // It also keeps the coverage assertion honest: with a shared label,
  // 「the document contains 三角肌肌力」 was satisfied by the questionnaire
  // row for a document carrying none of the report readings at all. That
  // is the two-facts-one-name hole this directory has now been bitten by
  // three times (the falls diary, the two notes stores, and this).
  labelZh: `${labelFor(MUSCLE_GROUP_LABELS, muscleGroup)}肌力（报告上的记录）`,
  // `exam`, not `laboratory`: an examiner's hand on a limb is a
  // physical examination finding. This is the first spec to use the
  // value, and `ReportField['category']` has carried it since the type
  // was written.
  category: 'exam',
  // No ledger entry. MRC has no verified LOINC in codings.ts, and
  // codings.ts is the only place that question is allowed to be
  // answered — see the `CodeableConcept.coding (LOINC)` omission.
  codingKey: null,
  readingNoteZh: MRC_SIDE_NOTATION_NOTE_ZH,
});

const REPORT_FIELD_SPECS: ReadonlyArray<{
  keys: readonly string[];
  key: string;
  labelZh: string;
  category: ReportField['category'];
  codingKey: string | null;
  readingNoteZh?: string;
  geneticCell?: GeneticCellSpec;
  /**
   * A CLOSED WIRE ENUM, LOCALISED — the only cell here whose payload
   * value is not what a laboratory printed.
   *
   * The parser reads 「限制性通气功能障碍」 off a Chinese report and stores
   * `restrictive`. Exporting the stored token would put an English word
   * this platform invented into a registry under a Chinese label, and
   * beside a passport that prints the Chinese. The table is IMPORTED
   * from the passport rather than repeated, so the two renderings of
   * one payload cannot come apart.
   */
  valuesZh?: Record<string, string>;
}> = [
  {
    key: 'creatineKinase',
    keys: ['creatineKinase', 'creatine_kinase', 'CK', 'ck'],
    labelZh: '肌酸激酶（CK）',
    category: 'laboratory',
    codingKey: 'lab.creatineKinase',
  },
  {
    key: 'myoglobin',
    keys: ['myoglobin', 'Mb', 'mb'],
    labelZh: '肌红蛋白（Mb）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'ldh',
    keys: ['LDH', 'ldh'],
    labelZh: '乳酸脱氢酶（LDH）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'ckmb',
    keys: ['CKMB', 'ckmb'],
    labelZh: '肌酸激酶同工酶（CK-MB）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'fvcPercentPredicted',
    keys: ['fvcPredPct', 'fvc_pred_pct'],
    labelZh: '用力肺活量占预计值百分比（FVC%pred）',
    category: 'laboratory',
    codingKey: 'pft.fvcPercentPredicted',
  },
  {
    key: 'tlcPercentPredicted',
    keys: ['tlcPredPct', 'tlc_pred_pct'],
    labelZh: '肺总量占预计值百分比（TLC%pred）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'dlcoPercentPredicted',
    keys: ['dlcoPredPct', 'dlco_pred_pct'],
    labelZh: '一氧化碳弥散量占预计值百分比（DLCO%pred）',
    category: 'laboratory',
    codingKey: 'pft.dlco',
  },
  {
    key: 'lvef',
    keys: ['LVEF', 'lvef'],
    labelZh: '左心室射血分数（LVEF）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'qtc',
    keys: ['QTc', 'qtc', 'qtcMs', 'qtc_ms'],
    labelZh: 'QTc 间期',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'serratusFatGrade',
    keys: ['serratusFatigueGrade', 'serratus_fatigue_grade'],
    labelZh: '前锯肌脂肪化等级',
    category: 'imaging',
    codingKey: null,
  },
  /**
   * ══════════════════════════════════════════════════════════════════
   * THE SIXTEEN MONITORING CELLS THIS TABLE WAS A SUBSET OF.
   * ══════════════════════════════════════════════════════════════════
   *
   * WHAT WAS WRONG. `PASSPORT_MONITORING_PAYLOAD_KEYS` is every cell the
   * clinical passport's 血检指标 / 肺功能 / 心脏 rows can print. It holds
   * twenty-six; this table read nine of them. The other sixteen — the
   * whole 血常规 block (WBC / HGB / PLT), the whole 甲功 block (FT3 /
   * FT4 / TSH), the whole 凝血 block (PT / APTT / Fib / D-二聚体), 肌酐,
   * 尿酸, the ventilatory pattern, the diaphragm summary, and both
   * cardiac conclusions — were parsed by `fshd_report_service.py`,
   * printed on the app's own 检查结果 screen, printed in the passport
   * that goes into the referral pack and onto the share page a
   * clinician opens, and reached NO portable export. Nor were they
   * declared in one: `REPORT_READINGS_RULE_ZH` builds its 「本平台可解析
   * 的项目是这些」 sentence out of this table, so the sentence named
   * nineteen items and a receiver reading it concluded those were the
   * items. A flagged white cell count sitting in the archive, absent
   * from every registry document, with the document itself listing what
   * it could have carried and not listing it.
   *
   * That is the same defect as the five MRC grades below, one panel
   * wider, and it is the fifth round of it.
   *
   * WHY THE FOUR TEXT CELLS ARE HERE TOO. 通气模式, 膈肌运动, 心电结论 and
   * 心超结论 are conclusions rather than numbers, and the neighbouring
   * argument for excluding free text (`interpretationSummary`,
   * `reportImpression` in `PARSED_CELL_INVENTORY`) does not reach them:
   * those two are the report's whole narrative paragraph, while these
   * four are the value of a NAMED cell that the passport prints in a
   * named slot to a clinician. 「本平台没有承载心电结论」 and 「本平台不承载
   * 报告的结论段落」 are different statements and only the second one was
   * ever made.
   *
   * NO LEDGER ENTRY FOR ANY OF THEM. codings.ts holds five verified
   * codes and none of these is among them; inventing a LOINC here is
   * the thing that file exists to prevent. They travel under their
   * Chinese names, like 肌红蛋白 and LDH already do.
   */
  // 生化 / 肌酶, beyond the four this table already had.
  {
    key: 'creatinine',
    keys: ['creatinine'],
    labelZh: '肌酐（Cr）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'uricAcid',
    keys: ['uricAcid', 'uric_acid'],
    labelZh: '尿酸（UA）',
    category: 'laboratory',
    codingKey: null,
  },
  // 血常规. One spelling each, for the reason the passport's own list
  // gives: `_extract_blood_routine` writes all-lowercase analyte names
  // and an alias nothing can mint is a key advertised and never filled.
  {
    key: 'wbc',
    keys: ['wbc'],
    labelZh: '白细胞计数（WBC）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'hgb',
    keys: ['hgb'],
    labelZh: '血红蛋白（HGB）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'plt',
    keys: ['plt'],
    labelZh: '血小板计数（PLT）',
    category: 'laboratory',
    codingKey: null,
  },
  // 甲功
  {
    key: 'ft3',
    keys: ['ft3'],
    labelZh: '游离三碘甲状腺原氨酸（FT3）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'ft4',
    keys: ['ft4'],
    labelZh: '游离甲状腺素（FT4）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'tsh',
    keys: ['tsh'],
    labelZh: '促甲状腺激素（TSH）',
    category: 'laboratory',
    codingKey: null,
  },
  // 凝血. `d_dimer` is the one name here with an underscore in it, so it
  // is the one with a camel twin on the payload.
  {
    key: 'pt',
    keys: ['pt'],
    labelZh: '凝血酶原时间（PT）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'aptt',
    keys: ['aptt'],
    labelZh: '活化部分凝血活酶时间（APTT）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'fibrinogen',
    keys: ['fibrinogen'],
    labelZh: '纤维蛋白原（Fib）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'dDimer',
    keys: ['dDimer', 'd_dimer'],
    labelZh: 'D-二聚体',
    category: 'laboratory',
    codingKey: null,
  },
  // 肺功能, beyond the three percentages this table already had.
  {
    key: 'ventilatoryPattern',
    keys: ['ventilatoryPattern', 'ventilatory_pattern'],
    labelZh: '通气模式',
    category: 'laboratory',
    codingKey: null,
    valuesZh: VENTILATORY_PATTERN_ZH,
  },
  {
    key: 'diaphragmMotionSummary',
    keys: ['diaphragmMotionSummary', 'diaphragm_motion_summary'],
    labelZh: '膈肌运动',
    category: 'laboratory',
    codingKey: null,
  },
  // 心脏, beyond LVEF and QTc.
  {
    key: 'ecgSummary',
    keys: ['ecgSummary', 'ecg_summary'],
    labelZh: '心电图结论',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'echoSummary',
    keys: ['echoSummary', 'echo_summary'],
    labelZh: '心脏超声结论',
    category: 'laboratory',
    codingKey: null,
  },
  /**
   * THE MRC GRADES THE PARSER READS OFF A CLINICAL REPORT — five cells
   * that had NO ENTRY IN THIS TABLE AT ALL, in either spelling.
   *
   * `fshd_report_service.py` extracts one `muscle_strength` entry per
   * muscle per side off 体格检查 prose (「三角肌肌力左侧4级」), and
   * `embedded-report-ocr.ts` writes them into `ocrPayload.fields` as
   * `deltoidStrength` / `bicepsStrength` / `tricepsStrength` /
   * `quadricepsStrength` / `tibialisStrength`. The app PRINTS them: the
   * report-detail table in apps/mobile/lib/report-insights.ts has a row
   * for each, reading both spellings, and 平均肌力 is averaged from them.
   *
   * So the patient sees these grades on their own report page, and
   * before this entry existed not one of them reached ANY portable
   * export — `collectReportFields` only ever emits what this table
   * names, and this table named none of them. Not carried anywhere, and
   * not declared anywhere either: a neurologist reading a bundle whose
   * only strength data is the patient's at-home self-test had no way to
   * know an examiner's graded exam was sitting in the archive.
   *
   * `category: 'exam'` rather than `'laboratory'`, and the L/R notation
   * travels with the value — see `mrcReportSpec`.
   */
  mrcReportSpec('deltoid', 'deltoid'),
  mrcReportSpec('biceps', 'biceps'),
  mrcReportSpec('triceps', 'triceps'),
  mrcReportSpec('quadriceps', 'quadriceps'),
  mrcReportSpec('tibialis', 'tibialis'),
  {
    key: 'd4z4Repeats',
    keys: GENETIC_FIELD_KEYS.d4z4Repeats,
    labelZh: 'D4Z4 重复单元数',
    category: 'laboratory',
    codingKey: null,
    geneticCell: geneticResultCell('d4z4'),
  },
  {
    key: 'haplotype',
    keys: GENETIC_FIELD_KEYS.haplotype,
    labelZh: '4q 单倍型',
    category: 'laboratory',
    codingKey: null,
    geneticCell: geneticResultCell('haplotype'),
  },
  {
    key: 'ecoRIFragment',
    keys: GENETIC_FIELD_KEYS.ecoRIFragment,
    labelZh: 'EcoRI 片段',
    category: 'laboratory',
    codingKey: null,
    geneticCell: {
      // `readSizeCell` and not a presence test, and not a regular
      // expression of this module's own. The passport exports it for
      // exactly this caller — one holding a size cell as text — because
      // a negation carries a number: 「未检出10kb以下片段」 has a 10 in it,
      // and a bare 「the cell is non-empty」 would publish that string as
      // this patient's fragment size under a key a registry maps as one.
      // The value is withheld and the raw string still travels, in
      // `dataAbsentReason.text`, which is the same arrangement the two
      // items above already use.
      //
      // AND 「states a length」 IS THE WHOLE OF WHAT THIS ANSWERS. It does
      // not say the length means anything — see `notJudgedZh`, which
      // rides the same cell and says it does not.
      readsAsResult: (record) => readSizeCell(record.ecoRIFragment)?.value != null,
      // The 8–10 zone is a classification of a repeat COUNT on a 4qA
      // array. There is no guideline qualifier written against a kb
      // fragment in this repository, and this is not the place to
      // invent one.
      qualifier: () => null,
      notJudgedZh: ECORI_FRAGMENT_NOT_JUDGED_ZH,
    },
  },
  {
    key: 'methylation',
    keys: GENETIC_FIELD_KEYS.methylationValue,
    labelZh: '甲基化',
    category: 'laboratory',
    codingKey: null,
    geneticCell: {
      // NULL, WHICH IS 「NOTHING HERE READS THIS CELL」 AND NOT 「NOT YET
      // DECIDED」. `GENETIC_RESULT_ITEMS` deliberately has no 甲基化
      // entry: no gate on this platform consumes the value and no
      // parser here refuses it, so `false` would assert a refusal that
      // never happened and `true` would assert a reading. The value
      // still travels — `readsAsResult === false` is the only state
      // that withholds it — and `notJudgedZh` says what it is.
      readsAsResult: () => null,
      qualifier: () => null,
      notJudgedZh: METHYLATION_NOT_JUDGED_ZH,
    },
  },
];

/**
 * What this platform reads off the patient's genetic report for the
 * genetic baseline fields, right now, and which document that was.
 *
 * `readGeneticEvidence` names the one document that is this profile's
 * genetic evidence and reads the values off it — the same call the
 * baseline autofill makes before writing any of them into an empty
 * slot, and the same document the passport builds its diagnosis block
 * from. A second document-picking rule here is how this export would
 * come to disagree with the page the patient is looking at about which
 * report is 「the」 report, which is the class of defect the whole
 * module exists to prevent.
 *
 * Called ONCE per export, with the id handed to `collectReportFields`
 * rather than re-picked there: two calls cannot disagree today, and the
 * reason they cannot is that they are the same function — which is
 * exactly what the last four call sites had going for them.
 */
const readGeneticEvidenceForExport = (
  documents: readonly PatientDocumentDTO[],
): NormalisedSource['geneticEvidenceReading'] => {
  const reading = readGeneticEvidence(documents);
  return {
    documentId: reading.documentId,
    laboratory: reading.laboratory,
    values: {
      diagnosisType: reading.diagnosisType,
      d4z4: reading.d4z4,
      haplotype: reading.haplotype,
      methylation: reading.methylation,
    },
    diagnosisDate: reading.diagnosisDate,
  };
};

const documentFields = (document: PatientDocumentDTO): Record<string, unknown> | null => {
  const payload = document.ocrPayload;
  if (!isRecord(payload)) return null;
  const fields = payload.fields;
  return isRecord(fields) ? fields : null;
};

const collectReportFields = (
  documents: readonly PatientDocumentDTO[],
  geneticEvidenceReading: NormalisedSource['geneticEvidenceReading'],
  geneticEvidenceRecord: PassportGeneticRecordDTO,
  geneticGreyZoneNoteZh: string | null,
): ReportField[] => {
  const out: ReportField[] = [];
  // Newest first so a consumer taking the head of each key gets the
  // most recent reading; `documents` already arrives sorted by
  // uploaded_at DESC from getProfileByUserId, but this export must
  // not depend on a sibling query's ORDER BY staying put.
  const ordered = [...documents].sort(
    (a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt),
  );
  /**
   * A GENETIC reading is published off this document and no other.
   *
   * Every OTHER field here is a measurement with a time: two CK values
   * off two blood panels are two real results, and a receiver wants
   * both, each dated and each pointing at its own report. A repeat
   * count is not that. It is one assay's answer about this person, and
   * every clinical surface prints exactly one — so a bundle carrying a
   * second one off a 病历摘要 hands a registry a 4q 单倍型 the passport
   * does not print and the evidence grade was computed to be WITHOUT.
   * The id is the one `readGeneticEvidenceForExport` already named, and
   * it is the same answer the passport, the PDF, the referral pack and
   * the share page are built on.
   */
  ordered.forEach((document) => {
    const fields = documentFields(document);
    if (!fields) return;
    const reportTime = pickReading(fields, ['reportTime', 'report_time']);
    REPORT_FIELD_SPECS.forEach((spec) => {
      const cell = spec.geneticCell;
      if (cell !== undefined && document.id !== geneticEvidenceReading.documentId) {
        return;
      }
      // The whole reading, not the number: `pickReading` returns the
      // value and throws away which spelling answered, which leaves the
      // flag and the interval unreachable. See `ReportField.flag`.
      const reading = pickLabReading(fields, spec.keys);
      if (reading === undefined) return;
      // The stored token stands where the spec declares no vocabulary,
      // and a token OUTSIDE a declared vocabulary stands too rather than
      // being dropped: a pattern this platform's enum has no word for is
      // still what the report said, and blanking it would be this export
      // deciding the cell was empty. Same fallback the passport uses.
      const value = spec.valuesZh?.[reading.value] ?? reading.value;
      out.push({
        key: spec.key,
        labelZh: spec.labelZh,
        value,
        flag: reading.flag,
        referenceRange: reading.reference,
        documentId: document.id,
        documentType: document.documentType,
        // Whose page this reading is on, taken off the same read that
        // named the document rather than re-derived from its type here.
        // Only a genetic reading can be a transcription in this sense:
        // the other specs are measurements the document's own
        // laboratory made. See ReportField.transcribedGeneticReading.
        transcribedGeneticReading: cell !== undefined && !geneticEvidenceReading.laboratory,
        // Asked of the record the passport itself printed and graded,
        // and asked of the same cell: this field was read off the
        // document `pickGeneticEvidenceDocument` named, with the same
        // key list and the same reader that built the record. A second
        // parse here is how the bundle would come to publish a result
        // the passport does not.
        readsAsResult: cell?.readsAsResult(geneticEvidenceRecord) ?? null,
        // Gated on the reading above for the reason
        // `SerialisedGeneticResult.qualifier` is: the guideline's
        // verdict belongs to a result, and this resource declines to
        // publish a value at all when there is not one.
        geneticQualifier:
          cell?.readsAsResult(geneticEvidenceRecord) === true
            ? cell.qualifier(geneticEvidenceRecord, geneticGreyZoneNoteZh)
            : null,
        // Rides the cell rather than being decided per serialiser: the
        // three documents must not disagree about whether this number
        // was weighed, and two of them have no other place to say so.
        notJudgedZh: cell?.notJudgedZh ?? null,
        // Rides the spec for the reason `notJudgedZh` does: 「L4 / R3」
        // must not mean one thing in the FHIR bundle and another in the
        // TREAT-NMD document, and a per-serialiser gloss is how it would.
        readingNoteZh: spec.readingNoteZh ?? null,
        // The report's own stated time when OCR read one, else the
        // upload time — with the substitution recorded, not silent.
        // Every consumer of `observedAt` has to decide what to do
        // with the second case, and the flag is what lets it.
        observedAt: reportTime ?? document.uploadedAt,
        observedAtIsUploadTime: reportTime === null,
        category: spec.category,
        codingKey: spec.codingKey,
      });
    });
  });
  return out;
};

export const normaliseSource = (
  profile: PatientProfileDTO,
  options: ExportOptions,
): NormalisedSource => {
  const baseline = isRecord(profile.baseline) ? profile.baseline : null;
  const foundation = section(baseline, 'foundation');
  const disease = section(baseline, 'diseaseBackground');
  const status = section(baseline, 'currentStatus');
  const challenges = section(baseline, 'currentChallenges');

  // WHICH STORE, NOT JUST WHICH STRING. 分型 resolves out of the
  // baseline questionnaire's slot or out of
  // `patient_profiles.genetic_mutation`, and collapsing the two into
  // one string left every sentence downstream describing the first one
  // — including the marker lookup, which would then be about a slot
  // this document does not print. See NormalisedSource.diagnosisTypeStore.
  const diagnosisTypeFromBaseline = text(disease?.diagnosisType);
  const diagnosisTypeFromColumn = diagnosisTypeFromBaseline ? null : text(profile.geneticMutation);
  const diagnosisTypeRaw = diagnosisTypeFromBaseline ?? diagnosisTypeFromColumn;
  const diagnosisYear = decodeFirstYearFrom([
    // Explicit diagnosis YEAR first, then the year component of the
    // diagnosis DATE. The date is often back-filled from a report's
    // print date, so it is the weaker of the two.
    ['baseline', foundation?.diagnosisYear],
    ['profileColumn', profile.diagnosisDate],
  ] as const);

  const assistiveDevices = Array.isArray(status?.assistiveDevices)
    ? status.assistiveDevices.filter(
        (item): item is string => typeof item === 'string' && !!item.trim(),
      )
    : [];

  const milestones: MilestoneEvent[] = profile.followupEvents
    .filter((event) => event.eventType in MILESTONE_EVENTS)
    .map((event) => {
      const spec = MILESTONE_EVENTS[event.eventType];
      return {
        kind: spec.kind,
        labelZh: spec.labelZh,
        eventId: event.id,
        occurrence: resolveOccurrenceDate(event.occurredAt),
        descriptionZh: text(event.description),
      };
    });

  const geneticEvidenceReading = readGeneticEvidenceForExport(profile.documents);
  // ONE PASSPORT, READ ONCE. The confirmation state and the reading of
  // the evidence document's own cells are two answers off one build, and
  // building it twice is two chances for this export to describe a
  // passport the patient is not looking at.
  const passportDiagnosis = buildClinicalPassportSummary(profile).diagnosis;

  return {
    profile,
    options,
    diagnosisType: classifyDiagnosisType(diagnosisTypeRaw),
    diagnosisTypeRawZh: diagnosisTypeRaw,
    // THE PASSPORT'S CHAIN, NOT A SECOND ONE. `buildReportInsights`
    // resolves 分型 as `geneticRecord.geneticType || 基线 || 主记录列`,
    // and the tail of that chain is `diagnosisTypeRaw` two lines up.
    // The head is read off the record this same build produced, so the
    // ontology terms the two machine-readable exports assert and the
    // string the five clinical surfaces print cannot come apart.
    passportDiagnosisType: classifyDiagnosisType(
      passportDiagnosis.geneticEvidence.record.geneticType ?? diagnosisTypeRaw,
    ),
    passportDiagnosisTypeRawZh:
      passportDiagnosis.geneticEvidence.record.geneticType ?? diagnosisTypeRaw,
    diagnosisTypeStore: diagnosisTypeFromBaseline
      ? 'baseline'
      : diagnosisTypeFromColumn
        ? 'profile_column'
        : 'none',
    diagnosisYear: diagnosisYear.answer,
    diagnosisYearStore: diagnosisYear.from,
    birthYear: decodeFirstYearFrom([
      ['baseline', foundation?.birthYear],
      ['profileColumn', profile.dateOfBirth],
    ] as const).answer,
    geneticEvidence: {
      d4z4: text(disease?.d4z4),
      haplotype: text(disease?.haplotype),
      methylation: text(disease?.methylation),
    },
    diagnosisConfirmation: passportDiagnosis.confirmation,
    // The one place the enum is reduced to the bit two formats emit.
    geneticallyConfirmed: passportDiagnosis.confirmation === 'genetic',
    geneticEvidenceReading,
    geneticEvidenceRecord: passportDiagnosis.geneticEvidence.record,
    geneticGreyZoneNoteZh: passportDiagnosis.geneticEvidence.greyZoneNote,
    familyHistoryStatement: text(disease?.familyHistory),
    onsetRegion: text(disease?.onsetRegion),
    currentStatus: {
      ambulation: text(status?.independentlyAmbulatory),
      armRaiseDifficulty: bool(status?.armRaiseDifficulty),
      facialWeakness: bool(status?.facialWeakness),
      footDrop: bool(status?.footDrop),
      breathingSymptoms: bool(status?.breathingSymptoms),
      assistiveDevices,
    },
    challenges: Object.entries(CHALLENGE_LABELS)
      .map(([key, labelZh]) => {
        const value = challenges?.[key];
        return typeof value === 'number' && Number.isFinite(value)
          ? { key, labelZh, score: value }
          : null;
      })
      .filter((entry): entry is { key: string; labelZh: string; score: number } => entry !== null),
    milestones,
    fieldOrigins: listBaselineFieldOrigins(baseline).map(({ path, origin }) => ({
      path,
      labelZh: baselineFieldLabelZh(path),
      state: origin.state === 'admin_entered' ? 'admin_entered' : 'unreadable',
      adminUserId: origin.state === 'admin_entered' ? origin.adminUserId : null,
      at: origin.state === 'admin_entered' ? origin.at : null,
      detail: origin.state === 'unreadable' ? origin.detail : null,
    })),
    followupEvents: profile.followupEvents
      .filter((event) => !(event.eventType in MILESTONE_EVENTS))
      .map((event) => ({
        eventId: event.id,
        eventType: event.eventType,
        occurrence: resolveOccurrenceDate(event.occurredAt),
        severity: text(event.severity),
        descriptionZh: text(event.description),
      })),
    reportFields: collectReportFields(
      profile.documents,
      geneticEvidenceReading,
      passportDiagnosis.geneticEvidence.record,
      passportDiagnosis.geneticEvidence.greyZoneNote,
    ),
  };
};

/**
 * Brooke and Vignos are collected and are not exported.
 *
 * The instruments module writes graded ordinal motor scales to
 * `instrument_administrations` and serves them at /me/instruments/*,
 * but they are not on `PatientProfileDTO`, which is the only thing
 * this normaliser reads — so no serialiser downstream can see them.
 * Of everything in a patient's record, these two are the measures a
 * registry can actually compare across patients, and the export was
 * shipping without them AND without saying so, which is the exact
 * state envelope.ts says `omissions` exists to prevent.
 *
 * Until the normaliser is given the administrations, every format
 * declares the gap. The paragraph below is shared so the three cannot
 * drift into describing the same hole differently.
 *
 * What is NOT shared is what each format does with the walking state a
 * Vignos sync writes into the baseline, because that is a fact about
 * one document rather than about the pipeline. It used to be the last
 * sentence of this constant, phrased for TREAT-NMD — so the FHIR
 * bundle and the Phenopacket, neither of which carries that baseline
 * state, were telling their receivers to look for one in a 运动功能
 * section neither of them has. Sharing a sentence that is only true of
 * one output is how the shared wording became the untrue part.
 *
 * 「Baseline state」 is the precise noun and each format's sentence has
 * to keep it precise. The FHIR bundle carries timed walk tests and a
 * 户外行走 self-rating; a sentence there claiming no ambulation data of
 * any kind would be false against its own Observations, and would send
 * a receiver back to the patient for something the document measured.
 */
export const INSTRUMENT_OMISSION_REASON_ZH =
  '本平台采集 Brooke 上肢功能分级与 Vignos 下肢功能分级（见 /me/instruments），但这两项尚未接入本导出所读取的档案结构，因此本次导出不含任何分级数值、施测时间或量表版本。这是导出管线的缺口，不表示患者没有做过分级——在本记录的全部内容里，这两项通常是唯一可跨患者比较的运动功能测量，需要时请直接向患者索取。';

/**
 * @param ambulationNoteZh What THIS format does with the walking state
 *   a Vignos sync writes into the baseline, stated in that format's
 *   own vocabulary (envelope.ts:24). Required rather than optional: a
 *   fourth serialiser must not be able to inherit another format's
 *   answer by leaving the argument out.
 */
export const instrumentOmission = (field: string, ambulationNoteZh: string): ExportOmission => ({
  field,
  reasonZh: `${INSTRUMENT_OMISSION_REASON_ZH}${ambulationNoteZh}`,
});

/**
 * The falls diary is collected and is not exported.
 *
 * SAME PIPELINE GAP AS BROOKE / VIGNOS, DIFFERENT AND WORSE READING.
 * `patient_falls` (migration 023) holds five structured answers per
 * fall — what the patient was doing, indoor or outdoor, whether their
 * hands were full, whether they got up unaided, whether they were hurt
 * — served at /me/falls. None of them is on `PatientProfileDTO`, which
 * is the only thing this normaliser reads, so no serialiser downstream
 * can see them.
 *
 * WHY THIS ONE COULD NOT STAY UNDECLARED. The instruments gap at least
 * leaves nothing fall-shaped in the document. This one does the
 * opposite: two of the three formats DO emit the fall, because every
 * diary entry writes a `patient_followup_events` twin in the same
 * transaction (migration 023, `origin_event_id`) and the twin is what
 * `followupEvents` carries. So a receiver opens a TREAT-NMD document
 * or a FHIR bundle, finds 跌倒 with a date on it, finds no mechanism,
 * no injury and no ability to rise — and reads that as the whole of
 * what this patient recorded. It is the 家族史 failure exactly:
 * 「asked, and nothing further」 rather than 「held, and not sent」.
 *
 * And falls are the dangerous event in this disease. Roughly 65% of
 * adults with FSHD fall at least once a year; 「能不能自己起来」 is the
 * single answer that changes what a patient needs, is not derivable
 * from any other column, and is the first thing a neurologist asks
 * after 「摔过几次」.
 *
 * DECLARED RATHER THAN CARRIED, and the reason is not that the facts
 * are unsafe to send — unlike 家族史, every one of these is the
 * patient's own answer about their own body, drawn from a closed value
 * set this repository chose (falls.schema.ts admits no free text at
 * all). It is that carrying them means putting the diary on
 * `PatientProfileDTO`, which is a shape read by every profile surface
 * in the product, and a fabricated placement in a strict format is
 * worse than a declared gap. Until the normaliser is given the diary,
 * all three formats declare it, and the paragraph is shared so they
 * cannot drift into describing the same hole differently.
 *
 * NULL MEANS 「没填」. The sentence has to say so, because the diary's
 * own contract turns on it (migration 023): a receiver who later gets
 * these columns must not read a blank `injured` as 「没有受伤」.
 */
export const FALLS_DIARY_OMISSION_REASON_ZH =
  '本平台采集结构化的跌倒日记（见 /me/falls）：每一次跌倒除日期外还记录当时在做什么、在室内还是室外、手里是否拿着东西、能否自行起身、是否受伤这五项。这五项尚未接入本导出所读取的档案结构，因此本次导出不含其中任何一项。这是导出管线的缺口，不表示患者的跌倒没有细节可查。请特别注意：这五项在本平台的记录里空值一律表示「患者没有填」，绝不表示「否」——所以即便日后拿到这些数据，也不能把空的「是否受伤」读成没有受伤。跌倒是本病最危险的事件，其中「能否自行起身」不能由任何其他数据推出，需要请直接向患者索取。';

/**
 * @param eventNoteZh What THIS format does emit about the falls
 *   themselves, stated in that format's own vocabulary (envelope.ts:24).
 *   Required rather than optional, for the reason `instrumentOmission`'s
 *   argument is: a fourth serialiser must not inherit another format's
 *   answer by leaving it out. And it is the half that stops this entry
 *   being a false denial — two of the three formats carry the fall
 *   event, and an omission that read 「本导出不含跌倒」 would send a
 *   receiver back to the patient for dates the document already has.
 */
export const fallsDiaryOmission = (field: string, eventNoteZh: string): ExportOmission => ({
  field,
  reasonZh: `${FALLS_DIARY_OMISSION_REASON_ZH}${eventNoteZh}`,
});

/**
 * EVERY MEASUREMENT THIS PLATFORM PARSES OFF AN UPLOADED REPORT, as a
 * list a test can walk.
 *
 * The genetic cells are excluded on purpose: they are the four items the
 * three documents already argue about by name, each with its own
 * provenance sentence, and folding them into this list would let a
 * generic 「报告读数」 declaration stand in for the specific ones.
 * `REPORT_READING_LABELS_ZH` is therefore exactly the laboratory,
 * pulmonary, cardiac, imaging and physical-examination readings.
 *
 * EXPORTED SO THE TABLE CANNOT BE THE THING THAT GOES STALE. Four review
 * rounds in a row found a clinical fact carried by no export and
 * declared by none, and every one of them was a fact that existed in a
 * runtime table here while the hand-written coverage table in
 * omissions-coverage.test.ts had no row for it. A list derived from
 * `REPORT_FIELD_SPECS` fails the moment a spec is added with no home,
 * which is the only version of this check that survives the next person.
 */
export const REPORT_READING_KEYS: readonly string[] = REPORT_FIELD_SPECS.filter(
  (spec) => spec.geneticCell === undefined,
).map((spec) => spec.key);

/**
 * EVERY spec, genetic ones included, as a list a test can walk.
 *
 * `REPORT_READING_*` above is the subset the two non-FHIR documents
 * declare as a block. This is the whole table, because the coverage
 * assertion has to be able to say 「this reading is emitted or declared
 * in all three envelopes」 about the genetic cells too — they are the
 * ones with three different answers to that question.
 */
export const REPORT_FIELD_INVENTORY: ReadonlyArray<{
  readonly key: string;
  readonly labelZh: string;
  readonly payloadKeys: readonly string[];
  readonly genetic: boolean;
}> = REPORT_FIELD_SPECS.map((spec) => ({
  key: spec.key,
  labelZh: spec.labelZh,
  payloadKeys: spec.keys,
  genetic: spec.geneticCell !== undefined,
}));

export const REPORT_READING_LABELS_ZH: readonly string[] = REPORT_FIELD_SPECS.filter(
  (spec) => spec.geneticCell === undefined,
).map((spec) => spec.labelZh);

/**
 * THE READINGS THIS PLATFORM PARSES OFF AN UPLOADED REPORT, AND THE TWO
 * DOCUMENTS THAT CARRIED NONE OF THEM AND SAID NOTHING.
 *
 * WHAT WAS WRONG. `source.reportFields` appeared exactly twice in this
 * directory, both times in fhir-r4.ts. treat-nmd.ts and phenopacket.ts
 * never read it — grep for 「reportFields」 in either and the count is
 * zero — so CK, 肌红蛋白, LDH, CK-MB, FVC%pred, TLC%pred, DLCO%pred,
 * LVEF, QTc, 前锯肌脂肪化等级 and the five MRC grades reached the FHIR
 * bundle and reached neither of the other two. Not one of them was named
 * in either omissions list.
 *
 * WHY THAT IS THE FAILURE envelope.ts DESCRIBES AND NOT A GAP. TREAT-NMD
 * is a REGISTRY alignment document. A registry ingesting it, and a
 * registry ingesting the FHIR bundle for the same patient in the same
 * hour, get two different patients — one with a CK of 1245 and an FVC at
 * 78% of predicted, one with no laboratory data of any kind and nothing
 * saying there could have been. The TREAT-NMD document made that worse
 * than silent: its `codingProvenance` block publishes the ledger entry
 * for `pft.fvcPercentPredicted`, 「FVC percent predicted」 and all, so the
 * document announces that this platform knows the concept, prints no
 * value, and declares no omission.
 *
 * DECLARED RATHER THAN CARRIED, and the reason is specific to each
 * format rather than shared:
 *
 *   - TREAT-NMD. The six sections are the six MANDATORY CONTENT AREAS
 *     the corpus establishes (treat-nmd.ts's header quotes the source),
 *     and laboratory / pulmonary / cardiac / imaging results are not one
 *     of them. Inventing a seventh clinical section is the same move
 *     that file already refuses for 「sixteen sections」 and for per-item
 *     references: a receiver mapping our data onto a question the
 *     dataset does not ask is worse off than one told where the data is.
 *   - Phenopacket. `Measurement.assay` must be an ontology term, and
 *     codings.ts holds no verified LOINC for most of these — the same
 *     reason that document already gives for the strength and function
 *     test blocks.
 *
 * So both declare, both name the readings, and both point at the one
 * document that carries them.
 */
const REPORT_READINGS_RULE_ZH = `本平台会从患者上传的检查报告原文里解析出结构化读数，本平台可解析的项目是这些：${REPORT_READING_LABELS_ZH.join('、')}。这些读数不出现在本文件里。`;

/**
 * @param heldCount How many such readings THIS export actually holds for
 *   THIS profile. Printed rather than hidden, because 0 is itself an
 *   answer a receiver can act on — and it is not 「这位患者没做过检查」,
 *   which the sentence says out loud.
 * @param whereZh Where the readings DO travel, in this format's own
 *   vocabulary. Required rather than optional for the reason
 *   `fallsDiaryOmission`'s note argument is: a fourth serialiser must
 *   not inherit another format's answer by leaving it out.
 */
export const reportReadingsOmission = (
  field: string,
  heldCount: number,
  whereZh: string,
): ExportOmission => ({
  field,
  // THE POINTER DOES NOT PROMISE COMPLETENESS, and the reason is the one
  // phenopacket.ts's `measurements` entry already learned the hard way:
  // the FHIR bundle caps its Observations and declares the cut in its own
  // omissions, so an entry telling a receiver 「it is all over there」
  // promises a completeness the other document says it does not have —
  // and a receiver told that does not go looking for the omission that
  // says otherwise. Nor does it promise dates: that bundle writes
  // `effectiveDateTime` only where the report stated its own, which is
  // the correct behaviour and not the same as 「dated」.
  reasonZh: `${REPORT_READINGS_RULE_ZH}本次导出的档案里有 ${heldCount} 条这样的读数。${whereZh}那份导出对条目数有上限，超出时会截断并在它自己的 omissions 里说明；报告上没写日期的条目，它也不写观察时间，同样有说明。不受截断影响的完整读数在不带 format 参数的数据导出里。请不要把这些项目在本文件里的缺席读成患者没有做过这些检查，也不要读成检查结果正常——本文件对它们一个字都没有说。`,
});

/**
 * A GENETIC VALUE THE ARCHIVE HOLDS AND THE EVIDENCE DOCUMENT DOES NOT
 * STATE — the state in which the three documents gave three different
 * answers about one number.
 *
 * HOW A PROFILE GETS INTO IT, and it is the ordinary lifecycle rather
 * than an edge case. The baseline questionnaire has its own boxes for
 * these cells (`diseaseBackground.d4z4` and friends). A patient can
 * answer them before uploading anything, or from a report that is not
 * the one `pickGeneticEvidenceDocument` later names, or a member of
 * staff can transcribe them off a paper report during onboarding.
 * `applyGeneticReportAutofill` fills an EMPTY slot from the evidence
 * document and never corrects a full one — so the archived answer
 * survives with no matching cell on the document forever.
 *
 * WHAT THE THREE DOCUMENTS DID WITH IT. TREAT-NMD prints the archived
 * value with `geneticValueProvenanceZh` saying where it came from and
 * that the report is silent. The Phenopacket declares it. The FHIR
 * bundle builds its genetic Observations out of `reportFields`, which
 * exist only where the EVIDENCE DOCUMENT had a cell — so it neither
 * carried the value nor said a word about it, while its own omissions
 * list stated that 「the readings themselves all travel now」. One
 * registry gets 甲基化水平 32%, one is told where to find it, and one is
 * told there is nothing to find.
 *
 * THE RESOLVED SPLIT, which every caller now states the same way: a
 * value READ OFF THE EVIDENCE DOCUMENT travels to TREAT-NMD and to the
 * FHIR bundle; a value held ONLY IN THE ARCHIVE travels to TREAT-NMD
 * and is DECLARED by the other two. 分型 is not in this table because it
 * is not carried this way at all — it reaches the FHIR bundle as
 * `Condition.code` and the Phenopacket as `Disease.term`, from the
 * archive, whatever the document says.
 *
 * Asked of `reportFields` rather than of `geneticEvidenceReading`,
 * because `reportFields` is literally what the FHIR builder emits from:
 * a second reading here is how this declaration would come to disagree
 * with the bundle it is attached to.
 */
const GENETIC_ARCHIVE_CELLS: ReadonlyArray<{
  readonly field: GeneticBaselineField;
  readonly reportFieldKey: string;
  readonly labelZh: string;
}> = [
  { field: 'd4z4', reportFieldKey: 'd4z4Repeats', labelZh: 'D4Z4 重复单元数' },
  { field: 'haplotype', reportFieldKey: 'haplotype', labelZh: '4q 单倍型' },
  { field: 'methylation', reportFieldKey: 'methylation', labelZh: '甲基化' },
];

export interface ArchiveOnlyGeneticCell {
  readonly field: GeneticBaselineField;
  readonly labelZh: string;
  readonly archivedValue: string;
}

export const archiveOnlyGeneticCells = (
  source: NormalisedSource,
): readonly ArchiveOnlyGeneticCell[] =>
  GENETIC_ARCHIVE_CELLS.flatMap((cell) => {
    const archived = GENETIC_BASELINE_VALUE_ORIGINS[cell.field].archived(source);
    if (archived === null) return [];
    if (source.reportFields.some((field) => field.key === cell.reportFieldKey)) return [];
    return [{ field: cell.field, labelZh: cell.labelZh, archivedValue: archived }];
  });

/**
 * Every cell in the table above, named, for a declaration that has to
 * hold for a profile with none of them filled in — the receiver who most
 * needs to know this route exists is the one holding a document with no
 * genetic values at all.
 */
export const GENETIC_ARCHIVE_CELL_LABELS_ZH: readonly string[] = GENETIC_ARCHIVE_CELLS.map(
  (cell) => cell.labelZh,
);

/**
 * How many of those cells the archive has an answer in, at all.
 *
 * The declaration's empty branch needs it. 「本次导出没有处在这种状态的项目」
 * is true both when the patient answered every box and the report happens
 * to state every one of them, and when the patient answered none — and
 * those are opposite facts. A receiver told the first about a profile
 * that is the second concludes the boxes were filled and agreed with the
 * report, which is a stronger statement than anything this platform
 * holds.
 */
export const archivedGeneticCellCount = (source: NormalisedSource): number =>
  GENETIC_ARCHIVE_CELLS.filter(
    (cell) => GENETIC_BASELINE_VALUE_ORIGINS[cell.field].archived(source) !== null,
  ).length;

/**
 * The family-history statement is held, and two of the three portable
 * exports do not send it.
 *
 * WHAT WAS WRONG. `normaliseSource` computes `familyHistoryStatement`
 * and only treat-nmd.ts read it. The FHIR bundle and the Phenopacket
 * dropped it AND declared nothing — 家族史 / familyHistory /
 * FamilyMemberHistory appeared nowhere in either builder and nowhere in
 * either rendered envelope. Family history is a first-line question in
 * an FSHD workup: a neurologist reading a bundle with no
 * FamilyMemberHistory in it and no omission naming one reads 「asked and
 * negative」, which is the opposite of 「we hold a statement and did not
 * send it」 for the patients whose statement says 父亲和姑姑都有类似的
 * 抬手困难.
 *
 * WHY DECLARED RATHER THAN CARRIED, in both. The value is a statement
 * about the patient's RELATIVES — a second data subject who consented
 * to nothing here — so TREAT-NMD emits it only in the local-retention
 * variant and declares the omission otherwise (ExportOptions.includeLocalOnly).
 * Neither of the other two formats has a local-retention variant at
 * all: the FHIR bundle refuses to branch on that flag anywhere, on the
 * stated ground that a resource which can never hold a direct
 * identifier cannot leak one when a caller passes the flag wrong, and
 * the Phenopacket says the same in `notes.本地留存`. Adding the first
 * flag-dependent branch to either of them, for a paragraph naming the
 * patient's father and aunt, would be the leak that reasoning exists to
 * prevent. So the declaration is UNCONDITIONAL in both — the same entry
 * in both redaction modes — and each format states its own slot
 * situation.
 *
 * WHY THE OPENING DERIVES. 「本平台持有患者对自身家族史的一段自述」 was
 * one hardcoded string for every profile, and it is FALSE for every
 * archive whose 家族史 box is empty — rendered over a profile with no
 * baseline, both this sentence and the tail claiming 本平台持有的是一段
 * 中文自述 shipped to a registry that holds nothing of the sort. The
 * declaration itself stays UNCONDITIONAL (an empty box is still worth
 * declaring: it tells a receiver the format has no slot AND that this
 * archive has no answer, which are two different reasons to ask the
 * patient) — it is only the holding claim that has to move with what
 * is on the row.
 *
 * @param slotNoteZh What THIS format has to put it in, in that
 *   format's own vocabulary (envelope.ts:24). Required rather than
 *   optional, for the reason `instrumentOmission`'s argument is: a
 *   fourth serialiser must not inherit another format's answer by
 *   leaving it out. It states the SLOT only; the sentence about what
 *   this platform has to fill it with is appended here, because it is
 *   the same claim in both formats and it derives.
 * @param statementZh `NormalisedSource.familyHistoryStatement`.
 */
const FAMILY_HISTORY_RULE_ZH =
  '家族史是关于患者亲属的陈述，亲属是第二数据主体，没有就此导出作出同意，因此它只在明确请求本地留存版本的 TREAT-NMD 对齐导出里出现（sections.familyHistory），本文件无论调用方是否请求本地留存版本都不承载它。本文件里没有家族史，不表示患者没有家族史，也不表示本平台问过而患者回答了「没有」——需要它请直接向患者索取。';

export const familyHistoryOmission = (
  field: string,
  slotNoteZh: string,
  statementZh: string | null,
): ExportOmission => ({
  field,
  reasonZh:
    statementZh === null
      ? `本平台此刻没有患者对自身家族史的任何陈述——这一栏是空的，本次导出因此没有可发送的内容。即便有，本导出也不会发送它：${FAMILY_HISTORY_RULE_ZH}${slotNoteZh}而本平台在这一栏上什么都没有，连一段中文自述都没有。`
      : `本平台持有患者对自身家族史的一段自述，本次导出不发送它。原因不是没有采集：${FAMILY_HISTORY_RULE_ZH}${slotNoteZh}而本平台持有的是一段中文自述，把它拆成结构化条目等于替患者的亲属编造结构化病史。`,
});

/**
 * HOW PRECISELY THIS ARCHIVE HOLDS ONE OF ITS DATES — the answer every
 * envelope sentence about 出生年份 / 确诊年份 has to derive from.
 *
 * Two stores answer for each of these dates and they answer at
 * different precisions: a `patient_profiles` DATE column
 * (`date_of_birth`, `diagnosis_date`), filled to the day on ordinary
 * archives, and the baseline questionnaire's year slot, which
 * `year-value.ts` decodes into 已知 / 记不清了 / 未采集.
 * `decodeFirstYearFrom` already walks them in that order for the YEAR;
 * this is the one fact the walk drops, and it is the one an omission
 * reason needs.
 *
 * IT LIVES HERE RATHER THAN IN ONE SERIALISER because two of them
 * write this sentence and both were wrong in the same way. The
 * Phenopacket told a registry 本平台记录的是出生年份与确诊年份 and the
 * TREAT-NMD document told it 出生年份（本平台按年份存）, while the FHIR
 * bundle built from this same source in the same request printed
 * 1988-04-02 on `Patient.birthDate`. Two copies of one claim are two
 * chances for one of them to be the false one.
 *
 * PRECISION, NEVER THE VALUE. These sentences ride in documents that
 * deliberately withhold the date, so quoting it to explain withholding
 * it hands the receiver the exact thing the field refuses.
 *
 * 记不清了 AND 未采集 STAY APART for the reason year-value.ts states:
 * one says the question was put to the patient and they do not know,
 * the other says it was never put.
 */
export type HeldDatePrecision = 'day' | 'year' | 'not_remembered' | 'not_collected';

export const heldDatePrecision = (fullDate: string | null, year: YearAnswer): HeldDatePrecision => {
  if (fullDate !== null) return 'day';
  switch (year.kind) {
    case 'year':
      return 'year';
    case 'unknown':
      return 'not_remembered';
    case 'not_asked':
      return 'not_collected';
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A stable UUID for a resource that has no row of its own (the FHIR
 * Composition, the Bundle itself).
 *
 * Version nibble 8, variant 10 — RFC 9562 UUIDv8, which is the
 * version reserved for vendor-defined layouts. Deliberately NOT
 * version 4: a v4 UUID asserts randomness, and this one is a SHA-256
 * of its inputs and will repeat exactly for the same inputs. Claiming
 * v4 here would be a small lie told in a field nobody reads, which is
 * the kind that survives longest.
 */
export const deterministicUuid = (seed: string): string => {
  const hex = createHash('sha256').update(seed).digest('hex');
  const version = '8';
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    version + hex.slice(13, 16),
    variant + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
};

/** Row ids are already UUIDs in production; test doubles are not. */
export const resourceUuid = (id: string, kind: string): string =>
  UUID_RE.test(id) ? id.toLowerCase() : deterministicUuid(`${kind}:${id}`);
