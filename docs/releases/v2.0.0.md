# v2.0.0 Release Notes

发布日期：2026-03-29

`v2.0.0` 是 FSHD-openrd 的首个 `v2` 正式版本，完成了从“基础患者档案与录入”向“报告识别 + 专病结构化 + 长期随访 + AI/知识库 + Docker 一体化部署”的整体升级。这个版本的重点不只是新增页面或接口，而是把报告、随访、问答、部署和安全链路打通，形成可交付、可演示、可部署的一版。

## 版本亮点

### 1. 报告识别与 FSHD 专病结构化

- 将 `report-manager` 整合进 monorepo，报告识别不再依赖独立外部服务。
- 新增 embedded OCR / parser 能力，主 API 可直接调用 Python 报告解析链路。
- 增加 FSHD 专病结构化解析，支持报告类型识别、字段抽取、标准化摘要、低置信度标记和结果溯源。
- 报告详情页已可展示结构化字段、摘要内容和人体图联动信息。

### 2. 患者随访与临床护照

- 新增 submission、symptom score、daily impact、follow-up event 等随访数据模型。
- 补齐患者档案、病程管理、报告聚合和 clinical passport 视图的前后端链路。
- 首页与病程管理页已接入临床护照入口，支持围绕患者纵向记录进行浏览。
- 新增随访分析与临床可视化辅助逻辑，为后续趋势分析与长期管理打下基础。

### 3. AI 问答与知识库联通

- AI 主模型链路已切换到可用模型并完成实测。
- AI 问答、报告摘要、知识库检索和 fallback 机制已联调通过。
- KB 服务拆分 `live` / `ready` 检查，并支持 warmup 状态，便于容器启动和编排探活。

### 4. 安全与可运维性加强

- API 请求日志增加 header 脱敏处理，降低敏感信息泄露风险。
- 增加认证、OTP 和 AI 请求限流。
- 增加登录失败锁定，强化基础账户安全。
- 生产环境默认危险配置会 fail-fast，避免用开发占位配置直接上线。
- 移动端接入 `expo-secure-store`，改善本地会话与敏感数据存储安全性。

### 5. 部署与交付能力完善

- Docker 镜像已支持 API、KB、Web 一体化构建和启动。
- 数据库迁移脚本已兼容空库初始化和已有 schema 的容器启动场景。
- 完成 Docker 启动、健康检查、数据库迁移和 KB 冷启动缓存收口。
- README、测试文档、发布清单已同步更新，发布链路更完整。

## 升级注意事项

- `v2` 默认使用 API 本地卷存储上传文件。如果你从 `v1` 升级且仍需保留原有 MinIO 中的历史报告，建议继续使用 `STORAGE_PROVIDER=minio`。
- 正式公网部署前，需要替换默认密钥和开发占位值，尤其是 `JWT_SECRET`、`OTP_HASH_SECRET`、`AI_API_KEY`、`CHROMA_API_KEY`、`CHROMA_TENANT_ID`、`CORS_ORIGIN` 和短信/OTP 配置。
- 本版本依赖 Python 运行时支撑 embedded OCR 与 KB 服务；如果不是走 Docker 部署，需要提前准备对应 Python 环境。

## 验证情况

### 构建与静态检查

```bash
npm run build --workspace @openrd/api
npx tsc --noEmit -p apps/mobile/tsconfig.json
docker compose config
```

### Docker 部署验证

```bash
POSTGRES_PORT=5433 docker compose up -d --build --remove-orphans
```

验证结果：

- `postgres` healthy
- `kb-service` healthy
- `api` healthy
- `web` started
- `/api/healthz/ready` 返回 `200`
- KB `/health/ready` 返回 `200`

### 端到端冒烟与回归

```bash
RUN_AI_TESTS=1 bash scripts/smoke-test.sh
RUN_AI_TESTS=1 bash scripts/latest-test.sh
```

验证结果：

- `Smoke Test Passed`
- `Latest Test Passed`

## GitHub Release 建议文案

### 标题

`v2.0.0`

### Summary

FSHD-openrd v2 正式发布，完成报告识别与 FSHD 专病结构化、患者随访与临床护照、AI/知识库问答以及 Docker 一体化部署链路。

### Highlights

- 内嵌报告 OCR / parser，支持 FSHD 专病结构化字段抽取
- 新增临床护照、报告详情和随访聚合视图
- 新增 submission / symptom / impact / follow-up event 数据模型
- AI、知识库、报告摘要和 fallback 链路联通
- 补齐限流、日志脱敏、登录失败锁定和生产配置校验
- Docker 构建、数据库迁移、健康检查和回归脚本已验证通过

### Upgrade Notes

- `v2` 默认使用本地卷存储上传文件；如需兼容 `v1` 的 MinIO 历史数据，请继续配置 `STORAGE_PROVIDER=minio`
- 公网部署前请替换默认密钥、短信通道与 `CORS_ORIGIN`
- 非 Docker 运行方式需要预先准备 Python 运行时以支撑 embedded OCR / KB

### Validation

- `npm run build --workspace @openrd/api`
- `npx tsc --noEmit -p apps/mobile/tsconfig.json`
- `POSTGRES_PORT=5433 docker compose up -d --build --remove-orphans`
- `RUN_AI_TESTS=1 bash scripts/smoke-test.sh`
- `RUN_AI_TESTS=1 bash scripts/latest-test.sh`
