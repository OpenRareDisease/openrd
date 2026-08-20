import { describe, expect, it, vi } from 'vitest';

import { SingleOriginCookieJar, TRIALS_USER_AGENT, requestText } from './trials.http.js';

describe('SingleOriginCookieJar', () => {
  it('keeps every cookie of a multi-Set-Cookie response and sends them back together', () => {
    // The live challenge sets two, and the second is HttpOnly. Reading
    // them with headers.get('set-cookie') would hand back one
    // comma-joined string that cannot be split safely, because
    // `expires=Sun, 10 Aug 2036 …` contains a comma.
    const headers = new Headers();
    headers.append(
      'set-cookie',
      'FSSBBIl1UgzbN7N80T=abc; Path=/; expires=Sun, 10 Aug 2036 22:56:07 GMT',
    );
    headers.append('set-cookie', 'FSSBBIl1UgzbN7N80S=def; Path=/; HttpOnly');

    const jar = new SingleOriginCookieJar();
    jar.absorb(new Response('', { headers }));

    expect(jar.size).toBe(2);
    expect(jar.header()).toBe('FSSBBIl1UgzbN7N80T=abc; FSSBBIl1UgzbN7N80S=def');
  });

  it('sends no header at all when it holds nothing', () => {
    expect(new SingleOriginCookieJar().header()).toBeUndefined();
  });

  it('lets a later response replace a cookie', () => {
    const jar = new SingleOriginCookieJar();
    const first = new Headers();
    first.append('set-cookie', 'a=1; Path=/');
    jar.absorb(new Response('', { headers: first }));
    const second = new Headers();
    second.append('set-cookie', 'a=2; Path=/');
    jar.absorb(new Response('', { headers: second }));

    expect(jar.header()).toBe('a=2');
  });

  it('says so rather than silently collecting nothing when getSetCookie is missing', () => {
    const jar = new SingleOriginCookieJar();
    expect(() =>
      jar.absorb({ headers: new Map() as unknown as Headers } as Pick<Response, 'headers'>),
    ).toThrow('cannot read Set-Cookie reliably');
  });
});

describe('requestText', () => {
  it('identifies us to both registries', async () => {
    // The parameters are declared so the mock HAS a second one:
    // `vi.fn(async () => …)` is a zero-argument mock, and
    // `impl.mock.calls[0][1]` is then a read past the end of an empty
    // tuple. vitest never notices (esbuild strips types);
    // `npm run typecheck` does — TS2493.
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return new Response('ok');
    });
    await requestText(impl, 'https://example.invalid/', { method: 'GET' }, 1_000, 'test');

    const headers = impl.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.['User-Agent']).toBe(TRIALS_USER_AGENT);
    // Names the project and a URL somebody can read, so a registry
    // administrator can find us before deciding to block us.
    expect(TRIALS_USER_AGENT).toContain('https://github.com/OpenRareDisease/openrd');
  });

  it('reads the body of a non-ok response instead of leaving the socket half-consumed', async () => {
    const impl = vi.fn(async () => new Response('nope', { status: 503 }));
    const { response, body } = await requestText(
      impl,
      'https://example.invalid/',
      {},
      1_000,
      'test',
    );

    expect(response.status).toBe(503);
    expect(body).toBe('nope');
  });

  it('arms the deadline on the request itself, rather than only naming one in the message', async () => {
    // §A3 asks for three things on a fetch: a User-Agent, a rate limit
    // and a TIMEOUT. The first two have tests that go red when they are
    // removed; the timeout test below did not — it injects a
    // TimeoutError and proves the message translation, which stays
    // green with `signal` deleted from the request. So this one drives
    // a fetch that never answers on its own: the only thing that can
    // end it is the AbortSignal this function is supposed to arm, and
    // the 25 ms budget is what it must end at.
    let seen: AbortSignal | undefined;
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      seen = signal;
      return new Promise<Response>((_resolve, reject) => {
        const never = setTimeout(() => {
          reject(new Error('nothing aborted this request'));
        }, 2_000);
        signal?.addEventListener('abort', () => {
          clearTimeout(never);
          reject(signal.reason as Error);
        });
      });
    });

    await expect(
      requestText(impl, 'https://example.invalid/', {}, 25, 'ctgov page 1'),
    ).rejects.toThrow('ctgov page 1: no response within 25ms');
    expect(seen).toBeInstanceOf(AbortSignal);
  });

  it('turns a timeout into a message naming the budget and the step', async () => {
    const impl = vi.fn(async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });

    await expect(
      requestText(impl, 'https://example.invalid/', {}, 4_500, 'chinadrugtrials search page 1'),
    ).rejects.toThrow('chinadrugtrials search page 1: no response within 4500ms');
  });

  it('keeps the URL out of the failure message', async () => {
    // Labels reach trial_fetch_runs.error, and a search URL carries a
    // keyword.
    const impl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });

    // `.then(throw, catch)` rather than `.catch(cast)`: the latter
    // leaves the RESOLVED type in the union, so `error.message` does not
    // typecheck and the fact that a resolution would be a test failure
    // is left unstated. This form says it.
    const error = await requestText(
      impl,
      'https://example.invalid/search?keywords=secret',
      {},
      1_000,
      'chinadrugtrials search page 1',
    ).then(
      () => {
        throw new Error('expected requestText to reject');
      },
      (caught: unknown) => caught as Error,
    );

    expect(error.message).toBe('chinadrugtrials search page 1: request failed (ECONNRESET)');
    expect(error.message).not.toContain('secret');
  });
});
