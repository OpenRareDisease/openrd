import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 健康检查路由
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    message: 'Medical Chat API is running!',
    timestamp: new Date().toISOString(),
    service: 'medical-chat-api',
    version: '1.0.0'
  });
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    service: 'medical-chat-api',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req: Request, res: Response) => {
  res.json({ 
    message: 'Welcome to Medical Chat API',
    endpoints: {
      health: '/health',
      apiHealth: '/api/health',
      chat: '/api/chat (POST)'
    },
    documentation: 'See /health for service status'
  });
});

// 基础聊天端点
app.post('/api/chat', (req: Request, res: Response) => {
  res.json({
    message: 'Chat endpoint ready for implementation',
    received: req.body
  });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Medical Chat API Server is running!`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
});

export default app;
