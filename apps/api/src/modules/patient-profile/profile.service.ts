import type { Pool, PoolClient } from 'pg';
import {
  cancelAccountDeletion,
  getAccountDeletionStatus,
  purgeDueAccountDeletions,
  requestAccountDeletion,
  type DeletionRequestStatus,
} from './account-deletion.js';
import type { FallDTO } from './falls/falls.service.js';
import {
  FALL_DIARY_SQL,
  isFallActivity,
  isFallLocation,
  type FallDiaryRow,
} from './falls/falls.sql.js';
import { InstrumentsService, type AdministrationDTO } from './instruments/instruments.service.js';
import { PassportShareService, type PassportShareLink } from './passport-share.service.js';
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
import { flagKey, referenceKey } from '../ai-agents/security/allowlist.js';
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

/**
 * The falls diary's live predicate takes a window in days, and the
 * portability export is NOT a window.
 *
 * Every other reader of `patient_falls` is a screen or a summary and
 * legitimately asks 「最近」 — the diary caps at 730 days for the reason
 * falls.schema.ts records. A file handed over under 个保法可携带权 has
 * no such horizon: a fall the patient logged in 2019 is part of the
 * record they are entitled to take with them, and answering with the
 * last two years would be the same silent drop this section exists to
 * close, just smaller.
 *
 * FALL_DIARY_SQL requires `$2`, so this passes one wide enough that no
 * storable row can fall outside it. `occurred_on` is a DATE and
 * `fallDateString` refuses future dates, so every row that exists is in
 * the past; 400,000 days is ~1,095 years, which no patient's past is.
 */
const EXPORT_FALLS_WINDOW_DAYS = 400_000;

/**
 * `PassportShareService.list` ends in `LIMIT 50`. Mirrored here — not
 * imported, because it is a literal inside that query — so the export
 * can say it was capped instead of presenting a truncated list of
 * doors as the complete one.
 *
 * If that literal ever changes, this flag mis-reports by exactly the
 * difference and nothing else breaks; the list itself is whatever the
 * one query returns.
 */
const PASSPORT_SHARE_LIST_LIMIT = 50;

/** Item responses come back from `listAdministrations` already
 *  attached; 200 is that endpoint's own schema ceiling per call. */
const EXPORT_INSTRUMENT_PAGE_SIZE = 200;

/** One acceptance row per (document, version) the user ever tapped
 *  through, withdrawals included. Bounded anyway — the CHECK admits
 *  four document ids — so this cap only ever fires on a pathological
 *  account. */
const EXPORT_MAX_LEGAL_ACCEPTANCE_ROWS = 500;

/** One row of `legal_document_acceptances`, as the portability export
 *  carries it.
 *
 *  `withdrawnAt` is carried rather than filtered, which is the one way
 *  this read differs from both live readers in legal.service.ts. They
 *  ask 「is this consent in force」 and must drop withdrawn rows; this
 *  asks 「what did I authorise and when did I take it back」, and a
 *  withdrawal the patient cannot see in their own授权历史 is the half
 *  of the story they are most likely to need. */
export interface LegalAcceptanceExportDTO {
  document: string;
  version: string;
  acceptedAt: string;
  withdrawnAt: string | null;
}

/** Same shape `GET /me/falls` returns, field for field, so the export
 *  and the diary screen cannot disagree about one fall. Built here
 *  rather than imported because `toFallDTO` is private to
 *  falls.service.ts; `FallDTO` itself is imported, so a drift in that
 *  shape is a compile error rather than a quiet difference. */
const toExportFallDTO = (row: FallDiaryRow): FallDTO => ({
  id: row.id,
  occurredOn: row.occurred_on,
  daysAgo: Math.max(0, row.fall_day_age),
  activity: isFallActivity(row.activity) ? row.activity : null,
  location: isFallLocation(row.location) ? row.location : null,
  handsFull: row.hands_full,
  gotUpUnaided: row.got_up_unaided,
  injured: row.injured,
  createdAt:
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString(),
});

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

/**
 * 「WE HAVE NOT MEASURED THIS」 IS ITS OWN BAND, AND IT IS NOT `high`.
 *
 * Each axis is a reading of a record, and a record can be empty. An
 * empty one used to be graded anyway — `activityLevel` fell to `high`
 * and `strengthLevel` to `medium` — so a patient who registered five
 * minutes ago and has typed nothing was handed the same 高关注 chip, in
 * the same red, as a patient whose logs stopped six weeks ago. There is
 * no reading behind that chip: nothing has been observed to be wrong,
 * and 「nothing observed」 is what the axis actually knows.
 *
 * `unknown` is what it says instead. The client already renders it
 * correctly without being changed — `getRiskMeta`
 * (apps/mobile/lib/clinical-visuals.ts) answers anything outside the
 * three graded bands with a grey 「暂无评估」, which is the sentence
 * this state means, and it chose grey deliberately so an unloaded
 * summary could not read as reassurance either.
 *
 * This is the rule the surveillance rows already follow: they print
 * 「本平台没有你的疼痛记录」 rather than 「不适用」, because a platform
 * that has not been told something must say so rather than answer for
 * the patient. A risk band is the same statement in a stronger form —
 * it is the one line on the screen a patient acts on — so it is the
 * last place absence may be read as evidence.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export interface RiskSummary {
  overallLevel: RiskLevel;
  strengthLevel: RiskLevel;
  activityLevel: RiskLevel;
  latestMeasurement?: PatientMeasurementDTO;
  /**
   * The DAY of the newest activity log, not an instant.
   * `patient_activity_logs.log_date` is a `date` column; see
   * `toRequiredDateString`.
   */
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

/**
 * A `date` COLUMN IS A DAY, AND `toISOString` IS NOT HOW YOU READ ONE.
 *
 * node-postgres decodes `date` (OID 1082) as `new Date(y, m - 1, d)` —
 * midnight in the SERVER PROCESS'S ZONE. `toISOString` then re-reads
 * that instant in UTC, and east of Greenwich midnight local is the
 * previous day in UTC: an activity log the patient dated 2026-08-19
 * came back as `2026-08-18T16:00:00.000Z` under `TZ=Asia/Shanghai`,
 * which is where this product runs. Every caller of `logDate` therefore
 * showed and sorted a day that was one early, and printed a
 * time-of-day for a column that has never held one.
 *
 * `toDateString` is the reader that already gets this right — it takes
 * the local Y/M/D back out, which are the three numbers Postgres sent.
 * This wrapper is that function for the columns declared NOT NULL, so
 * the DTO can keep promising a `string`. The throw is unreachable
 * through SQL (`log_date DATE NOT NULL DEFAULT CURRENT_DATE`) and is
 * here because the alternative — an empty string — would reach
 * `new Date('')` in the passport's sort comparators as a silent NaN.
 */
const toRequiredDateString = (value: string | Date): string => {
  const day = toDateString(value);
  if (day === null) {
    throw new AppError('Stored date column came back empty', 500);
  }
  return day;
};

/**
 * Midnight of the local calendar day a value falls on.
 *
 * Used to count whole days between two things that are days. Measuring
 * from an instant instead makes the answer depend on what time it is:
 * the same 7-day-old log reads as 6 days before noon and 7 after, so a
 * band boundary moves during the afternoon. Both operands go through
 * here so only the calendar difference survives.
 */
const startOfLocalDay = (value: string | Date): Date => {
  const day = toRequiredDateString(value);
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
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
 *     different analytes carrying the identical reading CAN be the
 *     signature of a column that slipped: CK, CK-MB, 肌酐 and LDH all
 *     reading 693 is one cell copied four times, and no laboratory
 *     printed that. When the answer is yes both readings are WITHHELD,
 *     not one — the payload does not say which of the two is the cell
 *     that was really read, and picking would be this file inventing a
 *     clinical value. The same question asked of ONE analyte's own
 *     spellings — `ldh` against `table_ldh` — is the sharper form of
 *     it, and catches the archived document whose LDH is a row index
 *     while the laboratory's real LDH sits beside it under the other
 *     key.
 *
 *     BUT 「TWO ANALYTES, ONE NUMBER」 IS NOT BY ITSELF THE SIGNATURE,
 *     AND TREATING IT AS ONE DELETED CORRECT DATA. ALT and AST at the
 *     same figure is an everyday biochemistry result — the two enzymes
 *     leak from the same muscle — and so is CK-MB with myoglobin, or
 *     albumin with ALP. Measured against this deployment's own archive
 *     the previous shape of this rule was wrong on nearly half the rows
 *     it fired on: nine documents carry a repeated reading, seven of
 *     them the four-way CK/CK-MB/肌酐/LDH collapse, and the other TWO
 *     are ordinary pairs — 8 correct readings across 4 documents, each
 *     one blanked on the passport, the share page and the exports by a
 *     guard that exists to protect them. Over-deleting a correct
 *     reading is a clinical defect in its own right, not a safe
 *     direction to err in.
 *
 *     SO THE PAYLOAD IS MADE TO CORROBORATE THE SLIP BEFORE ANYTHING IS
 *     DELETED, out of what it already holds and nothing else:
 *
 *       THE REPORT'S OWN PAGE. `extractedText` is the OCR dump of the
 *       paper, and a laboratory that really printed the figure on two
 *       rows printed it TWICE. Counting the figure among the page's
 *       numeric tokens separates the two cases outright, and on this
 *       archive it separates them completely: on all seven collapsed
 *       documents the number appears ONCE while four analytes claim it,
 *       and on all four ordinary pairs it appears at least as often as
 *       the analytes claiming it. This is the strongest signal and it
 *       is asked first.
 *
 *       THREE ROWS, ONE FIGURE. No panel prints one number on three
 *       different rows by chance, so a group of three or more is a slip
 *       whatever the page says — and it is the archived shape.
 *
 *       THE KNOWN COLLISION. `ck` against `ldh` is this parser's own
 *       documented defect, five archived documents of it, and it is
 *       taken as corroboration on a row whose page cannot be read.
 *
 *       ONE UNIT AND ONE INTERVAL. Two DIFFERENT analytes carrying the
 *       same number under the same unit AND the same printed reference
 *       interval is one whole row read twice; two real rows would
 *       differ somewhere.
 *
 *     WHERE THE PAGE IS ILLEGIBLE AND NOTHING ELSE CORROBORATES, THE
 *     PAIR IS MARKED RATHER THAN DELETED. 「I cannot tell」 is a true
 *     thing to say and a blank cell is not.
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
 *
 * AND WHAT A FLAGGED READING LEAVES BEHIND IS A JOB FOR THE SURFACES,
 * WHICH IS THE HALF OF THIS DEFENCE THAT LIVES OUTSIDE THIS FILE.
 * `flagged` deletes nothing. It exists so that a reading outside the
 * interval the report itself printed — or a duplicate the page could
 * not settle — is not printed as an ordinary number. Every surface that
 * renders `ocrPayload.fields` gets `unsafeReadings` on the SAME object
 * and can join the two on `keys`:
 *
 *     const marks = new Map<string, UnsafeReading>();
 *     for (const item of payload.unsafeReadings ?? [])
 *       for (const key of item.keys) marks.set(key, item);
 *     // then, per rendered cell: marks.get(fieldKey)
 *
 * A surface that renders the payload and never reads this array prints
 * a flagged value as fact, and a defence that marks where nothing shows
 * the mark is a defence that does nothing. The surfaces are named in
 * the module note at the top of the guard: the passport, the share
 * page, the referral pack, the three exports and the report screen.
 * `unsafeReadingsNotice` is the one-line form for a surface with no
 * room to mark cells individually.
 */
export interface UnsafeReading {
  /** Canonical analyte name, as the parser names it (`ldh`, `uric_acid`). */
  analyte: string;
  /**
   * Every `fields` spelling that carried it.
   *
   * THIS IS THE JOIN, AND IT IS WHY IT IS A LIST. A surface marking a
   * flagged reading is holding a `fields` cell keyed by SPELLING —
   * `ldh`, `table_ldh`, `creatineKinase` — and has no way back to the
   * canonical name. Matching a rendered cell against these keys is the
   * whole of what a surface has to do to find its mark. On a WITHHELD
   * entry the keys are the cells that are no longer there, which is how
   * a screen says WHICH value it stopped showing.
   */
  keys: string[];
  disposition: 'withheld' | 'flagged';
  reason: 'duplicate_reading' | 'contradictory_aliases' | 'outside_reference_interval';
  /** The other analytes sharing this value (duplicate_reading only). */
  sharedWith?: string[];
  /**
   * Why this duplicate was believed, in one word, so a surface can say
   * 「报告原件只印了一次」 rather than the generic sentence — and so
   * this file's judgement is legible in an audit rather than only in
   * its own comments. Absent on the other two reasons.
   */
  corroboration?: 'page_prints_it_once' | 'three_or_more_rows' | 'known_pair' | 'one_row_twice';
}

/**
 * A reading is NEVER accompanied by its value in this record.
 *
 * `unsafeReadings` travels on the same payload the withheld cell was
 * deleted from, and every surface that prints `fields` can print this
 * too. A `value` here would hand the number straight back under a
 * second key and the deletion would be theatre. The analyte, its
 * spellings and the reason are everything a surface needs to place the
 * mark; the number is the one thing it must not be given.
 */

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

/** `table_ldh` → `tableLdh`. The bridge writes an analyte's flag and
 *  reference under the CAMEL spelling of the value's key and no other
 *  (allowlist.ts states the rule), so retiring a spelling means asking
 *  for its siblings under that form. */
const flattenToCamelKey = (key: string) =>
  key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());

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

/**
 * The unit the laboratory printed beside the number, lowercased, or
 * nothing.
 *
 * `formatStructuredValue` staples the unit on — 「693 U/L」 — so the
 * cell already carries it and no lookup table is needed. Compared only
 * ever against another cell off the SAME payload, so the casing and
 * spacing of whatever the OCR read is consistent on both sides.
 */
const readReadingUnit = (raw: unknown): string | null => {
  const text = String(raw ?? '').trim();
  const match = /^-?\d+(?:\.\d+)?\s*(.*)$/.exec(text);
  const unit = match?.[1]?.trim() ?? '';
  return unit ? unit.toLowerCase() : null;
};

const FULL_WIDTH_DIGITS = '０１２３４５６７８９';

/**
 * The page's digits as ASCII, with thousands separators removed, so
 * 「１，６９３」 and 「1,693」 and 「1693」 all count as the same figure.
 * A page read by OCR carries whichever of the three the scan produced.
 */
const normalisePageDigits = (text: string) =>
  text
    .replace(/[０-９．]/g, (char) =>
      char === '．' ? '.' : String(FULL_WIDTH_DIGITS.indexOf(char)),
    )
    .replace(/,(?=\d{3}(?!\d))/g, '');

/**
 * HOW OFTEN THE REPORT'S OWN PAGE PRINTS EACH FIGURE — the corroboration
 * that decides question 1, and the only one drawn from outside `fields`.
 *
 * `null` means the page cannot answer: absent, blank, or carrying no
 * number at all. That is deliberately distinct from 「the number is not
 * there」, which is an answer and a damning one. A row whose page is
 * missing gets the weaker signals and, failing those, a mark instead of
 * a deletion.
 *
 * Counting NUMERIC TOKENS rather than substrings, because 「693」 is
 * inside 「1693」 and a substring search would find the figure on a page
 * that never printed it. Parsed as numbers, so 693 and 693.0 are one
 * figure — the OCR and the extractor do not agree on trailing zeros.
 */
const readPageFigureCounts = (record: Record<string, unknown>): Map<number, number> | null => {
  const raw = record.extractedText ?? record.extracted_text;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const counts = new Map<number, number>();
  for (const match of normalisePageDigits(raw).matchAll(/-?\d+(?:\.\d+)?/g)) {
    const value = Number(match[0]);
    if (!Number.isFinite(value)) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts.size ? counts : null;
};

/**
 * THIS PARSER'S OWN DOCUMENTED COLLISION.
 *
 * Five archived documents publish an LDH that is the CK value off the
 * same report. That is not a hypothesis about laboratories, it is a
 * defect this repository has measured in its own archive, so the pair
 * is corroboration on a row whose page cannot be read. Kept to what the
 * archive actually shows: a list grown by guesswork would put this rule
 * back where it started, deleting ordinary pairs on suspicion.
 */
const KNOWN_COLLISION_PAIRS = new Set(['ck|ldh']);

const isKnownCollisionPair = (analytes: readonly string[]) =>
  analytes.length === 2 && KNOWN_COLLISION_PAIRS.has([...analytes].sort().join('|'));

/**
 * No panel prints one figure on this many different rows by chance.
 * Three is the smallest group for which that is true; the archived
 * collapse is four.
 */
const DUPLICATE_GROUP_IS_A_COLLAPSE = 3;

/**
 * Is this group of analytes sharing one figure a slipped column, an
 * ordinary coincidence, or something this payload cannot say?
 *
 * Three answers, not two, and the third is the point. `slipped` is
 * deleted, `sound` is an ordinary reading and falls through to question
 * 2 like any other, and `unknown` — the page is illegible and nothing
 * else corroborates — is MARKED. Collapsing `unknown` into `slipped` is
 * exactly what deleted 8 correct readings off this archive; collapsing
 * it into `sound` would publish a collapsed column in silence on any
 * row whose page never landed.
 *
 * Ordered strongest first.
 */
type DuplicateVerdict =
  | { verdict: 'slipped'; corroboration: NonNullable<UnsafeReading['corroboration']> }
  | { verdict: 'sound' }
  | { verdict: 'unknown' };

const corroborateDuplicateGroup = (input: {
  analytes: readonly string[];
  value: number;
  pageFigures: Map<number, number> | null;
  unitOf: (analyte: string) => string | null;
  intervalOf: (analyte: string) => string | null;
}): DuplicateVerdict => {
  const { analytes, value, pageFigures } = input;

  if (analytes.length >= DUPLICATE_GROUP_IS_A_COLLAPSE) {
    return { verdict: 'slipped', corroboration: 'three_or_more_rows' };
  }

  if (pageFigures) {
    // The page is legible, so it is the answer — in BOTH directions. A
    // figure printed as often as it is claimed is two real rows and
    // this function has nothing to say about it.
    return (pageFigures.get(value) ?? 0) >= analytes.length
      ? { verdict: 'sound' }
      : { verdict: 'slipped', corroboration: 'page_prints_it_once' };
  }

  if (isKnownCollisionPair(analytes)) {
    return { verdict: 'slipped', corroboration: 'known_pair' };
  }

  const units = analytes.map(input.unitOf);
  const intervals = analytes.map(input.intervalOf);
  const sameUnit = units[0] !== null && units.every((unit) => unit === units[0]);
  const sameInterval = intervals[0] !== null && intervals.every((iv) => iv === intervals[0]);
  if (sameUnit && sameInterval) {
    return { verdict: 'slipped', corroboration: 'one_row_twice' };
  }

  return { verdict: 'unknown' };
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

/**
 * THE NOTICE SAYS WHAT HAPPENED TO THIS PAYLOAD, NOT WHAT THIS FILE CAN
 * DO IN GENERAL.
 *
 * One fixed string stood here and it asserted a withholding on every
 * payload it was attached to — including the payloads where nothing was
 * withheld at all. A report whose only finding is an elevated CK, still
 * printed, still on the passport, told its reader 「已经不再显示」 about
 * values that are right there on the screen. A patient who then goes
 * looking for the missing number cannot find it, because it was never
 * missing, and the one sentence this platform gives them about the
 * trustworthiness of their own report is the sentence that was false.
 *
 * So it is composed from the dispositions actually present. A payload
 * that only marks says only that it marked, and the closing sentence
 * changes with it: 「必要时重新识别一次」 is advice about a hole in the
 * data and is not offered where there is no hole.
 */
const buildUnsafeReadingNotice = (unsafe: readonly UnsafeReading[]): string => {
  const has = (disposition: UnsafeReading['disposition'], reason: UnsafeReading['reason']) =>
    unsafe.some((item) => item.disposition === disposition && item.reason === reason);

  const clauses: string[] = [];
  if (has('withheld', 'duplicate_reading')) {
    clauses.push('与同一份报告上另一个项目重复、而报告原件核对不上的数值已经不再显示');
  }
  if (has('withheld', 'contradictory_aliases')) {
    clauses.push('同一个项目出现了两个互相矛盾的数值，已经不再显示');
  }
  if (has('flagged', 'duplicate_reading')) {
    clauses.push('与同一份报告上另一个项目完全相同、但无法用报告原件核对的数值已标注');
  }
  if (has('flagged', 'outside_reference_interval')) {
    clauses.push('超出报告自己印的参考区间的数值已标注');
  }

  const withheldAnything = unsafe.some((item) => item.disposition === 'withheld');
  const head = withheldAnything ? '这份报告里有数值没有通过核对：' : '这份报告里有数值需要你留意：';
  const tail = withheldAnything
    ? '。请以报告原件为准，必要时重新识别一次。'
    : '。这些数值仍按报告原样显示，请以报告原件为准。';
  return head + clauses.join('；') + tail;
};

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
  const readings = new Map<string, { keys: string[]; values: Set<number>; unit: string | null }>();
  if (fields) {
    for (const [key, raw] of Object.entries(fields)) {
      const analyte = resolveLabAnalyte(key);
      if (!analyte) continue;
      const value = readNumericReading(raw);
      if (value === null) continue;
      const unit = readReadingUnit(raw);
      const existing = readings.get(analyte);
      if (existing) {
        existing.keys.push(key);
        existing.values.add(value);
        existing.unit ??= unit;
        continue;
      }
      readings.set(analyte, { keys: [key], values: new Set([value]), unit });
    }
  }

  const byValue = new Map<number, string[]>();
  for (const [analyte, reading] of readings) {
    if (reading.values.size !== 1) continue;
    const [value] = reading.values;
    byValue.set(value, [...(byValue.get(value) ?? []), analyte]);
  }

  const references = readReferenceLimits(record);
  const limitsOf = (analyte: string) => asRecord(references?.[analyte]);
  const lowOf = (analyte: string) => readLimit(limitsOf(analyte), ['low', 'reference_low']);
  const highOf = (analyte: string) => readLimit(limitsOf(analyte), ['high', 'reference_high']);
  const intervalOf = (analyte: string) => {
    const low = lowOf(analyte);
    const high = highOf(analyte);
    // No interval archived is not an interval two rows can be said to
    // SHARE. Returning a placeholder here would make every pair on the
    // 120 archived payloads that predate the reference column look like
    // one row read twice.
    if (low === null && high === null) return null;
    return `${low ?? ''}|${high ?? ''}`;
  };
  const unitOf = (analyte: string) => readings.get(analyte)?.unit ?? null;

  // Read once, not once per group: it walks the whole OCR page.
  const pageFigures = readPageFigureCounts(record);

  // One verdict per FIGURE, so both sides of a collision are given the
  // same answer. Asking per analyte would let the two halves of one
  // group disagree the moment a signal is asymmetric.
  const duplicateVerdicts = new Map<number, DuplicateVerdict>();
  for (const [value, analytes] of byValue) {
    if (analytes.length < 2) continue;
    duplicateVerdicts.set(
      value,
      corroborateDuplicateGroup({ analytes, value, pageFigures, unitOf, intervalOf }),
    );
  }

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
    const verdict = shared.length ? duplicateVerdicts.get(value) : undefined;
    if (verdict && verdict.verdict === 'slipped') {
      unsafe.push({
        analyte,
        keys: [...reading.keys],
        disposition: 'withheld',
        reason: 'duplicate_reading',
        sharedWith: shared,
        corroboration: verdict.corroboration,
      });
      continue;
    }
    if (verdict && verdict.verdict === 'unknown') {
      // Marked and still printed. The reader is told the two rows agree
      // and that the page could not settle it; the number stays, because
      // a coincidence is the likelier of the two and a blank cell is not
      // a safer answer than a marked one.
      unsafe.push({
        analyte,
        keys: [...reading.keys],
        disposition: 'flagged',
        reason: 'duplicate_reading',
        sharedWith: shared,
      });
      continue;
    }
    const low = lowOf(analyte);
    const high = highOf(analyte);
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
    /**
     * THE WHOLE READING GOES, NOT JUST ITS NUMBER.
     *
     * This deleted the value spellings and left `ckFlag` / `ckReference`
     * standing beside the hole, because `resolveLabAnalyte` does not
     * recognise a sibling key as an analyte — and it must not, or the
     * guard would start reading 「high」 as a reading. So a payload whose
     * LDH was withheld for being a row index went out carrying
     * `ldhFlag: high` and `ldhReference: 120-250`: the laboratory's
     * verdict on a number this file had just decided the payload does
     * not know. The passport resolves an analyte's marker off the
     * spelling list rather than off one key (`pickLabReading`), so an
     * orphaned sibling is not inert — it is a bracket looking for
     * somewhere to print.
     *
     * DERIVED FROM THE KEYS RATHER THAN LISTED. `UnsafeReading.keys`
     * already carries every `fields` spelling that held the cell; the
     * siblings are a pure function of a spelling, and the bridge writes
     * them under the CAMEL form only (allowlist.ts states that rule).
     * Both forms are cleared anyway, so a payload written by some older
     * shape of the bridge, or hand-patched, cannot keep one.
     */
    const withheldKeys = new Set(
      unsafe
        .filter((item) => item.disposition === 'withheld')
        .flatMap((item) => item.keys)
        .flatMap((key) => {
          const camel = flattenToCamelKey(key);
          return [key, flagKey(key), referenceKey(key), flagKey(camel), referenceKey(camel)];
        }),
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
    next.unsafeReadingsNotice = buildUnsafeReadingNotice(unsafe);
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
          logDate: toRequiredDateString(row.log_date),
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

    /**
     * ══════════════════════════════════════════════════════════════════
     * A YEAR AND A DATE IN ONE COLUMN, WITHOUT THE YEAR EATING THE DATE.
     * ══════════════════════════════════════════════════════════════════
     *
     * There are two stores and they hold different things.
     * `foundation.diagnosisYear` is the questionnaire's only
     * diagnosis-time control — four digits, labelled 确诊年份 — and it
     * lives in `baseline_payload`, which is where it stays.
     * `patient_profiles.diagnosis_date` is a `date`: it can hold a day,
     * and for the profiles that have one the day came from somewhere
     * that knew it — the patient's own profile endpoint, the back
     * office, or `applyGeneticReportAutofill` copying a 诊断日期 the
     * laboratory printed.
     *
     * THE WRITE THIS REPLACES DESTROYED THE SECOND WITH THE FIRST. It
     * mirrored the year in as `${year}-01-01` unconditionally, so a
     * profile whose column held 2019-05-03 came out of the next
     * questionnaire save holding 2019-01-01 — and the year the patient
     * had typed was 2019, the same year, which is to say the save
     * carried no new information about the diagnosis time at all. It
     * did not even need the patient to touch the field:
     * `applyGeneticReportAutofill` fills an empty 确诊年份 box FROM this
     * column at read time, so the form hands the year straight back on
     * the next submit and the day dies to a save about something else.
     *
     * Nobody saw it because every renderer reduces a year-start the
     * evidence report does not corroborate back to a bare year before
     * printing (profile.passport.ts, and both machine exports emit the
     * year by construction). That is a display rule. The column is the
     * stored fact underneath it, the exports read the column, and 5月3日
     * is not recoverable from 1月1日.
     *
     * SO THE RULE IS: the year may REFINE the column, never coarsen it.
     *
     *   · Column already inside that year → LEAVE IT. 2019-05-03 under
     *     a saved 2019 is the same fact said precisely; the save agrees
     *     with the column and has nothing to add to it.
     *   · Column in a DIFFERENT year → the patient is correcting the
     *     year, and a day in the year they just rejected is not a day
     *     in the new one. `${year}-01-01` goes in, which is all a
     *     `date` column can be given, and the renderers reduce it.
     *   · Column empty → `${year}-01-01` as before. Same reduction.
     *   · Year explicitly null → the column is cleared. That is the
     *     erase the four `sets*` flags above exist to carry, and it is
     *     the patient asking for it rather than a side effect.
     *   · Key absent → untouched, as for the other three columns.
     *
     * Deciding this in SQL rather than by reading the column first is
     * not an optimisation: a read-then-write would let a concurrent
     * profile update land between the two and be overwritten by a
     * decision made about the value it replaced.
     *
     * ROWS ALREADY FLATTENED STAY FLATTENED, AND CANNOT BE REPAIRED.
     * The old day was overwritten in place and no copy of it was kept
     * anywhere — `baseline_payload` only ever stored the year, and the
     * questionnaire never had a control that could hold a day. A
     * migration would have nothing to read. Nor can such a row be
     * IDENTIFIED: a genuine 1 January diagnosis is byte-identical to a
     * flattened one. This fix is therefore forward-only — it stops the
     * next save from destroying a day, and every day already destroyed
     * before it is gone. What limits the damage is that those rows
     * already print as a bare year everywhere a human reads them, so
     * no reader is being shown a false day today; they are being shown
     * a year, which is now also all the column claims to know.
     *
     * ══════════════════════════════════════════════════════════════════
     * AND THE SAME STATEMENT USED TO DO IT AGAIN, ONE LINE LOWER, TO
     * THE CITY.
     * ══════════════════════════════════════════════════════════════════
     *
     * `region_city = CASE WHEN $8 THEN NULLIF($9,'') ELSE region_city
     * END` mirrored `foundation.regionLabel` into the city column. That
     * write is gone, and this is why.
     *
     * THE TWO STORES HOLD DIFFERENT THINGS, exactly as above.
     * `region_province` / `region_city` / `region_district` are three
     * separate answers off a CLOSED-LIST picker (`RegionPickers`, over
     * `CHINA_REGIONS` in apps/mobile/lib/demographics-options.ts),
     * written by `createProfile` / `updateProfile`.
     * `foundation.regionLabel` is the questionnaire's single free-text
     * 所在地区 box — 「省 / 市 / 区县」 in one string, at whatever
     * granularity whoever typed it felt like: 「上海市 浦东新区」,
     * 「广东 深圳」, 「四川 成都」.
     *
     * SO THE MIRROR HAD NO TRUE FORM. Unlike 确诊年份, which is the same
     * fact as `diagnosis_date` said less precisely, a whole-region label
     * is not a coarser city — it is a DIFFERENT field, and there is no
     * rule under which 「上海市 浦东新区」 is a better `region_city` than
     * 「成都市」. It could not refine the column, so it could only
     * destroy it.
     *
     * AND IT DID, ON THE ORDINARY PATH, EVERY TIME. The patient's own
     * profile screen (apps/mobile/screens/p-register_profile/index.tsx)
     * saves twice in one tap: `upsertPatientProfile` writes the three
     * picker columns correctly, and then `updateMyBaseline` posts
     * `regionLabel: buildRegionLabel({province, city, district})` — the
     * three joined by spaces — and landed here milliseconds later to
     * overwrite `region_city` with the join. A patient who picked
     * 四川省 / 成都市 / 武侯区 ended the save with:
     *
     *     region_province  四川省
     *     region_city      四川省 成都市 武侯区   ← was 成都市
     *     region_district  武侯区
     *
     * The back office did the same thing with an arbitrary string: an
     * operator transcribing a phone intake types 所在地区「上海市
     * 浦东新区」 and `region_city` came out holding a province and a
     * district while `region_province` still said 四川省.
     *
     * IT ALSO FED ITSELF. On the next load the form fills the CITY
     * picker from `profile.regionCity`, which is now a string no option
     * in `CHINA_REGIONS` matches, so the picker shows nothing selected
     * — and the next `upsertPatientProfile` writes that same corrupted
     * string straight back into `region_city` through `updateProfile`.
     * The corruption became self-sustaining and the real city was gone
     * with no copy anywhere.
     *
     * WHY NOTHING NEEDS THE MIRROR. The label's authoritative home is
     * `baseline_payload.foundation.regionLabel`, which the `$1` write
     * at the top of this same statement stores, and every reader that
     * wants the LABEL either reads it there already or prefers it:
     * the full-cohort CSV has its own `baseline_region_label` column
     * off the payload (admin.csv.ts), 病程管理 reads
     * `foundation?.regionLabel ?? profile.regionCity`, and 我的档案
     * reads `baseline?.foundation?.regionLabel` first and only falls
     * back to joining the three columns.
     *
     * THE ONE READER THAT STILL GOES THROUGH THE COLUMN is
     * `AdminService.getStoredProfile`, which maps `region_city` to
     * `AdminStoredProfile.regionLabel` and renders it as the back
     * office record header's 所在地区. That is not this module's file
     * and is not changed here. Its own query already selects
     * `baseline_payload` beside `region_city`, so the fix there is to
     * read `foundation.regionLabel` out of the payload — the same place
     * the editable 所在地区 field two blocks down that screen already
     * reads. Until it does, that ONE header line shows the patient's
     * picked city (or 未填 for a patient who only ever had a
     * transcribed label) while the authoritative, editable value sits
     * correct on the same screen. That is a stale duplicate label; what
     * it replaces was the permanent destruction of a patient's own
     * answer on every save, and those are not the same size of wrong.
     */
    await this.pool.query(
      `UPDATE patient_profiles
       SET baseline_payload = $1,
           full_name = CASE WHEN $2::boolean THEN $3::text ELSE full_name END,
           preferred_name = CASE WHEN $4::boolean THEN $5::text ELSE preferred_name END,
           -- 确诊年份 IS A COARSER STATEMENT OF THE COLUMN, NOT A REPLACEMENT
           -- FOR IT. See the block above the statement.
           diagnosis_date = CASE
             WHEN NOT $6::boolean THEN diagnosis_date
             WHEN $7::date IS NULL THEN NULL
             WHEN diagnosis_date IS NOT NULL
                  AND date_part('year', diagnosis_date) = date_part('year', $7::date)
               THEN diagnosis_date
             ELSE $7::date
           END,
           -- region_city IS NOT WRITTEN HERE. 所在地区 is a whole-region
           -- free-text label and this column means a city off a closed
           -- list; the label lives in 「baseline_payload」 ($1) and
           -- nowhere else. See the block above the statement.
           updated_at = NOW()
       WHERE id = $8`,
      [
        payload,
        setsFullName,
        foundation.fullName ?? null,
        setsPreferredName,
        foundation.preferredName ?? null,
        setsDiagnosisYear,
        diagnosisYear,
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
      logDate: toRequiredDateString(row.log_date),
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
    // THE CORRECTION SCREEN IS WHERE THE WITHHELD READINGS CAME BACK.
    //
    // This returned `ocr_payload` exactly as it was just written, and
    // the mobile client renders the returned payload — so PATCH
    // …/documents/:id/ocr republished every cell the guard deletes, on
    // the one screen a patient opens PRECISELY BECAUSE the report looks
    // wrong. GET on this same path has gone through the guard since it
    // was built; the PATCH beside it had not, and a door is a door
    // whichever verb opens it.
    //
    // The hand-corrected cells are not the ones at risk — zod admits
    // only reportName / reportTime / diagnosisType / d4z4Repeats /
    // haplotype / methylationValue, none of them laboratory analytes.
    // What came back was the REST of the stored payload, carried along
    // for the ride: a patient fixing their report's date was handed the
    // collapsed CK column again in the same response.
    const patched = updated.rows[0];
    return { ...patched, ocr_payload: withholdUnsafeReadings(patched.ocr_payload ?? null) };
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

    // No measurements is not a middling reading — it is no reading. See
    // `RiskLevel`.
    const strengthLevel: RiskSummary['strengthLevel'] =
      avgStrength === null
        ? 'unknown'
        : avgStrength < 3
          ? 'high'
          : avgStrength < 4
            ? 'medium'
            : 'low';

    /**
     * `log_date` is a `date` column, so the DAY is the whole of what is
     * stored and `toRequiredDateString` is how it is read back. What
     * this axis grades is how long ago that day was, and 「no log at
     * all」 has no such distance: the branch below used to answer it
     * `high`, putting a patient who registered this morning in the same
     * band as one whose last log is a fortnight old.
     *
     * `daysSince` is computed from the same local Y/M/D — via
     * `startOfLocalDay` on both sides — rather than from an instant, so
     * the boundary between 7 and 8 days falls where a calendar puts it
     * and not where the server's clock happens to be inside a day.
     */
    const lastActivityDay = activityResult.rows[0]?.log_date
      ? toRequiredDateString(activityResult.rows[0].log_date)
      : null;

    let activityLevel: RiskSummary['activityLevel'] = 'unknown';
    if (lastActivityDay) {
      const daysSince = Math.floor(
        (startOfLocalDay(new Date()).getTime() - startOfLocalDay(lastActivityDay).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      activityLevel = daysSince > 14 ? 'high' : daysSince > 7 ? 'medium' : 'low';
    }

    /**
     * The overall band is the worst of the axes THAT HAVE A READING.
     *
     * An `unknown` axis contributes nothing rather than a rank, so a
     * patient with weak measurements and no activity log still surfaces
     * as `high` — that is a real observation and it must not be
     * softened — while a patient with neither comes out `unknown`, and
     * the chip goes grey 「暂无评估」 instead of red 高关注. A summary
     * built out of nothing is a summary of nothing.
     */
    const levelRank = { low: 1, medium: 2, high: 3 } as const;
    const gradedAxes = [strengthLevel, activityLevel].filter(
      (level): level is Exclude<RiskLevel, 'unknown'> => level !== 'unknown',
    );
    const overallLevel: RiskSummary['overallLevel'] = gradedAxes.length
      ? gradedAxes.reduce((worst, level) => (levelRank[level] > levelRank[worst] ? level : worst))
      : 'unknown';

    const notes: string[] = [];
    if (avgStrength !== null) {
      notes.push(`最近平均肌力分数：${avgStrength.toFixed(1)}`);
    } else {
      // 「暂无」/「近期没有」 both read as a judgement about a recent
      // stretch of time — as though the platform had looked at the last
      // few weeks and found them empty. It has not looked at anything:
      // there is no record here at all, which is a fact about this
      // platform's files and not about the patient's health or habits.
      // Same sentence shape as the surveillance rows' 「本平台没有你的
      // 疼痛记录」.
      notes.push('本平台还没有你的肌力评估记录');
    }

    if (lastActivityDay) {
      notes.push(`最近活动记录：${lastActivityDay}`);
    } else {
      notes.push('本平台还没有你的活动记录');
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
      // The day, not a manufactured instant: this used to emit
      // `2026-08-18T16:00:00.000Z` for a log the patient dated
      // 2026-08-19, which is a time of day the column has never held
      // and, read as a date, the wrong day.
      lastActivityAt: lastActivityDay,
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
        logDate: toRequiredDateString(row.log_date),
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

  /* ==================================================================
   * PIPL 可携带权 — the record categories PatientProfileDTO does NOT
   * carry.
   * ==================================================================
   *
   * `getProfileByUserId` loads eight patient_* tables into one DTO, and
   * for a while that set really was 「everything the platform stores
   * about the caller」. Two features shipped afterwards and did not
   * join it, both because they were deliberately built OUTSIDE this
   * class: the falls diary (its write is a two-row transaction, see
   * falls.service.ts) and the instrument engine (its rows are
   * immutable, see instruments.service.ts). Neither appears in
   * `PatientProfileDTO`, so `GET /me/data-export` — whose docstring
   * claimed to hold everything, and whose button the privacy screen
   * describes as 「把全部档案、记录、报告清单与授权历史下载成一个文件」
   * — handed patients a file with every fall they recorded and every
   * scale this product administered to them missing, and nothing in
   * the file saying so.
   *
   * A patient reading that file sees 病程时间线 entries of type `fall`
   * (the diary's twin event IS in `profile.followupEvents`) with none
   * of what they answered about them, and no Brooke or Vignos grade at
   * all. Both readings are wrong in the direction that matters: the
   * record looks thinner than it is.
   *
   * The readers below exist so the export can carry those categories
   * without merging either engine's write invariants into this class.
   * They are EXPORT-shaped, not screen-shaped: no window, superseded
   * rows included, and an explicit row cap the caller reports as a
   * truncation flag rather than a short list presented as a whole one.
   * Every bound is passed IN, so all of the export's limits stay
   * legible in one place — profile.controller.ts.
   */

  /** Lazily composed, not constructed in `constructor`, so an account
   *  that never exports never builds them. Both take the same pool and
   *  logger this service already holds. */
  private instrumentsForExport: InstrumentsService | null = null;
  private passportSharesForExport: PassportShareService | null = null;

  private instrumentsReader(): InstrumentsService {
    this.instrumentsForExport ??= new InstrumentsService({
      pool: this.pool,
      logger: this.logger,
    });
    return this.instrumentsForExport;
  }

  private passportSharesReader(): PassportShareService {
    this.passportSharesForExport ??= new PassportShareService(this.pool, this.logger);
    return this.passportSharesForExport;
  }

  /**
   * Every live diary entry the patient ever wrote, oldest fall
   * included — see EXPORT_FALLS_WINDOW_DAYS for why this read has no
   * window when every other reader of the table does.
   *
   * `FALL_DIARY_SQL` is imported rather than re-written: it carries the
   * retraction rule (a diary row whose timeline twin was deleted is
   * NOT live), and a second copy of that predicate is how the export
   * would come to hand back falls the patient believes they retracted.
   *
   * Reads `maxRows + 1` so 「there are more」 is observed rather than
   * inferred from a full page.
   */
  async listFallDiaryForExport(
    userId: string,
    maxRows: number,
  ): Promise<{ falls: FallDTO[]; truncated: boolean }> {
    const result = await this.pool.query<FallDiaryRow>(`${FALL_DIARY_SQL}\n       LIMIT $3`, [
      userId,
      String(EXPORT_FALLS_WINDOW_DAYS),
      maxRows + 1,
    ]);
    const rows = result.rows ?? [];
    return {
      falls: rows.slice(0, maxRows).map(toExportFallDTO),
      truncated: rows.length > maxRows,
    };
  }

  /**
   * Every instrument administration, item responses attached.
   *
   * `includeSuperseded: true`, which is the opposite of what a trend
   * line wants and the only correct choice here. A completed
   * administration is immutable (migration 022) and a correction is a
   * NEW row naming the one it replaces; exporting only the survivors
   * would hand the patient a history with their own corrections
   * silently deleted — and `supersedesId` / `supersededById` travel
   * with each row, so a reader can still draw the live series.
   */
  async listInstrumentAdministrationsForExport(
    userId: string,
    maxRows: number,
  ): Promise<{ administrations: AdministrationDTO[]; truncated: boolean }> {
    const reader = this.instrumentsReader();
    const administrations: AdministrationDTO[] = [];
    let truncated = false;

    for (let offset = 0; offset < maxRows; offset += EXPORT_INSTRUMENT_PAGE_SIZE) {
      const pageSize = Math.min(EXPORT_INSTRUMENT_PAGE_SIZE, maxRows - offset);
      const page = await reader.listAdministrations(userId, {
        limit: pageSize,
        offset,
        includeSuperseded: true,
      });
      administrations.push(...page);
      if (page.length < pageSize) break;
      if (offset + pageSize >= maxRows) truncated = true;
    }

    return { administrations, truncated };
  }

  /**
   * 协议签署记录: which version of which document this account accepted,
   * and when it was withdrawn.
   *
   * Queried here rather than through legal.service.ts because both of
   * that module's readers answer a different question — 「is this
   * consent in force right now」 — and are `DISTINCT ON (document)` with
   * `withdrawn_at IS NULL`. Its own comment says the full history 「is
   * not exposed over HTTP, because nothing needs it yet」. The
   * portability export needs it: an authorisation the patient took
   * back is part of what they authorised, and the newest row per
   * document is not a history.
   */
  async listLegalAcceptancesForExport(
    userId: string,
  ): Promise<{ acceptances: LegalAcceptanceExportDTO[]; truncated: boolean }> {
    const result = await this.pool.query<{
      document: string;
      version: string;
      accepted_at: Date | string;
      withdrawn_at: Date | string | null;
    }>(
      `SELECT document, version, accepted_at, withdrawn_at
         FROM legal_document_acceptances
        WHERE user_id = $1
        ORDER BY accepted_at DESC
        LIMIT $2`,
      [userId, EXPORT_MAX_LEGAL_ACCEPTANCE_ROWS + 1],
    );
    const rows = result.rows ?? [];
    return {
      acceptances: rows.slice(0, EXPORT_MAX_LEGAL_ACCEPTANCE_ROWS).map((row) => ({
        document: row.document,
        version: row.version,
        acceptedAt: new Date(row.accepted_at).toISOString(),
        withdrawnAt: row.withdrawn_at === null ? null : new Date(row.withdrawn_at).toISOString(),
      })),
      truncated: rows.length > EXPORT_MAX_LEGAL_ACCEPTANCE_ROWS,
    };
  }

  /**
   * 谁能看我的临床护照: every share link and pickup code this account
   * ever minted, revoked and expired ones included, with no token or
   * code digest in any of them (`PassportShareService.list` projects
   * neither).
   *
   * Reuses that method rather than re-querying, because it is the one
   * definition of 「every door into this record」 — it LEFT JOINs the
   * pickup codes so a code read aloud in a clinic is a row in the same
   * list as a link forwarded in WeChat.
   */
  async listPassportSharesForExport(
    userId: string,
  ): Promise<{ shares: PassportShareLink[]; truncated: boolean }> {
    const shares = await this.passportSharesReader().list(userId);
    return { shares, truncated: shares.length >= PASSPORT_SHARE_LIST_LIMIT };
  }
}
