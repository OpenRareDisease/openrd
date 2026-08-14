import { describe, expect, it, vi } from 'vitest';

import {
  cdtChallengePage,
  cdtDetailPage,
  cdtRowsPage,
  cdtZeroResultsPage,
} from './__fixtures__/fixtures.js';
import {
  CDT_DETAIL_URL,
  CDT_KEYWORDS,
  CDT_MAX_PAGES,
  CDT_MAX_RECORDS,
  CDT_MIN_REQUEST_INTERVAL_MS,
  _parseDetail,
  _parseSearchList,
  fetchChinaDrugTrials,
} from './chinadrugtrials.fetcher.js';
import type { AppLogger } from '../../config/logger.js';

/**
 * Driven by four real captures of www.chinadrugtrials.org.cn taken on
 * 2026-08-13 (provenance in fixtures.ts): the anti-bot page, a search
 * that legitimately found nothing, a search that found rows, and a
 * detail page.
 *
 * The distinction those four exist to prove is the one the whole
 * feature rests on: 「共 0 条记录」 and 「the scraper is broken」 must
 * not produce the same outcome.
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

const noSleep = vi.fn(async () => {});

const html = (body: string, status = 200, setCookie?: string[]) => {
  const headers = new Headers();
  for (const cookie of setCookie ?? []) headers.append('set-cookie', cookie);
  return new Response(body, { status, headers });
};

/** The two Set-Cookie names the live site sends with its challenge. */
const CHALLENGE_COOKIES = ['FSSBBIl1UgzbN7N80T=abc; Path=/', 'FSSBBIl1UgzbN7N80S=def; Path=/'];

const keywordOf = (init?: RequestInit): string =>
  new URLSearchParams(String(init?.body ?? '')).get('keywords') ?? '';

describe('_parseSearchList', () => {
  it('reads every row of a real results page', () => {
    const page = _parseSearchList(cdtRowsPage(), 'test');

    expect(page.totalRecords).toBe(9);
    expect(page.totalPages).toBe(1);
    expect(page.rows.map((row) => row.ctr)).toEqual([
      'CTR20252821',
      'CTR20252461',
      'CTR20233077',
      'CTR20232865',
      'CTR20213303',
      'CTR20212110',
      'CTR20212108',
      'CTR20211795',
      'CTR20180881',
    ]);
  });

  it('keeps the two-level status word the site prints, with the &nbsp; undone', () => {
    const page = _parseSearchList(cdtRowsPage(), 'test');
    const byCtr = new Map(page.rows.map((row) => [row.ctr, row]));

    // The cell is written `进行中&nbsp;尚未招募` across two lines of
    // markup. Verbatim means the words, not the whitespace.
    expect(byCtr.get('CTR20233077')?.statusRaw).toBe('进行中 尚未招募');
    expect(byCtr.get('CTR20252461')?.statusRaw).toBe('进行中 招募中');
    expect(byCtr.get('CTR20252821')?.statusRaw).toBe('已完成');
    expect(byCtr.get('CTR20212110')?.statusRaw).toBe('主动终止');
  });

  it('picks up the detail key each row links to', () => {
    const page = _parseSearchList(cdtRowsPage(), 'test');
    expect(page.rows[0]?.detailId).toBe('eebd483a55a146c2b7181ba84e8a7e51');
    expect(page.rows.every((row) => /^[0-9a-f]{32}$/.test(row.detailId))).toBe(true);
  });

  it('reads 「暂无数据」 as a real empty answer, not as a failure', () => {
    const page = _parseSearchList(cdtZeroResultsPage(), 'test');
    expect(page.rows).toEqual([]);
    expect(page.totalRecords).toBe(0);
    expect(page.totalPages).toBe(0);
  });

  it('refuses the anti-bot page instead of reading it as an empty answer', () => {
    // The failure this whole file exists to prevent. The challenge page
    // has no results table, so it can never be mistaken for 「共 0 条
    // 记录」.
    expect(() => _parseSearchList(cdtChallengePage(), 'search page 1')).toThrow(
      'search page 1: no results table in the response',
    );
  });

  it('refuses a results table whose counts are gone', () => {
    const spliced = cdtRowsPage().replace(/共\s*<i>\d+<\/i>\s*条记录/g, '共 很多 条记录');
    expect(() => _parseSearchList(spliced, 'search page 1')).toThrow(
      'results table present but the record/page counts are missing',
    );
  });

  it('refuses a 登记号 cell that is not a CTR number', () => {
    const spliced = cdtRowsPage().replace('CTR20252821', 'javascript:void(0)');
    expect(() => _parseSearchList(spliced, 'search page 1')).toThrow('is not a CTR number');
  });

  it('refuses a row with the wrong number of cells rather than reading the columns it expected', () => {
    // The 序号 cell removed from the first row. Every later cell then
    // sits one column to the left, so 登记号 would be read out of 试验
    // 状态 and the title out of 适应症 — a card that is wrong in every
    // field while looking perfectly well-formed. The cell count is
    // checked before any cell is read, so this is what stops it.
    const spliced = cdtRowsPage().replace('<td height="40" >&nbsp;1</td>', '');
    expect(() => _parseSearchList(spliced, 'search page 1')).toThrow(
      'search page 1: a result row had 5 cells, expected 6',
    );
  });

  it('refuses an entity it does not decode instead of printing it to a patient', () => {
    // The decode list is deliberately short — the entities this site
    // emits, plus numeric escapes — and the guard that makes a short
    // list safe is this throw. Without it a title reaches the page
    // reading 「…研究&bull;」.
    const spliced = cdtRowsPage().replace(
      'HSK45030分散片在健康受试者中的I期临床研究',
      'HSK45030分散片&bull;I期临床研究',
    );
    expect(() => _parseSearchList(spliced, 'search page 1')).toThrow(
      'search page 1: undecoded HTML entity &bull; in extracted text',
    );
  });

  it('decodes a numeric escape rather than failing on it', () => {
    // The other half of the entity story, and the reason the comment
    // above decodeEntities names `&bull;` rather than `&#8226;`: the
    // numeric branches decode this one, so it reaches the patient as
    // the character the registry wrote.
    const spliced = cdtRowsPage().replace(
      'HSK45030分散片在健康受试者中的I期临床研究',
      'HSK45030分散片&#8226;I期临床研究',
    );
    const page = _parseSearchList(spliced, 'search page 1');
    expect(page.rows[0]?.plainTitle).toBe('HSK45030分散片•I期临床研究');
  });

  it('names the source and the step when a numeric escape is not a storable character', () => {
    // One case over from the entity above. Each of these three was
    // measured by splicing it into this same title on 2026-08-14:
    // `&#999999999;` made String.fromCodePoint throw a bare
    // 「RangeError: Invalid code point 999999999」; `&#xD800;` and
    // `&#0;` parsed fine and then died at the database — the surrogate
    // as 「invalid input syntax for type json」 on the `raw` column
    // (`SELECT $1::jsonb`), NUL as 「invalid byte sequence for encoding
    // "UTF8": 0x00」 on `title` itself.
    //
    // So the run already failed in all three; what it could not do was
    // say which page it was reading. That is what these assertions are
    // about — `trial_fetch_runs.error` is read by an operator, and a
    // driver message from two layers down does not tell them the scrape
    // hit a title it could not decode.
    const cases: Array<[string, string]> = [
      ['&#999999999;', 'above U+10FFFF'],
      ['&#xD800;', 'an unpaired surrogate'],
      ['&#0;', 'NUL'],
    ];
    for (const [entity, reason] of cases) {
      const spliced = cdtRowsPage().replace(
        'HSK45030分散片在健康受试者中的I期临床研究',
        `HSK45030分散片${entity}I期临床研究`,
      );
      expect(() => _parseSearchList(spliced, 'search page 1')).toThrow(
        `search page 1: HTML numeric entity ${entity} is ${reason}`,
      );
    }
  });

  it('fails the run on an escaped entity rather than decoding it twice into markup', () => {
    // `&amp;lt;` is the site writing the literal text `&lt;`. The
    // ampersand is decoded LAST, so it becomes `&lt;` and never `<`;
    // what then happens to that `&lt;` is this throw. Documented here
    // because the ordering alone reads like it produces a usable value,
    // and it does not — the run fails, loudly, which is the outcome
    // this file wants over a `<` we invented.
    const spliced = cdtRowsPage().replace(
      'HSK45030分散片在健康受试者中的I期临床研究',
      'HSK45030分散片&amp;lt;I期临床研究',
    );
    expect(() => _parseSearchList(spliced, 'search page 1')).toThrow(
      'search page 1: undecoded HTML entity &lt; in extracted text',
    );
  });
});

describe('_parseDetail', () => {
  it('reads the four fields the list page does not carry', () => {
    const detail = _parseDetail(cdtDetailPage(), 'detail CTR20252821');

    expect(detail.ctr).toBe('CTR20252821');
    // 申请人名称 appears twice on the page; the second is under
    // 二、申请人信息 where the neighbouring cell is a row number.
    expect(detail.sponsor).toBe('西藏海思科制药有限公司');
    expect(detail.phase).toBe('I期');
    expect(detail.scope).toBe('国内试验');
    expect(detail.countries).toEqual(['中国']);
    expect(detail.plainTitle).toBe('HSK45030分散片在健康受试者中的I期临床研究');
  });

  it('takes nothing from the contact and investigator blocks', () => {
    // The live page carries the applicant's contact person and the
    // principal investigator with phone numbers, emails and postal
    // addresses. Those were replaced with marked placeholders when the
    // fixture was captured (see fixtures.ts) precisely so this
    // assertion can be made: if the parser ever starts scooping up
    // neighbouring cells, the placeholder shows up here.
    const serialised = JSON.stringify(_parseDetail(cdtDetailPage(), 'test'));
    expect(serialised).not.toContain('夹具中抹去');
    expect(serialised).not.toContain('@');
    expect(serialised).not.toContain('联系人');
  });

  it('refuses a page that is not a detail page', () => {
    expect(() => _parseDetail(cdtChallengePage(), 'detail CTR20252821')).toThrow(
      'detail CTR20252821: no 基本信息 table',
    );
  });

  it('refuses a page that lost a section, rather than reporting the field as empty', () => {
    // A redesigned page that no longer has 2、试验设计 must not come
    // back as 「this trial has no phase」. Same for the site list and
    // `countries`.
    const noDesign = cdtDetailPage().replace('2、试验设计', '2、试验安排');
    expect(() => _parseDetail(noDesign, 'detail CTR20252821')).toThrow('no 2、试验设计 table');

    const noSites = cdtDetailPage().replace('各参加机构信息', '参加机构一览');
    expect(() => _parseDetail(noSites, 'detail CTR20252821')).toThrow('no 各参加机构信息 table');
  });

  it('refuses a site table whose country column moved', () => {
    // The columns either side of it are the institution name and the
    // named investigator. Reading by position would put a person into
    // `countries`.
    const renamed = cdtDetailPage().replace('>国家或地区<', '>國家或地區<');
    expect(() => _parseDetail(renamed, 'detail CTR20252821')).toThrow('has no 国家或地区 column');
  });
});

describe('the keyword list', () => {
  it('does not search for muscular dystrophy in general', () => {
    // `肌营养不良` returns 9 records and every one of them is DMD or
    // BMD. They are a different disease and they are not going on an
    // FSHD page.
    expect([...CDT_KEYWORDS]).not.toContain('肌营养不良');
    expect([...CDT_KEYWORDS]).toEqual(['面肩肱', '面肩胛肱', 'FSHD']);
  });
});

describe('fetchChinaDrugTrials — the answer today', () => {
  it('reports zero records as a success, and does not fetch any detail pages', async () => {
    const urls: string[] = [];
    const impl = vi.fn(async (url: string) => {
      urls.push(url);
      return html(cdtZeroResultsPage());
    });

    const result = await fetchChinaDrugTrials({
      fetchImpl: impl,
      logger: silentLogger,
      sleep: noSleep,
    });

    expect(result.source).toBe('chinadrugtrials');
    expect(result.records).toEqual([]);
    // The site's own 共 0 条记录, carried out of here as a number. This
    // is what the run row records, and it is the only thing that lets a
    // reader tell 「the registry says there is nothing」 from 「we wrote
    // nothing」 — an empty `records` array is produced by both.
    expect(result.sourceReportedTotal).toBe(0);
    // One search per keyword, nothing else. A zero-record answer is not
    // a failure and must not be retried into one.
    expect(urls).toHaveLength(CDT_KEYWORDS.length);
    expect(urls.some((url) => url.includes('searchlistdetail'))).toBe(false);
  });

  it('waits between requests', async () => {
    const sleep = vi.fn(async () => {});
    const impl = vi.fn(async () => html(cdtZeroResultsPage()));

    await fetchChinaDrugTrials({ fetchImpl: impl, logger: silentLogger, sleep });

    // Three requests, two gaps. The first goes out immediately.
    expect(sleep).toHaveBeenCalledTimes(CDT_KEYWORDS.length - 1);
    for (const [waited] of sleep.mock.calls as unknown as Array<[number]>) {
      expect(waited).toBeGreaterThan(0);
      expect(waited).toBeLessThanOrEqual(CDT_MIN_REQUEST_INTERVAL_MS);
    }
  });
});

describe('fetchChinaDrugTrials — the anti-bot gate', () => {
  it('replays the cookies the challenge set and carries on', async () => {
    const seen: Array<{ cookie: string | null }> = [];
    let call = 0;
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      seen.push({ cookie: new Headers(init?.headers).get('cookie') });
      // The live sequence: challenge first, real page once the cookies
      // come back.
      if (call === 1) return html(cdtChallengePage(), 202, CHALLENGE_COOKIES);
      return html(cdtZeroResultsPage());
    });

    const result = await fetchChinaDrugTrials({
      fetchImpl: impl,
      logger: silentLogger,
      sleep: noSleep,
    });

    expect(result.records).toEqual([]);
    expect(seen[0]?.cookie).toBeNull();
    expect(seen[1]?.cookie).toContain('FSSBBIl1UgzbN7N80T=abc');
    expect(seen[1]?.cookie).toContain('FSSBBIl1UgzbN7N80S=def');
    // One extra request for the retry, then the remaining keywords.
    expect(impl).toHaveBeenCalledTimes(CDT_KEYWORDS.length + 1);
  });

  it('fails the run when the challenge never clears, rather than reporting no trials', async () => {
    const impl = vi.fn(async () => html(cdtChallengePage(), 202, CHALLENGE_COOKIES));

    await expect(
      fetchChinaDrugTrials({ fetchImpl: impl, logger: silentLogger, sleep: noSleep }),
    ).rejects.toThrow(
      /chinadrugtrials search page 1: did not return the expected page after 2 attempts \(last HTTP 202, \d+ bytes, 2 cookies held\)/,
    );
    // Tried twice for the first keyword and gave up; the other keywords
    // are never reached.
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('does not put the response body into the message that reaches trial_fetch_runs.error', async () => {
    const impl = vi.fn(async () => html(cdtChallengePage(), 202, CHALLENGE_COOKIES));

    // That string is read by a human off an ops screen, and the body it
    // would otherwise carry is 25 KB of anti-bot script.
    // `.then(throw, catch)` rather than `.catch(cast)`: the latter
    // leaves TrialFetchResult in the union, so `error.message` does not
    // typecheck (three TS2339s under `npm run typecheck`, which vitest
    // cannot see because esbuild strips types).
    const error = await fetchChinaDrugTrials({
      fetchImpl: impl,
      logger: silentLogger,
      sleep: noSleep,
    }).then(
      () => {
        throw new Error('expected the run to fail');
      },
      (caught: unknown) => caught as Error,
    );

    expect(error.message).not.toContain('<html');
    expect(error.message).not.toContain('DOCTYPE');
    expect(error.message.length).toBeLessThan(200);
  });
});

describe('fetchChinaDrugTrials — records', () => {
  /**
   * The search returns the real 9-row page for the first keyword and
   * the real empty page for the others.
   *
   * The detail responses are a SPLICE, and this is the one place in
   * this file where the bytes under test are not exactly what the site
   * returned: there is one real detail capture (CTR20252821) and nine
   * rows, so each detail response is that capture with its 登记号
   * rewritten to the record being asked for. Everything the parser
   * reads other than the 登记号 is therefore the real page's.
   */
  const spliceFetch = () => {
    const rows = _parseSearchList(cdtRowsPage(), 'setup').rows;
    const ctrByDetailId = new Map(rows.map((row) => [row.detailId, row.ctr]));

    return vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith(CDT_DETAIL_URL)) {
        const id = new URL(url).searchParams.get('id') ?? '';
        const ctr = ctrByDetailId.get(id);
        if (!ctr) throw new Error(`test fetch: no row for detail id ${id}`);
        return html(cdtDetailPage().replaceAll('CTR20252821', ctr));
      }
      return html(keywordOf(init) === CDT_KEYWORDS[0] ? cdtRowsPage() : cdtZeroResultsPage());
    });
  };

  it('joins the list row to its detail page', async () => {
    const at = new Date('2026-08-13T22:00:00.000Z');
    const result = await fetchChinaDrugTrials({
      fetchImpl: spliceFetch(),
      logger: silentLogger,
      sleep: noSleep,
      now: () => at,
    });

    expect(result.records).toHaveLength(9);
    expect(result.fetchedAt).toEqual(at);

    const record = result.records.find((candidate) => candidate.sourceId === 'CTR20233077');
    expect(record).toBeDefined();
    expect(record?.source).toBe('chinadrugtrials');
    // From the list page.
    expect(record?.statusRaw).toBe('进行中 尚未招募');
    expect(record?.title).toContain('杜氏肌营养不良症（DMD）男童');
    // Already Chinese: there is nothing to translate, so status_zh
    // stays null and every surface renders status_raw.
    expect(record?.statusZh).toBeNull();
    // From the detail page.
    expect(record?.sponsor).toBe('西藏海思科制药有限公司');
    expect(record?.phase).toBe('I期');
    expect(record?.countries).toEqual(['中国']);
    expect(record?.url).toMatch(
      /^https:\/\/www\.chinadrugtrials\.org\.cn\/clinicaltrials\.searchlistdetail\.dhtml\?id=[0-9a-f]{32}$/,
    );
  });

  it('never claims a last-changed date this registry does not publish', async () => {
    const result = await fetchChinaDrugTrials({
      fetchImpl: spliceFetch(),
      logger: silentLogger,
      sleep: noSleep,
    });

    expect(result.records.every((record) => record.sourceUpdatedAt === null)).toBe(true);
    // 首次公示信息日期 is kept, but as what it is — under `raw`, where
    // nothing can mistake it for a last-update date.
    const raw = result.records[0]?.raw as { detail: Record<string, unknown> };
    expect(raw.detail.首次公示信息日期).toBe('2025-07-17');
  });

  it('keeps an allowlist in `raw`, not the page', async () => {
    const result = await fetchChinaDrugTrials({
      fetchImpl: spliceFetch(),
      logger: silentLogger,
      sleep: noSleep,
    });

    const raw = result.records[0]?.raw as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual([
      'detail',
      'detailUrl',
      'fetchedVia',
      'keyword',
      'list',
      'listUrl',
    ]);
    expect(raw.keyword).toBe(CDT_KEYWORDS[0]);

    // The 66 KB page, and everyone named on it, stayed on the site.
    const serialised = JSON.stringify(raw);
    expect(serialised).not.toContain('夹具中抹去');
    expect(serialised).not.toContain('<html');
    expect(serialised.length).toBeLessThan(2_000);
  });

  it('reports the registry own counts even when two keywords return the same trials', async () => {
    // The same real 9-row page answered for the first TWO keywords, so
    // the site said 9 twice about the same nine trials. We write nine
    // rows and report eighteen, because eighteen is what the registry
    // told us across the searches we ran and nine is what we kept. The
    // one number that must not be reported is our own dressed up as
    // theirs — that is the substitution this assertion exists to catch.
    const rows = _parseSearchList(cdtRowsPage(), 'setup').rows;
    const ctrByDetailId = new Map(rows.map((row) => [row.detailId, row.ctr]));
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith(CDT_DETAIL_URL)) {
        const id = new URL(url).searchParams.get('id') ?? '';
        const ctr = ctrByDetailId.get(id);
        if (!ctr) throw new Error(`test fetch: no row for detail id ${id}`);
        return html(cdtDetailPage().replaceAll('CTR20252821', ctr));
      }
      const keyword = keywordOf(init);
      const isFirstTwo = keyword === CDT_KEYWORDS[0] || keyword === CDT_KEYWORDS[1];
      return html(isFirstTwo ? cdtRowsPage() : cdtZeroResultsPage());
    });

    const result = await fetchChinaDrugTrials({
      fetchImpl: impl,
      logger: silentLogger,
      sleep: noSleep,
    });

    expect(result.records).toHaveLength(9);
    expect(result.sourceReportedTotal).toBe(18);
  });

  it('refuses a detail page that describes a different trial', async () => {
    // Every detail response is the unmodified CTR20252821 capture, so
    // the second row's detail page identifies itself as somebody else's
    // record. Taking whatever came back is how one trial's phase ends
    // up on another trial's card.
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith(CDT_DETAIL_URL)) return html(cdtDetailPage());
      return html(keywordOf(init) === CDT_KEYWORDS[0] ? cdtRowsPage() : cdtZeroResultsPage());
    });

    await expect(
      fetchChinaDrugTrials({ fetchImpl: impl, logger: silentLogger, sleep: noSleep }),
    ).rejects.toThrow('the detail page for CTR20252461 identifies itself as CTR20252821');
  });
});

describe('fetchChinaDrugTrials — refusing a list it cannot vouch for', () => {
  it('refuses when the site reports more records than it showed us', async () => {
    const spliced = cdtRowsPage().replace('共 <i>9</i> 条记录', '共 <i>10</i> 条记录');
    const impl = vi.fn(async () => html(spliced));

    await expect(
      fetchChinaDrugTrials({ fetchImpl: impl, logger: silentLogger, sleep: noSleep }),
    ).rejects.toThrow('parsed 9 rows but the site reported 10 records');
  });

  it('refuses a result set too large to read rather than writing the first page of it', async () => {
    const spliced = cdtZeroResultsPage()
      .replace('共 <i>0</i> 条记录', '共 <i>4000</i> 条记录')
      .replace('共 <i>0</i> 页', '共 <i>200</i> 页');
    const impl = vi.fn(async () => html(spliced));

    await expect(
      fetchChinaDrugTrials({ fetchImpl: impl, logger: silentLogger, sleep: noSleep }),
    ).rejects.toThrow(
      `a keyword matched 4000 records, more than the ${CDT_MAX_RECORDS} this fetcher will read`,
    );
  });

  it('refuses counts that contradict each other rather than walking 200 pages of 9 records', async () => {
    // The page cap is NOT the large-result-set guard — the record cap
    // above catches those first, and at the site's 20 rows a page
    // CDT_MAX_RECORDS = 60 implies at most 3 pages. What reaches this
    // branch is a site whose two counters disagree: 9 records spread
    // over 200 pages. Following that pager would be 200 requests at
    // 2 s apart against a government registry, on the strength of a
    // number we already know is wrong.
    const spliced = cdtRowsPage().replace(
      '共 <i>1</i> 页，共 <i>9</i> 条记录',
      '共 <i>200</i> 页，共 <i>9</i> 条记录',
    );
    const impl = vi.fn(async () => html(spliced));

    await expect(
      fetchChinaDrugTrials({ fetchImpl: impl, logger: silentLogger, sleep: noSleep }),
    ).rejects.toThrow(
      `a keyword returned 200 pages, more than the ${CDT_MAX_PAGES} this fetcher will read`,
    );
    // One request: it refused before asking for page 2.
    expect(impl).toHaveBeenCalledTimes(1);
  });
});
