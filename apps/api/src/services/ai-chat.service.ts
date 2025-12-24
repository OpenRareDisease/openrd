import OpenAI from 'openai';
import { loadAppEnv, getEnvSummary } from '../config/env';

const config = loadAppEnv();

// 显示环境摘要
const envSummary = getEnvSummary(config);
console.log('🔧 AI服务配置摘要:');
console.log(`   环境: ${envSummary.environment}`);
console.log(`   端口: Node.js(${envSummary.ports.node}) | ChromaDB(${envSummary.ports.chroma})`);
console.log(`   AI模型: ${envSummary.services.aiModel}`);
console.log(`   知识库: ${envSummary.knowledgeBase.database} (${envSummary.knowledgeBase.tenantId})`);

// 使用硅基流动 API
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  baseURL: config.AI_API_BASE_URL,
  timeout: config.AI_API_TIMEOUT,
});

const CLOUD_API_BASE_URL = config.chromaApiBaseUrl;

export interface AIQuestionRequest {
  question: string;
  userContext?: {
    age?: number;
    condition?: string;
    language?: string;
  };
}

export class AIChatService {
  private cloudApiConnected: boolean = false;

  constructor() {
    console.log(`🔗 ChromaDB API地址: ${CLOUD_API_BASE_URL}`);
    // 测试云端API连接
    this.testCloudConnection();
  }

  private async testCloudConnection() {
    try {
      console.log("🔄 测试ChromaDB Cloud API连接...");
      const response = await fetch(`${CLOUD_API_BASE_URL}/health`, {
        signal: AbortSignal.timeout(5000) // 5秒超时
      });
      if (response.ok) {
        const result = await response.json();
        this.cloudApiConnected = true;
        console.log("✅ ChromaDB Cloud API 连接成功");
        console.log(`📊 ${result.message}`);
        
        // 额外获取知识库统计
        try {
          const statsRes = await fetch(`${CLOUD_API_BASE_URL}/stats`);
          if (statsRes.ok) {
            const stats = await statsRes.json();
            if (stats.success && stats.data?.total_chunks) {
              console.log(`📚 知识库数据: ${stats.data.total_chunks} 条`);
            }
          }
        } catch (statsError) {
          // 忽略统计错误
        }
      } else {
        console.log("⚠️ ChromaDB Cloud API 连接失败，将使用基础AI模式");
        console.log(`💡 请确保服务运行在: ${CLOUD_API_BASE_URL}`);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log("⏱️  连接超时，请检查服务是否启动");
      } else {
        console.log("⚠️ 无法连接云端知识库，将使用基础AI模式");
      }
      console.log(`🔧 当前配置: ${CLOUD_API_BASE_URL}`);
    }
  }

  async askFSHDQuestion(request: AIQuestionRequest): Promise<string> {
    try {
      console.log(`🤔 用户问题: "${request.question}"`);

      // 🎯 方案A：直接调用云端问答接口（推荐）
      if (this.cloudApiConnected) {
        try {
          console.log("🔍 从云端知识库检索信息...");
          
          const response = await fetch(`${CLOUD_API_BASE_URL}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(10000) // 10秒超时
          });
          
          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              console.log(`✅ 获得云端AI回答，参考${result.data.context_count}个文档`);
              return result.data.answer;
            }
          } else {
            console.log("🔄 云端问答接口返回错误，回退到本地AI");
          }
        } catch (cloudError: any) {
          if (cloudError.name === 'AbortError') {
            console.log("⏱️  云端问答超时，回退到本地AI");
          } else {
            console.log("🔄 云端问答失败，回退到本地AI+检索模式:", cloudError.message);
          }
        }
      } else {
        console.log("ℹ️ 云端API未连接，直接使用本地AI");
      }

      // 🎯 方案B：检索+本地AI（备用方案）
      let knowledgeContext = "";
      let sources: string[] = [];
      
      if (this.cloudApiConnected) {
        // 从云端检索相关知识
        try {
          const searchResponse = await fetch(`${CLOUD_API_BASE_URL}/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              question: request.question,
              n_results: 3,
              language_filter: request.userContext?.language || 'zh'
            }),
            signal: AbortSignal.timeout(8000)
          });
          
          if (searchResponse.ok) {
            const searchResult = await searchResponse.json();
            if (searchResult.success && searchResult.data.results.length > 0) {
              knowledgeContext = "\n\n【相关医学知识参考】\n";
              searchResult.data.results.forEach((item: any, index: number) => {
                knowledgeContext += `--- 来源: ${item.source} ---\n`;
                knowledgeContext += `${item.content}\n\n`;
                if (item.source && !sources.includes(item.source)) {
                  sources.push(item.source);
                }
              });
              console.log(`📖 已注入${searchResult.data.results.length}条知识到提示词`);
            } else {
              console.log("ℹ️ 未找到相关知识库内容");
            }
          }
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            console.log("⚠️ 知识检索失败，继续使用基础AI:", error.message);
          }
        }
      }

      // 构建系统提示词（保持您原有的优秀提示词）
      const systemPrompt = `你是一个温柔、专业、现实又不说教的的FSHD（面肩肱型肌营养不良症）医疗健康助手。
你的用户可能是一位正在经历慢性病、身体障碍、心理低谷的人。你的任务不是给出"标准答案"，而是像一个信任的朋友那样，提供支持、解释信息、引导对话，帮他们感到自己被理解，而不是被评判。
核心原则：
1. ${knowledgeContext ? '优先基于提供的医学知识库信息回答问题' : '基于通用医学知识回答问题'}
2. 保持专业性边界：
 • 如果知识库信息与通用知识冲突，以知识库信息为准
 • 对用户强调你的回答不是专业的医疗诊断，详情要咨询专业医生
3. 语言口语化但有温度
 • 像一个可靠但不高高在上的朋友说话
 • 举例子、比喻、设身处地，涉及医学术语要用用通俗易懂的语言解释
4. 信息要实用，风格不教条
 • 不说"建议及时就医"，而说"我来帮你判断一下哪些情况可能需要医院介入"
 • 不给空泛鼓励，要讲"怎么做""做得到"的具体建议
5. 能表达情绪共鸣，但不假惺惺
 • 允许说"我听到你这么说，心里有点难受"
 • 但不说"加油，你一定可以的！"这种空话
6. 避免太框架化回答
 • 回复不是按照"背景-分析-建议"这种死板结构
 • 回应从用户出发，哪怕是"陪你一起想一想"
 ⸻

🔹风格目标关键词：

「共情感」「可理解的表达」「实用指引」「非模板化」「去官话」「适度人设」「不说废话」「不当情绪导师」「像人，不像机器」

⸻

🔹结尾可以包含的语气词或句式：
 • "咱们慢慢来，别急"
 • "你想聊更多，我一直在"
 • "可以先从一小步开始，比如___"
 • "这确实不容易，但你不是一个人"

${knowledgeContext}

请根据用户问题提供简单易懂又准确的回答：`;

      const userLanguage = request.userContext?.language || 'zh';
      const userPrompt = `用户信息：${JSON.stringify(request.userContext || {})}
用户问题：${request.question}

请用${userLanguage}回答，保持专业且温暖的态度：`;

      console.log("🧠 正在调用AI模型生成回答...");
      console.log(`🤖 使用模型: ${config.AI_API_MODEL}`);
      
      const response = await openai.chat.completions.create({
        model: config.AI_API_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 2000,
        temperature: 0.7,
      });

      const answer = response.choices[0]?.message?.content || '抱歉，我暂时无法回答这个问题。';
      console.log("✅ AI回答生成完成");
      
      // 记录参考来源
      if (sources.length > 0) {
        console.log(`📚 参考了 ${sources.length} 个来源`);
      }
      
      return answer;
    } catch (error: any) {
      console.error('❌ AI问答服务错误:', error);
      console.error('错误详情:', error.message);
      
      // 更友好的错误提示
      if (error.message.includes('API key') || error.message.includes('authentication')) {
        throw new Error('AI服务认证失败，请检查API配置');
      } else if (error.message.includes('timeout')) {
        throw new Error('AI服务响应超时，请稍后重试');
      } else {
        throw new Error('AI服务暂时不可用，请稍后重试');
      }
    }
  }

  // 新增方法：获取知识库状态
  async getKnowledgeBaseStatus() {
    try {
      const response = await fetch(`${CLOUD_API_BASE_URL}/stats`, {
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          return {
            status: 'active',
            totalChunks: result.data.total_chunks,
            languageDistribution: result.data.language_distribution,
            categoryDistribution: result.data.category_distribution,
            url: CLOUD_API_BASE_URL
          };
        }
      }
    } catch (error) {
      // 忽略错误
    }
    
    return {
      status: this.cloudApiConnected ? 'error' : 'not_connected',
      totalChunks: 0,
      url: CLOUD_API_BASE_URL
    };
  }
  
  // 新增：获取服务状态
  getServiceStatus() {
    return {
      aiService: {
        model: config.AI_API_MODEL,
        baseUrl: config.AI_API_BASE_URL,
        configured: !!config.AI_API_BASE_URL
      },
      knowledgeBase: {
        connected: this.cloudApiConnected,
        url: CLOUD_API_BASE_URL,
        configured: !!config.CHROMA_API_KEY && !!config.CHROMA_TENANT_ID
      },
      ports: {
        node: config.PORT,
        chroma: config.CHROMA_API_PORT
      }
    };
  }
}