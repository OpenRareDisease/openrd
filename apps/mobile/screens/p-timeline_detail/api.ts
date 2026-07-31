import { apiRequest } from '../../lib/api';

/** Record kinds the API accepts on
 *  `DELETE /profiles/me/records/:kind/:id` (profile.schema.ts
 *  `DELETABLE_RECORD_KINDS`). Measurements, activity logs and
 *  medications are absent on purpose — they have no `deleted_at`
 *  column yet, so the server would 400 on them. */
export type DeletableRecordKind = 'function_test' | 'symptom_score' | 'followup_event';

/**
 * Retract one hand-entered record. The server soft-deletes it: the
 * row survives as an audited tombstone while every read path
 * (timeline, passport, progression summary, AI retriever) stops
 * returning it.
 *
 * Idempotent — retracting an already-retracted record answers 200
 * with the original `deletedAt`, so a double-fired tap is harmless.
 *
 * Lives next to its only caller rather than in lib/api.ts; move it
 * there once a second screen (e.g. a symptom-score list) needs it.
 */
export const deleteTimelineRecord = (kind: DeletableRecordKind, recordId: string) =>
  apiRequest<{
    kind: DeletableRecordKind;
    recordId: string;
    deleted: true;
    deletedAt: string;
  }>(`/profiles/me/records/${kind}/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
