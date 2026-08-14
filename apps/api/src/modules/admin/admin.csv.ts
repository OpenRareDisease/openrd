import type { AdminExportRow } from './admin.service.js';
import {
  listBaselineFieldOrigins,
  type BaselineFieldOrigin,
} from '../patient-profile/baseline-provenance.js';

/**
 * The full-cohort CSV: one row per `patient_profiles` row.
 *
 * This file is the most dangerous artefact the product can produce, and
 * the three things that make it survivable live elsewhere — the role
 * gate and the audit row in requireAdmin, the typed confirmation and
 * the operator-stamped filename in admin.controller.ts. What is left
 * here is making the bytes honest:
 *
 *   * A UTF-8 BOM, because Excel on a Chinese Windows install reads a
 *     BOM-less UTF-8 file as GBK and renders 张三 as 寮犱笁. The
 *     operator's first move with this file is to open it in Excel.
 *   * Formula neutralisation, because `full_name` and `notes` are
 *     patient-typed and a cell beginning `=` or `@` is a live formula
 *     (and a DDE vector) the moment the operator opens it.
 *   * A fixed column list in a fixed order, so two exports taken a
 *     month apart diff against each other.
 *
 * Headers are snake_case English rather than Chinese: they are the
 * database column names an operator has to be able to trace a value
 * back to, and Chinese headers break every tool that would consume
 * this. The Chinese belongs on the confirmation screen, which is where
 * a human is being asked to decide.
 */

/**
 * One column: its header and how to read it out of a row.
 *
 * A single list, rather than a header array beside a value array,
 * because those two drift and a shifted column is a CSV that silently
 * files one patient's phone number under another patient's name.
 */
interface CsvColumn {
  header: string;
  read: (row: AdminExportRow) => unknown;
}

const baselineSection = (row: AdminExportRow, section: string): Record<string, unknown> => {
  const payload = row.baselinePayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const value = (payload as Record<string, unknown>)[section];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const baselineField = (section: string, key: string) => (row: AdminExportRow) =>
  baselineSection(row, section)[key] ?? null;

/** `baseline_payload.notes` is a top-level string on
 *  `baselineProfileSchema`, not a section like the four blocks above. */
const baselineNotes = (row: AdminExportRow): unknown => {
  const payload = row.baselinePayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return (payload as Record<string, unknown>).notes ?? null;
};

/**
 * A `date` column, rendered as the calendar day it holds.
 *
 * node-postgres materialises a `date` as a JS Date at LOCAL midnight,
 * so `toISOString()` on a 1990-05-15 birthday in Asia/Shanghai yields
 * `1990-05-14T16:00:00.000Z` — a CSV that moves every patient's
 * birthday back a day. Same reasoning, and the same shape, as
 * `toDateString` in profile.service.ts.
 */
const csvCalendarDate = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return value.includes('T') ? value.split('T')[0] : value;
};

const originsWithState = (row: AdminExportRow, state: BaselineFieldOrigin['state']): string[] =>
  listBaselineFieldOrigins(row.baselinePayload)
    .filter((entry) => entry.origin.state === state)
    .map((entry) => entry.path);

export const FULL_EXPORT_COLUMNS: CsvColumn[] = [
  { header: 'user_id', read: (row) => row.userId },
  { header: 'profile_id', read: (row) => row.profileId },
  { header: 'patient_code', read: (row) => row.patientCode },
  { header: 'phone_number', read: (row) => row.phoneNumber },
  { header: 'email', read: (row) => row.email },
  { header: 'account_role', read: (row) => row.accountRole },
  { header: 'account_is_active', read: (row) => row.accountIsActive },
  { header: 'account_created_at', read: (row) => row.accountCreatedAt },
  { header: 'full_name', read: (row) => row.fullName },
  { header: 'preferred_name', read: (row) => row.preferredName },
  { header: 'date_of_birth', read: (row) => csvCalendarDate(row.dateOfBirth) },
  { header: 'gender', read: (row) => row.gender },
  { header: 'height_cm', read: (row) => row.heightCm },
  { header: 'weight_kg', read: (row) => row.weightKg },
  { header: 'blood_type', read: (row) => row.bloodType },
  { header: 'contact_phone', read: (row) => row.contactPhone },
  { header: 'contact_email', read: (row) => row.contactEmail },
  { header: 'primary_physician', read: (row) => row.primaryPhysician },
  { header: 'region_province', read: (row) => row.regionProvince },
  { header: 'region_city', read: (row) => row.regionCity },
  { header: 'region_district', read: (row) => row.regionDistrict },
  { header: 'diagnosis_stage', read: (row) => row.diagnosisStage },
  { header: 'diagnosis_date', read: (row) => csvCalendarDate(row.diagnosisDate) },
  { header: 'genetic_mutation', read: (row) => row.geneticMutation },

  { header: 'baseline_birth_year', read: baselineField('foundation', 'birthYear') },
  { header: 'baseline_age_band', read: baselineField('foundation', 'ageBand') },
  { header: 'baseline_region_label', read: baselineField('foundation', 'regionLabel') },
  { header: 'baseline_diagnosis_year', read: baselineField('foundation', 'diagnosisYear') },

  {
    header: 'baseline_diagnosis_ladder',
    read: baselineField('diseaseBackground', 'diagnosisLadder'),
  },
  { header: 'baseline_diagnosed_fshd', read: baselineField('diseaseBackground', 'diagnosedFshd') },
  { header: 'baseline_diagnosis_type', read: baselineField('diseaseBackground', 'diagnosisType') },
  { header: 'baseline_d4z4', read: baselineField('diseaseBackground', 'd4z4') },
  { header: 'baseline_haplotype', read: baselineField('diseaseBackground', 'haplotype') },
  { header: 'baseline_methylation', read: baselineField('diseaseBackground', 'methylation') },
  { header: 'baseline_family_history', read: baselineField('diseaseBackground', 'familyHistory') },
  { header: 'baseline_onset_region', read: baselineField('diseaseBackground', 'onsetRegion') },

  {
    header: 'baseline_independently_ambulatory',
    read: baselineField('currentStatus', 'independentlyAmbulatory'),
  },
  {
    header: 'baseline_arm_raise_difficulty',
    read: baselineField('currentStatus', 'armRaiseDifficulty'),
  },
  { header: 'baseline_facial_weakness', read: baselineField('currentStatus', 'facialWeakness') },
  { header: 'baseline_foot_drop', read: baselineField('currentStatus', 'footDrop') },
  {
    header: 'baseline_breathing_symptoms',
    read: baselineField('currentStatus', 'breathingSymptoms'),
  },
  {
    header: 'baseline_assistive_devices',
    read: baselineField('currentStatus', 'assistiveDevices'),
  },

  { header: 'baseline_challenge_fatigue', read: baselineField('currentChallenges', 'fatigue') },
  { header: 'baseline_challenge_pain', read: baselineField('currentChallenges', 'pain') },
  { header: 'baseline_challenge_stairs', read: baselineField('currentChallenges', 'stairs') },
  { header: 'baseline_challenge_dressing', read: baselineField('currentChallenges', 'dressing') },
  {
    header: 'baseline_challenge_reaching_up',
    read: baselineField('currentChallenges', 'reachingUp'),
  },
  {
    header: 'baseline_challenge_walking_stability',
    read: baselineField('currentChallenges', 'walkingStability'),
  },

  /**
   * §B3, carried out of the app rather than flattened away.
   *
   * A semicolon-joined list of the dotted baseline paths that carry an
   * `admin_entered` marker in the stored payload. That is all this
   * column reports; it does not certify the rest.
   *
   * 「Empty means the patient entered every value」 holds only while
   * every writer of `baseline_payload` goes through one of the two
   * helpers in baseline-provenance.ts, because `baselineProfileSchema`
   * strips the block and `upsertBaseline` writes over the whole column
   * — one save from a writer that calls neither erases every marker on
   * the profile, including for fields it did not touch. Both writers
   * are wired today. `grep -rn 'upsertBaseline(' apps/api/src` on
   * 2026-08-13 returns five lines: the method itself
   * (`profile.service.ts:1055`), its two callers —
   * `profile.controller.ts:730` via `applyPatientBaselineWrite` and
   * `admin.controller.ts:350` via `applyAdminBaselineWrite` — and two
   * comments quoting the same command, this one and the one in
   * baseline-provenance.ts. A third caller added without a helper would
   * empty this column silently. Nothing in this file tests that: what
   * pins it is `PatientProfileController.updateMyBaseline — §B3
   * per-field reclaim` in profile.controller.test.ts (the patient's
   * write carrying another administrator's marker forward) and
   * `carries an existing marker forward when the write touches a
   * different field` in admin.controller.test.ts.
   *
   * The two columns are separate because
   * `unreadable` is not「no marker」: it is a marker this code could
   * not parse, and folding it into the empty case would present an
   * admin-entered value as the patient's own, which is the single
   * thing that module exists to prevent.
   */
  {
    header: 'admin_entered_baseline_fields',
    read: (row) => originsWithState(row, 'admin_entered'),
  },
  {
    header: 'unreadable_provenance_baseline_fields',
    read: (row) => originsWithState(row, 'unreadable'),
  },

  { header: 'baseline_notes', read: baselineNotes },
  { header: 'profile_notes', read: (row) => row.notes },

  { header: 'ai_consent_personal', read: (row) => row.aiConsentPersonal },
  { header: 'ai_consent_third_party', read: (row) => row.aiConsentThirdParty },
  { header: 'ai_consent_precise_values', read: (row) => row.aiConsentPreciseValues },
  { header: 'clinical_trial_consent', read: (row) => row.clinicalTrialConsent },
  { header: 'data_donation_consent', read: (row) => row.dataDonationConsent },
  { header: 'hospital_sync_consent', read: (row) => row.hospitalSyncConsent },
  { header: 'community_share_consent', read: (row) => row.communityShareConsent },

  { header: 'count_measurements', read: (row) => row.counts.measurements },
  { header: 'count_function_tests', read: (row) => row.counts.function_tests },
  { header: 'count_symptom_scores', read: (row) => row.counts.symptom_scores },
  { header: 'count_daily_impacts', read: (row) => row.counts.daily_impacts },
  { header: 'count_followup_events', read: (row) => row.counts.followup_events },
  { header: 'count_activity_logs', read: (row) => row.counts.activity_logs },
  { header: 'count_documents', read: (row) => row.counts.documents },
  { header: 'count_medications', read: (row) => row.counts.medications },
  { header: 'count_falls', read: (row) => row.counts.falls },
  {
    header: 'count_instrument_administrations',
    read: (row) => row.counts.instrument_administrations,
  },

  { header: 'profile_created_at', read: (row) => row.profileCreatedAt },
  { header: 'profile_updated_at', read: (row) => row.profileUpdatedAt },
];

/**
 * Characters that make Excel and LibreOffice treat a cell as a formula
 * rather than as text.
 *
 * Neutralised by prefixing an apostrophe, WHICH CHANGES THE VALUE: a
 * `notes` field that really begins with 「-」 comes out of this file as
 * 「'-」 and a consumer has to strip it. That cost is accepted because
 * no column in this file legitimately begins with one of these — every
 * numeric column here is non-negative (heights, weights, 1–5 difficulty
 * scores, four-digit years, record counts), dates are ISO, booleans are
 * `true`/`false`, and the identifiers are UUIDs and phone numbers.
 * Which leaves the patient-typed text columns, where a leading `=` is
 * the case this exists for.
 */
const FORMULA_LEAD_CHARACTERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** RFC 4180 with one addition. Every field is quoted, not only the ones
 *  that need it: a conditionally-quoted file is one where a value that
 *  gains a comma next month changes the shape of the line, and a diff
 *  between two exports then reports every such row as changed. */
export const csvField = (value: unknown): string => {
  const text = formatCsvValue(value);
  const guarded = text.length > 0 && FORMULA_LEAD_CHARACTERS.has(text[0]) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
};

const formatCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => formatCsvValue(entry)).join(';');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    // Not reachable from any column above, all of which read a scalar,
    // an array, or a date. Reachable from a hand-written
    // `baseline_payload` holding an object where the schema has a
    // string — and `[object Object]` in a clinical export is a value
    // that has been destroyed rather than reported.
    return JSON.stringify(value);
  }
  return String(value);
};

/**
 * `\r\n` line endings, per RFC 4180 and because the target is Excel on
 * Windows.
 *
 * The BOM goes on the front of the whole document, not on the header
 * row, so a consumer that strips the first three bytes gets a clean
 * `user_id` column name.
 */
export const buildFullExportCsv = (rows: AdminExportRow[]): string => {
  const lines = [FULL_EXPORT_COLUMNS.map((column) => csvField(column.header)).join(',')];
  for (const row of rows) {
    lines.push(FULL_EXPORT_COLUMNS.map((column) => csvField(column.read(row))).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
};

/**
 * `openrd-patients-20260813T041107Z-by-<adminUserId>.csv`.
 *
 * §B4 asks for the operator and the timestamp in the name, and the
 * reason is what happens to this file afterwards: it gets copied to a
 * laptop, mailed, dropped in a shared folder, and found eighteen months
 * later by someone who has to work out where it came from. The operator
 * is their `app_users.id` — the only identifier we have for them that
 * is not a phone number, and the one that joins straight to the two
 * `admin.export` rows in `audit_logs`. The timestamp is UTC and
 * basic-format ISO 8601 so the name sorts chronologically and contains
 * no character a filesystem or a Content-Disposition header argues
 * with.
 */
export const buildFullExportFileName = (at: Date, adminUserId: string): string =>
  `openrd-patients-${at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')}-by-${adminUserId}.csv`;
