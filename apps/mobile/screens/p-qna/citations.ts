/**
 * Pure helpers behind the inline citation popover.
 *
 * The orchestrator's answers come back as plain text with `[N]` and
 * `[N,M]` markers pointing at the `citations` array. This module
 * splits the answer into a sequence of plain-text segments and
 * tappable citation tokens so the QnA screen can render them with
 * inline pressable spans.
 *
 * Kept as a pure helper so tests can pin the parser's edge cases
 * (out-of-range indexes, mixed brackets, repeated cites) without
 * touching the React Native renderer.
 */

/** One contiguous run of the answer text. */
export type AnswerSegment =
  | { type: 'text'; value: string }
  | {
      type: 'cite';
      /** 1-based indexes into the `citations` array, already filtered
       *  to those that point at a real citation. Empty would have
       *  been folded into a `text` segment. */
      indexes: number[];
      /** Original matched substring (e.g. `"[1,2]"`) so the rendered
       *  pressable label matches what the LLM actually wrote, even
       *  when one of the comma-separated indexes was invalid and
       *  dropped from `indexes`. */
      raw: string;
    };

/** Matches `[N]` and `[N,M,...]` — ASCII brackets + decimal ints
 *  with optional whitespace around the commas. We intentionally do
 *  NOT match Chinese `【N】` brackets or `[1-3]` ranges; the proposal
 *  scopes Phase 3b to the ASCII bracket form that the orchestrator's
 *  system prompt asks the LLM to emit, and broader patterns trip
 *  false positives on quoted document text like `示例【1】这是文档原文`. */
const CITATION_REGEX = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Split `text` into renderable segments, mapping `[N]` markers onto
 * the supplied `citations` array (1-based, length = `citationCount`).
 *
 * Tokens that reference an out-of-range index are degraded to plain
 * text so the UI doesn't show a "tap me" affordance that opens
 * nothing — the LLM occasionally hallucinates extra cites and we'd
 * rather show the raw `[5]` than a broken modal.
 *
 * Empty / whitespace-only input returns `[]` so the caller can fall
 * back to its placeholder rendering without a special case.
 */
export const parseCitationSegments = (text: string, citationCount: number): AnswerSegment[] => {
  if (!text) return [];

  const segments: AnswerSegment[] = [];
  let cursor = 0;

  // String.prototype.matchAll preserves match indexes, which we need
  // for slicing the surrounding text. The regex is /g so iteration
  // is non-overlapping.
  for (const match of text.matchAll(CITATION_REGEX)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, start) });
    }
    const raw = match[0];
    const indexes = match[1]
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= citationCount);

    if (indexes.length === 0) {
      segments.push({ type: 'text', value: raw });
    } else {
      segments.push({ type: 'cite', indexes, raw });
    }
    cursor = start + raw.length;
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) });
  }

  return segments;
};

/**
 * Dedupe + sort indexes from a citation token. Used by the popover
 * to render distinct citation cards even when the LLM wrote `[1,1,2]`
 * (which it does sometimes after re-prompting).
 */
export const normalizeCitationIndexes = (indexes: readonly number[]): number[] => {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const i of indexes) {
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  return out.sort((a, b) => a - b);
};
