/**
 * Ask context — "the patient is looking at *this* while asking".
 *
 * Until now the only way to ask about a specific report or trend was
 * to describe it in words, which put the burden of knowing what to
 * ask on the person least equipped to carry it. The client can now
 * name the object the question is about; this module turns that
 * reference into a prompt hint.
 *
 * Two rules shape everything below.
 *
 * 1. **The hint never carries patient data.** It would be easy to
 *    interpolate the report's title and date straight into the user
 *    prompt — and it would quietly bypass the retriever → redactor →
 *    renderer path that every other patient value in this system goes
 *    through (see context-builder.ts). So the hint is *instructional*
 *    only: it tells the planner which tool to reach for and what kind
 *    of object is on screen. The actual content still arrives through
 *    `get_my_reports`, redacted per consent level like everything else.
 *
 * 2. **No client string ever reaches the prompt.** Callers send an id
 *    or an enum key, never a label. Ids are resolved against the
 *    caller's own rows and discarded; keys are looked up in a fixed
 *    table here. A client that invents a metric key gets a 400, not a
 *    sentence of its choosing appended to the system's own prompt.
 *
 * Ownership is enforced even though the hint reveals nothing: a
 * successful resolve for someone else's document id would still be an
 * existence oracle, and it would steer the planner at another user's
 * data.
 */

import type { Pool } from 'pg';

import { AppError } from '../../../utils/app-error.js';

/**
 * Metric keys the client may reference.
 *
 * `label` is what the hint calls it; `recordsFilter` is the
 * `metricKey` the planner should pass to `get_my_records`.
 *
 * The two are not always the same thing, which is the whole reason
 * this is a table and not a string map. 跌倒次数 is a chart on the
 * mobile side but an *event tally* in the record — passing it as a
 * metricKey filter would return an empty series AND suppress the
 * event chunk. 肌力自测 is one chart but seven per-muscle series.
 * Both therefore resolve to an unfiltered call.
 *
 * Mirrors `buildPatientVisualizationCards` on the mobile side — add a
 * chart there, add its key here, or the drawer opens with a 400.
 *
 * `muscle_strength` is the one entry with no chart behind it yet, so
 * no client can currently produce it. It stays because accepting a key
 * early is harmless while rejecting one the client believes in is not;
 * `AiAskMetricKey` in apps/mobile/lib/api.ts still lists it.
 */
const METRIC_CONTEXTS: Record<string, { label: string; recordsFilter?: string }> = {
  stair_climb: { label: '上楼计时', recordsFilter: 'stair_climb' },
  sleep_quality: { label: '睡眠质量', recordsFilter: 'sleep_quality' },
  fall_count: { label: '跌倒次数' },
  muscle_strength: { label: '肌力自测' },
};

export type AskContextRef =
  | { type: 'document'; id: string }
  | { type: 'metric'; key: string }
  | { type: 'followup_event'; id: string };

/**
 * The hint is the whole product of a resolve.
 *
 * This used to also return a `descriptor` ("metric:fall_count",
 * "document") for logs, which nothing ever logged. It was never a
 * second piece of information either — the caller still holds the
 * `AskContextRef` it passed in, so anything wanting a log line can
 * build one from `ref.type`/`ref.key` at the call site rather than
 * having the resolver carry a duplicate downstream.
 */
export interface ResolvedAskContext {
  /** Appended to the user prompt as `OrchestratorRunInput.userContextHint`. */
  hint: string;
  /**
   * The verified reference itself, forwarded as
   * `OrchestratorRunInput.scope` so the retriever can narrow to it.
   *
   * This used to stop at the hint. Ownership was checked, the id was
   * dropped, and the model was *asked* to「调用 get_my_reports 获取报告
   * 内容」— with no way to say which report. So it fetched the recent
   * five and answered about all of them, while the drawer above the
   * answer read「上下文已带入：这份检查报告」. The id never enters the
   * prompt; it goes to the query.
   */
  scope?: { documentId?: string };
}

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** Postgres rejects a malformed uuid with 22P02 rather than returning
 *  zero rows, which would surface as a 500. Screen the shape here so a
 *  junk id is the 400 it actually is. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate the `context` field of an /ask request body.
 *
 * Returns null when absent (context is optional). Throws AppError 400
 * when present but unusable — an invalid reference must not silently
 * degrade into a context-free answer, because the patient asked
 * "这什么意思" about something specific and a generic reply would look
 * like an answer rather than a miss.
 */
export const parseAskContext = (raw: unknown): AskContextRef | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('context 格式不正确', 400);
  }

  const record = raw as Record<string, unknown>;
  const type = asTrimmedString(record.type);

  switch (type) {
    case 'document':
    case 'followup_event': {
      const id = asTrimmedString(record.id);
      if (!id || !UUID_RE.test(id)) {
        throw new AppError('context.id 格式不正确', 400);
      }
      return { type, id };
    }
    case 'metric': {
      const key = asTrimmedString(record.key);
      if (!key || !Object.prototype.hasOwnProperty.call(METRIC_CONTEXTS, key)) {
        throw new AppError('context.key 不在支持范围内', 400);
      }
      return { type: 'metric', key };
    }
    default:
      throw new AppError('context.type 不在支持范围内', 400);
  }
};

/**
 * Confirm the referenced object belongs to `userId` and build the
 * hint. Throws AppError 404 when the row is absent *or* owned by
 * somebody else — the two cases are deliberately indistinguishable to
 * the caller.
 */
export const resolveAskContext = async (
  pool: Pool,
  userId: string,
  ref: AskContextRef,
): Promise<ResolvedAskContext> => {
  if (ref.type === 'metric') {
    const meta = METRIC_CONTEXTS[ref.key];
    const call = meta.recordsFilter
      ? `get_my_records（metricKey="${meta.recordsFilter}"）`
      : 'get_my_records（不要传 metricKey，需要完整记录与事件）';
    return {
      hint:
        `用户正在查看自己的「${meta.label}」趋势，问题针对它。` +
        `请调用 ${call} 获取实际记录后再作答，不要凭空假设数值。`,
    };
  }

  if (ref.type === 'document') {
    const result = await pool.query<{ id: string }>(
      `SELECT pd.id
         FROM patient_documents pd
         JOIN patient_profiles pp ON pp.id = pd.profile_id
        WHERE pd.id = $1 AND pp.user_id = $2
        LIMIT 1`,
      [ref.id, userId],
    );
    if (result.rowCount === 0) {
      throw new AppError('找不到这份报告', 404);
    }
    return {
      scope: { documentId: ref.id },
      hint:
        '用户正在查看自己的一份检查报告，问题针对这份报告。' +
        '请调用 get_my_reports 获取报告内容后再作答，不要凭空假设指标值。' +
        '该工具本轮已被限定为这一份报告，不要传 documentType 或 since，' +
        '也不要把回答扩展到其他报告。',
    };
  }

  const result = await pool.query<{ id: string }>(
    `SELECT fe.id
       FROM patient_followup_events fe
       JOIN patient_profiles pp ON pp.id = fe.profile_id
      WHERE fe.id = $1 AND pp.user_id = $2
      LIMIT 1`,
    [ref.id, userId],
  );
  if (result.rowCount === 0) {
    throw new AppError('找不到这条记录', 404);
  }
  // No `scope` here on purpose. The followups retriever answers in
  // trends — series with stats over time — not in rows, so there is no
  // shape for "just this one event" to narrow to. Declaring a scope
  // field nothing honours would read as an enforced limit at every
  // call site that inspects it.
  return {
    hint:
      '用户正在查看自己病程时间轴上的一条事件记录，问题针对这条记录。' +
      '请调用 get_my_records 获取近期记录与事件后再作答。',
  };
};
