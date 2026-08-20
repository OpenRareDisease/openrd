import { z } from 'zod';
import {
  ACTIVITY_SOURCES,
  AMBULATION_STATES,
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
import { SAFE_VALUE_MAX_LENGTH } from '../ai-agents/security/allowlist.js';

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

// `patientCode` is the clinic-assigned identifier — users must NOT
// self-claim it on either the create or update path. The service
// layer's UPDATE statement already drops it (profile.service.ts
// `updateProfile`); the create path used to admit it from the public
// body via this schema. PR-Sec-8 closes that asymmetry by stripping
// the field on the create path too. A future admin/back-office
// onboarding flow that legitimately needs to set patientCode should
// use its own dedicated schema.
export const createProfileSchema = baseProfileSchema.omit({ patientCode: true });
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = baseProfileSchema.partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * 「当前行走」 on the baseline form: three states, plus a compatibility
 * shim for the boolean the field used to be.
 *
 * The three states and why two were not enough are documented on
 * AMBULATION_STATES in profile.constants.ts. This is the write-side
 * half of a TWO-PLACE edit — the other half is the CHECK constraint on
 * `patient_profiles.baseline_payload` in migration 022, which is what
 * defends the column against the paths Zod never sees. Widening the
 * state set means editing both.
 *
 * WHY THE BOOLEAN BRANCH IS STILL HERE. The app ships as a web export
 * that patients open in WeChat's in-app browser, which caches
 * aggressively; the handset that submits a baseline an hour after this
 * deploy may still be running the build that sends `true` / `false`.
 * Rejecting those would 400 the registration form — the one screen a
 * new patient cannot get past. So the boolean is accepted and
 * normalised, exactly the way the DB back-fill in 022 normalises the
 * rows already on disk:
 *
 *   true  → 'independent'   (「可独立行走」)
 *   false → 'assisted'      (「需要辅助」)
 *
 * `false → assisted` reproduces the label the patient tapped and
 * nothing more. It does not assert they can walk with aid; an old
 * client has no way to say 'unable'. Remove this branch only once the
 * mobile build that sends the string is the oldest one in the wild.
 */
const ambulationStateSchema = z
  .union([z.enum(AMBULATION_STATES), z.boolean()])
  .transform((value) => {
    if (typeof value !== 'boolean') return value;
    return value ? 'independent' : 'assisted';
  });

/**
 * 「你的诊断走到哪一步了」 — five states, where there used to be one
 * boolean.
 *
 * `diagnosedFshd: true | false | null` collapsed five situations that
 * call for five different next moves, and the two it hurt most are the
 * two this population is actually in:
 *
 *   - 「医生说是 FSHD，但我没有基因报告」 answered `true`, and every
 *     screen downstream treated that as a molecular diagnosis. Clinical
 *     trials do not: entry requires a confirmed molecular genetic
 *     diagnosis (Giardina et al., Clin Genet 2024;106(1):13-26, doi
 *     10.1111/cge.14533 —「clinical trials, all of which require a
 *     confirmed molecular genetic diagnosis for entry」; the paper is in
 *     the corpus under 03.遗传生育).
 *   - 「我做了检测，报告丢了/在老家医院」 also answered `true`, and the
 *     app then had no way to tell that person the one useful thing:
 *     the report exists and can be requested back.
 *
 * And on the negative side, 「想测但还没测」 and 「不打算测」 are the
 * same `false`, which is why the app could only ever nag both of them
 * with the same sentence.
 *
 * ORDER IS MEANINGFUL: index 0 is the most complete evidence, index 4
 * the least. Nothing indexes into it today; it is ordered so that a
 * screen which wants to render it as a ladder can, without inventing
 * an order of its own.
 */
export const DIAGNOSIS_LADDER_STATES = [
  'confirmed_with_report',
  'confirmed_report_unavailable',
  'clinical_only',
  'untested_wants_test',
  'untested_no_plan',
] as const;
export type DiagnosisLadderState = (typeof DIAGNOSIS_LADDER_STATES)[number];

/** Patient-facing wording. Kept next to the enum so a new state cannot
 *  be added without someone writing the Chinese for it. */
export const DIAGNOSIS_LADDER_LABELS: Record<DiagnosisLadderState, string> = {
  confirmed_with_report: '已确诊，基因报告在手上',
  confirmed_report_unavailable: '已确诊，但报告不在手上',
  clinical_only: '临床诊断，还没做过基因检测',
  untested_wants_test: '还没测过，想测',
  untested_no_plan: '还没测过，暂时不打算测',
};

/**
 * The old boolean, derived from the ladder.
 *
 * `clinical_only` maps to `true` deliberately: a neurologist did
 * diagnose this person with FSHD, and that is precisely what the
 * boolean has always meant on the baseline form —「我被诊断为 FSHD」.
 * It has never meant「基因确诊」, and no caller may read it that way:
 * the passport derives its own `confirmation` from OCR'd report fields
 * (see PassportDiagnosisConfirmation in profile.passport.ts) and does
 * not consult this boolean at all.
 *
 * There is deliberately no inverse. `true` could be any of the first
 * three rungs and `false` either of the last two, so reconstructing a
 * ladder from a legacy boolean means guessing which rung — and the
 * whole reason for the ladder is that those rungs are not
 * interchangeable. A profile written by an older client simply has no
 * ladder until its owner answers the question.
 */
export const diagnosedFshdFromLadder = (state: DiagnosisLadderState): boolean =>
  state === 'confirmed_with_report' ||
  state === 'confirmed_report_unavailable' ||
  state === 'clinical_only';

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
      /** See DIAGNOSIS_LADDER_STATES. Optional because the field is
       *  new: a handset running the previous web export sends only
       *  `diagnosedFshd`, and that submission has to keep working —
       *  this ships as a web export into WeChat's in-app browser,
       *  which caches for days. */
      diagnosisLadder: z.enum(DIAGNOSIS_LADDER_STATES).optional().nullable(),
      diagnosedFshd: z.boolean().optional().nullable(),
      diagnosisType: nullableText(40),
      d4z4: nullableText(80),
      haplotype: nullableText(40),
      methylation: nullableText(80),
      familyHistory: nullableText(255),
      onsetRegion: nullableText(120),
    })
    .partial()
    // `diagnosedFshd` becomes a DERIVED value the moment a ladder
    // state is present, so the two can never disagree on disk. They
    // could otherwise: the new form sends both, and a client that
    // posts `{ diagnosisLadder: 'untested_no_plan', diagnosedFshd:
    // true }` — a half-migrated form, a stale local draft — would
    // persist a row whose two halves say opposite things, with every
    // reader free to pick either. The ladder wins because it is the
    // answer the patient actually gave; the boolean is a projection
    // of it kept for the readers that predate it.
    //
    // Absent a ladder the boolean is passed through untouched. See
    // `diagnosedFshdFromLadder` for why nothing is inferred the other
    // way round.
    .transform((value) =>
      value.diagnosisLadder
        ? { ...value, diagnosedFshd: diagnosedFshdFromLadder(value.diagnosisLadder) }
        : value,
    )
    .optional(),
  currentStatus: z
    .object({
      independentlyAmbulatory: ambulationStateSchema.optional().nullable(),
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

/**
 * Units a function test may be recorded in.
 *
 * This was `z.string().max(32)` — unconstrained patient-supplied free
 * text on a column that the AI followup retriever ships to the model
 * verbatim: `unit` sits on the `followups` precise allowlist both as
 * its own field and concatenated into the rendered series string, with
 * no escaping and no truncation. Every sibling field on this schema
 * that reaches the same allowlist (`testType`, `side`) is an enum, and
 * the retriever's own privacy contract excludes `notes` / event
 * descriptions precisely because no static rule can prove patient free
 * text is PII-free. `unit` was the one column that made that argument
 * untrue.
 *
 * The set covers how the six FUNCTION_TEST_TYPES are actually
 * measured: timed tests in seconds, six-minute walk in metres, gait
 * speed, sit-to-stand repetitions, plus kg / score for `custom`
 * (dynamometer readings, ordinal scales). The only client today sends
 * 'sec'. Widening the set is a one-line change here plus the matching
 * DB CHECK in migration 015 — deliberately a two-place edit, so that
 * adding a unit is a decision rather than a side effect.
 */
export const FUNCTION_TEST_UNITS = ['sec', 'm', 'm/s', 'reps', 'kg', 'score'] as const;
export type FunctionTestUnit = (typeof FUNCTION_TEST_UNITS)[number];

export const functionTestSchema = z
  .object({
    testType: z.enum(FUNCTION_TEST_TYPES),
    // `.finite()` rejects `Infinity` / `-Infinity` / `NaN` that
    // `z.coerce.number()` would otherwise admit (string "Infinity"
    // coerces to Infinity, then passes the bounds-less z.number()).
    // Bounded numeric fields elsewhere are protected by `.min/.max`
    // returning false for NaN, but this one is unbounded on purpose
    // (caller decides the unit) so the guard belongs here.
    measuredValue: z.coerce.number().finite().optional().nullable(),
    /** 「今天做不了」— the test was attempted and could not be completed.
     *  Kept separate from a null `measuredValue` because "unable" and
     *  "not recorded" are opposite readings of the same gap, and only
     *  the first is a clinical observation. Mutually exclusive with a
     *  measurement (DB CHECK in migration 017 enforces the same rule). */
    notApplicable: z.boolean().optional(),
    unit: z.enum(FUNCTION_TEST_UNITS).optional().nullable(),
    side: z.enum(MEASUREMENT_SIDES).optional().nullable(),
    protocol: z.string().max(120).optional().nullable(),
    deviceUsed: z.string().max(120).optional().nullable(),
    assistanceRequired: z.boolean().optional().nullable(),
    notes: z.string().optional().nullable(),
    performedAt: z.string().datetime().optional(),
    submissionId: z.string().uuid().optional().nullable(),
  })
  .refine((value) => !(value.notApplicable === true && value.measuredValue != null), {
    // The DB has the same CHECK (migration 017), but reaching it means
    // a contradictory body comes back as a 500. 「做不到」and「15 秒」
    // on one attempt is the caller's mistake, so it is answered as
    // one — and the message names both fields, because the client that
    // sends this is a form that had them on screen together.
    message: '标记为「今天做不了」时不能同时填写测量值',
    path: ['measuredValue'],
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

/**
 * Record kinds a patient may retract from their own timeline. The
 * three tables here are the ones a patient hand-enters and can
 * therefore mis-enter (a stray digit in a stair-climb time is a
 * permanent spike on the trend line otherwise).
 *
 * Measurements, daily impacts, activity logs and medications are
 * deliberately NOT in this list yet — they have no `deleted_at`
 * column (migration 016), so admitting them here would produce a
 * silent no-op. Widening the list means widening the migration and
 * every read path first.
 *
 * The enum doubles as the key of the kind→table map in
 * profile.service.ts: nothing user-supplied is ever interpolated into
 * the SQL, only a value that survived this parse.
 */
export const DELETABLE_RECORD_KINDS = ['function_test', 'symptom_score', 'followup_event'] as const;
export type DeletableRecordKind = (typeof DELETABLE_RECORD_KINDS)[number];

/** Path params for DELETE /api/profiles/me/records/:kind/:id. The
 *  uuid() check matters: without it a malformed id reaches Postgres
 *  and surfaces as a 500 (invalid input syntax) instead of a 400. */
export const deleteRecordParamsSchema = z.object({
  kind: z.enum(DELETABLE_RECORD_KINDS),
  id: z.string().uuid(),
});

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

/** Body schema for PUT /api/profiles/me/consent. All three fields are
 *  optional — callers can flip one toggle at a time. Coercion + the
 *  precise-requires-base rule live in the security helper so every
 *  caller gets the same semantics. */
export const consentUpdateSchema = z
  .object({
    personal: z.boolean().optional(),
    thirdParty: z.boolean().optional(),
    preciseValues: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.personal !== undefined ||
      data.thirdParty !== undefined ||
      data.preciseValues !== undefined,
    { message: 'At least one of personal / thirdParty / preciseValues must be provided' },
  );
export type ConsentUpdateBody = z.infer<typeof consentUpdateSchema>;

/** Query schema for GET /api/profiles/me/consent/history. `limit` is
 *  bounded to the same `[1, 500]` window the security helper clamps
 *  to, so an out-of-range request fails fast as a 400 instead of
 *  being silently rounded. `flagName` matches the CHECK constraint on
 *  `ai_consent_events.flag_name`. */
export const consentHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  flagName: z.enum(['personal', 'third_party', 'precise_values']).optional(),
});
export type ConsentHistoryQuery = z.infer<typeof consentHistoryQuerySchema>;

/** Body schema for PUT /api/profiles/me/sharing-preferences. All four
 *  flags are optional — the screen sends one toggle at a time. We
 *  refuse empty bodies so a misconfigured client sees a clean 400
 *  rather than a silent no-op UPDATE. */
export const sharingPreferencesUpdateSchema = z
  .object({
    clinicalTrial: z.boolean().optional(),
    dataDonation: z.boolean().optional(),
    hospitalSync: z.boolean().optional(),
    communityShare: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.clinicalTrial !== undefined ||
      data.dataDonation !== undefined ||
      data.hospitalSync !== undefined ||
      data.communityShare !== undefined,
    {
      message:
        'At least one of clinicalTrial / dataDonation / hospitalSync / communityShare must be provided',
    },
  );
export type SharingPreferencesUpdateBody = z.infer<typeof sharingPreferencesUpdateSchema>;

/** Account deletion demands the user retype their registered phone
 *  number — a destructive path needs more than a button tap. */
export const deletionRequestSchema = z.object({
  phoneNumber: z.string().trim().min(1, '请填写注册手机号'),
});

/** Fields a patient may hand-correct on their own report's OCR
 *  result. Whitelist, not free-form: these are exactly the keys the
 *  detail screen renders and the genetic autofill consumes — a wrong
 *  OCR read here poisons the profile, so correction (not
 *  delete-and-reupload) is the fix path. */
export const EDITABLE_OCR_FIELDS = [
  'reportName',
  'reportTime',
  'diagnosisType',
  'd4z4Repeats',
  'haplotype',
  'methylationValue',
] as const;

/**
 * THE ONE CEILING, NOT THIS SCHEMA'S OWN.
 *
 * This was `max(300)`, and the redactor refuses a value over
 * `SAFE_VALUE_MAX_LENGTH` (200) as evidently not the short structured
 * value its key promised — see `isUntrustworthyValue` in
 * ai-agents/security/pii-redactor.ts. Two limits for one question, and the write
 * path's was the looser one: a patient could store 300 characters under
 * `d4z4Repeats` / `haplotype` / `methylationValue` through the
 * product's own correction screen, above a ceiling the read path was
 * enforcing on the way out. Importing the constant is what stops the
 * two disagreeing again — moving the redactor's limit moves this one.
 *
 * The cap is on the FIELD, not on the request: this schema still
 * accepts one entry per `EDITABLE_OCR_FIELDS` key.
 */
export const ocrFieldsPatchSchema = z.object({
  fields: z
    .record(z.string(), z.string().trim().max(SAFE_VALUE_MAX_LENGTH))
    .refine((fields) => Object.keys(fields).length > 0, '至少提供一个要修正的字段')
    .refine(
      (fields) =>
        Object.keys(fields).every((key) =>
          (EDITABLE_OCR_FIELDS as readonly string[]).includes(key),
        ),
      '包含不可修正的字段',
    ),
});
