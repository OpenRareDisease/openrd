import { Router } from 'express';
import { AIChatService } from '../services/ai-chat.service';

const router = Router();
const aiService = new AIChatService();

// AI问答接口
router.post('/ask', async (req, res) => {
  try {
    const { question, userContext } = req.body;

    if (!question) {
      return res.status(400).json({
        error: '问题不能为空',
      });
    }

    const answer = await aiService.askFSHDQuestion({
      question,
      userContext,
    });

    res.json({
      success: true,
      data: {
        question,
        answer,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('AI问答API错误:', error);
    res.status(500).json({
      error: 'AI服务暂时不可用',
    });
  }
});

// 健康检查接口
router.get('/health', (req, res) => {
  res.json({
    service: 'AI Chat',
    status: 'active',
    timestamp: new Date().toISOString(),
  });
});

export { router as aiChatRoutes };
