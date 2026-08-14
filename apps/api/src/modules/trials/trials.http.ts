/**
 * The HTTP the two fetchers share: who we say we are, how long we
 * wait, and — for the scraped source only — a cookie jar.
 *
 * Both fetchers take a `fetchImpl` so their tests never touch the
 * network. Nothing in this file retries on its own: a retry policy
 * that lives under the fetchers would hide the difference between
 * 「the registry is slow」 and 「the registry is gone」 from the run
 * record, and that difference is the thing the trial page has to be
 * able to say out loud.
 */

/**
 * What we send as `User-Agent` to both registries.
 *
 * A real one, naming the project and a URL an operator can read,
 * because the alternative on a scraped government site is being an
 * anonymous robot that somebody eventually blocks without being able
 * to ask us to stop first. Verified on 2026-08-13 that
 * www.chinadrugtrials.org.cn serves this UA exactly as it serves a
 * browser UA — the gate in front of that site is a cookie challenge,
 * not a UA filter (see chinadrugtrials.fetcher.ts):
 *
 *   curl -sS -L -A 'openrd-trials/1.0 (+https://github.com/OpenRareDisease/openrd)' \
 *     -b jar -c jar --data-urlencode 'keywords=杜氏' \
 *     --data 'currentpage=1&rule=CTR&sort=desc&sort2=&secondLevel=0&id=&ckm_index=' \
 *     'https://www.chinadrugtrials.org.cn/clinicaltrials.searchlist.dhtml'
 *
 *   first call  202, 25101 bytes, no results table
 *   second call 200, 52982 bytes, 6 records
 */
export const TRIALS_USER_AGENT = 'openrd-trials/1.0 (+https://github.com/OpenRareDisease/openrd)';

/** Narrower than `typeof fetch` so a test double does not have to
 *  satisfy every overload of the DOM signature. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Injected in tests so a rate-limited scrape does not make the suite
 *  take as long as the scrape. */
export type SleepFn = (ms: number) => Promise<void>;

export const realSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * One HTTP request, with a deadline, returning the body as text.
 *
 * `label` is what the error says when this fails, and it is what an
 * operator reads in `trial_fetch_runs.error` — so it names the source
 * and the step ('ctgov page 2', 'chinadrugtrials detail CTR20252821'),
 * not the URL, which may carry a search keyword.
 *
 * Timeouts come back as an ordinary Error naming the budget rather
 * than as a DOMException nobody recognises. The response body is NOT
 * put in any message here: on the scraped source a failure body is a
 * 25 KB anti-bot page, and `trial_fetch_runs.error` is read by a human.
 */
export const requestText = async (
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<{ response: Response; body: string }> => {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: { 'User-Agent': TRIALS_USER_AGENT, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`${label}: no response within ${timeoutMs}ms`);
    }
    throw new Error(
      `${label}: request failed (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  // Read the body even for a non-ok status: the caller decides what a
  // status means (chinadrugtrials answers its challenge with 202 and a
  // real page), and a Response whose body is never read leaks the
  // socket back into the agent pool half-consumed.
  const body = await response.text();
  return { response, body };
};

/**
 * The smallest cookie jar that gets past www.chinadrugtrials.org.cn.
 *
 * That site answers the first request of a session with an anti-bot
 * page (HTTP 202, ~25 KB, no results table) plus two `Set-Cookie`
 * headers, and serves the real page to the next request that sends
 * them back. Node's `fetch` keeps no cookies at all, so without this
 * every request would get the challenge and the domestic half of the
 * list would be permanently 「取不到」.
 *
 * Deliberately not a general cookie implementation: no domain
 * matching, no path matching, no expiry. It is used against exactly
 * one origin, inside one process that lives for one refresh, and the
 * moment it is pointed at a second origin those omissions become
 * cookie leakage between hosts. If you need that, take a dependency
 * instead of growing this.
 */
export class SingleOriginCookieJar {
  private readonly cookies = new Map<string, string>();

  /**
   * `Headers.getSetCookie()` is the only API that survives more than
   * one `Set-Cookie` on a response — `headers.get('set-cookie')`
   * returns them comma-joined, and cookie attributes contain commas
   * (`expires=Sun, 10 Aug 2036 ...`), so splitting that string is how
   * you end up sending half a cookie. Every Node this repo runs on has
   * it (root package.json `engines` requires >= 20.12; checked present
   * on the v22.21.0 this was developed against), so its absence means a
   * test double handed us something that is not a `Headers` — say so
   * rather than silently collecting nothing and blaming the site.
   */
  absorb(response: Pick<Response, 'headers'>): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof headers.getSetCookie !== 'function') {
      throw new Error(
        'cookie jar: response headers have no getSetCookie(); cannot read Set-Cookie reliably',
      );
    }
    for (const raw of headers.getSetCookie()) {
      const pair = raw.split(';', 1)[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  /** `undefined` when empty, so callers can spread it into a headers
   *  object without sending `Cookie: `. */
  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  get size(): number {
    return this.cookies.size;
  }
}
