import type { AppLogger } from './config/logger.js';

/**
 * Whether the process has been told to stop.
 *
 * Lives in its own module so the readiness probe can see it without
 * importing the server entrypoint (which would run `app.listen` inside
 * every test that touches a route).
 *
 * The point of the flag is ordering. A load balancer discovers that an
 * instance is going away by polling /healthz/ready, and it only stops
 * routing once a poll fails. If the process closes its listener the
 * instant SIGTERM lands, the requests already dispatched between that
 * moment and the LB's next poll hit a closed socket — the client sees a
 * connection reset, which is precisely the failure draining was meant
 * to avoid. So: fail readiness first, keep serving, then close.
 */
let shuttingDown = false;

export const beginShutdown = () => {
  shuttingDown = true;
};

export const isShuttingDown = () => shuttingDown;

/** Test-only. Module state outlives a single test file otherwise. */
export const _resetShutdownState = () => {
  shuttingDown = false;
};

/**
 * The subset of `http.Server` the sequencer touches. Narrowing to this
 * is what makes the whole shutdown ordering testable: the sequencer used
 * to live at module scope in index.ts next to `app.listen(env.PORT)`, so
 * importing it started a listener and no test could reach it. Every
 * defect this file now guards against — drain outliving grace, a second
 * signal being swallowed — shipped because of that.
 */
export interface ShutdownServer {
  close(callback: (error?: Error) => void): void;
  closeIdleConnections(): void;
  closeAllConnections(): void;
}

export interface ShutdownOptions {
  server: ShutdownServer;
  closePool: () => Promise<void>;
  readinessDrainMs: number;
  graceMs: number;
  logger: Pick<AppLogger, 'info' | 'warn' | 'error'>;
  /** Injected so tests can observe the exit instead of taking the
   *  runner down with them. */
  exit?: (code: number) => void;
}

/**
 * The two shutdown knobs are ORDERED, not additive, and nothing checked
 * that they were in the right order.
 *
 * index.ts arms the force-exit at t=0 for the full grace period and only
 * schedules `server.close()` at t=readinessDrainMs. With
 * SHUTDOWN_READINESS_DRAIN_MS=30000 and SHUTDOWN_GRACE_MS=20000 — a
 * combination env.ts accepts, and which the DRAIN docstring's 「must
 * exceed the load balancer's health-check interval」 actively invites for
 * an LB polling every 20s — the drain timer is still pending when the
 * deadline fires. `server.close()` never runs, the pool is never closed,
 * and every in-flight request including an SSE answer mid-stream is
 * severed at the socket, while the log line blames slow clients.
 *
 * Checked at construction so the pair fails at BOOT, in the migrate/start
 * window where an operator is watching, rather than silently at the next
 * deploy's SIGTERM. The right long-term home is a cross-field
 * `.superRefine` in config/env.ts so `loadAppEnv()` rejects it for every
 * consumer; this is the enforcement that can live next to the code the
 * ordering actually belongs to.
 *
 * The margin is not decoration: with drain == grace the close callback
 * and the deadline race on the same tick and which one wins is a
 * scheduling accident.
 */
export const SHUTDOWN_MIN_CLOSE_WINDOW_MS = 1_000;

export const assertShutdownTimingIsOrdered = (readinessDrainMs: number, graceMs: number) => {
  if (readinessDrainMs + SHUTDOWN_MIN_CLOSE_WINDOW_MS > graceMs) {
    throw new Error(
      `Invalid shutdown configuration: SHUTDOWN_READINESS_DRAIN_MS (${readinessDrainMs}) leaves ` +
        `${graceMs - readinessDrainMs}ms of the ${graceMs}ms SHUTDOWN_GRACE_MS for the actual ` +
        `close, and at least ${SHUTDOWN_MIN_CLOSE_WINDOW_MS}ms is needed. The two are ordered, not ` +
        `additive: the grace deadline is armed when the signal lands, and the listener is not ` +
        `closed until the drain elapses — so a drain at or past the deadline means server.close() ` +
        `and the pool close never run at all. Lower SHUTDOWN_READINESS_DRAIN_MS or raise ` +
        `SHUTDOWN_GRACE_MS.`,
    );
  }
};

/**
 * Shut down without dropping work.
 *
 * There was no signal handling at all, so every deploy killed whatever
 * was in flight: an upload mid-write, an SSE answer mid-stream, a
 * transaction between its BEGIN and its COMMIT. The sweep timers in
 * profile.routes.ts are already `.unref()`ed "for graceful shutdown",
 * and profile.controller.ts notes its in-flight OCR map could be
 * drained by one — the pieces were written for a shutdown path that did
 * not exist.
 *
 * Four steps, in this order:
 *
 *  1. Fail readiness. A load balancer only stops routing after a
 *     /healthz/ready poll fails, so closing the listener first would
 *     reset every request dispatched in between — the exact failure
 *     draining exists to prevent.
 *  2. Wait one poll interval, still serving normally.
 *  3. Stop accepting connections and let the open ones finish.
 *  4. Close the pool — last, because the requests being waited on are
 *     still using it.
 *
 * The deadline is the honest part. `server.close()` waits for every
 * open connection, and an SSE stream with a keepalive timer never
 * closes on its own, so without one a single subscribed client would
 * block the deploy indefinitely. Past the grace period the process
 * exits and says why — otherwise the orchestrator's SIGKILL arrives
 * with nothing in the logs to explain it.
 *
 * Background OCR is deliberately NOT waited for. A PaddleOCR parse runs
 * 30–90s, past any sane deploy window, so a document caught mid-parse
 * stays `processing` and the startup stuck-processing sweep flips it to
 * `parse_failed`, which the patient can reparse. Pretending to drain it
 * would just mean always hitting the force-exit.
 */
export const createShutdownSequencer = ({
  server,
  closePool,
  readinessDrainMs,
  graceMs,
  logger,
  exit = (code) => process.exit(code),
}: ShutdownOptions) => {
  assertShutdownTimingIsOrdered(readinessDrainMs, graceMs);

  let started = false;

  return (signal: NodeJS.Signals) => {
    if (started) {
      /**
       * A repeat signal used to hit a bare `if (shuttingDown) return;`
       * and be discarded, which mattered because installing listeners
       * for SIGINT/SIGTERM replaces Node's default terminate action for
       * both. `server.closeIdleConnections()` deliberately does not
       * touch in-flight requests, so a browser tab holding
       * /api/ai/ask/stream open keeps `server.close()` from completing —
       * and a developer pressing Ctrl-C a second time, or an operator
       * issuing a second `docker kill -s TERM` to hurry a stuck drain,
       * got nothing at all until the grace deadline expired 20s later.
       * (SIGQUIT still worked, since nothing listens for it, but nothing
       * about the handling said so.)
       *
       * So the second signal escalates rather than being swallowed:
       * destroy the sockets that are holding the close open, and go.
       * Exit code 1 because this is an aborted drain, not a clean one.
       */
      logger.warn(
        { signal },
        'second shutdown signal received; abandoning the drain and closing open connections now',
      );
      try {
        server.closeAllConnections();
      } catch (error) {
        logger.error({ error }, 'could not force open connections closed');
      }
      exit(1);
      return;
    }
    started = true;
    beginShutdown();
    logger.info(
      { signal, readinessDrainMs, graceMs },
      'shutting down: readiness now reports draining',
    );

    const forceExit = setTimeout(() => {
      logger.warn(
        { signal, graceMs },
        'shutdown grace expired with connections still open; exiting anyway',
      );
      exit(1);
    }, graceMs);
    // The deadline must not itself be the thing keeping the process alive
    // once the work it guards is done.
    forceExit.unref();

    const drainDelay = setTimeout(() => {
      logger.info({ signal }, 'no longer accepting connections');
      server.close((error) => {
        if (error) logger.error({ error }, 'error while closing the HTTP server');
        void closePool().then(() => {
          clearTimeout(forceExit);
          logger.info({ signal }, 'shutdown complete');
          exit(0);
        });
      });
      // Keep-alive sockets sitting idle between requests would otherwise
      // hold `close()` open for their full timeout with no work to show
      // for it. In-flight requests are untouched by this.
      server.closeIdleConnections();
    }, readinessDrainMs);
    drainDelay.unref();
  };
};
