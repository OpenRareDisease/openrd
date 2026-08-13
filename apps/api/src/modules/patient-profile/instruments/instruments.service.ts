import type { Pool, PoolClient } from 'pg';
import type { AppLogger } from '../../../config/logger.js';
import { AppError } from '../../../utils/app-error.js';
import type { AmbulationState } from '../profile.constants.js';
import type { InstrumentDefinition, InstrumentItemResponse } from './instrument.types.js';
import type { AdministrationListQuery, CreateAdministrationInput } from './instruments.schema.js';
import { CURRENT_INSTRUMENTS, findCurrentInstrument, findInstrumentVersion } from './registry.js';
import {
  VIGNOS_KEY,
  ambulationStateFromVignosGrade,
  vignosGradeImpliesWheelchair,
} from './vignos.js';

const toTimestampString = (value: Date | string | null): string => {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

/** Postgres NUMERIC comes back as a string from node-pg to protect
 *  precision. Every score in this module is a small ordinal, so the
 *  conversion is lossless — but it has to be explicit, or a grade of 3
 *  is serialised to the client as "3.000" and compared as a string. */
const toNumber = (value: unknown): number => Number(value);

export interface InstrumentCatalogueEntry {
  key: string;
  version: string;
  nameZh: string;
  descriptionZh: string;
  licenceStatus: string;
  sourceCitation: string;
  scoreMin: number;
  scoreMax: number;
  higherIsWorse: boolean;
  recallPeriod: string;
  adminMinutes: number;
  limitationsZh: readonly string[];
  selfReportEvidenceZh: string;
  items: ReadonlyArray<{
    code: string;
    version: string;
    promptZh: string;
    levels: ReadonlyArray<{ value: number; labelZh: string; sourceEn: string }>;
  }>;
}

export interface AdministrationDTO {
  id: string;
  instrumentKey: string;
  instrumentVersion: string;
  instrumentNameZh: string | null;
  rawScore: number;
  scoredValue: number;
  scoringMethod: string;
  completeness: number;
  assistedBy: string;
  source: string;
  supersedesId: string | null;
  supersededById: string | null;
  administeredAt: string;
  createdAt: string;
  /** The anchor the patient actually chose, resolved back from the
   *  version they answered against. A bare number on a screen is not
   *  something a patient can check against their own memory. */
  levelLabelZh: string | null;
  responses: Array<{
    itemCode: string;
    itemVersion: string;
    responseValue: number | null;
    skipped: boolean;
    notApplicable: boolean;
  }>;
}

export interface BaselineSyncResult {
  /** The state the Vignos grade implies, per ambulationStateFromVignosGrade. */
  ambulationState: AmbulationState;
  /** Whether the stored baseline was actually changed. */
  baselineUpdated: boolean;
  /** Whether a started_wheelchair followup event was recorded. */
  followupEventType: 'started_wheelchair' | null;
}

export interface RecordAdministrationResult {
  administration: AdministrationDTO;
  baselineSync: BaselineSyncResult | null;
}

interface Deps {
  pool: Pool;
  logger: AppLogger;
}

/**
 * The instrument engine's data access.
 *
 * Kept out of PatientProfileService on purpose. That class is 3,000
 * lines across a dozen unrelated concerns, and instruments have a
 * property none of the rest of it has: their rows are IMMUTABLE
 * (migration 022). Mixing an append-only table into a service whose
 * other methods routinely UPDATE is how the first well-meaning
 * "just fix the score" patch gets written.
 */
export class InstrumentsService {
  private readonly pool: Pool;
  private readonly logger: AppLogger;

  constructor(deps: Deps) {
    this.pool = deps.pool;
    this.logger = deps.logger;
  }

  /** The catalogue. Pure — served from the registry, not the DB.
   *
   *  The `instruments` table exists so the DB can enforce that an
   *  administration names a real (key, version) pair, and so an SQL
   *  export is self-describing. It is not the source of truth for
   *  anchor text: that lives in brooke.ts / vignos.ts next to the
   *  citation it was translated from, where a reviewer can see both at
   *  once. */
  listCatalogue(): InstrumentCatalogueEntry[] {
    return CURRENT_INSTRUMENTS.map((definition) => ({
      key: definition.key,
      version: definition.version,
      nameZh: definition.nameZh,
      descriptionZh: definition.descriptionZh,
      licenceStatus: definition.licenceStatus,
      sourceCitation: definition.sourceCitation,
      scoreMin: definition.scoreMin,
      scoreMax: definition.scoreMax,
      higherIsWorse: definition.higherIsWorse,
      recallPeriod: definition.recallPeriod,
      adminMinutes: definition.adminMinutes,
      limitationsZh: definition.limitationsZh,
      selfReportEvidenceZh: definition.selfReportEvidenceZh,
      items: definition.items.map((item) => ({
        code: item.code,
        version: item.version,
        promptZh: item.promptZh,
        levels: item.levels,
      })),
    }));
  }

  async recordAdministration(
    userId: string,
    input: CreateAdministrationInput,
  ): Promise<RecordAdministrationResult> {
    const definition = findCurrentInstrument(input.instrumentKey);
    if (!definition) {
      // Unreachable through the route (the Zod enum is built from the
      // registry), so this is the guard for a registry edit that
      // removed a key without removing it from the enum.
      throw new AppError('未知的量表', 400);
    }

    const responses: InstrumentItemResponse[] = input.responses.map((response) => ({
      itemCode: response.itemCode,
      responseValue: response.responseValue ?? null,
      skipped: response.skipped ?? false,
      notApplicable: response.notApplicable ?? false,
    }));

    // Score BEFORE opening a transaction. A refusal is a 400 about the
    // body, and there is nothing to roll back.
    const outcome = definition.score(responses);
    if (!outcome.ok) {
      throw new AppError(outcome.messageZh, 400, { reasonCode: outcome.reasonCode });
    }

    const client = await this.pool.connect();
    let txOpen = false;
    try {
      await client.query('BEGIN');
      txOpen = true;

      const profileId = await this.resolveProfileId(client, userId);

      if (input.supersedesId) {
        await this.assertSupersedable(client, profileId, input.supersedesId, definition.key);
      }

      const inserted = await client.query<{
        id: string;
        administered_at: Date;
        created_at: Date;
      }>(
        `INSERT INTO instrument_administrations (
           profile_id,
           instrument_key,
           instrument_version,
           raw_score,
           scored_value,
           scoring_method,
           completeness,
           assisted_by,
           source,
           supersedes_id,
           administered_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW()))
         RETURNING id, administered_at, created_at`,
        [
          profileId,
          definition.key,
          definition.version,
          outcome.score.rawScore,
          outcome.score.scoredValue,
          outcome.score.scoringMethod,
          outcome.score.completeness,
          input.assistedBy ?? 'none',
          input.source ?? 'self',
          input.supersedesId ?? null,
          input.administeredAt ?? null,
        ],
      );

      const administrationId = inserted.rows[0].id;

      // Item versions come from the definition, not from the request.
      // A client cannot be trusted to say which wording it rendered,
      // and this column is what a future re-scoring pass keys on.
      const itemVersionByCode = new Map(definition.items.map((item) => [item.code, item.version]));
      for (const response of responses) {
        await client.query(
          `INSERT INTO instrument_item_responses (
             administration_id, item_code, item_version, response_value, skipped, not_applicable
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            administrationId,
            response.itemCode,
            itemVersionByCode.get(response.itemCode) ?? definition.version,
            response.responseValue,
            response.skipped,
            response.notApplicable,
          ],
        );
      }

      let baselineSync: BaselineSyncResult | null = null;
      if (input.applyToBaseline && definition.key === VIGNOS_KEY) {
        baselineSync = await this.applyVignosToBaseline(
          client,
          profileId,
          outcome.score.scoredValue,
          input.administeredAt ?? null,
        );
      }

      await client.query('COMMIT');
      txOpen = false;

      const administration: AdministrationDTO = {
        id: administrationId,
        instrumentKey: definition.key,
        instrumentVersion: definition.version,
        instrumentNameZh: definition.nameZh,
        rawScore: outcome.score.rawScore,
        scoredValue: outcome.score.scoredValue,
        scoringMethod: outcome.score.scoringMethod,
        completeness: outcome.score.completeness,
        assistedBy: input.assistedBy ?? 'none',
        source: input.source ?? 'self',
        supersedesId: input.supersedesId ?? null,
        supersededById: null,
        administeredAt: toTimestampString(inserted.rows[0].administered_at),
        createdAt: toTimestampString(inserted.rows[0].created_at),
        levelLabelZh: labelForScore(definition, outcome.score.scoredValue),
        responses: responses.map((response) => ({
          itemCode: response.itemCode,
          itemVersion: itemVersionByCode.get(response.itemCode) ?? definition.version,
          responseValue: response.responseValue,
          skipped: response.skipped,
          notApplicable: response.notApplicable,
        })),
      };

      return { administration, baselineSync };
    } catch (error) {
      if (txOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          this.logger.warn({ rollbackError }, 'recordAdministration: ROLLBACK after error failed');
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listAdministrations(
    userId: string,
    query: AdministrationListQuery,
  ): Promise<AdministrationDTO[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const rows = await this.pool.query(
      `SELECT a.id,
              a.instrument_key,
              a.instrument_version,
              a.raw_score,
              a.scored_value,
              a.scoring_method,
              a.completeness,
              a.assisted_by,
              a.source,
              a.supersedes_id,
              (SELECT s.id FROM instrument_administrations s
                WHERE s.supersedes_id = a.id) AS superseded_by_id,
              a.administered_at,
              a.created_at
         FROM instrument_administrations a
         JOIN patient_profiles p ON p.id = a.profile_id
        WHERE p.user_id = $1
          AND ($2::text IS NULL OR a.instrument_key = $2)
          AND (
            $3::boolean
            OR NOT EXISTS (
              SELECT 1 FROM instrument_administrations s WHERE s.supersedes_id = a.id
            )
          )
        ORDER BY a.administered_at DESC, a.created_at DESC
        LIMIT $4 OFFSET $5`,
      [userId, query.instrumentKey ?? null, query.includeSuperseded ?? false, limit, offset],
    );

    return this.hydrate(rows.rows);
  }

  /**
   * The most recent LIVE (non-superseded) administration per
   * instrument. What a dashboard tile reads.
   *
   * Deliberately not "the latest score" flattened into one number:
   * upper-limb and lower-limb function diverge in FSHD, and one of
   * these two scales can sit at its floor for years while the other
   * moves. Two numbers, each labelled.
   *
   * DISTINCT ON rather than "fetch the last N and de-duplicate in
   * JavaScript", which is what this was first: a patient who has
   * recorded one scale far more often than the other pushes the
   * other's latest score past any fixed window, and the tile silently
   * goes blank for the instrument they have been neglecting — which is
   * precisely the one worth showing them.
   */
  async getSummary(userId: string): Promise<AdministrationDTO[]> {
    const rows = await this.pool.query(
      `SELECT DISTINCT ON (a.instrument_key)
              a.id,
              a.instrument_key,
              a.instrument_version,
              a.raw_score,
              a.scored_value,
              a.scoring_method,
              a.completeness,
              a.assisted_by,
              a.source,
              a.supersedes_id,
              NULL::uuid AS superseded_by_id,
              a.administered_at,
              a.created_at
         FROM instrument_administrations a
         JOIN patient_profiles p ON p.id = a.profile_id
        WHERE p.user_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM instrument_administrations s WHERE s.supersedes_id = a.id
          )
        ORDER BY a.instrument_key, a.administered_at DESC, a.created_at DESC`,
      [userId],
    );

    return this.hydrate(rows.rows);
  }

  /** Attach item responses and resolve each row's anchor against the
   *  version it was answered under. Shared by both read paths so the
   *  two cannot drift on how a stored row becomes a DTO. */
  private async hydrate(rows: Array<Record<string, unknown>>): Promise<AdministrationDTO[]> {
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id as string);
    const responseRows = await this.pool.query(
      `SELECT administration_id, item_code, item_version, response_value, skipped, not_applicable
         FROM instrument_item_responses
        WHERE administration_id = ANY($1::uuid[])
        ORDER BY item_code ASC`,
      [ids],
    );

    const responsesByAdministration = new Map<string, AdministrationDTO['responses']>();
    for (const row of responseRows.rows) {
      const list = responsesByAdministration.get(row.administration_id as string) ?? [];
      list.push({
        itemCode: row.item_code as string,
        itemVersion: row.item_version as string,
        responseValue: row.response_value === null ? null : toNumber(row.response_value),
        skipped: Boolean(row.skipped),
        notApplicable: Boolean(row.not_applicable),
      });
      responsesByAdministration.set(row.administration_id as string, list);
    }

    return rows.map((row) => {
      // Resolve the version the patient actually answered, not the
      // current one. This is the whole reason the registry is keyed by
      // (key, version): a row written against v1 must keep reading
      // back as v1 even after v2 ships.
      const definition = findInstrumentVersion(
        row.instrument_key as string,
        row.instrument_version as string,
      );
      const scoredValue = toNumber(row.scored_value);
      return {
        id: row.id as string,
        instrumentKey: row.instrument_key as string,
        instrumentVersion: row.instrument_version as string,
        instrumentNameZh: definition?.nameZh ?? null,
        rawScore: toNumber(row.raw_score),
        scoredValue,
        scoringMethod: row.scoring_method as string,
        completeness: toNumber(row.completeness),
        assistedBy: row.assisted_by as string,
        source: row.source as string,
        supersedesId: (row.supersedes_id as string | null) ?? null,
        supersededById: (row.superseded_by_id as string | null) ?? null,
        administeredAt: toTimestampString(row.administered_at as Date),
        createdAt: toTimestampString(row.created_at as Date),
        // null, not a fabricated label, when the stored version is not
        // in this build's registry (a rollback, or a row written by a
        // newer deploy). An unknown anchor is unknown.
        levelLabelZh: definition ? labelForScore(definition, scoredValue) : null,
        responses: responsesByAdministration.get(row.id as string) ?? [],
      };
    });
  }

  private async resolveProfileId(client: PoolClient, userId: string): Promise<string> {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM patient_profiles WHERE user_id = $1',
      [userId],
    );
    if (!result.rowCount) {
      throw new AppError('Patient profile not found', 404);
    }
    return result.rows[0].id;
  }

  /**
   * A correction may only replace THIS patient's administration of the
   * SAME instrument, and only one correction per row.
   *
   * Migration 022 enforces all three at the database level (a trigger
   * for the first two, a partial UNIQUE index for the third). This
   * check exists anyway, because the DB's answer to each of them is a
   * raised exception that surfaces as a 500 — and 「你要修正的那条记录
   * 不存在」 is something the patient can act on, while "Internal
   * server error" is not. The DB stays the authority; this is the
   * translation layer.
   */
  private async assertSupersedable(
    client: PoolClient,
    profileId: string,
    supersedesId: string,
    instrumentKey: string,
  ): Promise<void> {
    const prior = await client.query<{
      instrument_key: string;
      already_superseded: boolean;
    }>(
      `SELECT a.instrument_key,
              EXISTS (
                SELECT 1 FROM instrument_administrations s WHERE s.supersedes_id = a.id
              ) AS already_superseded
         FROM instrument_administrations a
        WHERE a.id = $1 AND a.profile_id = $2`,
      [supersedesId, profileId],
    );

    if (!prior.rowCount) {
      // Same 404 whether the row belongs to someone else or does not
      // exist: distinguishing them would confirm the existence of
      // another patient's record to whoever guessed the id.
      throw new AppError('要修正的记录不存在', 404);
    }
    if (prior.rows[0].instrument_key !== instrumentKey) {
      throw new AppError('不能用一个量表的结果去修正另一个量表的记录', 400);
    }
    if (prior.rows[0].already_superseded) {
      throw new AppError('这条记录已经被修正过了，请修正最新的那一条', 409);
    }
  }

  /**
   * 「把结果同步到我的档案」 for Vignos, and the wiring of
   * FOLLOWUP_EVENT_TYPES.started_wheelchair.
   *
   * WHAT IT WRITES
   *   - `baseline_payload.currentStatus.independentlyAmbulatory`, set
   *     to the state the chosen anchor states outright (see
   *     ambulationStateFromVignosGrade — the mapping adds no clinical
   *     judgement, it reads the published wording).
   *   - one `started_wheelchair` followup event, and ONLY when the
   *     patient selected grade 9, whose own text is "Is in a
   *     wheelchair", and only when the stored state was not already
   *     'unable'.
   *
   * WHAT IT REFUSES TO INFER
   *   The event's `occurred_at` is the administration date, and its
   *   description says so in as many words. This app does not know
   *   when the wheelchair started; it knows when the patient told us
   *   they use one. Dating the event at a guessed onset would put a
   *   fabricated date on a clinical timeline that a neurologist may
   *   later read as history.
   *
   *   Grade 8 ("stands in long leg braces, unable to walk") and grade
   *   10 ("confined to a bed") both map to 'unable' and neither
   *   produces the event: 8 says nothing about a wheelchair, and 10 is
   *   past it rather than the start of it.
   *
   * The whole thing runs inside the caller's transaction. A baseline
   * that says 'unable' with no administration behind it — or an
   * administration whose promised sync silently failed — is worse than
   * neither.
   */
  private async applyVignosToBaseline(
    client: PoolClient,
    profileId: string,
    grade: number,
    administeredAt: string | null,
  ): Promise<BaselineSyncResult | null> {
    const nextState = ambulationStateFromVignosGrade(grade);
    if (!nextState) return null;

    const current = await client.query<{ state: string | null }>(
      `SELECT baseline_payload #>> '{currentStatus,independentlyAmbulatory}' AS state
         FROM patient_profiles
        WHERE id = $1`,
      [profileId],
    );
    const previousState = current.rows[0]?.state ?? null;

    let baselineUpdated = false;
    if (previousState !== nextState) {
      // COALESCE + jsonb_set with create_missing: a patient who has
      // never filled in the baseline still has a profile row, and
      // jsonb_set on NULL returns NULL — which would silently do
      // nothing and report success.
      await client.query(
        `UPDATE patient_profiles
            SET baseline_payload = jsonb_set(
                  jsonb_set(
                    COALESCE(baseline_payload, '{}'::jsonb),
                    '{currentStatus}',
                    COALESCE(baseline_payload -> 'currentStatus', '{}'::jsonb),
                    true
                  ),
                  '{currentStatus,independentlyAmbulatory}',
                  to_jsonb($2::text),
                  true
                ),
                updated_at = NOW()
          WHERE id = $1`,
        [profileId, nextState],
      );
      baselineUpdated = true;
    }

    let followupEventType: 'started_wheelchair' | null = null;
    if (vignosGradeImpliesWheelchair(grade) && previousState !== 'unable') {
      await client.query(
        `INSERT INTO patient_followup_events (profile_id, event_type, occurred_at, description)
         VALUES ($1, 'started_wheelchair', COALESCE($2::timestamptz, NOW()), $3)`,
        [
          profileId,
          administeredAt,
          '根据本次 Vignos 下肢功能自评（第 9 级：使用轮椅）自动记录。日期为本次自评的日期，不代表开始使用轮椅的实际时间；如果知道大致时间，可以在随访记录里补充。',
        ],
      );
      followupEventType = 'started_wheelchair';
    }

    return { ambulationState: nextState, baselineUpdated, followupEventType };
  }
}

/** The anchor text for a scored value, when the value corresponds to a
 *  level of a single-item scale. Returns null rather than a nearest
 *  match: for a future multi-item instrument the summed score does not
 *  name any anchor, and inventing one would caption a number with a
 *  sentence the patient never read. */
const labelForScore = (definition: InstrumentDefinition, scoredValue: number): string | null => {
  if (definition.items.length !== 1) return null;
  const level = definition.items[0].levels.find((candidate) => candidate.value === scoredValue);
  return level?.labelZh ?? null;
};
