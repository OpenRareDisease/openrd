import { normalizeStoredMetadata, type AssistantMetadata } from './metadata';

export type ChatRole = 'assistant' | 'user';
export type ChatMessageStatus = 'sent' | 'loading' | 'error';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status: ChatMessageStatus;
  metadata?: AssistantMetadata;
  /** On an errored assistant bubble: the exact question that failed,
   *  so the「重试」button can resend it without the user retyping. */
  failedQuestion?: string;
  /** Marks a consent-gate failure: the bubble renders the inline
   *  authorization card (grant-and-resend) instead of a plain retry. */
  consentRequired?: boolean;
  /** Consent epoch this message was generated under (see
   *  lib/consent-epoch.ts). Messages from older epochs never replay
   *  as multi-turn history — the client half of the consent-downgrade
   *  defence. Absent on messages stored before the feature. */
  epoch?: number;
  /** Renders as a system divider (e.g.「隐私设置已变更」) instead of
   *  a chat bubble; never replayed as history. */
  systemDivider?: boolean;
};

/**
 * Hydrate chat history from its AsyncStorage JSON. Lives in its own
 * pure module (same pattern as citations/metadata/mode) so the guards
 * are unit-testable without dragging native modules into jest.
 *
 * The per-field normalizers matter: `failedQuestion` feeds the retry
 * send path (must be a string or absent) and `consentRequired` gates
 * the inline consent card (must be literally `true` or absent) — a
 * corrupted entry must not be able to smuggle other shapes through.
 */
export const parseStoredMessages = (raw: string | null): ChatMessage[] | null => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;

    const messages = parsed
      .filter((item): item is ChatMessage => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as Partial<ChatMessage>;
        return (
          typeof candidate.id === 'string' &&
          (candidate.role === 'assistant' || candidate.role === 'user') &&
          typeof candidate.content === 'string' &&
          typeof candidate.createdAt === 'string' &&
          (candidate.status === 'sent' ||
            candidate.status === 'loading' ||
            candidate.status === 'error')
        );
      })
      .map((item) => ({
        ...item,
        metadata: normalizeStoredMetadata(item.metadata),
        failedQuestion: typeof item.failedQuestion === 'string' ? item.failedQuestion : undefined,
        consentRequired: item.consentRequired === true ? true : undefined,
        epoch: Number.isSafeInteger(item.epoch) ? item.epoch : undefined,
        systemDivider: item.systemDivider === true ? true : undefined,
      }));

    return messages.length ? messages : null;
  } catch {
    return null;
  }
};

/** Client-side cap mirroring the server default
 *  (AI_HISTORY_MAX_MESSAGES) — saves payload bytes; the server
 *  remains the authority and re-truncates regardless. */
export const HISTORY_PAYLOAD_MAX_MESSAGES = 12;

/**
 * Select which stored messages replay as multi-turn history.
 *
 * Filters, in order of intent:
 * - only settled chat bubbles (`status === 'sent'`) — errored/loading
 *   bubbles and the welcome greeting carry no conversational value;
 * - only messages from the CURRENT consent epoch (downgrade defence —
 *   see lib/consent-epoch.ts); messages stored before the epoch
 *   feature (`epoch === undefined`) only replay while the epoch is
 *   still 0, i.e. consent has never changed since they were stored;
 * - never system dividers;
 * - newest HISTORY_PAYLOAD_MAX_MESSAGES only.
 *
 * The caller passes the message list BEFORE appending the current
 * question, so the question itself is never duplicated into history.
 */
export const buildHistoryPayload = (
  messages: ChatMessage[],
  currentEpoch: number,
): Array<{ role: ChatRole; content: string }> =>
  messages
    .filter(
      (message) =>
        message.status === 'sent' &&
        message.id !== 'welcome' &&
        !message.systemDivider &&
        (message.epoch ?? 0) === currentEpoch &&
        message.content.trim().length > 0,
    )
    .slice(-HISTORY_PAYLOAD_MAX_MESSAGES)
    .map((message) => ({ role: message.role, content: message.content }));

/**
 * Move a drawer conversation into the 问答 screen's history.
 *
 * The ask drawer is a sheet: it opens on a report or a chart, answers,
 * and on close throws the whole exchange away. Nothing else in the app
 * kept it either — the audit page records which tools ran, never the
 * question or the answer — so a patient who read something useful and
 * dismissed the sheet had no way back to it. That is a bad property for
 * an app whose whole subject is keeping a record.
 *
 * Rather than give the drawer its own storage, the turns are appended
 * to the chat the 问答 tab already persists, so「继续问」 and the full
 * conversation are the same thread. Appending, not replacing: the
 * drawer is a detour from a conversation, not a new one.
 *
 * Failures are swallowed. This runs on the way to another screen, and a
 * storage error should cost the handoff, not the navigation.
 */
export const appendTurnsToStoredChat = async (
  storage: {
    getItem: (k: string) => Promise<string | null>;
    setItem: (k: string, v: string) => Promise<void>;
  },
  key: string,
  turns: Array<{ role: ChatRole; content: string }>,
  makeId: (index: number) => string,
  now: string,
): Promise<void> => {
  if (turns.length === 0) return;
  try {
    const existing = parseStoredMessages(await storage.getItem(key)) ?? [];
    const appended: ChatMessage[] = turns.map((turn, index) => ({
      id: makeId(index),
      role: turn.role,
      content: turn.content,
      createdAt: now,
      status: 'sent',
    }));
    await storage.setItem(key, JSON.stringify([...existing, ...appended]));
  } catch {
    // See above: the handoff is best-effort.
  }
};
