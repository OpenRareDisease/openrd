import { apiRequest } from './api';
import {
  TRIAL_SOURCES,
  type TrialFetchRun,
  type TrialRecord,
  type TrialSourceKey,
  type TrialSourceStatus,
  type TrialsSnapshot,
} from './trials';

/**
 * The one network call behind 临床试验.
 *
 * WHAT IT ASKS FOR
 *
 *   GET /trials        (requireAuth, like every other route here)
 *
 *   {
 *     "trials": [{
 *       "source": "ctgov",
 *       "sourceId": "NCT04003974",
 *       "title": "A Study of ...",
 *       "statusRaw": "RECRUITING",
 *       "statusZh": "招募中",          // null when we have no mapping
 *       "phase": "PHASE2",
 *       "sponsor": "Fulcrum Therapeutics",
 *       "countries": ["United States", "France"],
 *       "url": "https://clinicaltrials.gov/study/NCT04003974",
 *       "sourceUpdatedAt": "2026-06-01",   // MUST be a calendar day
 *       "fetchedAt": "2026-08-12T02:00:00.000Z"
 *     }],
 *     "sources": [{
 *       "source": "ctgov",
 *       "recordCount": 92,
 *       "fetchedAt": "2026-08-12T02:00:00.000Z",   // newest of the above
 *       "lastRun": { "startedAt": "...", "finishedAt": "...", "ok": true },
 *       "lastSuccessAt": "2026-08-12T02:00:03.000Z"
 *     }]
 *   }
 *
 * `sources` mirrors `trial_fetch_runs` and is not optional decoration:
 * it is the only way the screen can tell「国内那半边取不到」from「国内
 * 没有登记的试验」. `trials` alone cannot answer that, because both
 * states look like an absence.
 *
 * `sourceUpdatedAt` must be `YYYY-MM-DD`. It comes from a `date`
 * column, and anything else — a serialised timestamp, an epoch — makes
 * the day ambiguous by a timezone; lib/trials.ts drops what it cannot
 * read rather than showing a date that is one day wrong. See
 * `readRegistryDay` there.
 *
 * WHY EVERY FIELD IS CHECKED HERE
 *
 * `apiRequest`'s type parameter is an unchecked assertion — it returns
 * the parsed body verbatim and does not unwrap a `{ data: ... }`
 * envelope. lib/passport-share-api.ts records what happened the last
 * time that generic was trusted. The refusals below are all in the
 * same direction:
 *
 *  - A trial with no id, no title, no status word or no URL is
 *    DROPPED. Every one of those is load-bearing on the card: the
 *    status is the fact the reader came for, and the URL is the only
 *    way they can check any of it.
 *  - `fetchedAt` that is not a readable instant becomes null, and a
 *    snapshot with no readable instant anywhere makes the screen
 *    refuse to draw the list. An undated cache presented as current is
 *    the one failure this feature cannot ship with.
 *  - `recordCount` that is not a number becomes the number of records
 *    actually received for that source.
 *  - A run whose `ok` is not a boolean is treated as NOT ok. The
 *    cautious reading of an unreadable run is the one that warns.
 */

const unwrap = (payload: unknown): unknown => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
};

const asRecord = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Trimmed, or null. Used for the fields a card is allowed to be
 *  missing — an empty string from the registry means the registry did
 *  not say, and「」rendered as a value looks like a bug. */
const asOptionalString = (value: unknown): string | null => asNonEmptyString(value);

/** An ISO instant we can actually place on a calendar, or null. */
const asInstant = (value: unknown): string | null => {
  const text = asNonEmptyString(value);
  if (!text) return null;
  return Number.isNaN(new Date(text).getTime()) ? null : text;
};

const asSourceKey = (value: unknown): TrialSourceKey | null =>
  typeof value === 'string' && (TRIAL_SOURCES as readonly string[]).includes(value)
    ? (value as TrialSourceKey)
    : null;

/** Only the strings survive. A country list that arrived as
 *  `[null, "China"]` still tells the reader about China; dropping the
 *  whole array over one bad element would lose a real fact. */
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const asTrialRecord = (raw: unknown): TrialRecord | null => {
  const record = asRecord(raw);
  if (!record) return null;

  const source = asSourceKey(record.source);
  const sourceId = asNonEmptyString(record.sourceId);
  const title = asNonEmptyString(record.title);
  const statusRaw = asNonEmptyString(record.statusRaw);
  const url = asNonEmptyString(record.url);
  if (!source || !sourceId || !title || !statusRaw || !url) return null;

  // The card renders this as a link that leaves the app. `http(s)` is
  // the only scheme a registry record is ever served over, and it is
  // the only one this app will hand to the browser — AnswerText.tsx
  // makes the same refusal for the same reason.
  if (!/^https?:\/\//i.test(url)) return null;

  return {
    source,
    sourceId,
    title,
    statusRaw,
    statusZh: asOptionalString(record.statusZh),
    phase: asOptionalString(record.phase),
    sponsor: asOptionalString(record.sponsor),
    countries: asStringArray(record.countries),
    url,
    sourceUpdatedAt: asOptionalString(record.sourceUpdatedAt),
    fetchedAt: asInstant(record.fetchedAt),
  };
};

const asFetchRun = (raw: unknown): TrialFetchRun | null => {
  const record = asRecord(raw);
  if (!record) return null;
  return {
    startedAt: asInstant(record.startedAt),
    finishedAt: asInstant(record.finishedAt),
    // Anything that is not an explicit `true` is「没成功」. See the
    // header: an unreadable run has to warn, not reassure.
    ok: record.ok === true,
  };
};

export const asSourceStatus = (raw: unknown, receivedCount: number): TrialSourceStatus | null => {
  const record = asRecord(raw);
  if (!record) return null;
  const source = asSourceKey(record.source);
  if (!source) return null;
  const count = record.recordCount;
  return {
    source,
    recordCount:
      typeof count === 'number' && Number.isFinite(count) && count >= 0
        ? Math.round(count)
        : receivedCount,
    fetchedAt: asInstant(record.fetchedAt),
    lastRun: asFetchRun(record.lastRun),
    lastSuccessAt: asInstant(record.lastSuccessAt),
  };
};

/**
 * Read the cached list.
 *
 * Throws when the body is not an object at all — that is a broken
 * endpoint, not an empty registry, and resolving with
 * `{ trials: [], sources: [] }` would put the screen into its「注册库
 * 这次没有取到」copy for what is actually our own bug.
 *
 * An object with no `trials` key resolves to an empty snapshot on
 * purpose: `describeEmptyList` then reads `sources` and says which
 * kind of empty it is.
 */
export const listTrials = async (): Promise<TrialsSnapshot> => {
  const data = unwrap(await apiRequest<unknown>('/trials'));
  const body = asRecord(data);
  if (!body) {
    throw new Error('试验名单读回来了，但格式看不懂，暂时没法显示。稍后再试一次。');
  }

  const trials = (Array.isArray(body.trials) ? body.trials : [])
    .map(asTrialRecord)
    .filter((trial): trial is TrialRecord => trial !== null);

  const countsBySource = new Map<TrialSourceKey, number>();
  for (const trial of trials) {
    countsBySource.set(trial.source, (countsBySource.get(trial.source) ?? 0) + 1);
  }

  const sources = (Array.isArray(body.sources) ? body.sources : [])
    .map((raw) => {
      const key = asSourceKey(asRecord(raw)?.source);
      return asSourceStatus(raw, key ? (countsBySource.get(key) ?? 0) : 0);
    })
    .filter((status): status is TrialSourceStatus => status !== null);

  return { trials, sources };
};
