/**
 * Shared PII-shaped-token scrubbing for free-form prose. Extracted
 * from audit/scrub.ts (which keeps its pg-specific rules and now
 * composes these) so conversation-history normalization can apply the
 * SAME identifier rules without duplicating regexes that would drift.
 *
 * Deliberately blunt: better to over-redact than to replay a phone
 * number into an LLM prompt or an audit row.
 */
export const scrubPiiText = (input: string): string =>
  input
    // Chinese ID card first (18 digits, optional final X). Run before
    // phone so we don't redact the 11-digit window that lives inside
    // a longer ID-shaped run as a "phone".
    .replace(/\b\d{17}[\dXx]\b/g, '[ID]')
    // Older 15-digit CN ID (no longer issued but still legal).
    .replace(/\b\d{15}\b/g, '[ID]')
    // CN mobile (11 digits, starts with 1[3-9]) — the lookarounds keep
    // us from catching a substring inside another digit run.
    .replace(/(?<!\d)(?:\+?86)?1[3-9]\d{9}(?!\d)/g, '[PHONE]')
    // email addresses
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]');
