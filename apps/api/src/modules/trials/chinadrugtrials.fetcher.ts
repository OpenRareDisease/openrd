/**
 * 药物临床试验登记与信息公示平台 (www.chinadrugtrials.org.cn), the
 * domestic half of the trial list — and the half we have to scrape.
 *
 * There is no API. Everything below was established by hand against the
 * live site on 2026-08-13, and every number in this file is from that
 * session.
 *
 *
 * THE THREE THINGS THAT MAKE THIS DIFFERENT FROM ctgov.fetcher.ts
 *
 * 1. AN ANTI-BOT GATE. The first request of a session is answered with
 *    HTTP 202 and a ~25 KB page that carries no results table, plus two
 *    `Set-Cookie` headers. Send those cookies back and the next request
 *    gets the real page. Measured, cold jar, POST to the search list:
 *
 *      request 1   202, 25210 bytes, 0 occurrences of `searchTable`
 *      request 2   200, 47181 bytes, results table present
 *
 *    So every request here is 「try, absorb cookies, try once more」.
 *    The capture of that first response is
 *    __fixtures__/chinadrugtrials.challenge.html and the test drives
 *    the retry with it.
 *
 * 2. NO LAST-CHANGED DATE. The platform publishes 首次公示信息日期 (the
 *    date a record was FIRST disclosed) and nothing else datelike: the
 *    detail page's other dates are 版本日期, 批准日期/备案日期 and the
 *    enrolment dates, and its RSS feed's `pubDate` equals the first
 *    disclosure date (checked against CTR20252821: detail page and RSS
 *    both say 2025-07-17). `source_updated_at` is therefore always
 *    NULL for this source. Writing first-disclosure into a column that
 *    means last-changed would date every domestic record to the day it
 *    appeared and never move again.
 *
 * 3. IT WILL BREAK. It is HTML held together by regular expressions.
 *    Every parse step below either produces the value or throws, and a
 *    throw is recorded on `trial_fetch_runs` as `ok = FALSE` with the
 *    reason while `trial_records` is left exactly as it was. What must
 *    never happen is the quiet version: an empty list written as a
 *    successful run, which a patient reads as 「国内没有试验」 when it
 *    means 「我们的爬虫坏了」.
 *
 *    The distinction is structural, not a guess: a genuinely empty
 *    result still renders the results table, the 暂无数据 row and
 *    「共 0 条记录」. A broken fetch renders none of them.
 *
 *    That distinction used to die at the database boundary, where both
 *    outcomes could only have been a run with `records_upserted = 0`.
 *    The site's own 共 N 条记录 is now added up across the keywords and
 *    returned as `sourceReportedTotal`, which the refresh writes to
 *    `trial_fetch_runs.source_reported_total` — so 「the registry said
 *    zero」 is a number in the table rather than an inference from the
 *    absence of one. Migration 027 is the column and the reasoning.
 *
 *
 * WHAT WE SEARCH FOR, AND WHAT WE DELIBERATELY DO NOT
 *
 * CDT_KEYWORDS below. Each returned 共 0 条记录 on 2026-08-13 — there
 * is currently no FSHD trial registered in China, and that zero is the
 * answer, not a failure.
 *
 * Re-measured on 2026-08-14 by running this fetcher against the live
 * site with every response body dumped: the challenge (HTTP 202, 25,564
 * bytes, no results table), then one HTTP 200 per keyword — 45,994 /
 * 46,020 / 46,246 bytes, each with the results table, the 暂无数据 row,
 * 共 <i>0</i> 条记录 and 共 <i>0</i> 页. Still zero, still case A.
 *
 * `肌营养不良` (muscular dystrophy) returns 9 records, and they are not
 * in this list on purpose: all nine are DMD/BMD (杜氏/贝氏), a different
 * disease. Showing them on an FSHD page would be us answering a
 * question the patient did not ask with drugs that are not for them.
 *
 * The search matches inside the registered wording rather than on a
 * whole field, which is why the short forms are used: `杜氏` returns 6
 * records, and all 6 are members of the 9 that `肌营养不良` returns,
 * whose text reads 杜氏肌营养不良. So `面肩肱` would reach a record
 * registered as 面肩肱型肌营养不良.
 *
 *
 * WHAT IS IN `raw`
 *
 * NOT the page. An allowlist of the labelled values this file
 * extracted, plus the two URLs and the keyword that found the record.
 * Two reasons, and the second is the important one: the detail page is
 * ~66 KB, and it carries the named principal investigator with their
 * mobile number, email and postal address, and the applicant's contact
 * person with theirs. We have no use for any of it. A `raw` that was
 * 「the page」 would put a stranger's phone number in our database
 * because it happened to be next to a phase number.
 */

import {
  requestText,
  realSleep,
  SingleOriginCookieJar,
  type FetchLike,
  type SleepFn,
} from './trials.http.js';
import type { TrialFetchResult, TrialRecordInput } from './trials.types.js';
import type { AppLogger } from '../../config/logger.js';

export const CDT_ORIGIN = 'https://www.chinadrugtrials.org.cn';
export const CDT_SEARCH_URL = `${CDT_ORIGIN}/clinicaltrials.searchlist.dhtml`;
export const CDT_DETAIL_URL = `${CDT_ORIGIN}/clinicaltrials.searchlistdetail.dhtml`;

/** See the header. Changing this list changes which trials a patient
 *  is shown; it is not a tuning knob. */
export const CDT_KEYWORDS = ['面肩肱', '面肩胛肱', 'FSHD'] as const;

/**
 * Between every request to this host, including the detail pages.
 *
 * It is a government registry with no API and no published crawl
 * policy, and the expected work per run is a handful of requests. 2 s
 * is slower than a human clicking, and what it costs is small: the real
 * run on 2026-08-13 spent 7.2 s on this source in total — four requests
 * (three keywords plus one challenge retry) and the three waits between
 * them.
 */
export const CDT_MIN_REQUEST_INTERVAL_MS = 2_000;

/** Per request. The measured page took 1.1 s cold. */
export const CDT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Refuse rather than truncate.
 *
 * The keywords match 0 records today and an FSHD registration would be
 * one or two. A result set in the hundreds means the keyword list or
 * the site's matching changed, and the honest response to that is a
 * failed run an operator has to look at — NOT the first 60 records
 * written to the table as if they were the whole list, which is the
 * exact shape of 「nothing pretends the list is complete」 that this
 * feature exists to avoid.
 */
export const CDT_MAX_RECORDS = 60;

/**
 * A BACKSTOP FOR COUNTS THAT CONTRADICT EACH OTHER — not the guard for
 * a large result set. That is CDT_MAX_RECORDS, which is checked first.
 *
 * The site paginates at 20 rows a page (36,138 records / 1,807 pages on
 * the unfiltered list, 2026-08-13), so a result set small enough to
 * pass CDT_MAX_RECORDS = 60 is at most 3 pages by arithmetic and this
 * check cannot fire on it. What it does catch is the site reporting 9
 * records across 200 pages: a pager we would otherwise follow for 200
 * requests at CDT_MIN_REQUEST_INTERVAL_MS apart against a government
 * registry, on the strength of a number the same page has already
 * contradicted.
 */
export const CDT_MAX_PAGES = 3;

const CTR_ID_PATTERN = /^CTR\d{8}$/;
const DETAIL_ID_PATTERN = /^[0-9a-f]{32}$/;
/** Anything left looking like an HTML entity after decodeEntities. */
const RESIDUAL_ENTITY_PATTERN = /&[a-zA-Z#][a-zA-Z0-9]{0,8};/;

// --------------------------------------------------------------- HTML

/** The highest code point there is. Above it, `String.fromCodePoint`
 *  throws rather than returning a character. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * One numeric entity, or a failure that says where it came from.
 *
 * `String.fromCodePoint` is not total, and not every string it does
 * return can be stored. Three forms, each spliced into the title on the
 * real 9-row results page and driven through `_parseSearchList` on
 * 2026-08-14, then through `SELECT $1::text` and `SELECT $1::jsonb` on
 * the dev database for the two that survived the parse:
 *
 *   &#999999999;  fromCodePoint threw 「RangeError: Invalid code point
 *                 999999999」 — no source, no step, no CTR number.
 *   &#xD800;      decoded to a lone surrogate. `title` reached Postgres
 *                 as U+FFFD, and the same character inside the `raw`
 *                 jsonb was rejected —「invalid input syntax for type
 *                 json」 — so the transaction fails on a driver message
 *                 two layers from the page that caused it.
 *   &#0;          decoded to NUL, which Postgres refuses in text at all
 *                 —「invalid byte sequence for encoding "UTF8": 0x00」.
 *
 * None of the three is a silent wrong answer, so the run does fail
 * either way. What they lacked is a label: every other failure in this
 * file names the source and the step, and these arrived in
 * `trial_fetch_runs.error` as a bare RangeError or driver string.
 */
const decodeNumericEntity = (
  entity: string,
  digits: string,
  radix: number,
  label: string,
): string => {
  const codePoint = Number.parseInt(digits, radix);
  const unusable =
    codePoint > MAX_CODE_POINT
      ? 'above U+10FFFF, the highest code point there is'
      : codePoint >= 0xd800 && codePoint <= 0xdfff
        ? 'an unpaired surrogate'
        : codePoint === 0
          ? 'NUL, which Postgres refuses in text'
          : null;
  if (unusable !== null) {
    throw new Error(`${label}: HTML numeric entity ${entity} is ${unusable}`);
  }
  return String.fromCodePoint(codePoint);
};

/**
 * The entities this site actually emits, plus numeric escapes.
 *
 * Deliberately not a full HTML entity table: this is a Chinese-language
 * registry and the values we read are Chinese text, CTR numbers and
 * dates. `&nbsp;` is the one that matters — the status cell is written
 * `进行中&nbsp;尚未招募` — and the standard five show up in titles.
 *
 * `textOf` throws if anything entity-shaped survives, so the cost of
 * this list being short is a loud failure, never a 「&bull;」 printed
 * to a patient. NAMED entities are the ones that fail that way;
 * `&#8226;` is decoded by the numeric branches below and comes out as
 * the bullet character itself. Both halves of that are pinned by tests
 * that splice each form into a real title: the named one fails the run,
 * the numeric one becomes 「•」. A numeric escape that is not a storable
 * character fails too, with the source and the step named — see
 * decodeNumericEntity.
 */
const decodeEntities = (value: string, label: string): string =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (entity: string, hex: string) =>
      decodeNumericEntity(entity, hex, 16, label),
    )
    .replace(/&#(\d+);/g, (entity: string, dec: string) =>
      decodeNumericEntity(entity, dec, 10, label),
    )
    // Last, so `&amp;lt;` decodes to the literal `&lt;` and not to `<`
    // — and then FAILS THE RUN, because `&lt;` is entity-shaped and
    // textOf's residual check throws on it. Measured, by splicing it
    // into a title on the real results page:
    //
    //   '&amp;lt;' -> 'search page 1: undecoded HTML entity &lt; in
    //                  extracted text'
    //
    // That is the intended outcome, not an oversight: the alternative
    // is deciding, on behalf of the registry, whether a title that
    // arrived doubly escaped meant a literal `&lt;` or a `<`. A run an
    // operator has to look at is cheaper than a title we made up. The
    // test 「fails the run on an escaped entity」 pins it.
    .replace(/&amp;/g, '&');

/**
 * The visible text of an HTML fragment: tags dropped, entities
 * decoded, whitespace collapsed.
 *
 * Whitespace collapsing is not normalisation of the registry's words —
 * it is undoing the markup. The status cell arrives as a newline, four
 * tabs, `进行中&nbsp;尚未招募`, a newline and five tabs, and 「the
 * registry's word, verbatim」 means 进行中 尚未招募, not that.
 */
const textOf = (fragment: string, label: string): string => {
  const decoded = decodeEntities(fragment.replace(/<[^>]*>/g, ' '), label);
  const residual = RESIDUAL_ENTITY_PATTERN.exec(decoded);
  if (residual) {
    throw new Error(`${label}: undecoded HTML entity ${residual[0]} in extracted text`);
  }
  return decoded.replace(/\s+/g, ' ').trim();
};

const cellsOf = (rowHtml: string, label: string): string[] =>
  [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
    textOf(match[1] ?? '', label),
  );

const rowsOf = (tableHtml: string): string[] =>
  [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? '');

/**
 * The markup between a start marker and the next `</table>`. Used to
 * scope a label lookup to one table, because several labels on the
 * detail page appear in more than one of them (`申请人名称` is in the
 * 基本信息 panel AND under 二、申请人信息, where the cell beside it is
 * a row number).
 *
 * It stops at the FIRST `</table>`, so it must only be pointed at a
 * table with none nested inside it. The detail page has nested tables
 * — 入选标准 and 排除标准 hold one each — and none of the four markers
 * used below reach them.
 */
const tableFrom = (html: string, tableStart: number): string | undefined => {
  if (tableStart === -1) return undefined;
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableEnd === -1) return undefined;
  return html.slice(tableStart, tableEnd);
};

const tableAfter = (html: string, marker: string): string | undefined => {
  const start = html.indexOf(marker);
  if (start === -1) return undefined;
  return tableFrom(html, html.indexOf('<table', start));
};

/** The table whose OPENING TAG contains the marker — for
 *  `class="searchTable"`, which sits inside `<table …>` rather than in
 *  a heading before it. */
const tableWithAttribute = (html: string, marker: string): string | undefined => {
  const start = html.indexOf(marker);
  if (start === -1) return undefined;
  return tableFrom(html, html.lastIndexOf('<table', start));
};

/**
 * `<th>label</th><td>value</td>` — the shape of every field table on
 * the detail page. Returns the text of the first `<td>` after the
 * first `<th>` whose text is exactly `label`.
 */
const labelledValue = (tableHtml: string, label: string, context: string): string | undefined => {
  const cells = [...tableHtml.matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell?.[1]?.toLowerCase() !== 'th') continue;
    if (textOf(cell[2] ?? '', context) !== label) continue;
    const next = cells[index + 1];
    if (next?.[1]?.toLowerCase() !== 'td') return undefined;
    const value = textOf(next[2] ?? '', context);
    return value.length > 0 ? value : undefined;
  }
  return undefined;
};

// --------------------------------------------------------------- list

export interface CdtListRow {
  /** 登记号, e.g. `CTR20252821`. */
  ctr: string;
  /** The 32-hex key the detail page is addressed by. */
  detailId: string;
  /** 试验状态, verbatim: `已完成`, `进行中 尚未招募`, `主动终止`. */
  statusRaw: string;
  drugName: string;
  indication: string;
  /** 试验通俗题目 — the plain-language title, which is the one a
   *  patient should be shown. May be empty; the detail page is the
   *  fallback. */
  plainTitle: string;
}

export interface CdtSearchPage {
  totalRecords: number;
  totalPages: number;
  rows: CdtListRow[];
}

/**
 * One search-results page.
 *
 * Exported for its test, which drives it with three real captures: a
 * page with rows, a page with none, and the anti-bot challenge.
 */
export const _parseSearchList = (html: string, label: string): CdtSearchPage => {
  const table = tableWithAttribute(html, 'class="searchTable"');
  if (table === undefined) {
    // The single most important failure in this file. No table means we
    // are not looking at a results page — the challenge, an error page,
    // a redesign — and the caller must not read that as 「no trials」.
    throw new Error(`${label}: no results table in the response (${html.length} bytes)`);
  }

  // 「当前第 <i>1</i> 页，共 <i>2</i> 页，共 <i>23</i> 条记录」. The
  // counts are the site's own and are what the completeness check in
  // fetchChinaDrugTrials is made of, so a page that renders the table
  // but not the counts is also a failure.
  const recordsMatch = /共\s*<i>(\d+)<\/i>\s*条记录/.exec(html);
  const pagesMatch = /共\s*<i>(\d+)<\/i>\s*页/.exec(html);
  if (!recordsMatch || !pagesMatch) {
    throw new Error(`${label}: results table present but the record/page counts are missing`);
  }

  const rows: CdtListRow[] = [];
  for (const row of rowsOf(table)) {
    const cells = cellsOf(row, label);
    // The header row is `<th>`s, so it yields no cells at all.
    if (cells.length === 0) continue;
    // 「暂无数据...」 in a single colspan=6 cell: a real, empty result.
    if (cells.length === 1 && cells[0]?.startsWith('暂无数据')) continue;
    if (cells.length !== 6) {
      throw new Error(`${label}: a result row had ${cells.length} cells, expected 6`);
    }

    const ctr = cells[1] ?? '';
    if (!CTR_ID_PATTERN.test(ctr)) {
      // Every 登记号 in both searches run on 2026-08-13 (15 records
      // across 肌营养不良 and 杜氏) was CTR + 8 digits. A different
      // shape means the column moved or the id format changed, and
      // either way this row's identity — the table's primary key — is
      // not something to guess at.
      throw new Error(`${label}: 登记号 cell is not a CTR number (${JSON.stringify(ctr)})`);
    }

    const detailIdMatch = /id="([0-9a-f]{32})"/.exec(row);
    if (!detailIdMatch?.[1]) {
      throw new Error(`${label}: ${ctr} has no detail id in its row`);
    }

    const statusRaw = cells[2] ?? '';
    if (statusRaw.length === 0) {
      throw new Error(`${label}: ${ctr} has an empty 试验状态 cell`);
    }

    rows.push({
      ctr,
      detailId: detailIdMatch[1],
      statusRaw,
      drugName: cells[3] ?? '',
      indication: cells[4] ?? '',
      plainTitle: cells[5] ?? '',
    });
  }

  return {
    totalRecords: Number.parseInt(recordsMatch[1] ?? '', 10),
    totalPages: Number.parseInt(pagesMatch[1] ?? '', 10),
    rows,
  };
};

// ------------------------------------------------------------- detail

export interface CdtDetail {
  ctr: string;
  sponsor: string | null;
  /** 试验分期, the registry's own token: `I期`, `II期`, `IV期`. NOT
   *  ctgov's vocabulary — see the note in refresh.ts. */
  phase: string | null;
  /** 试验范围: 国内试验 / 国际多中心试验. Kept in `raw` only. */
  scope: string | null;
  /** 首次公示信息日期. Kept in `raw` only — it is not a last-changed
   *  date. See the header. */
  firstDisclosedOn: string | null;
  /** The distinct 国家或地区 column of 各参加机构信息. */
  countries: string[];
  professionalTitle: string | null;
  plainTitle: string | null;
}

/**
 * The fields we take off a detail page, and no others.
 *
 * Exported for its test, which drives it with
 * __fixtures__/chinadrugtrials.detail.html — a real capture of
 * CTR20252821, which is a DMD trial, because on 2026-08-13 no FSHD
 * trial was registered here to capture. The four contact fields in
 * that capture were overwritten before it was committed; see the
 * fixture module.
 */
export const _parseDetail = (html: string, label: string): CdtDetail => {
  // The four sections this parser reads are page TEMPLATE, not optional
  // content — every one of them is on the captured page and they are
  // headings the site renders for every registered trial. So a missing
  // section is treated as the page having changed shape, and fails the
  // run, rather than as 「this trial has no phase」. A field that is
  // present but blank is the registry leaving it blank, and comes back
  // as null.
  const section = (marker: string): string => {
    const table = tableAfter(html, marker);
    if (table === undefined) {
      throw new Error(`${label}: no ${marker} table (${html.length} bytes)`);
    }
    return table;
  };

  // 基本信息 is the first panel on the page and the only place
  // 申请人名称 carries the applicant's name — the label appears again
  // under 二、申请人信息, where the cell next to it is a row number.
  const basics = section('基本信息');
  const titles = section('一、题目和背景信息');
  const design = section('2、试验设计');
  const sites = section('各参加机构信息');

  const ctr = labelledValue(basics, '登记号', label);
  if (!ctr || !CTR_ID_PATTERN.test(ctr)) {
    throw new Error(`${label}: 基本信息 has no usable 登记号 (${JSON.stringify(ctr)})`);
  }

  // 各参加机构信息 lists one row per participating site with a
  // 国家或地区 column. The column index is read from the header rather
  // than hard-coded, because the neighbouring columns are the site name
  // and the named investigator, and reading the wrong one would put a
  // person's name in `countries`.
  const headers = [...sites.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((match) =>
    textOf(match[1] ?? '', label),
  );
  const countryColumn = headers.indexOf('国家或地区');
  if (countryColumn === -1) {
    throw new Error(`${label}: 各参加机构信息 has no 国家或地区 column`);
  }
  const countries: string[] = [];
  for (const row of rowsOf(sites)) {
    const cells = cellsOf(row, label);
    if (cells.length === 0) continue;
    const country = cells[countryColumn];
    if (country && !countries.includes(country)) countries.push(country);
  }

  return {
    ctr,
    sponsor: labelledValue(basics, '申请人名称', label) ?? null,
    phase: labelledValue(design, '试验分期', label) ?? null,
    scope: labelledValue(design, '试验范围', label) ?? null,
    firstDisclosedOn: labelledValue(basics, '首次公示信息日期', label) ?? null,
    countries,
    professionalTitle: labelledValue(titles, '试验专业题目', label) ?? null,
    plainTitle: labelledValue(titles, '试验通俗题目', label) ?? null,
  };
};

// -------------------------------------------------------------- fetch

export interface ChinaDrugTrialsFetcherDeps {
  fetchImpl: FetchLike;
  logger: AppLogger;
  sleep?: SleepFn;
  now?: () => Date;
}

export const fetchChinaDrugTrials = async (
  deps: ChinaDrugTrialsFetcherDeps,
): Promise<TrialFetchResult> => {
  const { fetchImpl, logger } = deps;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? (() => new Date());

  const jar = new SingleOriginCookieJar();
  let nextAllowedAtMs = 0;

  /**
   * One request, rate limited, with the cookie replay the anti-bot gate
   * needs.
   *
   * `isExpected` is what 「we got the page」 means for this request. The
   * retry is not a general 「try again on error」: it exists because the
   * first request of a session is ANSWERED, with 202 and a page, and
   * the only way to tell that page from a results page is to look for
   * what a results page has.
   */
  const requestPage = async (
    url: string,
    init: RequestInit,
    label: string,
    isExpected: (body: string) => boolean,
  ): Promise<string> => {
    let last = { status: 0, bytes: 0 };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const waitMs = nextAllowedAtMs - now().getTime();
      if (waitMs > 0) await sleep(waitMs);

      const cookie = jar.header();
      const { response, body } = await requestText(
        fetchImpl,
        url,
        {
          ...init,
          headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
        },
        CDT_REQUEST_TIMEOUT_MS,
        label,
      );
      nextAllowedAtMs = now().getTime() + CDT_MIN_REQUEST_INTERVAL_MS;
      jar.absorb(response);
      last = { status: response.status, bytes: body.length };

      if (isExpected(body)) return body;

      if (attempt === 1) {
        logger.warn(
          { source: 'chinadrugtrials', label, status: response.status, bytes: body.length },
          'chinadrugtrials answered with something other than the page; retrying once with the cookies it just set',
        );
      }
    }

    // Names what we saw, not what we guess it was. The body is not
    // included: it is ~25 KB of anti-bot script and this string is read
    // by a human out of trial_fetch_runs.error.
    throw new Error(
      `${label}: did not return the expected page after 2 attempts (last HTTP ${last.status}, ${last.bytes} bytes, ${jar.size} cookies held)`,
    );
  };

  const searchOnce = async (keyword: string, page: number): Promise<CdtSearchPage> => {
    // Exactly the fields the site's own search form posts (its
    // `#searchfrm`, read on 2026-08-13). `rule`/`sort` fix the ordering
    // so page 2 of a run follows page 1 of the same run.
    const form = new URLSearchParams({
      keywords: keyword,
      currentpage: String(page),
      rule: 'CTR',
      sort: 'desc',
      sort2: '',
      secondLevel: '0',
      id: '',
      ckm_index: '',
    });

    // The keyword is not in the label: labels reach
    // trial_fetch_runs.error, and while these keywords are constants
    // today, a label that interpolates a search term is one refactor
    // away from writing somebody's query into a table.
    const label = `chinadrugtrials search page ${page}`;
    const body = await requestPage(
      CDT_SEARCH_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      },
      label,
      (text) => text.includes('class="searchTable"'),
    );
    return _parseSearchList(body, label);
  };

  const rowsByCtr = new Map<string, { row: CdtListRow; keyword: string }>();
  /**
   * The site's own 共 N 条记录, added up over the keyword searches.
   *
   * Not the same number as `records.length`: a trial matching two
   * keywords is counted here twice and written once, so this is >= what
   * we write. It is carried out of this function because
   * `records.length === 0` and 「the registry says there is nothing」
   * are different claims, and only the second one may be shown to a
   * patient. See migration 027.
   */
  let reportedTotal = 0;

  for (const keyword of CDT_KEYWORDS) {
    const first = await searchOnce(keyword, 1);
    const collected: CdtListRow[] = [...first.rows];

    if (first.totalRecords > CDT_MAX_RECORDS) {
      throw new Error(
        `chinadrugtrials: a keyword matched ${first.totalRecords} records, more than the ${CDT_MAX_RECORDS} this fetcher will read; refusing rather than writing a truncated list`,
      );
    }
    if (first.totalPages > CDT_MAX_PAGES) {
      throw new Error(
        `chinadrugtrials: a keyword returned ${first.totalPages} pages, more than the ${CDT_MAX_PAGES} this fetcher will read`,
      );
    }

    for (let page = 2; page <= first.totalPages; page += 1) {
      const next = await searchOnce(keyword, page);
      collected.push(...next.rows);
    }

    // The site's own count, against what we parsed. A row the regexes
    // walked past — a layout change in one cell, a colspan we did not
    // expect — lands here rather than as a silently shorter list.
    if (collected.length !== first.totalRecords) {
      throw new Error(
        `chinadrugtrials: parsed ${collected.length} rows but the site reported ${first.totalRecords} records`,
      );
    }

    reportedTotal += first.totalRecords;

    for (const row of collected) {
      // A trial matching two keywords is one trial. First keyword wins,
      // and which one is recorded in `raw`.
      if (!rowsByCtr.has(row.ctr)) rowsByCtr.set(row.ctr, { row, keyword });
    }
  }

  const records: TrialRecordInput[] = [];
  for (const { row, keyword } of rowsByCtr.values()) {
    if (!DETAIL_ID_PATTERN.test(row.detailId)) {
      throw new Error(`chinadrugtrials: ${row.ctr} has a malformed detail id`);
    }
    const detailUrl = `${CDT_DETAIL_URL}?id=${row.detailId}`;
    const label = `chinadrugtrials detail ${row.ctr}`;
    const body = await requestPage(detailUrl, { method: 'GET' }, label, (text) =>
      text.includes('searchDetailTable'),
    );
    const detail = _parseDetail(body, label);

    if (detail.ctr !== row.ctr) {
      // The row's detail id addressed a different record. Following a
      // link and taking whatever came back is how one trial's phase
      // ends up on another trial's card.
      throw new Error(
        `chinadrugtrials: the detail page for ${row.ctr} identifies itself as ${detail.ctr}`,
      );
    }

    const title = row.plainTitle || detail.plainTitle || detail.professionalTitle;
    if (!title) {
      throw new Error(`chinadrugtrials: ${row.ctr} has no title on the list or the detail page`);
    }

    records.push({
      source: 'chinadrugtrials',
      sourceId: row.ctr,
      title,
      // Already Chinese, so there is nothing to translate and
      // status_zh stays NULL — which every surface renders as
      // 「show status_raw」. See status-map.ts.
      statusRaw: row.statusRaw,
      statusZh: null,
      phase: detail.phase,
      sponsor: detail.sponsor,
      countries: detail.countries.length > 0 ? detail.countries : null,
      url: detailUrl,
      // Always. The platform publishes no last-changed date; see the
      // header.
      sourceUpdatedAt: null,
      raw: {
        fetchedVia: 'scrape',
        keyword,
        listUrl: CDT_SEARCH_URL,
        detailUrl,
        list: {
          登记号: row.ctr,
          试验状态: row.statusRaw,
          药物名称: row.drugName,
          适应症: row.indication,
          试验通俗题目: row.plainTitle,
        },
        detail: {
          申请人名称: detail.sponsor,
          试验分期: detail.phase,
          试验范围: detail.scope,
          首次公示信息日期: detail.firstDisclosedOn,
          试验专业题目: detail.professionalTitle,
          试验通俗题目: detail.plainTitle,
          参加机构国家或地区: detail.countries,
        },
      },
    });
  }

  logger.info(
    {
      source: 'chinadrugtrials',
      keywords: CDT_KEYWORDS.length,
      records: records.length,
      reportedTotal,
    },
    'Read the FSHD trial list from 药物临床试验登记与信息公示平台',
  );

  return {
    source: 'chinadrugtrials',
    fetchedAt: now(),
    records,
    sourceReportedTotal: reportedTotal,
  };
};
