import { describe, expect, it, vi } from 'vitest';

import { ctgovPage1, ctgovPage2 } from './__fixtures__/fixtures.js';
import {
  CTGOV_FIELDS,
  CTGOV_PAGE_SIZE,
  CTGOV_QUERY_COND,
  CTGOV_REQUEST_TIMEOUT_MS,
  _toTrialRecord,
  fetchCtgovTrials,
} from './ctgov.fetcher.js';
import type { AppLogger } from '../../config/logger.js';

/**
 * Driven by the two real pages in __fixtures__ (captured 2026-08-13,
 * provenance in fixtures.ts), so every count asserted below is the
 * registry's, not one invented to make a test pass.
 *
 * The failure cases mutate those pages rather than hand-writing
 * studies: the thing under test is what happens when a page that
 * looked like this stops looking like this.
 */

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as AppLogger;

interface Page {
  totalCount?: number;
  studies: Array<Record<string, unknown>>;
  nextPageToken?: string;
}

const page1 = (): Page => JSON.parse(ctgovPage1()) as Page;
const page2 = (): Page => JSON.parse(ctgovPage2()) as Page;

/** Answers page 1 to a request with no pageToken and page 2 otherwise,
 *  which is exactly what the registry did. */
const fixtureFetch = (pages?: { first?: Page; second?: Page }) => {
  const urls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    urls.push(url);
    const hasToken = new URL(url).searchParams.has('pageToken');
    const body = hasToken ? (pages?.second ?? page2()) : (pages?.first ?? page1());
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { impl, urls };
};

const nctOf = (study: Record<string, unknown>): string =>
  (study.protocolSection as { identificationModule: { nctId: string } }).identificationModule.nctId;

describe('ctgov fetcher — the pinned request', () => {
  it('asks for the pinned query, field list and page size, and pages with the token it was given', async () => {
    const { impl, urls } = fixtureFetch();
    await fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger });

    expect(urls).toHaveLength(2);

    const first = new URL(urls[0] ?? '').searchParams;
    expect(first.get('query.cond')).toBe(CTGOV_QUERY_COND);
    expect(first.get('fields')).toBe(CTGOV_FIELDS.join(','));
    expect(first.get('pageSize')).toBe(String(CTGOV_PAGE_SIZE));
    // Asked for once, because the API answers it once.
    expect(first.get('countTotal')).toBe('true');
    expect(first.has('pageToken')).toBe(false);

    const second = new URL(urls[1] ?? '').searchParams;
    expect(second.get('pageToken')).toBe(page1().nextPageToken);
    expect(second.has('countTotal')).toBe(false);
    expect(second.get('fields')).toBe(CTGOV_FIELDS.join(','));
  });

  it('does not request the contacts module that carries investigator phone numbers', () => {
    // The one field we take out of contactsLocationsModule is the
    // country of each site. Asking for the module instead would bring
    // named investigators, their mobile numbers and their email
    // addresses into `raw`.
    expect(CTGOV_FIELDS).toContain('protocolSection.contactsLocationsModule.locations.country');
    expect(CTGOV_FIELDS).not.toContain('protocolSection.contactsLocationsModule');
  });
});

describe('ctgov fetcher — what the 2026-08-13 capture actually contains', () => {
  it('reads every study across both pages, once each', async () => {
    const { impl } = fixtureFetch();
    const result = await fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger });

    expect(result.source).toBe('ctgov');
    expect(result.records).toHaveLength(92);
    // The API's own totalCount, carried out for the run row. Equal to
    // the record count here by construction — the completeness check
    // below refuses anything else — but it is the REGISTRY's number,
    // and the run row has to record what the source said as well as
    // what we wrote. See migration 027.
    expect(result.sourceReportedTotal).toBe(92);
    expect(new Set(result.records.map((record) => record.sourceId)).size).toBe(92);
    expect(result.records.every((record) => record.source === 'ctgov')).toBe(true);
  });

  it('leaves the ten statuses our map does not know in English', async () => {
    const { impl } = fixtureFetch();
    const { records } = await fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger });

    // 7 UNKNOWN + 3 ENROLLING_BY_INVITATION. See status-map.ts for why
    // neither is being translated.
    const untranslated = records.filter((record) => record.statusZh === null);
    expect(untranslated).toHaveLength(10);
    expect(new Set(untranslated.map((record) => record.statusRaw))).toEqual(
      new Set(['UNKNOWN', 'ENROLLING_BY_INVITATION']),
    );

    const recruiting = records.filter((record) => record.statusRaw === 'RECRUITING');
    expect(recruiting).toHaveLength(21);
    expect(recruiting.every((record) => record.statusZh === '招募中')).toBe(true);
  });

  it('carries the registry gaps through as null rather than inventing a value', async () => {
    const { impl } = fixtureFetch();
    const { records } = await fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger });

    // 34 of 92 publish no `phases` at all.
    expect(records.filter((record) => record.phase === null)).toHaveLength(34);
    // 5 of 92 list no location.
    expect(records.filter((record) => record.countries === null)).toHaveLength(5);
    // Every one of the 92 publishes a lead sponsor and a last-update
    // date, so a null in either column is news.
    expect(records.filter((record) => record.sponsor === null)).toHaveLength(0);
    expect(records.filter((record) => record.sourceUpdatedAt === null)).toHaveLength(0);
  });

  it('keeps the registry tokens for a multi-phase study and deduplicates countries', async () => {
    const { impl } = fixtureFetch();
    const { records } = await fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger });
    const byId = new Map(records.map((record) => [record.sourceId, record]));

    // Registered across two phases: one study, not two.
    expect(byId.get('NCT02836418')?.phase).toBe('PHASE1/PHASE2');
    // No location at all.
    expect(byId.get('NCT06086548')?.countries).toBeNull();
    // 12 locations in 5 countries.
    expect(byId.get('NCT01437345')?.countries).toEqual([
      'United States',
      'Australia',
      'Canada',
      'Sweden',
      'United Kingdom',
    ]);
    expect(byId.get('NCT06605612')?.statusRaw).toBe('ENROLLING_BY_INVITATION');
    expect(byId.get('NCT06605612')?.statusZh).toBeNull();
  });

  it('links to the registry page and keeps the study object it was built from', async () => {
    const { impl } = fixtureFetch();
    const { records } = await fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger });

    expect(records[0]?.url).toBe(`https://clinicaltrials.gov/study/${records[0]?.sourceId}`);
    expect(
      records.every(
        (record) => record.url === `https://clinicaltrials.gov/study/${record.sourceId}`,
      ),
    ).toBe(true);
    expect(records[0]?.raw).toEqual(page1().studies[0]);
  });

  it('stamps one fetch time on the whole run', async () => {
    const at = new Date('2026-08-13T22:00:00.000Z');
    const { impl } = fixtureFetch();
    const result = await fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger, now: () => at });
    expect(result.fetchedAt).toEqual(at);
  });
});

describe('ctgov fetcher — a fetch that cannot be trusted fails instead of shortening the list', () => {
  it('refuses a set that is not as long as the registry said it was', async () => {
    const second = page2();
    second.studies = second.studies.slice(0, -1);
    const { impl } = fixtureFetch({ second });

    await expect(fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger })).rejects.toThrow(
      'read 91 studies but the API reported 92',
    );
  });

  it('refuses the whole run when one study has no status, naming it', async () => {
    const first = page1();
    const study = first.studies[3] as {
      protocolSection: { statusModule: Record<string, unknown> };
    };
    const nctId = nctOf(first.studies[3] as Record<string, unknown>);
    delete study.protocolSection.statusModule.overallStatus;
    const { impl } = fixtureFetch({ first });

    // Not 「skip the study」: 91 studies are indistinguishable from a
    // registry that has 91.
    await expect(fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger })).rejects.toThrow(
      `${nctId}: no statusModule.overallStatus`,
    );
  });

  it('refuses a study that appears on both pages', async () => {
    const first = page1();
    const second = page2();
    second.studies[0] = first.studies[0] as Record<string, unknown>;
    const { impl } = fixtureFetch({ first, second });

    await expect(fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger })).rejects.toThrow(
      `${nctOf(first.studies[0] as Record<string, unknown>)} appeared twice across pages`,
    );
  });

  it('refuses a totalCount of ZERO instead of emptying the table and calling it a success', async () => {
    // The one wrong answer this fetcher used to accept. `totalCount: 0`
    // with an empty `studies` array is a perfectly well-formed HTTP 200:
    // no guard here fires, the completeness check passes trivially
    // (0 === 0), replaceTrialRecords' `<> ALL('{}')` deletes all 92
    // rows, and the run commits as ok = TRUE. Reproduced against the dev
    // database by pointing CTGOV_QUERY_COND at a condition that matches
    // nothing:
    //
    //   trials:refresh ctgov: ok, 0 record(s) written, 92 removed
    //   trial_records: (0 rows), run ok = t, error = NULL, exit 0
    //
    // A patient then reads 「截至今天，没有相关试验」 when what happened
    // is that our query stopped meaning FSHD.
    const first = page1();
    first.totalCount = 0;
    first.studies = [];
    delete first.nextPageToken;
    const { impl } = fixtureFetch({ first });

    await expect(fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger })).rejects.toThrow(
      'ctgov page 1: the API reported 0 studies for the pinned FSHD query (92 on 2026-08-13); refusing rather than deleting the whole list',
    );
    // Refused on the first page: it did not go on to page through an
    // empty result set.
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('refuses a first page with no totalCount, because nothing else can check the length', async () => {
    const first = page1();
    delete first.totalCount;
    const { impl } = fixtureFetch({ first });

    await expect(fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger })).rejects.toThrow(
      'ctgov page 1: response has no totalCount',
    );
  });

  it('refuses pagination that repeats a token', async () => {
    const first = page1();
    const second = page2();
    second.nextPageToken = first.nextPageToken;
    const { impl } = fixtureFetch({ first, second });

    await expect(fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger })).rejects.toThrow(
      'pagination repeated a page token',
    );
  });

  it('stops paginating rather than following an endless run of tokens', async () => {
    // One never-seen-before study per page, so the duplicate guard
    // cannot fire first and the page cap is what actually stops this.
    let call = 0;
    const impl = vi.fn(async () => {
      call += 1;
      const study = page1().studies[0] as {
        protocolSection: { identificationModule: { nctId: string } };
      };
      study.protocolSection.identificationModule.nctId = `NCT1${String(1000000 + call)}`;
      const body: Page = {
        totalCount: call === 1 ? 99_999 : undefined,
        studies: [study as unknown as Record<string, unknown>],
        nextPageToken: `token-${call}`,
      };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    await expect(fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger })).rejects.toThrow(
      'still paginating after 40 pages',
    );
  });

  it('reports a non-200 by status without pasting the body into the run record', async () => {
    const impl = vi.fn(async () => new Response('<html>gateway</html>', { status: 503 }));
    await expect(fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger })).rejects.toThrow(
      'ctgov page 1: HTTP 503 (20 bytes)',
    );
  });

  it('reports a body that is not JSON as such', async () => {
    const impl = vi.fn(async () => new Response('<html>captive portal</html>', { status: 200 }));
    await expect(fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger })).rejects.toThrow(
      'ctgov page 1: response was not JSON',
    );
  });

  it('names the timeout budget when the registry does not answer', async () => {
    const impl = vi.fn(async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });

    await expect(fetchCtgovTrials({ fetchImpl: impl, logger: silentLogger })).rejects.toThrow(
      `ctgov page 1: no response within ${CTGOV_REQUEST_TIMEOUT_MS}ms`,
    );
  });
});

describe('_toTrialRecord', () => {
  it('refuses a last-update value that is not a full date', () => {
    const study = page1().studies[0] as {
      protocolSection: { statusModule: { lastUpdatePostDateStruct: { date: string } } };
    };
    study.protocolSection.statusModule.lastUpdatePostDateStruct.date = '2024-04';

    // Month precision cannot go into a DATE column without us choosing
    // a day the registry never published.
    expect(() => _toTrialRecord(study)).toThrow('is not YYYY-MM-DD (2024-04)');
  });

  it('refuses a study with neither title', () => {
    const study = page1().studies[0] as {
      protocolSection: { identificationModule: Record<string, unknown> };
    };
    const nctId = nctOf(study as unknown as Record<string, unknown>);
    delete study.protocolSection.identificationModule.briefTitle;
    delete study.protocolSection.identificationModule.officialTitle;

    expect(() => _toTrialRecord(study)).toThrow(`${nctId}: no briefTitle and no officialTitle`);
  });

  it('refuses an id that is not an NCT number rather than building a URL from it', () => {
    const study = page1().studies[0] as {
      protocolSection: { identificationModule: Record<string, unknown> };
    };
    study.protocolSection.identificationModule.nctId = '../../etc/passwd';

    expect(() => _toTrialRecord(study)).toThrow('study has no usable nctId');
  });
});
