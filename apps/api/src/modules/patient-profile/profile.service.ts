import type { Pool, PoolClient } from 'pg';
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
  DocumentInput,
  FollowupEventInput,
  FunctionTestInput,
  MeasurementInput,
  MedicationInput,
  SymptomScoreInput,
  UpdateProfileInput,
} from './profile.schema.js';
import type { AppLogger } from '../../config/logger.js';
import { AppError } from '../../utils/app-error.js';

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
        client.query(
          `SELECT id, profile_id, submission_id, test_type, measured_value, side, protocol, unit,
                  device_used, assistance_required, notes, performed_at, created_at
           FROM patient_function_tests
           WHERE profile_id = $1
           ORDER BY performed_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, submission_id, symptom_key, score, scale_min, scale_max, notes,
                  recorded_at, created_at
           FROM patient_symptom_scores
           WHERE profile_id = $1
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
           WHERE profile_id = $1
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
                  file_size_bytes, storage_uri, status, uploaded_at, checksum, ocr_payload
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

      return {
        id: profile.id,
        userId: profile.user_id,
        fullName: profile.full_name,
        preferredName: profile.preferred_name,
        dateOfBirth: toDateString(profile.date_of_birth),
        gender: profile.gender,
        patientCode: profile.patient_code,
        diagnosisStage: profile.diagnosis_stage,
        diagnosisDate: toDateString(profile.diagnosis_date),
        geneticMutation: profile.genetic_mutation,
        heightCm: toNumber(profile.height_cm),
        weightKg: toNumber(profile.weight_kg),
        bloodType: profile.blood_type,
        contactPhone: profile.contact_phone,
        contactEmail: profile.contact_email,
        primaryPhysician: profile.primary_physician,
        regionProvince: profile.region_province,
        regionCity: profile.region_city,
        regionDistrict: profile.region_district,
        baseline: asRecord(profile.baseline_payload),
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
        documents: documentsResult.rows.map((row) => ({
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
          ocrPayload: row.ocr_payload ?? null,
          submissionId: row.submission_id ?? null,
        })),
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

  async getBaselineByUserId(userId: string): Promise<BaselineProfileDTO | null> {
    const profile = await this.getProfileByUserId(userId);
    if (!profile) {
      return null;
    }

    return {
      profileId: profile.id,
      fullName: profile.fullName,
      preferredName: profile.preferredName,
      baseline: profile.baseline,
      updatedAt: profile.updatedAt,
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
      `INSERT INTO patient_profiles (
        user_id,
        full_name,
        preferred_name,
        date_of_birth,
        gender,
        patient_code,
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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      )`,
      [
        userId,
        payload.fullName ?? null,
        payload.preferredName ?? null,
        payload.dateOfBirth ?? null,
        payload.gender ?? null,
        payload.patientCode ?? null,
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

    await this.pool.query(
      `UPDATE patient_profiles
       SET baseline_payload = $1,
           full_name = COALESCE($2, full_name),
           preferred_name = COALESCE($3, preferred_name),
           diagnosis_date = COALESCE($4::date, diagnosis_date),
           region_city = COALESCE(NULLIF($5, ''), region_city),
           updated_at = NOW()
       WHERE id = $6`,
      [
        payload,
        foundation.fullName ?? null,
        foundation.preferredName ?? null,
        diagnosisYear,
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

    const columns: Array<[keyof UpdateProfileInput, string]> = [
      ['fullName', 'full_name'],
      ['preferredName', 'preferred_name'],
      ['dateOfBirth', 'date_of_birth'],
      ['gender', 'gender'],
      ['patientCode', 'patient_code'],
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
        payload.submissionId ?? null,
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
        performed_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW())
      )
      RETURNING id, submission_id, test_type, measured_value, side, protocol, unit,
                device_used, assistance_required, notes, performed_at, created_at`,
      [
        profileId,
        payload.submissionId ?? null,
        payload.testType,
        payload.measuredValue ?? null,
        payload.side ?? null,
        payload.protocol ?? null,
        payload.unit ?? null,
        payload.deviceUsed ?? null,
        payload.assistanceRequired ?? null,
        payload.notes ?? null,
        payload.performedAt ?? null,
      ],
    );

    const row = result.rows[0];

    return {
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
      performedAt: toTimestampString(row.performed_at),
      createdAt: toTimestampString(row.created_at),
      submissionId: row.submission_id ?? null,
    };
  }

  async addActivityLog(userId: string, payload: ActivityLogInput): Promise<PatientActivityLogDTO> {
    const profileId = await this.ensureProfileForUser(userId);

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
        payload.submissionId ?? null,
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

  async addDocument(userId: string, payload: DocumentInput): Promise<PatientDocumentDTO> {
    const profileId = await this.ensureProfileForUser(userId);

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
        checksum,
        ocr_payload
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        COALESCE($9, 'uploaded'),
        COALESCE($10::timestamptz, NOW()),
        $11,
        $12
      )
      RETURNING id, submission_id, document_type, title, file_name, mime_type, file_size_bytes,
                storage_uri, status, uploaded_at, checksum, ocr_payload`,
      [
        profileId,
        payload.submissionId ?? null,
        payload.documentType,
        payload.title ?? null,
        payload.fileName ?? null,
        payload.mimeType ?? null,
        payload.fileSizeBytes ?? null,
        payload.storageUri,
        payload.status ?? null,
        payload.uploadedAt ?? null,
        payload.checksum ?? null,
        null,
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
      ocrPayload: row.ocr_payload ?? null,
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
        input.submissionId ?? null,
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
      ocrPayload: row.ocr_payload ?? null,
      submissionId: row.submission_id ?? null,
    };
  }

  async getDocumentForUser(userId: string, documentId: string) {
    const result = await this.pool.query(
      `SELECT d.id, d.document_type, d.storage_uri, d.file_name, d.mime_type, d.ocr_payload
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
      storage_uri: string;
      file_name: string | null;
      mime_type: string | null;
      ocr_payload: unknown | null;
    };
  }

  async updateDocumentOcrPayloadForUser(
    userId: string,
    documentId: string,
    ocrPayload: unknown,
    nextDocumentType?: string | null,
    nextStatus?: string | null,
  ) {
    const result = await this.pool.query(
      `UPDATE patient_documents d
       SET ocr_payload = $3,
           document_type = COALESCE(NULLIF($4, ''), d.document_type),
           status = COALESCE(NULLIF($5, ''), d.status)
       FROM patient_profiles p
       WHERE d.profile_id = p.id
         AND p.user_id = $1
         AND d.id = $2
       RETURNING d.id, d.ocr_payload`,
      [userId, documentId, ocrPayload, nextDocumentType ?? null, nextStatus ?? null],
    );

    if (!result.rowCount) {
      throw new AppError('Document not found', 404);
    }

    return result.rows[0] as { id: string; ocr_payload: unknown | null };
  }

  async addMedication(userId: string, payload: MedicationInput): Promise<PatientMedicationDTO> {
    const profileId = await this.ensureProfileForUser(userId);

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
        payload.submissionId ?? null,
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
        payload.submissionId ?? null,
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
        payload.submissionId ?? null,
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
        payload.submissionId ?? null,
        payload.eventType,
        payload.severity ?? null,
        payload.occurredAt,
        payload.resolvedAt ?? null,
        payload.description ?? null,
        payload.linkedDocumentId ?? null,
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

    return { updated: updateResult.rowCount ?? 0 };
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
      this.pool.query(
        `SELECT id, submission_id, test_type, measured_value, side, protocol, unit, device_used,
                  assistance_required, notes, performed_at, created_at
           FROM patient_function_tests
           WHERE submission_id = ANY($1::uuid[])
           ORDER BY performed_at ASC`,
        [submissionIds],
      ),
      this.pool.query(
        `SELECT id, submission_id, symptom_key, score, scale_min, scale_max, notes, recorded_at, created_at
           FROM patient_symptom_scores
           WHERE submission_id = ANY($1::uuid[])
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
           WHERE submission_id = ANY($1::uuid[])
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
        ocrPayload: row.ocr_payload ?? null,
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
      recommendedReviewItems.push('先完成基线建档，后续系统才能更准确比较变化。');
    }
    if (!submissions.some((item) => item.submissionKind === 'followup')) {
      recommendedReviewItems.push('补一次快速随访，系统才能回答“和上次相比有没有变化”。');
    }
    if (profile.symptomScores.length === 0) {
      recommendedReviewItems.push('补录疲劳、疼痛和呼吸评分，能更快看出主观变化。');
    }
    const hasRecentFunctionTest = profile.functionTests.some((item) => {
      const days = (Date.now() - new Date(item.performedAt).getTime()) / (1000 * 60 * 60 * 24);
      return !Number.isNaN(days) && days <= 90;
    });
    if (!hasRecentFunctionTest) {
      recommendedReviewItems.push('最近补一次上楼或 10 米步行测试，便于观察功能趋势。');
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
      headline = '已完成基线建档';
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

  async getMuscleInsight(
    userId: string,
    muscleGroup: string,
    limit = 12,
  ): Promise<MuscleInsightResult> {
    const profileId = await this.ensureProfileForUser(userId);

    const [trendResult, distributionResult, latestResult] = await Promise.all([
      this.pool.query(
        `SELECT recorded_at, strength_score
         FROM patient_measurements
         WHERE profile_id = $1 AND muscle_group = $2
         ORDER BY recorded_at ASC`,
        [profileId, muscleGroup],
      ),
      this.pool.query(
        `SELECT
           MIN(strength_score) AS min_score,
           MAX(strength_score) AS max_score,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY strength_score) AS median_score,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY strength_score) AS quartile_25,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY strength_score) AS quartile_75,
           COUNT(*) AS sample_count
         FROM patient_measurements
         WHERE muscle_group = $1`,
        [muscleGroup],
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

    const trend = trendResult.rows
      .map((row) => ({
        recordedAt: toTimestampString(row.recorded_at),
        strengthScore: Number(row.strength_score),
      }))
      .slice(-limit);

    const distributionRow = distributionResult.rows[0];
    const distribution = distributionRow?.sample_count
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
}
