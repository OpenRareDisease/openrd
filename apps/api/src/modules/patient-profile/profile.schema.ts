import { z } from 'zod';
import {
  ACTIVITY_SOURCES,
  DOCUMENT_TYPES,
  FUNCTION_TEST_TYPES,
  GENDER_OPTIONS,
  MUSCLE_GROUPS,
  MEDICATION_STATUS,
} from './profile.constants';

const isoDateString = z
  .string()
  .trim()
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), 'Invalid date format');

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
  notes: z.string().optional().nullable(),
});

export const createProfileSchema = baseProfileSchema;
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = baseProfileSchema.partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const measurementSchema = z.object({
  muscleGroup: z.enum(MUSCLE_GROUPS),
  strengthScore: z.coerce.number().int().min(0).max(5),
  method: z.string().max(120).optional().nullable(),
  notes: z.string().optional().nullable(),
  recordedAt: z.string().datetime().optional(),
});
export type MeasurementInput = z.infer<typeof measurementSchema>;

export const functionTestSchema = z.object({
  testType: z.enum(FUNCTION_TEST_TYPES),
  measuredValue: z.coerce.number().optional().nullable(),
  unit: z.string().max(32).optional().nullable(),
  notes: z.string().optional().nullable(),
  performedAt: z.string().datetime().optional(),
});
export type FunctionTestInput = z.infer<typeof functionTestSchema>;

export const activityLogSchema = z.object({
  logDate: isoDateString.optional(),
  source: z.enum(ACTIVITY_SOURCES),
  content: z.string().max(2000).optional().nullable(),
  moodScore: z.coerce.number().int().min(1).max(5).optional().nullable(),
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
});
export type DocumentInput = z.infer<typeof documentSchema>;

export const documentUploadSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  title: z.string().max(255).optional().nullable(),
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
});
export type MedicationInput = z.infer<typeof medicationSchema>;
