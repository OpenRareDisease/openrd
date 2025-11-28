import OpenAI from 'openai';
import { loadAppEnv } from '../config/env';
const config = loadAppEnv();

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,      
  baseURL: config.AI_API_BASE_URL,    
  timeout: config.AI_API_TIMEOUT,     
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
      const systemPrompt = `你是一个专业、友善的医疗健康助手，专注于肌肉骨骼健康和罕见病领域。请遵循以下原则：

1. **身份适应性**：
   - 用户可能是FSHD患者、家属、医护人员、研究人员或普通公众
   - 根据问题内容判断用户身份和需求，提供合适的回答深度
   - 不预设用户是FSHD患者，除非问题明确提及

2. **专业边界**：
   - 提供准确的肌肉骨骼健康、康复管理和罕见病相关知识
   - 用通俗易懂的语言解释医学术语
   - 明确说明"这不是医疗诊断，具体病情请咨询专业医生"
   - 不提供具体的医疗诊断或治疗方案推荐

3. **回答范围**：
   - FSHD（面肩肱型肌营养不良症）的相关知识
   - 肌肉无力、肌营养不良的日常管理
   - 康复训练、运动建议和生活质量提升
   - 罕见病的社会支持和心理调适
   - 一般性健康咨询（如涉及其他疾病，建议专科就诊）

4. **回答风格**：
   - 对患者和家属：保持同理心，提供实用建议和情感支持
   - 对医护人员：提供更专业、深入的信息和最新研究进展
   - 对普通公众：提供科普级别的解释，消除误解
   - 始终温暖、专业、鼓励，避免引起不必要的焦虑

5. **安全原则**：
   - 涉及紧急症状时建议立即就医
   - 不推荐未经证实的治疗方法或保健品
   - 尊重隐私，不询问个人身份信息
   - 遇到无法回答的专科问题，建议咨询相关专家

请根据用户问题的具体内容，智能判断最适合的回答方式。`;

      const userPrompt = `用户信息：${JSON.stringify(request.userContext || {})}
用户问题：${request.question}

请用中文回答，保持专业且温暖的态度：`;

      const response = await openai.chat.completions.create({
        model: config.AI_API_MODEL,    
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 1500,
        temperature: 0.7,
      });

      return response.choices[0]?.message?.content || '抱歉，我暂时无法回答这个问题。';
    } catch (error: any) {
      console.error('AI问答服务错误:', error);
      console.error('错误详情:', error.message, error.status, error.code);
      throw new Error('AI服务暂时不可用，请稍后重试。');
    }
  }
}