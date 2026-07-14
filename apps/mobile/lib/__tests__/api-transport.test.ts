import { ApiError, NETWORK_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE, apiRequest } from '../api';

jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('apiRequest transport hardening', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('retries a GET exactly once on a network failure, then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(apiRequest('/healthz')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a friendly network ApiError when the GET retry also fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    const promise = apiRequest('/healthz');
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest('/healthz')).rejects.toMatchObject({
      code: 'network',
      message: NETWORK_ERROR_MESSAGE,
    });
  });

  it('NEVER retries a mutation — a timed-out POST may have committed server-side', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(apiRequest('/profiles', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      code: 'network',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps an aborted request to a timeout ApiError', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await expect(apiRequest('/slow', { method: 'POST' })).rejects.toMatchObject({
      code: 'timeout',
      message: TIMEOUT_ERROR_MESSAGE,
    });
  });

  it('actually fires the deadline: a hung request aborts after the timeout elapses', async () => {
    jest.useFakeTimers();
    try {
      // A fetch that never resolves on its own — it only rejects when
      // the AbortSignal we were handed fires. If apiRequest forgot to
      // arm the timer, this test would hang (and fail on timeout).
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            (init.signal as AbortSignal).addEventListener('abort', () => {
              reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            });
          }),
      );

      const pending = apiRequest('/hung', { method: 'POST' });
      // Attach the rejection expectation BEFORE advancing time so the
      // rejection is never unhandled. The async advance interleaves
      // microtasks, letting apiRequest's awaits (header build) run to
      // the point where the deadline timer is actually armed.
      const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
      await jest.advanceTimersByTimeAsync(15_001);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes an AbortSignal to fetch so the deadline is enforceable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiRequest('/healthz');
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps HTTP errors as-is (status + payload, no transport code)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '资源不存在' }, 404));

    const error = await apiRequest('/missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toBe('资源不存在');
    expect((error as ApiError).code).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
