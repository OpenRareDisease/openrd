/**
 * Pure helpers behind the QnA page's "current mode" chip.
 *
 * Extracted from `index.tsx` so the precedence rule can be unit-
 * tested without dragging in AsyncStorage, expo-router, and the
 * other react-native runtime modules the screen pulls at load time.
 */

import type { ConsentLevel } from '../../lib/api';

/** Subset of the screen's ChatMessage that the precedence rule
 *  actually depends on. Kept local so the test file doesn't need to
 *  import a heavier shape from the screen. */
export interface ModeSourceMessage {
  role: 'assistant' | 'user';
  status: 'sent' | 'loading' | 'error';
  metadata?: {
    redactionMode?: 'strict' | 'precise';
    consentLevel?: ConsentLevel;
  };
}

/** Walk the conversation newest-first and return the redaction mode
 *  of the most recent successfully-answered assistant message, or
 *  `null` if there isn't one yet (fresh chat, a trailing loading /
 *  error bubble with no prior success, or only legacy stored
 *  messages with no recorded mode).
 *
 *  We deliberately skip loading and error bubbles so the chip keeps
 *  showing the last committed mode while the next question is in
 *  flight — otherwise it would flicker off every time the user
 *  asked something. */
export const pickCurrentMode = (
  messages: readonly ModeSourceMessage[],
): 'strict' | 'precise' | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === 'assistant' && m.status === 'sent' && m.metadata?.redactionMode) {
      return m.metadata.redactionMode;
    }
  }
  return null;
};
