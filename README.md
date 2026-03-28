# FSHD-openrd (肌愈通)

[English](./README.en.md)

面向 FSHD（面肩肱型肌营养不良）患者的移动端与后端一体化项目，当前以 monorepo 形式维护。仓库包含：

- `apps/mobile`：Expo 移动应用（iOS / Android / Web）
- `apps/api`：Node.js + Express API
- `apps/report-manager`：供主 API 内嵌调用的 Python OCR/解析引擎
- `db`：数据库初始化脚本
- `docs`：研发与发布文档

## 技术栈

- 移动端：Expo + React Native + TypeScript
- API：Express + TypeScript + Zod
- 数据库：PostgreSQL
- OCR/报告：主 API 内嵌 Python OCR/结构化解析
- 代码质量：ESLint + Prettier + Husky

## 仓库结构

```text
openrd/
├── apps/
│   ├── api/
│   ├── mobile/
│   └── report-manager/
├── db/
├── docs/
├── docker-compose.yml
├── .env.example
└── package.json
```

## 环境要求

- Node.js >= 18
- npm >= 10
- Python >= 3.10（报告 OCR 引擎 / KB 服务需要）
- PostgreSQL >= 14（本地模式）
- Docker + Docker Compose v2（容器模式）

## 快速开始（本地开发）

1. 安装依赖

```bash
git clone <repo-url>
cd openrd
cp .env.example .env
npm install
```

2. 启动基础依赖（可选：使用 Docker）

```bash
docker compose up -d postgres
```

如果宿主机的 `5432` 已经被本地 PostgreSQL 占用，可改成：

```bash
POSTGRES_PORT=5433 docker compose up -d postgres
```

3. 启动 API

```bash
npm run dev:api
```

4. 启动移动端

```bash
npm run dev:mobile
```

5. 可选：安装内嵌 OCR 运行时（本地直跑 API 时需要）

```bash
pip install -r apps/api/requirements-embedded-report.txt
```

6. 可选：启动知识服务（用于 AI 问答检索）

```bash
python apps/api/knowledge_service.py
```

本地直跑常见关键配置：

- `AI_API_BASE_URL=https://api.siliconflow.cn/v1`
- `AI_API_MODEL=Qwen/Qwen3-VL-32B-Instruct`
- `OCR_PROVIDER=embedded`
- `STORAGE_PROVIDER=local` 或 `STORAGE_PROVIDER=minio`
- `OCR_PYTHON_BIN=/opt/anaconda3/envs/openrd-kb/bin/python`（仅本机 conda 方案）

## Docker 一键联调

```bash
docker compose up -d --build
```

容器模式下已内置这些覆盖，不需要把本机 conda 路径写进容器：

- API 容器固定使用 `OCR_PYTHON_BIN=python3`
- KB 容器固定监听 `0.0.0.0:5010`
- API 容器固定访问 `KB_SERVICE_URL=http://kb-service:5010`

如果宿主机 `5432` 已被占用，可在启动时覆盖：

```bash
POSTGRES_PORT=5433 docker compose up -d --build
```

默认端口：

- API: `http://localhost:4000`
- KB service: `http://localhost:5010`
- web (Expo web + nginx): `http://localhost:8080`

如果要启用 MinIO 作为报告文件存储：

```bash
docker compose --profile minio up -d --build
```

并在 `.env` 中设置：

- `STORAGE_PROVIDER=minio`
- `MINIO_ENDPOINT=minio:9000`（容器内 MinIO）
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET_NAME`

说明：

- `v2` 默认使用 API 本地卷存储上传文件。
- 如果你从 `v1` 升级并且想保留原有 MinIO 中的历史报告，建议继续使用 `STORAGE_PROVIDER=minio`。
- 当前实现支持同时读取 `local://...` 与 `minio://...`，因此切换存储后不会影响旧记录下载。

## 常用命令

```bash
npm run dev:api
npm run dev:mobile
npm run db:migrate
npm run lint
npm run format
npm run test:smoke
npm run test:latest
npm run test
```

说明：

- `npm run test:smoke` 运行快速接口冒烟。
- `npm run test:latest` 运行当前最完整的一体化回归脚本。
- `npm run db:migrate` 执行数据库迁移与首次 bootstrap。
- `npm run test` 会跑所有 workspace 测试脚本。

## 主要 API（摘要）

- `GET /api/healthz`
- `GET /api/healthz/live`
- `GET /api/healthz/ready`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/otp/send`
- `POST /api/auth/otp/verify`
- `GET /api/profiles/me`
- `POST /api/profiles/me/measurements`
- `POST /api/profiles/me/activity-logs`
- `POST /api/profiles/me/documents/upload`
- `GET /api/profiles/me/documents/:id/ocr`
- `POST /api/ai/ask`

## 文档导航

- [文档总览](./docs/README.md)
- [测试指南](./docs/testing-guide.md)
- [发布清单](./docs/release-checklist.md)
- [单机云部署说明](./docs/cloud-tencent-docker.md)
- [协作工作流](./docs/WORKFLOW.md)
- [AI 问答说明](./docs/ai-chat.md)
- [档案模型设计](./docs/patient-profile.md)

## 许可证

[MIT](./LICENSE)
