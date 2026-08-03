import { loadAppEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { getPool } from './db/pool.js';
import { createShutdownSequencer } from './lifecycle.js';
import { createServer } from './server.js';

const env = loadAppEnv();
const logger = createLogger(env);
const app = createServer({ env, logger });

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

/**
 * Built BEFORE `app.listen`, on purpose.
 *
 * `createShutdownSequencer` validates that the readiness drain fits
 * inside the grace period, and an invalid pair has to be fatal at boot
 * rather than at the next SIGTERM — a process that has already bound the
 * port and is answering /healthz/ready would otherwise look healthy for
 * days and then tear every in-flight request off the socket on the
 * deploy that stops it. Throwing here means the container crash-loops
 * with the message, which is what an operator can act on.
 *
 * The sequencer itself lives in lifecycle.ts so it can be unit-tested;
 * everything that made it untestable — the listener, the pool, the
 * signal handlers — stays in this file.
 */
const shutdown = createShutdownSequencer({
  server: {
    // Bound lazily: `server` is assigned on the next statement, and the
    // sequencer is only ever invoked from a signal handler installed
    // after that. Passing `server` directly would need it declared
    // first, which would put `app.listen` above the timing validation.
    close: (callback) => server.close(callback),
    closeIdleConnections: () => server.closeIdleConnections(),
    closeAllConnections: () => server.closeAllConnections(),
  },
  closePool,
  readinessDrainMs: env.SHUTDOWN_READINESS_DRAIN_MS,
  graceMs: env.SHUTDOWN_GRACE_MS,
  logger,
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API server started');
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * Log the rejection and KEEP SERVING. This is a deliberate choice, and
 * it is the opposite of what this comment used to claim.
 *
 * Node's default for an unhandled rejection is `--unhandled-rejections=
 * throw`, i.e. terminate. But merely INSTALLING a listener switches that
 * default off — so the handler that was added to "say what it was first"
 * silently turned a fatal condition into a logged one while its own
 * comment described the fatal behaviour it had just removed.
 *
 * Keeping the process up is the right call for this server: one stray
 * rejection in a background OCR job or a sweep timer must not take an
 * SSE answer away from a patient mid-stream, and every floating promise
 * in apps/api/src terminates in a `.catch` today. The cost is that there
 * is no restart-on-wedge backstop in this topology — compose's
 * `restart: unless-stopped` only fires on exit, so a process that logs
 * this and is genuinely wedged stays in rotation until someone notices.
 * That is what the error level is for: this line is a page, not a note.
 */
process.on('unhandledRejection', (reason) => {
  logger.error(
    { reason },
    'unhandled promise rejection; the process is deliberately staying up — investigate, this is not routine',
  );
});
