import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import OpenAI from 'openai';

const router = Router();

// ============ Helpers ============

// 去 BOM + trim，避免 JSON.parse 爆炸
const cleanJsonText = (s: string) => s.replace(/^\uFEFF/, '').trim();

// 找 pythonScript 的真实路径（更稳）
const resolvePythonScriptPath = () => {
  const p1 = path.resolve(process.cwd(), 'knowledge', 'knowledge.py');
  const p2 = path.resolve(process.cwd(), 'apps', 'api', 'knowledge', 'knowledge.py');

  if (fs.existsSync(p1)) return p1;
  if (fs.existsSync(p2)) return p2;
  return p1; // 兜底
};

// 轻量 UUID 判断（避免 dev-user 这种炸 DB）
const isUuid = (s: unknown) =>
  typeof s === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

// DeepSeek(OpenAI兼容) client
const openai = new OpenAI({
  apiKey: process.env.AI_API_KEY || '',
  baseURL: process.env.AI_API_BASE_URL || 'https://api.siliconflow.cn/v1',
});

if (!process.env.AI_API_KEY) {
  process.stdout.write('⚠️ Missing AI_API_KEY in env. DeepSeek call will fail.\n');
}

// JSON parse helper (safe)
const safeJsonParse = <T = any>(s: string): T | null => {
  try {
    return JSON.parse(cleanJsonText(s));
  } catch {
    return null;
  }
};

// 尽量从 LLM 输出里“提取 JSON”（防止它包了 ```json ... ```）
const extractJsonObject = (text: string): any | null => {
  const raw = (text || '').trim();
  if (!raw) return null;

  // 1) 直接 parse
  const direct = safeJsonParse(raw);
  if (direct) return direct;

  // 2) 去掉 ```json ``` 包裹
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const inside = safeJsonParse(fenced[1]);
    if (inside) return inside;
  }

  // 3) 尝试抓第一个 { ... }
  const firstObj = raw.match(/\{[\s\S]*\}/);
  if (firstObj?.[0]) {
    const maybe = safeJsonParse(firstObj[0]);
    if (maybe) return maybe;
  }

  return null;
};

// 把 python chunks 统一成 string[]
const chunksToText = (rawChunks: any[]): string[] => {
  if (!Array.isArray(rawChunks)) return [];
  return rawChunks.map((c: any) => (typeof c === 'string' ? c : c?.content)).filter(Boolean);
};

// 过滤明显噪音（你可以继续加）
const isJunkChunk = (t: string) =>
  /目录|上一篇|下一篇|连载|排版|撰文|责任编辑|点击阅读|更多内容|病友故事\s*·\s*目录|社区简介|康复医师网络/.test(
    t,
  );

// ===============================
// A1: DeepSeek 先生成 queries → Python --multi 检索 → DeepSeek 回答
// ===============================
router.post(
  '/ask',
  (req, _res, next) => {
    process.stdout.write('\n🔥 HIT POST /api/ai/ask (pre-auth)\n');
    next();
  },
  authenticate,
  async (req, res) => {
    try {
      process.stdout.write('✅ auth passed\n');

      const { question, userContext } = req.body || {};
      if (!question || !String(question).trim()) {
        return res.status(400).json({ success: false, message: '问题不能为空' });
      }

      const userId = (req as any).user?.id;
      process.stdout.write(`👤 userId = ${String(userId)} (uuid=${isUuid(userId)})\n`);
      process.stdout.write(`❓ question = ${String(question)}\n`);
      process.stdout.write(`🔧 cwd = ${process.cwd()}\n`);

      const pythonScript = resolvePythonScriptPath();
      process.stdout.write(`📄 pythonScript = ${pythonScript}\n`);
      process.stdout.write(`📄 pythonScript exists = ${fs.existsSync(pythonScript)}\n`);

      const PYTHON_EXE = 'C:\\Users\\lucas\\Desktop\\fshd-kb-env\\.venv\\Scripts\\python.exe';
      process.stdout.write(`🐍 pythonExe = ${PYTHON_EXE}\n`);
      process.stdout.write(`🐍 pythonExe exists = ${fs.existsSync(PYTHON_EXE)}\n`);

      // -------------------------------------------------------
      // 0) DeepSeek 生成检索 queries（A1 核心）
      // -------------------------------------------------------
      let queries: string[] = [String(question)];
      let where: any = null; // 可选：想过滤某些folder就放这里
      let queryGenRaw = '';

      try {
        process.stdout.write('🧩 generating retrieval queries via DeepSeek...\n');

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
          model: process.env.AI_API_MODEL || 'deepseek-ai/DeepSeek-V3',
          messages: [
            { role: 'system', content: queryGenSystem },
            { role: 'user', content: queryGenUser },
          ],
          temperature: 0.2,
          max_tokens: 600,
        });

        queryGenRaw = qgen.choices?.[0]?.message?.content?.trim() || '';
        process.stdout.write(`🧩 queryGenRaw(first400) = ${queryGenRaw.slice(0, 400)}\n`);

        const obj = extractJsonObject(queryGenRaw);
        const qList = Array.isArray(obj?.queries) ? obj.queries : [];
        const cleaned = qList
          .map((x: any) => String(x || '').trim())
          .filter(Boolean)
          .slice(0, 6);

        if (cleaned.length >= 2) queries = cleaned;
        where = obj?.where && typeof obj.where === 'object' ? obj.where : null;

        process.stdout.write(`🧩 queries(final) = ${JSON.stringify(queries)}\n`);
        process.stdout.write(`🧩 where(final) = ${JSON.stringify(where)}\n`);
      } catch (e: any) {
        console.error('❌ query generation failed, fallback to [question]:', e?.message || e);
        queries = [String(question)];
        where = null;
      }

      // -------------------------------------------------------
      // 1) 调 python --multi：多路检索 + 去重 + 过滤噪音 + 多样性
      // -------------------------------------------------------
      const kb = await new Promise<{
        parsed: any;
        rawChunks: any[];
        chunksText: string[];
        filteredChunks: string[];
        ragContext: string;
        payloadUsed: any;
      }>((resolve, reject) => {
        const payload = {
          question: String(question),
          queries,
          top_k: 8,
          fetch_k: 80,
          max_per_source: 4,
          where, // null 或 object
          keep_debug_fields: false,
        };

        const args = [pythonScript, '--multi', JSON.stringify(payload)];
        process.stdout.write(`📤 python args preview = ${args.slice(0, 2).join(' ')} ...\n`);

        execFile(PYTHON_EXE, args, (error, stdout, stderr) => {
          process.stdout.write(`🧾 stderr(first500) = ${(stderr || '').slice(0, 500)}\n`);
          process.stdout.write(`🧾 stdout(first500) = ${(stdout || '').slice(0, 500)}\n`);

          if (error) return reject({ error, stdout, stderr, payloadUsed: payload });

          const parsed = safeJsonParse(stdout || '');
          if (!parsed)
            return reject({
              error: new Error('python_json_parse_failed'),
              stdout,
              stderr,
              payloadUsed: payload,
            });

          const rawChunks = Array.isArray(parsed?.chunks) ? parsed.chunks : [];
          const chunksText = chunksToText(rawChunks);
          const filteredChunks = chunksText.filter((t) => !isJunkChunk(t));

          process.stdout.write(`🧠 chunksText=${chunksText.length}, filtered=${filteredChunks.length}\n`);
          process.stdout.write(`🧠 chunk0=${(filteredChunks[0] || chunksText[0] || '').slice(0, 140)}\n`);

          const ragContext = (filteredChunks.length ? filteredChunks : chunksText)
            .slice(0, 6)
            .map((t, i) => `【片段${i + 1}】${t}`)
            .join('\n\n');

          return resolve({ parsed, rawChunks, chunksText, filteredChunks, ragContext, payloadUsed: payload });
        });
      });

      process.stdout.write(`📦 python chunks(raw) = ${kb.rawChunks.length}\n`);

      // -------------------------------------------------------
      // 2) 再调 DeepSeek：用 ragContext 生成最终回答
      //    ✅ 这里只替换 prompt（完整嵌入你同学那段）
      // -------------------------------------------------------
      const contextText =
        kb.ragContext && kb.ragContext.trim().length > 0 ? kb.ragContext : '（检索未命中任何相关片段）';

      const hasKb = contextText && !contextText.includes('检索未命中');
      const knowledgeContext = hasKb
        ? `\n\n【相关医学知识参考（来自知识库检索片段）】\n${contextText}\n`
        : '';

      // ✅ 完整嵌入你同学的 systemPrompt（只把 request.xxx 改成此处变量）
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

      // ✅ 完整嵌入你同学的 userPrompt（把 request.xxx 改成此处变量）
      const userPrompt = `用户信息：${JSON.stringify(userContext || {})}
用户问题：${String(question)}

请用中文回答，保持专业且温暖的态度：`;

      let finalAnswer = '';
      try {
        process.stdout.write('🤖 calling DeepSeek for final answer...\n');
        const completion = await openai.chat.completions.create({
          model: process.env.AI_API_MODEL || 'deepseek-ai/DeepSeek-V3',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7, // ✅ 跟同学版本一致
          max_tokens: 2000, // ✅ 跟同学版本一致
        });
        process.stdout.write('🤖 DeepSeek done.\n');

        finalAnswer = completion.choices?.[0]?.message?.content?.trim() || '抱歉，我暂时无法生成回答。';
      } catch (e: any) {
        console.error('❌ DeepSeek call failed:', e?.message || e);
        // DeepSeek 挂了：就退回 python 的预览 answer（至少有内容）
        finalAnswer = kb.parsed?.answer || '抱歉，AI 服务暂时不可用，请稍后重试。';
      }

      return res.json({
        success: true,
        data: {
          question: String(question),
          answer: finalAnswer,
          knowledgeChunks: kb.rawChunks,
          ragContextPreview: contextText.slice(0, 1600),

          // 调试信息（你汇报时也很好讲）
          retrieval: {
            queries,
            where,
            pythonPayloadUsed: kb.payloadUsed,
            queryGenRawPreview: queryGenRaw.slice(0, 800),
          },

          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      console.error('❌ /api/ai/ask error:', err?.error || err);
      return res.status(500).json({
        success: false,
        message: 'AI服务暂时不可用',
        detail: err?.error?.message || String(err?.error || err),
      });
    }
  },
);

router.get('/health', (_req, res) => {
  res.json({ service: 'AI Chat', status: 'active', timestamp: new Date().toISOString() });
});

export { router as aiChatRoutes };
