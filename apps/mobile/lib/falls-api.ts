import { apiRequest } from './api';
import {
  FALLS_WINDOW_DAYS,
  FALL_ACTIVITIES,
  FALL_LOCATIONS,
  localDaysAgo,
  parseLocalIsoDate,
  toCreateFallPayload,
  type FallActivity,
  type FallDraft,
  type FallLocation,
  type FallQuarterCount,
  type FallRecord,
  type FallsListResult,
  type FallsSummary,
} from './falls';

/**
 * The four network calls for the falls diary.
 *
 * EVERY RESPONSE IS UNWRAPPED AND SHAPE-CHECKED HERE.
 *
 * `apiRequest` returns the parsed body verbatim — it does NOT unwrap a
 * `{ data: ... }` envelope (lib/api.ts, `return payload as T`) — and its
 * type parameter is an unchecked assertion, so
 * `apiRequest<FallsListResult>(...)` typechecks, passes every test, and
 * can be wrong at runtime. lib/passport-share-api.ts records at length
 * what happened the last time someone trusted the generic: a list came
 * back as `{ data: [...] }`, `.length` was `undefined`, and the screen
 * told a patient who had shared their record last week that they never
 * had.
 *
 * The profiles router answers with bare bodies today
 * (profile.controller.ts sends `res.json(result)`, not
 * `res.json({ data: result })`), so `unwrap` below is tolerance rather
 * than a fix. The shape checks are the part that matters, and
 * lib/__tests__/falls-api.test.ts asserts them against actual response
 * bodies copied from the API's own controller.
 *
 * WHAT THE CHECKS REFUSE, AND WHY EACH REFUSAL IS THE SAFE DIRECTION:
 *
 *  - A fall with no id or no real calendar date is DROPPED. It cannot
 *    be deleted (no id) and it cannot be placed in a diary (no day),
 *    and a row rendered as 「NaN 天前」 is worse than a row that is not
 *    there.
 *  - A detail value outside its enum becomes `null`, i.e. 「没填」. The
 *    server narrows the same two columns on the way out for the same
 *    reason; a label this app does not have must not reach a screen.
 *  - A summary whose `total` is not a number becomes NULL, and the
 *    caller must say it could not read the count. It must never
 *    default to 0 — 「0 次跌倒」 is a claim about the patient's body,
 *    and defaulting it would let a failed parse tell someone they have
 *    not fallen.
 */

const unwrap = (payload: unknown): unknown => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
};

const asRecord = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;

const asActivity = (value: unknown): FallActivity | null =>
  typeof value === 'string' && (FALL_ACTIVITIES as readonly string[]).includes(value)
    ? (value as FallActivity)
    : null;

const asLocation = (value: unknown): FallLocation | null =>
  typeof value === 'string' && (FALL_LOCATIONS as readonly string[]).includes(value)
    ? (value as FallLocation)
    : null;

/** A tri-state, and the only correct reading of a non-boolean is
 *  「没填」. Never `Boolean(value)`: that would turn an absent answer
 *  into 「否」, which is the one mistake this whole feature is built to
 *  avoid. */
const asBooleanOrNull = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const asFiniteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const asFallRecord = (raw: unknown, now: Date = new Date()): FallRecord | null => {
  const record = asRecord(raw);
  if (!record) return null;
  if (typeof record.id !== 'string' || !record.id) return null;
  if (typeof record.occurredOn !== 'string') return null;
  // A real calendar date, not just the right number of digits. The
  // server stores a DATE column so this should hold; "should hold" is
  // what the AI retriever's allowlist also said about `unit` before
  // migration 015.
  if (!parseLocalIsoDate(record.occurredOn)) return null;

  const serverAge = asFiniteOrNull(record.daysAgo);
  return {
    id: record.id,
    occurredOn: record.occurredOn,
    // Falls back to the device's own arithmetic rather than 0: a 0 here
    // would file an old fall as 今天 in anything reading this field.
    daysAgo: Math.max(0, Math.round(serverAge ?? localDaysAgo(record.occurredOn, now) ?? 0)),
    activity: asActivity(record.activity),
    location: asLocation(record.location),
    handsFull: asBooleanOrNull(record.handsFull),
    gotUpUnaided: asBooleanOrNull(record.gotUpUnaided),
    injured: asBooleanOrNull(record.injured),
  };
};

const asQuarter = (raw: unknown): FallQuarterCount | null => {
  const record = asRecord(raw);
  if (!record) return null;
  const index = asFiniteOrNull(record.index);
  const startDaysAgo = asFiniteOrNull(record.startDaysAgo);
  const endDaysAgo = asFiniteOrNull(record.endDaysAgo);
  const count = asFiniteOrNull(record.count);
  if (index === null || startDaysAgo === null || endDaysAgo === null || count === null) {
    return null;
  }
  return { index, startDaysAgo, endDaysAgo, count };
};

export const asFallsSummary = (raw: unknown): FallsSummary | null => {
  const record = asRecord(raw);
  if (!record) return null;
  const total = asFiniteOrNull(record.total);
  // See the header: a missing count is 「读不到」, never 「0 次」.
  if (total === null) return null;
  const quarters = (Array.isArray(record.quarters) ? record.quarters : [])
    .map(asQuarter)
    .filter((quarter): quarter is FallQuarterCount => quarter !== null);
  return {
    total: Math.max(0, Math.round(total)),
    // Anything that is not an explicit `false` is treated as capped,
    // i.e. as「这可能不是全部」. The cautious reading of an unreadable
    // flag is the one that stops the screen claiming a complete total.
    atCap: record.atCap !== false,
    quarters,
    oldestDaysAgo: asFiniteOrNull(record.oldestDaysAgo),
  };
};

/**
 * GET the diary and the count together.
 *
 * Throws when the body carries no readable summary. The alternative —
 * resolving with a zeroed one — is the failure described in the header:
 * a screen that says 「还没有跌倒记录」 to someone whose records simply
 * did not parse.
 */
export const listFalls = async (windowDays?: number): Promise<FallsListResult> => {
  const query =
    typeof windowDays === 'number' ? `?windowDays=${encodeURIComponent(windowDays)}` : '';
  const data = unwrap(await apiRequest<unknown>(`/profiles/me/falls${query}`));
  const record = asRecord(data);
  const summary = asFallsSummary(record?.summary);
  if (!summary) {
    throw new Error('跌倒记录读回来了，但格式看不懂，暂时没法显示。稍后再试一次。');
  }
  const now = new Date();
  const falls = (Array.isArray(record?.falls) ? record.falls : [])
    .map((raw) => asFallRecord(raw, now))
    .filter((fall): fall is FallRecord => fall !== null);
  return {
    falls,
    summary,
    windowDays: asFiniteOrNull(record?.windowDays) ?? windowDays ?? FALLS_WINDOW_DAYS,
  };
};

/**
 * POST one fall.
 *
 * Throws when the response carries no readable fall, rather than
 * resolving with nothing. By the time this rejects the server has very
 * likely already committed the row, so the message says so: a patient
 * told only 「保存失败」 presses again, and two rows for one fall is a
 * number that then goes to a doctor.
 */
export const recordFall = async (draft: FallDraft): Promise<FallRecord> => {
  const data = unwrap(
    await apiRequest<unknown>('/profiles/me/falls', {
      method: 'POST',
      body: JSON.stringify(toCreateFallPayload(draft)),
    }),
  );
  const record = asRecord(data);
  const fall = asFallRecord(record?.fall ?? data);
  if (!fall) {
    throw new Error('服务器没有把这条记录回传回来。刷新看看是否已经存上了，不要直接再存一次。');
  }
  return fall;
};

/** GET just the count — what 病程 needs, without pulling the diary. */
export const getFallsSummary = async (windowDays?: number): Promise<FallsSummary | null> => {
  const query =
    typeof windowDays === 'number' ? `?windowDays=${encodeURIComponent(windowDays)}` : '';
  const data = unwrap(await apiRequest<unknown>(`/profiles/me/falls/summary${query}`));
  const record = asRecord(data);
  return asFallsSummary(record?.summary ?? data);
};

/** Retract one entry. 204, so there is no body to check. The API takes
 *  the 病程时间线 twin down in the same transaction — otherwise the
 *  entry would vanish here and the fall would stay in the count. */
export const deleteFall = async (id: string): Promise<void> => {
  await apiRequest<unknown>(`/profiles/me/falls/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
