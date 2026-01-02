import type { Pool, PoolClient } from 'pg';
import type {
  ActivityLogInput,
  CreateProfileInput,
  DocumentInput,
  FunctionTestInput,
  MeasurementInput,
  MedicationInput,
  UpdateProfileInput,
} from './profile.schema';
import type { AppLogger } from '../../config/logger';
import { AppError } from '../../utils/app-error';

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
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PatientMeasurementDTO {
  id: string;
  muscleGroup: string;
  strengthScore: number;
  method: string | null;
  notes: string | null;
  recordedAt: string;
  createdAt: string;
}

export interface PatientFunctionTestDTO {
  id: string;
  testType: string;
  measuredValue: number | null;
  unit: string | null;
  notes: string | null;
  performedAt: string;
  createdAt: string;
}

export interface PatientActivityLogDTO {
  id: string;
  logDate: string;
  source: string;
  content: string | null;
  moodScore: number | null;
  createdAt: string;
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
  notes: string | null;
  measurements: PatientMeasurementDTO[];
  functionTests: PatientFunctionTestDTO[];
  activityLogs: PatientActivityLogDTO[];
  documents: PatientDocumentDTO[];
  medications: PatientMedicationDTO[];
  createdAt: string;
  updatedAt: string;
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
        activityLogsResult,
        documentsResult,
        medicationsResult,
      ] = await Promise.all([
        client.query(
          `SELECT id, profile_id, recorded_at, muscle_group, strength_score, method, notes, created_at
           FROM patient_measurements
           WHERE profile_id = $1
           ORDER BY recorded_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, test_type, measured_value, unit, notes, performed_at, created_at
           FROM patient_function_tests
           WHERE profile_id = $1
           ORDER BY performed_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, log_date, source, content, mood_score, created_at
           FROM patient_activity_logs
           WHERE profile_id = $1
           ORDER BY log_date DESC, created_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, document_type, title, file_name, mime_type, file_size_bytes, storage_uri, status, uploaded_at, checksum, ocr_payload
           FROM patient_documents
           WHERE profile_id = $1
           ORDER BY uploaded_at DESC`,
          [profileId],
        ),
        client.query(
          `SELECT id, profile_id, medication_name, dosage, frequency, route, start_date, end_date, notes, status, created_at
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
        notes: profile.notes,
        measurements: measurementsResult.rows.map((row) => ({
          id: row.id,
          muscleGroup: row.muscle_group,
          strengthScore: Number(row.strength_score),
          method: row.method,
          notes: row.notes,
          recordedAt: toTimestampString(row.recorded_at),
          createdAt: toTimestampString(row.created_at),
        })),
        functionTests: functionTestsResult.rows.map((row) => ({
          id: row.id,
          testType: row.test_type,
          measuredValue: row.measured_value ? Number(row.measured_value) : null,
          unit: row.unit,
          notes: row.notes,
          performedAt: toTimestampString(row.performed_at),
          createdAt: toTimestampString(row.created_at),
        })),
        activityLogs: activityLogsResult.rows.map((row) => ({
          id: row.id,
          logDate: row.log_date.toISOString?.() ?? row.log_date,
          source: row.source,
          content: row.content,
          moodScore: row.mood_score === null ? null : Number(row.mood_score),
          createdAt: toTimestampString(row.created_at),
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
        })),
        createdAt: toTimestampString(profile.created_at),
        updatedAt: toTimestampString(profile.updated_at),
      };
    } finally {
      client.release();
    }
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
        muscle_group,
        strength_score,
        method,
        notes,
        recorded_at
      )
      VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
      RETURNING id, muscle_group, strength_score, method, notes, recorded_at, created_at`,
      [
        profileId,
        payload.muscleGroup,
        payload.strengthScore,
        payload.method ?? null,
        payload.notes ?? null,
        payload.recordedAt ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      id: row.id,
      muscleGroup: row.muscle_group,
      strengthScore: Number(row.strength_score),
      method: row.method,
      notes: row.notes,
      recordedAt: toTimestampString(row.recorded_at),
      createdAt: toTimestampString(row.created_at),
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
        test_type,
        measured_value,
        unit,
        notes,
        performed_at
      )
      VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
      RETURNING id, test_type, measured_value, unit, notes, performed_at, created_at`,
      [
        profileId,
        payload.testType,
        payload.measuredValue ?? null,
        payload.unit ?? null,
        payload.notes ?? null,
        payload.performedAt ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      id: row.id,
      testType: row.test_type,
      measuredValue: row.measured_value ? Number(row.measured_value) : null,
      unit: row.unit,
      notes: row.notes,
      performedAt: toTimestampString(row.performed_at),
      createdAt: toTimestampString(row.created_at),
    };
  }

  async addActivityLog(userId: string, payload: ActivityLogInput): Promise<PatientActivityLogDTO> {
    const profileId = await this.ensureProfileForUser(userId);

    const result = await this.pool.query(
      `INSERT INTO patient_activity_logs (
        profile_id,
        log_date,
        source,
        content,
        mood_score
      )
      VALUES (
        $1,
        COALESCE($2::date, CURRENT_DATE),
        $3,
        $4,
        $5
      )
      RETURNING id, log_date, source, content, mood_score, created_at`,
      [
        profileId,
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
    };
  }

  async addDocument(userId: string, payload: DocumentInput): Promise<PatientDocumentDTO> {
    const profileId = await this.ensureProfileForUser(userId);

    const result = await this.pool.query(
      `INSERT INTO patient_documents (
        profile_id,
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
        $1, $2, $3, $4, $5, $6, $7,
        COALESCE($8, 'uploaded'),
        COALESCE($9::timestamptz, NOW()),
        $10,
        $11
      )
      RETURNING id, document_type, title, file_name, mime_type, file_size_bytes, storage_uri, status, uploaded_at, checksum, ocr_payload`,
      [
        profileId,
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
    };
  }

  async addUploadedDocument(input: {
    userId: string;
    documentType: string;
    title?: string | null;
    storageUri: string;
    fileName: string | null;
    mimeType: string | null;
    fileSizeBytes: number | null;
    ocrPayload: unknown | null;
  }): Promise<PatientDocumentDTO> {
    const profileId = await this.ensureProfileForUser(input.userId);

    const result = await this.pool.query(
      `INSERT INTO patient_documents (
        profile_id,
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
        $1, $2, $3, $4, $5, $6, $7, 'uploaded', NOW(), $8
      )
      RETURNING id, document_type, title, file_name, mime_type, file_size_bytes, storage_uri, status, uploaded_at, checksum, ocr_payload`,
      [
        profileId,
        input.documentType,
        input.title ?? null,
        input.fileName ?? null,
        input.mimeType ?? null,
        input.fileSizeBytes ?? null,
        input.storageUri,
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
    };
  }

  async getDocumentForUser(userId: string, documentId: string) {
    const result = await this.pool.query(
      `SELECT d.id, d.storage_uri, d.file_name, d.mime_type, d.ocr_payload
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
      storage_uri: string;
      file_name: string | null;
      mime_type: string | null;
      ocr_payload: unknown | null;
    };
  }

  async addMedication(userId: string, payload: MedicationInput): Promise<PatientMedicationDTO> {
    const profileId = await this.ensureProfileForUser(userId);

    const result = await this.pool.query(
      `INSERT INTO patient_medications (
        profile_id,
        medication_name,
        dosage,
        frequency,
        route,
        start_date,
        end_date,
        notes,
        status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'active')
      )
      RETURNING id, medication_name, dosage, frequency, route, start_date, end_date, notes, status, created_at`,
      [
        profileId,
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
    };
  }

  async getMedications(userId: string): Promise<PatientMedicationDTO[]> {
    const profileId = await this.ensureProfileForUser(userId);
    const result = await this.pool.query(
      `SELECT id, medication_name, dosage, frequency, route, start_date, end_date, notes, status, created_at
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
          strengthScore: Number(latestMeasurementRow.strength_score),
          method: null,
          notes: null,
          recordedAt: toTimestampString(latestMeasurementRow.recorded_at),
          createdAt: toTimestampString(latestMeasurementRow.recorded_at),
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
