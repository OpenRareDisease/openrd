import { describe, expect, it } from 'vitest';

import { resolveOccurrenceDate, toPartialFhirDate } from './occurrence-date.js';

describe('occurrence-date — a milestone never claims a precision it does not have', () => {
  it('reports precision as unrecorded, because the source column cannot carry one', () => {
    const resolved = resolveOccurrenceDate('2023-08-14T13:30:00.000Z');
    expect(resolved.precision).toBe('unrecorded');
    expect(resolved.timestamp).toBe('2023-08-14T13:30:00.000Z');
    expect(resolved.noteZh).toContain('无法表示');
  });

  it('flags a value pinned to the first instant of a year', () => {
    // This is what 「只知道 2019 年」 looks like after something has
    // pinned it to a timestamp. The flag is a statement about the
    // stored value, not a guess about the patient.
    const resolved = resolveOccurrenceDate('2019-01-01T00:00:00.000Z');
    expect(resolved.pinnedToYearStart).toBe(true);
    expect(resolved.pinnedToMonthStart).toBe(true);
    expect(resolved.storedYear).toBe(2019);
  });

  it('flags a month start without claiming a year start', () => {
    const resolved = resolveOccurrenceDate('2019-06-01T00:00:00.000Z');
    expect(resolved.pinnedToMonthStart).toBe(true);
    expect(resolved.pinnedToYearStart).toBe(false);
  });

  it('does not flag an instant that is merely close to the year boundary', () => {
    // One millisecond in is real data and must not be rounded away.
    const resolved = resolveOccurrenceDate('2019-01-01T00:00:00.001Z');
    expect(resolved.pinnedToYearStart).toBe(false);
    expect(resolved.pinnedToMonthStart).toBe(false);
  });

  it('judges the boundary in UTC, not in the server timezone', () => {
    // Run under Asia/Shanghai this instant is 2019-01-01 08:00 local,
    // and a local-time implementation would call it a year start.
    // Whether a stored value is pinned must not depend on where the
    // container happens to be running.
    const resolved = resolveOccurrenceDate('2019-01-01T00:00:00.000+08:00');
    expect(resolved.pinnedToYearStart).toBe(false);
    expect(resolved.storedYear).toBe(2018);
  });

  it('keeps an unparseable timestamp verbatim instead of substituting one', () => {
    const resolved = resolveOccurrenceDate('not-a-date');
    expect(resolved.timestamp).toBe('not-a-date');
    expect(resolved.storedYear).toBeNull();
    expect(resolved.pinnedToYearStart).toBe(false);
    expect(resolved.noteZh).toContain('未做任何补全');
  });
});

describe('toPartialFhirDate — the January-1st defect, closed', () => {
  it('emits YYYY for a year-pinned value rather than YYYY-01-01', () => {
    expect(toPartialFhirDate(resolveOccurrenceDate('2019-01-01T00:00:00.000Z'))).toBe('2019');
  });

  it('emits YYYY-MM for a month-pinned value', () => {
    expect(toPartialFhirDate(resolveOccurrenceDate('2019-06-01T00:00:00.000Z'))).toBe('2019-06');
  });

  it('never rounds a genuinely precise instant down', () => {
    expect(toPartialFhirDate(resolveOccurrenceDate('2023-08-14T13:30:00.000Z'))).toBe(
      '2023-08-14T13:30:00.000Z',
    );
  });

  it('passes an unparseable value through untouched', () => {
    expect(toPartialFhirDate(resolveOccurrenceDate('not-a-date'))).toBe('not-a-date');
  });
});
