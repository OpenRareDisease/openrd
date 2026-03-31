import type {
  PatientDailyImpact,
  PatientDocument,
  PatientFollowupEvent,
  PatientFunctionTest,
  PatientMeasurement,
  PatientProfile,
  PatientSymptomScore,
} from './api';

export type PatientMeasurementEntry = PatientMeasurement;

export type PatientFunctionTestEntry = PatientFunctionTest;

export type PatientSymptomScoreEntry = PatientSymptomScore;

export type PatientDailyImpactEntry = PatientDailyImpact;

export type PatientFollowupEventEntry = PatientFollowupEvent;

export type PatientDocumentEntry = PatientDocument;

export type PatientMedicationEntry = NonNullable<PatientProfile['medications']>[number];

export type PatientProfileCase = PatientProfile;

export interface RiskSummaryLite {
  overallLevel?: string | null;
  strengthLevel?: string | null;
  activityLevel?: string | null;
  lastActivityAt?: string | null;
  latestMeasurement?: {
    strengthScore?: number | null;
  } | null;
  notes?: string[];
}
