# FSHD-openrd (肌愈通)

[English](./README.en.md)

FSHD-openrd 是一个面向 FSHD（面肩肱型肌营养不良）患者场景的 monorepo，覆盖移动端、API、报告 OCR/结构化解析、AI 问答和部署交付链路。当前仓库已经不只是 demo，而是围绕“建档、随访、报告、问答、部署”形成了一条可联调、可演示、可发布的主路径。

当前工作版本：`v2.3.1`
基线版本：`master` / `v1.0.0`

## 当前包含什么

- `apps/mobile`：Expo 客户端，支持 iOS / Android / Web。
- `apps/api`：Node.js + Express API，承载鉴权、患者档案、随访、报告与 AI 接口。
- `apps/report-manager`：由主 API 内嵌调用的 Python OCR / 报告解析能力。
- `db`：数据库初始化与迁移相关脚本。
- `docs`：运行、测试、发布、设计和历史变更文档。

## 当前已打通的主链路

- 注册 / 登录、患者档案、测量 / 症状 / 活动 / 用药录入。
- submission、follow-up event、clinical passport、时间线与聚合视图。
- 报告上传、embedded OCR、FSHD 专病结构化抽取、报告详情展示。
- AI 问答、知识库检索、进度轮询与 fallback。
- Docker 一体化启动、数据库迁移、健康检查和回归脚本。

## 技术栈

- 移动端：Expo + React Native + TypeScript
- API：Express + TypeScript + Zod
- 数据库：PostgreSQL
- 报告处理：Python embedded OCR / parser
- 工程化：ESLint + Prettier + Husky + npm workspaces

## 仓库结构

```text
openrd/
├── apps/
│   ├── api/
│   ├── mobile/
│   └── report-manager/
├── db/
├── docs/
├── scripts/
├── docker-compose.yml
├── .env.example
└── package.json
```

## 文档怎么读

- 先看当前文件：项目概览、启动方式、常用命令都在这里。
- 再看 [docs/README.md](./docs/README.md)：按主题整理的完整文档入口。
- 最后按模块深入：
  - [apps/api/README.md](./apps/api/README.md)
  - [apps/mobile/README.md](./apps/mobile/README.md)
  - [apps/report-manager/README.md](./apps/report-manager/README.md)

## 环境要求

- Node.js >= 18
- npm >= 10
- Python >= 3.10（本地直跑 OCR / KB 服务需要）
- PostgreSQL >= 14（本地模式）
- Docker + Docker Compose v2（容器模式）

## 快速开始

### 方案 A：本地开发

1. 准备依赖与环境文件

```bash
git clone <repo-url>
cd openrd
cp .env.example .env
npm install
```

2. 启动 PostgreSQL（或自行提供数据库）

```bash
docker compose up -d postgres
```

如果宿主机 `5432` 已被占用：

```bash
POSTGRES_PORT=5433 docker compose up -d postgres
```

3. 执行数据库迁移 / bootstrap

```bash
npm run db:migrate
```

4. 如果本地要走 embedded OCR，先安装 Python 依赖

```bash
pip install -r apps/api/requirements-embedded-report.txt
```

5. 启动 API

```bash
npm run dev:api
```

6. 如果要联调 AI 问答，再启动知识服务

```bash
python apps/api/knowledge_service.py
```

7. 启动移动端

```bash
npm run dev:mobile
```

本地联调常见关键配置：

- `OTP_PROVIDER=mock`
- `OCR_PROVIDER=embedded`
- `STORAGE_PROVIDER=local` 或 `STORAGE_PROVIDER=minio`
- `EXPO_PUBLIC_API_URL=http://localhost:4000/api`
- `AI_API_BASE_URL`、`AI_API_MODEL`、`AI_API_KEY` / `OPENAI_API_KEY`
- `OCR_PYTHON_BIN=/path/to/python`（仅本地直跑 API 时需要）

### 方案 B：Docker 一键联调

```bash
docker compose up -d --build
```

如果宿主机 `5432` 已被占用：

```bash
POSTGRES_PORT=5433 docker compose up -d --build
```

默认端口：

- API：`http://localhost:4000`
- KB service：`http://localhost:5010`
- Web（Expo Web + nginx）：`http://localhost:8080`

容器模式下已经内置这些覆盖：

- API 容器固定使用 `OCR_PYTHON_BIN=python3`
- KB 容器固定监听 `0.0.0.0:5010`
- API 容器固定访问 `KB_SERVICE_URL=http://kb-service:5010`

如果需要兼容 `v1` 的 MinIO 历史报告，可启用：

```bash
docker compose --profile minio up -d --build
```

并在 `.env` 中设置：

- `STORAGE_PROVIDER=minio`
- `MINIO_ENDPOINT=minio:9000`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET_NAME`

## 常用命令

```bash
npm run dev:api
npm run dev:mobile
npm run db:migrate
npm run db:migrate:status
npm run lint
npm run format
npm run format:write
npm run test
npm run test:smoke
npm run test:latest
```

命令说明：

- `npm run test`：执行各 workspace 自己定义的测试。
- `npm run test:smoke`：快速接口冒烟，适合日常改动后先做主链路校验。
- `npm run test:latest`：当前最完整的一体化回归脚本。
- `npm run db:migrate`：执行数据库迁移与首次 bootstrap。

## 推荐文档入口

### 运行与联调

- [文档总览](./docs/README.md)
- [测试指南](./docs/testing-guide.md)
- [单机云部署说明](./docs/cloud-tencent-docker.md)

### 功能与架构

- [AI 问答说明](./docs/ai-chat.md)
- [患者档案数据模型](./docs/patient-profile.md)
- [版本历史 / Changelog](./CHANGELOG.md)
- [v2.3.1 发布说明](./docs/releases/v2.3.1.md)
- [v1.0.0 发布说明](./docs/releases/v1.0.0.md)
- [v2.0.0 发布说明](./docs/releases/v2.0.0.md)

### 协作与交付

- [协作工作流](./docs/WORKFLOW.md)
- [发布清单](./docs/release-checklist.md)
- [更新记录](./docs/updates.md)

## 许可证

[MIT](./LICENSE)
