# 智能问答 / AI Q&A

## 概述

智能问答由两部分组成：

1. Node API（`/api/ai/ask`）：生成检索问题、调用知识库、生成最终回答
2. Python 知识服务（`apps/api/knowledge_service.py`）：连接 Chroma Cloud 并检索片段

AI 模型用于检索问题生成与最终回答；检索向量由本地 embedding 模型产生。

## 环境变量

**Node API**

- `AI_API_BASE_URL`：模型服务地址
- `AI_API_MODEL`：模型名称（如 `Qwen/Qwen3-Next-80B-Instruct`）
- `AI_API_KEY` 或 `OPENAI_API_KEY`
- `KB_SERVICE_HOST` / `KB_SERVICE_PORT`（默认 `127.0.0.1:5010`）

**Python 知识服务**

- `CHROMA_API_KEY`
- `CHROMA_TENANT_ID`
- `CHROMA_DATABASE`（默认 `FSHD`）
- `CHROMA_COLLECTION`（默认 `fshd_knowledge_base`）

## 启动顺序

1. 启动知识服务：

```
python apps/api/knowledge_service.py
```

2. 启动 Node API：

```
npm run dev:api
```

## API 列表

### POST /api/ai/ask

请求体：

```json
{
  "question": "问题内容",
  "userContext": { "language": "zh" },
  "progressId": "qna_xxx"
}
```

返回：

```json
{
  "success": true,
  "data": {
    "question": "问题内容",
    "answer": "回答内容",
    "timestamp": "2025-01-01T00:00:00.000Z",
    "progressId": "qna_xxx"
  }
}
```

### POST /api/ai/ask/progress/init

用于初始化进度条。

请求体：

```json
{ "progressId": "qna_xxx" }
```

### GET /api/ai/ask/progress/:progressId

用于轮询进度。

返回：

```json
{
  "success": true,
  "data": {
    "progressId": "qna_xxx",
    "status": "running",
    "percent": 60,
    "stageId": "kb_search",
    "stages": [
      { "id": "received", "label": "接收问题", "status": "done" },
      { "id": "query_gen", "label": "生成检索问题", "status": "done" },
      { "id": "kb_search", "label": "检索知识库", "status": "active" },
      { "id": "final_answer", "label": "生成回答", "status": "pending" },
      { "id": "done", "label": "整理结果", "status": "pending" }
    ],
    "updatedAt": "2025-01-01T00:00:10.000Z"
  }
}
```

## Progress Stages

- `received`：接收问题
- `query_gen`：生成检索问题
- `kb_search`：检索知识库
- `final_answer`：生成回答
- `done`：整理结果

## 说明

- 知识服务使用本地 embedding 模型（默认 `all-MiniLM-L6-v2`）生成向量后再查询 Chroma Cloud。
- 若网络不稳定或未配置 Chroma Cloud，`/api/ai/ask` 会返回 503。
