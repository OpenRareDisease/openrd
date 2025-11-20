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

export const FUNCTION_TEST_TYPES = [
  'stair_climb',
  'six_minute_walk',
  'timed_up_and_go',
  'custom',
] as const;

export const ACTIVITY_SOURCES = ['manual', 'voice_transcription', 'imported'] as const;

export const DOCUMENT_TYPES = ['mri', 'genetic_report', 'blood_panel', 'other'] as const;

export const MEDICATION_STATUS = ['active', 'paused', 'completed', 'stopped'] as const;

export type GenderOption = (typeof GENDER_OPTIONS)[number];
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
export type FunctionTestType = (typeof FUNCTION_TEST_TYPES)[number];
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type MedicationStatus = (typeof MEDICATION_STATUS)[number];
