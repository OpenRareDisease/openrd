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
      }));

    return messages.length ? messages : null;
  } catch {
    return null;
  }
};
