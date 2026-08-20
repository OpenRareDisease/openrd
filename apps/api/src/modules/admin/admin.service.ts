import type { Pool } from 'pg';

import { maskAuditPhone } from '../../services/audit/identity-masking.js';
import { AUDIT_RETENTION_DAYS } from '../../services/audit/retention.js';

/**
 * The reads the back-office needs that the patient-facing services do
 * not already answer.
 *
 * Everything that is about ONE patient's clinical record is deliberately
 * NOT here: `PatientProfileService.getProfileByUserId`,
 * `FallsService.listFalls` and `InstrumentsService.listAdministrations`
 * already produce those shapes, they already filter `deleted_at`, and a
 * second query shape over the same tables is a second thing that has to
 * be kept correct when a column is added. What is left for this file is
 * the cohort-level work those services have no method for: the list, the
 * full-database export, and the operations dashboards that answer a
 * question by querying. The ops health summary is not one of those —
 * the controller takes it from a `healthSummary` dependency rather than
 * from this class.
 */

/** No logger, unlike its sibling services. Nothing in here recovers
 *  from a failure or degrades quietly — every query either answers or
 *  throws up into `asyncHandler`, where the shared error handler logs
 *  it once. A logger field this class never called would be a
 *  dependency that reads as「有兜底」. */
export interface AdminServiceDeps {
  pool: Pool;
}

/**
 * A patient list over a rare-disease cohort is re-identifying by
 * construction — every row is a person with FSHD, which is the
 * sensitive fact. So the list carries the least that still lets an
 * operator find the right row: an opaque id to open, the name and phone
 * MASKED, and the account/record dates.
 *
 * What that does and does not buy, precisely. It does NOT stop an
 * administrator from learning any patient's name: they open the record
 * and it is right there. What it does is make the BULK view
 * non-identifying — a screenshot of this page, a scraped page, a
 * shoulder-surfed screen is not a roster of Chinese FSHD patients with
 * dialable numbers — and it makes assembling that roster cost one
 * `admin.record_read` audit row per patient, which is exactly the trail
 * §B2 exists to leave. Bulk exposure becomes an audited, countable act
 * instead of one page load.
 *
 * Deliberately absent, and each was considered: date of birth, gender,
 * region, diagnosis stage, genetic mutation, any baseline field, any
 * count of clinical records. None of them helps an operator pick the
 * right row out of a search result, and every one of them is a
 * quasi-identifier that a province plus a birth year already makes
 * near-unique in a cohort this small.
 */
export interface AdminPatientListItem {
  /** `app_users.id`. The key every patient-scoped admin route is
   *  built on, because `requireAdmin`'s `targetParam` must resolve to
   *  one for the audit row to name a patient. */
  userId: string;
  patientCode: string | null;
  /** 张三 → 张〇, null when the profile has no name yet. */
  maskedName: string | null;
  /** 13912340001 → 139****0001. */
  maskedPhone: string | null;
  role: string;
  isActive: boolean;
  /** False for an account that registered and never opened the form.
   *  It is the difference between「查无此人」and「有账号，没填过」. */
  hasProfile: boolean;
  registeredAt: string;
  profileUpdatedAt: string | null;
}

export interface AdminPatientListResult {
  page: number;
  pageSize: number;
  total: number;
  items: AdminPatientListItem[];
}

export interface AdminAccountDTO {
  userId: string;
  phoneNumber: string;
  email: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
}

/**
 * The identity columns off `patient_profiles`, plus the baseline
 * payload AS STORED.
 *
 * THE STORED COLUMN IS THE POINT, and it is the reason this method
 * exists next to services that already read this table.
 * `getProfileByUserId` and `getBaselineByUserId` each run
 * `applyGeneticReportAutofill` on the way out, which fills a missing
 * D4Z4 / haplotype / diagnosis year from the patient's most recent
 * genetic report at READ time. That merge is right for a screen and
 * wrong for the back-office edit form, in a way that damages exactly
 * what §B3 protects:
 *
 *   * the administrator's form would be pre-filled with values that
 *     are not in the column, and PUTting it back would PERSIST the
 *     inferred diagnosis year as though someone had entered it —
 *     after which correcting or deleting the report leaves the stale
 *     inference behind, attributed to the patient;
 *   * `applyAdminBaselineWrite` derives the changed set by diffing, so
 *     an administrator who edited one unrelated field would be
 *     stamping 管理员代填 across every field the autofill had supplied;
 *   * and the genetic fields the merge supplies are not admin-writable
 *     at all, so echoing them back is a refused write: an operator who
 *     came to fix a 备注 would be told they may not fill in a D4Z4
 *     they never typed. Asserted in admin.controller.test.ts.
 *
 * So the edit form and the provenance diff work off this, and the
 * response says so with `baselineIsStored`.
 */
export interface AdminStoredProfile {
  profileId: string;
  fullName: string | null;
  preferredName: string | null;
  patientCode: string | null;
  /** `patient_profiles.region_city`, which `upsertBaseline` keeps in
   *  step with `baseline.foundation.regionLabel`. */
  regionLabel: string | null;
  updatedAt: string;
  baselinePayload: Record<string, unknown> | null;
}

/** The record kinds counted per patient in the full CSV export. The
 *  keys are ours; the values are the tables, and the `deleted_at`
 *  filters below have to match the ones `getProfileByUserId` applies
 *  or the count disagrees with the record the same operator can open. */
export const ADMIN_EXPORT_RECORD_KINDS = [
  'measurements',
  'function_tests',
  'symptom_scores',
  'daily_impacts',
  'followup_events',
  'activity_logs',
  'documents',
  'medications',
  'falls',
  'instrument_administrations',
] as const;
export type AdminExportRecordKind = (typeof ADMIN_EXPORT_RECORD_KINDS)[number];

export interface AdminExportRow {
  userId: string;
  phoneNumber: string;
  email: string | null;
  accountRole: string;
  accountIsActive: boolean;
  accountCreatedAt: Date;
  profileId: string;
  patientCode: string | null;
  fullName: string | null;
  preferredName: string | null;
  dateOfBirth: Date | string | null;
  gender: string | null;
  heightCm: string | null;
  weightKg: string | null;
  bloodType: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  primaryPhysician: string | null;
  regionProvince: string | null;
  regionCity: string | null;
  regionDistrict: string | null;
  diagnosisStage: string | null;
  diagnosisDate: Date | string | null;
  geneticMutation: string | null;
  notes: string | null;
  /**
   * The STORED `baseline_payload`, exactly as it sits in the column.
   *
   * Not the payload the app renders: `applyGeneticReportAutofill` fills
   * a missing D4Z4 / haplotype / diagnosis year off the report
   * `pickGeneticEvidenceDocument` names, at READ time, and that merge is
   * deliberately
   * not applied here so that this file answers「数据库里有什么」rather
   * than「界面上显示什么」. A blank d4z4 column therefore means the
   * baseline does not hold one — the patient may still have uploaded a
   * report that does. The confirmation step says this out loud before
   * the operator commits to the download.
   */
  baselinePayload: unknown;
  aiConsentPersonal: boolean;
  aiConsentThirdParty: boolean;
  aiConsentPreciseValues: boolean;
  clinicalTrialConsent: boolean;
  dataDonationConsent: boolean;
  hospitalSyncConsent: boolean;
  communityShareConsent: boolean;
  profileCreatedAt: Date;
  profileUpdatedAt: Date;
  counts: Record<AdminExportRecordKind, number>;
}

export interface AdminCorpusStatus {
  chunkCount: number;
  sourceFileCount: number;
  /**
   * Chunks with a NULL `embedding`. They are in the corpus and are
   * returned by no similarity search — the one corpus fault that is
   * invisible from the KB service's own /health/ready, which reports
   * `empty_corpus` only when the table is empty.
   */
  unembeddedChunkCount: number;
  /** One entry per distinct `embed_model`. More than one is a
   *  half-finished re-ingest: distances between vectors from different
   *  models are not comparable, so retrieval quality is undefined
   *  across the split rather than merely worse. */
  embedModels: Array<{ embedModel: string; chunkCount: number }>;
  oldestUpdatedAt: string | null;
  newestUpdatedAt: string | null;
}

export interface AdminParseFailureItem {
  documentId: string;
  userId: string;
  documentType: string;
  status: string;
  uploadedAt: string;
}

export interface AdminParseFailureQueue {
  items: AdminParseFailureItem[];
  /** True when the queue was cut off at `limit`. The caller renders it;
   *  a truncated list that looks complete is how a backlog gets
   *  declared clear. */
  atCap: boolean;
  limit: number;
  stuckAfterMinutes: number;
}

export interface AdminAiUsage {
  windowDays: number;
  /** `ai_prompt_audit` is swept at AUDIT_RETENTION_DAYS, so no window
   *  can see further back than this however it is asked for. Reported
   *  so a 180-day chart is not read as「我们从来只有这些调用」. */
  retentionDays: number;
  totalCalls: number;
  byStatus: Array<{ status: string; calls: number; avgLatencyMs: number | null }>;
  /**
   * `(everything except success and consent_denied) / (everything
   * except consent_denied)`.
   *
   * `consent_denied` is in neither half: it is the consent gate doing
   * its job, and counting it as a failure would make a privacy control
   * look like an outage. Every OTHER status counts as a failure,
   * including one this build does not know about — see the note on the
   * arithmetic in `getAiUsage`. Null when the window holds no attempt
   * at all, because 0/0 is not 0%.
   */
  failureRate: number | null;
}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

/**
 * `张三` → `张〇`, `欧阳修` → `欧〇〇`, `Alexander` → `A〇〇〇〇〇〇〇〇`.
 *
 * The first character survives because it is what an operator matches
 * against a caller who has just said their surname out loud, and one
 * Chinese surname identifies nobody. The mask is one 〇 per remaining
 * character rather than a fixed run: a truthful length lets the
 * operator rule a row out (「他是三个字」), and a fixed run would show
 * 张三 as 张〇〇, i.e. claim a name the patient does not have. Capped at
 * 8 so a 120-character `full_name` cannot blow up a table cell.
 *
 * Not in services/audit/identity-masking.ts: that module's masks are
 * for what gets WRITTEN into audit_logs, and its own header says so.
 * This one is a display projection and nothing persists it.
 */
export const maskDisplayName = (name: string | null | undefined): string | null => {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const characters = [...trimmed];
  return `${characters[0]}${'〇'.repeat(Math.min(characters.length - 1, 8))}`;
};

/**
 * `%`, `_` and `\` are LIKE metacharacters, and the search box is a
 * free-text field. Unescaped, `%` matches every account, so an operator
 * who pasted a value containing one gets「找到 40 位」and no way to see
 * that their search never ran.
 */
export const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, (character) => `\\${character}`);

/**
 * A refusal threshold, not a benchmark.
 *
 * Above this the export returns an error naming the row count instead
 * of a file, because the alternative — a truncated CSV — is a file that
 * looks like the whole cohort and is not, and there is nothing in a CSV
 * to carry the warning. An operator who genuinely needs a larger dump
 * has `npm run db:backup`, which is the tool for that job.
 *
 * The number sits far above the cohort and far below anything that
 * would strain a single response. Each half measured on 2026-08-13
 * against the dev database:
 *
 *   psql "$DATABASE_URL" -c 'SELECT count(*) FROM patient_profiles'
 *     → 36
 *
 *   listExportRows + buildFullExportCsv over those 36 rows
 *     → 19,247 bytes, i.e. 535 bytes per row across 71 columns
 *
 * 20,000 rows at that width is ~10.7 MB of response, which is why the
 * document can be built as one string (see the note on the handler)
 * rather than streamed. A cohort that outgrows this outgrows the
 * one-string decision at the same time, and the refusal is what makes
 * that a conversation rather than an out-of-memory.
 */
export const FULL_EXPORT_MAX_ROWS = 20_000;

export class AdminService {
  private readonly pool: Pool;

  constructor({ pool }: AdminServiceDeps) {
    this.pool = pool;
  }

  /**
   * The searchable, paginated list.
   *
   * LEFT JOIN, not JOIN: an account that registered and never opened
   * the baseline form has no `patient_profiles` row, and that account
   * is precisely the one an operator is looking for when the caller
   * says「我注册了但是填不进去」. An inner join would answer「查无此人」.
   *
   * The search matches the phone number, the patient code, and the
   * name columns. The name columns are searched and NEVER returned —
   * `maskedName` is what leaves this method — so a wildcard fishing
   * expedition returns masked rows, and READING a name off this list
   * is impossible: it costs an `admin.record_read` on that one patient.
   *
   * WHAT THAT DOES NOT COVER, said here because the sentence above used
   * to imply it did: `?q=张三丰` searches `full_name`, so an operator
   * who already suspects a name can CONFIRM it from the row count
   * alone, and `_auditPathOf` strips the query string before the audit
   * row is written (deliberately — audit_logs is the table
   * identity-masking.ts exists to keep names out of). The trail
   * therefore records that this administrator listed patients at that
   * moment, not what they typed. The property that holds is about THIS
   * method: nothing it returns is an unmasked name or phone number —
   * paging through every account yields 张〇 and 139****0001 — so a name
   * still has to be READ one patient at a time, and that costs an
   * `admin.record_read` row naming them.
   *
   * IT IS NOT A PROPERTY OF THE MODULE. `POST /api/admin/exports/
   * patients.csv` enumerates the whole roster — full names, phone
   * numbers and regions, `listExportRows` below — and no audit row on
   * that path names a patient: `requireAdmin`'s carries
   * `targetUserId: null` because the route declares no `targetParam`
   * (it is about every patient, so there is no single one to record),
   * and `recordFullExportAudit`'s carries the cohort as a whole
   * (`scope: 'all_patients'` + `patientCount` + the filename). That path
   * is audited by its size and its operator rather than by whose names
   * were in it, which is the trade §B4 makes explicit; the typed
   * confirmation and the per-operator rate limit are what stand in front
   * of it.
   */
  async listPatients(options: {
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<AdminPatientListResult> {
    const { page, pageSize } = options;
    const term = options.q?.trim() ? `%${escapeLikePattern(options.q.trim())}%` : null;

    // `ORDER BY u.created_at DESC, u.id` and not「最近更新优先」on a
    // COALESCE over two tables: that expression has no index and never
    // will have one, while this ordering is at least a column. Neither
    // is indexed today and neither needs to be — `SELECT count(*) FROM
    // app_users` returned 40 on the dev database on 2026-08-13. `u.id`
    // is the tiebreaker so two accounts created in the same
    // transaction cannot swap places between page 1 and page 2 and
    // hide a row.
    const [rowsResult, countResult] = await Promise.all([
      this.pool.query(
        `SELECT u.id            AS user_id,
                u.phone_number  AS phone_number,
                u.role          AS role,
                u.is_active     AS is_active,
                u.created_at    AS registered_at,
                p.id            AS profile_id,
                p.patient_code  AS patient_code,
                p.full_name     AS full_name,
                p.preferred_name AS preferred_name,
                p.updated_at    AS profile_updated_at
           FROM app_users u
           LEFT JOIN patient_profiles p ON p.user_id = u.id
          WHERE $1::text IS NULL
             OR u.phone_number ILIKE $1
             OR p.patient_code ILIKE $1
             OR p.full_name ILIKE $1
             OR p.preferred_name ILIKE $1
          ORDER BY u.created_at DESC, u.id
          LIMIT $2 OFFSET $3`,
        [term, pageSize, (page - 1) * pageSize],
      ),
      this.pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
           FROM app_users u
           LEFT JOIN patient_profiles p ON p.user_id = u.id
          WHERE $1::text IS NULL
             OR u.phone_number ILIKE $1
             OR p.patient_code ILIKE $1
             OR p.full_name ILIKE $1
             OR p.preferred_name ILIKE $1`,
        [term],
      ),
    ]);

    return {
      page,
      pageSize,
      total: Number(countResult.rows[0]?.total ?? 0),
      items: rowsResult.rows.map((row) => ({
        userId: row.user_id,
        patientCode: row.patient_code ?? null,
        maskedName: maskDisplayName(row.preferred_name ?? row.full_name),
        maskedPhone: maskAuditPhone(row.phone_number),
        role: row.role,
        isActive: Boolean(row.is_active),
        hasProfile: Boolean(row.profile_id),
        registeredAt: toIso(row.registered_at) ?? '',
        profileUpdatedAt: toIso(row.profile_updated_at),
      })),
    };
  }

  /**
   * The account behind a user id, or null.
   *
   * The read route and the write route each call this first, and the
   * reason is that without it the failures the operator has to tell
   * apart arrive as the same answer. A user id that belongs to nobody
   * and a user id whose owner has never opened the baseline form alike
   * reach `patient_profiles` and find nothing — `getProfileByUserId`
   * returns null and `ensureProfileForUser` raises
   * 「Patient profile not found」. With this lookup in front,
   * 「查无此账号」is a 404 and「有账号，没填过」is a 200 with a null
   * profile, which are different things to do next about.
   *
   * It is also where the record view's account block comes from: the
   * phone number the operator is confirming against the caller on the
   * line lives on `app_users`, not on the profile.
   */
  async getAccount(userId: string): Promise<AdminAccountDTO | null> {
    const result = await this.pool.query(
      `SELECT id, phone_number, email, role, is_active, created_at
         FROM app_users
        WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      userId: row.id,
      phoneNumber: row.phone_number,
      email: row.email ?? null,
      role: row.role,
      isActive: Boolean(row.is_active),
      createdAt: toIso(row.created_at) ?? '',
    };
  }

  /** See AdminStoredProfile for why this reads the column directly
   *  instead of going through either profile-service read. Null when
   *  the account exists but has never opened the baseline form. */
  async getStoredProfile(userId: string): Promise<AdminStoredProfile | null> {
    const result = await this.pool.query(
      `SELECT id, full_name, preferred_name, patient_code, region_city, updated_at,
              baseline_payload
         FROM patient_profiles
        WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;

    const payload = row.baseline_payload;
    return {
      profileId: row.id,
      fullName: row.full_name ?? null,
      preferredName: row.preferred_name ?? null,
      patientCode: row.patient_code ?? null,
      regionLabel: row.region_city ?? null,
      updatedAt: toIso(row.updated_at) ?? '',
      baselinePayload:
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null,
    };
  }

  /** How many rows the full export would produce. Read before the
   *  confirmation phrase is built, so the operator confirms against the
   *  size of the file they are actually about to take. */
  async countExportableProfiles(): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      'SELECT COUNT(*)::text AS total FROM patient_profiles',
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  /**
   * Every patient profile, with per-kind record counts, for the full
   * CSV.
   *
   * The counts are one grouped query per kind, UNION ALLed into a
   * single round trip and keyed by `profile_id` in memory, rather than
   * a correlated subquery per kind in the row SELECT: the correlated
   * form re-runs every count once per patient, so its cost grows with
   * patients × kinds while this one is one sequential aggregate per
   * kind whatever the cohort size.
   *
   * The `deleted_at IS NULL` filters mirror `getProfileByUserId` and
   * `FallsService`. Without them the CSV would count records the
   * operator cannot see in the record view, and a retracted fall would
   * be back in the cohort's fall count.
   */
  async listExportRows(limit: number): Promise<AdminExportRow[]> {
    const rowsResult = await this.pool.query(
      `SELECT u.id AS user_id, u.phone_number, u.email, u.role AS account_role,
              u.is_active AS account_is_active, u.created_at AS account_created_at,
              p.id AS profile_id, p.patient_code, p.full_name, p.preferred_name,
              p.date_of_birth, p.gender, p.height_cm, p.weight_kg, p.blood_type,
              p.contact_phone, p.contact_email, p.primary_physician,
              p.region_province, p.region_city, p.region_district,
              p.diagnosis_stage, p.diagnosis_date, p.genetic_mutation, p.notes,
              p.baseline_payload,
              p.ai_consent_personal, p.ai_consent_third_party, p.ai_consent_precise_values,
              p.clinical_trial_consent, p.data_donation_consent,
              p.hospital_sync_consent, p.community_share_consent,
              p.created_at AS profile_created_at, p.updated_at AS profile_updated_at
         FROM patient_profiles p
         JOIN app_users u ON u.id = p.user_id
        ORDER BY p.created_at, p.id
        LIMIT $1`,
      [limit],
    );

    const countsResult = await this.pool.query<{
      kind: AdminExportRecordKind;
      profile_id: string;
      n: string;
    }>(
      `  SELECT 'measurements' AS kind, profile_id, COUNT(*)::text AS n
           FROM patient_measurements GROUP BY profile_id
 UNION ALL SELECT 'function_tests', profile_id, COUNT(*)::text
           FROM patient_function_tests WHERE deleted_at IS NULL GROUP BY profile_id
 UNION ALL SELECT 'symptom_scores', profile_id, COUNT(*)::text
           FROM patient_symptom_scores WHERE deleted_at IS NULL GROUP BY profile_id
 UNION ALL SELECT 'daily_impacts', profile_id, COUNT(*)::text
           FROM patient_daily_impacts GROUP BY profile_id
 UNION ALL SELECT 'followup_events', profile_id, COUNT(*)::text
           FROM patient_followup_events WHERE deleted_at IS NULL GROUP BY profile_id
 UNION ALL SELECT 'activity_logs', profile_id, COUNT(*)::text
           FROM patient_activity_logs GROUP BY profile_id
 UNION ALL SELECT 'documents', profile_id, COUNT(*)::text
           FROM patient_documents GROUP BY profile_id
 UNION ALL SELECT 'medications', profile_id, COUNT(*)::text
           FROM patient_medications GROUP BY profile_id
 UNION ALL SELECT 'falls', profile_id, COUNT(*)::text
           FROM patient_falls WHERE deleted_at IS NULL GROUP BY profile_id
 UNION ALL SELECT 'instrument_administrations', profile_id, COUNT(*)::text
           FROM instrument_administrations GROUP BY profile_id`,
    );

    const counts = new Map<string, Record<AdminExportRecordKind, number>>();
    for (const row of countsResult.rows) {
      let entry = counts.get(row.profile_id);
      if (!entry) {
        entry = Object.fromEntries(ADMIN_EXPORT_RECORD_KINDS.map((kind) => [kind, 0])) as Record<
          AdminExportRecordKind,
          number
        >;
        counts.set(row.profile_id, entry);
      }
      entry[row.kind] = Number(row.n);
    }

    return rowsResult.rows.map((row) => ({
      userId: row.user_id,
      phoneNumber: row.phone_number,
      email: row.email ?? null,
      accountRole: row.account_role,
      accountIsActive: Boolean(row.account_is_active),
      accountCreatedAt: row.account_created_at,
      profileId: row.profile_id,
      patientCode: row.patient_code ?? null,
      fullName: row.full_name ?? null,
      preferredName: row.preferred_name ?? null,
      dateOfBirth: row.date_of_birth ?? null,
      gender: row.gender ?? null,
      heightCm: row.height_cm ?? null,
      weightKg: row.weight_kg ?? null,
      bloodType: row.blood_type ?? null,
      contactPhone: row.contact_phone ?? null,
      contactEmail: row.contact_email ?? null,
      primaryPhysician: row.primary_physician ?? null,
      regionProvince: row.region_province ?? null,
      regionCity: row.region_city ?? null,
      regionDistrict: row.region_district ?? null,
      diagnosisStage: row.diagnosis_stage ?? null,
      diagnosisDate: row.diagnosis_date ?? null,
      geneticMutation: row.genetic_mutation ?? null,
      notes: row.notes ?? null,
      baselinePayload: row.baseline_payload ?? null,
      aiConsentPersonal: Boolean(row.ai_consent_personal),
      aiConsentThirdParty: Boolean(row.ai_consent_third_party),
      aiConsentPreciseValues: Boolean(row.ai_consent_precise_values),
      clinicalTrialConsent: Boolean(row.clinical_trial_consent),
      dataDonationConsent: Boolean(row.data_donation_consent),
      hospitalSyncConsent: Boolean(row.hospital_sync_consent),
      communityShareConsent: Boolean(row.community_share_consent),
      profileCreatedAt: row.profile_created_at,
      profileUpdatedAt: row.profile_updated_at,
      counts:
        counts.get(row.profile_id) ??
        (Object.fromEntries(ADMIN_EXPORT_RECORD_KINDS.map((kind) => [kind, 0])) as Record<
          AdminExportRecordKind,
          number
        >),
    }));
  }

  /**
   * The second audit row for the full export, written BEFORE the file
   * is built and refused loudly if it cannot be written.
   *
   * `requireAdmin` already wrote an `admin.export` row for this
   * request, carrying the fields §B2 asks for. This row carries the
   * facts that make the most dangerous action in the product
   * reconstructible afterwards and that the middleware's fixed payload
   * has no room for: how many patients were in the file, what the file
   * was called, and that this was the whole cohort rather than one
   * patient (`scope`).
   *
   * Repeating an `event_type` within one request is deliberate here:
   * `ADMIN_AUDIT_EVENTS` is fixed by require-admin.ts and has no
   * `admin.export_all` member, so `scope` is the discriminator a query
   * filters on
   * (`event_payload->>'scope' = 'all_patients'`). The path is a second,
   * weaker discriminator — weaker because renaming the route silently
   * changes it.
   */
  async recordFullExportAudit(entry: {
    adminUserId: string;
    path: string;
    method: string;
    patientCount: number;
    fileName: string;
  }): Promise<void> {
    // Same statement shape as require-admin.ts, event type included:
    // one insert form for `admin.*` rows means a reader (and a test)
    // does not have to know which writer produced a row to
    // find its event type.
    await this.pool.query(
      `INSERT INTO audit_logs (event_type, event_payload)
       VALUES ($1, $2::jsonb)`,
      [
        'admin.export',
        JSON.stringify({
          adminUserId: entry.adminUserId,
          targetUserId: null,
          path: entry.path,
          method: entry.method,
          scope: 'all_patients',
          patientCount: entry.patientCount,
          fileName: entry.fileName,
        }),
      ],
    );
  }

  async getCorpusStatus(): Promise<AdminCorpusStatus> {
    const [totals, models] = await Promise.all([
      this.pool.query<{
        chunk_count: string;
        source_file_count: string;
        unembedded_chunk_count: string;
        oldest_updated_at: Date | null;
        newest_updated_at: Date | null;
      }>(
        `SELECT COUNT(*)::text                                     AS chunk_count,
                COUNT(DISTINCT source_file)::text                  AS source_file_count,
                COUNT(*) FILTER (WHERE embedding IS NULL)::text    AS unembedded_chunk_count,
                MIN(updated_at)                                    AS oldest_updated_at,
                MAX(updated_at)                                    AS newest_updated_at
           FROM kb_chunks`,
      ),
      this.pool.query<{ embed_model: string; chunk_count: string }>(
        `SELECT embed_model, COUNT(*)::text AS chunk_count
           FROM kb_chunks
          GROUP BY embed_model
          ORDER BY COUNT(*) DESC, embed_model`,
      ),
    ]);

    const row = totals.rows[0];
    return {
      chunkCount: Number(row?.chunk_count ?? 0),
      sourceFileCount: Number(row?.source_file_count ?? 0),
      unembeddedChunkCount: Number(row?.unembedded_chunk_count ?? 0),
      embedModels: models.rows.map((model) => ({
        embedModel: model.embed_model,
        chunkCount: Number(model.chunk_count),
      })),
      oldestUpdatedAt: toIso(row?.oldest_updated_at ?? null),
      newestUpdatedAt: toIso(row?.newest_updated_at ?? null),
    };
  }

  /**
   * Documents whose OCR did not produce a usable result.
   *
   * The `processing` clause is the reason this is a query and not a
   * `WHERE status = 'parse_failed'`: a row left in `processing` by a
   * job that died with its process is stuck, but nothing has marked it
   * — the sweep in profile.routes.ts only runs when this process has no
   * OCR jobs in flight, so on a busy instance a stranded row can sit
   * there for hours while the patient's screen spins. It is included
   * here on the same age test the sweep uses (`uploaded_at` older than
   * `stuckAfterMinutes`) so the queue shows the backlog that exists
   * rather than the backlog that has been labelled.
   *
   * `title` and `file_name` are NOT selected. They are patient-typed
   * and routinely hold a name or a hospital; the queue is a work list
   * and `documentType` plus the id is what acting on one needs.
   */
  async getParseFailureQueue(options: {
    limit: number;
    stuckAfterMinutes: number;
  }): Promise<AdminParseFailureQueue> {
    const result = await this.pool.query(
      `SELECT d.id            AS document_id,
              p.user_id       AS user_id,
              d.document_type AS document_type,
              d.status        AS status,
              d.uploaded_at   AS uploaded_at
         FROM patient_documents d
         JOIN patient_profiles p ON p.id = d.profile_id
        WHERE d.status IN ('parse_failed', 'failed')
           OR (d.status = 'processing'
               AND d.uploaded_at < NOW() - ($1 || ' minutes')::interval)
        ORDER BY d.uploaded_at DESC
        LIMIT $2`,
      [String(options.stuckAfterMinutes), options.limit],
    );

    return {
      items: result.rows.map((row) => ({
        documentId: row.document_id,
        userId: row.user_id,
        documentType: row.document_type,
        status: row.status,
        uploadedAt: toIso(row.uploaded_at) ?? '',
      })),
      atCap: result.rows.length >= options.limit,
      limit: options.limit,
      stuckAfterMinutes: options.stuckAfterMinutes,
    };
  }

  async getAiUsage(windowDays: number): Promise<AdminAiUsage> {
    const result = await this.pool.query<{
      status: string;
      calls: string;
      avg_latency_ms: string | null;
    }>(
      `SELECT status,
              COUNT(*)::text        AS calls,
              AVG(latency_ms)::text AS avg_latency_ms
         FROM ai_prompt_audit
        WHERE created_at >= NOW() - ($1 || ' days')::interval
        GROUP BY status
        ORDER BY status`,
      [String(windowDays)],
    );

    const byStatus = result.rows.map((row) => ({
      status: row.status,
      calls: Number(row.calls),
      avgLatencyMs: row.avg_latency_ms === null ? null : Math.round(Number(row.avg_latency_ms)),
    }));

    const callsFor = (status: string) =>
      byStatus.find((entry) => entry.status === status)?.calls ?? 0;
    const totalCalls = byStatus.reduce((sum, entry) => sum + entry.calls, 0);

    // DENY-LIST, NOT ALLOW-LIST, and that is the whole point of the
    // arithmetic below. `consent_denied` is the one status excluded,
    // by name; `success` is the one status that counts as a success;
    // EVERYTHING ELSE IS A FAILURE, including a status this build has
    // never heard of. `ai_prompt_audit.status` has no CHECK and
    // `AuditStatus` (ai-agents/audit/types.ts) is a closed union
    // today, so a `timeout` added next year would otherwise appear in
    // `byStatus` and in neither the numerator nor the denominator —
    // the dashboard would report an unchanged failure rate while the
    // calls failed, on the page an operator opens to find that out.
    const attempted = totalCalls - callsFor('consent_denied');
    const failed = attempted - callsFor('success');

    return {
      windowDays,
      retentionDays: AUDIT_RETENTION_DAYS,
      totalCalls,
      byStatus,
      failureRate: attempted === 0 ? null : failed / attempted,
    };
  }
}
