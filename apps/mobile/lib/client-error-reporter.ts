/**
 * The one seam through which client-side crashes leave this app.
 *
 * Why a seam and not an SDK
 * -------------------------
 * Until now nothing at all reported client failures: an uncaught throw
 * in any screen unmounted the whole SPA to a blank white page, and the
 * post-deploy watch list is entirely server-side (API 5xx rate, upload
 * failure rate, audit rows). A screen that white-screens on a data
 * shape the server happily returned produces no 5xx and no audit row,
 * so the team learns about it from a user complaint or not at all.
 *
 * Dropping in Sentry or Bugsnag would fix the visibility and create a
 * different problem: it opens a new outbound channel out of a PHI app,
 * to a vendor nobody has assessed, carrying whatever the SDK decides
 * to attach (breadcrumbs, URLs, form values). That is a data-transfer
 * decision — for a Chinese health product, a PIPL one — and it belongs
 * to the people who sign for it, not to whoever wires the boundary.
 *
 * So this module is the wiring, with the destination left blank.
 * `console.error` is the default sink; `setClientErrorReporter` swaps
 * in a real one (a POST to our own API, a vendor SDK, anything) in a
 * single place, without touching any component.
 *
 * What must NEVER reach a reporter
 * --------------------------------
 * Route params. `/p-report_detail?documentId=…` and friends carry
 * medical-record identifiers, and the crash we are chasing is almost
 * never explained by which report was open. `scrubRoute` therefore
 * keeps the path and throws the query string away before the report is
 * built — not inside the reporter, so a future reporter cannot forget
 * to do it. Same rule for anything added later: send the shape of the
 * failure, never the patient's data.
 */

export interface ClientErrorReport {
  /** Where it broke. 'render' is a React subtree throw caught by the
   *  root boundary; other origins can be added as they get wired. */
  origin: 'render';
  /** Error.message. Stack traces stay out of the report by design —
   *  a minified web bundle's stack is noise without a source map, and
   *  uploading source maps is its own decision. */
  message: string;
  /** React's component stack, when the boundary had one. */
  componentStack?: string;
  /** Path only — see `scrubRoute`. Undefined off the web. */
  route?: string;
  /** ISO timestamp, taken at report time. */
  occurredAt: string;
}

export type ClientErrorReporter = (report: ClientErrorReport) => void;

const consoleReporter: ClientErrorReporter = (report) => {
  // Deliberately one line and self-labelling: on the web export this
  // is the only trace a crash leaves, and someone reading a patient's
  // screenshot of the console should be able to tell what it is.
  console.error('[client-error]', report.origin, report.message, {
    route: report.route,
    occurredAt: report.occurredAt,
    componentStack: report.componentStack,
  });
};

let activeReporter: ClientErrorReporter = consoleReporter;

/**
 * Install the real destination. Pass null to fall back to the console
 * sink (which is also what tests want, so a swapped-in reporter in one
 * test cannot leak into the next).
 */
export const setClientErrorReporter = (reporter: ClientErrorReporter | null) => {
  activeReporter = reporter ?? consoleReporter;
};

/**
 * Path without the query string.
 *
 * `/p-report_detail?documentId=abc` becomes `/p-report_detail`. The
 * hash goes too — expo-router does not put params there today, but it
 * costs nothing to refuse the whole tail rather than enumerate which
 * parts of it are safe.
 */
export const scrubRoute = (href: string | undefined): string | undefined => {
  if (!href) return undefined;
  const cut = href.search(/[?#]/);
  return cut === -1 ? href : href.slice(0, cut);
};

const currentScrubbedRoute = (): string | undefined => {
  // Web-only: on native there is no location and the boundary's own
  // report is still useful without a route.
  if (typeof window === 'undefined' || !window.location) return undefined;
  return scrubRoute(window.location.pathname);
};

export const reportClientError = (
  error: unknown,
  context: { origin: ClientErrorReport['origin']; componentStack?: string },
) => {
  const report: ClientErrorReport = {
    origin: context.origin,
    message: error instanceof Error ? error.message : String(error),
    componentStack: context.componentStack,
    route: currentScrubbedRoute(),
    occurredAt: new Date().toISOString(),
  };

  try {
    activeReporter(report);
  } catch {
    // A reporter that throws must never turn a caught render error
    // into a second, uncaught one — that is how a crash handler ends
    // up being the crash.
  }
};
