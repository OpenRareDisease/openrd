import { describe, expect, it } from 'vitest';

import { normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it('prepends +86 to a bare mainland number', () => {
    expect(normalizePhone('13922220001')).toBe('+8613922220001');
  });

  it('keeps an already +86-prefixed number unchanged (idempotent)', () => {
    expect(normalizePhone('+8613922220001')).toBe('+8613922220001');
  });

  it('keeps an explicit non-China country code unchanged', () => {
    expect(normalizePhone('+14155550100')).toBe('+14155550100');
  });

  it('trims surrounding whitespace before normalizing', () => {
    expect(normalizePhone('  13922220001  ')).toBe('+8613922220001');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePhone('')).toBe('');
  });

  it('matches the mobile formatPhoneNumber rule: bare and +86 collapse equal', () => {
    // The whole point — config (bare) and client (+86) must compare equal.
    expect(normalizePhone('13922220001')).toBe(normalizePhone('+8613922220001'));
  });
});
