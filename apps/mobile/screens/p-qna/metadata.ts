/**
 * Pure migration helper for assistant-message metadata persisted in
 * AsyncStorage. Extracted from `index.tsx` so jest can test it
 * without mocking the screen's runtime imports (AsyncStorage,
 * expo-router, react-native, etc.).
 *
 * Two persisted shapes live in the wild:
 *
 *   - Pre-ToolCallTrace: `metadata.toolsCalled: string[]` — just
 *     the tool names. Re-mapped to `legacyToolNames` so the
 *     renderer can synthesise minimal trace cards without faking
 *     `status='ok'` / `latencyMs=0` data we never observed.
 *   - Current: `metadata.toolCalls: AiToolCallSummary[]` — full
 *     per-tool execution summary. Pass-through.
 *
 * Unknown / malformed payloads degrade gracefully: each field is
 * coerced individually so a corrupted single field (e.g. a
 * non-array `citations`) doesn't wipe the whole metadata blob.
 */

import type { AiCitation, AiToolCallSummary, ConsentLevel } from '../../lib/api';

export interface AssistantMetadata {
  /** Current rich per-tool trace. New writes set this. */
  toolCalls?: AiToolCallSummary[];
  /** Legacy tool-name array from pre-ToolCallTrace stored chats. */
  legacyToolNames?: string[];
  fieldsUsed?: string[];
  usedPersonalData?: boolean;
  citations?: AiCitation[];
  /** Per-message snapshot of the redaction mode the orchestrator
   *  picked for this call. Drives the at-a-glance mode chip in the
   *  page header (see `pickCurrentMode`). Persisted so revisiting an
   *  old chat keeps showing the mode the answer was generated under
   *  — even if the user has since toggled their consent. */
  redactionMode?: 'strict' | 'precise';
  /** Companion to `redactionMode`. Captured for future use by the
   *  audit / debug overlays; the mode chip itself only reads
   *  `redactionMode`. */
  consentLevel?: ConsentLevel;
}

export const normalizeStoredMetadata = (meta: unknown): AssistantMetadata | undefined => {
  if (!meta || typeof meta !== 'object') return undefined;
  const obj = meta as Record<string, unknown>;
  const next: AssistantMetadata = {};

  if (Array.isArray(obj.toolCalls)) {
    next.toolCalls = obj.toolCalls as AiToolCallSummary[];
  }
  if (Array.isArray(obj.toolsCalled)) {
    next.legacyToolNames = (obj.toolsCalled as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    );
  }
  if (Array.isArray(obj.fieldsUsed)) {
    next.fieldsUsed = (obj.fieldsUsed as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    );
  }
  if (typeof obj.usedPersonalData === 'boolean') {
    next.usedPersonalData = obj.usedPersonalData;
  }
  if (Array.isArray(obj.citations)) {
    next.citations = obj.citations as AiCitation[];
  }
  if (obj.redactionMode === 'strict' || obj.redactionMode === 'precise') {
    next.redactionMode = obj.redactionMode;
  }
  if (
    obj.consentLevel === 'none' ||
    obj.consentLevel === 'basic' ||
    obj.consentLevel === 'precise'
  ) {
    next.consentLevel = obj.consentLevel;
  }
  return next;
};
