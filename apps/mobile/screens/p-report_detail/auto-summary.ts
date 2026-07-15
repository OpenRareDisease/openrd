/**
 * Decision function for interpretation automation: should the detail
 * screen fire an unattended `generateDocumentSummary` right now?
 *
 * Pure and exhaustive on purpose — this is the path that spends LLM
 * calls without a user tap, so every guard is load-bearing and unit
 * tested. The component owns WHEN to evaluate (effect on state
 * changes); this owns WHETHER.
 */
export interface AutoSummaryState {
  /** 'granted' | 'none' | 'unknown' — consent fetch result. */
  aiConsent: 'granted' | 'none' | 'unknown';
  /** Document-row status from the OCR endpoint (null while loading). */
  docStatus: string | null;
  /** Whether the OCR payload has arrived (parse produced fields). */
  hasPayload: boolean;
  /** True while the row (or legacy payload) still reports parsing. */
  isProcessing: boolean;
  /** An aiSummary already exists (cached or just generated). */
  hasSummary: boolean;
  /** A generation request is already in flight. */
  summaryLoading: boolean;
  /** The once-per-visit latch has already fired. */
  alreadyTriggered: boolean;
}

export const shouldAutoSummarize = (state: AutoSummaryState): boolean => {
  if (state.alreadyTriggered) return false;
  if (state.aiConsent !== 'granted') return false;
  if (!state.hasPayload) return false;
  if (state.isProcessing) return false;
  if (state.docStatus === 'parse_failed') return false;
  if (state.hasSummary) return false;
  if (state.summaryLoading) return false;
  return true;
};
