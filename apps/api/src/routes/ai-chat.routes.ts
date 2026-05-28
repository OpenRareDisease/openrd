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
import type { RequestHandler } from 'express';
import type { Pool } from 'pg';

import type { RouteContext } from './index.js';
import { getPool } from '../db/pool.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { AuditLogger } from '../modules/ai-agents/audit/index.js';
import { createLlmProvider, type ILLMProvider } from '../modules/ai-agents/llm/index.js';
import {
  Orchestrator,
  OrchestratorConsentDenied,
  type OrchestratorEvent,
} from '../modules/ai-agents/orchestrator/index.js';
import {
  MedicalKbRetriever,
  PatientProfileRetriever,
  PatientReportsRetriever,
} from '../modules/ai-agents/retrievers/index.js';
import { getConsentStatus, redactionModeForConsent } from '../modules/ai-agents/security/index.js';
import {
  GetMyProfileTool,
  GetMyReportsTool,
  SearchMedicalKbTool,
  ToolRegistry,
} from '../modules/ai-agents/tools/index.js';

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

const PROGRESS_TTL_MS = 10 * 60 * 1000;
const progressStore = new Map<string, ProgressState>();

const nowIso = () => new Date().toISOString();

const pruneProgressStore = () => {
  const cutoff = Date.now() - PROGRESS_TTL_MS;
  for (const [id, entry] of progressStore.entries()) {
    if (entry.updatedAt < cutoff) progressStore.delete(id);
  }
};

const initProgress = (progressId: string): ProgressState => {
  const stages: ProgressStage[] = PROGRESS_STAGE_DEFS.map((stage) => ({
    id: stage.id,
    label: stage.label,
    status: 'pending',
  }));
  const state: ProgressState = {
    id: progressId,
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
  const medicalKb = new MedicalKbRetriever({ kbServiceUrl: context.env.kbServiceUrl });
  const profile = new PatientProfileRetriever(pool);
  const reports = new PatientReportsRetriever(pool);
  const registry = new ToolRegistry()
    .register(new SearchMedicalKbTool(medicalKb))
    .register(new GetMyProfileTool(profile))
    .register(new GetMyReportsTool(reports));
  return new Orchestrator(llm, registry, context.logger);
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
  const aiAskLimiter = createRateLimitMiddleware({
    keyPrefix: 'ai:ask',
    windowMs: context.env.AI_RATE_LIMIT_WINDOW_SECONDS * 1000,
    maxRequests: context.env.AI_RATE_LIMIT_MAX_REQUESTS,
    message: 'AI 请求过于频繁，请稍后再试',
  });
  const aiProgressLimiter = createRateLimitMiddleware({
    keyPrefix: 'ai:progress',
    windowMs: context.env.AI_PROGRESS_RATE_LIMIT_WINDOW_SECONDS * 1000,
    maxRequests: context.env.AI_PROGRESS_RATE_LIMIT_MAX_REQUESTS,
    message: '进度轮询过于频繁，请稍后再试',
  });

  const pool = deps.pool ?? getPool();
  const auditLogger = deps.auditLogger ?? new AuditLogger(pool);
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

  router.post('/ask', authMiddleware, aiAskLimiter, async (req, res) => {
    const progressId =
      typeof req.body?.progressId === 'string' && req.body.progressId.trim()
        ? req.body.progressId.trim()
        : generateProgressId();
    initProgress(progressId);
    setProgressStage(progressId, 'received');

    const userId = (req as { user?: { id?: string } }).user?.id;
    const question = req.body?.question;

    if (!question || !String(question).trim()) {
      setProgressStage(progressId, 'received', 'error', '问题不能为空');
      return res.status(400).json({
        success: false,
        message: '问题不能为空',
        progressId,
      });
    }

    if (!userId) {
      setProgressStage(progressId, 'received', 'error', '需要登录');
      return res.status(401).json({
        success: false,
        message: '需要登录',
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

    const start = Date.now();
    try {
      const result = await orchestrator.run(
        {
          userId,
          question: String(question),
          requestId: progressId,
          consentLevel: consentStatus.level,
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
        data: {
          question: String(question),
          answer: result.answer,
          citations: result.citations,
          toolCalls: result.toolCalls,
          fieldsUsed: result.fieldsUsed,
          usedPersonalData: result.usedPersonalData,
          consentLevel: result.consentLevel,
          redactionMode: result.redactionMode,
          llmUsage: result.llmUsage,
          latencyMs: result.latencyMs,
          auditId,
          progressId,
          timestamp: new Date().toISOString(),
        },
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
          usedPersonalData: false,
          fieldsUsed: [],
          toolsCalled: [],
          latencyMs: Date.now() - start,
          status: isConsentError ? 'consent_denied' : 'error',
          errorDetail: detail.slice(0, 500),
        });
      } catch (auditError) {
        context.logger.warn(
          { error: getErrorMessage(auditError), progressId },
          'error audit insert failed',
        );
      }

      setProgressStage(progressId, 'done', 'error', detail);
      return res.status(status).json({
        success: false,
        code: isConsentError ? 'consent_required' : 'ai_error',
        message: isConsentError ? '请先同意 AI 使用你的数据' : 'AI 服务暂时不可用',
        detail,
        progressId,
      });
    }
  });

  router.post('/ask/progress/init', authMiddleware, aiProgressLimiter, (req, res) => {
    const progressId =
      typeof req.body?.progressId === 'string' && req.body.progressId.trim()
        ? req.body.progressId.trim()
        : null;
    if (!progressId) {
      return res.status(400).json({ success: false, message: 'progressId 不能为空' });
    }
    initProgress(progressId);
    setProgressStage(progressId, 'received');
    return res.json({
      success: true,
      data: { progressId, status: 'running', percent: 5, stageId: 'received' },
    });
  });

  router.get('/ask/progress/:progressId', authMiddleware, aiProgressLimiter, (req, res) => {
    pruneProgressStore();
    const progressId = req.params.progressId;
    const state = progressStore.get(progressId);
    if (!state) {
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
