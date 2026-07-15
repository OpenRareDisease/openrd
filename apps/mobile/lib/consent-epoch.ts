import AsyncStorage from '@react-native-async-storage/async-storage';
import { QNA_HISTORY_EPOCH_STORAGE_KEY } from './api';

/**
 * Consent epoch for multi-turn QnA.
 *
 * Every chat message is stamped with the epoch it was generated
 * under. When ANY AI-consent switch changes (privacy screen or the
 * in-chat authorization card), the epoch bumps — and the history
 * payload builder only replays messages from the CURRENT epoch.
 *
 * This is the client-side half of the downgrade defence: an answer
 * generated under `precise` may quote exact values; after the user
 * downgrades to `basic`, replaying that answer as history would leak
 * those values back into prompts. Epoch filtering stops the replay at
 * the source; the server-side history scrubber is the backstop.
 *
 * Storage is patient-scoped (registered in PATIENT_SCOPED_CACHE_KEYS)
 * so logout/401 sweeps it with the chat itself.
 */

export const getConsentEpoch = async (): Promise<number> => {
  try {
    const raw = await AsyncStorage.getItem(QNA_HISTORY_EPOCH_STORAGE_KEY);
    const parsed = raw === null ? 0 : Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

export const bumpConsentEpoch = async (): Promise<number> => {
  const current = await getConsentEpoch();
  const next = current + 1;
  try {
    await AsyncStorage.setItem(QNA_HISTORY_EPOCH_STORAGE_KEY, String(next));
  } catch {
    // Best-effort: a failed bump means old messages keep replaying,
    // which the server-side scrubber still guards.
  }
  return next;
};
