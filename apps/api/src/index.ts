import { loadAppEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { getPool } from './db/pool.js';
import { beginShutdown } from './lifecycle.js';
import { createServer } from './server.js';

const env = loadAppEnv();
const logger = createLogger(env);
const app = createServer({ env, logger });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API server started');
});

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
const READINESS_DRAIN_MS = env.SHUTDOWN_READINESS_DRAIN_MS;
const SHUTDOWN_GRACE_MS = env.SHUTDOWN_GRACE_MS;
let shuttingDown = false;

const closePool = async () => {
  try {
    await getPool().end();
    logger.info('database pool closed');
  } catch (error) {
    // The pool may never have been initialised (a boot that failed
    // early), and failing to close it must not turn a clean shutdown
    // into a crash.
    logger.warn({ error }, 'could not close the database pool');
  }
};

const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  beginShutdown();
  logger.info(
    { signal, readinessDrainMs: READINESS_DRAIN_MS, graceMs: SHUTDOWN_GRACE_MS },
    'shutting down: readiness now reports draining',
  );

  const forceExit = setTimeout(() => {
    logger.warn(
      { signal, graceMs: SHUTDOWN_GRACE_MS },
      'shutdown grace expired with connections still open; exiting anyway',
    );
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
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
        process.exit(0);
      });
    });
    // Keep-alive sockets sitting idle between requests would otherwise
    // hold `close()` open for their full timeout with no work to show
    // for it. In-flight requests are untouched by this.
    server.closeIdleConnections();
  }, READINESS_DRAIN_MS);
  drainDelay.unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// An unhandled rejection takes the process down on Node 15+ with no log
// line of its own. Say what it was first — a silent restart loop is the
// hardest kind of production failure to diagnose.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection');
});
