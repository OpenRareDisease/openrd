/**
 * Audit logger for /api/ai/ask invocations.
 *
 * Persists one row per call to `ai_prompt_audit` carrying the
 * consent level, redaction mode, fields used, tools called, status,
 * and a sha256 hash of the redacted prompt. Never stores the prompt
 * body — keeping the audit table tiny and avoiding a secondary
 * leak channel.
 *
 * The logger is intentionally small: a single insert and a single
 * list query. The orchestrator owns building the input shape; the
 * Phase 3 mobile audit-viewer page consumes the list query.
 */

import type { Pool } from 'pg';

import type {
  AuditEntry,
  AuditEntryInput,
  AuditStatus,
  ListAuditOptions,
  ToolCallSummary,
} from './types.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface AuditRow {
  id: string;
  user_id: string | null;
  request_id: string | null;
  llm_provider: string;
  llm_model: string;
  consent_level: string;
  redaction_mode: string;
  redacted_prompt_hash: string | null;
  prompt_char_length: number | null;
  used_personal_data: boolean;
  fields_used: unknown;
  tools_called: unknown;
  latency_ms: number | null;
  status: string;
  error_detail: string | null;
  created_at: Date | string;
}

const coerceStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
};

/** Normalise the `tools_called` jsonb column into the current
 *  `ToolCallSummary[]` shape. Two legacy formats may show up:
 *
 *   - Rows persisted before ToolCallTrace landed are plain `string[]`
 *     of tool names. We promote each to a minimal summary with
 *     `status='ok'`, `chunkCount=0`, `latencyMs=null` so the UI
 *     doesn't have to special-case them.
 *   - Rows from this PR onward are already `ToolCallSummary[]`; we
 *     trust the shape but defensively coerce each field so a
 *     hand-edited row can't crash the renderer.
 *
 *  Non-array / unrecognised payloads return `[]` rather than
 *  throwing, matching the pre-existing tolerance of
 *  `coerceStringArray` for malformed `fields_used`. */
const coerceToolCalls = (value: unknown): ToolCallSummary[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, idx): ToolCallSummary | null => {
      if (typeof entry === 'string') {
        return {
          name: entry,
          toolCallId: `legacy-${idx}`,
          status: 'ok',
          chunkCount: 0,
          latencyMs: null,
        };
      }
      if (!entry || typeof entry !== 'object') return null;
      const obj = entry as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name : null;
      if (!name) return null;
      const status = obj.status === 'error' ? 'error' : 'ok';
      return {
        name,
        toolCallId: typeof obj.toolCallId === 'string' ? obj.toolCallId : `legacy-${idx}`,
        status,
        chunkCount: typeof obj.chunkCount === 'number' ? obj.chunkCount : 0,
        latencyMs: typeof obj.latencyMs === 'number' ? obj.latencyMs : null,
        ...(status === 'error' && typeof obj.errorDetail === 'string'
          ? { errorDetail: obj.errorDetail }
          : {}),
      };
    })
    .filter((v): v is ToolCallSummary => v !== null);
};

const formatTimestamp = (value: Date | string): string => {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

const rowToEntry = (row: AuditRow): AuditEntry => ({
  id: row.id,
  userId: row.user_id,
  requestId: row.request_id,
  llmProvider: row.llm_provider,
  llmModel: row.llm_model,
  consentLevel: row.consent_level as AuditEntry['consentLevel'],
  redactionMode: row.redaction_mode as AuditEntry['redactionMode'],
  redactedPromptHash: row.redacted_prompt_hash,
  promptCharLength: row.prompt_char_length,
  usedPersonalData: row.used_personal_data,
  fieldsUsed: coerceStringArray(row.fields_used),
  toolsCalled: coerceToolCalls(row.tools_called),
  latencyMs: row.latency_ms,
  status: row.status as AuditStatus,
  errorDetail: row.error_detail,
  createdAt: formatTimestamp(row.created_at),
});

const clampLimit = (raw: number | undefined): number => {
  const value = raw ?? DEFAULT_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(value)), MAX_LIMIT);
};

const normaliseOffset = (raw: number | undefined): number => {
  const value = raw ?? 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

export class AuditLogger {
  constructor(private readonly pool: Pool) {}

  /**
   * Persist one audit row. Returns the generated id so callers can
   * surface it in API responses (handy for support tickets).
   */
  async record(input: AuditEntryInput): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO ai_prompt_audit (
         user_id, request_id, llm_provider, llm_model,
         consent_level, redaction_mode,
         redacted_prompt_hash, prompt_char_length,
         used_personal_data, fields_used, tools_called,
         latency_ms, status, error_detail
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6,
         $7, $8,
         $9, $10::jsonb, $11::jsonb,
         $12, $13, $14
       )
       RETURNING id`,
      [
        input.userId,
        input.requestId ?? null,
        input.llmProvider,
        input.llmModel,
        input.consentLevel,
        input.redactionMode,
        input.redactedPromptHash ?? null,
        input.promptCharLength ?? null,
        input.usedPersonalData,
        JSON.stringify(input.fieldsUsed ?? []),
        JSON.stringify(input.toolsCalled ?? []),
        input.latencyMs ?? null,
        input.status,
        input.errorDetail ?? null,
      ],
    );
    return result.rows[0].id;
  }

  /**
   * Read recent audit rows for a single user, most recent first.
   * Drives the in-app "查看我的 AI 数据使用记录" page (Phase 3).
   */
  async listByUser(userId: string, opts: ListAuditOptions = {}): Promise<AuditEntry[]> {
    if (!userId) return [];

    const limit = clampLimit(opts.limit);
    const offset = normaliseOffset(opts.offset);

    const conditions: string[] = ['user_id = $1'];
    const params: unknown[] = [userId];

    if (opts.status) {
      const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
      if (statuses.length > 0) {
        params.push(statuses);
        conditions.push(`status = ANY($${params.length}::text[])`);
      }
    }
    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const result = await this.pool.query<AuditRow>(
      `SELECT id, user_id, request_id, llm_provider, llm_model,
              consent_level, redaction_mode,
              redacted_prompt_hash, prompt_char_length,
              used_personal_data, fields_used, tools_called,
              latency_ms, status, error_detail, created_at
         FROM ai_prompt_audit
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ${limitParam}
        OFFSET ${offsetParam}`,
      params,
    );

    return result.rows.map(rowToEntry);
  }
}
