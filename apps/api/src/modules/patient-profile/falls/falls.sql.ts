/**
 * The one SQL definition of「这个人跌倒过几次」.
 *
 * Two callers read falls — the falls endpoints in this folder and the
 * followup retriever that answers「我最近跌倒是不是更频繁了」— and they
 * must agree to the row, because they are two renderings of one
 * question. A patient shown「本季度 3 次」in 病程管理's 跌倒记录 block
 * and told「你最近记录了 5 次」by the assistant has been given two facts
 * about their own body and no way to tell which is real. So the query
 * lives here once and both import it.
 *
 * WHY IT IS A UNION AND NOT A SELECT
 * ----------------------------------
 * A fall can be in the database two ways:
 *
 *   1. `patient_falls` — the diary. Written by falls.service.ts, which
 *      writes a patient_followup_events twin in the same transaction
 *      and stores its id in `origin_event_id`.
 *   2. `patient_followup_events` with `event_type = 'fall'` — the
 *      original route, still reachable through POST /me/followup-events
 *      and still the only route for anything written before migration
 *      023's back-fill ran.
 *
 * Reading only (1) loses every fall logged through the old route.
 * Reading (1) and (2) naively counts every linked pair twice, and a
 * doubled fall count reads as deterioration that did not happen. So
 * branch (2) excludes any event that already has a live diary entry
 * pointing at it, and the two branches together are exactly the set of
 * distinct falls.
 *
 * RETRACTION TRAVELS BOTH WAYS
 * ----------------------------
 * A patient can retract either row: the diary entry through
 * DELETE /me/falls/:id, or the event through the existing
 * DELETE /me/records/followup_event/:id, which knows nothing about
 * this table. So a live diary row requires its origin event to still
 * be live as well — otherwise retracting a fall from the timeline
 * would leave it standing in the diary, in the one place the patient
 * did not think to look. That rule is LIVE_DIARY_PREDICATE, written
 * once and shared by both projections below.
 *
 * DAY PRECISION
 * -------------
 * `patient_falls.occurred_on` is a DATE (see migration 023 for why).
 * Its age in days is therefore computed in SQL, in Asia/Shanghai, and
 * shipped as `fall_day_age` rather than derived in JS from a midnight
 * timestamp — `new Date('2026-08-05')` is midnight UTC, so a fall
 * recorded today would come back as「1 天前」for anyone east of
 * Greenwich. The legacy branch computes the same field the same way so
 * the two are comparable. The date itself goes through `to_char` for
 * the same class of reason: node-postgres parses a DATE into a JS Date
 * at LOCAL midnight, which is a timezone shift waiting to happen on
 * the way back out as JSON.
 *
 * The word for the patient's free-text event column does not appear in
 * this file, and must not. The retriever has a fence asserting that no
 * SQL it sends mentions it.
 */

import { FALL_ACTIVITIES, FALL_LOCATIONS } from '../profile.constants.js';

/**
 * What makes a diary row readable: not retracted, inside the window,
 * and — when it mirrors a followup event — that event not retracted
 * either.
 *
 * Parameters are `$1` user id and `$2` window in days as a string, the
 * same `($2 || ' days')::interval` idiom the rest of the followup
 * queries use.
 */
const LIVE_DIARY_PREDICATE = `pp.user_id = $1
         AND pf.deleted_at IS NULL
         AND pf.occurred_on >= (NOW() - ($2 || ' days')::interval)::date
         AND (
           pf.origin_event_id IS NULL
           OR EXISTS (
             SELECT 1
               FROM patient_followup_events oe
              WHERE oe.id = pf.origin_event_id
                AND oe.deleted_at IS NULL
           )
         )`;

/** Age in whole days, Asia/Shanghai. See DAY PRECISION above. */
const DAY_AGE_FROM_DATE = `((NOW() AT TIME ZONE 'Asia/Shanghai')::date - pf.occurred_on)::int`;

/**
 * One distinct fall, as the retriever and the summary see it.
 *
 * `fall_activity` / `fall_location` are typed as plain `string | null`
 * rather than the enum unions: they come back from a driver, not from
 * the type system, and the CHECK constraints in migration 023 are what
 * make them well-formed. `isFallActivity` / `isFallLocation` below are
 * the narrowing every read path actually goes through.
 */
export interface FallHistoryRow {
  /** Always `'fall'`. Present so the row can flow through the
   *  retriever's event tally beside real event rows. */
  event_type: string;
  /** Only ever set on a legacy event row; the diary has no severity
   *  field, because a graded injury scale this app cannot verify would
   *  be a fabricated instrument sitting next to two published ones. */
  severity: string | null;
  occurred_at: string | Date;
  /** Whole days between the fall and today, Asia/Shanghai. */
  fall_day_age: number | null;
  fall_activity: string | null;
  fall_location: string | null;
  fall_hands_full: boolean | null;
  fall_got_up_unaided: boolean | null;
  fall_injured: boolean | null;
}

/** One diary entry, as the diary screen sees it. */
export interface FallDiaryRow {
  id: string;
  occurred_on: string;
  fall_day_age: number;
  activity: string | null;
  location: string | null;
  hands_full: boolean | null;
  got_up_unaided: boolean | null;
  injured: boolean | null;
  created_at: string | Date;
}

export const isFallActivity = (value: unknown): value is (typeof FALL_ACTIVITIES)[number] =>
  typeof value === 'string' && (FALL_ACTIVITIES as readonly string[]).includes(value);

export const isFallLocation = (value: unknown): value is (typeof FALL_LOCATIONS)[number] =>
  typeof value === 'string' && (FALL_LOCATIONS as readonly string[]).includes(value);

/**
 * The columns every branch of the history union must project, in order.
 *
 * Exported so the retriever's event branch — which selects real event
 * rows, not falls — can pad itself to the same shape without the two
 * lists drifting apart. A UNION whose branches disagree by one column
 * is a runtime error; a UNION whose branches agree in count and
 * disagree in ORDER is a silent data swap.
 */
export const FALL_HISTORY_COLUMNS = [
  'event_type',
  'severity',
  'occurred_at',
  'fall_day_age',
  'fall_activity',
  'fall_location',
  'fall_hands_full',
  'fall_got_up_unaided',
  'fall_injured',
] as const;

/**
 * Every distinct fall for one user inside a window.
 *
 * Not ordered and not limited — it is a fragment. Both callers wrap it,
 * and both must apply their own ORDER BY and LIMIT.
 */
export const FALL_HISTORY_SQL = `
      SELECT 'fall'::text                  AS event_type,
             NULL::text                    AS severity,
             pf.occurred_on::timestamptz   AS occurred_at,
             ${DAY_AGE_FROM_DATE}          AS fall_day_age,
             pf.activity                   AS fall_activity,
             pf.location                   AS fall_location,
             pf.hands_full                 AS fall_hands_full,
             pf.got_up_unaided             AS fall_got_up_unaided,
             pf.injured                    AS fall_injured
        FROM patient_falls pf
        JOIN patient_profiles pp ON pp.id = pf.profile_id
       WHERE ${LIVE_DIARY_PREDICATE}
      UNION ALL
      -- Falls logged through the original event route that no live
      -- diary entry mirrors. Without this branch a fall recorded on the
      -- old screen — or by a client this release does not update —
      -- silently stops being counted the day the diary ships.
      SELECT 'fall'::text                  AS event_type,
             fe.severity                   AS severity,
             fe.occurred_at                AS occurred_at,
             ((NOW() AT TIME ZONE 'Asia/Shanghai')::date
               - (fe.occurred_at AT TIME ZONE 'Asia/Shanghai')::date)::int
                                           AS fall_day_age,
             NULL::text                    AS fall_activity,
             NULL::text                    AS fall_location,
             NULL::boolean                 AS fall_hands_full,
             NULL::boolean                 AS fall_got_up_unaided,
             NULL::boolean                 AS fall_injured
        FROM patient_followup_events fe
        JOIN patient_profiles pp ON pp.id = fe.profile_id
       WHERE pp.user_id = $1
         AND fe.event_type = 'fall'
         AND fe.deleted_at IS NULL
         AND fe.occurred_at >= NOW() - ($2 || ' days')::interval
         AND NOT EXISTS (
           SELECT 1
             FROM patient_falls mirror
            WHERE mirror.origin_event_id = fe.id
              AND mirror.deleted_at IS NULL
         )`;

/**
 * The diary rows themselves — the editable, retractable records the
 * 跌倒记录 screen lists.
 *
 * Deliberately NOT the same set as FALL_HISTORY_SQL: a fall that
 * exists only as a followup event has no diary row to open, so it is
 * absent here and present there. The list endpoint returns the summary
 * alongside, computed over the full history, so the screen can say how
 * many falls it is not showing instead of quietly under-reporting.
 */
export const FALL_DIARY_SQL = `
      SELECT pf.id                                        AS id,
             to_char(pf.occurred_on, 'YYYY-MM-DD')        AS occurred_on,
             ${DAY_AGE_FROM_DATE}                         AS fall_day_age,
             pf.activity                                  AS activity,
             pf.location                                  AS location,
             pf.hands_full                                AS hands_full,
             pf.got_up_unaided                            AS got_up_unaided,
             pf.injured                                   AS injured,
             pf.created_at                                AS created_at
        FROM patient_falls pf
        JOIN patient_profiles pp ON pp.id = pf.profile_id
       WHERE ${LIVE_DIARY_PREDICATE}
       ORDER BY pf.occurred_on DESC, pf.created_at DESC`;
