/**
 * Strip caller-supplied data out of an error string before it lands
 * in an audit row OR a response body. PG errors are the worst
 * offender: a constraint or type violation surfaces as `... DETAIL:
 * Key (phone)=(13800001234)` or `error: invalid input value for enum
 * ... $1 = '张三'`. We don't want any of that landing in audit rows
 * that downstream tooling (and humans without the underlying data
 * permissions) read.
 *
 * Lives here (and not in a single route file) because three call
 * sites now need it: the legacy `/ai/ask` JSON path, the
 * `/ai/ask/stream` error event, AND `orchestrator/run.ts`
 * `composeResult` per-tool errorDetail. A future audit reader
 * defence-in-depth also runs through this on the way back out.
 *
 * Rules are deliberately blunt: redact anything that looks like a
 * literal value or a PII-shaped token. Better to over-redact a stack
 * trace than to leak a phone number.
 */
export const scrubErrorDetail = (input: string): string =>
  input
    // pg parameterised "$N = '...'" / "$N='...'"
    .replace(/\$\d+\s*=\s*'[^']*'/g, '$N=[REDACTED]')
    // pg "DETAIL:  Key (col)=(value)" / "(col)=(value)"
    .replace(/\(\s*[^()]+\s*\)\s*=\s*\([^()]+\)/g, '(col)=(value)')
    // Chinese ID card first (18 digits, optional final X). Run before
    // phone so we don't redact the 11-digit window that lives inside
    // a longer ID-shaped run as a "phone".
    .replace(/\b\d{17}[\dXx]\b/g, '[ID]')
    // Older 15-digit CN ID (no longer issued but still legal).
    .replace(/\b\d{15}\b/g, '[ID]')
    // CN mobile (11 digits, starts with 1[3-9]) — `\b` keeps us from
    // catching a substring inside another digit run.
    .replace(/(?<!\d)(?:\+?86)?1[3-9]\d{9}(?!\d)/g, '[PHONE]')
    // email addresses
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]');
