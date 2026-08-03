import { uploadTimeoutMsForBytes } from '../api';

jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

const MB = 1024 * 1024;

/**
 * The property that matters is not any single number — it is that a
 * file the pickers are allowed to hand us can finish on a connection
 * we should expect to see. The old flat 60 s failed that: 10 MB in
 * 60 s needs ~1.4 Mbps sustained, and this is a mutation apiRequest
 * never retries, so the deadline expiring is final for that file.
 */
describe('uploadTimeoutMsForBytes', () => {
  it('gives a small file the fixed floor plus a token amount, not a four-minute hang', () => {
    const budget = uploadTimeoutMsForBytes(200 * 1024);
    expect(budget).toBeGreaterThanOrEqual(45_000);
    expect(budget).toBeLessThan(60_000);
  });

  it('carries a 10 MB file at 320 kbit/s, which the old flat 60 s could not', () => {
    // 10 MB at the assumed 40 KB/s is ~262 s of transfer alone, so the
    // budget has to be well past the minute it used to get.
    expect(uploadTimeoutMsForBytes(10 * MB)).toBeGreaterThan(120_000);
  });

  it('never exceeds four minutes — past that the connection is gone, not slow', () => {
    expect(uploadTimeoutMsForBytes(10 * MB)).toBeLessThanOrEqual(240_000);
    expect(uploadTimeoutMsForBytes(500 * MB)).toBe(240_000);
  });

  it('grows with the payload', () => {
    expect(uploadTimeoutMsForBytes(4 * MB)).toBeGreaterThan(uploadTimeoutMsForBytes(1 * MB));
  });

  it('budgets for the 10 MB cap when the platform reported no size', () => {
    // Some Android content providers omit the size. Guessing small
    // there reproduces exactly the failure this function exists to
    // remove, so an unknown size must cost the same as a capped one.
    const capped = uploadTimeoutMsForBytes(10 * MB);
    expect(uploadTimeoutMsForBytes(null)).toBe(capped);
    expect(uploadTimeoutMsForBytes(undefined)).toBe(capped);
  });

  it('treats a nonsensical size as unknown rather than producing a NaN deadline', () => {
    const capped = uploadTimeoutMsForBytes(10 * MB);
    expect(uploadTimeoutMsForBytes(Number.NaN)).toBe(capped);
    expect(uploadTimeoutMsForBytes(-1)).toBe(capped);
    expect(uploadTimeoutMsForBytes(0)).toBe(capped);
  });
});
