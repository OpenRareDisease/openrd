# 发布/部署清单 (Release Checklist)

## 中文

### 1) 环境与依赖

- `.env` 已配置并核对关键变量（`DATABASE_URL`、`JWT_SECRET`、`AI_API_KEY`、`CHROMA_API_KEY`、`CHROMA_TENANT_ID` 等）
- `requirements.txt` 已锁定版本，Python 依赖可复现
- 数据库已初始化或迁移完成（`db/init_db.sql` 或迁移工具）

### 2) 服务启动顺序

- 先启动知识服务：`python apps/api/knowledge_service.py`
- 再启动 Node API：`npm run dev:api`
- 最后启动移动端：`npm run dev:mobile`

### 3) 核心功能自测

- `/api/healthz` 正常返回
- 注册/登录流程正常
- 资料/档案接口可写可读
- 智能问答 `/api/ai/ask` 正常返回
- 进度接口 `/api/ai/ask/progress/:id` 正常

### 4) 日志与异常

- 无明显报错（API、知识服务、移动端）
- 关键错误已记录并可定位

### 5) 文档与交付

- README 中英文一致
- 关键文档（架构/PRD/测试）更新
- 变更记录已补充（如有）

## English

### 1) Environment & Dependencies

- `.env` configured and validated (e.g. `DATABASE_URL`, `JWT_SECRET`, `AI_API_KEY`, `CHROMA_API_KEY`, `CHROMA_TENANT_ID`)
- `requirements.txt` pinned for reproducible Python installs
- Database initialized or migrations applied

### 2) Startup Order

- Start KB service: `python apps/api/knowledge_service.py`
- Start Node API: `npm run dev:api`
- Start mobile app: `npm run dev:mobile`

### 3) Core Smoke Tests

- `/api/healthz` returns OK
- Auth register/login works
- Profile APIs read/write
- Q&A `/api/ai/ask` returns answer
- Progress endpoint `/api/ai/ask/progress/:id` responds

### 4) Logs & Errors

- No blocking errors across services
- Critical failures are traceable

### 5) Docs & Delivery

- README (CN/EN) up to date
- Key docs updated (architecture/PRD/testing)
- Changelog notes updated if needed
