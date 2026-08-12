import { z } from 'zod';
import { FALL_ACTIVITIES, FALL_LOCATIONS } from '../profile.constants.js';

/**
 * Request schemas for the falls diary.
 *
 * ONE REQUIRED FIELD, AND THAT IS THE POINT
 *
 * `occurredOn` is required; everything else is optional. FSHD takes
 * reaching, arm elevation and sustained grip first, and a fall is
 * recorded by someone who has just been on the floor. If saving costs
 * six answers, the fall does not get recorded, and an unrecorded fall
 * is worth less to that patient than a fall with five blank fields.
 *
 * NO FREE TEXT ANYWHERE BELOW, and none may be added. The whole reason
 * this table exists is that the AI retriever's field allowlist refuses
 * patient-typed columns, so a fall described in prose reaches the
 * database and reaches nothing else. Every optional field here is a
 * closed enum or a boolean, which is what lets the summary built from
 * them be handed to a model. A `notes` field would recreate exactly
 * the problem migration 023 was written to solve — and it would
 * recreate it invisibly, because the field would still save.
 */

/**
 * A calendar date, `YYYY-MM-DD`, not in the future.
 *
 * WHY A DATE AND NOT A TIMESTAMP: see migration 023. A fall is
 * remembered as a day, and a synthesised midnight moves it across the
 * date line for anyone reading in another timezone.
 *
 * WHY TOMORROW IS ACCEPTED: the bound has to be checked against
 * something, and the server's clock is not the patient's. A fall at
 * 09:00 Beijing on the 6th is 01:00 UTC on the 6th — fine — but a
 * client whose own clock or locale is slightly ahead can legitimately
 * send a date the server has not reached yet. Rejecting it would fail
 * the save for a real fall. One day of tolerance admits nothing worth
 * defending against (a patient has no incentive to post-date their own
 * fall) and refuses the actual failure mode this guard is for: a
 * date-picker bug or a fat-fingered year sending 2028, which would sit
 * in the record forever as a fall that never happened.
 */
export const fallDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
  .refine(
    (value) => {
      const parsed = Date.parse(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed)) return false;
      // Round-trip: Date.parse accepts 2026-02-31 and silently rolls it
      // to March 3rd. A date the calendar does not have must be a 400,
      // not a fall filed in the wrong month.
      return new Date(parsed).toISOString().slice(0, 10) === value;
    },
    { message: '不是一个真实存在的日期' },
  )
  .refine((value) => Date.parse(`${value}T00:00:00Z`) <= Date.now() + 24 * 60 * 60 * 1000, {
    message: '跌倒日期不能晚于今天',
  });

export const createFallSchema = z.object({
  occurredOn: fallDateString,
  activity: z.enum(FALL_ACTIVITIES).optional().nullable(),
  location: z.enum(FALL_LOCATIONS).optional().nullable(),
  handsFull: z.boolean().optional().nullable(),
  /** True when the patient got back up on their own. The clinically
   *  load-bearing value is `false`. */
  gotUpUnaided: z.boolean().optional().nullable(),
  injured: z.boolean().optional().nullable(),
});
export type CreateFallInput = z.infer<typeof createFallSchema>;

/**
 * Window for the list and summary reads, in days.
 *
 * Clamped to the same 730-day ceiling the followup retriever uses so
 * 病程管理, the diary screen and the assistant cannot disagree about
 * how far back「最近」reaches.
 */
export const fallsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(730).optional(),
});
export type FallsQuery = z.infer<typeof fallsQuerySchema>;

export const fallIdParamsSchema = z.object({
  id: z.string().uuid(),
});
