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

// ============ Main Route ============

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

      const PYTHON_EXE =
        'C:\\Users\\lucas\\Desktop\\fshd-kb-env\\.venv\\Scripts\\python.exe';
      process.stdout.write(`🐍 pythonExe = ${PYTHON_EXE}\n`);
      process.stdout.write(`🐍 pythonExe exists = ${fs.existsSync(PYTHON_EXE)}\n`);

      /**
       * 1) 调 python：只负责检索
       *    ✅ resolve 出：parsed + rawChunks + chunksText + filteredChunks + ragContext
       */
      const kb = await new Promise<{
        parsed: any;
        rawChunks: any[];
        chunksText: string[];
        filteredChunks: string[];
        ragContext: string;
      }>((resolve, reject) => {
        execFile(PYTHON_EXE, [pythonScript, String(question)], (error, stdout, stderr) => {
          process.stdout.write(`🧾 stderr(first500) = ${(stderr || '').slice(0, 500)}\n`);
          process.stdout.write(`🧾 stdout(first500) = ${(stdout || '').slice(0, 500)}\n`);

          if (error) return reject({ error, stdout, stderr });

          try {
            const cleaned = cleanJsonText(stdout || '');
            const parsed = JSON.parse(cleaned);

            // ✅ 这里必须用 parsed（不能用 pythonResult）
            const rawChunks = Array.isArray(parsed?.chunks) ? parsed.chunks : [];

            // ✅ 兼容两种：string[] 或 {content, metadata}[]
            const chunksText = rawChunks
              .map((c: any) => (typeof c === 'string' ? c : c?.content))
              .filter(Boolean) as string[];

            // ✅ 过滤明显是目录/导航
            const isJunk = (t: string) =>
              /目录|上一篇|下一篇|连载|排版|撰文|责任编辑|点击阅读|更多内容/.test(t);

            const filteredChunks = chunksText.filter((t) => !isJunk(t));

            // ✅ 打印确认：DeepSeek 看得到什么
            process.stdout.write(
              `🧠 chunksText=${chunksText.length}, filtered=${filteredChunks.length}\n`,
            );
            process.stdout.write(
              `🧠 chunk0=${(filteredChunks[0] || chunksText[0] || '').slice(0, 120)}\n`,
            );

            // ✅ 真正喂给 DeepSeek 的上下文
            const ragContext = (filteredChunks.length ? filteredChunks : chunksText)
              .slice(0, 5)
              .map((t, i) => `【片段${i + 1}】${t}`)
              .join('\n\n');

            return resolve({ parsed, rawChunks, chunksText, filteredChunks, ragContext });
          } catch (e) {
            return reject({ error: e, stdout, stderr });
          }
        });
      });

      process.stdout.write(`📦 python chunks(raw) = ${kb.rawChunks.length}\n`);

      /**
       * 2) 调 DeepSeek：用 ragContext（过滤后的chunks）生成回答
       */
      const contextText =
        kb.ragContext && kb.ragContext.trim().length > 0
          ? kb.ragContext
          : '（检索未命中任何相关片段）';

      const systemPrompt = `你是一个专业、友善的FSHD（面肩肱型肌营养不良症）健康科普助手。请严格遵循：
1) 优先依据“知识库资料片段”作答；不要编造不在片段中的事实
2) 用中文、分点、通俗易懂
3) 给出可执行的下一步建议（该看什么科/问医生什么/做什么检查）
4) 每次都要提醒：这不是医疗诊断，需咨询专业医生
5) 若片段不足以支持结论，明确说“知识库中未找到依据”`;

      const userPrompt = `【用户信息】${JSON.stringify(userContext || {})}

【知识库资料片段】
${contextText}

【用户问题】
${String(question)}

请输出：
- 直接回答（条理清晰）
- 如果资料不足：说明不足点 + 下一步建议
- 非医疗诊断`;

      let finalAnswer = '';
      try {
        process.stdout.write('🤖 calling DeepSeek...\n');
        const completion = await openai.chat.completions.create({
          model: process.env.AI_API_MODEL || 'deepseek-ai/DeepSeek-V3',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1200,
        });
        process.stdout.write('🤖 DeepSeek done.\n');

        finalAnswer =
          completion.choices?.[0]?.message?.content?.trim() ||
          '抱歉，我暂时无法生成回答。';
      } catch (e: any) {
        console.error('❌ DeepSeek call failed:', e?.message || e);
        finalAnswer =
          kb.parsed?.answer ||
          '抱歉，AI 服务暂时不可用，请稍后重试。';
      }

      return res.json({
        success: true,
        data: {
          question: String(question),
          answer: finalAnswer,
          // ✅ 给前端：保留原始 chunks（可能是对象数组）
          knowledgeChunks: kb.rawChunks,
          // ✅ 额外给你调试：DeepSeek 实际吃到的上下文
          ragContextPreview: contextText.slice(0, 1200),
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
