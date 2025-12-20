import OpenAI from 'openai';
import { loadAppEnv } from '../config/env';
const config = loadAppEnv();

// 使用硅基流动 API - 修正配置
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  baseURL: 'https://api.siliconflow.cn/v1',
});

export interface AIQuestionRequest {
  question: string;
  userContext?: {
    age?: number;
    condition?: string;
    language?: string;
  };
}

export class AIChatService {
  async askFSHDQuestion(request: AIQuestionRequest): Promise<string> {
    try {
      const systemPrompt = `你是一个专业、友善的FSHD（面肩肱型肌营养不良症）医疗助手。请遵循以下原则：
1. 提供准确、专业的FSHD相关知识，包括症状、治疗、康复等
2. 用简单易懂的语言解释医学术语
3. 每次回答都要强调"这不是医疗诊断，请咨询专业医生"
4. 对患者保持同理心和鼓励态度
5. 专注于康复建议、日常管理、运动指导和最新研究进展
6. 如果问题超出FSHD范围，礼貌地说明并建议咨询相关专家`;

      const userPrompt = `用户信息：${JSON.stringify(request.userContext || {})}
用户问题：${request.question}

请用中文回答，保持专业且温暖的态度：`;

      const response = await openai.chat.completions.create({
        model: 'deepseek-ai/DeepSeek-V3',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 1500,
        temperature: 0.7,
      });

      return response.choices[0]?.message?.content || '抱歉，我暂时无法回答这个问题。';
    } catch (error: unknown) {
      const err = error as { message?: string; status?: unknown; code?: unknown };
      console.error('AI问答服务错误:', error);
      console.error('错误详情:', err.message, err.status, err.code);
      throw new Error('AI服务暂时不可用，请稍后重试。');
    }
  }
}
