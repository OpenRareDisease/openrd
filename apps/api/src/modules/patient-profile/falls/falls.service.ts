import type { Pool, PoolClient } from 'pg';
import type { CreateFallInput } from './falls.schema.js';
import {
  FALL_DIARY_SQL,
  FALL_HISTORY_SQL,
  isFallActivity,
  isFallLocation,
  type FallDiaryRow,
  type FallHistoryRow,
} from './falls.sql.js';
import { buildFallsSummary, type FallsSummary } from './falls.summary.js';
import type { AppLogger } from '../../../config/logger.js';
import { AppError } from '../../../utils/app-error.js';
import type { FallActivity, FallLocation } from '../profile.constants.js';

/**
 * The falls diary's data access.
 *
 * Kept out of PatientProfileService for the same reason the instrument
 * engine is: that class is three thousand lines across a dozen
 * concerns, and falls have an invariant none of the rest of it has —
 * every diary entry is written together with a patient_followup_events
 * twin, in one transaction, or not at all. Mixed into a service whose
 * other write methods are single statements, that pairing is one
 * well-meaning refactor away from being dropped, and the day it is
 * dropped falls silently stop appearing on the 病程时间线.
 */

/** Default look-back for the diary and the passport count. Matches the
 *  followup retriever's DEFAULT_WINDOW_DAYS so 「最近」 means the same
 *  number of days on every screen that says it. */
export const DEFAULT_FALLS_WINDOW_DAYS = 180;

/**
 * Rows read per request.
 *
 * A patient falling daily for two years produces ~730 rows, and the
 * summary only ever needs counts — but reading an unbounded set to
 * count it is the shape of bug MAX_ROWS_PER_SERIES was added to the
 * retriever to fix. 400 covers a fall every other day across the
 * 730-day ceiling. When it does bite, `FallsSummary.atCap` is true and
 * the quarterly comparison is suppressed rather than computed over a
 * list whose OLDEST end was the part that got cut — see refusal (3) in
 * falls.summary.ts.
 */
export const MAX_FALL_ROWS = 400;

export interface FallDTO {
  id: string;
  /** `YYYY-MM-DD`. A date, never a timestamp — see migration 023. */
  occurredOn: string;
  daysAgo: number;
  /** `null` means the patient did not fill this in. It never means
   *  「没有」, and no consumer may render it as one. */
  activity: FallActivity | null;
  location: FallLocation | null;
  handsFull: boolean | null;
  gotUpUnaided: boolean | null;
  injured: boolean | null;
  createdAt: string;
}

export interface FallsListResult {
  falls: FallDTO[];
  /**
   * Computed over the FULL history (diary + un-mirrored followup
   * events), not over `falls`. `summary.total - falls.length` is how
   * many falls exist that this list cannot show, and the screen is
   * expected to say so.
   */
  summary: FallsSummary;
  windowDays: number;
}

interface Deps {
  pool: Pool;
  logger: AppLogger;
}

const toTimestampString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/**
 * Narrow the two enum columns on the way OUT of the database, not just
 * on the way in.
 *
 * The Zod schema and the CHECK constraints both guard the write path,
 * so a value outside the enum should be impossible. "Should be
 * impossible" is what the allowlist in the AI retriever also said about
 * `unit` before migration 015. A row written by a support script, or
 * surviving a rolled-back constraint, resolves to null here rather than
 * being handed to a screen that has no label for it.
 */
const narrowActivity = (value: string | null): FallActivity | null =>
  isFallActivity(value) ? value : null;
const narrowLocation = (value: string | null): FallLocation | null =>
  isFallLocation(value) ? value : null;

const toFallDTO = (row: FallDiaryRow): FallDTO => ({
  id: row.id,
  occurredOn: row.occurred_on,
  daysAgo: Math.max(0, row.fall_day_age),
  activity: narrowActivity(row.activity),
  location: narrowLocation(row.location),
  handsFull: row.hands_full,
  gotUpUnaided: row.got_up_unaided,
  injured: row.injured,
  createdAt: toTimestampString(row.created_at),
});

export class FallsService {
  private readonly pool: Pool;
  private readonly logger: AppLogger;

  constructor(deps: Deps) {
    this.pool = deps.pool;
    this.logger = deps.logger;
  }

  /**
   * Record one fall.
   *
   * TWO ROWS, ONE TRANSACTION. The diary entry is what makes a fall
   * countable and answerable; the patient_followup_events twin is what
   * keeps it on the 病程时间线 the patient already reads. Writing only
   * the first would delete falls from a screen that has been showing
   * them, and writing only the second is where this feature started.
   *
   * The event carries NO free text. There is nothing to put there —
   * every fact the patient gave us is a column on the diary row — and
   * composing a sentence to fill it would put words in a patient's
   * record that the patient did not write.
   */
  async recordFall(userId: string, input: CreateFallInput): Promise<FallDTO> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const profileId = await this.resolveProfileId(client, userId);

      // Noon rather than midnight, deliberately. `occurred_at` is a
      // TIMESTAMPTZ and the diary only knows the day, so SOME time has
      // to be invented; noon is the one choice that still reads back
      // as the same calendar date from any timezone the row might be
      // rendered in. Midnight is half a day from being wrong.
      const eventResult = await client.query<{ id: string }>(
        `INSERT INTO patient_followup_events (profile_id, event_type, occurred_at)
         VALUES ($1, 'fall', ($2::date + INTERVAL '12 hours')::timestamptz)
         RETURNING id`,
        [profileId, input.occurredOn],
      );
      const originEventId = eventResult.rows[0]?.id ?? null;
      if (!originEventId) {
        // RETURNING on a successful single-row INSERT always yields a
        // row. Reaching here means the statement did something other
        // than what it says, and continuing would write a diary entry
        // with no timeline twin — the exact state the down migration
        // warns is unrecoverable.
        throw new AppError('Failed to record the fall', 500);
      }

      const fallResult = await client.query<FallDiaryRow>(
        `INSERT INTO patient_falls (
           profile_id, occurred_on, activity, location,
           hands_full, got_up_unaided, injured, origin_event_id
         )
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)
         RETURNING id,
                   to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on,
                   ((NOW() AT TIME ZONE 'Asia/Shanghai')::date - occurred_on)::int AS fall_day_age,
                   activity, location, hands_full, got_up_unaided, injured, created_at`,
        [
          profileId,
          input.occurredOn,
          input.activity ?? null,
          input.location ?? null,
          input.handsFull ?? null,
          input.gotUpUnaided ?? null,
          input.injured ?? null,
          originEventId,
        ],
      );

      await client.query('COMMIT');
      return toFallDTO(fallResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The diary screen: the entries themselves plus a summary computed
   * over everything, including the falls that have no diary entry.
   */
  async listFalls(userId: string, windowDays?: number): Promise<FallsListResult> {
    const window = this.clampWindow(windowDays);
    const [diaryResult, summary] = await Promise.all([
      this.pool.query<FallDiaryRow>(`${FALL_DIARY_SQL}\n       LIMIT ${MAX_FALL_ROWS}`, [
        userId,
        String(window),
      ]),
      this.getFallsSummary(userId, window),
    ]);

    return {
      falls: diaryResult.rows.map(toFallDTO),
      summary,
      windowDays: window,
    };
  }

  /**
   * The quarterly count the clinical passport shows.
   *
   * Reads the full history, so a patient whose falls were all logged
   * through the old event route still gets a real number rather than a
   * zero that would read as「今年没摔过」.
   */
  async getFallsSummary(userId: string, windowDays?: number): Promise<FallsSummary> {
    const window = this.clampWindow(windowDays);
    const result = await this.pool.query<FallHistoryRow>(
      `SELECT * FROM (${FALL_HISTORY_SQL}
      ) history
       ORDER BY occurred_at DESC
       LIMIT ${MAX_FALL_ROWS}`,
      [userId, String(window)],
    );
    const rows = result.rows ?? [];
    return buildFallsSummary(rows, { atCap: rows.length >= MAX_FALL_ROWS });
  }

  /**
   * Retract one fall.
   *
   * Soft delete, and it takes the timeline twin with it. Retracting
   * only the diary row would leave the fall on the 病程时间线 and in
   * the retriever's count (through the un-mirrored-event branch), so
   * the patient would tap 删除, watch the entry disappear, and still be
   * told they fell that week.
   */
  async deleteFall(userId: string, fallId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ origin_event_id: string | null }>(
        `UPDATE patient_falls pf
            SET deleted_at = NOW()
           FROM patient_profiles pp
          WHERE pp.id = pf.profile_id
            AND pp.user_id = $1
            AND pf.id = $2
            AND pf.deleted_at IS NULL
        RETURNING pf.origin_event_id`,
        [userId, fallId],
      );

      if (!result.rowCount) {
        // Same 404 for「不是你的」and「已经删过了」. Distinguishing them
        // would turn this endpoint into an oracle for whether a given
        // uuid is somebody's fall record.
        throw new AppError('Fall record not found', 404);
      }

      const originEventId = result.rows[0]?.origin_event_id ?? null;
      if (originEventId) {
        await client.query(
          `UPDATE patient_followup_events
              SET deleted_at = NOW()
            WHERE id = $1
              AND deleted_at IS NULL`,
          [originEventId],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 1..730, defaulting to DEFAULT_FALLS_WINDOW_DAYS.
   *
   * The Zod schema clamps the same range on the query string; this
   * exists because getFallsSummary is also called from code paths that
   * never went through a request parse, and a window of NaN silently
   * becomes `NaN days` in the interval literal — which Postgres
   * rejects with a 500 rather than answering.
   */
  private clampWindow(windowDays?: number): number {
    if (typeof windowDays !== 'number' || !Number.isFinite(windowDays)) {
      return DEFAULT_FALLS_WINDOW_DAYS;
    }
    return Math.min(730, Math.max(1, Math.floor(windowDays)));
  }

  private async resolveProfileId(client: PoolClient, userId: string): Promise<string> {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM patient_profiles WHERE user_id = $1',
      [userId],
    );
    if (!result.rowCount) {
      this.logger.warn({ userId }, 'falls: no patient profile for user');
      throw new AppError('Patient profile not found', 404);
    }
    return result.rows[0].id;
  }
}
