import type { Pool, PoolClient } from 'pg';
import {
  cancelAccountDeletion,
  getAccountDeletionStatus,
  purgeDueAccountDeletions,
  requestAccountDeletion,
  type DeletionRequestStatus,
} from './account-deletion.js';
import { applyGeneticReportAutofill } from './profile.autofill.js';
import {
  buildClinicalPassportExport,
  buildClinicalPassportSummary,
  type ClinicalPassportExportDTO,
  type ClinicalPassportSummaryDTO,
} from './profile.passport.js';
import type {
  ActivityLogInput,
  BaselineProfileInput,
  CreateSubmissionInput,
  CreateProfileInput,
  DailyImpactInput,
  DeletableRecordKind,
  FollowupEventInput,
  FunctionTestInput,
  MeasurementInput,
  MedicationInput,
  SymptomScoreInput,
  UpdateProfileInput,
} from './profile.schema.js';
import {
  SharingPreferenceMutationError,
  getSharingPreferences,
  updateSharingPreferences,
  type SharingPreferences,
  type SharingPreferenceUpdateInput,
} from './sharing-preferences.js';
import type { AppLogger } from '../../config/logger.js';
import { maskAuditPayload } from '../../services/audit/identity-masking.js';
import { AppError } from '../../utils/app-error.js';
import {
  ConsentMutationError,
  getConsentDetails,
  getConsentHistory,
  getConsentStatus,
  updateConsent,
  type ConsentDetails,
  type ConsentEvent,
  type ConsentHistoryOptions,
  type ConsentStatus,
  type ConsentUpdateInput,
} from '../ai-agents/security/index.js';

interface ServiceDeps {
  pool: Pool;
  logger: AppLogger;
}

interface PatientProfileRecord {
  id: string;
  user_id: string;
  full_name: string | null;
  preferred_name: string | null;
  date_of_birth: string | Date | null;
  gender: string | null;
  patient_code: string | null;
  diagnosis_stage: string | null;
  diagnosis_date: string | Date | null;
  genetic_mutation: string | null;
  height_cm: string | null;
  weight_kg: string | null;
  blood_type: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  primary_physician: string | null;
  region_province: string | null;
  region_city: string | null;
  region_district: string | null;
  baseline_payload: Record<string, unknown> | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PatientMeasurementDTO {
  id: string;
  muscleGroup: string;
  metricKey: string | null;
  bodyRegion: string | null;
  side: string | null;
  strengthScore: number;
  method: string | null;
  entryMode: string | null;
  deviceUsed: string | null;
  notes: string | null;
  recordedAt: string;
  createdAt: string;
  submissionId: string | null;
}

export interface PatientFunctionTestDTO {
  /** 「今天做不了」— attempted and could not be completed.
   *  Distinct from a missing row; see migration 017. */
  notApplicable?: boolean;
  id: string;
  testType: string;
  measuredValue: number | null;
  side: string | null;
  protocol: string | null;
  unit: string | null;
  deviceUsed: string | null;
  assistanceRequired: boolean | null;
  notes: string | null;
  performedAt: string;
  createdAt: string;
  submissionId: string | null;
}

export interface PatientActivityLogDTO {
  id: string;
  logDate: string;
  source: string;
  content: string | null;
  moodScore: number | null;
  createdAt: string;
  submissionId: string | null;
}

export interface PatientDocumentDTO {
  id: string;
  documentType: string;
  title: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  storageUri: string;
  status: string;
  uploadedAt: string;
  checksum: string | null;
  ocrPayload: unknown | null;
  submissionId: string | null;
}

interface DeletedPatientDocumentResult {
  id: string;
  documentType: string;
  title: string | null;
  storageUri: string;
}

interface SoftDeletedRecordResult {
  kind: DeletableRecordKind;
  id: string;
  deletedAt: string;
}

/**
 * Table behind each retractable record kind. The map is keyed by the
 * `DELETABLE_RECORD_KINDS` enum, so the only strings that can ever
 * reach the `UPDATE ${table}` interpolation are these three literals
 * — a request body never touches the SQL text.
 *
 * Adding a kind here is not enough on its own: the table needs the
 * `deleted_at` column (migration 016) AND every read path has to
 * filter on it, or the record comes back from the dead in the next
 * aggregate.
 */
const DELETABLE_RECORD_TABLES: Record<DeletableRecordKind, string> = {
  function_test: 'patient_function_tests',
  symptom_score: 'patient_symptom_scores',
  followup_event: 'patient_followup_events',
};

export interface PatientMedicationDTO {
  id: string;
  medicationName: string;
  dosage: string | null;
  frequency: string | null;
  route: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  submissionId: string | null;
}

export interface PatientSymptomScoreDTO {
  id: string;
  symptomKey: string;
  score: number;
  scaleMin: number;
  scaleMax: number;
  notes: string | null;
  recordedAt: string;
  createdAt: string;
  submissionId: string | null;
}

export interface PatientDailyImpactDTO {
  id: string;
  adlKey: string;
  difficultyLevel: number;
  needsAssistance: boolean | null;
  notes: string | null;
  recordedAt: string;
  createdAt: string;
  submissionId: string | null;
}

export interface PatientFollowupEventDTO {
  id: string;
  eventType: string;
  severity: string | null;
  occurredAt: string;
  resolvedAt: string | null;
  description: string | null;
  linkedDocumentId: string | null;
  createdAt: string;
  submissionId: string | null;
}

export interface BaselineProfileDTO {
  profileId: string;
  fullName: string | null;
  preferredName: string | null;
  baseline: Record<string, unknown> | null;
  updatedAt: string;
}

export interface RiskSummary {
  overallLevel: 'low' | 'medium' | 'high';
  strengthLevel: 'low' | 'medium' | 'high';
  activityLevel: 'low' | 'medium' | 'high';
  latestMeasurement?: PatientMeasurementDTO;
  lastActivityAt?: string | null;
  notes: string[];
}

export interface MuscleTrendPoint {
  recordedAt: string;
  strengthScore: number;
}

export interface MuscleDistributionSnapshot {
  muscleGroup: string;
  minScore: number;
  maxScore: number;
  medianScore: number;
  quartile25: number;
  quartile75: number;
  sampleCount: number;
}

export interface MuscleInsightResult {
  muscleGroup: string;
  trend: MuscleTrendPoint[];
  distribution: MuscleDistributionSnapshot | null;
  userLatestScore: number | null;
}

export interface SubmissionSummary {
  id: string;
  submissionKind: string;
  summary: string | null;
  changedSinceLast: boolean | null;
  createdAt: string;
  measurements: PatientMeasurementDTO[];
  functionTests: PatientFunctionTestDTO[];
  symptomScores: PatientSymptomScoreDTO[];
  dailyImpacts: PatientDailyImpactDTO[];
  followupEvents: PatientFollowupEventDTO[];
  activityLogs: PatientActivityLogDTO[];
  medications: PatientMedicationDTO[];
  documents: PatientDocumentDTO[];
}

export interface SubmissionTimelineResult {
  page: number;
  pageSize: number;
  total: number;
  items: SubmissionSummary[];
}

export interface PatientProfileDTO {
  id: string;
  userId: string;
  fullName: string | null;
  preferredName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  patientCode: string | null;
  diagnosisStage: string | null;
  diagnosisDate: string | null;
  geneticMutation: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bloodType: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  primaryPhysician: string | null;
  regionProvince: string | null;
  regionCity: string | null;
  regionDistrict: string | null;
  baseline: Record<string, unknown> | null;
  notes: string | null;
  measurements: PatientMeasurementDTO[];
  functionTests: PatientFunctionTestDTO[];
  symptomScores: PatientSymptomScoreDTO[];
  dailyImpacts: PatientDailyImpactDTO[];
  followupEvents: PatientFollowupEventDTO[];
  activityLogs: PatientActivityLogDTO[];
  documents: PatientDocumentDTO[];
  medications: PatientMedicationDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface ProgressionChangeCardDTO {
  id: string;
  domain: 'upper_limb' | 'lower_limb' | 'face' | 'breathing' | 'symptoms' | 'events' | 'reports';
  title: string;
  detail: string;
  trend: 'better' | 'stable' | 'worse' | 'new';
  evidenceAt: string | null;
}

export interface ProgressionTimelineItemDTO {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  tag: '事件' | '报告';
  linkedDocumentId?: string | null;
}

export interface ProgressionSummaryDTO {
  generatedAt: string;
  currentStatus: {
    headline: string;
    detail: string;
    lastFollowupAt: string | null;
    baselineReady: boolean;
    hasNewChanges: boolean | null;
  };
  changeCards: ProgressionChangeCardDTO[];
  recentEvents: ProgressionTimelineItemDTO[];
  recentReports: Array<{
    id: string;
    title: string;
    documentType: string;
    uploadedAt: string;
    summary: string;
  }>;
  lateralOverview: {
    leftDominant: string[];
    rightDominant: string[];
    bilateral: string[];
  };
  recommendedReviewItems: string[];
}

const toNumber = (value: string | number | null): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const toDateString = (value: string | Date | null): string | null => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return value.includes('T') ? value.split('T')[0] : value;
};

const toTimestampString = (value: Date | null): string => {
  return value ? value.toISOString() : new Date().toISOString();
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
};

const pickTextField = (record: Record<string, unknown> | null, keys: string[]) => {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') {
      continue;
    }

    const text = value.trim();
    if (text) {
      return text;
    }
  }

  return null;
};

const sideLabels: Record<string, string> = {
  left: '左侧',
  right: '右侧',
  bilateral: '双侧',
  none: '',
};

const metricLabels: Record<string, string> = {
  deltoid: '三角肌',
  biceps: '肱二头肌',
  triceps: '肱三头肌',
  tibialis: '踝背屈',
  quadriceps: '股四头肌',
  hamstrings: '腘绳肌',
  gluteus: '臀肌',
  shoulder_abduction: '肩外展',
  shoulder_abduction_mrc: '肩外展',
  arm_raise_over_head: '抬手过头',
  elbow_flexion: '肘屈',
  ankle_dorsiflexion: '踝背屈',
  knee_extension: '膝伸',
  stair_climb: '上楼',
  ten_meter_walk: '10 米步行',
  sit_to_stand: '坐站转换',
  timed_up_and_go: '起立行走',
  eye_closure: '闭眼',
  lip_pursing: '噘嘴/鼓腮',
};

const symptomLabels: Record<string, string> = {
  fatigue: '疲劳',
  pain: '疼痛',
  dyspnea: '气短',
  sleep_quality: '睡眠质量',
  anxiety_about_progression: '对病情进展的担心',
};

const impactLabels: Record<string, string> = {
  hair_washing: '洗头',
  reaching_up: '抬手够高处',
  stairs: '上下楼',
  dressing: '穿脱衣',
  walking_outdoors: '户外走路',
};

const eventLabels: Record<string, string> = {
  fall: '跌倒',
  new_foot_drop: '新增足下垂',
  new_arm_raise_difficulty: '新增抬手困难',
  new_breathing_discomfort: '新增呼吸不适',
  started_afo: '开始使用 AFO',
  started_wheelchair: '开始使用轮椅',
  started_niv: '开始无创通气',
  uploaded_report: '上传新报告',
  other: '病程事件',
};

const documentTypeLabels: Record<string, string> = {
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
  other: '新报告',
};

const toDomainFromMetric = (key: string) => {
  if (['eye_closure', 'lip_pursing'].includes(key)) return 'face' as const;
  if (
    [
      'ankle_dorsiflexion',
      'knee_extension',
      'tibialis',
      'quadriceps',
      'hamstrings',
      'gluteus',
    ].includes(key)
  ) {
    return 'lower_limb' as const;
  }
  return 'upper_limb' as const;
};

const toDomainFromSymptom = (key: string) => {
  if (key === 'dyspnea') return 'breathing' as const;
  return 'symptoms' as const;
};

const buildMetricDisplayName = (
  metricKey: string | null,
  muscleGroup: string,
  side: string | null,
) => {
  const label = metricLabels[metricKey ?? muscleGroup] ?? metricKey ?? muscleGroup;
  const sideLabel = side ? (sideLabels[side] ?? '') : '';
  return `${sideLabel}${label}`.trim();
};

const summarizeDocumentForPatient = (document: PatientDocumentDTO) => {
  const payload = asRecord(document.ocrPayload);
  const fields = asRecord(payload?.fields);
  const aiSummary = typeof fields?.aiSummary === 'string' ? fields.aiSummary.trim() : '';
  if (aiSummary) {
    return aiSummary.length > 90 ? `${aiSummary.slice(0, 90)}…` : aiSummary;
  }

  const reportTime = typeof fields?.reportTime === 'string' ? fields.reportTime.trim() : '';
  const conclusion = typeof fields?.conclusion === 'string' ? fields.conclusion.trim() : '';
  if (reportTime && conclusion) {
    return `${reportTime} ${conclusion}`.slice(0, 90);
  }

  return `${documentTypeLabels[document.documentType] ?? '报告'}已上传，可继续查看患者版摘要。`;
};

const getDocumentDisplayTitle = (document: PatientDocumentDTO) => {
  const payload = asRecord(document.ocrPayload);
  const fields = asRecord(payload?.fields);
  const reportTypeLabel = pickTextField(fields, ['reportTypeLabel', 'report_type_label']);
  if (reportTypeLabel) {
    return reportTypeLabel;
  }

  const classifiedType = pickTextField(fields, [
    'classifiedType',
    'classified_type',
    'reportType',
    'report_type',
  ]);
  if (classifiedType && documentTypeLabels[classifiedType]) {
    return documentTypeLabels[classifiedType];
  }

  const manualTitle = document.title?.trim();
  if (manualTitle) {
    return manualTitle;
  }

  return documentTypeLabels[document.documentType] ?? '新报告';
};

/**
 * The slice of `ocr_payload` the profile actually needs.
 *
 * `SELECT … ocr_payload` handed back the whole blob for every document
 * a patient has ever uploaded, and the largest key in it —
 * `aiExtraction`, the model's raw structured read of the report — is
 * read by nothing on this path. Not the passport builder, not the
 * genetic autofill, not the patient summariser, not the app. It was
 * loaded from disk, parsed into JS, and serialised out to the phone on
 * every profile fetch, purely because `*`-shaped selects do not
 * distinguish.
 *
 * Measured over the 131 parsed documents in the dev corpus: 938 KB of
 * payload JSON becomes 215 KB, a 77% cut. The heaviest patient has 38
 * documents — ~270 KB of OCR payload on a screen that reads three keys
 * of it.
 *
 * Written as an allowlist rather than `ocr_payload - 'aiExtraction'`.
 * A denylist quietly re-widens the moment the OCR provider adds a key,
 * which is exactly how this got large in the first place; an allowlist
 * makes the next addition a decision someone has to make on purpose.
 *
 * The two spellings of the text key collapse here as well — the parser
 * has emitted both `extractedText` and `extracted_text` over its life,
 * and readers have had to check for both ever since.
 *
 * Documents fetched one at a time (`GET …/documents/:id/ocr`) still
 * return the full payload; the report-detail screen shows `aiExtraction`
 * in its raw-payload view, and that is the right place to pay for it.
 */
const PROFILE_OCR_PAYLOAD_PROJECTION = `
  CASE WHEN ocr_payload IS NULL THEN NULL ELSE jsonb_build_object(
    'fields', ocr_payload -> 'fields',
    'extractedText', coalesce(ocr_payload -> 'extractedText', ocr_payload -> 'extracted_text'),
    'provider', ocr_payload -> 'provider',
    -- What the last re-run did to this row. Small, absent on every row
    -- nobody has reparsed, and the only channel by which「some values
    -- you used to see are gone, and here is which」reaches a screen that
    -- reads the profile rather than the single-document endpoint.
    'reparse', ocr_payload -> 'reparse',
    'analyteReferences', (
      SELECT jsonb_object_agg(
               entry.key,
               jsonb_build_object(
                 'low', entry.value -> 'reference_low',
                 'high', entry.value -> 'reference_high'
               )
             )
      FROM jsonb_each(
             coalesce(ocr_payload -> 'aiExtraction' -> 'latest_summary' -> 'by_analyte', '{}'::jsonb)
           ) AS entry
      WHERE jsonb_typeof(entry.value -> 'reference_low') = 'number'
         OR jsonb_typeof(entry.value -> 'reference_high') = 'number'
    )
  ) END AS ocr_payload`;

/**
 * WHERE A STORED READING IS CHECKED BEFORE IT IS PRINTED, AND THE ONLY
 * PLACE IT IS.
 *
 * Everything below this comment exists because a parser fix does not
 * reparse. `ocr_payload.fields` is written once, at upload, by whatever
 * the extractor was on that day, and the passport, the share page, the
 * referral pack, the three exports and the report screen all read that
 * record and print the number in it. When the extractor was wrong the
 * number stays wrong on every one of those surfaces for as long as the
 * row exists — which is how seven archived documents came to carry an
 * LDH that is the CK value off the same report, or a table row index.
 *
 * So the guard is not on a screen. It is on the payload, at the two
 * points the service hands one out, and `reparseDocument` is the repair
 * rather than the defence: there will be a next generation of parser
 * bug and it will land in rows nobody reparses either.
 *
 * TWO QUESTIONS, ASKED OF THE ROW ITSELF — no external reference table,
 * no per-analyte physiology, nothing this repo would have to keep
 * current against a laboratory:
 *
 *  1. DOES THIS NUMBER BELONG TO SOMEONE ELSE ON THE SAME REPORT? Two
 *     different analytes carrying the identical reading is the exact
 *     signature of a column that slipped: CK, CK-MB, 肌酐 and LDH all
 *     reading 693 is one cell copied four times, and no laboratory
 *     printed that. Both readings are WITHHELD, not one — the payload
 *     does not say which of the two is the cell that was really read,
 *     and picking would be this file inventing a clinical value. The
 *     same question asked of ONE analyte's own spellings — `ldh`
 *     against `table_ldh` — is the sharper form of it, and catches the
 *     archived document whose LDH is a row index while the laboratory's
 *     real LDH sits beside it under the other key.
 *
 *  2. DOES IT SIT OUTSIDE THE INTERVAL THIS SAME REPORT PRINTED NEXT
 *     TO IT? The parser archives 「50-310」 off the CK row into
 *     `latest_summary.by_analyte`, so the row carries its own answer.
 *     This one is MARKED, not withheld, and the difference is the
 *     whole of the judgement: on this platform a CK outside its
 *     interval is usually the disease, not the parser. Withholding
 *     everything abnormal would blank precisely the readings the
 *     passport exists to carry. Marking says 「this is outside the
 *     range the report itself printed」, which is true of the elevated
 *     CK and true of the LDH that is really a row index, and leaves
 *     the reader to weigh it.
 *
 * WHAT A WITHHELD READING LEAVES BEHIND. The cell is deleted from
 * `fields` under every spelling it has — snake, camel, and the generic
 * table reader's `table_*` twin — so a reader that never heard of this
 * guard cannot print it by reaching for another alias. In its place the
 * payload carries `unsafeReadings` and `unsafeReadingsNotice`, at the
 * TOP LEVEL and deliberately not inside `fields`: `fields` is the
 * record of what the report said, every reader walks it, and one screen
 * (report detail) decides whether to offer 重新识别 by asking whether
 * any non-bookkeeping key survives in it. A review note filed among the
 * readings would answer that question 「yes, this report still has
 * data」 — and suppress the offer to repair the very row this guard just
 * emptied.
 */
export interface UnsafeReading {
  /** Canonical analyte name, as the parser names it (`ldh`, `uric_acid`). */
  analyte: string;
  /** Every `fields` spelling that carried it, so a caller can say where it went. */
  keys: string[];
  disposition: 'withheld' | 'flagged';
  reason: 'duplicate_reading' | 'contradictory_aliases' | 'outside_reference_interval';
  /** The other analytes sharing this value (duplicate_reading only). */
  sharedWith?: string[];
}

/**
 * Canonical names of the laboratory analytes this pipeline extracts —
 * `analytes` in `_extract_biochemistry` / `_extract_muscle_enzymes`
 * (apps/report-manager/app/services/fshd_report_service.py).
 *
 * THE LIST IS THE SCOPE, AND THE SCOPE IS THE SAFETY. Question 1 asks
 * whether two readings are identical, and outside a laboratory panel
 * that question has ordinary true answers: a D4Z4 repeat count of 4 and
 * a 4qA haplotype's leading 4, two MRC grades of 5, two 0-10 symptom
 * scores. Restricting the comparison to analytes off the same results
 * table is what keeps this from deleting a genetics cell because a
 * number appeared twice on a page.
 */
const LAB_ANALYTE_CANONICAL_KEYS = [
  'a_g_ratio',
  'alb',
  'alp',
  'alt',
  'apo_a1',
  'apo_b',
  'ast',
  'calcium',
  'chloride',
  'cholesterol',
  'ck',
  'ckmb',
  'co2cp',
  'creatinine',
  'dbil',
  'ggt',
  'globulin',
  'glucose',
  'hdl_c',
  'ibil',
  'il6',
  'ldh',
  'ldl_c',
  'lp_a',
  'magnesium',
  'mb',
  'phosphorus',
  'potassium',
  'sodium',
  'tbil',
  'tp',
  'triglyceride',
  'urea',
  'uric_acid',
  'vldl_c',
] as const;

const flattenKey = (key: string) => key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

const LAB_ANALYTE_BY_FLAT_KEY = new Map<string, string>(
  LAB_ANALYTE_CANONICAL_KEYS.map((key) => [flattenKey(key), key]),
);

/**
 * Spellings the TypeScript bridge mints for a cell the parser already
 * named. `buildFields` writes `creatineKinase = ck` and `myoglobin = mb`
 * beside the parser's own keys, and both spellings reach the passport —
 * so a guard that withheld `ck` and left `creatineKinase` standing
 * would have withheld nothing at all.
 */
const LAB_ANALYTE_BRIDGE_ALIASES: Record<string, string> = {
  creatinekinase: 'ck',
  myoglobin: 'mb',
};

/**
 * The abbreviations the generic table reader slugs a row name into —
 * `table_k`, `tableCrea` — for rows a named extractor also publishes.
 * Honoured ONLY under the `table` prefix: bare `p` or `k` is not an
 * analyte anywhere else in this payload, and reading it as one is how a
 * guard starts deleting fields it was never pointed at.
 */
const LAB_TABLE_SLUG_ALIASES: Record<string, string> = {
  k: 'potassium',
  na: 'sodium',
  cl: 'chloride',
  ca: 'calcium',
  mg: 'magnesium',
  p: 'phosphorus',
  crea: 'creatinine',
  ua: 'uric_acid',
  glu: 'glucose',
  tg: 'triglyceride',
  tcho: 'cholesterol',
  apoa1: 'apo_a1',
  apob: 'apo_b',
  ag: 'a_g_ratio',
};

const resolveLabAnalyte = (key: string): string | null => {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const tableMatch = /^table[_]?(.+)$/i.exec(trimmed);
  const bare = tableMatch ? tableMatch[1] : trimmed;
  const flat = flattenKey(bare);
  if (!flat) return null;
  if (tableMatch && LAB_TABLE_SLUG_ALIASES[flat]) {
    return LAB_TABLE_SLUG_ALIASES[flat];
  }
  return LAB_ANALYTE_BY_FLAT_KEY.get(flat) ?? LAB_ANALYTE_BRIDGE_ALIASES[flat] ?? null;
};

/**
 * The reading as a number, or nothing.
 *
 * Leading-token only, because `formatStructuredValue` staples the
 * laboratory's own unit on — 「693 U/L」 — and a comparison that
 * demanded a bare number would simply never fire on a report whose unit
 * column the OCR recovered. A value that does not START with a number
 * (「阴性」, 「未见异常」) is not a reading either question can be asked
 * of, and is left alone.
 */
const readNumericReading = (raw: unknown): number | null => {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const match = /^-?\d+(?:\.\d+)?/.exec(text);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
};

const readReferenceLimits = (payload: Record<string, unknown>) => {
  const projected = asRecord(payload.analyteReferences);
  if (projected) return projected;
  const aiExtraction = asRecord(payload.aiExtraction);
  const latestSummary = asRecord(aiExtraction?.latest_summary);
  return asRecord(latestSummary?.by_analyte) ?? null;
};

const readLimit = (source: Record<string, unknown> | null, keys: readonly string[]) => {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
};

const UNSAFE_READING_NOTICE_ZH =
  '这份报告里有数值没有通过核对：与同一份报告上另一个项目完全相同的数值已经不再显示，' +
  '超出报告自己印的参考区间的数值已标注。请以报告原件为准，必要时重新识别一次。';

/**
 * Run both questions over one payload and return a copy fit to print.
 *
 * Pure, and returns a NEW payload: `reparseDocument` reads the stored
 * payload to decide what a re-run may replace, and a guard that mutated
 * it in place would have the repair path comparing against a record
 * this function had already edited.
 */
export const withholdUnsafeReadings = <T>(payload: T): T => {
  const record = asRecord(payload);
  if (!record) return payload;
  const fields = asRecord(record.fields);

  // EVERY SPELLING'S VALUE, NOT THE FIRST ONE SEEN.
  //
  // This collected one value per analyte and dropped the rest, and that
  // was a hole big enough to hide a whole document in. `fields` carries
  // the same analyte under a named key and under the generic table
  // reader's slug — `ldh` and `table_ldh`, `potassium` and `tableK` —
  // and on a report whose columns slipped the two DISAGREE: the
  // archived document that publishes an LDH of 9 has the laboratory's
  // real LDH sitting beside it under `table_ldh`. Keeping only whichever
  // key `Object.entries` happened to yield first made the guard's answer
  // depend on key order, and on that document it silently chose the row
  // index and then found nothing wrong with it.
  //
  // Two spellings of one cell disagreeing is not a tie to break. It is
  // the strongest statement this payload can make that it does not know
  // what the laboratory printed, so it is withheld on its own account.
  const readings = new Map<string, { keys: string[]; values: Set<number> }>();
  if (fields) {
    for (const [key, raw] of Object.entries(fields)) {
      const analyte = resolveLabAnalyte(key);
      if (!analyte) continue;
      const value = readNumericReading(raw);
      if (value === null) continue;
      const existing = readings.get(analyte);
      if (existing) {
        existing.keys.push(key);
        existing.values.add(value);
        continue;
      }
      readings.set(analyte, { keys: [key], values: new Set([value]) });
    }
  }

  const byValue = new Map<number, string[]>();
  for (const [analyte, reading] of readings) {
    if (reading.values.size !== 1) continue;
    const [value] = reading.values;
    byValue.set(value, [...(byValue.get(value) ?? []), analyte]);
  }

  const references = readReferenceLimits(record);
  const unsafe: UnsafeReading[] = [];

  for (const [analyte, reading] of readings) {
    if (reading.values.size !== 1) {
      unsafe.push({
        analyte,
        keys: [...reading.keys],
        disposition: 'withheld',
        reason: 'contradictory_aliases',
      });
      continue;
    }
    const [value] = reading.values;
    const shared = (byValue.get(value) ?? []).filter((other) => other !== analyte);
    if (shared.length) {
      unsafe.push({
        analyte,
        keys: [...reading.keys],
        disposition: 'withheld',
        reason: 'duplicate_reading',
        sharedWith: shared,
      });
      continue;
    }
    const limits = asRecord(references?.[analyte]);
    const low = readLimit(limits, ['low', 'reference_low']);
    const high = readLimit(limits, ['high', 'reference_high']);
    if ((low !== null && value < low) || (high !== null && value > high)) {
      unsafe.push({
        analyte,
        keys: [...reading.keys],
        disposition: 'flagged',
        reason: 'outside_reference_interval',
      });
    }
  }

  // `analyteReferences` is a working column, not a payload key: it is
  // selected so this function has an interval to compare against and is
  // dropped here, so a clean report's payload leaves this file byte
  // for byte the shape it arrived in.
  const hadReferences = 'analyteReferences' in record;
  if (!unsafe.length && !hadReferences) return payload;

  const next: Record<string, unknown> = { ...record };
  delete next.analyteReferences;

  if (unsafe.length) {
    const withheldKeys = new Set(
      unsafe.filter((item) => item.disposition === 'withheld').flatMap((item) => item.keys),
    );
    if (fields && withheldKeys.size) {
      const nextFields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (withheldKeys.has(key)) continue;
        nextFields[key] = value;
      }
      next.fields = nextFields;
    }
    unsafe.sort((a, b) => a.analyte.localeCompare(b.analyte));
    next.unsafeReadings = unsafe;
    next.unsafeReadingsNotice = UNSAFE_READING_NOTICE_ZH;
  }

  return next as T;
};

/**
 * Fewest distinct patients before a cohort distribution is shown.
 *
 * Not a statistics choice — a re-identification one. This platform's
 * whole population is people with one rare disease who may well know
 * each other through the same patient association, so a median drawn
 * from three contributors is a median any one of them can invert. Ten
 * is the smallest floor that stops that being trivial while still
 * being reachable by this cohort.
 *
 * It is also an honesty floor: 「和病友群体相比」 promises a group.
 */
const COHORT_MIN_PATIENTS = 10;

export class PatientProfileService {
  private readonly pool: Pool;
  private readonly logger: AppLogger;

  constructor({ pool, logger }: ServiceDeps) {
    this.pool = pool;
    this.logger = logger;
  }

  async getProfileByUserId(userId: string): Promise<PatientProfileDTO | null> {
    const client = await this.pool.connect();

    try {
      const profileResult = await client.query<PatientProfileRecord>(
        `SELECT *
         FROM patient_profiles
         WHERE user_id = $1`,
        [userId],
      );

      if (!profileResult.rowCount) {
        return null;
      }

      const profile = profileResult.rows[0];
      const profileId = profile.id;

      const [
        measurementsResult,
        functionTestsResult,
        symptomScoresResult,
        dailyImpactsResult,
        followupEventsResult,
        activityLogsResult,
        documentsResult,
        medicationsResult,
      ] = await Promise.all([
        client.query(
          `SELECT id, profile_id, submission_id, recorded_at, muscle_group, metric_key, body_region, side,
                  strength_score, method, entry_mode, device_used, notes, created_at
           FROM patient_measurements
           WHERE profile_id = $1
           ORDER BY recorded_at DESC`,
          [profileId],
        ),
        // `deleted_at IS NULL` on the three retractable tables: this
        // query feeds the whole app — mobile timeline, passport,
        // progression summary, data export — so a missing filter here
        // would resurrect a retracted record everywhere at once.
        // `not_applicable` is not optional decoration: it is the only
        // thing that separates 「当天尝试后做不了」 from 「没测」, and
        // this query is the sole feed for the referral pack and all
        // three portable exports. Dropping the column made every
        // 做不了 row read as a never-attempted test — the referral pack
        // filtered it out entirely and FHIR labelled it 「未记录测量值」.
        client.query(
          `SELECT id, profile_id, submission_id, test_type, measured_value, side, protocol, unit,
                  device_used, assistance_required, notes, not_applicable, performed_at, created_at
           FROM patient_function_tests
           WHERE profile_id = $1 AND deleted_at IS NULL
           ORDER BY performed_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, submission_id, symptom_key, score, scale_min, scale_max, notes,
                  recorded_at, created_at
           FROM patient_symptom_scores
           WHERE profile_id = $1 AND deleted_at IS NULL
           ORDER BY recorded_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, submission_id, adl_key, difficulty_level, needs_assistance, notes,
                  recorded_at, created_at
           FROM patient_daily_impacts
           WHERE profile_id = $1
           ORDER BY recorded_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, submission_id, event_type, severity, occurred_at, resolved_at,
                  description, linked_document_id, created_at
           FROM patient_followup_events
           WHERE profile_id = $1 AND deleted_at IS NULL
           ORDER BY occurred_at DESC, created_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, submission_id, log_date, source, content, mood_score, created_at
           FROM patient_activity_logs
           WHERE profile_id = $1
           ORDER BY log_date DESC, created_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, submission_id, document_type, title, file_name, mime_type,
                  file_size_bytes, storage_uri, status, uploaded_at, checksum,
                  ${PROFILE_OCR_PAYLOAD_PROJECTION}
           FROM patient_documents
           WHERE profile_id = $1
           ORDER BY uploaded_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, submission_id, medication_name, dosage, frequency, route,
                  start_date, end_date, notes, status, created_at
           FROM patient_medications
           WHERE profile_id = $1
           ORDER BY created_at DESC`,
          [profileId],
        ),
      ]);

      const documents = documentsResult.rows.map((row) => ({
        id: row.id,
        documentType: row.document_type,
        title: row.title,
        fileName: row.file_name,
        mimeType: row.mime_type,
        fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
        storageUri: row.storage_uri,
        status: row.status,
        uploadedAt: toTimestampString(row.uploaded_at),
        checksum: row.checksum,
        ocrPayload: withholdUnsafeReadings(row.ocr_payload ?? null),
        submissionId: row.submission_id ?? null,
      }));

      const autoFilled = applyGeneticReportAutofill(
        {
          diagnosisDate: toDateString(profile.diagnosis_date),
          geneticMutation: profile.genetic_mutation,
          baseline: asRecord(profile.baseline_payload),
        },
        documents,
      );

      return {
        id: profile.id,
        userId: profile.user_id,
        fullName: profile.full_name,
        preferredName: profile.preferred_name,
        dateOfBirth: toDateString(profile.date_of_birth),
        gender: profile.gender,
        patientCode: profile.patient_code,
        diagnosisStage: profile.diagnosis_stage,
        diagnosisDate: autoFilled.diagnosisDate,
        geneticMutation: autoFilled.geneticMutation,
        heightCm: toNumber(profile.height_cm),
        weightKg: toNumber(profile.weight_kg),
        bloodType: profile.blood_type,
        contactPhone: profile.contact_phone,
        contactEmail: profile.contact_email,
        primaryPhysician: profile.primary_physician,
        regionProvince: profile.region_province,
        regionCity: profile.region_city,
        regionDistrict: profile.region_district,
        baseline: autoFilled.baseline,
        notes: profile.notes,
        measurements: measurementsResult.rows.map((row) => ({
          id: row.id,
          muscleGroup: row.muscle_group,
          metricKey: row.metric_key ?? null,
          bodyRegion: row.body_region ?? null,
          side: row.side ?? null,
          strengthScore: Number(row.strength_score),
          method: row.method,
          entryMode: row.entry_mode ?? null,
          deviceUsed: row.device_used ?? null,
          notes: row.notes,
          recordedAt: toTimestampString(row.recorded_at),
          createdAt: toTimestampString(row.created_at),
          submissionId: row.submission_id ?? null,
        })),
        functionTests: functionTestsResult.rows.map((row) => ({
          id: row.id,
          testType: row.test_type,
          measuredValue: row.measured_value ? Number(row.measured_value) : null,
          side: row.side ?? null,
          protocol: row.protocol ?? null,
          unit: row.unit,
          deviceUsed: row.device_used ?? null,
          assistanceRequired:
            row.assistance_required === null ? null : Boolean(row.assistance_required),
          notes: row.notes,
          notApplicable: row.not_applicable === true,
          performedAt: toTimestampString(row.performed_at),
          createdAt: toTimestampString(row.created_at),
          submissionId: row.submission_id ?? null,
        })),
        symptomScores: symptomScoresResult.rows.map((row) => ({
          id: row.id,
          symptomKey: row.symptom_key,
          score: Number(row.score),
          scaleMin: Number(row.scale_min ?? 0),
          scaleMax: Number(row.scale_max ?? 10),
          notes: row.notes,
          recordedAt: toTimestampString(row.recorded_at),
          createdAt: toTimestampString(row.created_at),
          submissionId: row.submission_id ?? null,
        })),
        dailyImpacts: dailyImpactsResult.rows.map((row) => ({
          id: row.id,
          adlKey: row.adl_key,
          difficultyLevel: Number(row.difficulty_level),
          needsAssistance: row.needs_assistance === null ? null : Boolean(row.needs_assistance),
          notes: row.notes,
          recordedAt: toTimestampString(row.recorded_at),
          createdAt: toTimestampString(row.created_at),
          submissionId: row.submission_id ?? null,
        })),
        followupEvents: followupEventsResult.rows.map((row) => ({
          id: row.id,
          eventType: row.event_type,
          severity: row.severity ?? null,
          occurredAt: toTimestampString(row.occurred_at),
          resolvedAt: row.resolved_at ? toTimestampString(row.resolved_at) : null,
          description: row.description ?? null,
          linkedDocumentId: row.linked_document_id ?? null,
          createdAt: toTimestampString(row.created_at),
          submissionId: row.submission_id ?? null,
        })),
        activityLogs: activityLogsResult.rows.map((row) => ({
          id: row.id,
          logDate: row.log_date.toISOString?.() ?? row.log_date,
          source: row.source,
          content: row.content,
          moodScore: row.mood_score === null ? null : Number(row.mood_score),
          createdAt: toTimestampString(row.created_at),
          submissionId: row.submission_id ?? null,
        })),
        documents,
        medications: medicationsResult.rows.map((row) => ({
          id: row.id,
          medicationName: row.medication_name,
          dosage: row.dosage,
          frequency: row.frequency,
          route: row.route,
          startDate: toDateString(row.start_date),
          endDate: toDateString(row.end_date),
          notes: row.notes,
          status: row.status,
          createdAt: toTimestampString(row.created_at),
          submissionId: row.submission_id ?? null,
        })),
        createdAt: toTimestampString(profile.created_at),
        updatedAt: toTimestampString(profile.updated_at),
      };
    } finally {
      client.release();
    }
  }

  async getClinicalPassportByUserId(userId: string): Promise<ClinicalPassportSummaryDTO | null> {
    const profile = await this.getProfileByUserId(userId);
    if (!profile) {
      return null;
    }
    return buildClinicalPassportSummary(profile);
  }

  /**
   * `baseline_payload` as it is ON DISK — no autofill, no merge.
   *
   * Exists for one caller, `PatientProfileController.updateMyBaseline`, and
   * the reason it cannot use `getBaselineByUserId` is the reason
   * `AdminService.getStoredProfile` exists on the other side: that
   * method applies `applyGeneticReportAutofill`, which fills a missing
   * D4Z4 / haplotype / diagnosis year out of the patient's latest
   * genetic report at READ time. `applyPatientBaselineWrite` derives
   * the patient's changed set by diffing against what it is given, so
   * diffing against the merged payload would report every autofilled
   * field as unchanged when it is not even stored — and, worse,
   * whenever the report later changes, as changed by the patient.
   *
   * Returns `null` for an account with no profile row, which is not
   * the same as a profile whose column is NULL (`{ payload: null }`).
   * The caller does not act on the distinction today — it passes
   * `stored?.payload ?? null` either way, and `upsertBaseline` answers
   * the no-row case with `ensureProfileForUser`'s 404 rather than
   * creating one — but collapsing it here would mean a future caller
   * could not get it back.
   */
  async getStoredBaselinePayload(
    userId: string,
  ): Promise<{ payload: Record<string, unknown> | null } | null> {
    const result = await this.pool.query<{ baseline_payload: unknown }>(
      'SELECT baseline_payload FROM patient_profiles WHERE user_id = $1',
      [userId],
    );
    if (!result.rowCount) {
      return null;
    }
    return { payload: asRecord(result.rows[0].baseline_payload) };
  }

  /**
   * Four scalars and the baseline, and it used to read eight tables to
   * get them.
   *
   * `getProfileByUserId` loads the patient's entire history — every
   * measurement, function test, symptom score, daily impact, follow-up
   * event, activity log, medication and document — and this method
   * discarded all of it but the name and the baseline. The baseline
   * screen polls this on every open.
   *
   * It does genuinely need the documents: `applyGeneticReportAutofill`
   * fills a missing diagnosis date or D4Z4 result off the report
   * `pickGeneticEvidenceDocument` names, so a baseline built without
   * them would show blanks the full profile fills in. The other seven
   * tables it never touched.
   */
  async getBaselineByUserId(userId: string): Promise<BaselineProfileDTO | null> {
    const profileResult = await this.pool.query<PatientProfileRecord>(
      `SELECT id, full_name, preferred_name, diagnosis_date, genetic_mutation,
              baseline_payload, updated_at
       FROM patient_profiles
       WHERE user_id = $1`,
      [userId],
    );

    if (!profileResult.rowCount) {
      return null;
    }

    const profile = profileResult.rows[0];
    const documentsResult = await this.pool.query(
      `SELECT id, document_type, status, uploaded_at, ${PROFILE_OCR_PAYLOAD_PROJECTION}
       FROM patient_documents
       WHERE profile_id = $1
       ORDER BY uploaded_at DESC`,
      [profile.id],
    );

    const autoFilled = applyGeneticReportAutofill(
      {
        diagnosisDate: toDateString(profile.diagnosis_date),
        geneticMutation: profile.genetic_mutation,
        baseline: asRecord(profile.baseline_payload),
      },
      // `status` is selected for the picker, which will not take a
      // document whose parse has not landed over one that has. A
      // projection that dropped it would have this screen filling from
      // a report the passport does not read.
      documentsResult.rows.map((row) => ({
        id: row.id,
        documentType: row.document_type,
        status: row.status,
        uploadedAt: toTimestampString(row.uploaded_at),
        ocrPayload: withholdUnsafeReadings(row.ocr_payload ?? null),
      })),
    );

    return {
      profileId: profile.id,
      fullName: profile.full_name,
      preferredName: profile.preferred_name,
      baseline: autoFilled.baseline,
      updatedAt: toTimestampString(profile.updated_at),
    };
  }

  async exportClinicalPassportByUserId(userId: string): Promise<ClinicalPassportExportDTO | null> {
    const passport = await this.getClinicalPassportByUserId(userId);
    if (!passport) {
      return null;
    }
    return buildClinicalPassportExport(passport);
  }

  async createProfile(userId: string, payload: CreateProfileInput): Promise<PatientProfileDTO> {
    const existing = await this.pool.query('SELECT id FROM patient_profiles WHERE user_id = $1', [
      userId,
    ]);

    if (existing.rowCount) {
      throw new AppError('Patient profile already exists', 409);
    }

    await this.pool.query(
      // `patient_code` is intentionally absent from this INSERT — it
      // is a clinic-assigned identifier and the public createProfile
      // route schema strips it (`createProfileSchema` omits the field
      // via `baseProfileSchema.omit`). New rows land with
      // patient_code=NULL; a future back-office onboarding flow that
      // sets the column lives in a separate code path.
      `INSERT INTO patient_profiles (
        user_id,
        full_name,
        preferred_name,
        date_of_birth,
        gender,
        diagnosis_stage,
        diagnosis_date,
        genetic_mutation,
        height_cm,
        weight_kg,
        blood_type,
        contact_phone,
        contact_email,
        primary_physician,
        region_province,
        region_city,
        region_district,
        notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      )`,
      [
        userId,
        payload.fullName ?? null,
        payload.preferredName ?? null,
        payload.dateOfBirth ?? null,
        payload.gender ?? null,
        payload.diagnosisStage ?? null,
        payload.diagnosisDate ?? null,
        payload.geneticMutation ?? null,
        payload.heightCm ?? null,
        payload.weightKg ?? null,
        payload.bloodType ?? null,
        payload.contactPhone ?? null,
        payload.contactEmail ?? null,
        payload.primaryPhysician ?? null,
        payload.regionProvince ?? null,
        payload.regionCity ?? null,
        payload.regionDistrict ?? null,
        payload.notes ?? null,
      ],
    );

    this.logger.info({ userId }, 'Patient profile created');

    const created = await this.getProfileByUserId(userId);

    if (!created) {
      throw new AppError('Failed to load created patient profile', 500);
    }

    return created;
  }

  async upsertBaseline(userId: string, payload: BaselineProfileInput): Promise<BaselineProfileDTO> {
    const profileId = await this.ensureProfileForUser(userId);
    const foundation = payload.foundation ?? {};
    const diagnosisYear =
      typeof foundation.diagnosisYear === 'number' ? `${foundation.diagnosisYear}-01-01` : null;
    const regionLabel =
      typeof foundation.regionLabel === 'string' ? foundation.regionLabel.trim() : '';

    // 「The key is absent」 and 「the key is present and null」 are
    // different writes, and only the second one is an erase. COALESCE
    // collapsed them: a SET propagated to the mirrored column and a
    // CLEAR never did, so a cleared 姓名 emptied `baseline_payload` and
    // left `full_name` standing — while the back office's confirm
    // dialog (apps/mobile/screens/p-admin/patient-record.tsx) promised
    // the operator the field 「会被清空」, and the same stale column
    // went on feeding the page header, the masked patient list and the
    // full-cohort CSV. These four fields are all `.optional()
    // .nullable()` in `baselineProfileSchema` (profile.schema.ts), so a
    // parsed payload keeps an explicit null rather than stripping it —
    // the distinction survives the wire, and these four flags carry it
    // into the SQL. `undefined`
    // rather than `in`: JSON has no undefined, so an absent key is the
    // only way to get one, whichever way Zod represents it.
    const setsFullName = foundation.fullName !== undefined;
    const setsPreferredName = foundation.preferredName !== undefined;
    const setsDiagnosisYear = foundation.diagnosisYear !== undefined;
    const setsRegionLabel = foundation.regionLabel !== undefined;

    await this.pool.query(
      `UPDATE patient_profiles
       SET baseline_payload = $1,
           full_name = CASE WHEN $2::boolean THEN $3::text ELSE full_name END,
           preferred_name = CASE WHEN $4::boolean THEN $5::text ELSE preferred_name END,
           diagnosis_date = CASE WHEN $6::boolean THEN $7::date ELSE diagnosis_date END,
           region_city = CASE WHEN $8::boolean THEN NULLIF($9::text, '') ELSE region_city END,
           updated_at = NOW()
       WHERE id = $10`,
      [
        payload,
        setsFullName,
        foundation.fullName ?? null,
        setsPreferredName,
        foundation.preferredName ?? null,
        setsDiagnosisYear,
        diagnosisYear,
        setsRegionLabel,
        regionLabel,
        profileId,
      ],
    );

    const baseline = await this.getBaselineByUserId(userId);
    if (!baseline) {
      throw new AppError('Failed to load updated baseline', 500);
    }

    return baseline;
  }

  async updateProfile(userId: string, payload: UpdateProfileInput): Promise<PatientProfileDTO> {
    const existing = await this.pool.query<PatientProfileRecord>(
      'SELECT id FROM patient_profiles WHERE user_id = $1',
      [userId],
    );

    if (!existing.rowCount) {
      throw new AppError('Patient profile not found', 404);
    }

    // `patient_code` is the clinic-assigned identifier; users must
    // not be able to set it themselves through the public update
    // endpoint (the legacy code admitted it via
    // updateProfileSchema.partial()). Admin / back-office paths
    // still go through createProfile or a dedicated upsert that
    // bypasses this list. Removing it here is the user-facing
    // hardening.
    const columns: Array<[keyof UpdateProfileInput, string]> = [
      ['fullName', 'full_name'],
      ['preferredName', 'preferred_name'],
      ['dateOfBirth', 'date_of_birth'],
      ['gender', 'gender'],
      ['diagnosisStage', 'diagnosis_stage'],
      ['diagnosisDate', 'diagnosis_date'],
      ['geneticMutation', 'genetic_mutation'],
      ['heightCm', 'height_cm'],
      ['weightKg', 'weight_kg'],
      ['bloodType', 'blood_type'],
      ['contactPhone', 'contact_phone'],
      ['contactEmail', 'contact_email'],
      ['primaryPhysician', 'primary_physician'],
      ['regionProvince', 'region_province'],
      ['regionCity', 'region_city'],
      ['regionDistrict', 'region_district'],
      ['notes', 'notes'],
    ];

    const setClauses: string[] = [];
    const values: unknown[] = [];

    columns.forEach(([key, column]) => {
      if (payload[key] !== undefined) {
        setClauses.push(`${column} = $${values.length + 1}`);
        values.push(payload[key] ?? null);
      }
    });

    if (setClauses.length === 0) {
      const profile = await this.getProfileByUserId(userId);
      if (!profile) {
        throw new AppError('Patient profile not found', 404);
      }
      return profile;
    }

    setClauses.push(`updated_at = NOW()`);

    await this.pool.query(
      `UPDATE patient_profiles
       SET ${setClauses.join(', ')}
       WHERE user_id = $${values.length + 1}`,
      [...values, userId],
    );

    this.logger.info({ userId }, 'Patient profile updated');

    const updated = await this.getProfileByUserId(userId);
    if (!updated) {
      throw new AppError('Failed to load updated patient profile', 500);
    }

    return updated;
  }

  async addMeasurement(userId: string, payload: MeasurementInput): Promise<PatientMeasurementDTO> {
    const profileId = await this.ensureProfileForUser(userId);
    const submissionId = await this.assertSubmissionOwnedByProfile(payload.submissionId, profileId);

    const result = await this.pool.query(
      `INSERT INTO patient_measurements (
        profile_id,
        submission_id,
        muscle_group,
        metric_key,
        body_region,
        side,
        strength_score,
        method,
        entry_mode,
        device_used,
        notes,
        recorded_at
      )
      VALUES (
        $1, $2, COALESCE($3, 'custom'), $4, $5, COALESCE($6, 'none'), $7, $8,
        COALESCE($9, 'self_report'), $10, $11, COALESCE($12::timestamptz, NOW())
      )
      RETURNING id, submission_id, muscle_group, metric_key, body_region, side, strength_score,
                method, entry_mode, device_used, notes, recorded_at, created_at`,
      [
        profileId,
        submissionId,
        payload.muscleGroup ?? null,
        payload.metricKey ?? null,
        payload.bodyRegion ?? null,
        payload.side ?? null,
        payload.strengthScore,
        payload.method ?? null,
        payload.entryMode ?? null,
        payload.deviceUsed ?? null,
        payload.notes ?? null,
        payload.recordedAt ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      id: row.id,
      muscleGroup: row.muscle_group,
      metricKey: row.metric_key ?? null,
      bodyRegion: row.body_region ?? null,
      side: row.side ?? null,
      strengthScore: Number(row.strength_score),
      method: row.method,
      entryMode: row.entry_mode ?? null,
      deviceUsed: row.device_used ?? null,
      notes: row.notes,
      recordedAt: toTimestampString(row.recorded_at),
      createdAt: toTimestampString(row.created_at),
      submissionId: row.submission_id ?? null,
    };
  }

  async addFunctionTest(
    userId: string,
    payload: FunctionTestInput,
  ): Promise<PatientFunctionTestDTO> {
    const profileId = await this.ensureProfileForUser(userId);
    const submissionId = await this.assertSubmissionOwnedByProfile(payload.submissionId, profileId);

    const result = await this.pool.query(
      `INSERT INTO patient_function_tests (
        profile_id,
        submission_id,
        test_type,
        measured_value,
        side,
        protocol,
        unit,
        device_used,
        assistance_required,
        notes,
        not_applicable,
        performed_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, NOW())
      )
      RETURNING id, submission_id, test_type, measured_value, side, protocol, unit,
                device_used, assistance_required, notes, not_applicable,
                performed_at, created_at`,
      [
        profileId,
        submissionId,
        payload.testType,
        payload.measuredValue ?? null,
        payload.side ?? null,
        payload.protocol ?? null,
        payload.unit ?? null,
        payload.deviceUsed ?? null,
        payload.assistanceRequired ?? null,
        payload.notes ?? null,
        // A test the patient could not perform never carries a value —
        // the DB CHECK says the same thing, this keeps the two from
        // disagreeing when a caller sends both.
        payload.notApplicable === true,
        payload.performedAt ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      id: row.id,
      testType: row.test_type,
      notApplicable: row.not_applicable === true,
      measuredValue: row.measured_value ? Number(row.measured_value) : null,
      side: row.side ?? null,
      protocol: row.protocol ?? null,
      unit: row.unit,
      deviceUsed: row.device_used ?? null,
      assistanceRequired:
        row.assistance_required === null ? null : Boolean(row.assistance_required),
      notes: row.notes,
      performedAt: toTimestampString(row.performed_at),
      createdAt: toTimestampString(row.created_at),
      submissionId: row.submission_id ?? null,
    };
  }

  async addActivityLog(userId: string, payload: ActivityLogInput): Promise<PatientActivityLogDTO> {
    const profileId = await this.ensureProfileForUser(userId);
    const submissionId = await this.assertSubmissionOwnedByProfile(payload.submissionId, profileId);

    const result = await this.pool.query(
      `INSERT INTO patient_activity_logs (
        profile_id,
        submission_id,
        log_date,
        source,
        content,
        mood_score
      )
      VALUES (
        $1,
        $2,
        COALESCE($3::date, CURRENT_DATE),
        $4,
        $5,
        $6
      )
      RETURNING id, submission_id, log_date, source, content, mood_score, created_at`,
      [
        profileId,
        submissionId,
        payload.logDate ?? null,
        payload.source,
        payload.content ?? null,
        payload.moodScore ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      id: row.id,
      logDate: row.log_date?.toISOString?.() ?? row.log_date,
      source: row.source,
      content: row.content,
      moodScore: row.mood_score === null ? null : Number(row.mood_score),
      createdAt: toTimestampString(row.created_at),
      submissionId: row.submission_id ?? null,
    };
  }

  async addUploadedDocument(input: {
    userId: string;
    documentType: string;
    status?: string | null;
    title?: string | null;
    storageUri: string;
    fileName: string | null;
    mimeType: string | null;
    fileSizeBytes: number | null;
    ocrPayload: unknown | null;
    submissionId?: string | null;
  }): Promise<PatientDocumentDTO> {
    const profileId = await this.ensureProfileForUser(input.userId);
    const submissionId = await this.assertSubmissionOwnedByProfile(input.submissionId, profileId);

    const result = await this.pool.query(
      `INSERT INTO patient_documents (
        profile_id,
        submission_id,
        document_type,
        title,
        file_name,
        mime_type,
        file_size_bytes,
        storage_uri,
        status,
        uploaded_at,
        ocr_payload
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10
      )
      RETURNING id, submission_id, document_type, title, file_name, mime_type, file_size_bytes,
                storage_uri, status, uploaded_at, checksum, ocr_payload`,
      [
        profileId,
        submissionId,
        input.documentType,
        input.title ?? null,
        input.fileName ?? null,
        input.mimeType ?? null,
        input.fileSizeBytes ?? null,
        input.storageUri,
        input.status ?? 'uploaded',
        input.ocrPayload ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      id: row.id,
      documentType: row.document_type,
      title: row.title,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
      storageUri: row.storage_uri,
      status: row.status,
      uploadedAt: toTimestampString(row.uploaded_at),
      checksum: row.checksum,
      ocrPayload: withholdUnsafeReadings(row.ocr_payload ?? null),
      submissionId: row.submission_id ?? null,
    };
  }

  async getDocumentForUser(userId: string, documentId: string) {
    const result = await this.pool.query(
      `SELECT d.id, d.document_type, d.status, d.title, d.storage_uri,
              d.file_name, d.mime_type, d.ocr_payload, d.uploaded_at
       FROM patient_documents d
       JOIN patient_profiles p ON p.id = d.profile_id
       WHERE p.user_id = $1 AND d.id = $2`,
      [userId, documentId],
    );

    if (!result.rowCount) {
      throw new AppError('Document not found', 404);
    }

    return result.rows[0] as {
      id: string;
      document_type: string;
      status: string | null;
      title: string | null;
      storage_uri: string;
      file_name: string | null;
      mime_type: string | null;
      ocr_payload: unknown | null;
      uploaded_at: Date | string;
    };
  }

  /**
   * The single document's payload AS IT MAY BE PRINTED.
   *
   * `getDocumentForUser` deliberately hands back the row untouched:
   * `reparseDocument` reads it to decide what a re-run is allowed to
   * replace, and that decision has to be taken against what is actually
   * stored. Every OTHER reader of one document's payload wants the
   * guarded copy, and the two used to be the same call — which is how
   * GET …/documents/:id/ocr became the one door into `fields` that the
   * projection's guard did not cover.
   */
  async getDocumentOcrForUser(userId: string, documentId: string) {
    const document = await this.getDocumentForUser(userId, documentId);
    return {
      status: document.status ?? null,
      ocrPayload: withholdUnsafeReadings(document.ocr_payload ?? null),
    };
  }

  /**
   * Land a finished (or failed) OCR run on its document row. Unlike
   * `updateDocumentOcrPayloadForUser`, this is the dedicated
   * write-path for the async parse pipeline, so it also moves
   * `status` and — when the parse classified the document — the
   * canonical `document_type` (callers pass a value that already went
   * through `canonicalizeDocumentType` via
   * `resolveDocumentTypeFromPayload`).
   */
  async updateDocumentOcrResult(
    userId: string,
    documentId: string,
    input: { status: string; ocrPayload: unknown | null; documentType?: string | null },
  ) {
    const result = await this.pool.query(
      `UPDATE patient_documents d
       SET status = $3,
           ocr_payload = $4,
           document_type = COALESCE($5, d.document_type)
       FROM patient_profiles p
       WHERE d.profile_id = p.id
         AND p.user_id = $1
         AND d.id = $2
       RETURNING d.id, d.status`,
      [userId, documentId, input.status, input.ocrPayload, input.documentType ?? null],
    );

    if (!result.rowCount) {
      throw new AppError('Document not found', 404);
    }

    return result.rows[0] as { id: string; status: string };
  }

  /**
   * Patient hand-correction of their own report's OCR fields. Only
   * whitelisted keys reach this (zod), only settled documents accept
   * edits (parsed / needs_review — a processing row is about to be
   * overwritten by the job, a parse_failed row has no fields to fix),
   * and the merge stamps `manuallyEditedAt` so downstream consumers
   * can tell a corrected value from a raw OCR read.
   */
  async patchDocumentOcrFields(userId: string, documentId: string, patch: Record<string, string>) {
    const existing = await this.pool.query<{
      id: string;
      status: string;
      ocr_payload: { fields?: Record<string, unknown> } | null;
    }>(
      `SELECT d.id, d.status, d.ocr_payload
       FROM patient_documents d
       JOIN patient_profiles p ON p.id = d.profile_id
       WHERE p.user_id = $1 AND d.id = $2`,
      [userId, documentId],
    );
    const row = existing.rows[0];
    if (!row) {
      throw new AppError('Document not found', 404);
    }
    if (row.status !== 'parsed' && row.status !== 'needs_review') {
      throw new AppError('当前状态不支持修正识别结果', 409);
    }

    const payload =
      row.ocr_payload && typeof row.ocr_payload === 'object' ? { ...row.ocr_payload } : {};
    const fields = {
      ...((payload as { fields?: Record<string, unknown> }).fields ?? {}),
      ...patch,
      manuallyEditedAt: new Date().toISOString(),
    };
    const nextPayload = { ...payload, fields };

    const updated = await this.pool.query<{ id: string; ocr_payload: unknown }>(
      `UPDATE patient_documents d
       SET ocr_payload = $3
       FROM patient_profiles p
       WHERE d.profile_id = p.id AND p.user_id = $1 AND d.id = $2
         AND d.status IN ('parsed', 'needs_review')
       RETURNING d.id, d.ocr_payload`,
      [userId, documentId, JSON.stringify(nextPayload)],
    );
    if (!updated.rowCount) {
      // The status gate re-checks atomically at write time: a reparse
      // that started between our SELECT and this UPDATE would flip the
      // row to 'processing' and then overwrite ocr_payload when the
      // job settles — silently discarding the correction. Refusing
      // here keeps the correction from being eaten.
      throw new AppError('当前状态不支持修正识别结果', 409);
    }
    this.logger.info(
      { userId, documentId, keys: Object.keys(patch) },
      'Report OCR fields hand-corrected',
    );
    return updated.rows[0];
  }

  /**
   * Startup sweep for the async OCR pipeline: rows stuck in
   * 'processing' longer than `olderThanMinutes` belong to a job that
   * died with the previous process (there is no persistent queue by
   * design — see the controller's runOcrJob). Flip them to
   * parse_failed so the mobile detail screen offers「重新识别」instead
   * of spinning forever.
   */
  async sweepStuckProcessingDocuments(olderThanMinutes: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE patient_documents
       SET status = 'parse_failed',
           ocr_payload = jsonb_build_object(
             'provider', 'unknown',
             'error', 'OCR job lost to a server restart'
           )
       WHERE status = 'processing'
         AND uploaded_at < NOW() - ($1 || ' minutes')::interval`,
      [olderThanMinutes],
    );

    return result.rowCount ?? 0;
  }

  /**
   * The two audit events the delete endpoint writes OUTSIDE
   * `deleteDocumentForUser`'s transaction, because the thing they
   * describe happens outside it too.
   *
   * `patient_document.delete_started` is the intent record: the
   * controller commits it BEFORE it touches the blob, so the
   * irreversible half can only run once a trail of the attempt is
   * already durable. `patient_document.delete_failed` is the
   * compensating record: it says how an attempt that did not end in a
   * row delete ended, and — via `storageCleanupStatus` — whether the
   * file survived it.
   *
   * The pair is what makes the transaction's own invariant ("no
   * removal without a trail") true for the file and not just for the
   * row; see the doc block on `deleteDocument` for why the blob cannot
   * be inside the transaction in the first place.
   */
  private async recordDocumentDeletionEvent(
    eventType: 'patient_document.delete_started' | 'patient_document.delete_failed',
    entry: {
      userId: string;
      documentId: string;
      documentType: string | null;
      /**
       * What became of the stored object by the time the attempt
       * ended: 'kept' — never removed, 'missing' — already absent
       * before we tried, 'removed' — destroyed by this request.
       * `delete_failed` + 'removed' is the row that says a file is
       * gone while its record is not.
       */
      storageCleanupStatus?: 'removed' | 'missing' | 'kept';
      reason?: string;
      ip?: string;
      userAgent?: string;
    },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (event_type, event_payload)
       VALUES ($1, $2)`,
      [
        eventType,
        // Same content rule as the `patient_document.deleted` payload
        // below: documentId + documentType prove an erasure was
        // attempted, while title / file_name / storage_uri are report
        // content that would outlive the account purge.
        maskAuditPayload({
          userId: entry.userId,
          documentId: entry.documentId,
          documentType: entry.documentType,
          ...(entry.storageCleanupStatus
            ? { storageCleanupStatus: entry.storageCleanupStatus }
            : {}),
          ...(entry.reason ? { reason: entry.reason } : {}),
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        }),
      ],
    );
  }

  /**
   * Commit the intent to delete before anything irreversible runs.
   *
   * Throws if the row cannot be written, and the controller turns that
   * into a refusal — deliberately. The gate is the whole point: if the
   * database is too sick to record that a patient asked for an
   * erasure, it is also too sick for us to start performing one.
   */
  async recordDocumentDeletionIntent(entry: {
    userId: string;
    documentId: string;
    documentType: string | null;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.recordDocumentDeletionEvent('patient_document.delete_started', entry);
  }

  /**
   * Record how a delete that did not complete ended. Best-effort: a
   * throw here is swallowed by the caller, because the error the
   * patient and the operator need is the original one, and this insert
   * is being attempted on a database that has just failed a query.
   * The intent row is the trail that does not depend on this landing.
   */
  async recordDocumentDeletionFailure(entry: {
    userId: string;
    documentId: string;
    documentType: string | null;
    storageCleanupStatus: 'removed' | 'missing' | 'kept';
    reason: string;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.recordDocumentDeletionEvent('patient_document.delete_failed', entry);
  }

  async deleteDocumentForUser(
    userId: string,
    documentId: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<DeletedPatientDocumentResult> {
    // The DELETE and the audit-row insert must land or roll back
    // together. Without this, a successful DELETE followed by a
    // failed audit insert would leave the row gone with no trail of
    // who removed it — and the consent / followup tables can still
    // hold `linked_document_id` pointers to the vanished UUID.
    const client = await this.pool.connect();
    let txOpen = false;
    try {
      await client.query('BEGIN');
      txOpen = true;

      const result = await client.query(
        `DELETE FROM patient_documents d
         USING patient_profiles p
         WHERE d.profile_id = p.id
           AND p.user_id = $1
           AND d.id = $2
         RETURNING d.id, d.document_type, d.title, d.storage_uri, d.file_name`,
        [userId, documentId],
      );

      if (!result.rowCount) {
        await client.query('ROLLBACK');
        txOpen = false;
        throw new AppError('Document not found', 404);
      }

      const row = result.rows[0];

      // `title`, `file_name` and `storage_uri` are deliberately NOT in
      // the audit payload, though the RETURNING clause fetches them —
      // the caller needs storage_uri to delete the blob, which is a
      // different job. A patient names their own uploads
      //（「基因检测 2026」）and hospitals put names and IDs in file
      // names（「ZHANG-WEI-1987-WES.pdf」）, so all three are report
      // content rather than evidence that a deletion occurred — and
      // the second example is the one that reaches storage_uri, which
      // keeps only `[A-Za-z0-9-_.]` and would store the first as
      //「_____2026」. `documentId` + `documentType` proves
      // that completely, and unlike the other three it resolves to
      // nothing once the account is purged.
      await client.query(
        `INSERT INTO audit_logs (event_type, event_payload)
         VALUES ($1, $2)`,
        [
          'patient_document.deleted',
          maskAuditPayload({
            userId,
            documentId: row.id,
            documentType: row.document_type,
            ip: meta?.ip ?? null,
            userAgent: meta?.userAgent ?? null,
          }),
        ],
      );

      await client.query('COMMIT');
      txOpen = false;

      return {
        id: row.id,
        documentType: row.document_type,
        title: row.title ?? null,
        storageUri: row.storage_uri,
      };
    } catch (error) {
      if (txOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          this.logger.warn({ rollbackError }, 'deleteDocumentForUser: ROLLBACK after error failed');
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retract one hand-entered follow-up record (功能测试 / 症状评分 /
   * 病程事件).
   *
   * Soft delete, not DELETE — the reasoning lives in migration 016.
   * The short version: these rows are longitudinal clinical evidence
   * shared with clinicians, they anchor a `submission_id` group that
   * other rows still reference, and one-tap retraction by a user with
   * impaired fine motor control has to be recoverable by an operator.
   *
   * The flip and the audit row land in one transaction for the same
   * reason deleteDocumentForUser does it: a tombstone with no trail
   * of who set it is worse than either half alone.
   */
  async softDeleteRecordForUser(
    userId: string,
    kind: DeletableRecordKind,
    recordId: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<SoftDeletedRecordResult> {
    const table = DELETABLE_RECORD_TABLES[kind];
    const client = await this.pool.connect();
    let txOpen = false;
    try {
      await client.query('BEGIN');
      txOpen = true;

      // Ownership is enforced in the UPDATE itself (join through
      // patient_profiles on user_id) so there is no window between a
      // permission check and the write.
      const updated = await client.query<{ id: string; deleted_at: Date }>(
        `UPDATE ${table} r
         SET deleted_at = NOW()
         FROM patient_profiles p
         WHERE r.profile_id = p.id
           AND p.user_id = $1
           AND r.id = $2
           AND r.deleted_at IS NULL
         RETURNING r.id, r.deleted_at`,
        [userId, recordId],
      );

      if (!updated.rowCount) {
        // Nothing flipped: either the record isn't this user's (or
        // never existed), or it was already retracted. Re-read
        // without the deleted_at filter to tell those apart — a
        // patient whose tap double-fired, or who retried over a flaky
        // connection, should see the same success as the first call
        // rather than a 404 that reads like data loss.
        const existing = await client.query<{ id: string; deleted_at: Date | null }>(
          `SELECT r.id, r.deleted_at
           FROM ${table} r
           JOIN patient_profiles p ON p.id = r.profile_id
           WHERE p.user_id = $1 AND r.id = $2`,
          [userId, recordId],
        );
        await client.query('ROLLBACK');
        txOpen = false;

        const row = existing.rows[0];
        if (!row?.deleted_at) {
          throw new AppError('记录不存在', 404);
        }
        return { kind, id: row.id, deletedAt: toTimestampString(row.deleted_at) };
      }

      const row = updated.rows[0];

      // Same shape as patient_document.deleted: the acting user goes
      // in the payload rather than audit_logs.user_id, whose
      // ON DELETE SET NULL would erase attribution the moment the
      // account is purged.
      await client.query(
        `INSERT INTO audit_logs (event_type, event_payload)
         VALUES ($1, $2)`,
        [
          'patient_record.soft_deleted',
          maskAuditPayload({
            userId,
            recordKind: kind,
            recordId: row.id,
            ip: meta?.ip ?? null,
            userAgent: meta?.userAgent ?? null,
          }),
        ],
      );

      await client.query('COMMIT');
      txOpen = false;

      return { kind, id: row.id, deletedAt: toTimestampString(row.deleted_at) };
    } catch (error) {
      if (txOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          this.logger.warn(
            { rollbackError },
            'softDeleteRecordForUser: ROLLBACK after error failed',
          );
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateDocumentOcrPayloadForUser(userId: string, documentId: string, ocrPayload: unknown) {
    // `nextDocumentType` / `nextStatus` parameters were removed in
    // PR-Sec-8: only one production caller exists
    // (controller.generateDocumentSummary), it never passed them, and
    // any future caller routing an OCR sub-type through
    // `nextDocumentType` would have bypassed `canonicalizeDocumentType`
    // and triggered the migration 012 CHECK after the OCR work was
    // already done. If a future workflow legitimately needs to update
    // the document_type from a parse result, add a dedicated method
    // that calls `canonicalizeDocumentType` explicitly.
    const result = await this.pool.query(
      `UPDATE patient_documents d
       SET ocr_payload = $3
       FROM patient_profiles p
       WHERE d.profile_id = p.id
         AND p.user_id = $1
         AND d.id = $2
       RETURNING d.id, d.ocr_payload`,
      [userId, documentId, ocrPayload],
    );

    if (!result.rowCount) {
      throw new AppError('Document not found', 404);
    }

    return result.rows[0] as { id: string; ocr_payload: unknown | null };
  }

  async addMedication(userId: string, payload: MedicationInput): Promise<PatientMedicationDTO> {
    const profileId = await this.ensureProfileForUser(userId);
    const submissionId = await this.assertSubmissionOwnedByProfile(payload.submissionId, profileId);

    const result = await this.pool.query(
      `INSERT INTO patient_medications (
        profile_id,
        submission_id,
        medication_name,
        dosage,
        frequency,
        route,
        start_date,
        end_date,
        notes,
        status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'active')
      )
      RETURNING id, submission_id, medication_name, dosage, frequency, route, start_date,
                end_date, notes, status, created_at`,
      [
        profileId,
        submissionId,
        payload.medicationName,
        payload.dosage ?? null,
        payload.frequency ?? null,
        payload.route ?? null,
        payload.startDate ?? null,
        payload.endDate ?? null,
        payload.notes ?? null,
        payload.status ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      id: row.id,
      medicationName: row.medication_name,
      dosage: row.dosage,
      frequency: row.frequency,
      route: row.route,
      startDate: toDateString(row.start_date),
      endDate: toDateString(row.end_date),
      notes: row.notes,
      status: row.status,
      createdAt: toTimestampString(row.created_at),
      submissionId: row.submission_id ?? null,
    };
  }

  async addSymptomScore(
    userId: string,
    payload: SymptomScoreInput,
  ): Promise<PatientSymptomScoreDTO> {
    const profileId = await this.ensureProfileForUser(userId);
    const submissionId = await this.assertSubmissionOwnedByProfile(payload.submissionId, profileId);

    const result = await this.pool.query(
      `INSERT INTO patient_symptom_scores (
        profile_id,
        submission_id,
        symptom_key,
        score,
        scale_min,
        scale_max,
        notes,
        recorded_at
      )
      VALUES (
        $1, $2, $3, $4, COALESCE($5, 0), COALESCE($6, 10), $7, COALESCE($8::timestamptz, NOW())
      )
      RETURNING id, submission_id, symptom_key, score, scale_min, scale_max, notes, recorded_at, created_at`,
      [
        profileId,
        submissionId,
        payload.symptomKey,
        payload.score,
        payload.scaleMin ?? null,
        payload.scaleMax ?? null,
        payload.notes ?? null,
        payload.recordedAt ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      id: row.id,
      symptomKey: row.symptom_key,
      score: Number(row.score),
      scaleMin: Number(row.scale_min ?? 0),
      scaleMax: Number(row.scale_max ?? 10),
      notes: row.notes,
      recordedAt: toTimestampString(row.recorded_at),
      createdAt: toTimestampString(row.created_at),
      submissionId: row.submission_id ?? null,
    };
  }

  async addDailyImpact(userId: string, payload: DailyImpactInput): Promise<PatientDailyImpactDTO> {
    const profileId = await this.ensureProfileForUser(userId);
    const submissionId = await this.assertSubmissionOwnedByProfile(payload.submissionId, profileId);

    const result = await this.pool.query(
      `INSERT INTO patient_daily_impacts (
        profile_id,
        submission_id,
        adl_key,
        difficulty_level,
        needs_assistance,
        notes,
        recorded_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()))
      RETURNING id, submission_id, adl_key, difficulty_level, needs_assistance, notes, recorded_at, created_at`,
      [
        profileId,
        submissionId,
        payload.adlKey,
        payload.difficultyLevel,
        payload.needsAssistance ?? null,
        payload.notes ?? null,
        payload.recordedAt ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      id: row.id,
      adlKey: row.adl_key,
      difficultyLevel: Number(row.difficulty_level),
      needsAssistance: row.needs_assistance === null ? null : Boolean(row.needs_assistance),
      notes: row.notes,
      recordedAt: toTimestampString(row.recorded_at),
      createdAt: toTimestampString(row.created_at),
      submissionId: row.submission_id ?? null,
    };
  }

  async addFollowupEvent(
    userId: string,
    payload: FollowupEventInput,
  ): Promise<PatientFollowupEventDTO> {
    const profileId = await this.ensureProfileForUser(userId);
    const submissionId = await this.assertSubmissionOwnedByProfile(payload.submissionId, profileId);
    const linkedDocumentId = await this.assertDocumentOwnedByProfile(
      payload.linkedDocumentId,
      profileId,
    );

    const result = await this.pool.query(
      `INSERT INTO patient_followup_events (
        profile_id,
        submission_id,
        event_type,
        severity,
        occurred_at,
        resolved_at,
        description,
        linked_document_id
      )
      VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8)
      RETURNING id, submission_id, event_type, severity, occurred_at, resolved_at, description, linked_document_id, created_at`,
      [
        profileId,
        submissionId,
        payload.eventType,
        payload.severity ?? null,
        payload.occurredAt,
        payload.resolvedAt ?? null,
        payload.description ?? null,
        linkedDocumentId,
      ],
    );

    const row = result.rows[0];

    return {
      id: row.id,
      eventType: row.event_type,
      severity: row.severity ?? null,
      occurredAt: toTimestampString(row.occurred_at),
      resolvedAt: row.resolved_at ? toTimestampString(row.resolved_at) : null,
      description: row.description ?? null,
      linkedDocumentId: row.linked_document_id ?? null,
      createdAt: toTimestampString(row.created_at),
      submissionId: row.submission_id ?? null,
    };
  }

  async getMedications(userId: string): Promise<PatientMedicationDTO[]> {
    const profileId = await this.ensureProfileForUser(userId);
    const result = await this.pool.query(
      `SELECT id, submission_id, medication_name, dosage, frequency, route, start_date, end_date,
              notes, status, created_at
       FROM patient_medications
       WHERE profile_id = $1
       ORDER BY created_at DESC`,
      [profileId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      medicationName: row.medication_name,
      dosage: row.dosage,
      frequency: row.frequency,
      route: row.route,
      startDate: toDateString(row.start_date),
      endDate: toDateString(row.end_date),
      notes: row.notes,
      status: row.status,
      createdAt: toTimestampString(row.created_at),
      submissionId: row.submission_id ?? null,
    }));
  }

  async getRiskSummary(userId: string): Promise<RiskSummary> {
    const profileId = await this.ensureProfileForUser(userId);

    const [measurementsResult, activityResult] = await Promise.all([
      this.pool.query(
        `SELECT id, muscle_group, strength_score, recorded_at
         FROM patient_measurements
         WHERE profile_id = $1
         ORDER BY recorded_at DESC
         LIMIT 5`,
        [profileId],
      ),
      this.pool.query(
        `SELECT log_date
         FROM patient_activity_logs
         WHERE profile_id = $1
         ORDER BY log_date DESC
         LIMIT 1`,
        [profileId],
      ),
    ]);

    const measurementRows = measurementsResult.rows;
    const avgStrength =
      measurementRows.length === 0
        ? null
        : measurementRows.reduce((sum, row) => sum + Number(row.strength_score), 0) /
          measurementRows.length;

    const strengthLevel: RiskSummary['strengthLevel'] =
      avgStrength === null
        ? 'medium'
        : avgStrength < 3
          ? 'high'
          : avgStrength < 4
            ? 'medium'
            : 'low';

    const latestActivity = activityResult.rows[0];
    const lastActivityDate = latestActivity?.log_date ? new Date(latestActivity.log_date) : null;

    let activityLevel: RiskSummary['activityLevel'] = 'medium';
    if (!lastActivityDate) {
      activityLevel = 'high';
    } else {
      const daysSince = Math.floor(
        (Date.now() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      activityLevel = daysSince > 14 ? 'high' : daysSince > 7 ? 'medium' : 'low';
    }

    const levelRank = { low: 1, medium: 2, high: 3 } as const;
    const overallLevel =
      levelRank[strengthLevel] >= levelRank[activityLevel] ? strengthLevel : activityLevel;

    const notes: string[] = [];
    if (avgStrength !== null) {
      notes.push(`最近平均肌力分数：${avgStrength.toFixed(1)}`);
    } else {
      notes.push('暂无肌力评估数据');
    }

    if (lastActivityDate) {
      notes.push(`最近活动记录：${lastActivityDate.toISOString().split('T')[0]}`);
    } else {
      notes.push('近期没有活动记录');
    }

    const latestMeasurementRow = measurementRows[0];
    const latestMeasurement = latestMeasurementRow
      ? {
          id: latestMeasurementRow.id,
          muscleGroup: latestMeasurementRow.muscle_group,
          metricKey: null,
          bodyRegion: null,
          side: null,
          strengthScore: Number(latestMeasurementRow.strength_score),
          method: null,
          entryMode: null,
          deviceUsed: null,
          notes: null,
          recordedAt: toTimestampString(latestMeasurementRow.recorded_at),
          createdAt: toTimestampString(latestMeasurementRow.recorded_at),
          submissionId: null,
        }
      : undefined;

    return {
      overallLevel,
      strengthLevel,
      activityLevel,
      latestMeasurement,
      lastActivityAt: lastActivityDate ? lastActivityDate.toISOString() : null,
      notes,
    };
  }

  async createSubmission(
    userId: string,
    payload: CreateSubmissionInput = {},
  ): Promise<{
    id: string;
    submissionKind: string;
    summary: string | null;
    changedSinceLast: boolean | null;
    createdAt: string;
  }> {
    const profileId = await this.ensureProfileForUser(userId);
    const result = await this.pool.query<{
      id: string;
      submission_kind: string;
      summary: string | null;
      changed_since_last: boolean | null;
      created_at: Date;
    }>(
      `INSERT INTO patient_submissions (profile_id, submission_kind, summary, changed_since_last)
       VALUES ($1, COALESCE($2, 'followup'), $3, $4)
       RETURNING id, submission_kind, summary, changed_since_last, created_at`,
      [
        profileId,
        payload.submissionKind ?? null,
        payload.summary ?? null,
        payload.changedSinceLast ?? null,
      ],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      submissionKind: row.submission_kind,
      summary: row.summary ?? null,
      changedSinceLast: row.changed_since_last === null ? null : Boolean(row.changed_since_last),
      createdAt: toTimestampString(row.created_at),
    };
  }

  async attachDocumentsToSubmission(
    userId: string,
    submissionId: string,
    documentIds: string[],
  ): Promise<{ updated: number }> {
    const profileId = await this.ensureProfileForUser(userId);
    const submissionResult = await this.pool.query(
      `SELECT id FROM patient_submissions WHERE id = $1 AND profile_id = $2`,
      [submissionId, profileId],
    );
    if (!submissionResult.rowCount) {
      throw new AppError('Submission not found', 404);
    }

    const updateResult = await this.pool.query(
      `UPDATE patient_documents
       SET submission_id = $1
       WHERE profile_id = $2 AND id = ANY($3::uuid[])`,
      [submissionId, profileId, documentIds],
    );

    const updated = updateResult.rowCount ?? 0;
    // The legacy code silently returned `{ updated: 0 }` when every
    // documentId belonged to another user — indistinguishable from
    // "all those ids already had this submission_id". A future
    // monitor looking for "attach failures" would see clean 200s.
    // Surface the discrepancy as a 404 (matching
    // assertDocumentOwnedByProfile's behaviour for cross-user ids).
    if (updated < documentIds.length) {
      throw new AppError('One or more documents not found', 404);
    }
    return { updated };
  }

  async listSubmissions(
    userId: string,
    page = 1,
    pageSize = 10,
  ): Promise<SubmissionTimelineResult> {
    const profileId = await this.ensureProfileForUser(userId);
    const offset = (page - 1) * pageSize;

    const totalResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM patient_submissions WHERE profile_id = $1`,
      [profileId],
    );
    const total = Number(totalResult.rows[0]?.count ?? 0);

    const submissionsResult = await this.pool.query<{
      id: string;
      submission_kind: string;
      summary: string | null;
      changed_since_last: boolean | null;
      created_at: Date;
    }>(
      `SELECT id, submission_kind, summary, changed_since_last, created_at
       FROM patient_submissions
       WHERE profile_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [profileId, pageSize, offset],
    );

    const submissionIds = submissionsResult.rows.map((row) => row.id);
    if (submissionIds.length === 0) {
      return { page, pageSize, total, items: [] };
    }

    const [
      measurementsResult,
      functionTestsResult,
      symptomScoresResult,
      dailyImpactsResult,
      followupEventsResult,
      activityResult,
      medicationResult,
      documentResult,
    ] = await Promise.all([
      this.pool.query(
        `SELECT id, submission_id, recorded_at, muscle_group, metric_key, body_region, side,
                  strength_score, method, entry_mode, device_used, notes, created_at
           FROM patient_measurements
           WHERE submission_id = ANY($1::uuid[])
           ORDER BY recorded_at ASC`,
        [submissionIds],
      ),
      // Retracted rows drop out of the submission they were entered
      // with; the submission itself stays (its other rows are still
      // valid) and simply lists one fewer item.
      this.pool.query(
        `SELECT id, submission_id, test_type, measured_value, side, protocol, unit, device_used,
                  assistance_required, notes, not_applicable, performed_at, created_at
           FROM patient_function_tests
           WHERE submission_id = ANY($1::uuid[]) AND deleted_at IS NULL
           ORDER BY performed_at ASC`,
        [submissionIds],
      ),
      this.pool.query(
        `SELECT id, submission_id, symptom_key, score, scale_min, scale_max, notes, recorded_at, created_at
           FROM patient_symptom_scores
           WHERE submission_id = ANY($1::uuid[]) AND deleted_at IS NULL
           ORDER BY recorded_at ASC`,
        [submissionIds],
      ),
      this.pool.query(
        `SELECT id, submission_id, adl_key, difficulty_level, needs_assistance, notes, recorded_at, created_at
           FROM patient_daily_impacts
           WHERE submission_id = ANY($1::uuid[])
           ORDER BY recorded_at ASC`,
        [submissionIds],
      ),
      this.pool.query(
        `SELECT id, submission_id, event_type, severity, occurred_at, resolved_at, description,
                  linked_document_id, created_at
           FROM patient_followup_events
           WHERE submission_id = ANY($1::uuid[]) AND deleted_at IS NULL
           ORDER BY occurred_at ASC, created_at ASC`,
        [submissionIds],
      ),
      this.pool.query(
        `SELECT id, submission_id, log_date, source, content, mood_score, created_at
           FROM patient_activity_logs
           WHERE submission_id = ANY($1::uuid[])
           ORDER BY created_at ASC`,
        [submissionIds],
      ),
      this.pool.query(
        `SELECT id, submission_id, medication_name, dosage, frequency, route, start_date, end_date, notes, status, created_at
           FROM patient_medications
           WHERE submission_id = ANY($1::uuid[])
           ORDER BY created_at ASC`,
        [submissionIds],
      ),
      this.pool.query(
        `SELECT id, submission_id, document_type, title, file_name, mime_type, file_size_bytes, storage_uri, status, uploaded_at, checksum, ocr_payload
           FROM patient_documents
           WHERE submission_id = ANY($1::uuid[])
           ORDER BY uploaded_at ASC`,
        [submissionIds],
      ),
    ]);

    const grouped: Record<string, SubmissionSummary> = {};
    submissionsResult.rows.forEach((row) => {
      grouped[row.id] = {
        id: row.id,
        submissionKind: row.submission_kind,
        summary: row.summary ?? null,
        changedSinceLast: row.changed_since_last === null ? null : Boolean(row.changed_since_last),
        createdAt: toTimestampString(row.created_at),
        measurements: [],
        functionTests: [],
        symptomScores: [],
        dailyImpacts: [],
        followupEvents: [],
        activityLogs: [],
        medications: [],
        documents: [],
      };
    });

    measurementsResult.rows.forEach((row) => {
      const submissionId = row.submission_id as string;
      const target = grouped[submissionId];
      if (!target) return;
      target.measurements.push({
        id: row.id,
        muscleGroup: row.muscle_group,
        metricKey: row.metric_key ?? null,
        bodyRegion: row.body_region ?? null,
        side: row.side ?? null,
        strengthScore: Number(row.strength_score),
        method: row.method,
        entryMode: row.entry_mode ?? null,
        deviceUsed: row.device_used ?? null,
        notes: row.notes,
        recordedAt: toTimestampString(row.recorded_at),
        createdAt: toTimestampString(row.created_at),
        submissionId,
      });
    });

    functionTestsResult.rows.forEach((row) => {
      const submissionId = row.submission_id as string;
      const target = grouped[submissionId];
      if (!target) return;
      target.functionTests.push({
        id: row.id,
        testType: row.test_type,
        measuredValue: row.measured_value ? Number(row.measured_value) : null,
        side: row.side ?? null,
        protocol: row.protocol ?? null,
        unit: row.unit,
        deviceUsed: row.device_used ?? null,
        assistanceRequired:
          row.assistance_required === null ? null : Boolean(row.assistance_required),
        notes: row.notes,
        notApplicable: row.not_applicable === true,
        performedAt: toTimestampString(row.performed_at),
        createdAt: toTimestampString(row.created_at),
        submissionId,
      });
    });

    symptomScoresResult.rows.forEach((row) => {
      const submissionId = row.submission_id as string;
      const target = grouped[submissionId];
      if (!target) return;
      target.symptomScores.push({
        id: row.id,
        symptomKey: row.symptom_key,
        score: Number(row.score),
        scaleMin: Number(row.scale_min ?? 0),
        scaleMax: Number(row.scale_max ?? 10),
        notes: row.notes,
        recordedAt: toTimestampString(row.recorded_at),
        createdAt: toTimestampString(row.created_at),
        submissionId,
      });
    });

    dailyImpactsResult.rows.forEach((row) => {
      const submissionId = row.submission_id as string;
      const target = grouped[submissionId];
      if (!target) return;
      target.dailyImpacts.push({
        id: row.id,
        adlKey: row.adl_key,
        difficultyLevel: Number(row.difficulty_level),
        needsAssistance: row.needs_assistance === null ? null : Boolean(row.needs_assistance),
        notes: row.notes,
        recordedAt: toTimestampString(row.recorded_at),
        createdAt: toTimestampString(row.created_at),
        submissionId,
      });
    });

    followupEventsResult.rows.forEach((row) => {
      const submissionId = row.submission_id as string;
      const target = grouped[submissionId];
      if (!target) return;
      target.followupEvents.push({
        id: row.id,
        eventType: row.event_type,
        severity: row.severity ?? null,
        occurredAt: toTimestampString(row.occurred_at),
        resolvedAt: row.resolved_at ? toTimestampString(row.resolved_at) : null,
        description: row.description ?? null,
        linkedDocumentId: row.linked_document_id ?? null,
        createdAt: toTimestampString(row.created_at),
        submissionId,
      });
    });

    activityResult.rows.forEach((row) => {
      const submissionId = row.submission_id as string;
      const target = grouped[submissionId];
      if (!target) return;
      target.activityLogs.push({
        id: row.id,
        logDate: row.log_date.toISOString?.() ?? row.log_date,
        source: row.source,
        content: row.content,
        moodScore: row.mood_score === null ? null : Number(row.mood_score),
        createdAt: toTimestampString(row.created_at),
        submissionId,
      });
    });

    medicationResult.rows.forEach((row) => {
      const submissionId = row.submission_id as string;
      const target = grouped[submissionId];
      if (!target) return;
      target.medications.push({
        id: row.id,
        medicationName: row.medication_name,
        dosage: row.dosage,
        frequency: row.frequency,
        route: row.route,
        startDate: toDateString(row.start_date),
        endDate: toDateString(row.end_date),
        notes: row.notes,
        status: row.status,
        createdAt: toTimestampString(row.created_at),
        submissionId,
      });
    });

    documentResult.rows.forEach((row) => {
      const submissionId = row.submission_id as string;
      const target = grouped[submissionId];
      if (!target) return;
      target.documents.push({
        id: row.id,
        documentType: row.document_type,
        title: row.title,
        fileName: row.file_name,
        mimeType: row.mime_type,
        fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
        storageUri: row.storage_uri,
        status: row.status,
        uploadedAt: toTimestampString(row.uploaded_at),
        checksum: row.checksum,
        ocrPayload: withholdUnsafeReadings(row.ocr_payload ?? null),
        submissionId,
      });
    });

    const items = submissionsResult.rows.map((row) => grouped[row.id]).filter(Boolean);

    return {
      page,
      pageSize,
      total,
      items,
    };
  }

  async getProgressionSummary(userId: string): Promise<ProgressionSummaryDTO> {
    const profile = await this.getProfileByUserId(userId);
    if (!profile) {
      throw new AppError('Patient profile not found', 404);
    }

    const submissionsResult = await this.pool.query<{
      id: string;
      submission_kind: string;
      summary: string | null;
      changed_since_last: boolean | null;
      created_at: Date;
    }>(
      `SELECT id, submission_kind, summary, changed_since_last, created_at
       FROM patient_submissions
       WHERE profile_id = $1
       ORDER BY created_at DESC
       LIMIT 12`,
      [profile.id],
    );

    const submissions = submissionsResult.rows.map((row) => ({
      id: row.id,
      submissionKind: row.submission_kind,
      summary: row.summary ?? null,
      changedSinceLast: row.changed_since_last === null ? null : Boolean(row.changed_since_last),
      createdAt: toTimestampString(row.created_at),
    }));

    const latestSubmission = submissions[0] ?? null;
    const latestFollowupSubmission =
      submissions.find((item) => item.submissionKind !== 'baseline') ?? latestSubmission;
    const primarySubmissionId = latestFollowupSubmission?.id ?? latestSubmission?.id ?? null;

    const changeCards: ProgressionChangeCardDTO[] = [];
    const pushChangeCard = (card: ProgressionChangeCardDTO) => {
      if (changeCards.some((item) => item.domain === card.domain && item.title === card.title)) {
        return;
      }
      changeCards.push(card);
    };

    const measurementLatest = new Map<string, PatientMeasurementDTO>();
    const measurementPrevious = new Map<string, PatientMeasurementDTO>();
    profile.measurements.forEach((item) => {
      const key = `${item.metricKey ?? item.muscleGroup}:${item.side ?? 'none'}`;
      if (!measurementLatest.has(key)) {
        measurementLatest.set(key, item);
        return;
      }
      if (!measurementPrevious.has(key)) {
        measurementPrevious.set(key, item);
      }
    });

    Array.from(measurementLatest.values())
      .filter((item) => !primarySubmissionId || item.submissionId === primarySubmissionId)
      .slice(0, 6)
      .forEach((item) => {
        const key = `${item.metricKey ?? item.muscleGroup}:${item.side ?? 'none'}`;
        const previous = measurementPrevious.get(key);
        const title = buildMetricDisplayName(item.metricKey, item.muscleGroup, item.side);
        if (!previous) {
          pushChangeCard({
            id: item.id,
            domain: toDomainFromMetric(item.metricKey ?? item.muscleGroup),
            title,
            detail: `本次记录为 ${item.strengthScore} 分，后续可继续观察变化。`,
            trend: 'new',
            evidenceAt: item.recordedAt,
          });
          return;
        }

        const delta = item.strengthScore - previous.strengthScore;
        if (delta === 0) {
          return;
        }

        pushChangeCard({
          id: item.id,
          domain: toDomainFromMetric(item.metricKey ?? item.muscleGroup),
          title,
          detail: delta > 0 ? `较上次改善 ${delta} 分。` : `较上次下降 ${Math.abs(delta)} 分。`,
          trend: delta > 0 ? 'better' : 'worse',
          evidenceAt: item.recordedAt,
        });
      });

    const symptomLatest = new Map<string, PatientSymptomScoreDTO>();
    const symptomPrevious = new Map<string, PatientSymptomScoreDTO>();
    profile.symptomScores.forEach((item) => {
      if (!symptomLatest.has(item.symptomKey)) {
        symptomLatest.set(item.symptomKey, item);
        return;
      }
      if (!symptomPrevious.has(item.symptomKey)) {
        symptomPrevious.set(item.symptomKey, item);
      }
    });

    Array.from(symptomLatest.values())
      .filter((item) => !primarySubmissionId || item.submissionId === primarySubmissionId)
      .slice(0, 4)
      .forEach((item) => {
        const previous = symptomPrevious.get(item.symptomKey);
        const label = symptomLabels[item.symptomKey] ?? item.symptomKey;
        if (!previous) {
          pushChangeCard({
            id: item.id,
            domain: toDomainFromSymptom(item.symptomKey),
            title: label,
            detail: `当前自评 ${item.score}/${item.scaleMax}。`,
            trend: 'new',
            evidenceAt: item.recordedAt,
          });
          return;
        }

        const delta = item.score - previous.score;
        if (delta === 0) {
          return;
        }

        const higherIsBetter = item.symptomKey === 'sleep_quality';
        const isBetter = higherIsBetter ? delta > 0 : delta < 0;
        pushChangeCard({
          id: item.id,
          domain: toDomainFromSymptom(item.symptomKey),
          title: label,
          detail:
            delta > 0
              ? `${label}评分较上次${higherIsBetter ? '提高' : '升高'} ${Math.abs(delta)} 分。`
              : `${label}评分较上次${higherIsBetter ? '下降' : '降低'} ${Math.abs(delta)} 分。`,
          trend: isBetter ? 'better' : 'worse',
          evidenceAt: item.recordedAt,
        });
      });

    const impactLatest = new Map<string, PatientDailyImpactDTO>();
    const impactPrevious = new Map<string, PatientDailyImpactDTO>();
    profile.dailyImpacts.forEach((item) => {
      if (!impactLatest.has(item.adlKey)) {
        impactLatest.set(item.adlKey, item);
        return;
      }
      if (!impactPrevious.has(item.adlKey)) {
        impactPrevious.set(item.adlKey, item);
      }
    });

    Array.from(impactLatest.values())
      .filter((item) => !primarySubmissionId || item.submissionId === primarySubmissionId)
      .slice(0, 4)
      .forEach((item) => {
        const previous = impactPrevious.get(item.adlKey);
        const label = impactLabels[item.adlKey] ?? item.adlKey;
        if (!previous) {
          pushChangeCard({
            id: item.id,
            domain:
              item.adlKey === 'stairs' || item.adlKey === 'walking_outdoors'
                ? 'lower_limb'
                : 'upper_limb',
            title: label,
            detail: `当前困难程度 ${item.difficultyLevel}/5。`,
            trend: 'new',
            evidenceAt: item.recordedAt,
          });
          return;
        }

        const delta = item.difficultyLevel - previous.difficultyLevel;
        if (delta === 0) {
          return;
        }

        pushChangeCard({
          id: item.id,
          domain:
            item.adlKey === 'stairs' || item.adlKey === 'walking_outdoors'
              ? 'lower_limb'
              : 'upper_limb',
          title: label,
          detail:
            delta > 0
              ? `比上次更费力 ${Math.abs(delta)} 级。`
              : `比上次轻松 ${Math.abs(delta)} 级。`,
          trend: delta > 0 ? 'worse' : 'better',
          evidenceAt: item.recordedAt,
        });
      });

    profile.followupEvents
      .filter((item) => !primarySubmissionId || item.submissionId === primarySubmissionId)
      .slice(0, 3)
      .forEach((item) => {
        pushChangeCard({
          id: item.id,
          domain: 'events',
          title: eventLabels[item.eventType] ?? item.eventType,
          detail: item.description?.trim() || '已记录新的病程事件。',
          trend: 'new',
          evidenceAt: item.occurredAt,
        });
      });

    if (changeCards.length === 0 && latestSubmission?.summary) {
      pushChangeCard({
        id: latestSubmission.id,
        domain: 'symptoms',
        title: '本次随访摘要',
        detail: latestSubmission.summary,
        trend: latestSubmission.changedSinceLast ? 'new' : 'stable',
        evidenceAt: latestSubmission.createdAt,
      });
    }

    const timelineItems: ProgressionTimelineItemDTO[] = [
      ...profile.followupEvents.map((item) => ({
        id: item.id,
        title: eventLabels[item.eventType] ?? item.eventType,
        description: item.description?.trim() || '记录了一次病程事件',
        timestamp: item.occurredAt,
        tag: '事件' as const,
        linkedDocumentId: item.linkedDocumentId,
      })),
      ...profile.documents.map((item) => ({
        id: item.id,
        title: getDocumentDisplayTitle(item),
        description: summarizeDocumentForPatient(item),
        timestamp: item.uploadedAt,
        tag: '报告' as const,
        linkedDocumentId: item.id,
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 6);

    const recentReports = profile.documents.slice(0, 3).map((item) => ({
      id: item.id,
      title: getDocumentDisplayTitle(item),
      documentType: item.documentType,
      uploadedAt: item.uploadedAt,
      summary: summarizeDocumentForPatient(item),
    }));

    const lateralityPairs = new Map<
      string,
      {
        left?: PatientMeasurementDTO;
        right?: PatientMeasurementDTO;
        bilateral?: PatientMeasurementDTO;
      }
    >();

    profile.measurements.forEach((item) => {
      const key = item.metricKey ?? item.muscleGroup;
      const target = lateralityPairs.get(key) ?? {};
      if (item.side === 'left') target.left = target.left ?? item;
      if (item.side === 'right') target.right = target.right ?? item;
      if (item.side === 'bilateral' || item.side === 'none' || !item.side) {
        target.bilateral = target.bilateral ?? item;
      }
      lateralityPairs.set(key, target);
    });

    const leftDominant: string[] = [];
    const rightDominant: string[] = [];
    const bilateral: string[] = [];

    lateralityPairs.forEach((pair, key) => {
      const label = metricLabels[key] ?? key;
      if (pair.left && pair.right) {
        const diff = pair.left.strengthScore - pair.right.strengthScore;
        if (Math.abs(diff) >= 1) {
          if (diff < 0) {
            leftDominant.push(label);
          } else {
            rightDominant.push(label);
          }
        } else {
          bilateral.push(label);
        }
        return;
      }

      if (pair.left && !pair.right) {
        leftDominant.push(label);
        return;
      }

      if (!pair.left && pair.right) {
        rightDominant.push(label);
        return;
      }

      if (pair.bilateral) {
        bilateral.push(label);
      }
    });

    const recommendedReviewItems: string[] = [];
    if (!profile.baseline) {
      recommendedReviewItems.push('先在注册时补齐基础档案，后续系统才能更准确比较变化。');
    }
    if (!submissions.some((item) => item.submissionKind === 'followup')) {
      recommendedReviewItems.push('补一次快速随访，系统才能回答“和上次相比有没有变化”。');
    }
    const hasSleepRecord = profile.symptomScores.some(
      (item) => item.symptomKey === 'sleep_quality',
    );
    if (!hasSleepRecord) {
      recommendedReviewItems.push('先保留一条睡眠记录，后续可切换为 Apple Watch 报告识别。');
    }
    const hasRecentStairsRecord = profile.dailyImpacts.some((item) => {
      if (item.adlKey !== 'stairs') {
        return false;
      }
      const days = (Date.now() - new Date(item.recordedAt).getTime()) / (1000 * 60 * 60 * 24);
      return !Number.isNaN(days) && days <= 90;
    });
    if (!hasRecentStairsRecord) {
      recommendedReviewItems.push('最近补一次上楼变化记录，便于观察功能趋势。');
    }
    if (profile.documents.length === 0) {
      recommendedReviewItems.push('有新检查时上传报告，系统会自动生成患者版摘要。');
    }

    let headline = '先完成一次随访';
    let detail = '后续首页会优先告诉你最近哪里有变化。';
    if (latestSubmission?.summary) {
      headline =
        latestSubmission.summary.length > 30
          ? `${latestSubmission.summary.slice(0, 30)}…`
          : latestSubmission.summary;
      detail = latestSubmission.changedSinceLast
        ? '最近一次记录提示和上次相比有变化。'
        : '最近一次记录显示整体变化不大。';
    } else if (latestSubmission?.submissionKind === 'baseline') {
      headline = '已完成基础档案';
      detail = '以后只需要在变化时补快速随访或事件记录。';
    } else if (changeCards[0]) {
      headline = changeCards[0].title;
      detail = changeCards[0].detail;
    }

    return {
      generatedAt: new Date().toISOString(),
      currentStatus: {
        headline,
        detail,
        lastFollowupAt: latestFollowupSubmission?.createdAt ?? null,
        baselineReady: Boolean(profile.baseline),
        hasNewChanges: latestSubmission?.changedSinceLast ?? null,
      },
      changeCards: changeCards.slice(0, 6),
      recentEvents: timelineItems,
      recentReports,
      lateralOverview: {
        leftDominant: leftDominant.slice(0, 4),
        rightDominant: rightDominant.slice(0, 4),
        bilateral: bilateral.slice(0, 4),
      },
      recommendedReviewItems: recommendedReviewItems.slice(0, 5),
    };
  }

  private async ensureProfileForUser(userId: string, client?: PoolClient): Promise<string> {
    const executor = client ?? this.pool;
    const result = await executor.query<{ id: string }>(
      'SELECT id FROM patient_profiles WHERE user_id = $1',
      [userId],
    );

    if (!result.rowCount) {
      throw new AppError('Patient profile not found', 404);
    }

    return result.rows[0].id;
  }

  /**
   * Public preflight for write paths that incur side effects *before*
   * the row insert (uploadDocument writes to storage and runs OCR
   * before calling `addUploadedDocument`). Always verifies the caller
   * has a patient profile; additionally verifies submission ownership
   * when a `submissionId` is supplied.
   *
   * Throws the same 404s the per-handler checks would raise so the
   * caller can short-circuit without duplicating SQL:
   *   - "Patient profile not found" when the user has no profile row
   *     (e.g. a newly registered account that hasn't completed
   *     onboarding yet); without this, a profile-less caller could
   *     repeatedly upload 10 MB files and force OCR work before the
   *     downstream insert finally 404s.
   *   - "Submission not found" when a `submissionId` is supplied but
   *     belongs to another user or doesn't exist.
   *
   * Both branches are cheap SELECTs, so running them upfront costs
   * far less than the storage write + OCR pass a later 404 would
   * have already triggered.
   */
  async assertCallerCanWriteSubmission(
    userId: string,
    submissionId: string | null | undefined,
  ): Promise<void> {
    const profileId = await this.ensureProfileForUser(userId);
    if (submissionId) {
      await this.assertSubmissionOwnedByProfile(submissionId, profileId);
    }
  }

  /**
   * Verify a caller-supplied `submissionId` actually belongs to the
   * caller's profile. Returns the id if it checks out (or `null` when
   * the caller did not supply one); throws 404 otherwise. Used by every
   * `add*` handler that accepts `submissionId` in its payload — without
   * this, a patient could pin their own measurement / followup / etc.
   * onto another patient's submission timeline simply by guessing or
   * trying a sequential UUID. The 404 mirrors how `ensureProfileForUser`
   * handles missing rows so callers can't distinguish "wrong owner"
   * from "no such submission".
   */
  private async assertSubmissionOwnedByProfile(
    submissionId: string | null | undefined,
    profileId: string,
  ): Promise<string | null> {
    if (!submissionId) return null;
    const result = await this.pool.query(
      'SELECT 1 FROM patient_submissions WHERE id = $1 AND profile_id = $2',
      [submissionId, profileId],
    );
    if (!result.rowCount) {
      throw new AppError('Submission not found', 404);
    }
    return submissionId;
  }

  /**
   * Same idea as assertSubmissionOwnedByProfile but for a foreign key
   * onto patient_documents — currently the `linkedDocumentId` on
   * followup events. A 404 hides "wrong owner" from "no such document".
   */
  private async assertDocumentOwnedByProfile(
    documentId: string | null | undefined,
    profileId: string,
  ): Promise<string | null> {
    if (!documentId) return null;
    const result = await this.pool.query(
      'SELECT 1 FROM patient_documents WHERE id = $1 AND profile_id = $2',
      [documentId, profileId],
    );
    if (!result.rowCount) {
      throw new AppError('Document not found', 404);
    }
    return documentId;
  }

  async getMuscleInsight(
    userId: string,
    muscleGroup: string,
    limit = 12,
  ): Promise<MuscleInsightResult> {
    const profileId = await this.ensureProfileForUser(userId);

    const [trendResult, distributionResult, latestResult] = await Promise.all([
      // Newest-first + LIMIT, reversed in JS below. The query used to
      // fetch a patient's entire history for this muscle group and
      // `.slice(-limit)` it away in memory — same answer, but the cost
      // grew with how long someone has been using the app, which is
      // backwards for a chart that only ever draws the last `limit`
      // points. DESC also matches idx_patient_measurements_latest's
      // own direction, so the ordering is free.
      this.pool.query(
        `SELECT recorded_at, strength_score
         FROM patient_measurements
         WHERE profile_id = $1 AND muscle_group = $2
         ORDER BY recorded_at DESC
         LIMIT $3`,
        [profileId, muscleGroup, limit],
      ),
      // One row per OTHER patient, then aggregate. The row picked is
      // that patient's latest score for this muscle group — deliberately
      // the same statistic as `userLatestScore` below, because the two
      // numbers are rendered side by side (「群体中位 X 分」 next to
      // 「你 Y 分」) and a comparison between a median-of-all-history and
      // a latest-value is not a comparison of anything.
      //
      // Aggregating the raw rows instead is what this used to do, and it
      // let one person be the cohort: 11 patients who tested deltoid once
      // at 5, plus one who tests daily at 1, is 211 rows whose median is
      // 1 and whose COUNT(DISTINCT profile_id) is 12 — 「群体中位 1 分 ·
      // 12 人」, when 11 of those 12 people score above it. Verified on
      // Postgres: same data, row-weighted median 1, person-weighted 5.
      // The skew is not confined to that extreme — it is present at every
      // ratio of testing frequency, and testing frequency is not a
      // property of the disease.
      //
      // Ties on recorded_at are real: a left/right pair inserted in one
      // transaction shares NOW(). Without a tiebreak DISTINCT ON picks
      // arbitrarily and two identical requests can return two different
      // medians, so break on strength_score DESC — which also keeps every
      // column this reads inside idx_patient_measurements_cohort (see
      // migration 025) and the plan an Index Only Scan. The latest-score
      // query below has no such tiebreak, so on a tie it can show the
      // other side of the pair; that decides one patient's own row rather
      // than a whole cohort's median, and giving it this ORDER BY would
      // cost it its own index-ordered LIMIT 1.
      this.pool.query(
        `WITH per_patient AS (
           SELECT DISTINCT ON (profile_id) profile_id, strength_score
           FROM patient_measurements
           WHERE muscle_group = $1 AND profile_id <> $2
           ORDER BY profile_id, recorded_at DESC, strength_score DESC
         )
         SELECT
           MIN(strength_score) AS min_score,
           MAX(strength_score) AS max_score,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY strength_score) AS median_score,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY strength_score) AS quartile_25,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY strength_score) AS quartile_75,
           COUNT(*) AS sample_count
         FROM per_patient`,
        [muscleGroup, profileId],
      ),
      this.pool.query(
        `SELECT strength_score
         FROM patient_measurements
         WHERE profile_id = $1 AND muscle_group = $2
         ORDER BY recorded_at DESC
         LIMIT 1`,
        [profileId, muscleGroup],
      ),
    ]);

    // Back to oldest-first: the chart plots left to right in time.
    const trend = trendResult.rows
      .map((row) => ({
        recordedAt: toTimestampString(row.recorded_at),
        strengthScore: Number(row.strength_score),
      }))
      .reverse();

    const distributionRow = distributionResult.rows[0];
    /**
     * Three defects sat on top of each other here, and together they
     * made this screen state a falsehood to a patient about their own
     * disease.
     *
     *  1. No self-exclusion. The first patient to record a muscle test
     *     was compared against their own scores and told it was the
     *     cohort. The query now carries `profile_id <> $2`.
     *  2. The whole row was row-weighted while the caption said 人. The
     *     first pass at this fixed only the count — COUNT(*) → COUNT(
     *     DISTINCT profile_id) — and left MIN/MAX and the three
     *     percentiles aggregating raw rows, so the number of PEOPLE was
     *     printed beside a median of MEASUREMENTS and the two were not
     *     about the same population. The query now collapses to one row
     *     per patient first; see its comment for which row and why.
     *  3. No floor at all. A median over two people is not a
     *     distribution, and at this size it is re-identifying: with
     *     three contributors each one can subtract themselves and read
     *     the other two.
     *
     * Below the floor the block is withheld entirely rather than shown
     * with a caveat. A caveat under a number does not stop the number
     * being read, and the number being read here is「我比别人差多少」.
     */
    const distribution =
      Number(distributionRow?.sample_count ?? 0) >= COHORT_MIN_PATIENTS
        ? {
            muscleGroup,
            minScore: Number(distributionRow.min_score),
            maxScore: Number(distributionRow.max_score),
            medianScore: Number(distributionRow.median_score),
            quartile25: Number(distributionRow.quartile_25),
            quartile75: Number(distributionRow.quartile_75),
            sampleCount: Number(distributionRow.sample_count),
          }
        : null;

    const latestRow = latestResult.rows[0];
    const userLatestScore = latestRow ? Number(latestRow.strength_score) : null;

    return {
      muscleGroup,
      trend,
      distribution,
      userLatestScore,
    };
  }

  /**
   * Read the AI consent state for the calling user. Returns `null`
   * when the user hasn't completed onboarding (no profile row yet),
   * so the controller can map that to a 404 rather than fabricating
   * a "never consented" row.
   */
  async getConsentStatus(userId: string): Promise<ConsentStatus> {
    return getConsentStatus(this.pool, userId);
  }

  async getConsentDetails(userId: string): Promise<ConsentDetails | null> {
    return getConsentDetails(this.pool, userId);
  }

  /**
   * Apply a partial consent update. Delegates to the security helper
   * so the precise-requires-base rule, per-flag `_at` bookkeeping,
   * and the `ai_consent_events` audit trail all live in one place.
   * `ConsentMutationError` is rethrown as an `AppError` so the route
   * layer can stay framework-flavoured.
   */
  async updateConsent(userId: string, input: ConsentUpdateInput): Promise<ConsentDetails> {
    try {
      const updated = await updateConsent(this.pool, userId, input);
      this.logger.info(
        {
          userId,
          level: updated.level,
          flags: updated.flags,
        },
        'AI consent updated',
      );
      return updated;
    } catch (error) {
      if (error instanceof ConsentMutationError) {
        const status = error.code === 'profile_not_found' ? 404 : 400;
        throw new AppError(error.message, status);
      }
      throw error;
    }
  }

  /**
   * List the grant/revoke history rows for the given user, newest
   * first. Powers the "consent timeline" view inside the audit
   * screen. Returns `[]` for a brand-new user (no events yet); the
   * controller surfaces that as an empty list rather than a 404 so
   * the UI can render its empty state without a special case.
   */
  async getConsentHistory(
    userId: string,
    options: ConsentHistoryOptions = {},
  ): Promise<ConsentEvent[]> {
    return getConsentHistory(this.pool, userId, options);
  }

  /**
   * Read the four data-sharing preferences. Returns `null` when the
   * user hasn't completed onboarding (no profile row), so the
   * controller can map that to 404 the same way it does for AI
   * consent.
   */
  async getSharingPreferences(userId: string): Promise<SharingPreferences | null> {
    return getSharingPreferences(this.pool, userId);
  }

  /**
   * Apply a partial sharing-preference update. Delegates to the
   * helper so the unspecified-keeps-current-value rule + per-flag
   * `_at` bookkeeping stay in one place. `SharingPreferenceMutationError`
   * is rethrown as an `AppError` so the route layer stays
   * framework-flavoured.
   */
  async updateSharingPreferences(
    userId: string,
    input: SharingPreferenceUpdateInput,
  ): Promise<SharingPreferences> {
    try {
      const updated = await updateSharingPreferences(this.pool, userId, input);
      this.logger.info(
        {
          userId,
          flags: updated.flags,
        },
        'Sharing preferences updated',
      );
      return updated;
    } catch (error) {
      if (error instanceof SharingPreferenceMutationError) {
        const status = error.code === 'profile_not_found' ? 404 : 400;
        throw new AppError(error.message, status);
      }
      throw error;
    }
  }

  /** Account-deletion lifecycle — thin wrappers over the helper so
   *  the routes layer keeps one service dependency. Error mapping to
   *  HTTP status lives in the controller (DeletionRequestError carries
   *  a code). */
  async requestAccountDeletion(
    userId: string,
    confirmPhoneNumber: string,
  ): Promise<DeletionRequestStatus> {
    const status = await requestAccountDeletion(this.pool, userId, confirmPhoneNumber);
    this.logger.info(
      { userId, scheduledPurgeAt: status.scheduledPurgeAt },
      'Account deletion requested',
    );
    return status;
  }

  async cancelAccountDeletion(userId: string): Promise<DeletionRequestStatus> {
    const status = await cancelAccountDeletion(this.pool, userId);
    this.logger.info({ userId }, 'Account deletion cancelled');
    return status;
  }

  async getAccountDeletionStatus(userId: string): Promise<DeletionRequestStatus | null> {
    return getAccountDeletionStatus(this.pool, userId);
  }

  async purgeDueAccountDeletions(
    removeFile: (storageUri: string) => Promise<void>,
  ): Promise<number> {
    return purgeDueAccountDeletions(this.pool, removeFile, this.logger);
  }
}
