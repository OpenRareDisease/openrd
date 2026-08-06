export const GENDER_OPTIONS = ['male', 'female', 'non_binary', 'prefer_not_to_say'] as const;

/**
 * Muscle groups a strength measurement may be filed under.
 *
 * `face` and `abdominal` were missing, and their absence was not a
 * cosmetic gap: they are two of the six regions the FSHD Clinical
 * Score grades (face, shoulder girdle, upper arm, abdominal /
 * Beevor's sign, pelvic girdle, leg). Facial weakness is the "facio"
 * in facioscapulohumeral and is usually the first region involved;
 * abdominal involvement is what Beevor's sign tests for. A patient
 * whose earliest and most characteristic findings are in those two
 * regions could not record either one, while `BODY_REGIONS` below has
 * carried `face` and `torso` since it was written — so the same
 * observation was expressible on one axis and not the other.
 *
 * The two new values are APPENDED rather than slotted into anatomical
 * order on purpose: the mobile side renders this list, and reordering
 * it would silently reshuffle every picker built from the index.
 *
 * Adding a value here is a TWO-PLACE edit, the same discipline
 * FUNCTION_TEST_UNITS documents in profile.schema.ts: this array is
 * what rejects a bad write through Zod, and the CHECK constraint in
 * migration 022 is the guard rail for the paths Zod never sees (a
 * direct SQL UPDATE, an import pipeline, a support tool). Change one
 * without the other and the two disagree about what a valid row is.
 */
export const MUSCLE_GROUPS = [
  'deltoid',
  'biceps',
  'triceps',
  'tibialis',
  'quadriceps',
  'hamstrings',
  'gluteus',
  'face',
  'abdominal',
] as const;

/**
 * How a patient answers 「当前行走」 on the baseline form.
 *
 * This was a BOOLEAN (`independentlyAmbulatory`), and the boolean had
 * two values for three facts. The mobile form offered 「可独立行走」
 * and 「需要辅助」 (AMBULATION_OPTIONS in
 * apps/mobile/lib/profile-baseline-options.ts) — and nothing else, so
 * a patient who cannot walk at all had to answer 「需要辅助」. That is
 * the collapse migration 017's comment is describing when it says a
 * profile "already says `independentlyAmbulatory: false` and lists a
 * wheelchair": `false` was carrying both 「拄拐/扶人能走」 and
 * 「走不了」, which are not the same clinical state and do not have
 * the same needs.
 *
 *   independent  可独立行走，不需要他人或器具协助
 *   assisted     需要辅助（拐杖、支具、扶人）才能行走
 *   unable       无法行走（含长期使用轮椅、卧床）
 *
 * `unable` is the state `FOLLOWUP_EVENT_TYPES.started_wheelchair`
 * transitions a patient INTO; before this value existed the event
 * could be logged but the state it announced could not be recorded,
 * so the timeline and the profile disagreed by construction. The
 * instruments module wires the two together on the Vignos path (see
 * instruments/vignos.ts).
 *
 * READING PRE-022 DATA: every historical `false` was migrated to
 * `assisted` because that is the label the patient actually tapped.
 * It is NOT evidence that they can walk with aid — before 022 there
 * was no other answer available to someone who cannot walk. Only
 * `assisted` values written after 022 mean what they say. Migration
 * 022 carries the same warning next to the back-fill.
 */
export const AMBULATION_STATES = ['independent', 'assisted', 'unable'] as const;

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

/**
 * What the patient was doing when they fell.
 *
 * A closed set rather than the free-text box a fall used to land in.
 * That is the entire reason the falls diary is a table
 * (migration 023): the AI retriever's field allowlist refuses every
 * patient-typed column, so a fall described in prose was invisible to
 * the one feature meant to help the patient reason about it. A value
 * chosen from this list is a value THIS FILE chose, which is why it
 * can reach a prompt at all.
 *
 * The members are picked so the two mechanisms that actually drop
 * people with FSHD stay separable rather than collapsing into
 * 「走路的时候」:
 *   - catching a foot, which is what ankle dorsiflexor weakness does:
 *     `walking`, `uneven_or_slippery`
 *   - a proximal give-way under load, which is what hip and knee
 *     extensor weakness does: `stairs`, `standing_up`, `turning`,
 *     `reaching`
 * `dressing_or_washing` is its own member because it is done standing,
 * often one-handed, usually with nothing to hold on to.
 *
 * `unknown` is 「不记得当时在干什么」 and is NOT the same as leaving
 * the column NULL, which means 「还没填」. Migration 017 had to add a
 * whole column to recover that distinction after NULL was made to
 * carry both facts; here it costs one enum member.
 *
 * Adding a value is a TWO-PLACE edit, the same discipline
 * MUSCLE_GROUPS documents: this array is what rejects a bad write
 * through Zod, and the CHECK constraint in migration 023 is the guard
 * rail for the paths Zod never sees. falls/migration-023.test.ts fails
 * if the two disagree.
 *
 * APPEND, never reorder — the mobile picker is built from this list.
 */
export const FALL_ACTIVITIES = [
  'walking',
  'stairs',
  'standing_up',
  'turning',
  'reaching',
  'dressing_or_washing',
  'uneven_or_slippery',
  'other',
  'unknown',
] as const;

/**
 * Indoor or outdoor. Same two-place edit and the same
 * 'unknown' ≠ NULL rule as FALL_ACTIVITIES above.
 */
export const FALL_LOCATIONS = ['indoor', 'outdoor', 'unknown'] as const;

export type GenderOption = (typeof GENDER_OPTIONS)[number];
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
export type AmbulationState = (typeof AMBULATION_STATES)[number];
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
export type FallActivity = (typeof FALL_ACTIVITIES)[number];
export type FallLocation = (typeof FALL_LOCATIONS)[number];
