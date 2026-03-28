import { z } from 'zod';
import {
  ACTIVITY_SOURCES,
  BODY_REGIONS,
  DAILY_IMPACT_KEYS,
  DOCUMENT_TYPES,
  FOLLOWUP_EVENT_SEVERITIES,
  FOLLOWUP_EVENT_TYPES,
  FUNCTION_TEST_TYPES,
  GENDER_OPTIONS,
  MEASUREMENT_ENTRY_MODES,
  MEASUREMENT_SIDES,
  MEDICATION_STATUS,
  MUSCLE_GROUPS,
  SUBMISSION_KINDS,
  SYMPTOM_KEYS,
} from './profile.constants.js';

const isoDateString = z
  .string()
  .trim()
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), 'Invalid date format');

const difficultyScoreSchema = z.coerce.number().int().min(0).max(5);

const nullableText = (max: number) => z.string().trim().max(max).optional().nullable();

export const baseProfileSchema = z.object({
  fullName: z.string().min(1).max(120).optional().nullable(),
  preferredName: z.string().min(1).max(120).optional().nullable(),
  dateOfBirth: isoDateString.optional().nullable(),
  gender: z.enum(GENDER_OPTIONS).optional().nullable(),
  patientCode: z.string().max(120).optional().nullable(),
  diagnosisStage: z.string().max(120).optional().nullable(),
  diagnosisDate: isoDateString.optional().nullable(),
  geneticMutation: z.string().max(255).optional().nullable(),
  heightCm: z.coerce.number().min(0).max(300).optional().nullable(),
  weightKg: z.coerce.number().min(0).max(400).optional().nullable(),
  bloodType: z.string().max(10).optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  primaryPhysician: z.string().max(120).optional().nullable(),
  regionProvince: z.string().max(120).optional().nullable(),
  regionCity: z.string().max(120).optional().nullable(),
  regionDistrict: z.string().max(120).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const createProfileSchema = baseProfileSchema;
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = baseProfileSchema.partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const baselineProfileSchema = z.object({
  foundation: z
    .object({
      fullName: nullableText(120),
      preferredName: nullableText(120),
      birthYear: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
      ageBand: nullableText(80),
      regionLabel: nullableText(120),
      diagnosisYear: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
    })
    .partial()
    .optional(),
  diseaseBackground: z
    .object({
      diagnosedFshd: z.boolean().optional().nullable(),
      diagnosisType: nullableText(40),
      d4z4: nullableText(80),
      haplotype: nullableText(40),
      methylation: nullableText(80),
      familyHistory: nullableText(255),
      onsetRegion: nullableText(120),
    })
    .partial()
    .optional(),
  currentStatus: z
    .object({
      independentlyAmbulatory: z.boolean().optional().nullable(),
      armRaiseDifficulty: z.boolean().optional().nullable(),
      facialWeakness: z.boolean().optional().nullable(),
      footDrop: z.boolean().optional().nullable(),
      breathingSymptoms: z.boolean().optional().nullable(),
      assistiveDevices: z.array(z.string().trim().max(80)).max(12).optional(),
    })
    .partial()
    .optional(),
  currentChallenges: z
    .object({
      fatigue: difficultyScoreSchema.optional().nullable(),
      pain: difficultyScoreSchema.optional().nullable(),
      stairs: difficultyScoreSchema.optional().nullable(),
      dressing: difficultyScoreSchema.optional().nullable(),
      reachingUp: difficultyScoreSchema.optional().nullable(),
      walkingStability: difficultyScoreSchema.optional().nullable(),
    })
    .partial()
    .optional(),
  notes: z.string().max(2000).optional().nullable(),
});
export type BaselineProfileInput = z.infer<typeof baselineProfileSchema>;

export const measurementSchema = z
  .object({
    muscleGroup: z.enum(MUSCLE_GROUPS).optional().nullable(),
    metricKey: z.string().trim().max(120).optional().nullable(),
    bodyRegion: z.enum(BODY_REGIONS).optional().nullable(),
    side: z.enum(MEASUREMENT_SIDES).optional().nullable(),
    strengthScore: z.coerce.number().int().min(0).max(5),
    method: z.string().max(120).optional().nullable(),
    entryMode: z.enum(MEASUREMENT_ENTRY_MODES).optional().nullable(),
    deviceUsed: z.string().max(120).optional().nullable(),
    notes: z.string().optional().nullable(),
    recordedAt: z.string().datetime().optional(),
    submissionId: z.string().uuid().optional().nullable(),
  })
  .refine((value) => Boolean(value.metricKey || value.muscleGroup), {
    message: 'metricKey or muscleGroup is required',
    path: ['metricKey'],
  });
export type MeasurementInput = z.infer<typeof measurementSchema>;

export const functionTestSchema = z.object({
  testType: z.enum(FUNCTION_TEST_TYPES),
  measuredValue: z.coerce.number().optional().nullable(),
  unit: z.string().max(32).optional().nullable(),
  side: z.enum(MEASUREMENT_SIDES).optional().nullable(),
  protocol: z.string().max(120).optional().nullable(),
  deviceUsed: z.string().max(120).optional().nullable(),
  assistanceRequired: z.boolean().optional().nullable(),
  notes: z.string().optional().nullable(),
  performedAt: z.string().datetime().optional(),
  submissionId: z.string().uuid().optional().nullable(),
});
export type FunctionTestInput = z.infer<typeof functionTestSchema>;

export const activityLogSchema = z.object({
  logDate: isoDateString.optional(),
  source: z.enum(ACTIVITY_SOURCES),
  content: z.string().max(2000).optional().nullable(),
  moodScore: z.coerce.number().int().min(1).max(5).optional().nullable(),
  submissionId: z.string().uuid().optional().nullable(),
});
export type ActivityLogInput = z.infer<typeof activityLogSchema>;

export const documentSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  title: z.string().max(255).optional().nullable(),
  fileName: z.string().max(255).optional().nullable(),
  mimeType: z.string().max(120).optional().nullable(),
  fileSizeBytes: z.number().int().nonnegative().optional().nullable(),
  storageUri: z.string().min(1),
  status: z.enum(['uploaded', 'processing', 'failed']).optional(),
  checksum: z.string().max(255).optional().nullable(),
  uploadedAt: z.string().datetime().optional(),
  submissionId: z.string().uuid().optional().nullable(),
});
export type DocumentInput = z.infer<typeof documentSchema>;

export const documentUploadSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  title: z.string().max(255).optional().nullable(),
  submissionId: z.string().uuid().optional().nullable(),
});
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;

export const medicationSchema = z.object({
  medicationName: z.string().min(1).max(255),
  dosage: z.string().max(120).optional().nullable(),
  frequency: z.string().max(120).optional().nullable(),
  route: z.string().max(120).optional().nullable(),
  startDate: isoDateString.optional().nullable(),
  endDate: isoDateString.optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  status: z.enum(MEDICATION_STATUS).optional(),
  submissionId: z.string().uuid().optional().nullable(),
});
export type MedicationInput = z.infer<typeof medicationSchema>;

export const symptomScoreSchema = z.object({
  symptomKey: z.enum(SYMPTOM_KEYS),
  score: z.coerce.number().int().min(0).max(10),
  scaleMin: z.coerce.number().int().min(0).max(10).optional().nullable(),
  scaleMax: z.coerce.number().int().min(0).max(10).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  recordedAt: z.string().datetime().optional(),
  submissionId: z.string().uuid().optional().nullable(),
});
export type SymptomScoreInput = z.infer<typeof symptomScoreSchema>;

export const dailyImpactSchema = z.object({
  adlKey: z.enum(DAILY_IMPACT_KEYS),
  difficultyLevel: difficultyScoreSchema,
  needsAssistance: z.boolean().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  recordedAt: z.string().datetime().optional(),
  submissionId: z.string().uuid().optional().nullable(),
});
export type DailyImpactInput = z.infer<typeof dailyImpactSchema>;

export const followupEventSchema = z.object({
  eventType: z.enum(FOLLOWUP_EVENT_TYPES),
  severity: z.enum(FOLLOWUP_EVENT_SEVERITIES).optional().nullable(),
  occurredAt: isoDateString,
  resolvedAt: isoDateString.optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  linkedDocumentId: z.string().uuid().optional().nullable(),
  submissionId: z.string().uuid().optional().nullable(),
});
export type FollowupEventInput = z.infer<typeof followupEventSchema>;

export const createSubmissionSchema = z.object({
  submissionKind: z.enum(SUBMISSION_KINDS).optional(),
  summary: z.string().max(1000).optional().nullable(),
  changedSinceLast: z.boolean().optional().nullable(),
});
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export const muscleInsightQuerySchema = z.object({
  muscleGroup: z.enum(MUSCLE_GROUPS),
  limit: z.coerce.number().int().min(1).max(24).optional(),
});
export type MuscleInsightQuery = z.infer<typeof muscleInsightQuerySchema>;

export const submissionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});
export type SubmissionListQuery = z.infer<typeof submissionListQuerySchema>;

export const attachDocumentsSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1),
});
export type AttachDocumentsInput = z.infer<typeof attachDocumentsSchema>;
