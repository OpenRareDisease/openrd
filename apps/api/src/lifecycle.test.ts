import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetShutdownState,
  assertShutdownTimingIsOrdered,
  createShutdownSequencer,
  isShuttingDown,
  type ShutdownServer,
} from './lifecycle.js';

/**
 * The shutdown sequencer had no test at all, and was structured so it
 * could not have one: it sat at module scope in index.ts next to
 * `app.listen(env.PORT)`, so any import bound a port. Both defects this
 * file pins shipped through that gap — a drain that outlives the grace
 * deadline (so `server.close()` and the pool close never run), and a
 * second Ctrl-C being discarded while a stuck SSE stream held the drain
 * open for the full 20s.
 *
 * Everything here runs on fake timers with an injected `exit`, so the
 * ordering is asserted directly rather than inferred from a log line.
 */

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/** Records what the sequencer did to the listener, and lets a test hold
 *  `close()` open the way an in-flight SSE stream does. */
const fakeServer = () => {
  const calls = {
    closeIdleConnections: 0,
    closeAllConnections: 0,
    close: 0,
  };
  let closeCallback: ((error?: Error) => void) | undefined;
  const server: ShutdownServer = {
    close: (callback) => {
      calls.close += 1;
      closeCallback = callback;
    },
    closeIdleConnections: () => {
      calls.closeIdleConnections += 1;
    },
    closeAllConnections: () => {
      calls.closeAllConnections += 1;
    },
  };
  return {
    server,
    calls,
    /** Stand in for the last open connection finishing. */
    finishClose: (error?: Error) => closeCallback?.(error),
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  _resetShutdownState();
  silentLogger.info.mockClear();
  silentLogger.warn.mockClear();
  silentLogger.error.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  _resetShutdownState();
});

describe('assertShutdownTimingIsOrdered', () => {
  // The two knobs are ordered, not additive: the grace deadline is armed
  // when the signal lands and the listener is not closed until the drain
  // elapses. env.ts validates each in isolation (min 0 / min 1000) and
  // nothing checks them against each other, so this pair was accepted at
  // boot and inverted the whole shutdown at the next deploy.
  it('accepts the shipped defaults', () => {
    expect(() => assertShutdownTimingIsOrdered(5_000, 20_000)).not.toThrow();
  });

  it('rejects a drain that outlives the grace period', () => {
    expect(() => assertShutdownTimingIsOrdered(30_000, 20_000)).toThrow(
      /Invalid shutdown configuration/,
    );
  });

  it('rejects a drain equal to the grace period, where the two timers race', () => {
    expect(() => assertShutdownTimingIsOrdered(20_000, 20_000)).toThrow(/ordered, not.*additive/s);
  });

  it('rejects a drain that leaves less than the minimum close window', () => {
    expect(() => assertShutdownTimingIsOrdered(19_500, 20_000)).toThrow(/at least 1000ms/);
  });

  it('names both knobs so the operator knows which one to move', () => {
    expect(() => assertShutdownTimingIsOrdered(30_000, 20_000)).toThrow(
      /SHUTDOWN_READINESS_DRAIN_MS.*SHUTDOWN_GRACE_MS/s,
    );
  });
});

describe('createShutdownSequencer', () => {
  it('refuses to build with an inverted drain/grace pair', () => {
    // Constructed before `app.listen` in index.ts precisely so this
    // throws during boot rather than at the next SIGTERM.
    expect(() =>
      createShutdownSequencer({
        server: fakeServer().server,
        closePool: async () => undefined,
        readinessDrainMs: 30_000,
        graceMs: 20_000,
        logger: silentLogger,
      }),
    ).toThrow(/Invalid shutdown configuration/);
  });

  it('fails readiness immediately and keeps serving for the whole drain', () => {
    const { server, calls } = fakeServer();
    const shutdown = createShutdownSequencer({
      server,
      closePool: async () => undefined,
      readinessDrainMs: 5_000,
      graceMs: 20_000,
      logger: silentLogger,
      exit: vi.fn(),
    });

    expect(isShuttingDown()).toBe(false);
    shutdown('SIGTERM');

    // Step 1 is the readiness flip, and it has to happen before the
    // listener closes or the LB keeps routing into a closed socket.
    expect(isShuttingDown()).toBe(true);
    expect(calls.close).toBe(0);

    vi.advanceTimersByTime(4_999);
    expect(calls.close).toBe(0);

    vi.advanceTimersByTime(1);
    expect(calls.close).toBe(1);
    expect(calls.closeIdleConnections).toBe(1);
  });

  it('closes the pool after the listener, then exits 0', async () => {
    const { server, finishClose } = fakeServer();
    const order: string[] = [];
    const exit = vi.fn((code: number) => order.push(`exit:${code}`));
    const shutdown = createShutdownSequencer({
      server,
      closePool: async () => {
        order.push('closePool');
      },
      readinessDrainMs: 5_000,
      graceMs: 20_000,
      logger: silentLogger,
      exit,
    });

    shutdown('SIGTERM');
    vi.advanceTimersByTime(5_000);
    finishClose();
    // The pool close is a promise; let its .then run.
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(['closePool', 'exit:0']);
  });

  it('does not force-exit once the clean path has completed', async () => {
    const { server, finishClose } = fakeServer();
    const exit = vi.fn();
    const shutdown = createShutdownSequencer({
      server,
      closePool: async () => undefined,
      readinessDrainMs: 5_000,
      graceMs: 20_000,
      logger: silentLogger,
      exit,
    });

    shutdown('SIGTERM');
    vi.advanceTimersByTime(5_000);
    finishClose();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledTimes(1);

    // Past the grace deadline: the force-exit timer must have been
    // cleared, or a completed shutdown would exit(1) on top of exit(0).
    await vi.advanceTimersByTimeAsync(30_000);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('force-exits at the grace deadline when a connection never finishes', () => {
    // An SSE stream with a keepalive timer never closes on its own, and
    // closeIdleConnections deliberately does not touch in-flight
    // requests — so without the deadline one subscriber blocks the
    // deploy forever.
    const { server } = fakeServer();
    const exit = vi.fn();
    const shutdown = createShutdownSequencer({
      server,
      closePool: async () => undefined,
      readinessDrainMs: 5_000,
      graceMs: 20_000,
      logger: silentLogger,
      exit,
    });

    shutdown('SIGTERM');
    vi.advanceTimersByTime(19_999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('escalates on a second signal instead of swallowing it', () => {
    // The old guard was a bare `if (shuttingDown) return;`. Installing
    // SIGINT/SIGTERM listeners replaces Node's default terminate action,
    // so a developer pressing Ctrl-C a second time during a stuck drain
    // got nothing at all until the 20s deadline.
    const { server, calls } = fakeServer();
    const exit = vi.fn();
    const shutdown = createShutdownSequencer({
      server,
      closePool: async () => undefined,
      readinessDrainMs: 5_000,
      graceMs: 20_000,
      logger: silentLogger,
      exit,
    });

    shutdown('SIGINT');
    expect(calls.closeAllConnections).toBe(0);
    expect(exit).not.toHaveBeenCalled();

    shutdown('SIGINT');
    expect(calls.closeAllConnections).toBe(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(silentLogger.warn).toHaveBeenCalledWith(
      { signal: 'SIGINT' },
      expect.stringContaining('second shutdown signal'),
    );
  });

  it('does not restart the drain when a second signal arrives', () => {
    const { server, calls } = fakeServer();
    const shutdown = createShutdownSequencer({
      server,
      closePool: async () => undefined,
      readinessDrainMs: 5_000,
      graceMs: 20_000,
      logger: silentLogger,
      exit: vi.fn(),
    });

    shutdown('SIGTERM');
    vi.advanceTimersByTime(5_000);
    expect(calls.close).toBe(1);

    shutdown('SIGTERM');
    vi.advanceTimersByTime(10_000);
    // A second sequence would have armed a second drain timer and called
    // close() again — harmless on Node, but it would also re-arm a
    // second force-exit and make the deadline unpredictable.
    expect(calls.close).toBe(1);
  });

  it('still exits when closing the HTTP server reports an error', async () => {
    const { server, finishClose } = fakeServer();
    const exit = vi.fn();
    const shutdown = createShutdownSequencer({
      server,
      closePool: async () => undefined,
      readinessDrainMs: 5_000,
      graceMs: 20_000,
      logger: silentLogger,
      exit,
    });

    shutdown('SIGTERM');
    vi.advanceTimersByTime(5_000);
    finishClose(new Error('server was not open'));
    await vi.advanceTimersByTimeAsync(0);

    expect(silentLogger.error).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
