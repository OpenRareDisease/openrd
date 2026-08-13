/**
 * How precisely a milestone's date is actually known.
 *
 * THE PROBLEM. Wheelchair, non-invasive ventilation and AFO are the
 * three dated events a registry cares most about, and they are stored
 * in `patient_followup_events.occurred_at`, which is TIMESTAMPTZ NOT
 * NULL. That column has exactly one shape — an instant, to the
 * millisecond — and it has no way to say 「只知道是哪一年」. A patient
 * who started using a wheelchair "sometime in 2019" still produces a
 * row with a month, a day, an hour and a minute in it.
 *
 * THE THING WE MUST NOT DO. The tempting fix is to pin an unknown
 * month to January and an unknown day to the 1st, and move on. That
 * writes `2019-01-01` into a medical record as though someone had
 * observed it. A clinician reading a wheelchair start date of
 * 1 January will reasonably take it at face value, and no downstream
 * consumer can recover the fact that only the year was ever known.
 * That is a fabricated date, and this repository treats a fabricated
 * date in a medical record as the worst thing it can ship.
 *
 * WHAT THIS MODULE DOES INSTEAD. It refuses to claim a precision it
 * cannot support, and it reports two FACTS about the stored instant
 * that let a receiver judge for itself:
 *
 *   pinnedToYearStart   the stored instant is exactly the first
 *                       instant of its year, UTC
 *   pinnedToMonthStart  the stored instant is exactly the first
 *                       instant of its month, UTC
 *
 * Neither is a guess about what the patient meant — each is a
 * statement about what is in the column, which is all we have. They
 * are the shape a year-only or month-only answer takes once something
 * has pinned it, and a receiver that sees `pinnedToYearStart: true`
 * on a wheelchair milestone knows not to compute an age-at-wheelchair
 * in months from it.
 *
 * WHY `precision` IS ALWAYS 'unrecorded' TODAY. There is no precision
 * column. Migration 013 created `patient_followup_events` with
 * `occurred_at TIMESTAMPTZ NOT NULL` and nothing beside it, and no
 * later migration added one. So the only truthful answer this
 * resolver can return is 「没有记录精度」. `OccurrenceDatePrecision`
 * spells out the other three values anyway because they are the
 * export FORMAT's vocabulary — a receiver has to know what a
 * `precision` of 'year' would mean when we can finally send one. The
 * day we add `occurred_at_precision` to the table, this resolver
 * starts returning the real value and nothing downstream changes.
 * See the handoff note in the export lane.
 */

export type OccurrenceDatePrecision = 'day' | 'month' | 'year' | 'unrecorded';

export interface OccurrenceDate {
  /** `occurred_at`, verbatim. Never rounded, never re-derived. */
  readonly timestamp: string;
  readonly precision: OccurrenceDatePrecision;
  readonly pinnedToYearStart: boolean;
  readonly pinnedToMonthStart: boolean;
  /**
   * The year, month and day AS STORED — offered separately so a
   * consumer that wants only the year does not have to parse the
   * timestamp and accidentally acquire a month while doing it.
   */
  readonly storedYear: number | null;
  readonly noteZh: string;
}

const PRECISION_UNRECORDED_NOTE =
  '来源字段只能存一个完整时间点，无法表示「只知道年份」或「只知道月份」。因此本条的精度未记录：请不要把它当作精确到天的观察。pinnedToYearStart / pinnedToMonthStart 说明的是存储值本身的形态（是否正好落在某年 / 某月的第一毫秒），不是对患者本意的推断。';

const INVALID_NOTE = '来源字段的时间无法解析，原样保留，未做任何补全。';

export const resolveOccurrenceDate = (timestamp: string): OccurrenceDate => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return {
      timestamp,
      precision: 'unrecorded',
      pinnedToYearStart: false,
      pinnedToMonthStart: false,
      storedYear: null,
      noteZh: INVALID_NOTE,
    };
  }

  // UTC throughout. The comparison has to be against a fixed zone or
  // it becomes a statement about the server's TZ setting rather than
  // about the stored value, and the same row would answer differently
  // in Shanghai and in UTC.
  const atMonthStart =
    parsed.getUTCDate() === 1 &&
    parsed.getUTCHours() === 0 &&
    parsed.getUTCMinutes() === 0 &&
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0;

  return {
    timestamp,
    precision: 'unrecorded',
    pinnedToYearStart: atMonthStart && parsed.getUTCMonth() === 0,
    pinnedToMonthStart: atMonthStart,
    storedYear: parsed.getUTCFullYear(),
    noteZh: PRECISION_UNRECORDED_NOTE,
  };
};

/**
 * The FHIR/ISO partial date this instant can honestly be reduced to.
 *
 * FHIR `date` and `dateTime` both accept `YYYY` and `YYYY-MM`, which
 * is the one place in these three formats where "only the year is
 * known" is expressible without an extension. We use it in exactly
 * one direction: a value that is pinned to the start of a year is
 * emitted as `YYYY`, because emitting the full instant there would
 * assert a January date we have no evidence for. A value that is not
 * pinned is emitted in full, because rounding it DOWN would throw
 * away real precision.
 */
export const toPartialFhirDate = (occurrence: OccurrenceDate): string => {
  if (occurrence.storedYear === null) return occurrence.timestamp;
  if (occurrence.pinnedToYearStart) return String(occurrence.storedYear);
  if (occurrence.pinnedToMonthStart) return occurrence.timestamp.slice(0, 7);
  return occurrence.timestamp;
};
