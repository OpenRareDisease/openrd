export const GENDER_OPTIONS = ['male', 'female', 'non_binary', 'prefer_not_to_say'] as const;

export const MUSCLE_GROUPS = [
  'deltoid',
  'biceps',
  'triceps',
  'tibialis',
  'quadriceps',
  'hamstrings',
  'gluteus',
] as const;

export const SUBMISSION_KINDS = ['baseline', 'followup', 'event'] as const;

export const MEASUREMENT_SIDES = ['left', 'right', 'bilateral', 'none'] as const;

export const BODY_REGIONS = [
  'shoulder_girdle',
  'upper_arm',
  'face',
  'torso',
  'hip',
  'thigh',
  'knee',
  'ankle',
  'respiratory',
  'general',
] as const;

export const MEASUREMENT_ENTRY_MODES = [
  'self_report',
  'guided_assessment',
  'ocr_import',
  'clinician_entered',
] as const;

export const FUNCTION_TEST_TYPES = [
  'stair_climb',
  'ten_meter_walk',
  'sit_to_stand',
  'six_minute_walk',
  'timed_up_and_go',
  'custom',
] as const;

export const ACTIVITY_SOURCES = [
  'manual',
  'voice_transcription',
  'imported',
  'stair_test',
] as const;

export const DOCUMENT_TYPES = ['mri', 'genetic_report', 'blood_panel', 'other'] as const;

export const MEDICATION_STATUS = ['active', 'paused', 'completed', 'stopped'] as const;

export const SYMPTOM_KEYS = [
  'fatigue',
  'pain',
  'dyspnea',
  'sleep_quality',
  'anxiety_about_progression',
] as const;

export const DAILY_IMPACT_KEYS = [
  'hair_washing',
  'reaching_up',
  'stairs',
  'dressing',
  'walking_outdoors',
] as const;

export const FOLLOWUP_EVENT_TYPES = [
  'fall',
  'new_foot_drop',
  'new_arm_raise_difficulty',
  'new_breathing_discomfort',
  'started_afo',
  'started_wheelchair',
  'started_niv',
  'uploaded_report',
  'other',
] as const;

export const FOLLOWUP_EVENT_SEVERITIES = ['mild', 'moderate', 'severe'] as const;

export type GenderOption = (typeof GENDER_OPTIONS)[number];
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];
export type MeasurementSide = (typeof MEASUREMENT_SIDES)[number];
export type BodyRegion = (typeof BODY_REGIONS)[number];
export type MeasurementEntryMode = (typeof MEASUREMENT_ENTRY_MODES)[number];
export type FunctionTestType = (typeof FUNCTION_TEST_TYPES)[number];
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type MedicationStatus = (typeof MEDICATION_STATUS)[number];
export type SymptomKey = (typeof SYMPTOM_KEYS)[number];
export type DailyImpactKey = (typeof DAILY_IMPACT_KEYS)[number];
export type FollowupEventType = (typeof FOLLOWUP_EVENT_TYPES)[number];
export type FollowupEventSeverity = (typeof FOLLOWUP_EVENT_SEVERITIES)[number];
