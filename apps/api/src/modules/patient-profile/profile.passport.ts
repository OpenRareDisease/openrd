import {
  baselineFieldLabelZh,
  listBaselineFieldOrigins,
  readBaselineFieldOrigin,
  type BaselineFieldOrigin,
} from './baseline-provenance.js';
import {
  DIAGNOSIS_DATE_KEYS,
  GENETIC_FIELD_KEYS,
  TRANSCRIBED_EVIDENCE_LABEL_ZH,
  documentClassifiedType,
  isLaboratoryGeneticReport,
  pickGeneticEvidenceDocument,
  pickReading,
} from './genetic-evidence.js';
import {
  DIAGNOSIS_LADDER_LABELS,
  DIAGNOSIS_LADDER_STATES,
  type DiagnosisLadderState,
} from './profile.schema.js';
import type {
  PatientActivityLogDTO,
  PatientDocumentDTO,
  PatientProfileDTO,
} from './profile.service.js';

/** Only what this file reads. `aiExtraction` / `ai_extraction` used to
 *  be declared here and referenced nowhere — and the profile query no
 *  longer loads them (see PROFILE_OCR_PAYLOAD_PROJECTION), so the shape
 *  now says what actually arrives. */
type OcrPayloadLike = {
  extractedText?: string;
  extracted_text?: string;
  fields?: Record<string, unknown>;
} | null;

type BodyRegionId =
  | 'face'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftUpperArmFront'
  | 'rightUpperArmFront'
  | 'leftUpperArmBack'
  | 'rightUpperArmBack'
  | 'leftTorso'
  | 'rightTorso'
  | 'leftGlute'
  | 'rightGlute'
  | 'leftThighFront'
  | 'rightThighFront'
  | 'leftThighBack'
  | 'rightThighBack'
  | 'leftShin'
  | 'rightShin'
  | 'leftCalf'
  | 'rightCalf';

export type PassportBodyRegionDatum = {
  intensity: number;
  label?: string;
};

export type PassportBodyRegionMap = Partial<Record<BodyRegionId, PassportBodyRegionDatum>>;

export interface PassportMetricDTO {
  label: string;
  value: string;
  hint: string;
}

export interface PassportFreshnessDTO {
  label: '最新' | '待更新' | '过期' | '缺失' | '未知';
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  date: string | null;
  daysSince: number | null;
}

export interface PassportSummaryCardDTO {
  key: 'diagnosis' | 'motor' | 'imaging' | 'monitoring';
  title: string;
  ready: boolean;
  summary: string;
  meta: string;
}

/**
 * HOW WELL BACKED the diagnosis on this passport is. NOT who typed it.
 *
 * `genetic` — a D4Z4 repeat count, 4q haplotype or EcoRI fragment was
 *   extracted from THE GENETICS LABORATORY'S OWN REPORT. This is
 *   evidence, and it is the only state on this list that is.
 *
 *   Not 「off an uploaded document」, which is what it used to be and is
 *   a weaker thing. `pickGeneticEvidenceDocument` accepts a 病历摘要
 *   quoting a repeat count, on purpose, because for some patients it is
 *   the only copy of that number in existence — but a clinic's
 *   transcription of a laboratory's sentence is not the laboratory
 *   saying it. Rendered before this line was written: a profile whose
 *   only document was a 病历摘要 quoting a count and a haplotype came
 *   out 基因确诊 / 可用于入组, headed by a sentence telling the reader
 *   the report already held what trial enrolment requires. No
 *   laboratory had said any of it. The value still prints — with
 *   `PassportValueOriginKind.transcribed` beside it — and earns none of
 *   the grades. See `isLaboratoryGeneticReport`.
 * `self_reported` — a 分型 or a 诊断日期 is on the page and no such
 *   measurement off the laboratory's own report is. That is the
 *   commonest state: the literature puts the FSHD diagnostic odyssey
 *   near a decade with a majority misdiagnosed along the way, so the
 *   realistic holder of an unconfirmed passport is someone carrying
 *   「可能是肌病」 or an outright wrong label.
 *
 *   IT ALSO COVERS THE TRANSCRIPTION, whose repeat count is printed on
 *   the same page — and the name is the reason this enum's authorship
 *   warning below is not a formality. Every sentence written off this
 *   member says 「没有从基因报告里读出来的 D4Z4 重复数、4q 单倍型或
 *   EcoRI 片段」 and hands each value its own bracket, which stays true
 *   of a transcribed number; none of them says the patient reported
 *   anything, and none may be made to.
 * `admin_entered` — the same as `self_reported` on evidence, plus a
 *   provenance marker on ONE baseline field, `foundation.diagnosisYear`
 *   (see the derivation in `buildClinicalPassportSummary`). A marker
 *   that exists and cannot be parsed lands here too, because the
 *   fallback that looks harmless — treat it as no entry — is the one
 *   that renders an administrator's typing as 「本人填写」.
 * `none` — nothing yet.
 *
 * WHAT THIS TYPE MAY NOT BE USED FOR
 *
 * Authorship. None of these four states says who put 分型, 甲基化 or
 * 诊断日期 on the page: 分型 can be OCR off an uploaded report in the
 * `self_reported` state, and can be the patient's own free text in the
 * `genetic` state, because the measurement that earned `genetic` is a
 * different field. Renderers that read authorship off this enum
 * printed 「本人填写」 over values nobody typed. Per value, the answer is
 * `PassportDiagnosisDTO.valueOrigins`; per baseline field, it is
 * `fieldOrigins`.
 *
 * The evidence distinction is still the whole point of the document.
 * This page is designed to be handed to a neurologist who may see three
 * FSHD patients in a career, and a confident, well-typeset page headed
 * FSHD anchors them — which is the mechanism that produces those
 * ten-year odysseys in the first place. A passport must never present a
 * patient's own guess in the same visual register as a genetic result.
 */
export type PassportDiagnosisConfirmation = 'genetic' | 'self_reported' | 'admin_entered' | 'none';

/**
 * One baseline field that somebody other than the patient put here.
 *
 * ABSENCE IS THE PATIENT (baseline-provenance.ts) is a rule about the
 * stored block, so this list holds only the marked fields. An empty
 * list therefore says no marker is on record — NOT that the patient
 * authored what is on the page. See that header for why the two are
 * different and for what else can write a baseline field without
 * leaving a marker. There is no `patient` member: a row per unmarked
 * field would be a list of everything, which is a list of nothing.
 *
 * `unreadable` is carried rather than dropped. A marker that exists
 * and cannot be parsed is NOT the patient's — dropping it here is
 * exactly how an administrator's value would end up printed as
 * 「本人填写」 on a page a clinician acts on.
 */
export interface PassportFieldOriginDTO {
  /** Dotted baseline path — the provenance block's own key. */
  path: string;
  labelZh: string;
  state: 'admin_entered' | 'unreadable';
  /** `app_users.id` of the administrator, or null when unreadable. */
  adminUserId: string | null;
  /** ISO 8601, or null when unreadable. */
  at: string | null;
  /** Why the entry could not be read, or null when it could. */
  detail: string | null;
}

/**
 * WHERE ONE PRINTED DIAGNOSIS VALUE CAME FROM.
 *
 * `fieldProvenance` (baseline-provenance.ts) records administrator
 * writes to `baseline_payload` and nothing else, so its absence proves
 * only 「no administrator wrote this baseline field」. Every renderer
 * that read absence as 「本人填写」 was inventing an author, because the
 * two values this block prints most — 分型 and 诊断日期 — are each
 * assembled from more than one source:
 *
 *   `geneticType`   = report OCR (`diagnosisType` …) OR the free-text
 *                     column `patient_profiles.genetic_mutation`
 *   `diagnosisDate` = the column `patient_profiles.diagnosis_date` OR
 *                     the report's own 诊断日期 field
 *
 * and profile.autofill.ts fills BOTH columns from OCR, at read time,
 * before this file is handed the profile, leaving nothing behind that
 * says it did. So the information is not missing — it is thrown away
 * by the `||` that picks a source — and this record is what carries it
 * instead. `indeterminate` is a real answer here, not a shrug: the
 * string is equally consistent with the patient having typed it and
 * with the autofill having copied it out of a report, and a renderer
 * that picks one of those is guessing.
 */
export type PassportValueOriginKind =
  /** OCR read it off the genetics laboratory's own report. */
  | 'report'
  /**
   * OCR read it off an uploaded document that is NOT the laboratory's
   * own report — typically a 病历摘要 transcribing a result.
   *
   * A THIRD ANSWER, because neither of the two that existed is true of
   * it. 「报告读取」 is what every other surface means by a laboratory's
   * number and lends this one the same weight; 「本人填写」 is a claim
   * about a person who did not type it. What is provable is narrower
   * and is exactly this: this platform read the value off a document,
   * and that document is not the report.
   *
   * The value prints. `pickGeneticEvidenceDocument` takes such a
   * document on purpose when the laboratory's report read out nothing,
   * because for some patients the transcription is the only copy of the
   * number in existence, and dropping it loses the value entirely. What
   * this kind withholds is the register: `referral-pack.ts` keeps the
   * number out of the 结论, the share page renders it as an account
   * rather than as a laboratory value, and the guideline branches keyed
   * to a repeat count refuse it.
   */
  | 'transcribed'
  /**
   * The patient typed it.
   *
   * NOTHING IN THIS FILE RETURNS IT. It used to be `resolveValueOrigin`'s
   * fallback for a value with no administrator marker and no report on
   * file that could have been autofilled into it — and neither half of
   * that pair proves typing: the marker block records administrator
   * writes only, and the read-time autofill's source report can be
   * deleted or re-parsed after it has written. See that function.
   *
   * The member stays because this enum is on the wire. The app mirrors
   * it member for member and parses it at runtime
   * (`PASSPORT_VALUE_ORIGIN_KINDS` in apps/mobile/lib/api.ts), that
   * bundle ships as a web export WeChat caches for days, and a rolling
   * deploy serves both API builds at once — so handsets are still
   * receiving and rendering this kind from passports built by the
   * previous version. Removing it from the type would not remove it
   * from the field.
   */
  | 'patient'
  /** A provenance marker names an administrator. */
  | 'admin_entered'
  /** A marker exists and cannot be parsed. Not the patient's; no more
   *  than that. */
  | 'admin_unreadable'
  /** Not attributable to one source: either two of them could have
   *  produced the value and nothing stored tells them apart, or the
   *  string is a join whose parts came from different places. See
   *  `detail`. */
  | 'indeterminate'
  /** Nothing to attribute. */
  | 'absent';

export interface PassportValueOriginDTO {
  kind: PassportValueOriginKind;
  /** One phrase for a printed page, so four renderers do not each word
   *  the same six states. */
  labelZh: string;
  /** The uploaded document OCR read the value off; null otherwise. */
  documentId: string | null;
  /** `app_users.id` from the marker, for `admin_entered` only. */
  adminUserId: string | null;
  /** ISO 8601 from the marker, for `admin_entered` only. */
  at: string | null;
  /** Why the marker could not be read, or why the source cannot be
   *  narrowed. Null when `kind` already says everything. */
  detail: string | null;
}

/** The diagnosis values this passport prints as their own rows, and
 *  therefore the ones that need an origin beside them. */
export type PassportDiagnosisValueKey =
  | 'geneticType'
  | 'd4z4Repeats'
  | 'methylationValue'
  | 'diagnosisDate';

export interface PassportDiagnosisDTO {
  ready: boolean;
  /** Carried all the way to the printed page — see
   *  PassportDiagnosisConfirmation. The export is the artefact that
   *  reaches a clinician, so it is the one place this state cannot be
   *  allowed to go missing. */
  confirmation: PassportDiagnosisConfirmation;
  /** Which rung of the five-state ladder the patient answered on the
   *  baseline form, or null for a profile written before the question
   *  existed. Distinct from `confirmation`, which is derived from
   *  uploaded reports only — the two answer different questions
   *  (「what did you tell us」 vs 「what does the evidence show」) and
   *  the passport shows both rather than reconciling them. */
  ladder: DiagnosisLadderState | null;
  ladderLabel: string | null;
  /** Who put the ladder answer there, in one word — 本人填写 /
   *  管理员代填 / 来源不明. Rendered instead of a hardcoded 「本人填写」,
   *  which was a claim the renderer had no way to check. */
  ladderOriginZh: string | null;
  /**
   * When the document this block's genetic values were read off was
   * uploaded, and the id of that document.
   *
   * NOT 「the newest report」 and not 「the newest genetics report」.
   * `pickGeneticEvidenceDocument` answers which document is this
   * profile's genetic evidence, and it declines the newest whenever a
   * laboratory report outranks a 病历摘要 that quotes it, or a parsed
   * report outranks one whose parse has not landed. A renderer labelling
   * this 最近一份报告 prints an older date under a promise of the newest
   * — which the referral pack did, in the section a neurologist reads to
   * decide whether the workup is current. `freshness` is derived from
   * this same date and inherits the caveat: it ages with the evidence,
   * not with the patient's upload activity.
   */
  latestSourceDate: string | null;
  latestDocumentId: string | null;
  freshness: PassportFreshnessDTO;
  geneticType: string;
  d4z4Repeats: string;
  methylationValue: string;
  diagnosisDate: string;
  /** Where each of the four values above came from. A `Record` and not
   *  four optional fields: adding a printed row to the block should
   *  fail the build until it has an origin. */
  valueOrigins: Record<PassportDiagnosisValueKey, PassportValueOriginDTO>;
  geneEvidence: string;
  /**
   * Where `geneEvidence` came from.
   *
   * The string is 分型, 单倍型, EcoRI 片段 and D4Z4 重复数 joined. 单倍型,
   * EcoRI 片段 and D4Z4 重复数 are read off the one uploaded document
   * this block was built from — which is the laboratory's own report or
   * a transcription of one, and the bracket says which — while 分型
   * falls back to `patient_profiles.genetic_mutation`, so the join can
   * hold two sources at once. A field of its own rather than a
   * `valueOrigins` entry: that record is keyed by
   * `PassportDiagnosisValueKey`, which is the values this row is
   * derived FROM. Resolved in `buildClinicalPassportSummary`, beside
   * the components, rather than by each renderer separately.
   */
  geneEvidenceOrigin: PassportValueOriginDTO;
  /** The graded read of the genetic evidence, plus the 《检查申请说明》
   *  a patient can hand to a clinic. Always present — 未检测 and 未知
   *  are answers, not absences. */
  geneticEvidence: PassportGeneticEvidenceDTO;
}

export interface PassportMotorDTO {
  ready: boolean;
  average: string;
  latestMeasurementAt: string | null;
  latestActivityAt: string | null;
  summary: string;
  highlights: string[];
  bodyRegions: PassportBodyRegionMap;
  activitySummary: string;
}

export interface PassportImagingDTO {
  ready: boolean;
  latestMriDate: string | null;
  latestDocumentId: string | null;
  freshness: PassportFreshnessDTO;
  summary: string;
  highlights: string[];
  bodyRegions: PassportBodyRegionMap;
}

export interface PassportMonitoringItemDTO {
  key: 'blood' | 'respiratory' | 'cardiac';
  title: string;
  available: boolean;
  summary: string;
  latestDate: string | null;
  latestDocumentId: string | null;
  freshness: PassportFreshnessDTO;
  /**
   * Three states, because `available: false` collapsed two facts that
   * are not the same fact:
   *
   *   `present`    — structured values were read and are in `summary`.
   *   `unreadable` — a report of this class IS on file, but nothing
   *                  structured came out of it (bad scan, unknown
   *                  layout, OCR miss).
   *   `absent`     — nothing of this class has been uploaded.
   *
   * The distinction is load-bearing exactly once, and it is the highest
   * stakes surface in the product: the anesthesia card. Collapsing
   * `unreadable` into `absent` makes that card tell an anesthetist the
   * patient never had a pulmonary function test, about a patient who
   * uploaded one — and the pre-op PFT line is the only thing on that
   * card standing between an unassessed patient and general anesthesia.
   */
  state: 'present' | 'unreadable' | 'absent';
  /**
   * When a guideline says something about *whether* this test is
   * indicated, it goes here. The panel previously implied all three
   * slots were equally expected of everyone, which is how it ended up
   * asking asymptomatic patients for echocardiograms.
   */
  note?: string;
}

export interface PassportMonitoringDTO {
  ready: boolean;
  items: PassportMonitoringItemDTO[];
}

export interface PassportNextStepDTO {
  title: string;
  description: string;
  /**
   * `record` — something to upload or type in. Completes the passport.
   * `clinical` — something to raise with a doctor. Does not.
   *
   * These were one undifferentiated list rendered under 「如果想让临床
   * 护照更完整，可以优先补这些记录」, each with a warning triangle and a
   * 「去数据录入补齐」 button at the bottom. Adding a guideline
   * recommendation to that list turns 「问一次眼底检查」 into a
   * data-entry chore pointing at an upload form — the recommendation
   * survives the trip and its meaning does not.
   */
  kind: 'record' | 'clinical';
}

export interface PassportTimelineItemDTO {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  tag: '报告' | '肌力' | '活动';
  documentId?: string | null;
}

export interface ClinicalPassportSummaryDTO {
  generatedAt: string;
  passportId: string;
  patientName: string;
  hasRecordedData: boolean;
  latestUpdatedAt: string | null;
  completion: {
    completed: number;
    total: number;
  };
  metrics: PassportMetricDTO[];
  summaryCards: PassportSummaryCardDTO[];
  /**
   * Every baseline field on this passport that somebody other than the
   * patient entered — §B3's 「导出也带上这个来源，不能只在 App 里区分」
   * applied to the document a clinician actually reads.
   *
   * Sorted by path, so a re-render of an unchanged profile is
   * byte-identical. Empty means nothing is marked, which is a claim
   * (see PassportFieldOriginDTO) and not a shrug.
   */
  fieldOrigins: PassportFieldOriginDTO[];
  diagnosis: PassportDiagnosisDTO;
  motor: PassportMotorDTO;
  imaging: PassportImagingDTO;
  monitoring: PassportMonitoringDTO;
  nextSteps: PassportNextStepDTO[];
  timeline: PassportTimelineItemDTO[];
}

export interface ClinicalPassportExportDTO {
  generatedAt: string;
  documentTitle: string;
  fileName: string;
  contentType: 'text/markdown';
  markdown: string;
}

/**
 * Which slot supplied a printed diagnosis value — the half of the
 * answer `buildReportInsights` can see.
 *
 * It knows which side of each `||` won and which documents are on
 * file; it does not read `baseline_payload`'s provenance block. The two
 * halves are folded together by `resolveValueOrigin`.
 *
 * `ocrCouldHaveFilled` is the autofill question, and it is answered
 * coarsely on purpose: TRUE whenever any uploaded document carries a
 * field of this kind at all. profile.autofill.ts normalises a report's
 * date before writing it into the column, so comparing the printed
 * value against the raw field would call 「2019年5月3日」 a mismatch and
 * conclude the patient typed it — the one direction this whole record
 * exists to prevent. A superset is only ever wrong towards
 * `indeterminate`.
 *
 * `markerPath` names the baseline field whose provenance entry is
 * about the value this slot actually printed, or null when no marker
 * can be. It rides on the slot rather than being passed in beside it
 * because a single `profile_column` arm can be reached from two
 * different stores — 分型 falls back to the baseline AND to
 * `patient_profiles.genetic_mutation` — and only the expression that
 * picked the value knows which. `resolveValueOrigin` reads it.
 */
type DiagnosisValueSlot =
  /**
   * The one document `pickGeneticEvidenceDocument` named supplied it.
   *
   * `document` AND NOT `report`, and `fromLaboratoryReport` beside it,
   * because that picker takes a 病历摘要 carrying a genetic result when
   * the laboratory's own report read out nothing. The slot that used to
   * be called `report` therefore covered both, and every value reaching
   * it printed 「报告读取」 — a clinic's transcription wearing the
   * bracket kept for a laboratory's own number.
   */
  | { slot: 'document'; documentId: string | null; fromLaboratoryReport: boolean }
  | { slot: 'profile_column'; markerPath: string | null; ocrCouldHaveFilled: boolean }
  | { slot: 'absent' };

type ReportInsights = {
  /** The typed read of the document `pickGeneticEvidenceDocument`
   *  names. The string fields below are the same values with 「—」
   *  placeholders applied, kept because the passport and its markdown
   *  export render them directly. */
  geneticRecord: PassportGeneticRecordDTO;
  geneticType: string;
  haplotype: string;
  ecoRIFragment: string;
  d4z4Repeats: string;
  methylationValue: string;
  diagnosisDate: string;
  diagnosisValueSlots: Record<PassportDiagnosisValueKey, DiagnosisValueSlot>;
  geneEvidence: string;
  /** Whether `geneEvidence` holds a value only the picked document can
   *  supply — 单倍型, EcoRI 片段 or D4Z4 重复数. What decides whether the
   *  joined row can be attributed to one source. Says the value came
   *  off that document and not which kind of document it is:
   *  `geneticRecord.source` answers that, and the two together decide
   *  the bracket. */
  geneEvidenceFromDocument: boolean;
  latestGeneticDate: string | null;
  latestGeneticDocumentId: string | null;
  latestMriDate: string | null;
  latestMriDocumentId: string | null;
  mriSummary: string;
  latestBloodDate: string | null;
  latestBloodDocumentId: string | null;
  bloodSummary: string;
  latestRespiratoryDate: string | null;
  latestRespiratoryDocumentId: string | null;
  respiratorySummary: string;
  latestCardiacDate: string | null;
  latestCardiacDocumentId: string | null;
  cardiacSummary: string;
  strengthAverage: string;
  strengthSummary: string;
};

const BODY_REGION_LABELS: Record<BodyRegionId, string> = {
  face: '面肌',
  leftShoulder: '左肩带',
  rightShoulder: '右肩带',
  leftUpperArmFront: '左上臂前群',
  rightUpperArmFront: '右上臂前群',
  leftUpperArmBack: '左上臂后群',
  rightUpperArmBack: '右上臂后群',
  leftTorso: '左躯干侧',
  rightTorso: '右躯干侧',
  leftGlute: '左臀肌',
  rightGlute: '右臀肌',
  leftThighFront: '左大腿前群',
  rightThighFront: '右大腿前群',
  leftThighBack: '左大腿后群',
  rightThighBack: '右大腿后群',
  leftShin: '左小腿前群',
  rightShin: '右小腿前群',
  leftCalf: '左小腿后群',
  rightCalf: '右小腿后群',
};

const documentLabels: Record<string, string> = {
  mri: 'MRI 报告',
  muscle_mri: 'MRI 报告',
  genetic_report: '基因报告',
  medical_summary: '病历摘要',
  physical_exam: '肌力/体格检查',
  pulmonary_function: '肺功能报告',
  diaphragm_ultrasound: '膈肌超声',
  ecg: '心电图',
  echocardiography: '心脏超声',
  biochemistry: '生化报告',
  muscle_enzyme: '肌酶报告',
  blood_routine: '血常规',
  thyroid_function: '甲功报告',
  coagulation: '凝血报告',
  urinalysis: '尿常规',
  infection_screening: '感染筛查',
  stool_test: '粪便/幽门检测',
  abdominal_ultrasound: '腹部超声',
  blood_panel: '血检报告',
  other: '医学报告',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

/**
 * A calendar date with no time part.
 *
 * `patient_profiles.diagnosis_date` is a `date` column, so it arrives
 * as `YYYY-MM-DD`. A report's 诊断日期 arrives as whatever the OCR read,
 * which is why this is a test and not an assumption — anything that
 * does not match falls through to the Date path below.
 * `new Date('2019-05-03')` is UTC midnight, and `getFullYear` /
 * `getMonth` / `getDate` then read it back in the SERVER's zone — so on
 * any host west of Greenwich the passport printed 2019-05-02 for a
 * diagnosis dated 2019-05-03, on the page a clinician reads and in
 * every export built from it. A calendar date has no zone to convert
 * between; the digits are the answer.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) return trimmed;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return trimmed || null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateLabel = (value?: string | null) => {
  const formatted = formatDate(value);
  if (!formatted) return '—';
  // Slice the string `formatDate` just built rather than re-parsing it:
  // re-parsing is where the day was lost a second time, for the same
  // reason it was lost the first time.
  const parts = DATE_ONLY.exec(formatted);
  if (!parts) return formatted;
  return `${parts[2]}-${parts[3]}`;
};

const compactText = (value?: string | null, fallback = '暂无摘要', limit = 88) => {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const hasMeaningfulValue = (value?: string | null) => {
  const text = value?.trim();
  if (!text || text === '—') return false;
  if (text.startsWith('暂无')) return false;
  return true;
};

const toPayload = (value: unknown): OcrPayloadLike => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as OcrPayloadLike;
};

const getPayloadText = (payload: OcrPayloadLike) => {
  if (!payload) return '';
  return `${JSON.stringify(payload.fields ?? {})} ${
    typeof payload.extractedText === 'string'
      ? payload.extractedText
      : typeof payload.extracted_text === 'string'
        ? payload.extracted_text
        : ''
  }`.toLowerCase();
};

const pickField = (fields: Record<string, unknown> | undefined, keys: string[]) => {
  if (!fields) return undefined;
  for (const key of keys) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
};

const latestDoc = (
  documents: PatientDocumentDTO[],
  predicate: (document: PatientDocumentDTO) => boolean,
) => {
  const matches = documents.filter(predicate);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => getTimestamp(b.uploadedAt) - getTimestamp(a.uploadedAt))[0] ?? null;
};

/** The parser's classification where it managed one, else the type the
 *  uploader declared. Shared with the genetic-evidence picker so 「is
 *  this a genetics report」 has one answer on this page and in the
 *  exports. */
const getDocumentType = (document: PatientDocumentDTO) => documentClassifiedType(document);

const getDocumentDisplayTitle = (document: PatientDocumentDTO) => {
  const payload = toPayload(document.ocrPayload);
  const reportTypeLabel = pickField(payload?.fields, ['reportTypeLabel', 'report_type_label']);
  if (reportTypeLabel) {
    return reportTypeLabel;
  }

  const classifiedType = getDocumentType(document);
  if (documentLabels[classifiedType]) {
    return documentLabels[classifiedType];
  }

  const manualTitle = document.title?.trim();
  if (manualTitle) {
    return manualTitle;
  }

  return documentLabels[document.documentType] ?? '临床报告';
};

const latestDocByType = (documents: PatientDocumentDTO[], type: string) =>
  latestDoc(documents, (document) => getDocumentType(document) === type);

const filterDocsByTypes = (documents: PatientDocumentDTO[], types: string[]) =>
  documents
    .filter((document) => types.includes(getDocumentType(document)))
    .sort((a, b) => getTimestamp(b.uploadedAt) - getTimestamp(a.uploadedAt));

const latestDocByTypes = (documents: PatientDocumentDTO[], types: string[]) =>
  latestDoc(documents, (document) => types.includes(getDocumentType(document)));

const filterDocsContainingText = (documents: PatientDocumentDTO[], patterns: string[]) =>
  documents
    .filter((document) => {
      const text = getPayloadText(toPayload(document.ocrPayload));
      return patterns.some((pattern) => text.includes(pattern.toLowerCase()));
    })
    .sort((a, b) => getTimestamp(b.uploadedAt) - getTimestamp(a.uploadedAt));

const latestDocContainingText = (documents: PatientDocumentDTO[], patterns: string[]) =>
  latestDoc(documents, (document) => {
    const text = getPayloadText(toPayload(document.ocrPayload));
    return patterns.some((pattern) => text.includes(pattern.toLowerCase()));
  });

const latestDocWithFields = (documents: PatientDocumentDTO[], keys: string[]) =>
  latestDoc(documents, (document) => {
    const payload = toPayload(document.ocrPayload);
    return Boolean(pickField(payload?.fields, keys));
  });

const parseScore = (value: string) => {
  const match = value.match(/(\d+(?:\.\d+)?)(\+|-)?/);
  if (!match) return null;
  const base = Number(match[1]);
  if (Number.isNaN(base)) return null;
  const modifier = match[2] === '+' ? 0.3 : match[2] === '-' ? -0.3 : 0;
  return clamp(base + modifier, 0, 5);
};

const buildStrengthSummary = (fields?: Record<string, unknown>) => {
  const entries = [
    { label: '三角肌', key: 'deltoidStrength', alt: 'deltoid_strength' },
    { label: '肱二头肌', key: 'bicepsStrength', alt: 'biceps_strength' },
    { label: '肱三头肌', key: 'tricepsStrength', alt: 'triceps_strength' },
    { label: '股四头肌', key: 'quadricepsStrength', alt: 'quadriceps_strength' },
    { label: '胫前肌', key: 'tibialisStrength', alt: 'tibialis_strength' },
  ];

  const parts: string[] = [];
  const scores: number[] = [];

  entries.forEach((entry) => {
    const value = pickField(fields, [entry.key, entry.alt]);
    if (!value) return;
    parts.push(`${entry.label}${value}`);
    const score = parseScore(value);
    if (score !== null) {
      scores.push(score);
    }
  });

  const average =
    scores.length > 0
      ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1))
      : null;

  return {
    summary: parts.join('，') || null,
    average,
  };
};

/**
 * What a monitoring slot says when OCR produced no structured field.
 *
 * These three slots used to fall back to `compactText(extractedText)` —
 * the first 88 characters of whatever OCR read off the page. On a failed
 * parse that is the hospital letterhead, and it does not stay inert:
 * `hasMeaningfulValue` sees a non-empty string, `buildMonitoringItem`
 * marks the slot `available`, and 「最近肺功能」 on the anesthesia card
 * handed to an anesthetist reads 「××市第一人民医院 检验科 报告单 …」.
 * That line is the only thing on that card standing between an
 * unassessed patient and general anesthesia, and letterhead in it is
 * indistinguishable from a result at a glance.
 *
 * Every string here starts with 暂无 on purpose: `hasMeaningfulValue`
 * treats that prefix as「nothing here」, which is what holds the slot at
 * `available: false` and the anesthesia card at 未做过或未上传. Changing
 * the prefix silently re-opens the hole — see the tests in
 * profile.passport.monitoring.test.ts.
 *
 * The wording says 「无法自动读取」 rather than 「没做过」 because the
 * document may well exist; what is missing is a machine-readable value.
 */
const NO_STRUCTURED_RESULT = {
  blood: '暂无可自动读取的血检结果',
  respiratory: '暂无可自动读取的肺功能结果',
  cardiac: '暂无可自动读取的心脏检查结果',
} as const;

/** What `geneEvidence` says when none of its components parsed. */
const NO_GENE_EVIDENCE = '暂无可直接展示的基因证据';

const MRI_TEXT_PATTERNS = ['mri', '脂肪浸润', '前锯', 'hamstring', '臀肌', '胫前'];

const collectMriDocuments = (documents: PatientDocumentDTO[]) => {
  const byId = new Map<string, PatientDocumentDTO>();
  [
    ...filterDocsByTypes(documents, ['muscle_mri', 'mri']),
    ...filterDocsContainingText(documents, MRI_TEXT_PATTERNS),
  ].forEach((document) => {
    byId.set(document.id, document);
  });

  return [...byId.values()].sort((a, b) => getTimestamp(b.uploadedAt) - getTimestamp(a.uploadedAt));
};

/**
 * The three genetics answers a baseline can hold, trimmed, with empty
 * read as absent.
 *
 * These are paths the registration form posts. WHO a value here came
 * from is not decided in this function: it is the provenance marker's
 * answer, and the passport asks for it by path in `resolveValueOrigin`.
 *
 * Deliberately not `haplotype`: nothing on the passport family renders
 * a 单倍型 value, so reading one here would produce a string with no
 * row to print it in.
 */
const readBaselineDiseaseBackground = (baseline: unknown) => {
  const disease =
    baseline && typeof baseline === 'object'
      ? (baseline as Record<string, unknown>).diseaseBackground
      : null;
  const read = (key: string): string | null => {
    if (!disease || typeof disease !== 'object') return null;
    const raw = (disease as Record<string, unknown>)[key];
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    return text ? text : null;
  };
  return {
    diagnosisType: read('diagnosisType'),
    d4z4: read('d4z4'),
    methylation: read('methylation'),
  };
};

const buildReportInsights = (profile: PatientProfileDTO): ReportInsights => {
  const documents = profile.documents;
  const latestMri = collectMriDocuments(documents)[0] ?? null;
  const latestBlood = latestDocByTypes(documents, [
    'blood_panel',
    'biochemistry',
    'muscle_enzyme',
    'blood_routine',
    'thyroid_function',
    'coagulation',
    'urinalysis',
    'infection_screening',
    'stool_test',
    'abdominal_ultrasound',
  ]);
  const latestPhysicalExam = latestDocByType(documents, 'physical_exam');

  const geneticDoc = pickGeneticEvidenceDocument(documents);
  const geneticPayload = toPayload(geneticDoc?.ocrPayload);
  const geneticFields = geneticPayload?.fields;
  // WHOSE PAGE THESE READINGS ARE ON, asked once and carried, rather
  // than re-derived by each thing that speaks about them. The picker
  // takes a 病历摘要 quoting a repeat count when the laboratory's report
  // read out nothing — that is a decision about display, and this is
  // the fact everything downstream needs to keep the decision from
  // becoming a claim about a laboratory. See `GeneticRecordSource`.
  const geneticSource: GeneticRecordSource = !geneticDoc
    ? 'none'
    : isLaboratoryGeneticReport(geneticDoc)
      ? 'laboratory_report'
      : 'transcribed';
  const fromLaboratoryReport = geneticSource === 'laboratory_report';
  // One reader for the whole genetic block. The four values below used
  // to be plucked by four inline key lists that had drifted apart from
  // each other and from the writers; they now all come off the same
  // typed record, so「the passport says X」and「the grader says X」cannot
  // disagree. `geneticRecord` keeps `null` where the report is silent;
  // the placeholders are re-applied here because the string fields are
  // rendered directly and have always shown 「—」.
  const geneticRecord = buildGeneticRecord(
    geneticFields,
    geneticDoc?.id ?? null,
    geneticSource,
    geneticDoc ? (documentLabels[getDocumentType(geneticDoc)] ?? '上传的文件') : null,
  );
  // Each of the values below picks a source and, until this block
  // existed, threw away which one it picked — the defect every renderer
  // downstream then papered over by guessing. The picked value and the
  // slot that supplied it are built from the same expression here so
  // they cannot disagree.
  //
  // THE BASELINE IS A SOURCE FOR 分型, D4Z4 重复数 and 甲基化. The
  // patient's own registration form posts
  // `diseaseBackground.{diagnosisType,d4z4,methylation}`. A renderer
  // that reads the report alone prints 「—」 for values this platform
  // holds and sends out in the portable exports, on the same page whose
  // 字段来源 list names those fields by their Chinese labels. Which
  // source won is carried on the slot, so the bracket beside the number
  // names it.
  const disease = readBaselineDiseaseBackground(profile.baseline);
  const geneticTypeFromDocument = geneticRecord.geneticType;
  const geneticTypeFromBaseline = geneticTypeFromDocument ? null : disease.diagnosisType;
  const geneticTypeValue =
    geneticTypeFromDocument || geneticTypeFromBaseline || profile.geneticMutation || null;
  const haplotype = geneticRecord.haplotype || '—';
  const ecoRIFragment = geneticRecord.ecoRIFragment || '—';
  const d4z4FromDocument = geneticRecord.d4z4?.raw || null;
  const d4z4FromBaseline = d4z4FromDocument ? null : disease.d4z4;
  const d4z4Repeats = d4z4FromDocument || d4z4FromBaseline || '—';
  const methylationFromDocument = geneticRecord.methylationValue;
  const methylationFromBaseline = methylationFromDocument ? null : disease.methylation;
  const methylationValue = methylationFromDocument || methylationFromBaseline || '—';
  const diagnosisDateFromColumn = formatDate(profile.diagnosisDate);
  const diagnosisDateFromDocument = formatDate(pickReading(geneticFields, DIAGNOSIS_DATE_KEYS));
  const diagnosisDateValue = diagnosisDateFromColumn || diagnosisDateFromDocument || null;
  const geneticType = geneticTypeValue || '—';
  const diagnosisDate = diagnosisDateValue || '—';

  /** True when an uploaded document carries a field of this kind, which
   *  is the `ocrCouldHaveFilled` question. See DiagnosisValueSlot for
   *  why a superset is the safe answer. */
  const ocrCouldHaveFilled = (keys: readonly string[]) =>
    latestDocWithFields(documents, [...keys]) !== null;

  /** The slot for a value the picked document supplied, whichever kind
   *  of document that is. Built here so the four rows cannot disagree
   *  about which document they came off or about what it was. */
  const documentSlot = (): DiagnosisValueSlot => ({
    slot: 'document',
    documentId: geneticRecord.documentId,
    fromLaboratoryReport,
  });

  const diagnosisValueSlots: Record<PassportDiagnosisValueKey, DiagnosisValueSlot> = {
    geneticType: !geneticTypeValue
      ? { slot: 'absent' }
      : geneticTypeFromDocument
        ? documentSlot()
        : {
            slot: 'profile_column',
            // Null on the `patient_profiles.genetic_mutation` branch,
            // and only there: that column and the baseline field are
            // two different values, and the marker belongs to whichever
            // one is printed. See resolveValueOrigin.
            markerPath: geneticTypeFromBaseline ? 'diseaseBackground.diagnosisType' : null,
            ocrCouldHaveFilled: ocrCouldHaveFilled(GENETIC_FIELD_KEYS.geneticType),
          },
    d4z4Repeats: d4z4FromDocument
      ? documentSlot()
      : d4z4FromBaseline
        ? {
            slot: 'profile_column',
            markerPath: 'diseaseBackground.d4z4',
            ocrCouldHaveFilled: ocrCouldHaveFilled(GENETIC_FIELD_KEYS.d4z4Repeats),
          }
        : { slot: 'absent' },
    methylationValue: methylationFromDocument
      ? documentSlot()
      : methylationFromBaseline
        ? {
            slot: 'profile_column',
            markerPath: 'diseaseBackground.methylation',
            ocrCouldHaveFilled: ocrCouldHaveFilled(GENETIC_FIELD_KEYS.methylationValue),
          }
        : { slot: 'absent' },
    diagnosisDate: !diagnosisDateValue
      ? { slot: 'absent' }
      : diagnosisDateFromColumn
        ? {
            slot: 'profile_column',
            markerPath: 'foundation.diagnosisYear',
            ocrCouldHaveFilled: ocrCouldHaveFilled(DIAGNOSIS_DATE_KEYS),
          }
        : documentSlot(),
  };

  const mriDoc = latestMri;
  const mriPayload = toPayload(mriDoc?.ocrPayload);
  const mriFields = mriPayload?.fields;
  const mriGrade = pickField(mriFields, ['serratusFatigueGrade', 'serratus_fatigue_grade']);
  const mriImpression = pickField(mriFields, [
    'reportImpression',
    'report_impression',
    'impressionText',
    'impression_text',
  ]);
  const mriFinding = pickField(mriFields, ['findingText', 'finding_text']);
  const mriReportTime = pickField(mriFields, ['reportTime', 'report_time']);
  const mriSummary = mriGrade
    ? `前锯肌脂肪化等级 ${mriGrade}`
    : compactText(
        mriImpression ??
          mriFinding ??
          (typeof mriPayload?.extractedText === 'string'
            ? mriPayload.extractedText
            : typeof mriPayload?.extracted_text === 'string'
              ? mriPayload.extracted_text
              : ''),
        '暂无 MRI 分析数据',
      );

  const bloodDoc =
    latestBlood || latestDocContainingText(documents, ['ck', '肌酸激酶', 'ldh', 'mb', 'ckmb']);
  const bloodPayload = toPayload(bloodDoc?.ocrPayload);
  const bloodFields = bloodPayload?.fields;
  const bloodReportTime = pickField(bloodFields, ['reportTime', 'report_time']);
  const creatineKinase = pickField(bloodFields, ['creatineKinase', 'creatine_kinase', 'CK', 'ck']);
  const myoglobin = pickField(bloodFields, ['myoglobin', 'Mb', 'mb']);
  const ldh = pickField(bloodFields, ['LDH', 'ldh']);
  const ckmb = pickField(bloodFields, ['CKMB', 'ckmb']);
  const creatinine = pickField(bloodFields, ['creatinine']);
  const uricAcid = pickField(bloodFields, ['uricAcid', 'uric_acid']);
  const bloodParts: string[] = [];
  if (creatineKinase) bloodParts.push(`CK ${creatineKinase}`);
  if (myoglobin) bloodParts.push(`Mb ${myoglobin}`);
  if (ldh) bloodParts.push(`LDH ${ldh}`);
  if (ckmb) bloodParts.push(`CKMB ${ckmb}`);
  if (creatinine) bloodParts.push(`Cr ${creatinine}`);
  if (uricAcid) bloodParts.push(`UA ${uricAcid}`);
  const bloodSummary = bloodParts.join('，') || NO_STRUCTURED_RESULT.blood;

  const respiratoryDoc =
    latestDocByTypes(documents, ['pulmonary_function', 'diaphragm_ultrasound']) ||
    latestDocContainingText(documents, ['fvc', 'fev1', 'tlc', 'dlco', '肺功能', '膈肌']);
  const respiratoryPayload = toPayload(respiratoryDoc?.ocrPayload);
  const respiratoryFields = respiratoryPayload?.fields;
  const respiratoryReportTime = pickField(respiratoryFields, ['reportTime', 'report_time']);
  const respiratoryMetrics = [
    pickField(respiratoryFields, ['ventilatoryPattern', 'ventilatory_pattern']),
    pickField(respiratoryFields, ['fvcPredPct', 'fvc_pred_pct']),
    pickField(respiratoryFields, ['tlcPredPct', 'tlc_pred_pct']),
    pickField(respiratoryFields, ['dlcoPredPct', 'dlco_pred_pct']),
    pickField(respiratoryFields, ['diaphragmMotionSummary', 'diaphragm_motion_summary']),
  ].filter(Boolean) as string[];
  const respiratorySummary =
    respiratoryMetrics.length > 0
      ? respiratoryMetrics.join(' / ')
      : NO_STRUCTURED_RESULT.respiratory;

  const cardiacDoc =
    latestDocByTypes(documents, ['ecg', 'echocardiography']) ||
    latestDocContainingText(documents, ['ecg', 'echo', 'lvef', 'qtc', 'qrs', '心电', '超声心动']);
  const cardiacPayload = toPayload(cardiacDoc?.ocrPayload);
  const cardiacFields = cardiacPayload?.fields;
  const cardiacReportTime = pickField(cardiacFields, ['reportTime', 'report_time']);
  const cardiacMetrics = [
    pickField(cardiacFields, ['ecgSummary', 'ecg_summary']),
    pickField(cardiacFields, ['echoSummary', 'echo_summary']),
    pickField(cardiacFields, ['LVEF', 'lvef']),
    pickField(cardiacFields, ['QTc', 'qtc', 'qtcMs', 'qtc_ms']),
  ].filter(Boolean) as string[];
  const cardiacSummary =
    cardiacMetrics.length > 0 ? cardiacMetrics.join(' / ') : NO_STRUCTURED_RESULT.cardiac;

  const strengthDoc =
    latestPhysicalExam ||
    latestDocWithFields(documents, [
      'deltoidStrength',
      'bicepsStrength',
      'tricepsStrength',
      'quadricepsStrength',
      'tibialisStrength',
      'deltoid_strength',
      'biceps_strength',
      'triceps_strength',
      'quadriceps_strength',
      'tibialis_strength',
    ]);
  const strengthPayload = toPayload(strengthDoc?.ocrPayload);
  const strengthSummary = buildStrengthSummary(strengthPayload?.fields);

  // A JOIN, so the row can hold two sources at once: 单倍型, EcoRI 片段
  // and D4Z4 重复数 come straight off `geneticRecord`, while
  // `geneticType` falls back to the baseline and to
  // `patient_profiles.genetic_mutation`. `geneEvidenceOrigin` on the
  // summary is the bracket printed beside the joined string, and it is
  // built from `geneEvidenceFromDocument` rather than from a second
  // reading of these values, so the bracket cannot describe a different
  // string from the one printed.
  //
  // `geneticRecord` AND NOT the printed strings, for the reason
  // `geneticallyConfirmed` gives: `d4z4Repeats` below carries the
  // baseline too, and a bracket naming the picked document is one this
  // join earns only when that document supplied one of these three.
  // WHICH bracket — 报告读取 or 转录自非基因报告文件 — is the same
  // question the three rows themselves answer, and it is answered once,
  // where `geneEvidenceOrigin` is resolved.
  const documentOnlyEvidence = [
    geneticRecord.haplotype,
    geneticRecord.ecoRIFragment,
    geneticRecord.d4z4?.raw ?? null,
  ].filter((value): value is string => Boolean(value) && value !== '—');
  const geneEvidence = [geneticType, ...documentOnlyEvidence]
    .filter((value) => value && value !== '—')
    .join(' · ');

  return {
    geneticRecord,
    geneticType,
    haplotype,
    ecoRIFragment,
    d4z4Repeats,
    methylationValue,
    diagnosisDate,
    diagnosisValueSlots,
    geneEvidence: geneEvidence || NO_GENE_EVIDENCE,
    geneEvidenceFromDocument: documentOnlyEvidence.length > 0,
    latestGeneticDate: formatDate(geneticDoc?.uploadedAt ?? null),
    latestGeneticDocumentId: geneticDoc?.id ?? null,
    latestMriDate: formatDate(mriReportTime ?? mriDoc?.uploadedAt ?? null),
    latestMriDocumentId: mriDoc?.id ?? null,
    mriSummary,
    latestBloodDate: formatDate(bloodReportTime ?? bloodDoc?.uploadedAt ?? null),
    latestBloodDocumentId: bloodDoc?.id ?? null,
    bloodSummary,
    latestRespiratoryDate: formatDate(respiratoryReportTime ?? respiratoryDoc?.uploadedAt ?? null),
    latestRespiratoryDocumentId: respiratoryDoc?.id ?? null,
    respiratorySummary,
    latestCardiacDate: formatDate(cardiacReportTime ?? cardiacDoc?.uploadedAt ?? null),
    latestCardiacDocumentId: cardiacDoc?.id ?? null,
    cardiacSummary,
    strengthAverage: strengthSummary.average !== null ? strengthSummary.average.toFixed(1) : '—',
    strengthSummary: strengthSummary.summary ?? '暂无可用的肌力评估摘要',
  };
};

const scoreToWeaknessIntensity = (score: number | null) => {
  if (score === null) return 0;
  if (score >= 4.8) return 0;
  if (score >= 4) return 1;
  if (score >= 3) return 2;
  if (score >= 2) return 3;
  return 4;
};

const pushRegion = (
  regions: PassportBodyRegionMap,
  regionId: BodyRegionId,
  intensity: number,
  label?: string,
) => {
  const next = clamp(Math.round(intensity), 0, 4);
  if (next <= 0) return;
  const existing = regions[regionId];
  if (!existing || next > existing.intensity) {
    regions[regionId] = {
      intensity: next,
      label: label ?? BODY_REGION_LABELS[regionId],
    };
  }
};

const applyStrengthGroup = (
  regions: PassportBodyRegionMap,
  muscleGroup: string,
  intensity: number,
) => {
  if (intensity <= 0) return;
  switch (muscleGroup) {
    case 'deltoid':
      pushRegion(regions, 'leftShoulder', intensity, '肩带');
      pushRegion(regions, 'rightShoulder', intensity, '肩带');
      break;
    case 'biceps':
      pushRegion(regions, 'leftUpperArmFront', intensity, '上臂前群');
      pushRegion(regions, 'rightUpperArmFront', intensity, '上臂前群');
      break;
    case 'triceps':
      pushRegion(regions, 'leftUpperArmBack', intensity, '上臂后群');
      pushRegion(regions, 'rightUpperArmBack', intensity, '上臂后群');
      break;
    case 'quadriceps':
      pushRegion(regions, 'leftThighFront', intensity, '大腿前群');
      pushRegion(regions, 'rightThighFront', intensity, '大腿前群');
      break;
    case 'hamstrings':
      pushRegion(regions, 'leftThighBack', intensity, '大腿后群');
      pushRegion(regions, 'rightThighBack', intensity, '大腿后群');
      break;
    case 'gluteus':
      pushRegion(regions, 'leftGlute', intensity, '臀肌');
      pushRegion(regions, 'rightGlute', intensity, '臀肌');
      break;
    case 'tibialis':
      pushRegion(regions, 'leftShin', intensity, '小腿前群');
      pushRegion(regions, 'rightShin', intensity, '小腿前群');
      break;
    default:
      break;
  }
};

const pickLatestMeasurementsByGroup = (measurements: PatientProfileDTO['measurements']) => {
  const latest: Record<string, PatientProfileDTO['measurements'][number]> = {};
  measurements.forEach((measurement) => {
    const previous = latest[measurement.muscleGroup];
    if (!previous || getTimestamp(measurement.recordedAt) >= getTimestamp(previous.recordedAt)) {
      latest[measurement.muscleGroup] = measurement;
    }
  });
  return latest;
};

const buildBodyMapFromMeasurements = (measurements: PatientProfileDTO['measurements']) => {
  const latest = pickLatestMeasurementsByGroup(measurements);
  const regions: PassportBodyRegionMap = {};

  Object.entries(latest).forEach(([group, item]) => {
    const score = parseScore(String(item.strengthScore));
    applyStrengthGroup(regions, group, scoreToWeaknessIntensity(score));
  });

  return regions;
};

const textContains = (text: string, patterns: string[]) =>
  patterns.some((pattern) => text.includes(pattern));

const inferLateralityIntensity = (
  text: string,
  leftPatterns: string[],
  rightPatterns: string[],
) => {
  const hasLeft = textContains(text, leftPatterns);
  const hasRight = textContains(text, rightPatterns);
  if (hasLeft && hasRight) return { left: 3, right: 3 };
  if (hasLeft) return { left: 4, right: 2 };
  if (hasRight) return { left: 2, right: 4 };
  return { left: 3, right: 3 };
};

const inferMriBodyMap = (payload: OcrPayloadLike) => {
  const text = getPayloadText(payload);
  const regions: PassportBodyRegionMap = {};
  const findings: string[] = [];

  if (textContains(text, ['前锯', 'serratus'])) {
    pushRegion(regions, 'leftShoulder', 3, '肩带');
    pushRegion(regions, 'rightShoulder', 3, '肩带');
    findings.push('肩带/前锯肌受累');
  }

  if (textContains(text, ['臀', 'glute'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左臀', 'left glute', 'left buttock'],
      ['右臀', 'right glute', 'right buttock'],
    );
    pushRegion(regions, 'leftGlute', laterality.left, '臀肌');
    pushRegion(regions, 'rightGlute', laterality.right, '臀肌');
    findings.push('臀肌受累');
  }

  if (textContains(text, ['大腿后', '腘绳', 'hamstring'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左大腿后', '左腘绳', 'left hamstring'],
      ['右大腿后', '右腘绳', 'right hamstring'],
    );
    pushRegion(regions, 'leftThighBack', laterality.left, '大腿后群');
    pushRegion(regions, 'rightThighBack', laterality.right, '大腿后群');
    findings.push('大腿后群受累');
  }

  if (textContains(text, ['股四头', '大腿前', 'quadriceps'])) {
    pushRegion(regions, 'leftThighFront', 3, '大腿前群');
    pushRegion(regions, 'rightThighFront', 3, '大腿前群');
    findings.push('大腿前群受累');
  }

  if (textContains(text, ['胫前', 'tibialis', '趾长伸', 'extensor'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左胫前', 'left tibialis', '左小腿前'],
      ['右胫前', 'right tibialis', '右小腿前'],
    );
    pushRegion(regions, 'leftShin', laterality.left, '小腿前群');
    pushRegion(regions, 'rightShin', laterality.right, '小腿前群');
    findings.push('小腿前群受累');
  }

  if (textContains(text, ['腓肠', '比目鱼', 'gastrocnemius', 'soleus', '小腿后'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左腓肠', 'left gastrocnemius', '左小腿后'],
      ['右腓肠', 'right gastrocnemius', '右小腿后'],
    );
    pushRegion(regions, 'leftCalf', laterality.left, '小腿后群');
    pushRegion(regions, 'rightCalf', laterality.right, '小腿后群');
    findings.push('小腿后群受累');
  }

  if (textContains(text, ['面肌', '口轮匝肌', 'facial'])) {
    pushRegion(regions, 'face', 2, '面肌');
    findings.push('面肌受累');
  }

  return {
    regions,
    findings,
    hasFindings: Object.keys(regions).length > 0,
  };
};

const mergeBodyRegionMaps = (
  base: PassportBodyRegionMap,
  incoming: PassportBodyRegionMap,
): PassportBodyRegionMap => {
  const next = { ...base };

  Object.entries(incoming).forEach(([regionId, datum]) => {
    if (!datum) {
      return;
    }

    const key = regionId as BodyRegionId;
    const existing = next[key];
    if (!existing || datum.intensity > existing.intensity) {
      next[key] = datum;
    }
  });

  return next;
};

const buildAggregateMriBodyMap = (documents: PatientDocumentDTO[]) => {
  let regions: PassportBodyRegionMap = {};
  const findings = new Set<string>();

  documents.forEach((document) => {
    const inferred = inferMriBodyMap(toPayload(document.ocrPayload));
    regions = mergeBodyRegionMaps(regions, inferred.regions);
    inferred.findings.forEach((item) => findings.add(item));
  });

  return {
    regions,
    findings: [...findings],
    hasFindings: Object.keys(regions).length > 0,
  };
};

const summarizeBodyRegions = (regions: PassportBodyRegionMap, limit = 4) =>
  Object.values(regions)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, limit)
    .map((item) => item.label ?? '受累区域');

const getFreshness = (value?: string | null): PassportFreshnessDTO => {
  const date = formatDate(value);
  if (!date) {
    return { label: '缺失', tone: 'neutral', date: null, daysSince: null };
  }

  const timestamp = getTimestamp(date);
  if (!timestamp) {
    return { label: '未知', tone: 'neutral', date, daysSince: null };
  }

  const daysSince = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  if (daysSince <= 90) {
    return { label: '最新', tone: 'success', date, daysSince };
  }
  if (daysSince <= 180) {
    return { label: '待更新', tone: 'warning', date, daysSince };
  }
  return { label: '过期', tone: 'danger', date, daysSince };
};

const buildMonitoringItem = (input: {
  key: 'blood' | 'respiratory' | 'cardiac';
  title: string;
  summary: string;
  latestDate: string | null;
  latestDocumentId: string | null;
  note?: string;
}): PassportMonitoringItemDTO => {
  const available = hasMeaningfulValue(input.summary);
  // A document id is set whenever a report of this class was found,
  // whether or not the parser got anything structured out of it — so
  //「有 id、没有值」 is precisely「上传了，读不出来」. Derived here rather
  // than left for each consumer to infer, because the one consumer that
  // gets it wrong prints the answer on a card handed to an anesthetist.
  const state: PassportMonitoringItemDTO['state'] = available
    ? 'present'
    : input.latestDocumentId
      ? 'unreadable'
      : 'absent';
  return {
    key: input.key,
    title: input.title,
    available,
    summary: input.summary,
    latestDate: input.latestDate,
    latestDocumentId: input.latestDocumentId,
    freshness: getFreshness(input.latestDate),
    state,
    ...(input.note ? { note: input.note } : {}),
  };
};

const buildTimeline = (
  profile: PatientProfileDTO,
  latestMeasurementsByGroup: Record<string, PatientProfileDTO['measurements'][number]>,
  strengthAverage: string,
) => {
  const items: Array<{ sortKey: number; value: PassportTimelineItemDTO }> = [];

  profile.documents.forEach((document) => {
    const payload = toPayload(document.ocrPayload);
    items.push({
      sortKey: getTimestamp(document.uploadedAt),
      value: {
        id: `doc-${document.id}`,
        title: getDocumentDisplayTitle(document),
        description: compactText(
          typeof payload?.extractedText === 'string'
            ? payload.extractedText
            : typeof payload?.extracted_text === 'string'
              ? payload.extracted_text
              : document.fileName,
          '已上传报告',
          96,
        ),
        timestamp: document.uploadedAt,
        tag: '报告',
        documentId: document.id,
      },
    });
  });

  const latestMeasurementAt = Object.values(latestMeasurementsByGroup).reduce(
    (max, item) => Math.max(max, getTimestamp(item.recordedAt)),
    0,
  );
  if (latestMeasurementAt > 0) {
    items.push({
      sortKey: latestMeasurementAt,
      value: {
        id: 'measurement-latest',
        title: '肌力更新',
        description: `共 ${Object.keys(latestMeasurementsByGroup).length} 组，平均 ${strengthAverage} 级`,
        timestamp: new Date(latestMeasurementAt).toISOString(),
        tag: '肌力',
      },
    });
  }

  const latestActivity = [...profile.activityLogs].sort(
    (a, b) => getTimestamp(b.logDate) - getTimestamp(a.logDate),
  )[0] as PatientActivityLogDTO | undefined;
  if (latestActivity) {
    items.push({
      sortKey: getTimestamp(latestActivity.logDate),
      value: {
        id: `activity-${latestActivity.id}`,
        title: '最近活动记录',
        description: compactText(latestActivity.content, '已记录活动日志', 96),
        timestamp: latestActivity.logDate,
        tag: '活动',
      },
    });
  }

  return items
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, 6)
    .map((item) => item.value);
};

/** The unit a report printed its D4Z4 measurement in. `null` means the
 *  report printed a bare number and said nothing — which is the common
 *  case, and is NOT the same as knowing it meant repeat units. */
export type D4Z4Unit = 'repeats' | 'kb';

/**
 * What a D4Z4 measurement OCR'd off a genetics report actually says.
 *
 * `value` is non-null only for a single unambiguous number. Everything
 * else a real report prints —「1-10」,「≤10」,「4~7」,「1 至 10」,「未检出」—
 * lands as `value: null`, with `isRange` recording *why* so a caller can
 * tell「the lab gave an interval」apart from「there was nothing to read」.
 * That distinction is the whole reason this returns a record rather than
 * a number: an interval is a real, reportable finding that happens not
 * to pin down a count, and collapsing it to null loses the fact that a
 * test was done at all.
 */
export interface D4Z4Reading {
  raw: string;
  value: number | null;
  isRange: boolean;
  unit: D4Z4Unit | null;
}

export const parseD4Z4Reading = (raw: string | null | undefined): D4Z4Reading => {
  const text = (raw ?? '').trim();
  if (!text || text === '—') {
    return { raw: text, value: null, isRange: false, unit: null };
  }

  // Stated unit only. A bare「3」stays `null` rather than being assumed
  // to mean repeats: the two units differ by a factor of ~3.3 and the
  // guideline gives its thresholds in both, so guessing here would put
  // a wrong number in front of a clinician.
  const unit: D4Z4Unit | null = /kb|千碱基|kilobase/i.test(text)
    ? 'kb'
    : /个|重复|单元|unit|repeat/i.test(text)
      ? 'repeats'
      : null;

  // A comparison operator or a dash/CJK range word means the lab gave a
  // bound, not a count. Two numbers in the string mean the same thing
  //（「1-10」uses a plain hyphen, which is not in the operator class）.
  const bounded = /[<>≤≥~]|--|–|—|~|至|到/.test(text);
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  if (bounded || (numbers?.length ?? 0) > 1) {
    return { raw: text, value: null, isRange: true, unit };
  }
  if (!numbers || numbers.length !== 1) {
    return { raw: text, value: null, isRange: false, unit };
  }
  const value = Number(numbers[0]);
  return { raw: text, value: Number.isFinite(value) ? value : null, isRange: false, unit };
};

declare const REPORT_READ: unique symbol;

/**
 * A D4Z4 MEASUREMENT THIS PLATFORM READ OFF THE GENETICS LABORATORY'S
 * OWN REPORT.
 *
 * THE RULE THIS TYPE IS, in both of its dimensions:
 *
 *   A value that was not read out of an uploaded document at all may be
 *   DISPLAYED, always with its origin beside it, and may never decide a
 *   recommendation, a threshold, a guideline citation or a screening
 *   interval. That is the merge: `buildReportInsights` resolves the
 *   printed `d4z4Repeats` from a document OR from the baseline, where a
 *   number the patient typed into the registration form lands. Both are
 *   `string`, so nothing but a rule in someone's head keeps the merged
 *   one out of the branch that tells a patient to go pay for a dilated
 *   fundus exam.
 *
 *   AND a value read off a document that is not the laboratory's own
 *   report — a 病历摘要 transcribing a repeat count — may be displayed
 *   on the same terms, and may not decide those things either. A
 *   transcription is not a measurement, and 「你的 D4Z4 重复数为 3，属于
 *   指南所说的大片段缺失」 is a laboratory's sentence: printing it over a
 *   number a clinic letter quoted puts this platform's own reading of a
 *   guideline behind a value no laboratory here has stated.
 *
 * The brand is both rules expressed as a type. `laboratoryD4Z4` is the
 * only expression that mints one — from a record whose readings came
 * off a document, and only when that document is the report — so
 * neither a merged value nor a transcribed one can reach
 * `isLargeD4Z4Deletion` without an `as` cast that shows up in a diff.
 *
 * Phantom: nothing assigns the symbol at runtime, so the wire bytes of
 * `PassportGeneticRecordDTO` are unchanged and every reader that only
 * wants a `D4Z4Reading` still takes one.
 */
type ReportReadD4Z4 = D4Z4Reading & { readonly [REPORT_READ]: true };

/**
 * True only when the D4Z4 repeat count is unambiguously in the range the
 * AAN/AANEM guideline calls a large deletion.
 *
 * The guideline supplies both the size and its repeat equivalent in one
 * sentence — 「contracted D4Z4 allele of 10–20 kb or 1–4 repeats」 — so
 * the threshold here is quoted, not converted by us.
 *
 * The input is OCR'd off a genetics report, so it arrives as free text:
 *「3」,「3个」,「1-10」,「≤10」. A range or a comparison operator means we
 * do not know the number, and this gates a recommendation to go see an
 * ophthalmologist — so anything short of a single plain integer is
 * treated as unknown rather than guessed at.
 *
 * Takes `ReportReadD4Z4` rather than a string for the reason that type
 * carries: this function's answer IS an AAN Level B recommendation, so
 * its input has to be a report's own reading by construction.
 *
 * NOTE ON `unit`: this deliberately ignores it, so that the behaviour is
 * bit-for-bit what it was before `parseD4Z4Reading` existed. There is a
 * hand-kept copy of this function in the mobile bundle
 * (apps/mobile/lib/surveillance-schedule.ts) that cannot import from the
 * API package and is checked against the same table of cases; nothing in
 * the build links the two, so a semantic change here silently makes the
 * app and the passport disagree about whether to send someone to an
 * ophthalmologist. Requiring `unit !== 'kb'` would be defensible — 1–4
 * kb is not a viable EcoRI fragment — but it belongs in one change that
 * touches both copies, not this one.
 */
const isLargeD4Z4Deletion = (reading: ReportReadD4Z4 | null): boolean => {
  const value = reading?.value ?? null;
  // 0 repeats is not a viable FSHD1 allele; reading one means the
  // extraction is wrong, not that the deletion is enormous.
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 4;
};

/**
 * The 8–10 unit gray zone.
 *
 * Giardina et al. 2024 names this range and says what to do with it:
 * 8–10 U 4qA arrays are carried by roughly 1%–2% of the European
 * control population with no signs and no family history, so「a 4qA
 * repeat array of 8 U should be reported as likely pathogenic」rather
 * than pathogenic. A patient whose number lands here has a result that
 * carries its own uncertainty, and the product's job is to say so
 * instead of letting them read it as a verdict.
 *
 * Gated on `unit !== 'kb'` because the range is stated in repeat units.
 * An 8–10 kb EcoRI fragment is a different measurement entirely (a
 * severe contraction, not a borderline one) and must not be flagged as
 * borderline.
 */
export const isD4Z4GreyZone = (reading: D4Z4Reading | null): boolean =>
  reading !== null &&
  reading.value !== null &&
  Number.isInteger(reading.value) &&
  reading.unit !== 'kb' &&
  reading.value >= 8 &&
  reading.value <= 10;

/* ------------------------------------------------------------------- *
 * The structured genetic record, and the grade that comes out of it.
 * ------------------------------------------------------------------- */

/**
 * How the D4Z4 array was measured.
 *
 * Written by the report parser (`genetic_test_method` in
 * apps/report-manager/app/services/fshd_report_service.py), never
 * inferred here. The parser matches explicit method names in the body of
 * the report with its boilerplate tail already cut off, and emits
 * `ambiguous` when more than one family of markers hits — which lands in
 * `unknown` below, along with every value this file does not recognise
 * and every report parsed before the field existed.
 *
 * There is no text-scanning fallback in this file ON PURPOSE. A WES
 * report's limitations section routinely says the D4Z4 array needs
 * Southern blot, and a Southern blot report routinely names sequencing
 * as an alternative, so a keyword search over the whole payload
 * mislabels both — and the direction that matters is exactly the one it
 * would get wrong. 未知 is the honest answer for an unparsed report.
 */
export type GeneticTestMethod =
  | 'southern_blot'
  | 'optical_genome_mapping'
  | 'molecular_combing'
  | 'short_read_sequencing'
  | 'unknown';

const KNOWN_GENETIC_TEST_METHODS: ReadonlySet<string> = new Set([
  'southern_blot',
  'optical_genome_mapping',
  'molecular_combing',
  'short_read_sequencing',
]);

/** Methods that can size the repeat array at all. Giardina 2024 §6:
 *  「Analysis of long fragments can be by SB-PFGE …, OGM or MC.」 */
const SIZING_METHODS: ReadonlySet<GeneticTestMethod> = new Set<GeneticTestMethod>([
  'southern_blot',
  'optical_genome_mapping',
  'molecular_combing',
]);

/**
 * WHOSE PAGE THE READINGS IN A `PassportGeneticRecordDTO` ARE ON.
 *
 * `laboratory_report` — the document `pickGeneticEvidenceDocument`
 *   named is the genetics laboratory's own report. The only source that
 *   can earn a confirmation, an evidence grade, or a sentence written
 *   in a laboratory's voice.
 * `transcribed` — that document carries a genetic result without being
 *   the report: a 病历摘要 quoting a repeat count is the case this
 *   exists for. The picker takes one on purpose when the laboratory's
 *   report read out nothing, because for some patients it is the only
 *   copy of the number in existence. Its readings are DISPLAYED, with
 *   `PassportValueOriginKind.transcribed` beside them, and they are
 *   graded as what they are: a transcription, not a measurement.
 * `none` — no document. Not the same as `transcribed`: one says this
 *   platform holds a number it may not speak for, the other that it
 *   holds no number at all, and the grader owes those two different
 *   sentences.
 */
export type GeneticRecordSource = 'laboratory_report' | 'transcribed' | 'none';

export interface PassportGeneticRecordDTO {
  /** FSHD1 / FSHD2 as printed, or null. */
  geneticType: string | null;
  haplotype: string | null;
  /** True only for an unambiguous 4qA, false only for an unambiguous
   *  4qB, null when the field is missing OR names both — a report that
   *  lists「4qA/4qB」is naming its probes, not stating a result. */
  permissiveHaplotype: boolean | null;
  ecoRIFragment: string | null;
  /** The reading as the document printed it, for DISPLAY. Unbranded on
   *  purpose: what a guideline branch may consume is `laboratoryD4Z4`,
   *  which is null unless `source` says a laboratory wrote the page.
   *  See `ReportReadD4Z4`. */
  d4z4: D4Z4Reading | null;
  /** See isD4Z4GreyZone, and `laboratoryD4Z4` for why a transcribed
   *  count is never in the zone as far as this flag is concerned: the
   *  grey zone is a guideline's classification of a laboratory's
   *  number, and it is printed as one. Derived here rather than stored
   *  by the parser so it cannot drift from the number on screen:
   *  `d4z4Repeats` is one of the fields a patient may hand-correct
   *  after OCR, and a flag frozen at parse time would then contradict
   *  the corrected value. */
  greyZone: boolean;
  methylationValue: string | null;
  method: GeneticTestMethod;
  documentId: string | null;
  source: GeneticRecordSource;
  /** What this platform calls the document, for the one sentence that
   *  has to name it. Our own vocabulary (`documentLabels`) and never
   *  the OCR's own words, which reach a patient's screen elsewhere but
   *  have no business inside a sentence about evidence. Null when there
   *  is no document. */
  documentLabelZh: string | null;
}

export type GeneticEvidenceGrade =
  | 'not_tested'
  | 'method_not_applicable'
  | 'method_right_incomplete'
  /**
   * A genetic result is on file and only as somebody else's
   * transcription of it — see `GeneticRecordSource`.
   *
   * A GRADE OF ITS OWN rather than a fall to 未知, because the two
   * states owe the reader different sentences and one of them is
   * looking at a repeat count while he reads it. 未知's copy opens
   * 「还没有上传过基因报告，或者报告里没有能明确认出检测方法的字样」,
   * which does not account for the number printed three lines above it,
   * and its 《检查申请说明》 asks a clinic for a test this patient may
   * well have already had.
   */
  | 'transcribed_only'
  | 'trial_ready'
  | 'unknown';

export interface GeneticTestRequestSectionDTO {
  heading: string;
  body: string[];
  source: string;
}

/** 《检查申请说明》 — the page a patient hands across a clinic desk. */
export interface GeneticTestRequestDTO {
  title: string;
  intro: string;
  sections: GeneticTestRequestSectionDTO[];
  /** The same content flattened, for print / copy-to-clipboard. */
  printable: string;
}

export interface PassportGeneticEvidenceDTO {
  grade: GeneticEvidenceGrade;
  gradeLabel: string;
  headline: string;
  reason: string;
  action: string;
  record: PassportGeneticRecordDTO;
  /** Non-null only when the repeat count is in the 8–10 unit gray zone. */
  greyZoneNote: string | null;
  /** Null once the report already carries size AND haplotype — at that
   *  point there is nothing left to ask a clinic for. */
  testRequest: GeneticTestRequestDTO | null;
  sources: string[];
}

const SOURCE_GIARDINA_2024 =
  'Giardina E 等《面肩肱型肌营养不良基因诊断最佳实践指南：2012 版更新》，Clinical Genetics 2024;106(1):13-26，doi:10.1111/cge.14533';
const SOURCE_ZHANG_2019 =
  '张成、李欢《面-肩-肱型肌营养不良症研究进展史》，中国现代神经疾病杂志 2019 年 5 月第 19 卷第 5 期';
const SOURCE_XIA_2024 =
  'Xia X 等（复旦大学附属华山医院）摘要 642P，Neuromuscular Disorders 2024;43:104441';

/** 4qA / 4qB, read strictly. See `permissiveHaplotype`. */
const parsePermissiveHaplotype = (raw: string | null): boolean | null => {
  if (!raw) return null;
  const hasA = /4\s*q\s*a/i.test(raw);
  const hasB = /4\s*q\s*b/i.test(raw);
  if (hasA && !hasB) return true;
  if (hasB && !hasA) return false;
  return null;
};

const buildGeneticRecord = (
  fields: Record<string, unknown> | undefined,
  documentId: string | null,
  source: GeneticRecordSource,
  documentLabelZh: string | null,
): PassportGeneticRecordDTO => {
  // `pickReading` and not this file's `pickField`: the values below are
  // the ones the autofill writes into the baseline and the exports read
  // back, and a reader that stringified an array where a strict one
  // reports nothing would have the passport printing a value the export
  // says no report supplies.
  const d4z4Raw = pickReading(fields, GENETIC_FIELD_KEYS.d4z4Repeats);
  const d4z4 = d4z4Raw ? parseD4Z4Reading(d4z4Raw) : null;
  const haplotype = pickReading(fields, GENETIC_FIELD_KEYS.haplotype);
  const methodRaw = pickReading(fields, GENETIC_FIELD_KEYS.testMethod);

  return {
    geneticType: pickReading(fields, GENETIC_FIELD_KEYS.geneticType),
    haplotype,
    permissiveHaplotype: parsePermissiveHaplotype(haplotype),
    ecoRIFragment: pickReading(fields, GENETIC_FIELD_KEYS.ecoRIFragment),
    d4z4,
    // The zone is a guideline's reading of a laboratory's number, and
    // everything that consumes this flag prints it as one: a patient
    // whose 病历摘要 quotes 8 个重复 would be told the guideline calls
    // their result borderline, on the strength of a clinic letter.
    greyZone: source === 'laboratory_report' && isD4Z4GreyZone(d4z4),
    methylationValue: pickReading(fields, GENETIC_FIELD_KEYS.methylationValue),
    // Read off whatever document supplied the values, and consumed only
    // through `LaboratoryGeneticRecord` — a 病历摘要 that writes
    // 「Southern blot」 is transcribing a method, and a method decides a
    // grade. Kept as read rather than blanked, so the record says what
    // the document said.
    method:
      methodRaw && KNOWN_GENETIC_TEST_METHODS.has(methodRaw)
        ? (methodRaw as GeneticTestMethod)
        : 'unknown',
    documentId,
    source,
    documentLabelZh,
  };
};

declare const LABORATORY_READ: unique symbol;

/**
 * A RECORD WHOSE READINGS ARE THE GENETICS LABORATORY'S OWN.
 *
 * The second dimension of the rule `ReportReadD4Z4` carries, applied to
 * everything else in the record — 单倍型, EcoRI 片段, 检测方法 — because
 * the grader consumes all of them and a transcription can carry all of
 * them. `gradeGeneticEvidence`, `hasDeterminateSize`,
 * `hasHaplotypeResult` and `buildTestRequest` take this type and not
 * the DTO, so 「the grading path requires the laboratory」 is a fact the
 * compiler checks rather than a rule four call sites remember.
 *
 * Phantom, exactly like `ReportReadD4Z4`: nothing assigns the symbol,
 * the wire bytes are unchanged, and every reader that only wants to
 * display a record still takes the plain DTO.
 */
type LaboratoryGeneticRecord = PassportGeneticRecordDTO & {
  readonly [LABORATORY_READ]: true;
};

/** THE ONLY PLACE THE LABORATORY BRAND IS MINTED. */
const laboratoryRecord = (record: PassportGeneticRecordDTO): LaboratoryGeneticRecord | null =>
  record.source === 'laboratory_report' ? (record as LaboratoryGeneticRecord) : null;

/** THE ONLY PLACE `ReportReadD4Z4` IS MINTED. The reading came off a
 *  document's OCR payload — the baseline never reaches
 *  `buildGeneticRecord` — and that document is the laboratory's report.
 *  Both halves of the rule, in one expression. */
const laboratoryD4Z4 = (record: PassportGeneticRecordDTO): ReportReadD4Z4 | null => {
  const laboratory = laboratoryRecord(record);
  return laboratory?.d4z4 ? (laboratory.d4z4 as ReportReadD4Z4) : null;
};

/** A size the guideline would accept: a definite repeat count, or an
 *  EcoRI fragment length. A range is a real finding but not a size. */
const hasDeterminateSize = (record: LaboratoryGeneticRecord) =>
  (record.d4z4 !== null && record.d4z4.value !== null) || Boolean(record.ecoRIFragment);

const hasHaplotypeResult = (record: LaboratoryGeneticRecord) => record.permissiveHaplotype !== null;

/**
 * The four-level grade, plus 未知.
 *
 * The rules only ever UPGRADE on something explicit, and the one
 * downgrade — 方法不适用 — needs the parser to have named a short-read
 * method AND the report to carry no D4Z4 result at all. A Chinese
 * genetics report arrives as a photo of a low-contrast thermal print;
 * telling somebody their test was the wrong test on the strength of a
 * fuzzy match would send them to pay for a second one they may not need.
 * Anything that does not match falls to 未知.
 *
 * Report evidence outranks the self-reported ladder deliberately: a
 * patient who ticked 「临床诊断，还没做过基因检测」 and then uploaded a
 * Southern blot is graded on the blot.
 *
 * AND ONLY THE LABORATORY'S OWN REPORT IS REPORT EVIDENCE. Every rule
 * below reads `laboratory`, which is null for a 病历摘要 quoting a
 * repeat count — that document's readings are on the page, and the
 * grade they get is `transcribed_only`. Grading them on their content
 * is how a clinic letter came to be told it 「已经包含临床试验入组通常
 * 要求的两项内容」.
 */
const gradeGeneticEvidence = (
  record: PassportGeneticRecordDTO,
  ladder: DiagnosisLadderState | null,
): GeneticEvidenceGrade => {
  // Ahead of the ladder: a patient who ticked 「还没做过基因检测」 while a
  // 病历摘要 on file quotes their repeat count is not somebody this page
  // may call 未检测 — the number is printed on it. Ahead of the
  // laboratory rules too, which cannot fire, because this is the state
  // where there is no laboratory report to fire them on.
  if (record.source === 'transcribed') return 'transcribed_only';

  const laboratory = laboratoryRecord(record);
  if (laboratory) {
    const size = hasDeterminateSize(laboratory);
    const haplotype = hasHaplotypeResult(laboratory);

    if (laboratory.method === 'short_read_sequencing' && !size && !haplotype) {
      return 'method_not_applicable';
    }
    if (SIZING_METHODS.has(laboratory.method) || size || haplotype || laboratory.d4z4 !== null) {
      return size && haplotype ? 'trial_ready' : 'method_right_incomplete';
    }
  }
  // Nothing readable on file. The patient's own answer is the only
  // evidence left, and only three of the five rungs assert that no
  // genetic test has been done.
  if (
    ladder === 'untested_wants_test' ||
    ladder === 'untested_no_plan' ||
    ladder === 'clinical_only'
  ) {
    return 'not_tested';
  }
  return 'unknown';
};

const GENETIC_GRADE_LABELS: Record<GeneticEvidenceGrade, string> = {
  not_tested: '未检测',
  method_not_applicable: '方法不适用',
  method_right_incomplete: '方法对，但结果不全',
  // Says what this platform HAS, not what it is missing. 「未见基因报告」
  // would be false for the profile that reaches this grade most often:
  // a genetics report IS on file and read out nothing at all, which is
  // the one case where `pickGeneticEvidenceDocument` lets a
  // transcription through.
  transcribed_only: '仅有转录结果',
  trial_ready: '可用于入组',
  unknown: '未知',
};

const WHY_SHORT_READ_CANNOT: GeneticTestRequestSectionDTO = {
  heading: '为什么全外显子 / 全基因组测序读不到 FSHD',
  body: [
    'FSHD1 的病因是 4 号染色体 4q35 上 D4Z4 串联重复序列的拷贝数缩短。单个 D4Z4 单元长 3.3 kb，整段重复序列可长达 150 个单元（约 500 kb）。',
    '指南原文写明：D4Z4 重复序列的长度和单倍型「cannot be determined by short read WES- or WGS-like technologies」——短读长的全外显子、全基因组以及 panel 测序无法测定这两项。',
    '因此一份写着「未见明确致病变异」的全外显子报告，不能作为排除 FSHD 的依据：它测的不是这个位点。再做一次同类测序也不会有不同结果。',
  ],
  source: SOURCE_GIARDINA_2024,
};

const WHICH_TEST_INSTEAD: GeneticTestRequestSectionDTO = {
  heading: '能测出 FSHD1 的方法',
  body: [
    'Southern blotting：EcoR I + Bln I 双酶切基因组 DNA，脉冲场凝胶电泳（PFGE）或琼脂糖凝胶电泳，联合 p13E-11 探针，再结合 4qA / 4qB 探针判断单倍型。',
    '指南列出的可用于长片段分析的方法有三种：SB-PFGE（脉冲场电泳后的 Southern blot）、光学基因组图谱（optical genome mapping, OGM）、分子梳（molecular combing, MC）。',
    '国内已有开展：复旦大学附属华山医院 2017 年 1 月至 2023 年 12 月对 247 例 FSHD 表型患者做 OGM 或分子梳的 4qA 等位基因分析，其中 219 例据此确诊 FSHD1（重复单元 2–9 个）。',
    '需要提前知道的一点：SB-PFGE 与分子梳需要琼脂糖包埋制备的高质量 DNA，对操作和设备要求高，不是每家实验室都能做——问清楚再抽血，可以少跑一趟。',
  ],
  source: `${SOURCE_ZHANG_2019}；${SOURCE_GIARDINA_2024}；${SOURCE_XIA_2024}`,
};

const WHAT_THE_REPORT_MUST_SAY: GeneticTestRequestSectionDTO = {
  heading: '报告上需要写明的内容',
  body: [
    '一、4 号染色体 D4Z4 重复单元数（U），以及所用的检测方法；',
    '二、该等位基因的 4qA / 4qB 单倍型——只有 4qA 是允许型，缺了这一项，重复单元数本身不足以下结论；',
    '三、若重复单元数大于 10 而临床仍高度怀疑，需加做 D4Z4 甲基化分析与 SMCHD1 测序，以评估 FSHD2。',
    '指南写明：FSHD 的基因分析建立在确定 4 号与 10 号染色体 D4Z4 重复序列的「长度和单倍型」这两项之上；而临床试验的入组无一例外要求已确认的分子遗传学诊断。',
  ],
  source: SOURCE_GIARDINA_2024,
};

const buildGreyZoneSection = (repeats: number): GeneticTestRequestSectionDTO => ({
  heading: `关于 ${repeats} 个重复单元（8–10 灰区）`,
  body: [
    `你的报告是 ${repeats} 个重复单元，落在指南所说的「灰区」（gray zone）。`,
    '在欧洲对照人群中，约 1%–2% 的人携带 8–10 个单元的 4qA 等位基因，且没有任何症状和家族史；因此在没有家族史的情况下，这一区间通常并不致病。',
    '指南给出的报告口径是：8 个单元的 4qA 等位基因应报告为「likely pathogenic（可能致病）」，而不是「pathogenic（致病）」。',
    '指南同时举例指出，同样是 8 个单元，在欧洲患者中报告为可能致病，而在日本患者中致病性「less certain（不那么确定）」。指南没有给出中国人群的对应数据。',
    '这不是说你的诊断被推翻，而是说这一项结果本身带着不确定性，需要结合临床表现、家族史和甲基化结果一起看——如果医生没有主动提，可以问一句。',
  ],
  source: SOURCE_GIARDINA_2024,
});

const buildTestRequest = (
  laboratory: LaboratoryGeneticRecord | null,
  grade: GeneticEvidenceGrade,
): GeneticTestRequestDTO | null => {
  if (grade === 'trial_ready') return null;

  const sections: GeneticTestRequestSectionDTO[] = [];
  const transcribedOnly = grade === 'transcribed_only';
  // A DIFFERENT DOCUMENT FOR A DIFFERENT ASK. This patient's result
  // exists — somebody wrote it into a 病历摘要 — so the page they need
  // across a desk is the list of what the report has to state, to check
  // the copy they go and fetch against. The other two sections would
  // have a clinic re-ordering a test that may already have been done,
  // and 「为什么 WES 读不到」 is an answer to a question nobody has asked
  // here: no method is known, because the report was never read.
  if (transcribedOnly) {
    sections.push(WHAT_THE_REPORT_MUST_SAY);
  } else {
    // Only worth printing when the report was not already done by a
    // sizing method — telling somebody who had a Southern blot why WES
    // does not work wastes the page they are handing over. A profile
    // with no laboratory report on file has no method either, which is
    // the same 「not a sizing method」 this has always tested.
    if (!laboratory || !SIZING_METHODS.has(laboratory.method)) {
      sections.push(WHY_SHORT_READ_CANNOT);
    }
    if (!laboratory || !hasDeterminateSize(laboratory)) {
      sections.push(WHICH_TEST_INSTEAD);
    }
    sections.push(WHAT_THE_REPORT_MUST_SAY);
    if (laboratory?.greyZone && laboratory.d4z4?.value != null) {
      sections.push(buildGreyZoneSection(laboratory.d4z4.value));
    }
  }

  const title = 'FSHD（面肩肱型肌营养不良）基因检查申请说明';
  const intro = transcribedOnly
    ? '这份说明由患者本人带来。患者的病历类材料里写着基因检测的结果，但报告原件不在本平台手上，患者正在设法取回一份。下面这一节摘自国际 FSHD 基因诊断最佳实践指南，列出报告上需要写明的内容，供核对；如果原报告缺了其中某一项，通常不需要重新采血。'
    : '这份说明由患者本人带来，内容摘自国际 FSHD 基因诊断最佳实践指南与国内综述，供接诊医生参考。患者无法判断该开哪张单子，只是希望在开单之前，这几条与常规基因检测不同的地方能被看到。';

  const printable = [
    `【${title}】`,
    '',
    intro,
    '',
    ...sections.flatMap((section) => [
      `■ ${section.heading}`,
      ...section.body.map((line) => `  ${line}`),
      `  出处：${section.source}`,
      '',
    ]),
  ].join('\n');

  return { title, intro, sections, printable };
};

const buildGeneticEvidence = (
  record: PassportGeneticRecordDTO,
  ladder: DiagnosisLadderState | null,
): PassportGeneticEvidenceDTO => {
  const grade = gradeGeneticEvidence(record, ladder);
  // EVERY SENTENCE BELOW SPEAKS FOR A LABORATORY, so every value in one
  // comes off `laboratory` and never off `record`. The two differ by
  // exactly the case this branch exists for: a 病历摘要 carrying a
  // repeat count and a haplotype filled `record` with both, and the
  // copy read 「这份报告已经包含临床试验入组通常要求的两项内容」 over a
  // page no laboratory wrote.
  const laboratory = laboratoryRecord(record);
  // BOTH facts, not just size. This function rendered the patient-facing
  // copy while holding only one of the two things that copy talks about,
  // which is how it came to print 「已有单倍型（null）」.
  const size = laboratory !== null && hasDeterminateSize(laboratory);
  const haplotype = laboratory !== null && hasHaplotypeResult(laboratory);
  // The strings behind those two booleans, resolved beside them. `size`
  // is true only when one of the two is a non-empty string and
  // `haplotype` only when `laboratory.haplotype` parsed to a definite
  // 4qA / 4qB, so neither placeholder can reach a printed sentence —
  // and a branch that prints one without checking its flag would be
  // printing an empty string rather than 「null」.
  const sizeText = laboratory?.d4z4?.raw || laboratory?.ecoRIFragment || '';
  const haplotypeText = laboratory?.haplotype ?? '';

  let headline: string;
  let reason: string;
  let action: string;
  const sources: string[] = [SOURCE_GIARDINA_2024];

  switch (grade) {
    case 'not_tested':
      headline = '还没有做过能测出 FSHD 的基因检测';
      reason = `这一条来自你自己填的诊断进度：${
        ladder ? DIAGNOSIS_LADDER_LABELS[ladder] : '未填写'
      }。`;
      action =
        '下面这份《检查申请说明》可以直接给医生看——它写清了 FSHD 该做哪一项检查，以及为什么常规的全外显子测序测不到这个位点。';
      break;
    case 'method_not_applicable':
      headline = '你上传的这份报告，用的方法测不到 FSHD 的位点';
      reason =
        '报告里明确写着做的是全外显子 / 全基因组 / panel 这类短读长测序。指南原文：D4Z4 重复序列的长度和单倍型无法由短读长的 WES 或 WGS 类技术测定。';
      action =
        '所以这份报告即使结论是阴性，也不能用来排除 FSHD——它没有测这个位点。不需要再花一次钱做同类测序；下面这份说明写清了该换成哪一项。';
      break;
    case 'method_right_incomplete': {
      // Both facts are read independently, because this branch is
      // reached whenever ANY of {sizing method named, size present,
      // haplotype present, a D4Z4 reading of any kind} holds — so
      // 「not size」 does NOT imply 「haplotype」. Deriving both from the
      // single `size` boolean printed 「已有单倍型（null）」 for a report
      // whose only genetic content was a range like 「1-10」, and
      // 「已有单倍型（4qA/4qB）」 for a report naming its probes rather
      // than stating a result — which `parsePermissiveHaplotype`
      // deliberately reads as no result at all.
      //
      // That string is `reason`, and buildClinicalPassportExport prints
      // it as 「- 依据：…」 into the markdown a patient hands across a
      // desk. A neurologist who reads 「已有单倍型」 does not re-order the
      // haplotype assay — the exact half a molecular diagnosis needs.
      const missingParts: string[] = [];
      if (!size) missingParts.push('D4Z4 重复单元数');
      if (!haplotype) missingParts.push('4qA / 4qB 单倍型');
      const missing = missingParts.join('和');

      const presentParts: string[] = [];
      if (size) presentParts.push(`D4Z4 长度（${sizeText}）`);
      if (haplotype) presentParts.push(`单倍型（${haplotypeText}）`);

      headline =
        presentParts.length > 0
          ? `方法是对的，只差「${missing}」`
          : '方法是对的，但这两项结果都还没读到';
      reason =
        presentParts.length > 0
          ? `指南把 FSHD 的基因分析定义为两项：D4Z4 重复序列的长度，和它的 4qA / 4qB 单倍型。你的报告已有${presentParts.join('、')}，还没有看到${missing}。`
          : `指南把 FSHD 的基因分析定义为两项：D4Z4 重复序列的长度，和它的 4qA / 4qB 单倍型。报告用的是能测长度的方法，但这两项都还没读到——可能是报告本身没写，也可能是我们没能从图片里读出来。`;
      action =
        presentParts.length > 0
          ? '这一步很常见，大多数报告都停在这里。缺的这项通常不需要重新采血——原实验室多半可以在既有样本上补出结果、补发报告。下面的说明列出了需要补写的内容。'
          : '可以先对着报告原件核对一下这两项有没有写。如果确实没有，通常不需要重新采血——原实验室多半可以在既有样本上补出结果、补发报告。下面的说明列出了需要补写的内容。';
      sources.push(SOURCE_ZHANG_2019);
      break;
    }
    case 'transcribed_only': {
      // NAMES THE DOCUMENT AND DENIES NOTHING ELSE. 「没有上传过基因
      // 报告」 would be false for the profile that reaches this grade
      // most often — a genetics report on file that read out nothing is
      // exactly when the picker falls through to a transcription — and
      // 「这个数字可能不对」 is not what this platform knows either. What
      // it knows is which page it read, and that the page is not the
      // report.
      const from = record.documentLabelZh ?? '上传的文件';
      // SAYS WHICH DOCUMENT WAS READ, AND DOES NOT QUANTIFY OVER THE
      // PAGE. 「护照上的基因结果都来自这份文件」 is false in a state
      // that is not rare: a 病历摘要 carrying only a 单倍型, on a
      // profile whose D4Z4 重复数 sits in the archive, prints one row
      // from each — and this sentence would claim the archived one for
      // a document it never touched. What is true is which document
      // this platform read, and what that document is.
      headline = '这一段读的是转录件，本平台没有读到基因报告本身';
      reason = `本平台这次读的是你上传的「${from}」：上面转录了基因检测的结果，但它不是基因报告本身，转录也不是检测。指南把 FSHD 的基因分析定义为两项：D4Z4 重复序列的长度，和它的 4qA / 4qB 单倍型；这两项该由做检测的实验室在报告上写明。没有读到报告本身，本平台就不给这份证据评级，也不拿转录来的数字去套指南里按重复数分组的建议。`;
      action =
        '转录来的内容仍然印在护照上 —— 每一行后面的括号写着那一行的来源。如果基因报告在你手上，拍照上传，护照就会按报告本身来读；如果不在，可以向做这次检测的医院或医生要一份复印件——下面这份说明列出了报告上需要写明的内容，可以一起带去核对。';
      break;
    }
    case 'trial_ready':
      headline = '这份报告已经包含临床试验入组通常要求的两项内容';
      reason = `D4Z4 长度 ${sizeText}，单倍型 ${haplotypeText}。指南写明 FSHD 的基因分析基于确定重复序列的长度和单倍型两项，而临床试验入组要求已确认的分子遗传学诊断。`;
      action =
        '把它和临床护照一起带去就诊或报名筛选即可。具体是否符合某一项试验的入组标准，仍由该试验的研究者判断——这里只说明材料是齐的。';
      break;
    default:
      headline = '暂时判断不出你做的是哪一种基因检测';
      reason =
        '还没有上传过基因报告，或者报告里没有能明确认出检测方法的字样。这里不做猜测：猜错方向会让人白花一次检测的钱。';
      action =
        '如果你手上的报告写的是「全外显子测序」「全基因组测序」或某个基因 panel，那它测不到 FSHD 的位点，下面这份说明写清了该做哪一项；如果不确定，把报告拍照上传，或者带着这份说明去问接诊医生。';
      break;
  }

  return {
    grade,
    gradeLabel: GENETIC_GRADE_LABELS[grade],
    headline,
    reason,
    action,
    record,
    // The 1%–2% carrier figure is stated for the whole 8–10 range, but
    // the 「likely pathogenic」 reporting category is stated by Giardina
    // 2024 for 8 U only — and there as an ethnicity-dependent example.
    // Attributing it to the whole range put this note at odds with
    // buildGreyZoneSection ~140 lines up, which states it correctly,
    // and both surfaces are patient-facing.
    greyZoneNote: laboratory?.greyZone
      ? `你的 D4Z4 重复单元数是 ${laboratory.d4z4?.value}，落在指南所说的 8–10 单元灰区：这个区间的 4qA 等位基因在欧洲对照人群中约有 1%–2% 的人携带且无症状。${
          laboratory.d4z4?.value === 8
            ? '对 8 个单元，指南给出的报告口径是「可能致病」而不是「致病」。'
            : '指南只对 8 个单元给出了报告口径（「可能致病」而非「致病」），对 9–10 单元没有单独说明。'
        }这不推翻你的诊断，只是说这一项结果本身带着不确定性，值得和医生确认一次。`
      : null,
    testRequest: buildTestRequest(laboratory, grade),
    sources,
  };
};

/** The diagnosis ladder the patient answered on the baseline form, or
 *  null. Validated against the enum rather than cast: `baseline` is an
 *  untyped JSONB column, and rows predating migration-free rollout of
 *  the ladder simply do not have the key. */
/**
 * One word for who put a value here, for a page a clinician reads.
 *
 * `unreadable` is 「来源不明」 and never 「本人填写」 — the fallback that
 * looks harmless is the one that puts our own typing in the patient's
 * mouth. See BaselineFieldOrigin in baseline-provenance.ts.
 */
const passportOriginLabelZh = (origin: BaselineFieldOrigin): string => {
  switch (origin.state) {
    case 'admin_entered':
      return '管理员代填';
    case 'unreadable':
      return '来源不明';
    default:
      return '本人填写';
  }
};

const VALUE_ORIGIN_LABEL_ZH: Record<PassportValueOriginKind, string> = {
  report: '报告读取',
  // The bracket this passport prints, the noun the referral pack names
  // the document with, and the phrase the registry export writes into a
  // provenance sentence are one phrase, defined beside the question it
  // answers. See TRANSCRIBED_EVIDENCE_LABEL_ZH for why it names the
  // document class rather than the document.
  transcribed: TRANSCRIBED_EVIDENCE_LABEL_ZH,
  patient: '本人填写',
  admin_entered: '管理员代填',
  admin_unreadable: '非本人填写，来源不明',
  indeterminate: '来源无法确定',
  absent: '未填',
};

/**
 * WHAT THE PATIENT'S OWN FORM CAN DO TO EACH PRINTED VALUE.
 *
 * `none` — the 建档表单 reached from 我的 → 编辑资料
 *   (apps/mobile/screens/p-register_profile) draws no box for this
 *   value at all. The form spreads the baseline it loaded, so the
 *   value round-trips through a save untouched: no sequence of taps
 *   puts it in the changed set, and a patient sent to go fix it goes
 *   looking for a control that is not there and comes back with the
 *   same bracket still on the page a clinician reads.
 * `same_value` — a text box that holds exactly what the passport
 *   prints. What the patient types is what the row shows.
 * `narrower` — a box that moves the printed value without being able
 *   to state it. `sentenceZh` is what the reader is told instead of
 *   the plain 「你可以自己改」, because that sentence would send them
 *   to a screen where the value they are looking at is not editable
 *   in the shape it is printed in.
 *
 * READ BY `resolveValueOrigin`, NOT ONLY BY THE SENTENCE. It no longer
 * decides whether a value may be attributed to the patient — nothing
 * may, and that function says why — but it still decides which of the
 * 「来源无法确定」 sentences is true of the value, because 「你可能是自己
 * 填的」 read over a row with no box anywhere in the app offers the
 * reader a choice they never had. `narrower` counts as a control there:
 * a year the patient typed is something they can point at.
 *
 * `none` GETS NO SENTENCE AT ALL. 甲基化 is not in
 * `ADMIN_WRITABLE_BASELINE_FIELDS` and `applyAdminBaselineWrite`
 * refuses a write that changes it — a clear counts as a change, so the
 * back office cannot empty the field either. What does move it is a
 * report this platform can read the value off, and whether THAT is
 * something the reader can act on depends on the report's status, which
 * no passport surface holds. So the passport prints the value and its
 * bracket and stops; the instruction lives on 报告详情, which is
 * rendered from the document row and already branches on the status.
 *
 * A `Record` over every printed value, not a list of the exceptions: a
 * value added to the diagnosis block fails the build until somebody has
 * answered this question about it.
 */
type PatientDiagnosisControl =
  | { kind: 'none' }
  | { kind: 'same_value' }
  | { kind: 'narrower'; sentenceZh: string };

const PATIENT_DIAGNOSIS_VALUE_CONTROL: Record<PassportDiagnosisValueKey, PatientDiagnosisControl> =
  {
    /** `diseaseBackground.diagnosisType` — 「FSHD 分型」, free text. */
    geneticType: { kind: 'same_value' },
    /** `diseaseBackground.d4z4` — 「D4Z4 重复数（如有基因报告）」, free text. */
    d4z4Repeats: { kind: 'same_value' },
    /** `diseaseBackground.methylation` — no control anywhere in the
     *  patient's app, and none in the back office either. */
    methylationValue: { kind: 'none' },
    /**
     * `foundation.diagnosisYear`, which `upsertBaseline` mirrors into
     * `patient_profiles.diagnosis_date` — the column this row prints
     * ahead of any report's own 诊断日期, so the box does win.
     *
     * It wins with a year, though, and this row is a date. The form's
     * only diagnosis-time control is labelled 确诊年份, strips every
     * non-digit as you type and refuses anything but four of them, and
     * the mirror writes 1 January of that year. So the passport can
     * print 2019-05-03 — the autofill lifts a report's date into the
     * column, and nothing marks it as having come from there — over a
     * form whose box cannot be made to say anything but a year.
     * 「你可以自己改」 sends that reader to a screen with no 诊断日期 on
     * it, and if they save a year the date they were looking at silently
     * becomes 1 January of it.
     *
     * AND THE BOX CAN BE EMPTY WHILE THIS ROW PRINTS A DATE, which is
     * what the sentence used to deny. It said the date 「对应的是
     * 「确诊年份」」 and promised 「那一年的 1 月 1 日」 — both of which
     * presuppose a year sitting in the box. `applyGeneticReportAutofill`
     * fills `foundation.diagnosisYear` from the column at read time, so
     * for most profiles one is; but it returns the profile untouched
     * when the evidence report yields nothing at all, and a 诊断日期 can
     * reach `patient_profiles.diagnosis_date` through the patient's own
     * profile endpoint without ever passing through that field.
     * Rendered: a profile whose only genetics report parsed to a
     * 检测方法 and whose 病历摘要 carries the date — the 病历摘要 is not a
     * candidate for `pickGeneticEvidenceDocument` at all, so nothing
     * refills the box — prints 诊断日期 2019-05-03 above a sentence
     * sending the reader to a box that is blank.
     *
     * The sentence therefore no longer claims the printed date is in the
     * box. It names the box, says what the box CAN hold, and says what
     * saving a year does — all three true whether or not one is in there
     * now. What it still deliberately does NOT say is what clearing the
     * box does: the column goes null, the read-time autofill refills it
     * from the same report, and the date comes back — but only while a
     * report carrying one is on file, and this block cannot see whether
     * that is true for this reader.
     */
    diagnosisDate: {
      kind: 'narrower',
      sentenceZh:
        '护照上的诊断日期，在「我的 → 编辑资料」里没有一个直接显示它的框：那张表单上和它有关的只有「确诊年份」，只能填 4 位年份，里面填的未必就是这里印的日期。在那里填一个年份并保存，护照上的诊断日期就会变成那一年的 1 月 1 日。',
    },
  };

/** Chinese for the state where the patient's own typing and the OCR
 *  autofill are indistinguishable AND a document on file carries a
 *  field of this kind — which is what lets this sentence point at the
 *  patient's own uploads. The state where none does is the third
 *  constant below, and the difference matters: this wording read to
 *  somebody who has uploaded nothing names a report they do not have.
 *
 *  No surface prints a `PassportValueOriginDTO.detail` today — the
 *  renderers that read this type (`diagnosisRow`, `withValueOrigin`,
 *  `renderDiagnosisCell`, `diagnosisCard`) show `labelZh` and stop. It
 *  is written in Chinese anyway, and for a reader rather than a
 *  maintainer, because the day one of them does show it there must be
 *  nothing to translate first.
 *
 *  Note which type: `PassportFieldOriginDTO` also has a `detail`, and
 *  that one IS printed, inside 「来源记录读不出来（…）」. They are
 *  different fields on different types and a grep for `.detail` finds
 *  both — I confused them once while checking this very sentence. */
const AUTOFILL_INDETERMINATE_DETAIL =
  '这位患者上传的报告里也有这一项，而本平台在读取档案时会用报告里的值补上空着的栏位，且不留记录 —— 所以本平台分不清这一栏是患者自己填的，还是系统从报告里读来的。';

/** Chinese for the other road to 「来源无法确定」: a value the patient
 *  has no way to type at all.
 *
 *  The autofill sentence above offers the reader a choice between the
 *  patient and the OCR, and for a field with no control that choice
 *  has one real side — 甲基化 has no box on any patient form and no
 *  back-office write either, so a sentence naming the patient as a
 *  possible author would be false. What is knowable is narrower: the
 *  value sits in the archive, and this platform cannot say how it got
 *  there. Same note as above about `detail` on this type not being
 *  printed by any renderer yet, and about it being written in Chinese
 *  anyway. */
const NO_PATIENT_CONTROL_INDETERMINATE_DETAIL =
  '这一项在患者自己的表单里没有输入框，本平台的后台也不能代填，所以它不可能是患者自己录入的。护照上这个值来自档案，不是本平台此刻能从报告里读到的值 —— 它当初是怎么进到档案里的，本平台没有记录，确定不了。';

/**
 * Chinese for the third road to 「来源无法确定」: the archive holds the
 * value, the patient's form does have a box for it, and no document on
 * file carries a field of this kind.
 *
 * THIS IS THE STATE THAT USED TO RETURN 「本人填写」, and it is the one
 * baseline-provenance.ts names in as many words: no marker is a fact
 * about the provenance block and 「the patient typed this」 is a
 * different, stronger one. `applyGeneticReportAutofill` runs at read
 * time, copies the evidence report's readings into empty archive slots
 * and leaves nothing behind that says it did; the registration form
 * loads the profile it returns, so a patient saving that form persists
 * a number they never typed. The report behind it can afterwards be
 * deleted or re-parsed to nothing — and what remains is exactly this
 * state, byte for byte identical to the one a patient who typed the
 * number by hand produces. Two histories, one stored profile: rendered
 * side by side, both came out 「本人填写」.
 *
 * So the sentence says the two things that ARE provable — the value is
 * in the archive, and this platform has no record of how it got there —
 * and stops. Same note as above about `detail` on this type not being
 * printed by any renderer yet, and about it being written in Chinese
 * anyway.
 */
const UNRECORDED_ARCHIVE_INDETERMINATE_DETAIL =
  '护照上这个值取自档案，不是本平台此刻能从报告里读到的值。它是谁录进去的，本平台没有记录：没有管理员代填的标记，而「没有标记」只说明本平台这边没有记下来，不等于是患者自己填的 —— 读取档案时系统会拿报告里的值补上空着的栏位且不留记录，那份报告之后又可以被删掉或者重新解析成空的，剩下的就正是眼前这个样子。能确定的只有：值在档案里，怎么进去的确定不了。';

/**
 * Chinese for a value this platform read off a document that is not the
 * genetics laboratory's own report.
 *
 * The bracket says where the value came from; this says what follows
 * from that, because the two halves are not obvious together: the
 * number is shown, and it decides nothing. A reader who sees a repeat
 * count on a clinical passport and no guideline sentence keyed to it is
 * owed the reason, and 「本平台读不到」 is not the reason — we read it
 * fine, off a page the laboratory did not write.
 *
 * Same note as the constants below about `detail` on this type not
 * being printed by any renderer yet, and about it being written in
 * Chinese anyway.
 */
const TRANSCRIBED_VALUE_DETAIL =
  '这个值不是从基因报告上读到的，而是从你上传的另一份文件（例如病历摘要）里读到的转录内容。本平台仍然把它显示出来 —— 对一些患者来说，这是唯一一份写着这个数字的材料；但在没有读到基因报告本身之前，本平台不拿转录来的数字当作实验室的结论：不用它给基因证据分级，也不用它去判断指南里按重复数分组的那些建议。';

/**
 * The 补充基因检测报告 step, for the patient whose numbers are already
 * on the passport because a 病历摘要 quoted them.
 *
 * It asks for the same upload as the sentence it replaces and promises
 * something different by it, because for this reader the row is not
 * empty. What an upload changes is not whether the number is shown but
 * whether this platform may speak for it — which is also the only thing
 * every other surface has stopped doing about it.
 *
 * ADDRESSED BY THE BRACKET, like the sentences beside it, and not to
 * 「护照上这几个数字」: the block can print a transcribed 单倍型 above an
 * archived D4Z4 重复数, and a sentence that took the whole page would be
 * describing the archived row's origin as a document it never came off.
 */
const TRANSCRIBED_UPLOAD_STEP_ZH = `护照上标着「${VALUE_ORIGIN_LABEL_ZH.transcribed}」的那几项，是本平台从你上传的一份不是基因报告的文件里读到的转录内容。它们照常印在护照上，但在读到基因报告本身之前，本平台不会拿它们当作实验室的结论；把基因报告传上来，这一段才能按报告本身来写。`;

const valueOrigin = (
  kind: PassportValueOriginKind,
  extra: Partial<Omit<PassportValueOriginDTO, 'kind' | 'labelZh'>> = {},
): PassportValueOriginDTO => ({
  kind,
  labelZh: VALUE_ORIGIN_LABEL_ZH[kind],
  documentId: extra.documentId ?? null,
  adminUserId: extra.adminUserId ?? null,
  at: extra.at ?? null,
  detail: extra.detail ?? null,
});

/**
 * The slot plus the baseline marker, folded into one answer.
 *
 * `slot.markerPath` is the baseline field whose provenance entry is
 * about the value this slot PRINTED, and it comes off the slot because
 * only the expression that chose the value knows which store it came
 * from:
 *
 *   `diagnosisDate` — 'foundation.diagnosisYear'. `upsertBaseline`
 *     mirrors that field into `patient_profiles.diagnosis_date`
 *     (profile.service.ts), so an administrator writing it is how a
 *     marker and that column come to be about the same thing.
 *   `d4z4Repeats` / `methylationValue` — their own baseline paths.
 *     There is no column behind them; the value printed IS the
 *     baseline's, so its marker is the one that describes it.
 *   `geneticType` — 'diseaseBackground.diagnosisType' when the
 *     baseline supplied the value, and NULL when
 *     `patient_profiles.genetic_mutation` did. The only statements
 *     that write that column are `createProfile` and `updateProfile`,
 *     both of which serve the patient's own endpoint; `upsertBaseline`
 *     does not touch it. So on that branch the marker is about a
 *     different value than the one on the page, and using it would
 *     stamp an administrator's name onto the patient's own free text.
 *
 * A marker beats `ocrCouldHaveFilled`: both say 「not necessarily the
 * patient」, and the marker is the one that names somebody.
 *
 * NO BRANCH RETURNS `patient`, AND NONE MAY BE ADDED. Every road out of
 * the `profile_column` arm ends in `indeterminate`, differing only in
 * which sentence describes the state, because there is no state in
 * which this function can prove authorship. The archive is written by
 * the patient's form, by the back office and by the read-time OCR
 * autofill, and only the middle one records that it wrote — so the most
 * a silent provenance block establishes is that no ADMINISTRATOR is on
 * record, which is what baseline-provenance.ts means by 「absence is the
 * patient as a storage rule, and only as one」. A fallback from that
 * silence to the patient's name is the defect that regrew in a new
 * renderer in every review round of this branch, and it lived here
 * longest because this is the function the other renderers ask.
 *
 * `key` picks which of the three `indeterminate` sentences is true:
 *
 *   NO_PATIENT_CONTROL — the patient's app draws no box for this value
 *     and the back office may not write it either, so naming the
 *     patient as a possible author would be false.
 *   AUTOFILL — a box exists AND a document on file carries a field of
 *     this kind, so the autofill is a live alternative to their typing.
 *   UNRECORDED_ARCHIVE — a box exists and nothing on file carries such
 *     a field. Not a proof of typing: see that constant.
 */
const resolveValueOrigin = (
  key: PassportDiagnosisValueKey,
  slot: DiagnosisValueSlot,
  baseline: unknown,
): PassportValueOriginDTO => {
  if (slot.slot === 'absent') return valueOrigin('absent');
  if (slot.slot === 'document') {
    return slot.fromLaboratoryReport
      ? valueOrigin('report', { documentId: slot.documentId })
      : valueOrigin('transcribed', {
          documentId: slot.documentId,
          detail: TRANSCRIBED_VALUE_DETAIL,
        });
  }

  const marker = slot.markerPath ? readBaselineFieldOrigin(baseline, slot.markerPath) : null;
  if (marker?.state === 'admin_entered') {
    return valueOrigin('admin_entered', { adminUserId: marker.adminUserId, at: marker.at });
  }
  if (marker?.state === 'unreadable') {
    return valueOrigin('admin_unreadable', { detail: marker.detail });
  }
  if (PATIENT_DIAGNOSIS_VALUE_CONTROL[key].kind === 'none') {
    return valueOrigin('indeterminate', { detail: NO_PATIENT_CONTROL_INDETERMINATE_DETAIL });
  }
  return valueOrigin('indeterminate', {
    detail: slot.ocrCouldHaveFilled
      ? AUTOFILL_INDETERMINATE_DETAIL
      : UNRECORDED_ARCHIVE_INDETERMINATE_DETAIL,
  });
};

/** A printed value with its own source in brackets. Values with
 *  nothing to attribute are left alone — 「—（未填）」 is two ways of
 *  saying one thing.
 *
 *  Exported so the markdown export here and the referral pack print
 *  the same bracket: two documents from one app disagreeing about
 *  where one value came from is worse in front of a clinician than
 *  either wording on its own. */
export const withValueOrigin = (value: string, origin: PassportValueOriginDTO) =>
  origin.kind === 'absent' ? value : `${value}（${origin.labelZh}）`;

/**
 * Chinese for a 基因证据 row whose components do not share a source.
 *
 * `kind` alone would leave a clinician reading 「来源无法确定」 over a
 * string that contains a laboratory's own number.
 */
const MIXED_GENE_EVIDENCE_DETAIL =
  '这一行是几项拼起来的：单倍型、EcoRI 片段和 D4Z4 重复数来自上传的那份文件，分型这一项的来源写在它自己那一行上 —— 整行归不到同一个来源。';

/** How each printed diagnosis value is named in a sentence. Not
 *  exported: the DTO carries the origin, and a renderer that wanted
 *  these labels would be rebuilding the passport's own prose. */
const PASSPORT_DIAGNOSIS_VALUE_LABELS_ZH: Record<PassportDiagnosisValueKey, string> = {
  geneticType: '分型',
  d4z4Repeats: 'D4Z4 重复数',
  methylationValue: '甲基化',
  diagnosisDate: '诊断日期',
};

/** The origin kinds that mean 「this is not, or not provably, the
 *  patient's own entry」 — what the 补充基因检测报告 step's provenance
 *  sentences are about. `report` and `transcribed` need no such
 *  sentence: this platform read those values off a document and says so
 *  in the bracket. `absent` has no value to write one about; `patient`
 *  is listed nowhere because `resolveValueOrigin` no longer returns
 *  it. */
const NOT_PATIENT_ORIGIN_KINDS: readonly PassportValueOriginKind[] = [
  'admin_entered',
  'admin_unreadable',
  'indeterminate',
];

/** The marked baseline fields, flattened for the wire. Sorted by path
 *  because `listBaselineFieldOrigins` sorts, so a re-render of an
 *  unchanged profile is byte-identical. */
const collectPassportFieldOrigins = (baseline: unknown): PassportFieldOriginDTO[] =>
  listBaselineFieldOrigins(baseline).map(({ path, origin }) => ({
    path,
    labelZh: baselineFieldLabelZh(path),
    state: origin.state === 'admin_entered' ? 'admin_entered' : 'unreadable',
    adminUserId: origin.state === 'admin_entered' ? origin.adminUserId : null,
    at: origin.state === 'admin_entered' ? origin.at : null,
    detail: origin.state === 'unreadable' ? origin.detail : null,
  }));

const readDiagnosisLadder = (profile: PatientProfileDTO): DiagnosisLadderState | null => {
  const baseline = profile.baseline;
  if (!baseline || typeof baseline !== 'object') return null;
  const diseaseBackground = (baseline as Record<string, unknown>).diseaseBackground;
  if (!diseaseBackground || typeof diseaseBackground !== 'object') return null;
  const raw = (diseaseBackground as Record<string, unknown>).diagnosisLadder;
  return typeof raw === 'string' && (DIAGNOSIS_LADDER_STATES as readonly string[]).includes(raw)
    ? (raw as DiagnosisLadderState)
    : null;
};

/** Whole years old on the server clock, or null when no birth date is on file. */
const ageInYears = (dateOfBirth: string | null): number | null => {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
};

export const buildClinicalPassportSummary = (
  profile: PatientProfileDTO,
): ClinicalPassportSummaryDTO => {
  const reportInsights = buildReportInsights(profile);
  const mriDocuments = collectMriDocuments(profile.documents);
  const latestMeasurementsByGroup = pickLatestMeasurementsByGroup(profile.measurements);
  const measurementScores = Object.values(latestMeasurementsByGroup)
    .map((item) => parseScore(String(item.strengthScore)))
    .filter((value): value is number => value !== null);
  const strengthAverage =
    measurementScores.length > 0
      ? (
          measurementScores.reduce((sum, score) => sum + score, 0) / measurementScores.length
        ).toFixed(1)
      : reportInsights.strengthAverage;
  const strengthBodyRegions = buildBodyMapFromMeasurements(profile.measurements);
  const mriBodyMap = buildAggregateMriBodyMap(mriDocuments);

  const latestMeasurementAt = Object.values(latestMeasurementsByGroup).reduce<string | null>(
    (latest, item) =>
      getTimestamp(item.recordedAt) > getTimestamp(latest) ? item.recordedAt : latest,
    null,
  );

  const latestActivity = [...profile.activityLogs].sort(
    (a, b) =>
      Math.max(getTimestamp(b.logDate), getTimestamp(b.createdAt)) -
      Math.max(getTimestamp(a.logDate), getTimestamp(a.createdAt)),
  )[0];
  const latestActivityAt = latestActivity?.logDate ?? latestActivity?.createdAt ?? null;

  const latestDocumentAt = profile.documents.reduce<string | null>(
    (latest, document) =>
      getTimestamp(document.uploadedAt) > getTimestamp(latest) ? document.uploadedAt : latest,
    null,
  );

  const latestUpdatedAt = [
    profile.updatedAt,
    latestMeasurementAt,
    latestActivityAt,
    latestDocumentAt,
  ].reduce<string | null>(
    (latest, value) => (getTimestamp(value) > getTimestamp(latest) ? value : latest),
    null,
  );

  // Confirmation rests on a MEASUREMENT read off an uploaded report: a
  // D4Z4 repeat count, a 4q haplotype, an EcoRI fragment. 分型 and
  // 诊断日期 are excluded because neither is reliably the report's —
  // each falls back to a profile column (see DiagnosisValueSlot), and
  // which source actually supplied it on this passport is answered per
  // value in `valueOrigins` below rather than assumed here.
  //
  // READ OFF `geneticRecord`, NOT off the printed strings. Those
  // strings also carry the baseline, where a number the patient typed
  // into the registration form lands. Grading that as 基因确诊 would put
  // 「基因确诊」 on a referral pack over a number nobody at this platform
  // has seen a report for — the one direction this whole record exists
  // to prevent. `geneticRecord` reads document fields and nothing else,
  // so this stays a claim about a document; who supplied the printed
  // value is answered per value in `valueOrigins`.
  //
  // AND OFF THE LABORATORY'S RECORD, not any document's. A claim about
  // a document is still not a claim about a laboratory: the picker
  // takes a 病历摘要 quoting a repeat count when the genetics report
  // read out nothing, and this test — three fields, all of them
  // transcribable — then read 基因确诊 off the clinic's letter. The
  // number stays on the page with 「转录自非基因报告文件」 beside it;
  // what it stops earning is this.
  const geneticSource = reportInsights.geneticRecord.source;
  const laboratoryGeneticRecord = laboratoryRecord(reportInsights.geneticRecord);
  const geneticallyConfirmed =
    laboratoryGeneticRecord !== null &&
    (hasMeaningfulValue(laboratoryGeneticRecord.d4z4?.raw) ||
      hasMeaningfulValue(laboratoryGeneticRecord.haplotype) ||
      hasMeaningfulValue(laboratoryGeneticRecord.ecoRIFragment));
  const diagnosisClaimed =
    hasMeaningfulValue(reportInsights.geneticType) ||
    hasMeaningfulValue(reportInsights.diagnosisDate);
  // WHICH BASELINE VALUES ON THIS PAGE CARRY A MARKER. Only marked
  // fields get a row, so this is empty for the overwhelming majority of
  // profiles — which says nobody on our side recorded a write, not that
  // the patient typed everything.
  const fieldOrigins = collectPassportFieldOrigins(profile.baseline);
  // `!== 'patient'` and not `=== 'admin_entered'`: an entry that
  // exists and cannot be parsed is still not the patient's, and the
  // one thing this page may never do is fall back to their name.
  //
  // `confirmation` is derived from THIS ONE FIELD's marker, so
  // `admin_entered` means 「确诊年份 is not this patient's own entry」
  // and nothing about who typed 分型, 甲基化 or anything else on the
  // page. No string is written off it any more: authorship is per
  // value, in `valueOrigins` below, and per baseline field in
  // `fieldOrigins` beside it.
  const diagnosisYearOrigin = readBaselineFieldOrigin(profile.baseline, 'foundation.diagnosisYear');
  const diagnosisConfirmation: PassportDiagnosisConfirmation = geneticallyConfirmed
    ? 'genetic'
    : diagnosisClaimed
      ? diagnosisYearOrigin.state !== 'patient'
        ? 'admin_entered'
        : 'self_reported'
      : 'none';
  // WHERE EACH PRINTED DIAGNOSIS VALUE CAME FROM, resolved once here so
  // that the app, the share page, the referral pack and the PDF all
  // read the same answer instead of each inferring one from
  // `confirmation` — which is an evidence grade and says nothing about
  // authorship.
  const diagnosisValueOrigins: Record<PassportDiagnosisValueKey, PassportValueOriginDTO> = {
    geneticType: resolveValueOrigin(
      'geneticType',
      reportInsights.diagnosisValueSlots.geneticType,
      profile.baseline,
    ),
    d4z4Repeats: resolveValueOrigin(
      'd4z4Repeats',
      reportInsights.diagnosisValueSlots.d4z4Repeats,
      profile.baseline,
    ),
    methylationValue: resolveValueOrigin(
      'methylationValue',
      reportInsights.diagnosisValueSlots.methylationValue,
      profile.baseline,
    ),
    diagnosisDate: resolveValueOrigin(
      'diagnosisDate',
      reportInsights.diagnosisValueSlots.diagnosisDate,
      profile.baseline,
    ),
  };
  // 基因证据 is those values joined, so its bracket is the join's. A
  // join carrying a report-only value beside a 分型 of another origin
  // belongs to neither of them; a join that is 分型 by itself belongs
  // exactly where 分型 does — the same string carrying 「本人填写」 on the
  // 分型 row and 「来源无法确定」 on this one is one page disagreeing with
  // itself in front of a clinician.
  const geneticTypeOrigin = diagnosisValueOrigins.geneticType;
  // WHICH BRACKET THE DOCUMENT'S OWN VALUES EARN, asked once: the join
  // carries 单倍型, EcoRI 片段 and D4Z4 重复数 straight off the picked
  // document, so it earns exactly what those rows earn — 报告读取 when
  // the laboratory wrote the page, 转录自非基因报告文件 when it did not.
  // Hardcoding 'report' here printed a laboratory's bracket over a
  // transcription on the one row a clinician reads as a summary of all
  // of them.
  const documentOriginKind: PassportValueOriginKind =
    geneticSource === 'laboratory_report' ? 'report' : 'transcribed';
  const geneEvidenceOrigin: PassportValueOriginDTO = !reportInsights.geneEvidenceFromDocument
    ? geneticTypeOrigin
    : geneticTypeOrigin.kind === documentOriginKind || geneticTypeOrigin.kind === 'absent'
      ? valueOrigin(documentOriginKind, {
          documentId: reportInsights.latestGeneticDocumentId,
          detail: documentOriginKind === 'transcribed' ? TRANSCRIBED_VALUE_DETAIL : null,
        })
      : valueOrigin('indeterminate', { detail: MIXED_GENE_EVIDENCE_DETAIL });
  /** Which origin kinds this passport's diagnosis block actually
   *  contains, so a sentence about a state is written only when that
   *  state is on the page. */
  const diagnosisOriginKinds = new Set<PassportValueOriginKind>(
    Object.values(diagnosisValueOrigins).map((origin) => origin.kind),
  );
  /**
   * True when a row this block PRINTS wears the transcription bracket —
   * the four values plus the joined 基因证据 row, which is all of them.
   *
   * NOT the same question as 「the picked document is a transcription」,
   * which is what a sentence addressing 「标着「转录自非基因报告文件」的
   * 那几项」 was first gated on. Rendered: a 病历摘要 carrying only a
   * 单倍型, on a profile whose D4Z4 重复数 and 分型 sit in the archive —
   * the grade is still the transcription's, and every printed row says
   * 来源无法确定, so that sentence pointed the reader at rows that were
   * not on the page. The 单倍型 itself is printed inside the joined row,
   * whose bracket then belongs to the join.
   */
  const printsTranscribedValue =
    diagnosisOriginKinds.has('transcribed') || geneEvidenceOrigin.kind === 'transcribed';
  /** 「分型（报告读取）、诊断日期（管理员代填）」 — the printed diagnosis
   *  values with their own sources, for a sentence rather than a table.
   *  Values with nothing behind them are left out; a reader does not
   *  need a list of what is not there. */
  const diagnosisOriginPhrase = (
    Object.keys(PASSPORT_DIAGNOSIS_VALUE_LABELS_ZH) as PassportDiagnosisValueKey[]
  )
    .filter((key) => diagnosisValueOrigins[key].kind !== 'absent')
    .map(
      (key) =>
        `${PASSPORT_DIAGNOSIS_VALUE_LABELS_ZH[key]}（${diagnosisValueOrigins[key].labelZh}）`,
    )
    .join('、');
  /** The printed values that are not the patient's own entry, split by
   *  what the patient's form can do to them. The `none` half is named
   *  in no sentence at all: see the step's own comment for why it is
   *  left to 报告详情. */
  const notPatientValueKeys = (
    Object.keys(PASSPORT_DIAGNOSIS_VALUE_LABELS_ZH) as PassportDiagnosisValueKey[]
  ).filter((key) => NOT_PATIENT_ORIGIN_KINDS.includes(diagnosisValueOrigins[key].kind));
  const patientRewritableLabels = notPatientValueKeys
    .filter((key) => PATIENT_DIAGNOSIS_VALUE_CONTROL[key].kind === 'same_value')
    .map((key) => PASSPORT_DIAGNOSIS_VALUE_LABELS_ZH[key]);
  /** The values whose box cannot state what the row prints, each with
   *  its own sentence. Kept out of the joined list above rather than
   *  folded into it: 「你可以自己改」 read over a value whose control
   *  takes a different shape of answer is the falsehood this split
   *  exists to remove. */
  const narrowerControlSentences = notPatientValueKeys
    .map((key) => PATIENT_DIAGNOSIS_VALUE_CONTROL[key])
    .filter(
      (control): control is Extract<PatientDiagnosisControl, { kind: 'narrower' }> =>
        control.kind === 'narrower',
    )
    .map((control) => control.sentenceZh);
  /** The values that are 「来源无法确定」 while the patient's own form CAN
   *  state them — a different state, needing a different sentence, from
   *  a value carrying the same label because nobody at this platform can
   *  type it. The two are told apart by the control rather than by the
   *  label, exactly as `resolveValueOrigin` decides them. */
  const archiveIndeterminateLabels = notPatientValueKeys
    .filter(
      (key) =>
        PATIENT_DIAGNOSIS_VALUE_CONTROL[key].kind !== 'none' &&
        diagnosisValueOrigins[key].kind === 'indeterminate',
    )
    .map((key) => PASSPORT_DIAGNOSIS_VALUE_LABELS_ZH[key]);
  const diagnosisLadder = readDiagnosisLadder(profile);
  const diagnosisLadderOrigin = readBaselineFieldOrigin(
    profile.baseline,
    'diseaseBackground.diagnosisLadder',
  );
  const geneticEvidence = buildGeneticEvidence(reportInsights.geneticRecord, diagnosisLadder);
  // Completion counts confirmed diagnoses only — a progress ring that
  // fills on a self-entered date teaches the patient the document is
  // finished when its most load-bearing field is unverified.
  const diagnosisReady = geneticallyConfirmed;
  const motorReady =
    measurementScores.length > 0 ||
    profile.activityLogs.length > 0 ||
    hasMeaningfulValue(reportInsights.strengthSummary);
  const imagingReady = mriBodyMap.hasFindings || hasMeaningfulValue(reportInsights.mriSummary);
  const monitoringItems = [
    buildMonitoringItem({
      key: 'blood',
      title: '血检指标',
      summary: reportInsights.bloodSummary,
      latestDate: reportInsights.latestBloodDate,
      latestDocumentId: reportInsights.latestBloodDocumentId,
      // No guideline in the corpus asks for serial CK in FSHD. It shows
      // what you uploaded; it is not a progression measure.
      note: 'CK 等指标常用于诊断阶段。目前没有指南建议靠定期抽血来追踪 FSHD 的进展 —— 这一栏展示的是你已上传的结果。',
    }),
    buildMonitoringItem({
      key: 'respiratory',
      title: '肺功能',
      summary: reportInsights.respiratorySummary,
      latestDate: reportInsights.latestRespiratoryDate,
      latestDocumentId: reportInsights.latestRespiratoryDocumentId,
      // The one slot here that every FSHD patient is meant to have.
      // Second sentence is the anesthesia case, which is the reason a
      // patient with no symptoms might still need this on file.
      note: '指南建议每位 FSHD 患者都做一次肺功能基线。另外，如果要做全身麻醉的手术，术前应先查一次 —— 呼吸肌受累可能没有任何症状。',
    }),
    buildMonitoringItem({
      key: 'cardiac',
      title: '心脏检查',
      summary: reportInsights.cardiacSummary,
      latestDate: reportInsights.latestCardiacDate,
      latestDocumentId: reportInsights.latestCardiacDocumentId,
      // AAN Level C, stated as a condition rather than a schedule.
      // A patient who does have palpitations needs to know to act; a
      // patient who doesn't needs to know they can stop worrying about
      // an annual echo. The old panel gave both of them the same nudge.
      //
      // The surgical clause is not a hedge. Routine surveillance and
      // preoperative evaluation are different questions with different
      // answers, and only the first one is 「not essential」: Mani et al.
      // (AANA J, Oct 2025) call ECG and echo essential components of
      // the preoperative workup in FSHD, on a background of incomplete
      // RBBB in ~30% and mitral valve prolapse in ~25%. Without this
      // sentence the note is something a patient could hand to a
      // pre-op clinic as grounds to skip the ECG.
      note: '没有症状的 FSHD 患者不需要常规做心电图或心脏超声 —— 这一点和 DMD 等其他肌营养不良不同。两种情况例外：出现胸痛、心悸或不寻常的气短时应该去做心脏评估；以及手术前 —— FSHD 的术前评估应当包括心电图和心脏超声。',
    }),
  ];
  const monitoringReady = monitoringItems.some((item) => item.available);
  const completionCount = [diagnosisReady, motorReady, imagingReady, monitoringReady].filter(
    Boolean,
  ).length;
  // Everything a patient can put into the system counts as recorded
  // data — including the three sources this check used to miss.
  //
  // The daily followup form writes a function test (stair climb), a
  // symptom score (sleep) and, on a fall, a followup event. None of
  // those were listed here, so somebody who had faithfully logged
  // twenty followups and a fall still read as having recorded
  // nothing: passport id stuck at 待生成, PDF export greyed out, and
  // (once the visit-prep note landed) no way to draft it — for
  // exactly the patient with the clearest trend to bring to a clinic.
  const hasRecordedData =
    profile.measurements.length > 0 ||
    profile.activityLogs.length > 0 ||
    profile.documents.length > 0 ||
    profile.medications.length > 0 ||
    profile.functionTests.length > 0 ||
    profile.symptomScores.length > 0 ||
    profile.followupEvents.length > 0;

  const patientName = profile.fullName?.trim() || profile.preferredName?.trim() || '未命名病例';
  const passportId = hasRecordedData
    ? `FSHD-${profile.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`
    : '待生成';

  const strengthHighlights = summarizeBodyRegions(strengthBodyRegions);
  const mriHighlights = summarizeBodyRegions(mriBodyMap.regions);

  const nextSteps: PassportNextStepDTO[] = [];
  if (geneticEvidence.grade === 'method_not_applicable') {
    // Deliberately NOT the 「补充基因检测报告」 record step below. This
    // patient already uploaded a genetics report and already paid for a
    // test; asking them to upload another one reads as「your report was
    // not good enough」and points at a file picker. What they need is a
    // sentence to take to a doctor, which is what `clinical` means here.
    nextSteps.push({
      title: '这份报告用的方法测不到 FSHD',
      kind: 'clinical',
      description: `${geneticEvidence.reason}${geneticEvidence.action}`,
    });
  } else if (!geneticallyConfirmed) {
    nextSteps.push({
      title: diagnosisClaimed ? '补充基因检测报告' : '补充基因或诊断依据',
      kind: 'record',
      // Read by the PATIENT, and this is the reader most likely not to
      // know a value is sitting in their record at all. The values in
      // this block do not share an author — 分型 can have come off an
      // uploaded report while the marker behind `admin_entered` covers
      // 确诊年份 alone — so the sentence names each value's own source
      // and then explains only the states that are on this page.
      //
      // It says what the passport shows rather than what the platform
      // read: `buildReportInsights` takes its genetic values out of one
      // document, so a repeat count in an earlier report is never read
      // and 「没有从你上传的报告里读到」 would be a claim about reports
      // this passport has not opened.
      //
      // 「读出来的」 is load-bearing: a D4Z4 重复数 or 甲基化 typed into
      // the baseline IS printed on this passport, three lines from
      // here, so the bare 「护照上还没有」 would contradict a number the
      // reader can see. What is missing is a report this platform read
      // it off, which is also what `geneticallyConfirmed` tests.
      //
      // WHAT THIS STEP MAY SAY, AND WHY THAT IS LESS THAN IT USED TO.
      //
      // Whether 「go and correct it」 is true depends on which of four
      // sources the value came from, which of five surfaces is printing
      // this sentence, and which of five statuses the underlying report
      // is in. Nothing here knows the last one. `buildClinicalPassportSummary`
      // reads a profile; the report's status lives on the document row
      // and only 报告详情 branches on it. Four rounds of patches wrote
      // the instruction anyway and each one was true for some cells of
      // that product and false for others — rendered proof, not
      // reasoning: with the only report in `parse_failed`, `processing`
      // or `uploaded`, 报告详情 draws no 「识别有误？手动修正」 at all
      // (it renders that control for `parsed` and `needs_review` only)
      // and the correction endpoint rejects the patch; with two genetic
      // reports, this page is built from the one
      // `pickGeneticEvidenceDocument` names, so a correction landed on
      // the other one moves nothing here.
      //
      // So this step states what it knows — the value and its origin
      // bracket — and instructs only where it also knows the state that
      // decides whether the instruction works. That leaves exactly one
      // instruction: the patient's own form, for the values that have a
      // box on it. Everything else that used to be here is deleted
      // rather than hedged, including the pointer at a report: a
      // pointer is not an instruction but it can still be false, and
      // 「去那份报告看」 is false for a profile with no report at all —
      // which is the common shape for an archive value.
      //
      // The cost is one extra tap for a patient who wants to correct
      // 甲基化. The gain is that nothing on the page is false in the
      // reader's situation.
      description: diagnosisClaimed
        ? [
            `目前护照上的诊断信息：${diagnosisOriginPhrase}；护照上还没有从基因报告里读出来的 D4Z4 重复数、4q 单倍型或 EcoRI 片段，所以不能写成已确诊。`,
            // 什么时候 and not 是谁, because this sentence travels to
            // renderers that print one and not the other. The DTO
            // carries `adminUserId`, the markdown export prints it, and
            // the PDF and the passport screen — the two artefacts the
            // patient actually holds — print the date alone. Rendered
            // both: a marked profile's 字段来源 line comes out as 「「肌
            // 愈通」管理员于 … 代为录入」 with no account anywhere on the
            // page. Promising 是谁 there points at a name that is not
            // printed. `readBaselineFieldOrigin` demotes an entry whose
            // `at` is not a timestamp to `unreadable`, so the half that
            // is left is on every one of them.
            ...(diagnosisOriginKinds.has('admin_entered')
              ? [
                  `标着「${VALUE_ORIGIN_LABEL_ZH.admin_entered}」的那几项是本平台管理员代你录入的 —— 什么时候录的，护照的「字段来源」里有。`,
                ]
              : []),
            ...(diagnosisOriginKinds.has('admin_unreadable')
              ? [
                  `标着「${VALUE_ORIGIN_LABEL_ZH.admin_unreadable}」的那几项不是你自己填的，但那条来源记录本平台读不出来，原因写在护照的「字段来源」里。`,
                ]
              : []),
            // Named one by one rather than addressed as 「标着「来源无法
            // 确定」的那几项」: three different states print that one
            // label, and the one left out is the value the patient has
            // no way to type, which is left to its bracket.
            //
            // THE TWO THAT SHARE THIS SENTENCE ARE THE TWO WITH A BOX:
            // one where a document on file carries a field of this kind
            // and one where none does. The sentence used to describe
            // only the first — 「分不清是你自己填的，还是系统从你上传的
            // 报告里读来的」 — and read over the second it points at a
            // report the reader may not have: the autofill's source can
            // have been deleted or re-parsed since it wrote, and a
            // patient who never uploaded anything reaches this state
            // too. So it says where the value is kept and that the
            // platform has no record of how it got there, which is true
            // in both, and names the autofill as a possibility rather
            // than as a report on file.
            ...(archiveIndeterminateLabels.length > 0
              ? [
                  `${archiveIndeterminateLabels.join('、')}标着「${VALUE_ORIGIN_LABEL_ZH.indeterminate}」：这个值在你的档案里，本平台没有记下它是怎么进去的 —— 可能是你自己填的，也可能是系统读取档案时拿报告里的值补上的，补这一步不留记录。`,
                ]
              : []),
            // THE INSTRUCTIONS LEFT, AND WHY THEY SURVIVE.
            //
            // 「你可以自己改」 is a claim about a text box, and both
            // halves of that claim are things this function knows: what
            // the 建档表单 reached from 我的 → 编辑资料 draws a control
            // for (PATIENT_DIAGNOSIS_VALUE_CONTROL), and that the box's
            // value is what the row prints — every kind in
            // NOT_PATIENT_ORIGIN_KINDS is a kind where the slot was
            // `profile_column`, so no report's value is sitting in front
            // of it. Rendered: a marked 确诊年份 prints 2019-01-01, and
            // the same profile with the marker released and the year
            // changed prints the new date. The box wins.
            //
            // IT WINS WITH THE WRONG SHAPE OF ANSWER FOR 诊断日期,
            // which is why that value is no longer in this list and
            // carries its own sentence instead. See the table.
            //
            // WHAT WAS DELETED FROM THIS ONE was the second clause,
            // 「改过之后那一项就记回你名下」. That is a claim about the
            // bracket, not about the value, and rendering the after
            // state falsifies it: release the marker on 确诊年份 while
            // any uploaded document carries a diagnosis date, and
            // `ocrCouldHaveFilled` sends the origin to 「来源无法确定」
            // rather than 「本人填写」 — the passport then tells a patient
            // it cannot tell whether they typed a value they just typed.
            // The value moved; the attribution did not have to.
            ...(patientRewritableLabels.length > 0
              ? [
                  `${patientRewritableLabels.join('、')}如果不对，你可以在「我的 → 编辑资料」里自己改。`,
                ]
              : []),
            ...narrowerControlSentences,
            // 「上传基因检测报告后，护照才能显示 D4Z4 重复数」 is a
            // promise about a row this passport may already be filling.
            // A 病历摘要 quoting the count puts the number on the page
            // with 转录自非基因报告文件 beside it — the reader can see
            // it while being told it takes an upload to appear. What
            // the upload actually changes for that reader is the
            // register the number is printed in, so that is what the
            // sentence says.
            printsTranscribedValue
              ? TRANSCRIBED_UPLOAD_STEP_ZH
              : '上传基因检测报告后，护照才能显示 D4Z4 重复数等可供医生直接引用的证据。',
          ].join('')
        : printsTranscribedValue
          ? TRANSCRIBED_UPLOAD_STEP_ZH
          : '上传基因检测报告，护照才能展示 D4Z4 重复数、4q 单倍型等可引用的诊断证据。',
    });
  }
  if (geneticEvidence.grade === 'method_right_incomplete') {
    nextSteps.push({
      title: '问一下报告里缺的那一项',
      kind: 'clinical',
      description: `${geneticEvidence.headline}。${geneticEvidence.action}`,
    });
  }
  if (geneticEvidence.greyZoneNote) {
    nextSteps.push({
      title: '你的重复单元数在灰区，值得确认一次',
      kind: 'clinical',
      description: geneticEvidence.greyZoneNote,
    });
  }
  if (measurementScores.length === 0) {
    nextSteps.push({
      title: '补录结构化肌力',
      kind: 'record',
      description: '当前运动功能主要依赖 OCR 摘要，建议直接录入肌群评分。',
    });
  }
  if (!imagingReady) {
    nextSteps.push({
      title: '上传 MRI 报告',
      kind: 'record',
      description: '补齐 MRI 后，护照才能展示人体受累分布。',
    });
  }
  // What follows is keyed to the AAN/AANEM 2015 evidence-based guideline
  // (Evaluation, Diagnosis, and Management of FSHD) and cross-checked
  // against the Dutch FSHD guideline (Spierziekten Nederland, 2018).
  // Both are in the corpus under 02.临床管理与治疗. Changing any of these
  // means reading them again — not reasoning from other dystrophies,
  // where the answers are different.
  if (!hasMeaningfulValue(reportInsights.respiratorySummary)) {
    nextSteps.push({
      title: '补充肺功能基线',
      kind: 'clinical',
      // Level B: baseline PFT on ALL patients. Repeat testing is where
      // the condition lives — abnormal baseline, or severe proximal
      // weakness / kyphoscoliosis / wheelchair dependence / comorbid
      // lung or cardiac disease. The old copy promised「长期随访闭环」to
      // everyone, which is the follow-up schedule of the risk group.
      description:
        '指南建议所有 FSHD 患者做一次肺功能基线（FVC / FEV1）。是否需要定期复查，取决于基线是否异常，以及有没有明显的近端无力、脊柱侧弯、轮椅依赖或其他肺部疾病 —— 由医生判断，不是每个人都要长期反复做。',
    });
  }
  // Cardiac is deliberately NOT requested. AAN Level C: 「routine cardiac
  // screening is not essential in the absence of cardiac signs or
  // symptoms」, and its clinical context calls routine ECG/echo
  // 「unnecessary in patients with FSHD who are asymptomatic」. The 44-page
  // Dutch guideline does not contain the word cardiac at all.
  //
  // This block used to tell every patient 「补齐 ECG、LVEF、QTc，避免系统
  // 监测维度缺口」 and counted the absence as incomplete. These are
  // out-of-pocket tests here, and the passport was manufacturing the
  // gap it then asked them to close. FSHD is not DMD or myotonic
  // dystrophy; carrying their surveillance schedule over is the error.
  //
  // Removing the nudge is only half of it — a patient who does have
  // palpitations still has to be told to act. That version of the
  // recommendation lives on the cardiac monitoring item's `note`, as a
  // condition instead of a schedule.
  // THE LABORATORY'S OWN READING, OR NO RECOMMENDATION. `laboratoryD4Z4`
  // mints the branded reading (see `ReportReadD4Z4`) and mints nothing
  // for a count transcribed in a 病历摘要; the printed
  // `reportInsights.d4z4Repeats` beside it carries the baseline too and
  // does not type-check here either.
  const reportReadRepeats = laboratoryD4Z4(reportInsights.geneticRecord);
  const printedD4Z4Origin = diagnosisValueOrigins.d4z4Repeats;
  if (reportReadRepeats && isLargeD4Z4Deletion(reportReadRepeats)) {
    nextSteps.push({
      title: '问一次眼底检查',
      kind: 'clinical',
      // Level B, and gated on exactly the group it applies to: large
      // deletions. Exudative retinopathy (Coats disease) is rare in FSHD
      // but concentrated in this group, and untreated it can cost
      // vision that early treatment would have kept.
      //
      // The number quoted is the report's own reading, not the printed
      // string: the two are the same today because the merge prefers
      // the report, and a change to that preference must not be able to
      // slide a baseline value into this sentence.
      description: `你的 D4Z4 重复数为 ${reportReadRepeats.raw}，属于指南所说的大片段缺失。这一组患者的视网膜血管病变风险高于其他患者，指南建议由有经验的眼科医生做一次散瞳间接检眼镜检查，之后的复查频率按第一次的结果定。这不是急事，但值得在下次就诊时主动提出来。`,
    });
  } else if (printedD4Z4Origin.kind !== 'report' && printedD4Z4Origin.kind !== 'absent') {
    // SAID PLAINLY RATHER THAN OMITTED. The passport is printing a
    // repeat count and this block has just refused to answer the
    // guideline's question off it. Dropping the step silently would
    // leave a page that shows the number, cites the guideline elsewhere
    // and never says why the one recommendation keyed to that number is
    // missing — which reads as 「不适用」 to the patient and to the
    // clinician holding the printout.
    //
    // Fires on the count regardless of what it is: gating this on
    // whether the archived number falls in 1–4 would put the
    // guideline's classification back on the page, decided by the same
    // unverified value, with only the wording changed.
    nextSteps.push({
      title: '眼底检查这一条要看报告原件',
      kind: 'clinical',
      // 「这次没有从基因报告里读出这个数 —— 它取自你的档案」 and NOT
      // 「这个数不是从报告里读出来的」. `indeterminate` is the API's own
      // answer for 「the read-time OCR autofill copies a report's value
      // into an empty baseline field and leaves no record」, so the flat
      // negative is a claim `resolveValueOrigin` explicitly refuses to
      // make. What is true in every arm reached here is the slot: this
      // passport took the number out of the archive.
      //
      // WHAT WAS DELETED FROM THE END, AND WHY NOTHING REPLACES IT.
      //
      // 「把写着重复数的那份基因报告上传上来（本平台只读最新的一份基因
      // 报告），这一条就会有答案。」 The parenthesis stated a rule this
      // platform no longer has: `pickGeneticEvidenceDocument` ranks the
      // genetics laboratory's own report above a document quoting one,
      // a landed parse above an unlanded one and a richer report above
      // a thinner one, and reaches upload time only to separate
      // equals — so the newest report is routinely not the one that was
      // read. The promise attached to it went the same way: an upload
      // carrying the count wins nothing automatically, because a report
      // already on file can outrank it on any of those earlier keys.
      //
      // A corrected rule is not written in its place. The picker's order
      // is five keys deep and turns on a parse state this block cannot
      // see the outcome of, and a rule quoted from memory in a patient's
      // own words is what went stale here the first time. The step ends
      // where the true part ends: a doctor reading the original report.
      // TWO WAYS TO REACH THIS STEP, AND THEY ARE NOT THE SAME
      // SENTENCE. 「它取自你的档案」 is true of the origin kinds that
      // come out of the `profile_column` slot and false of the one that
      // does not: a count transcribed in a 病历摘要 was read off a page
      // this platform holds, and telling that reader to go look in
      // their archive sends them somewhere the number is not. What both
      // arms say — and all either of them may — is that the number did
      // not come off a genetics report, so this platform will not sort
      // them into the guideline's group with it.
      description: `护照上的 D4Z4 重复数是 ${withValueOrigin(
        reportInsights.d4z4Repeats,
        printedD4Z4Origin,
      )} —— ${
        printedD4Z4Origin.kind === 'transcribed'
          ? '这个数是本平台从你上传的一份文件里读到的转录内容，不是基因报告本身'
          : '本平台这次没有从基因报告里读出这个数，它取自你的档案'
      }。指南把散瞳间接检眼镜这一条限定在大片段缺失（1–4 个重复）的那一组人身上；你在不在这一组，本平台不拿一个自己没读过报告的数字来判断，这句话要医生看着报告原件说。`,
    });
  }
  const age = ageInYears(profile.dateOfBirth);
  if (age !== null && age <= 6) {
    nextSteps.push({
      title: '每年做一次听力筛查',
      kind: 'clinical',
      // Level B: screen all young children at diagnosis and yearly
      // until they start school. The reason it is age-gated rather than
      // universal: an adult notices their own hearing loss, an infant
      // cannot, and undetected loss at this age delays language.
      description:
        '指南建议儿童患者在确诊时以及之后每年做一次听力筛查，直到上学。年幼的孩子不会主动说自己听不清，而这个年龄段漏掉的听力损失会影响语言发育。',
    });
  }

  const summaryCards: PassportSummaryCardDTO[] = [
    {
      key: 'diagnosis',
      title: '诊断证据',
      ready: diagnosisReady,
      // 「以下为本人填写」 and 「以下由本平台管理员代填」 were both written
      // about the whole block off `confirmation` alone, and 以下 covers
      // rows whose value came off an uploaded report. The card now
      // states the evidence grade — which is what `confirmation` is —
      // and hands each value its own source.
      summary:
        diagnosisConfirmation === 'genetic'
          ? compactText(reportInsights.geneEvidence, reportInsights.geneticType, 86)
          : diagnosisClaimed
            ? `未经基因确诊（本护照内没有从基因报告里读出来的 D4Z4 重复数、4q 单倍型或 EcoRI 片段）—— ${diagnosisOriginPhrase}`
            : '缺少可直接展示的基因或诊断证据',
      meta: `诊断日期 ${reportInsights.diagnosisDate}`,
    },
    {
      key: 'motor',
      title: '运动功能',
      ready: motorReady,
      summary: motorReady
        ? `平均 ${strengthAverage} 级 · ${
            strengthHighlights.length > 0
              ? strengthHighlights.join('、')
              : reportInsights.strengthSummary
          }`
        : '缺少肌力或活动功能记录',
      meta: latestMeasurementAt
        ? `最近记录 ${formatDateLabel(latestMeasurementAt)}`
        : '尚无时间序列',
    },
    {
      key: 'imaging',
      title: 'MRI 受累',
      ready: imagingReady,
      summary: imagingReady
        ? mriHighlights.length > 0
          ? mriHighlights.join('、')
          : reportInsights.mriSummary
        : '缺少 MRI 报告或影像提取结果',
      meta:
        mriDocuments.length > 1
          ? `最近 MRI ${formatDateLabel(reportInsights.latestMriDate)} · 累计 ${mriDocuments.length} 份`
          : `最近 MRI ${formatDateLabel(reportInsights.latestMriDate)}`,
    },
    {
      key: 'monitoring',
      title: '系统监测',
      ready: monitoringReady,
      summary: monitoringReady
        ? monitoringItems
            .filter((item) => item.available)
            .map((item) => item.title)
            .join(' / ')
        : // Not「仍缺核心监测」. Of the three slots below, only the
          // pulmonary baseline is recommended for every FSHD patient;
          // cardiac testing is explicitly not, and no guideline in the
          // corpus asks for serial CK. An empty panel here means nothing
          // has been uploaded yet — it does not mean tests are overdue.
          '还没有上传过肺功能、心脏或血检报告',
      meta: `最近监测 ${formatDateLabel(
        [
          reportInsights.latestBloodDate,
          reportInsights.latestRespiratoryDate,
          reportInsights.latestCardiacDate,
        ].sort((a, b) => getTimestamp(b) - getTimestamp(a))[0] ?? null,
      )}`,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    passportId,
    patientName,
    hasRecordedData,
    latestUpdatedAt,
    completion: {
      completed: completionCount,
      total: 4,
    },
    metrics: [
      {
        label: '完整度',
        value: `${completionCount}/4`,
        hint: completionCount === 4 ? '已形成完整摘要' : '仍有模块待补齐',
      },
      {
        label: '报告数',
        value: String(profile.documents.length),
        hint: profile.documents.length > 0 ? '已纳入护照' : '尚无报告来源',
      },
      {
        label: '肌力组数',
        value: String(Object.keys(latestMeasurementsByGroup).length),
        hint: measurementScores.length > 0 ? `平均 ${strengthAverage} 级` : '尚无结构化肌力',
      },
      {
        label: '最近更新',
        value: formatDateLabel(latestUpdatedAt),
        hint: latestUpdatedAt ? '用于判断新鲜度' : '暂无时间戳',
      },
    ],
    summaryCards,
    fieldOrigins,
    diagnosis: {
      ready: diagnosisReady,
      latestSourceDate: reportInsights.latestGeneticDate,
      latestDocumentId: reportInsights.latestGeneticDocumentId,
      confirmation: diagnosisConfirmation,
      ladder: diagnosisLadder,
      ladderLabel: diagnosisLadder ? DIAGNOSIS_LADDER_LABELS[diagnosisLadder] : null,
      ladderOriginZh: diagnosisLadder ? passportOriginLabelZh(diagnosisLadderOrigin) : null,
      geneticEvidence,
      freshness: getFreshness(reportInsights.latestGeneticDate),
      geneticType: reportInsights.geneticType,
      d4z4Repeats: reportInsights.d4z4Repeats,
      methylationValue: reportInsights.methylationValue,
      diagnosisDate: reportInsights.diagnosisDate,
      valueOrigins: diagnosisValueOrigins,
      geneEvidence: reportInsights.geneEvidence,
      geneEvidenceOrigin,
    },
    motor: {
      ready: motorReady,
      average: strengthAverage,
      latestMeasurementAt,
      latestActivityAt,
      summary: reportInsights.strengthSummary,
      highlights: strengthHighlights,
      bodyRegions: strengthBodyRegions,
      activitySummary: compactText(latestActivity?.content, '暂无活动摘要', 120),
    },
    imaging: {
      ready: imagingReady,
      latestMriDate: reportInsights.latestMriDate,
      latestDocumentId: reportInsights.latestMriDocumentId,
      freshness: getFreshness(reportInsights.latestMriDate),
      summary: reportInsights.mriSummary,
      highlights: mriHighlights,
      bodyRegions: mriBodyMap.regions,
    },
    monitoring: {
      ready: monitoringReady,
      items: monitoringItems,
    },
    nextSteps,
    timeline: buildTimeline(profile, latestMeasurementsByGroup, strengthAverage),
  };
};

const escapeMarkdown = (value: string) => value.replace(/\|/g, '\\|');

export const buildClinicalPassportExport = (
  summary: ClinicalPassportSummaryDTO,
): ClinicalPassportExportDTO => {
  const lines = [
    `# ${summary.patientName} 临床护照摘要`,
    '',
    `- 护照 ID：${summary.passportId}`,
    `- 生成时间：${summary.generatedAt}`,
    `- 最近更新：${summary.latestUpdatedAt ?? '—'}`,
    `- 完整度：${summary.completion.completed}/${summary.completion.total}`,
    '',
    '## 核心摘要',
    '',
    '| 模块 | 状态 | 摘要 |',
    '| --- | --- | --- |',
    ...summary.summaryCards.map(
      (card) =>
        `| ${escapeMarkdown(card.title)} | ${card.ready ? '已就绪' : '待补齐'} | ${escapeMarkdown(card.summary)} |`,
    ),
    '',
    '## 诊断证据',
    '',
    // §B3 again: the export carries the source too. Per value, because
    // the lines below do not share one.
    `- 基因类型：${withValueOrigin(
      summary.diagnosis.geneticType,
      summary.diagnosis.valueOrigins.geneticType,
    )}`,
    `- D4Z4 重复数：${withValueOrigin(
      summary.diagnosis.d4z4Repeats,
      summary.diagnosis.valueOrigins.d4z4Repeats,
    )}`,
    `- 甲基化值：${withValueOrigin(
      summary.diagnosis.methylationValue,
      summary.diagnosis.valueOrigins.methylationValue,
    )}`,
    `- 诊断日期：${withValueOrigin(
      summary.diagnosis.diagnosisDate,
      summary.diagnosis.valueOrigins.diagnosisDate,
    )}`,
    `- 证据摘要：${withValueOrigin(
      summary.diagnosis.geneEvidence,
      summary.diagnosis.geneEvidenceOrigin,
    )}`,
    // 「本人填写的诊断进度」 was hardcoded here. The renderer had no way
    // to check it, and it is exactly the claim baseline-provenance.ts
    // exists to stop being made blind.
    ...(summary.diagnosis.ladderLabel
      ? [
          `- 诊断进度${summary.diagnosis.ladderOriginZh ? `（${summary.diagnosis.ladderOriginZh}）` : ''}：${
            summary.diagnosis.ladderLabel
          }`,
        ]
      : []),
    '',
    // §B3: the export must carry the source too, not only the app. The
    // section is emitted only when something is marked — a 「无」 under a
    // standing heading is how a reader learns to skip the heading.
    ...(summary.fieldOrigins.length > 0
      ? [
          '### 这些字段不是本人填写的',
          '',
          ...summary.fieldOrigins.map((origin) =>
            origin.state === 'admin_entered'
              ? `- ${origin.labelZh}：本平台管理员于 ${origin.at ?? '未记录时间'} 代为录入（管理员账号 ${
                  origin.adminUserId ?? '未记录'
                }）`
              : `- ${origin.labelZh}：来源记录读不出来（${origin.detail ?? '原因未记录'}），只能确定不是本人填写`,
          ),
          '',
        ]
      : []),
    // The grade and the request note are the reason this export exists.
    // A neurologist reading the page needs to know not just what the
    // report said but whether the method could have said it — a
    // negative short-read report presented alongside 「诊断证据」 with
    // no qualifier is exactly the anchor that produces second wasted
    // tests.
    '### 基因证据分级',
    '',
    `- 分级：${summary.diagnosis.geneticEvidence.gradeLabel}`,
    `- ${summary.diagnosis.geneticEvidence.headline}`,
    `- 依据：${summary.diagnosis.geneticEvidence.reason}`,
    `- 下一步：${summary.diagnosis.geneticEvidence.action}`,
    ...(summary.diagnosis.geneticEvidence.greyZoneNote
      ? [`- 灰区提示：${summary.diagnosis.geneticEvidence.greyZoneNote}`]
      : []),
    ...summary.diagnosis.geneticEvidence.sources.map((source) => `- 出处：${source}`),
    '',
    ...(summary.diagnosis.geneticEvidence.testRequest
      ? [
          `### ${summary.diagnosis.geneticEvidence.testRequest.title}`,
          '',
          summary.diagnosis.geneticEvidence.testRequest.intro,
          '',
          ...summary.diagnosis.geneticEvidence.testRequest.sections.flatMap((section) => [
            `**${section.heading}**`,
            '',
            ...section.body.map((line) => `- ${line}`),
            `- 出处：${section.source}`,
            '',
          ]),
        ]
      : []),
    '## 运动功能',
    '',
    `- 平均肌力：${summary.motor.average} 级`,
    `- 重点区域：${summary.motor.highlights.join('、') || '暂无结构化分布'}`,
    `- 活动摘要：${summary.motor.activitySummary}`,
    '',
    '## MRI 受累',
    '',
    `- 最近 MRI：${summary.imaging.latestMriDate ?? '—'}`,
    `- 影像摘要：${summary.imaging.summary}`,
    `- 重点区域：${summary.imaging.highlights.join('、') || '暂无可视化分布'}`,
    '',
    '## 系统监测',
    '',
    // The note carries whether the test is indicated at all. Dropping it
    // here would leave the markdown export saying「心脏检查：暂无数据，
    // 缺失」with nothing to distinguish 'not done' from 'not needed'.
    ...summary.monitoring.items.flatMap((item) => [
      `- ${item.title}：${item.summary}（${item.latestDate ?? '无日期'}，${item.freshness.label}）`,
      ...(item.note ? [`  - ${item.note}`] : []),
    ]),
    '',
    '## 待补项',
    '',
    ...(summary.nextSteps.length > 0
      ? summary.nextSteps.map((item) => `- ${item.title}：${item.description}`)
      : ['- 当前没有明显缺口']),
    '',
    '## 最近来源',
    '',
    ...summary.timeline.map(
      (item) => `- [${item.tag}] ${item.title}（${item.timestamp}）：${item.description}`,
    ),
    '',
  ];

  const safeName = summary.patientName.replace(/[^\p{L}\p{N}_-]+/gu, '_');

  return {
    generatedAt: new Date().toISOString(),
    documentTitle: `${summary.patientName} 临床护照摘要`,
    fileName: `${safeName || 'patient'}-clinical-passport.md`,
    contentType: 'text/markdown',
    markdown: lines.join('\n'),
  };
};
