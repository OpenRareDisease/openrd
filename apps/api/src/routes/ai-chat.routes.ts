/**
 * /api/ai/ask — orchestrator-backed AI chat endpoint.
 *
 * The route is a thin shell on top of the AI Agents module:
 *   1. requireAuth + rate limit middleware.
 *   2. Lookup the user's consent state. `none` → 403 + audit row.
 *   3. Hand off to Orchestrator.run; orchestrator events stream into
 *      the in-memory progress store so the existing
 *      /api/ai/ask/progress/* endpoints still work.
 *   4. Record an audit row (success or error) before responding.
 *
 * Everything privacy-sensitive lives in the orchestrator + security/
 * + audit/ modules; this file deliberately knows nothing about
 * redaction, tool calling, or prompt composition.
 */

import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';

import type { RouteContext } from './index.js';
import { getPool } from '../db/pool.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js';
import {
  AuditLogger,
  scrubErrorDetail,
  type AuditEntryInput,
} from '../modules/ai-agents/audit/index.js';
import { draftLogFromText } from '../modules/ai-agents/drafting/draft-log.js';
import { createLlmProvider, type ILLMProvider } from '../modules/ai-agents/llm/index.js';
import {
  Orchestrator,
  OrchestratorConsentDenied,
  type OrchestratorEvent,
  type OrchestratorRunResult,
  runStream as runOrchestratorStream,
} from '../modules/ai-agents/orchestrator/index.js';
import {
  ClinicalTrialsRetriever,
  MedicalKbRetriever,
  PatientFollowupRetriever,
  PatientProfileRetriever,
  PatientReportsRetriever,
} from '../modules/ai-agents/retrievers/index.js';
import {
  getConsentStatus,
  normalizeHistory,
  parseAskContext,
  redactionModeForConsent,
  resolveAskContext,
  type NormalizedHistory,
  type ResolvedAskContext,
} from '../modules/ai-agents/security/index.js';
import {
  GetMyProfileTool,
  GetMyRecordsTool,
  GetMyReportsTool,
  ListClinicalTrialsTool,
  SearchMedicalKbTool,
  ToolRegistry,
} from '../modules/ai-agents/tools/index.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';

type ProgressStageStatus = 'pending' | 'active' | 'done' | 'error';

interface ProgressStage {
  id: string;
  label: string;
  status: ProgressStageStatus;
  startedAt?: string;
  endedAt?: string;
}

interface ProgressState {
  id: string;
  /** Owning user — the only caller allowed to read/init this entry.
   *  Without this, any authenticated client could poll any progressId
   *  (or pre-empt another user's in-flight run by guessing the
   *  ~40-bit suffix issued by `generateProgressId`). */
  userId: string;
  status: 'running' | 'done' | 'error';
  percent: number;
  stageId: string;
  stages: ProgressStage[];
  updatedAt: number;
  error?: string;
}

const PROGRESS_STAGE_DEFS = [
  { id: 'received', label: '接收问题', percent: 5 },
  { id: 'query_gen', label: '理解问题', percent: 25 },
  { id: 'kb_search', label: '检索知识/资料', percent: 60 },
  { id: 'final_answer', label: '生成回答', percent: 90 },
  { id: 'done', label: '整理结果', percent: 100 },
];

/** One spoken sentence, not a diary. Bounds the prompt and keeps the
 *  draft focused enough that the patient can actually verify it. */
const DRAFT_LOG_MAX_CHARS = 500;

const PROGRESS_TTL_MS = 10 * 60 * 1000;
const progressStore = new Map<string, ProgressState>();

const nowIso = () => new Date().toISOString();

const pruneProgressStore = () => {
  const cutoff = Date.now() - PROGRESS_TTL_MS;
  for (const [id, entry] of progressStore.entries()) {
    if (entry.updatedAt < cutoff) progressStore.delete(id);
  }
};

/**
 * Reserve (or refresh) a progress entry for `progressId` under `userId`.
 *
 * Returns `null` when an existing entry is owned by a different user —
 * the caller MUST surface that as a 4xx and never overwrite. Without
 * this guard an attacker who guessed an in-flight progressId could
 * blank out another user's progress state mid-run (PR-Sec-1 #9).
 */
const initProgress = (progressId: string, userId: string): ProgressState | null => {
  const existing = progressStore.get(progressId);
  if (existing && existing.userId !== userId) return null;

  const stages: ProgressStage[] = PROGRESS_STAGE_DEFS.map((stage) => ({
    id: stage.id,
    label: stage.label,
    status: 'pending',
  }));
  const state: ProgressState = {
    id: progressId,
    userId,
    status: 'running',
    percent: 0,
    stageId: 'received',
    stages,
    updatedAt: Date.now(),
  };
  progressStore.set(progressId, state);
  return state;
};

const setProgressStage = (
  progressId: string,
  stageId: string,
  statusOverride?: ProgressStageStatus,
  error?: string,
) => {
  const state = progressStore.get(progressId);
  if (!state) return;

  const stageIndex = state.stages.findIndex((stage) => stage.id === stageId);
  if (stageIndex === -1) return;

  const prevIndex = state.stages.findIndex((stage) => stage.status === 'active');
  if (prevIndex >= 0 && prevIndex !== stageIndex) {
    state.stages[prevIndex] = {
      ...state.stages[prevIndex],
      status: 'done',
      endedAt: nowIso(),
    };
  }

  const targetStatus: ProgressStageStatus =
    statusOverride || (stageId === 'done' ? 'done' : 'active');
  state.stages[stageIndex] = {
    ...state.stages[stageIndex],
    status: targetStatus,
    startedAt: state.stages[stageIndex].startedAt || nowIso(),
    endedAt: targetStatus === 'done' ? nowIso() : state.stages[stageIndex].endedAt,
  };

  const percent = PROGRESS_STAGE_DEFS.find((s) => s.id === stageId)?.percent ?? state.percent;
  state.percent = Math.max(state.percent, percent);
  state.stageId = stageId;
  state.updatedAt = Date.now();

  if (targetStatus === 'error') {
    state.status = 'error';
    state.error = error;
  } else if (stageId === 'done') {
    state.status = 'done';
  } else {
    state.status = 'running';
  }

  pruneProgressStore();
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const generateProgressId = () => `ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Exported for unit tests in ai-chat.routes.test.ts. Production
// callers stay inside this module.
export { buildAskResponseData as _buildAskResponseData };
export { writeWithBackpressure as _writeWithBackpressure };
// scrubErrorDetail used to live here; PR-Sec-8 moved it to
// `ai-agents/audit/scrub.ts` so the orchestrator (per-tool errorDetail
// in composeResult) and the audit reader (prompt-audit.ts) can share
// the same implementation. Re-exported under the legacy `_` name so
// the existing tests in ai-chat.routes.test.ts keep working unchanged.
export { scrubErrorDetail as _scrubErrorDetail } from '../modules/ai-agents/audit/scrub.js';

/**
 * Narrow the orchestrator's full `OrchestratorRunResult` down to the
 * subset the client needs. Both `/api/ai/ask` (JSON body) and
 * `/api/ai/ask/stream` (the `done` SSE frame) call this so the two
 * routes can't drift on which fields they expose. Without this, the
 * SSE channel was shipping `finalPrompt.system`, `finalPrompt.user`,
 * `redactedPromptHash`, and `promptCharLength` — all audit-internal
 * fields that the non-streaming route deliberately keeps server-side.
 *
 * Add new public-response fields here, not at the call sites, so a
 * future addition to `OrchestratorRunResult` stays default-private.
 */
const buildAskResponseData = (
  question: string,
  result: OrchestratorRunResult,
  auditId: string | null,
  progressId: string,
) => ({
  question,
  answer: result.answer,
  // Honesty flags about the answer itself. None of them is the only
  // channel: `answerCutOff` and `retrievalFailure` are also written into
  // `answer` as a Chinese notice by the orchestrator, and
  // `answerTruncated` means `answer` is already the apology string — so
  // a client that ignores all three still tells the patient the truth.
  // These exist so a client can render a banner, hide the 「依据」 chips,
  // or offer a 「接着说」 button by reading state instead of
  // pattern-matching prose it does not control.
  //
  // Defaulted rather than spread-when-present: an SSE consumer reading
  // `data.answerCutOff` should get `false`, not `undefined`, on the
  // healthy path.
  answerTruncated: result.answerTruncated ?? false,
  answerCutOff: result.answerCutOff ?? false,
  retrievalFailure: result.retrievalFailure ?? null,
  citations: result.citations,
  // Renamed alongside PR #44 (ToolCallTrace): `string[]` → richer
  // `ToolCallSummary[]`. Mobile mirrors the field name.
  toolCalls: result.toolCalls,
  fieldsUsed: result.fieldsUsed,
  usedPersonalData: result.usedPersonalData,
  consentLevel: result.consentLevel,
  redactionMode: result.redactionMode,
  llmUsage: result.llmUsage,
  latencyMs: result.latencyMs,
  // Multi-turn transparency: how many prior turns the server actually
  // used (post-normalization). Additive — older clients ignore it.
  historyMessageCount: result.historyMessageCount,
  auditId,
  progressId,
  timestamp: new Date().toISOString(),
});

/**
 * Write a payload to an HTTP response and wait for `drain` if the
 * socket buffer is full. Node's `res.write` returns `false` when the
 * write went into a kernel-level queue rather than flushing
 * immediately; without awaiting drain a fast producer + slow client
 * can grow that queue without bound. SSE frames are usually small
 * single tokens, but a long answer that ships hundreds of frames to
 * a phone on 2G is the exact case where this matters.
 *
 * Resolves to `false` when the connection is already closed (write
 * would throw or be a no-op) so the caller can stop the producer
 * loop cleanly. Resolves to `true` otherwise — including the
 * happy path where `write` returned `true` synchronously.
 */
const writeWithBackpressure = (res: Response, payload: string): Promise<boolean> => {
  if (res.writableEnded || res.destroyed) return Promise.resolve(false);
  const flushed = res.write(payload);
  if (flushed) return Promise.resolve(true);
  // Buffer full: park on `drain`. Wire both `drain` and `close` so
  // a mid-flight disconnect resolves immediately instead of leaking
  // a listener.
  return new Promise<boolean>((resolve) => {
    const onDrain = () => {
      res.off('close', onClose);
      resolve(true);
    };
    const onClose = () => {
      res.off('drain', onDrain);
      resolve(false);
    };
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
};

/** Map orchestrator events onto the legacy progress stage ids so the
 *  existing /progress/:id endpoint keeps working without a frontend
 *  change. */
const handleOrchestratorEvent = (progressId: string, event: OrchestratorEvent) => {
  switch (event.type) {
    case 'planning':
      setProgressStage(progressId, 'query_gen');
      break;
    case 'tool_start':
      setProgressStage(progressId, 'kb_search');
      break;
    case 'answering':
      setProgressStage(progressId, 'final_answer');
      break;
    default:
      // plan_complete, tool_complete, context_built, done, error are
      // handled by the route around orchestrator.run (so we can
      // include the final error message + finalise the audit row).
      break;
  }
};

const buildOrchestrator = (llm: ILLMProvider, context: RouteContext, pool: Pool): Orchestrator => {
  const medicalKb = new MedicalKbRetriever({
    kbServiceUrl: context.env.kbServiceUrl,
    serviceToken: context.env.KB_SERVICE_TOKEN,
  });
  const profile = new PatientProfileRetriever(pool);
  const reports = new PatientReportsRetriever(pool);
  const followups = new PatientFollowupRetriever(pool);
  const trials = new ClinicalTrialsRetriever(pool);
  const registry = new ToolRegistry()
    .register(new SearchMedicalKbTool(medicalKb))
    .register(new GetMyProfileTool(profile))
    .register(new GetMyReportsTool(reports))
    .register(new GetMyRecordsTool(followups))
    .register(new ListClinicalTrialsTool(trials));
  return new Orchestrator(llm, registry, context.logger, {
    maxToolRounds: context.env.AI_MAX_TOOL_ROUNDS,
  });
};

/** Optional dependency overrides — tests pass in mocks for `pool`,
 *  `llm`, and `orchestrator`; production uses the defaults. */
export interface AiChatRoutesDeps {
  pool?: Pool;
  llmProvider?: ILLMProvider | null;
  orchestrator?: Orchestrator | null;
  auditLogger?: AuditLogger;
}

const createAiChatRoutes = (context: RouteContext, deps: AiChatRoutesDeps = {}) => {
  const router = Router();
  const authMiddleware: RequestHandler = requireAuth(context.env, context.logger);
  /**
   * Per-user, not per-IP. Every route these two limiters guard mounts
   * `authMiddleware` first, so `req.user.id` is always populated by the
   * time we get here — and Chinese mobile carriers put very large
   * subscriber pools behind a handful of CGNAT egress addresses. Keyed
   * on IP, the 6-questions-per-minute AI budget was shared by every
   * unrelated patient on the same carrier: a user who had asked nothing
   * got 「AI 请求过于频繁，请稍后再试」 because strangers were asking.
   * `trust proxy 1` makes req.ip the real client address rather than
   * Caddy's, so the collapse was per carrier egress IP, which is
   * exactly the granularity that hurts.
   *
   * The `?? req.ip` fallback is unreachable on today's mounts and stays
   * as the safe answer if one of these limiters is ever put in front of
   * an anonymous route. Same shape as profile.routes.ts's uploadLimiter.
   */
  const authenticatedUserKey = (req: Request) =>
    (req as AuthenticatedRequest).user?.id ?? req.ip ?? 'unknown';
  const aiAskLimiter = createRateLimitMiddleware({
    keyPrefix: 'ai:ask',
    windowMs: context.env.AI_RATE_LIMIT_WINDOW_SECONDS * 1000,
    maxRequests: context.env.AI_RATE_LIMIT_MAX_REQUESTS,
    message: 'AI 请求过于频繁，请稍后再试',
    keyResolver: authenticatedUserKey,
  });
  const aiProgressLimiter = createRateLimitMiddleware({
    keyPrefix: 'ai:progress',
    windowMs: context.env.AI_PROGRESS_RATE_LIMIT_WINDOW_SECONDS * 1000,
    maxRequests: context.env.AI_PROGRESS_RATE_LIMIT_MAX_REQUESTS,
    message: '进度轮询过于频繁，请稍后再试',
    keyResolver: authenticatedUserKey,
  });

  /** Shared multi-turn history parsing for /ask and /ask/stream — one
   *  implementation so the two endpoints can't drift. Returns null
   *  after writing the 400 when the payload is structurally invalid;
   *  size overruns are truncated silently (see normalizeHistory). */
  const parseHistoryOrRespond = (
    raw: unknown,
    res: Response,
    progressId: string,
  ): NormalizedHistory | null => {
    try {
      return normalizeHistory(raw, {
        maxMessages: context.env.AI_HISTORY_MAX_MESSAGES,
        charBudget: context.env.AI_HISTORY_CHAR_BUDGET,
      });
    } catch (error) {
      // Only the validator's own 400 is a client fault — anything
      // else is a server bug and must reach the error handler (a
      // blanket catch would disguise it as invalid_history).
      if (!(error instanceof AppError) || error.statusCode !== 400) {
        throw error;
      }
      res.status(400).json({
        success: false,
        code: 'invalid_history',
        message: '对话历史格式不正确',
        progressId,
      });
      return null;
    }
  };

  const pool = deps.pool ?? getPool();
  const auditLogger = deps.auditLogger ?? new AuditLogger(pool);

  /** Shared `context` handling for /ask and /ask/stream.
   *
   *  A bad reference is answered, not ignored: the patient tapped
   *  「这什么意思」on a specific report or curve, so silently dropping
   *  the context would return a plausible generic answer to a question
   *  that was never generic. `{ ok: false }` means the response has
   *  already been written. `context` stays undefined when the caller
   *  supplied none, which is the ordinary free-form-question path.
   *
   *  The resolved hint carries no patient values (see ask-context.ts),
   *  so it needs no scrubbing — and because it rides in the user
   *  prompt it lands in `redactedPromptHash` for free. */
  const resolveContextOrRespond = async (
    raw: unknown,
    res: Response,
    progressId: string,
    userId: string,
  ): Promise<{ ok: true; context?: ResolvedAskContext } | { ok: false }> => {
    let ref;
    try {
      ref = parseAskContext(raw);
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode !== 400) throw error;
      res.status(400).json({
        success: false,
        code: 'invalid_context',
        message: error.message,
        progressId,
      });
      return { ok: false };
    }

    if (!ref) return { ok: true };

    try {
      return { ok: true, context: await resolveAskContext(pool, userId, ref) };
    } catch (error) {
      // 404 is the only client-visible outcome here — it covers both
      // "no such row" and "belongs to someone else", deliberately
      // indistinguishable. Anything else is a server fault.
      if (error instanceof AppError && error.statusCode === 404) {
        res.status(404).json({
          success: false,
          code: 'context_not_found',
          message: error.message,
          progressId,
        });
        return { ok: false };
      }
      throw error;
    }
  };

  const llmProvider =
    deps.llmProvider !== undefined
      ? deps.llmProvider
      : createLlmProvider(context.env, context.logger);
  const orchestrator =
    deps.orchestrator !== undefined
      ? deps.orchestrator
      : llmProvider
        ? buildOrchestrator(llmProvider, context, pool)
        : null;

  if (!orchestrator) {
    context.logger.warn('AI orchestrator disabled: no LLM provider configured');
  }

  router.post(
    '/ask',
    authMiddleware,
    aiAskLimiter,
    asyncHandler(async (req, res) => {
      const progressId =
        typeof req.body?.progressId === 'string' && req.body.progressId.trim()
          ? req.body.progressId.trim()
          : generateProgressId();

      const userId = (req as { user?: { id?: string } }).user?.id;
      const question = req.body?.question;

      // Auth check has to run BEFORE any progress store mutation so a
      // request with a missing/forged user can't pre-empt another user's
      // entry by reusing their progressId.
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: '需要登录',
          progressId,
        });
      }

      if (initProgress(progressId, userId) === null) {
        return res.status(409).json({
          success: false,
          message: 'progressId 已被占用',
          progressId,
        });
      }
      setProgressStage(progressId, 'received');

      if (!question || !String(question).trim()) {
        setProgressStage(progressId, 'received', 'error', '问题不能为空');
        return res.status(400).json({
          success: false,
          message: '问题不能为空',
          progressId,
        });
      }

      if (!orchestrator || !llmProvider) {
        setProgressStage(progressId, 'received', 'error', 'AI 服务未配置');
        return res.status(503).json({
          success: false,
          message: 'AI 服务未配置（缺少 AI_API_KEY）',
          progressId,
        });
      }

      const history = parseHistoryOrRespond(req.body?.history, res, progressId);
      if (history === null) {
        setProgressStage(progressId, 'received', 'error', 'invalid_history');
        return;
      }

      const askContext = await resolveContextOrRespond(req.body?.context, res, progressId, userId);
      if (!askContext.ok) {
        setProgressStage(progressId, 'received', 'error', 'invalid_context');
        return;
      }

      let consentStatus;
      try {
        consentStatus = await getConsentStatus(pool, userId);
      } catch (error) {
        const detail = getErrorMessage(error);
        context.logger.error({ userId, error: detail }, 'consent lookup failed');
        setProgressStage(progressId, 'received', 'error', '系统错误');
        return res.status(500).json({
          success: false,
          message: 'AI 服务暂时不可用',
          progressId,
        });
      }

      if (consentStatus.level === 'none') {
        try {
          await auditLogger.record({
            userId,
            requestId: progressId,
            llmProvider: llmProvider.providerName,
            llmModel: llmProvider.model,
            consentLevel: 'none',
            redactionMode: 'strict',
            historyMessageCount: history.messages.length,
            historyCharLength: history.charLength,
            usedPersonalData: false,
            fieldsUsed: [],
            toolsCalled: [],
            status: 'consent_denied',
          });
        } catch (auditError) {
          context.logger.warn(
            { error: getErrorMessage(auditError), progressId },
            'consent_denied audit insert failed',
          );
        }
        setProgressStage(progressId, 'done', 'error', 'consent_required');
        return res.status(403).json({
          success: false,
          code: 'consent_required',
          message: '请先在隐私设置中同意 AI 使用你的数据',
          consent: consentStatus,
          progressId,
        });
      }

      // Cancel the run when the client walks away. /ask/stream and
      // /draft-log already wire this; /ask did not, so a phone that hit
      // its request timeout (or a user who backed out of the screen)
      // left the orchestrator running to completion — planner + final
      // answer tokens still billed, tool queries still holding pool
      // connections, and an audit row written for an answer nobody will
      // ever read. `writableEnded` guards the normal path: `close` also
      // fires after a successful `res.json`, and aborting there would
      // fire the signal on every completed request.
      const abortController = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded && !abortController.signal.aborted) abortController.abort();
      });

      const start = Date.now();
      try {
        const result = await orchestrator.run(
          {
            userId,
            question: String(question),
            requestId: progressId,
            consentLevel: consentStatus.level,
            history: history.messages,
            userContextHint: askContext.context?.hint,
            scope: askContext.context?.scope,
            signal: abortController.signal,
          },
          (event) => handleOrchestratorEvent(progressId, event),
        );

        let auditId: string | null = null;
        try {
          auditId = await auditLogger.record({
            userId,
            requestId: progressId,
            llmProvider: llmProvider.providerName,
            llmModel: llmProvider.model,
            consentLevel: result.consentLevel,
            redactionMode: result.redactionMode,
            redactedPromptHash: result.redactedPromptHash,
            promptCharLength: result.promptCharLength,
            historyMessageCount: result.historyMessageCount,
            historyCharLength: result.historyCharLength,
            usedPersonalData: result.usedPersonalData,
            fieldsUsed: result.fieldsUsed,
            toolsCalled: result.toolCalls,
            latencyMs: result.latencyMs,
            status: 'success',
          });
        } catch (auditError) {
          context.logger.warn(
            { error: getErrorMessage(auditError), progressId },
            'success audit insert failed',
          );
        }

        setProgressStage(progressId, 'done');

        return res.json({
          success: true,
          data: buildAskResponseData(String(question), result, auditId, progressId),
        });
      } catch (error) {
        const detail = getErrorMessage(error);
        const isConsentError = error instanceof OrchestratorConsentDenied;
        const status = isConsentError ? 403 : 500;

        context.logger.error({ userId, progressId, error: detail }, 'orchestrator.run failed');

        try {
          await auditLogger.record({
            userId,
            requestId: progressId,
            llmProvider: llmProvider.providerName,
            llmModel: llmProvider.model,
            consentLevel: consentStatus.level,
            redactionMode: redactionModeForConsent(consentStatus.level),
            historyMessageCount: history.messages.length,
            historyCharLength: history.charLength,
            // A client disconnect now routes here (the run is aborted
            // rather than left to finish), and an aborted run is not the
            // same thing as a run that never touched patient data: by the
            // time round 2 is cancelled, the tools have executed and the
            // redacted context has already gone to the provider.
            //
            // Asserting `false` would make the audit trail — which the
            // patient can export as `aiAuditTrail` — claim their data
            // stayed on our side because the call failed. That is exactly
            // the claim /ai/draft-log refuses to make on its own error
            // path. We cannot recover the field list once run() rejects,
            // so record the honest floor: personal data was in play,
            // fields unknown.
            usedPersonalData: !isConsentError,
            fieldsUsed: [],
            toolsCalled: [],
            latencyMs: Date.now() - start,
            status: isConsentError ? 'consent_denied' : 'error',
            errorDetail: scrubErrorDetail(detail).slice(0, 500),
          });
        } catch (auditError) {
          context.logger.warn(
            { error: getErrorMessage(auditError), progressId },
            'error audit insert failed',
          );
        }

        // Apply the same PII scrubber the audit row uses BEFORE
        // putting `detail` on the response body or in the progress
        // stage. Without this, a pg error carrying `$1 = '张三'` or
        // `DETAIL: Key (phone)=(...)` would reach the client even
        // though the audit row was clean.
        const safeDetail = scrubErrorDetail(detail).slice(0, 500);
        setProgressStage(progressId, 'done', 'error', safeDetail);
        return res.status(status).json({
          success: false,
          code: isConsentError ? 'consent_required' : 'ai_error',
          message: isConsentError ? '请先同意 AI 使用你的数据' : 'AI 服务暂时不可用',
          detail: safeDetail,
          progressId,
        });
      }
    }),
  );

  router.post('/ask/progress/init', authMiddleware, aiProgressLimiter, (req, res) => {
    const userId = (req as { user?: { id?: string } }).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '需要登录' });
    }
    const progressId =
      typeof req.body?.progressId === 'string' && req.body.progressId.trim()
        ? req.body.progressId.trim()
        : null;
    if (!progressId) {
      return res.status(400).json({ success: false, message: 'progressId 不能为空' });
    }
    if (initProgress(progressId, userId) === null) {
      return res.status(409).json({
        success: false,
        message: 'progressId 已被占用',
      });
    }
    setProgressStage(progressId, 'received');
    return res.json({
      success: true,
      data: { progressId, status: 'running', percent: 5, stageId: 'received' },
    });
  });

  router.get('/ask/progress/:progressId', authMiddleware, aiProgressLimiter, (req, res) => {
    pruneProgressStore();
    const userId = (req as { user?: { id?: string } }).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '需要登录' });
    }
    const progressId = req.params.progressId;
    const state = progressStore.get(progressId);
    // Treat "wrong owner" identically to "not found" so an attacker
    // can't probe which progressIds exist server-side.
    if (!state || state.userId !== userId) {
      return res.status(404).json({ success: false, message: '进度不存在或已过期' });
    }
    return res.json({
      success: true,
      data: {
        progressId: state.id,
        status: state.status,
        percent: state.percent,
        stageId: state.stageId,
        stages: state.stages,
        error: state.error,
        updatedAt: new Date(state.updatedAt).toISOString(),
      },
    });
  });

  router.get('/audit', authMiddleware, aiProgressLimiter, async (req, res) => {
    const userId = (req as { user?: { id?: string } }).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '需要登录' });
    }

    const rawLimit = req.query.limit;
    const rawOffset = req.query.offset;
    const rawStatus = req.query.status;

    let limit: number | undefined;
    if (typeof rawLimit === 'string' && rawLimit.trim()) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return res.status(400).json({ success: false, message: 'limit 必须是正整数' });
      }
      limit = parsed;
    }

    let offset: number | undefined;
    if (typeof rawOffset === 'string' && rawOffset.trim()) {
      const parsed = Number(rawOffset);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ success: false, message: 'offset 必须是非负整数' });
      }
      offset = parsed;
    }

    let status: 'success' | 'error' | 'consent_denied' | undefined;
    if (typeof rawStatus === 'string' && rawStatus.trim()) {
      const normalised = rawStatus.trim();
      if (normalised !== 'success' && normalised !== 'error' && normalised !== 'consent_denied') {
        return res.status(400).json({
          success: false,
          message: 'status 只支持 success / error / consent_denied 三种之一',
        });
      }
      status = normalised;
    }

    try {
      const items = await auditLogger.listByUser(userId, { limit, offset, status });
      // AuditLogger caps `limit` server-side. When the client gets
      // back exactly `limit` rows we *probably* have more, so signal
      // `hasMore=true`. Strictly correct would need an extra count
      // query; this heuristic is cheap and the UI just hides a
      // "Load more" button when it goes false.
      const effectiveLimit = Math.min(limit ?? 50, 200);
      return res.json({
        success: true,
        data: {
          items,
          count: items.length,
          hasMore: items.length >= effectiveLimit,
        },
      });
    } catch (error) {
      context.logger.error({ userId, error: getErrorMessage(error) }, 'audit list query failed');
      return res.status(500).json({ success: false, message: '审计记录暂时不可用' });
    }
  });

  /**
   * POST /api/ai/ask/stream — Server-Sent Events variant of /ask.
   *
   * Emits one SSE frame per OrchestratorEvent. The final `done` event
   * carries the same `OrchestratorRunResult` shape /ask returns, so
   * mobile clients can treat the existing fields (citations,
   * toolsCalled, fieldsUsed, etc.) as authoritative — `answer_delta`
   * frames are additive UX improvements that let the answer
   * materialise token-by-token.
   *
   * Frame format follows the standard `event: <type>\ndata: <json>\n\n`
   * convention so a vanilla EventSource consumer can subscribe per
   * type. The legacy `/api/ai/ask/progress/:id` endpoint is NOT
   * driven by this route — streaming clients should listen to the
   * SSE channel directly.
   *
   * Audit row is written when the orchestrator finishes (success or
   * error). Client disconnects abort the upstream LLM stream via
   * res.on('close') so a dropped phone doesn't keep burning tokens.
   */
  router.post(
    '/ask/stream',
    authMiddleware,
    aiAskLimiter,
    asyncHandler(async (req, res) => {
      const progressId =
        typeof req.body?.progressId === 'string' && req.body.progressId.trim()
          ? req.body.progressId.trim()
          : generateProgressId();
      const userId = (req as { user?: { id?: string } }).user?.id;
      const question = req.body?.question;

      if (!question || !String(question).trim()) {
        return res.status(400).json({ success: false, message: '问题不能为空', progressId });
      }
      if (!userId) {
        return res.status(401).json({ success: false, message: '需要登录', progressId });
      }
      if (!orchestrator || !llmProvider) {
        return res.status(503).json({
          success: false,
          message: 'AI 服务未配置（缺少 AI_API_KEY）',
          progressId,
        });
      }

      // Reserve the progress entry under this user. The legacy /ask
      // route already did this; the streaming route skipped it, which
      // meant a malicious client could supply a progressId already
      // owned by another user. The route doesn't read the store after
      // this, but the audit row written at end-of-stream carries
      // `request_id = progressId` and that needs to map 1:1 to a user.
      if (initProgress(progressId, userId) === null) {
        return res.status(409).json({
          success: false,
          message: 'progressId 已被占用',
          progressId,
        });
      }

      // Parse BEFORE committing to SSE: a structurally invalid history
      // must be a JSON 400, not an error frame mid-stream. Same for the
      // context reference — an unknown metric key or someone else's
      // document id is a request-shaping fault the client can act on,
      // and it deserves a status code rather than a frame the UI would
      // have to render inside a half-open answer bubble.
      //
      // Both rejections have to terminate the progress entry `initProgress`
      // just reserved. /ask marks these branches 'error'; the streaming
      // route did not, so a client that had already opened
      // /progress/:progressId (mobile initialises it before the POST) sat
      // on a bar frozen at the previous stage with status 'running' until
      // the 10-minute TTL pruned the entry — no failure ever surfaced
      // there, even though the POST itself came back 400/404.
      const history = parseHistoryOrRespond(req.body?.history, res, progressId);
      if (history === null) {
        setProgressStage(progressId, 'received', 'error', 'invalid_history');
        return;
      }

      const askContext = await resolveContextOrRespond(req.body?.context, res, progressId, userId);
      if (!askContext.ok) {
        setProgressStage(progressId, 'received', 'error', 'invalid_context');
        return;
      }

      let consentStatus;
      try {
        consentStatus = await getConsentStatus(pool, userId);
      } catch (error) {
        const detail = getErrorMessage(error);
        context.logger.error({ userId, error: detail }, 'consent lookup failed (stream)');
        return res.status(500).json({ success: false, message: 'AI 服务暂时不可用', progressId });
      }

      if (consentStatus.level === 'none') {
        try {
          await auditLogger.record({
            userId,
            requestId: progressId,
            llmProvider: llmProvider.providerName,
            llmModel: llmProvider.model,
            consentLevel: 'none',
            redactionMode: 'strict',
            historyMessageCount: history.messages.length,
            historyCharLength: history.charLength,
            usedPersonalData: false,
            fieldsUsed: [],
            toolsCalled: [],
            status: 'consent_denied',
          });
        } catch (auditError) {
          context.logger.warn(
            { error: getErrorMessage(auditError), progressId },
            'consent_denied audit insert failed (stream)',
          );
        }
        return res.status(403).json({
          success: false,
          code: 'consent_required',
          message: '请先在隐私设置中同意 AI 使用你的数据',
          consent: consentStatus,
          progressId,
        });
      }

      // From here on we commit to SSE: set headers + flush, then any
      // future failure becomes an `error` frame instead of a JSON body
      // (the client has already started reading a stream).
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      // Nginx-friendly: disable proxy buffering so frames flush immediately.
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      // Cancel the upstream LLM request when the client drops. The
      // controller is forwarded to orchestrator -> SiliconFlow ->
      // OpenAI SDK, which threads it through fetch + the streaming
      // iterator so a dropped phone stops burning tokens immediately
      // (and frees vendor-side concurrency budget) instead of letting
      // the model finish on its own.
      const start = Date.now();
      let clientGone = false;
      const abortController = new AbortController();
      res.on('close', () => {
        clientGone = true;
        // Abort first so the LLM HTTP request is cancelled even if the
        // for-await loop is currently blocked on `next()` — we don't
        // want to stay in cache-miss territory waiting for the next
        // chunk to arrive just to discover the client is gone.
        if (!abortController.signal.aborted) abortController.abort();
        // Stop the heartbeat now even though the trailing
        // clearInterval below also covers it — without the early
        // clear we'd keep writing into a closed socket for the
        // remainder of the in-flight orchestrator run (the for-await
        // loop ignores `clientGone` only between events; while it's
        // blocked on `next()` we'd otherwise emit several stale
        // keepalives that all throw and get swallowed).
        clearInterval(keepaliveTimer);
      });

      // Keepalive heartbeat. The mobile SSE client has a ~15s idle
      // watchdog that flips a stalled stream into 'error'. Without
      // these frames, healthy long waits (planner LLM up to 30s, tool
      // execution up to 30s per call) would trip that watchdog and
      // kill perfectly fine runs. We emit a named `keepalive` event
      // every 5s — 3× the mobile heartbeat margin — purely as
      // transport heartbeat; the client's keepalive listener just
      // resets its watchdog and does not surface the event upward.
      //
      // The setInterval runs on Node's own event loop tick so it
      // keeps firing even while the for-await below is blocked
      // waiting on orchestrator events (which is exactly when we
      // need it most).
      const KEEPALIVE_MS = 5_000;
      const keepaliveTimer = setInterval(() => {
        if (clientGone) return;
        // Direct res.write — we don't go through writeWithBackpressure
        // because a buffered keepalive is fine to drop (subsequent
        // ticks will retry) and we don't want to add a queue here.
        try {
          res.write('event: keepalive\ndata: {}\n\n');
        } catch {
          // Connection already torn down; let res.on('close') handle
          // the rest of the cleanup.
        }
      }, KEEPALIVE_MS);

      /** Serialise one OrchestratorEvent to its on-the-wire payload.
       *
       *  The `done` event is special-cased: instead of dumping the full
       *  `OrchestratorRunResult` (which carries audit-internal fields
       *  like `finalPrompt.system/user`, `redactedPromptHash`, and
       *  `promptCharLength`), we narrow it through
       *  `buildAskResponseData` so streaming and non-streaming clients
       *  see the same response shape. The frame's `event:` type stays
       *  `done` so EventSource listeners don't need to change. */
      const serializeFrame = (event: OrchestratorEvent): string => {
        let dataPayload: unknown = event;
        if (event.type === 'done') {
          dataPayload = {
            type: 'done',
            data: buildAskResponseData(String(question), event.result, null, progressId),
          };
        }
        return `event: ${event.type}\ndata: ${JSON.stringify(dataPayload)}\n\n`;
      };

      /** Write a frame and yield to the socket if its buffer is full.
       *  Returns false if the client disconnected mid-write so the
       *  caller can break out of the producer loop. */
      const writeFrame = (event: OrchestratorEvent): Promise<boolean> =>
        writeWithBackpressure(res, serializeFrame(event));

      let lastResult: Extract<OrchestratorEvent, { type: 'done' }>['result'] | null = null;
      let streamError: string | null = null;

      try {
        for await (const event of runOrchestratorStream(
          orchestrator,
          {
            userId,
            question: String(question),
            requestId: progressId,
            consentLevel: consentStatus.level,
            history: history.messages,
            userContextHint: askContext.context?.hint,
            scope: askContext.context?.scope,
            signal: abortController.signal,
          },
          { streamFinalAnswer: true },
        )) {
          if (clientGone) break;
          const flushed = await writeFrame(event);
          if (!flushed) {
            clientGone = true;
            break;
          }
          if (event.type === 'done') lastResult = event.result;
          if (event.type === 'error') streamError = event.message;
        }
      } catch (error) {
        const detail = getErrorMessage(error);
        // Same scrubber as the JSON response path. The SSE error frame
        // is rendered straight in the mobile audit-history viewer.
        const safeDetail = scrubErrorDetail(detail).slice(0, 500);
        streamError = safeDetail;
        // The orchestrator's own try/catch usually emits `error`
        // before throwing, but a sync throw from runStream itself
        // wouldn't. Surface it as a frame so the client gets a
        // clean signal rather than a half-written stream.
        if (!clientGone) await writeFrame({ type: 'error', message: safeDetail });
      }

      // Audit row mirrors /ask: success when we have a final result,
      // error otherwise. The audit insert may itself throw — we log
      // but don't fail the response (it's already been sent).
      try {
        if (lastResult) {
          await auditLogger.record({
            userId,
            requestId: progressId,
            llmProvider: llmProvider.providerName,
            llmModel: llmProvider.model,
            consentLevel: lastResult.consentLevel,
            redactionMode: lastResult.redactionMode,
            redactedPromptHash: lastResult.redactedPromptHash,
            promptCharLength: lastResult.promptCharLength,
            historyMessageCount: lastResult.historyMessageCount,
            historyCharLength: lastResult.historyCharLength,
            usedPersonalData: lastResult.usedPersonalData,
            fieldsUsed: lastResult.fieldsUsed,
            toolsCalled: lastResult.toolCalls,
            latencyMs: lastResult.latencyMs,
            status: 'success',
          });
        } else {
          await auditLogger.record({
            userId,
            requestId: progressId,
            llmProvider: llmProvider.providerName,
            llmModel: llmProvider.model,
            consentLevel: consentStatus.level,
            redactionMode: redactionModeForConsent(consentStatus.level),
            historyMessageCount: history.messages.length,
            historyCharLength: history.charLength,
            usedPersonalData: false,
            fieldsUsed: [],
            toolsCalled: [],
            latencyMs: Date.now() - start,
            status: 'error',
            errorDetail: scrubErrorDetail(streamError || 'stream aborted').slice(0, 500),
          });
        }
      } catch (auditError) {
        context.logger.warn(
          { error: getErrorMessage(auditError), progressId },
          'streaming audit insert failed',
        );
      }

      // Stop the heartbeat regardless of how we got here (clean done,
      // mid-stream error, client disconnect). A leaked interval would
      // keep firing res.write into a closed socket and eventually
      // crash the process with EPIPE / write-after-end.
      clearInterval(keepaliveTimer);

      if (!clientGone) {
        res.end();
      }
    }),
  );

  /**
   * POST /api/ai/draft-log — turn one sentence into a pre-filled entry
   * form. Never writes: the response is a draft the patient reviews in
   * the UI, and saving still goes through the validated
   * `POST /profiles/me/*` handlers. See drafting/draft-log.ts.
   */
  router.post(
    '/draft-log',
    authMiddleware,
    aiAskLimiter,
    asyncHandler(async (req, res) => {
      const userId = (req as { user?: { id?: string } }).user?.id;
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

      if (!userId) {
        return res.status(401).json({ success: false, message: '需要登录' });
      }
      if (!text) {
        return res.status(400).json({ success: false, message: '请先说一句话' });
      }
      if (text.length > DRAFT_LOG_MAX_CHARS) {
        return res.status(400).json({
          success: false,
          message: `一次最多 ${DRAFT_LOG_MAX_CHARS} 字，太长的话分几次记`,
        });
      }
      if (!llmProvider) {
        return res
          .status(503)
          .json({ success: false, message: 'AI 服务未配置（缺少 AI_API_KEY）' });
      }
      // Re-bind after the null check so the audit closure below doesn't
      // depend on narrowing surviving into a nested function.
      const provider = llmProvider;

      // Correlation id is minted before the consent gate so the 403 row
      // gets one too — support triage joins ai_prompt_audit on
      // request_id, and a null there is a row you can't tie to anything.
      const requestId = generateProgressId();

      /**
       * Every exit of this handler that got past auth writes exactly one
       * audit row — success, provider failure, and the consent 403 alike.
       * The rows matter more here than on /ask: this is the only outbound
       * LLM path with no redactor in front of it (the patient's sentence
       * goes to the provider verbatim), and `ai_prompt_audit` is what the
       * data export ships as `aiAuditTrail`, so a missing row makes the
       * subject-access listing itself incomplete.
       *
       * Deliberately different from /ask:
       *  - `redactedPromptHash` / `promptCharLength` stay null. Nothing
       *    was redacted, so there is no redacted prompt to hash; hashing
       *    the raw sentence would silently turn the column into a
       *    different claim than every other row makes.
       *  - `fieldsUsed` / `toolsCalled` are empty because drafting reads
       *    no retriever and calls no tool — but `usedPersonalData` is
       *    still true on the paths that reached the provider, since the
       *    free-text input is itself the patient's data.
       */
      const recordDraftAudit = async (
        fields: Pick<AuditEntryInput, 'consentLevel' | 'usedPersonalData' | 'status'> &
          Partial<Pick<AuditEntryInput, 'latencyMs' | 'errorDetail'>>,
      ) => {
        try {
          await auditLogger.record({
            userId,
            requestId,
            llmProvider: provider.providerName,
            llmModel: provider.model,
            consentLevel: fields.consentLevel,
            // The mode the consent level implies, not one that ran here:
            // the column is constrained to 'strict' | 'precise' (migration
            // 011) and drafting applies neither. Recording the implied
            // mode keeps the row joinable with the chat rows; the honest
            // "no redaction" value would need a schema change.
            redactionMode: redactionModeForConsent(fields.consentLevel),
            usedPersonalData: fields.usedPersonalData,
            fieldsUsed: [],
            toolsCalled: [],
            latencyMs: fields.latencyMs,
            status: fields.status,
            errorDetail: fields.errorDetail,
          });
        } catch (auditError) {
          context.logger.warn(
            { error: getErrorMessage(auditError), requestId },
            'draft-log audit insert failed',
          );
        }
      };

      // Nothing patient-scoped is retrieved here, but the sentence the
      // patient typed IS their data and it leaves for the provider — so
      // the same consent gate the chat endpoints use applies.
      let consentStatus;
      try {
        consentStatus = await getConsentStatus(pool, userId);
      } catch (error) {
        context.logger.error(
          { userId, error: getErrorMessage(error) },
          'consent lookup failed (draft-log)',
        );
        return res.status(500).json({ success: false, message: 'AI 服务暂时不可用' });
      }

      if (consentStatus.level === 'none') {
        // usedPersonalData is false here and only here: the gate fired
        // before draftLogFromText, so the sentence never left the server.
        await recordDraftAudit({
          consentLevel: 'none',
          usedPersonalData: false,
          status: 'consent_denied',
        });
        return res.status(403).json({
          success: false,
          code: 'consent_required',
          message: '请先在隐私设置中同意 AI 使用你的数据',
          consent: consentStatus,
        });
      }

      const start = Date.now();
      // Abort the upstream call if the client walks away mid-draft.
      const abortController = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded && !abortController.signal.aborted) abortController.abort();
      });

      try {
        const draft = await draftLogFromText(text, {
          llm: provider,
          logger: context.logger,
          requestId,
          signal: abortController.signal,
        });
        await recordDraftAudit({
          consentLevel: consentStatus.level,
          usedPersonalData: true,
          latencyMs: Date.now() - start,
          status: 'success',
        });
        return res.json({ success: true, data: draft });
      } catch (error) {
        const detail = getErrorMessage(error);
        context.logger.error({ userId, requestId, error: detail }, 'draft-log failed');
        // The sentence had already been handed to the provider by the
        // time this threw (or was aborted mid-flight), so the row still
        // reports personal data as used — the export must not imply the
        // text stayed on our side just because the call failed.
        await recordDraftAudit({
          consentLevel: consentStatus.level,
          usedPersonalData: true,
          latencyMs: Date.now() - start,
          status: 'error',
          errorDetail: scrubErrorDetail(detail).slice(0, 500),
        });
        return res.status(500).json({
          success: false,
          code: 'ai_error',
          message: 'AI 暂时整理不了，你可以直接手动填写',
          detail: scrubErrorDetail(detail).slice(0, 500),
        });
      }
    }),
  );

  router.get('/health', authMiddleware, (_req, res) => {
    res.json({
      service: 'AI Chat',
      status: orchestrator ? 'active' : 'disabled',
      llmConfigured: !!llmProvider,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
};

export { createAiChatRoutes };
