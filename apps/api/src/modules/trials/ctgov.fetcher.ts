/**
 * clinicaltrials.gov, the half of the trial list we can read from an
 * API.
 *
 * Public, no key, and fast: on 2026-08-13,
 *
 *   curl -sS -A 'openrd-trials/1.0 (+https://github.com/OpenRareDisease/openrd)' \
 *     'https://clinicaltrials.gov/api/v2/studies?query.cond=facioscapulohumeral+muscular+dystrophy&countTotal=true&pageSize=1'
 *
 * answered in 0.11 s with `totalCount: 92`. It is still not called on
 * the request path — see migration 026's header for why a VPS inside
 * mainland China must not make a patient's page depend on it.
 *
 *
 * ALL OR NOTHING
 *
 * Every parse failure in this file throws, and a throw fails the whole
 * run for this source; nothing is skipped. That is the opposite of the
 * usual 「be liberal in what you accept」 and it is deliberate: a study
 * silently dropped because its shape surprised us produces a SHORTER
 * list that looks exactly as complete as a correct one, and the patient
 * reading it has no way to tell. A failed run, by contrast, shows up on
 * the page as 「上次成功：X」 with the previous list still standing.
 *
 * The count check at the bottom is the same idea made structural: the
 * API tells us how many studies match, and we refuse to write a set
 * that is not that many. A reported total of ZERO is refused outright
 * before that check can pass trivially — see the guard on page 1 for
 * why zero from this registry is our bug and never its answer.
 *
 *
 * WHAT IS IN `raw`
 *
 * The study object exactly as the API returned it FOR THE FIELD LIST
 * BELOW — not the whole study record. `CTGOV_FIELDS` is nine leaf
 * paths, so `raw` can settle any disagreement about the seven columns
 * we extract and cannot answer a question about eligibility criteria or
 * outcome measures; recovering those needs a re-fetch. The field list
 * is pinned rather than left off for two reasons: the response then
 * cannot grow a field whose meaning we never examined, and the module
 * that would otherwise come with it, `contactsLocationsModule`, carries
 * named investigators with their phone numbers and email addresses,
 * which we have no use for and no business storing.
 */

import { translateCtgovStatus } from './status-map.js';
import { requestText, type FetchLike } from './trials.http.js';
import type { TrialFetchResult, TrialRecordInput } from './trials.types.js';
import type { AppLogger } from '../../config/logger.js';

export const CTGOV_API_URL = 'https://clinicaltrials.gov/api/v2/studies';

/**
 * The query, pinned. `query.cond` is the API's condition search, which
 * covers the condition list and its synonyms — 92 studies on
 * 2026-08-13. It is a constant and not a parameter because the list a
 * patient sees has to be the list this file's tests were written
 * against.
 */
export const CTGOV_QUERY_COND = 'facioscapulohumeral muscular dystrophy';

/** See the header. Every one of these is read below; there are no
 *  fields here 「for later」. */
export const CTGOV_FIELDS = [
  'protocolSection.identificationModule.nctId',
  'protocolSection.identificationModule.briefTitle',
  'protocolSection.identificationModule.officialTitle',
  'protocolSection.statusModule.overallStatus',
  'protocolSection.statusModule.lastUpdatePostDateStruct.date',
  'protocolSection.sponsorCollaboratorsModule.leadSponsor.name',
  'protocolSection.designModule.phases',
  'protocolSection.designModule.studyType',
  'protocolSection.contactsLocationsModule.locations.country',
] as const;

/**
 * 50, against 92 studies — so a real run pages twice, every time.
 *
 * The API's maximum is 1000 and one request would do. Sizing above the
 * result set would make the pagination loop dead code that first runs
 * in production on the day the registry grows past it, which is the
 * day nobody is looking. Two requests per refresh is not a cost worth
 * saving.
 */
export const CTGOV_PAGE_SIZE = 50;

/**
 * Refuse rather than page forever. At 50 per page this is 2,000
 * studies — twenty times today's 92 — and the only ways to reach it
 * are a `nextPageToken` that never clears and a query that stopped
 * meaning FSHD. Both should stop the run rather than fill the table.
 */
export const CTGOV_MAX_PAGES = 40;

/** Per request, not per run. The measured response is ~0.11 s; this is
 *  sized for a bad day on a link that crosses the GFW, and the run is
 *  a cron job with nobody waiting on it. */
export const CTGOV_REQUEST_TIMEOUT_MS = 30_000;

const NCT_ID_PATTERN = /^NCT\d{8}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface CtgovFetcherDeps {
  fetchImpl: FetchLike;
  logger: AppLogger;
  /** Injected so a test can assert the stamp without freezing time. */
  now?: () => Date;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

interface CtgovPage {
  totalCount?: number;
  studies: unknown[];
  nextPageToken?: string;
}

const parsePage = (body: string, label: string): CtgovPage => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not the body: an HTML error page or a captive-portal login is
    // the likely content and both are long.
    throw new Error(`${label}: response was not JSON (${body.length} bytes)`);
  }

  const page = asRecord(parsed);
  if (!page || !Array.isArray(page.studies)) {
    throw new Error(`${label}: response has no 'studies' array`);
  }

  const totalCount = typeof page.totalCount === 'number' ? page.totalCount : undefined;
  const nextPageToken = asNonEmptyString(page.nextPageToken);
  return { totalCount, studies: page.studies, nextPageToken };
};

/**
 * One study -> one row, or a throw naming the NCT id.
 *
 * Exported for its test, which drives it with the shapes the live API
 * actually produced on 2026-08-13 — a study with no phase (34 of 92
 * publish no `phases` at all), no location (5 of 92), and a status our
 * map does not know (10 of 92).
 */
export const _toTrialRecord = (study: unknown): TrialRecordInput => {
  const protocolSection = asRecord(asRecord(study)?.protocolSection);
  if (!protocolSection) {
    throw new Error('study has no protocolSection');
  }

  const identification = asRecord(protocolSection.identificationModule);
  const nctId = asNonEmptyString(identification?.nctId);
  if (!nctId || !NCT_ID_PATTERN.test(nctId)) {
    throw new Error(`study has no usable nctId (got ${JSON.stringify(identification?.nctId)})`);
  }

  const statusModule = asRecord(protocolSection.statusModule);
  const statusRaw = asNonEmptyString(statusModule?.overallStatus);
  if (!statusRaw) {
    // status_raw is NOT NULL and status is the first thing a patient
    // reads. A study without one is a study we cannot describe.
    throw new Error(`${nctId}: no statusModule.overallStatus`);
  }

  // briefTitle is the registry's own short title and what the study
  // page leads with; officialTitle is the protocol title. Neither is
  // translated — see status-map.ts for what happened the last time
  // this data was machine translated.
  const title =
    asNonEmptyString(identification?.briefTitle) ?? asNonEmptyString(identification?.officialTitle);
  if (!title) {
    throw new Error(`${nctId}: no briefTitle and no officialTitle`);
  }

  const lastUpdate = asRecord(statusModule?.lastUpdatePostDateStruct);
  const rawUpdatedAt = asNonEmptyString(lastUpdate?.date);
  if (rawUpdatedAt !== undefined && !ISO_DATE_PATTERN.test(rawUpdatedAt)) {
    // ctgov publishes some dates at month precision (`statusVerifiedDate`
    // is `2024-04`). `lastUpdatePostDateStruct.date` was a full date on
    // all 92 studies in the 2026-08-13 capture; a month here would be a
    // change in what the field means, and guessing a day-of-month would
    // put a date on the page that the registry never published.
    throw new Error(`${nctId}: lastUpdatePostDateStruct.date is not YYYY-MM-DD (${rawUpdatedAt})`);
  }

  const designModule = asRecord(protocolSection.designModule);
  const rawPhases = designModule?.phases;
  const phases = Array.isArray(rawPhases)
    ? rawPhases.map(asNonEmptyString).filter((phase): phase is string => phase !== undefined)
    : [];

  const leadSponsor = asRecord(asRecord(protocolSection.sponsorCollaboratorsModule)?.leadSponsor);

  const locations = asRecord(protocolSection.contactsLocationsModule)?.locations;
  const countries = Array.isArray(locations)
    ? [
        ...new Set(
          locations
            .map((location) => asNonEmptyString(asRecord(location)?.country))
            .filter((country): country is string => country !== undefined),
        ),
      ]
    : [];

  return {
    source: 'ctgov',
    sourceId: nctId,
    title,
    statusRaw,
    statusZh: translateCtgovStatus(statusRaw),
    // Joined with '/' because ctgov publishes a set — `PHASE1/PHASE2`
    // is one study registered across two phases, not two studies.
    phase: phases.length > 0 ? phases.join('/') : null,
    // All 92 studies in the 2026-08-13 capture publish one; null is
    // for the study that does not, and means 「the registry did not
    // say」 rather than 「no sponsor」.
    sponsor: asNonEmptyString(leadSponsor?.name) ?? null,
    countries: countries.length > 0 ? countries : null,
    // Built from the id we just pattern-checked, never from free text.
    // Verified 200 on 2026-08-13:
    //   curl -sS -o /dev/null -w '%{http_code}' https://clinicaltrials.gov/study/NCT06378203
    url: `https://clinicaltrials.gov/study/${nctId}`,
    sourceUpdatedAt: rawUpdatedAt ?? null,
    raw: study,
  };
};

/**
 * The whole FSHD list from clinicaltrials.gov, or a throw.
 *
 * The caller records the throw against `trial_fetch_runs` and leaves
 * `trial_records` alone.
 */
export const fetchCtgovTrials = async (deps: CtgovFetcherDeps): Promise<TrialFetchResult> => {
  const { fetchImpl, logger } = deps;
  const now = deps.now ?? (() => new Date());

  const records: TrialRecordInput[] = [];
  const seenIds = new Set<string>();
  const seenTokens = new Set<string>();
  let totalCount: number | undefined;
  let pageToken: string | undefined;
  let page = 0;

  for (;;) {
    page += 1;
    if (page > CTGOV_MAX_PAGES) {
      throw new Error(
        `ctgov: still paginating after ${CTGOV_MAX_PAGES} pages (${records.length} studies so far)`,
      );
    }

    const params = new URLSearchParams({
      'query.cond': CTGOV_QUERY_COND,
      fields: CTGOV_FIELDS.join(','),
      pageSize: String(CTGOV_PAGE_SIZE),
    });
    if (pageToken === undefined) {
      // Asked for once. The API answers `totalCount` on the first page
      // only — verified 2026-08-13, page 2 of a pageSize=50 run omits
      // it even with countTotal=true.
      params.set('countTotal', 'true');
    } else {
      params.set('pageToken', pageToken);
    }

    const label = `ctgov page ${page}`;
    const { response, body } = await requestText(
      fetchImpl,
      `${CTGOV_API_URL}?${params.toString()}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      CTGOV_REQUEST_TIMEOUT_MS,
      label,
    );

    if (!response.ok) {
      throw new Error(`${label}: HTTP ${response.status} (${body.length} bytes)`);
    }

    const parsed = parsePage(body, label);
    if (page === 1) {
      if (parsed.totalCount === undefined) {
        // Without it the completeness check below cannot run, and a
        // truncated list would be written as if it were the registry's
        // answer.
        throw new Error(`${label}: response has no totalCount`);
      }
      if (parsed.totalCount === 0) {
        // THE ONE ANSWER THIS SOURCE IS NOT ALLOWED TO GIVE.
        //
        // Zero is a legitimate answer at chinadrugtrials — no FSHD
        // trial is registered there — and it is not one here. The
        // pinned query matched 92 studies on 2026-08-13, and a registry
        // does not unpublish its archive: COMPLETED and TERMINATED
        // studies stay published. So a zero from this endpoint is our
        // query having stopped meaning FSHD (a `query.cond` the API no
        // longer expands, a parameter it ignores rather than rejects, a
        // synonym map changed upstream), and every one of those
        // arrives as HTTP 200 with a well-formed body — no other guard
        // in this file fires.
        //
        // Without this line the run continues: the completeness check
        // passes trivially (0 === 0), replaceTrialRecords' `<> ALL('{}')`
        // deletes every row of the source, and the run commits as
        // `ok = TRUE`. Demonstrated on the dev database before this
        // guard existed — all 92 rows gone, exit code 0, nothing on
        // stderr — which a patient then reads as 「截至今天，没有相关
        // 试验」.
        //
        // Refusing leaves the previous 92 rows standing with their own
        // older fetched_at and puts the reason in
        // trial_fetch_runs.error, which is the shape every other
        // degradation in this file already has.
        throw new Error(
          `${label}: the API reported 0 studies for the pinned FSHD query (92 on 2026-08-13); refusing rather than deleting the whole list`,
        );
      }
      totalCount = parsed.totalCount;
    }

    for (const study of parsed.studies) {
      const record = _toTrialRecord(study);
      if (seenIds.has(record.sourceId)) {
        // The upsert below sends every row in one statement, and
        // Postgres rejects an ON CONFLICT DO UPDATE that would touch a
        // row twice ("cannot affect row a second time"). Catching it
        // here names the study; catching it there names nothing.
        throw new Error(`ctgov: ${record.sourceId} appeared twice across pages`);
      }
      seenIds.add(record.sourceId);
      records.push(record);
    }

    if (parsed.nextPageToken === undefined) {
      break;
    }
    if (seenTokens.has(parsed.nextPageToken)) {
      throw new Error(`ctgov: pagination repeated a page token after ${records.length} studies`);
    }
    seenTokens.add(parsed.nextPageToken);
    pageToken = parsed.nextPageToken;
  }

  if (totalCount === undefined || records.length !== totalCount) {
    // The one check that makes 「complete」 a fact rather than an
    // assumption. A registry that dropped a page, a token that expired
    // mid-run, a filter we did not know we were sending: all of them
    // land here instead of on the page as a short list.
    throw new Error(`ctgov: read ${records.length} studies but the API reported ${totalCount}`);
  }

  logger.info(
    { source: 'ctgov', pages: page, studies: records.length, totalCount },
    'Read the FSHD study list from clinicaltrials.gov',
  );

  // totalCount is the registry's own number and the check above proves
  // records.length equals it. It is carried out of here so the run row
  // records what the SOURCE said, not only what we wrote — see
  // TrialFetchResult.sourceReportedTotal and migration 027.
  return { source: 'ctgov', fetchedAt: now(), records, sourceReportedTotal: totalCount };
};
