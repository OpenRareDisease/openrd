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
