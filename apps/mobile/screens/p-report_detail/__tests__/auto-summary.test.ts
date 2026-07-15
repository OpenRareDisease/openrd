import { shouldAutoSummarize, type AutoSummaryState } from '../auto-summary';

const happy: AutoSummaryState = {
  aiConsent: 'granted',
  docStatus: 'parsed',
  hasPayload: true,
  isProcessing: false,
  hasSummary: false,
  summaryLoading: false,
  alreadyTriggered: false,
};

describe('shouldAutoSummarize', () => {
  it('fires exactly on the happy state (consent on, parse settled, nothing yet)', () => {
    expect(shouldAutoSummarize(happy)).toBe(true);
    // needs_review is a completed parse with fields — interpret it.
    expect(shouldAutoSummarize({ ...happy, docStatus: 'needs_review' })).toBe(true);
  });

  const blockers: Array<[string, Partial<AutoSummaryState>]> = [
    ['consent not granted', { aiConsent: 'none' }],
    ['consent still unknown', { aiConsent: 'unknown' }],
    ['payload not loaded yet', { hasPayload: false }],
    ['still processing', { isProcessing: true }],
    ['parse failed (never spend LLM calls on a failed parse)', { docStatus: 'parse_failed' }],
    ['summary already exists', { hasSummary: true }],
    ['generation already in flight', { summaryLoading: true }],
    ['once-per-visit latch already fired (no retry loops)', { alreadyTriggered: true }],
  ];
  for (const [name, override] of blockers) {
    it(`is blocked by: ${name}`, () => {
      expect(shouldAutoSummarize({ ...happy, ...override })).toBe(false);
    });
  }
});
