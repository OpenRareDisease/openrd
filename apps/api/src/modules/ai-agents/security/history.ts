import { scrubPiiText } from './text-scrub.js';
import { AppError } from '../../../utils/app-error.js';

/**
 * Conversation-history normalization for multi-turn /ai/ask.
 *
 * The client sends prior turns verbatim; the server is the authority
 * on how much of that reaches the LLM. Policy:
 *
 * - STRUCTURE is strict: a non-array history, a turn that isn't an
 *   object, a role outside user/assistant, or a non-string content
 *   is a 400 (`invalid_history`) — malformed input is a client bug,
 *   not something to paper over.
 * - SIZE is forgiving: message-count and char-budget overruns are
 *   silently truncated (oldest turns dropped first) so a long chat
 *   keeps working without client-side bookkeeping.
 * - CONTENT is scrubbed: every turn passes the shared PII regexes.
 *   User turns are the user's own words (same trust level as the
 *   live question, which ships unscrubbed by design) — but they
 *   round-trip through client storage; assistant turns may have been
 *   generated under a HIGHER consent level than the current call
 *   (precise → basic downgrade), so scrubbing is the server-side
 *   backstop against replaying exact identifiers. The client-side
 *   consent epoch is the first line of defence; this is the second.
 *
 * Per-turn caps keep any single pasted wall of text from eating the
 * whole budget: user turns ≤ 2000 chars, assistant turns ≤ 1500
 * (assistant answers are long-form; their tails add little context).
 */

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NormalizedHistory {
  messages: HistoryMessage[];
  /** Total chars across the kept messages (post-truncation). */
  charLength: number;
  /** Turns dropped by the count/char budgets (not by validation). */
  droppedCount: number;
}

const USER_TURN_MAX_CHARS = 2_000;
const ASSISTANT_TURN_MAX_CHARS = 1_500;

const truncateTurn = (role: HistoryMessage['role'], content: string): string => {
  const max = role === 'user' ? USER_TURN_MAX_CHARS : ASSISTANT_TURN_MAX_CHARS;
  if (content.length <= max) return content;
  return `${content.slice(0, max)}…`;
};

export const normalizeHistory = (
  raw: unknown,
  limits: { maxMessages: number; charBudget: number },
): NormalizedHistory => {
  if (raw === undefined || raw === null) {
    return { messages: [], charLength: 0, droppedCount: 0 };
  }

  if (!Array.isArray(raw)) {
    throw new AppError('invalid_history', 400, { code: 'invalid_history' });
  }

  const validated: HistoryMessage[] = raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AppError('invalid_history', 400, { code: 'invalid_history' });
    }
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      throw new AppError('invalid_history', 400, { code: 'invalid_history' });
    }
    return { role, content };
  });

  // Newest-last is the wire order; keep the most recent turns.
  // Guard the zero case explicitly: `slice(-0)` is `slice(0)` (the
  // whole array), which would turn "history disabled" into
  // "history unlimited".
  const byCount = limits.maxMessages <= 0 ? [] : validated.slice(-limits.maxMessages);

  const scrubbed = byCount.map((message) => ({
    role: message.role,
    content: truncateTurn(message.role, scrubPiiText(message.content)),
  }));

  // Enforce the char budget from the newest turn backwards, dropping
  // whole oldest turns until the rest fit. Whole-turn semantics keep
  // the transcript coherent (a half-sentence from three turns ago
  // helps nobody).
  const kept: HistoryMessage[] = [];
  let charLength = 0;
  for (let i = scrubbed.length - 1; i >= 0; i -= 1) {
    const next = scrubbed[i];
    if (charLength + next.content.length > limits.charBudget) {
      break;
    }
    kept.unshift(next);
    charLength += next.content.length;
  }

  return {
    messages: kept,
    charLength,
    droppedCount: validated.length - kept.length,
  };
};
