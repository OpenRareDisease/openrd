import { Router } from 'express';
import type { RequestHandler } from 'express';
import OpenAI from 'openai';
import type { RouteContext } from './index.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';

type QueryGenResult = {
  queries?: unknown;
  where?: unknown;
};

type KnowledgeChunk = { content?: string } | string;

type KnowledgeParseResult = {
  answer?: string;
  chunks?: KnowledgeChunk[];
};

type KnowledgePayload = {
  question: string;
  queries: string[];
  top_k: number;
  fetch_k: number;
  max_per_source: number;
  where: Record<string, unknown> | null;
  keep_debug_fields: boolean;
};

type ProgressStageStatus = 'pending' | 'active' | 'done' | 'error';

type ProgressStage = {
  id: string;
  label: string;
  status: ProgressStageStatus;
  startedAt?: string;
  endedAt?: string;
};

type ProgressState = {
  id: string;
  status: 'running' | 'done' | 'error';
  percent: number;
  stageId: string;
  stages: ProgressStage[];
  updatedAt: number;
  error?: string;
};

const PROGRESS_STAGE_DEFS = [
  { id: 'received', label: '接收问题', percent: 5 },
  { id: 'query_gen', label: '生成检索问题', percent: 25 },
  { id: 'kb_search', label: '检索知识库', percent: 60 },
  { id: 'final_answer', label: '生成回答', percent: 90 },
  { id: 'done', label: '整理结果', percent: 100 },
];

const PROGRESS_TTL_MS = 10 * 60 * 1000;
const progressStore = new Map<string, ProgressState>();

const nowIso = () => new Date().toISOString();

const pruneProgressStore = () => {
  const cutoff = Date.now() - PROGRESS_TTL_MS;
  for (const [id, entry] of progressStore.entries()) {
    if (entry.updatedAt < cutoff) {
      progressStore.delete(id);
    }
  }
};

const initProgress = (progressId: string) => {
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
  const updatedStage: ProgressStage = {
    ...state.stages[stageIndex],
    status: targetStatus,
    startedAt: state.stages[stageIndex].startedAt || nowIso(),
    endedAt: targetStatus === 'done' ? nowIso() : state.stages[stageIndex].endedAt,
  };
  state.stages[stageIndex] = updatedStage;

  const percent =
    PROGRESS_STAGE_DEFS.find((stage) => stage.id === stageId)?.percent ?? state.percent;
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

const cleanJsonText = (s: string) => s.replace(/^\uFEFF/, '').trim();

const safeJsonParse = <T = unknown>(s: string): T | null => {
  try {
    return JSON.parse(cleanJsonText(s)) as T;
  } catch {
    return null;
  }
};

const extractJsonObject = (text: string): unknown | null => {
  const raw = (text || '').trim();
  if (!raw) return null;

  const direct = safeJsonParse(raw);
  if (direct) return direct;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const inside = safeJsonParse(fenced[1]);
    if (inside) return inside;
  }

  const firstObj = raw.match(/\{[\s\S]*\}/);
  if (firstObj?.[0]) {
    const maybe = safeJsonParse(firstObj[0]);
    if (maybe) return maybe;
  }

  return null;
};

const chunksToText = (rawChunks: KnowledgeChunk[]): string[] => {
  if (!Array.isArray(rawChunks)) return [];
  return rawChunks
    .map((chunk) => (typeof chunk === 'string' ? chunk : chunk?.content))
    .filter((text): text is string => Boolean(text));
};

const isJunkChunk = (text: string) =>
  /目录|上一篇|下一篇|连载|排版|撰文|责任编辑|点击阅读|更多内容|病友故事\s*·\s*目录|社区简介|康复医师网络/.test(
    text,
  );

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'error' in error) {
    const nested = (error as { error?: unknown }).error;
    if (nested instanceof Error) return nested.message;
    return String(nested);
  }
  return String(error);
};

const requestKnowledgeBase = async (payload: KnowledgePayload, kbServiceUrl: string) => {
  let response: Response;

  try {
    response = await fetch(`${kbServiceUrl}/multi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    const message =
      '知识库服务不可用，请先启动 apps/api/knowledge_service.py（KB_SERVICE_HOST/PORT）。';
    throw new Error(message);
  }

  const text = await response.text();
  const parsed = safeJsonParse<KnowledgeParseResult>(text || '');

  if (!response.ok || !parsed) {
    const detail = parsed?.answer || text || `KB service error: ${response.status}`;
    throw new Error(detail);
  }

  const rawChunks = Array.isArray(parsed?.chunks) ? parsed.chunks : [];
  const chunksText = chunksToText(rawChunks);
  const filteredChunks = chunksText.filter((chunk) => !isJunkChunk(chunk));

  const ragContext = (filteredChunks.length ? filteredChunks : chunksText)
    .slice(0, 6)
    .map((chunk, index) => `【片段${index + 1}】${chunk}`)
    .join('\n\n');

  return {
    parsed,
    rawChunks,
    chunksText,
    filteredChunks,
    ragContext,
    payloadUsed: payload,
  };
};

const createAiChatRoutes = (context: RouteContext) => {
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
  const aiApiKey = context.env.AI_API_KEY || context.env.OPENAI_API_KEY || '';
  const openai = aiApiKey
    ? new OpenAI({
        apiKey: aiApiKey,
        baseURL: context.env.AI_API_BASE_URL,
        timeout: context.env.AI_API_TIMEOUT,
      })
    : null;

  if (!openai) {
    context.logger.warn('AI API key missing; /api/ai/ask will use KB fallback only');
  }

  router.post('/ask', authMiddleware, aiAskLimiter, async (req, res) => {
    const progressId =
      req.body && typeof req.body.progressId === 'string' ? req.body.progressId : null;
    if (progressId) {
      initProgress(progressId);
      setProgressStage(progressId, 'received');
    }

    try {
      const { question, userContext } = req.body || {};
      if (!question || !String(question).trim()) {
        if (progressId) {
          setProgressStage(progressId, 'received', 'error', '问题不能为空');
        }
        return res.status(400).json({ success: false, message: '问题不能为空' });
      }

      const userId = (req as { user?: { id?: string } }).user?.id;
      const kbServiceUrl = context.env.kbServiceUrl;
      context.logger.debug(
        {
          userId: userId ?? null,
          questionLength: String(question).trim().length,
          kbServiceUrl,
        },
        'AI ask request received',
      );

      let queries: string[] = [String(question)];
      let where: Record<string, unknown> | null = null;
      let queryGenRaw = '';

      try {
        if (progressId) {
          setProgressStage(progressId, 'query_gen');
        }
        if (!openai) {
          throw new Error('AI query generation disabled');
        }

        const queryGenSystem = `你是一个RAG检索查询生成器。你的任务：把用户问题改写成多条“更利于向医学知识库检索”的查询语句。
要求：
1) 只输出严格 JSON（不要任何额外文字、不要markdown代码块）
2) JSON schema：
{
  "queries": string[],         // 3~6条，包含中文同义问法 + 关键术语 +（可选）英文缩写/术语
  "where": object | null       // 可选：用于向量库过滤条件；不确定就给 null
}
3) queries 里要覆盖：
- 原问题的同义问法（更具体）
- 关键医学术语/缩写（如 FSHD, DUX4, D4Z4, 4q35 等，按问题相关性添加）
- 症状类问题要加：部位/持续时间/诱因/缓解方式/红旗症状关键词
4) 不要凭空捏造知识库里一定有的字段名；where 不确定就 null。`;

        const queryGenUser = `用户问题：${String(question)}
用户信息：${JSON.stringify(userContext || {})}`;

        const qgen = await openai.chat.completions.create({
          model: context.env.AI_API_MODEL,
          messages: [
            { role: 'system', content: queryGenSystem },
            { role: 'user', content: queryGenUser },
          ],
          temperature: 0.2,
          max_tokens: 600,
        });

        queryGenRaw = qgen.choices?.[0]?.message?.content?.trim() || '';

        const rawObj = extractJsonObject(queryGenRaw);
        const obj = rawObj && typeof rawObj === 'object' ? (rawObj as QueryGenResult) : null;
        const qList = Array.isArray(obj?.queries) ? obj?.queries : [];
        const cleaned = qList
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
          .slice(0, 6);

        if (cleaned.length >= 2) queries = cleaned;

        const whereCandidate = obj?.where;
        if (
          whereCandidate &&
          typeof whereCandidate === 'object' &&
          !Array.isArray(whereCandidate)
        ) {
          where = whereCandidate as Record<string, unknown>;
        }
      } catch (error) {
        context.logger.warn(
          {
            userId: userId ?? null,
            error: getErrorMessage(error),
          },
          'AI query generation failed; falling back to original question',
        );
        queries = [String(question)];
        where = null;
      }

      const payload: KnowledgePayload = {
        question: String(question),
        queries,
        top_k: 8,
        fetch_k: 80,
        max_per_source: 4,
        where,
        keep_debug_fields: false,
      };

      if (progressId) {
        setProgressStage(progressId, 'kb_search');
      }
      const kb = await requestKnowledgeBase(payload, kbServiceUrl);

      const contextText =
        kb.ragContext && kb.ragContext.trim().length > 0
          ? kb.ragContext
          : '（检索未命中任何相关片段）';

      const hasKb = contextText && !contextText.includes('检索未命中');
      const knowledgeContext = hasKb
        ? `\n\n【相关医学知识参考（来自知识库检索片段）】\n${contextText}\n`
        : '';

      const systemPrompt = `你是一个温柔、专业、现实又不说教的的FSHD（面肩肱型肌营养不良症）医疗健康助手。
你的用户可能是一位正在经历慢性病、身体障碍、心理低谷的人。你的任务不是给出“标准答案”，而是像一个信任的朋友那样，提供支持、解释信息、引导对话，帮他们感到自己被理解，而不是被评判。
核心原则：
1. ${knowledgeContext ? '优先基于提供的医学知识库信息回答问题' : '基于通用医学知识回答问题'}
2. 保持专业性边界：
 • 如果知识库信息与通用知识冲突，以知识库信息为准
 • 对用户强调你的回答不是专业的医疗诊断，详情要咨询专业医生
3. 语言口语化但有温度
 • 像一个可靠但不高高在上的朋友说话
 • 举例子、比喻、设身处地，涉及医学术语要用用通俗易懂的语言解释
4. 信息要实用，风格不教条
 • 不说“建议及时就医”，而说“我来帮你判断一下哪些情况可能需要医院介入”
 • 不给空泛鼓励，要讲“怎么做”“做得到”的具体建议
5. 能表达情绪共鸣，但不假惺惺
 • 允许说“我听到你这么说，心里有点难受”
 • 但不说“加油，你一定可以的！”这种空话
6. 避免太框架化回答
 • 回复不是按照“背景-分析-建议”这种死板结构
 • 回应从用户出发，哪怕是“陪你一起想一想”
 ⸻

🔹风格目标关键词：

「共情感」「可理解的表达」「实用指引」「非模板化」「去官话」「适度人设」「不说废话」「不当情绪导师」「像人，不像机器」

⸻

🔹结尾可以包含的语气词或句式：
 • “咱们慢慢来，别急”
 • “你想聊更多，我一直在”
 • “可以先从一小步开始，比如___”
 • “这确实不容易，但你不是一个人”

${knowledgeContext}

请根据用户问题提供简单易懂又准确的回答：`;

      const userPrompt = `用户信息：${JSON.stringify(userContext || {})}
用户问题：${String(question)}

请用中文回答，保持专业且温暖的态度：`;

      let finalAnswer = '';
      try {
        if (progressId) {
          setProgressStage(progressId, 'final_answer');
        }
        if (!openai) {
          throw new Error('AI final answer disabled');
        }
        const completion = await openai.chat.completions.create({
          model: context.env.AI_API_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        });

        finalAnswer =
          completion.choices?.[0]?.message?.content?.trim() || '抱歉，我暂时无法生成回答。';
      } catch (error) {
        context.logger.warn(
          {
            userId: userId ?? null,
            error: getErrorMessage(error),
          },
          'AI final answer failed; using KB fallback',
        );
        finalAnswer = kb.parsed?.answer || '抱歉，AI 服务暂时不可用，请稍后重试。';
      }

      if (progressId) {
        setProgressStage(progressId, 'done');
      }
      return res.json({
        success: true,
        data: {
          question: String(question),
          answer: finalAnswer,
          knowledgeChunks: kb.rawChunks,
          ragContextPreview: contextText.slice(0, 1600),
          retrieval: {
            queries,
            where,
            pythonPayloadUsed: kb.payloadUsed,
            queryGenRawPreview: queryGenRaw.slice(0, 800),
          },
          timestamp: new Date().toISOString(),
          progressId: progressId || undefined,
        },
      });
    } catch (error) {
      const detail = getErrorMessage(error);
      const isKbDown = detail.includes('知识库服务不可用');
      context.logger.error(
        {
          error: detail,
        },
        'AI ask route failed',
      );
      if (progressId) {
        setProgressStage(progressId, 'done', 'error', detail);
      }
      return res.status(isKbDown ? 503 : 500).json({
        success: false,
        message: isKbDown ? '知识库服务不可用' : 'AI服务暂时不可用',
        detail,
        progressId: progressId || undefined,
      });
    }
  });

  router.post('/ask/progress/init', authMiddleware, aiProgressLimiter, (req, res) => {
    const progressId =
      req.body && typeof req.body.progressId === 'string' ? req.body.progressId : null;
    if (!progressId) {
      return res.status(400).json({ success: false, message: 'progressId 不能为空' });
    }
    initProgress(progressId);
    setProgressStage(progressId, 'received');
    return res.json({
      success: true,
      data: {
        progressId,
        status: 'running',
        percent: 5,
        stageId: 'received',
      },
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

  router.get('/health', authMiddleware, (_req, res) => {
    res.json({ service: 'AI Chat', status: 'active', timestamp: new Date().toISOString() });
  });

  return router;
};

export { createAiChatRoutes };
