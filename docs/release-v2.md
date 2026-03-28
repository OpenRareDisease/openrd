# Release v2 发布整理

## 发布结论

当前仓库已经可以作为 `v2` 候选版本推送到 GitHub，并创建 `v2.0.0` release。

这次不是“代码大致可用”的状态，而是已经完成了以下关键闭环：

- monorepo 内嵌 `report-manager`，报告识别不再依赖独立外部服务
- FSHD 专病报告分类、结构化抽取、置信度和溯源链路已打通
- 患者随访、提交批次、临床护照、报告详情页和聚合视图已接通
- AI 问答、报告摘要、KB 检索和 fallback 机制已联调
- 日志脱敏、鉴权限流、登录失败锁定、生产 env fail-fast 已补齐
- Docker 构建、数据库迁移、健康检查、KB warmup 和 Web 发布链路已验证

## 本次发布重点

### 1. 报告与 OCR

- 集成 embedded OCR / parser
- 新增 FSHD 专病结构化解析器
- 支持报告类型识别、字段抽取、标准化摘要和低置信度标记
- 报告详情页可展示结构化字段、摘要和人体图

### 2. 患者随访与专病视图

- 新增 submission / symptom score / daily impact / follow-up event 数据链路
- 新增 clinical passport 聚合视图
- 首页与病程管理页接入临床护照入口
- 档案页、病程页、报告页的前后端聚合逻辑补齐

### 3. AI、知识库与部署

- AI 主模型链路已切到可用模型并实测通过
- KB 服务拆分 live / ready，支持 warmup 状态
- 移动端接入 `expo-secure-store`
- Docker 镜像已支持 API、KB、Web 一体化构建和启动
- 迁移脚本已兼容空库和已有 schema 的容器启动场景

### 4. 安全与可运维性

- API 请求日志已做 header 脱敏
- 增加认证、OTP、AI 请求限流
- 增加登录失败锁定
- 生产环境默认危险配置会 fail-fast

## 已完成验证

### 本地构建与检查

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

## 发布前最后确认

发 GitHub release 前，只需要确认这几项环境变量不是开发占位值：

- `NODE_ENV=production`
- `JWT_SECRET`
- `OTP_HASH_SECRET`
- `OTP_PROVIDER` 不是 `mock`
- `CORS_ORIGIN` 指向真实域名
- `AI_API_KEY`
- `CHROMA_API_KEY`
- `CHROMA_TENANT_ID`

如果目标是公网生产，而不是单机内测，还建议后续补：

- 上传文件从本地卷迁移到对象存储
- 为 HuggingFace 下载链路提供缓存或镜像源
- 增加正式域名、HTTPS、反向代理和备份策略

## 建议的 GitHub 发布文案

### 标题

`v2.0.0`

### Summary

FSHD 专病系统 v2，完成报告识别与结构化、患者随访数据模型、临床护照、AI/知识库问答以及 Docker 一体化部署链路。

### Highlights

- 内嵌报告解析引擎，支持 FSHD 专病结构化字段抽取
- 新增临床护照、报告详情和随访聚合视图
- 新增 submission / symptom / impact / follow-up event 数据模型
- AI、KB、报告摘要和 fallback 链路联通
- 补齐限流、日志脱敏、生产配置校验和移动端安全存储
- Docker 构建、迁移和健康检查已验证通过

### Validation

- Docker stack build and startup verified
- `RUN_AI_TESTS=1 bash scripts/smoke-test.sh`
- `RUN_AI_TESTS=1 bash scripts/latest-test.sh`

## 建议的发布命令

如果你准备直接推送 GitHub：

```bash
git add .
git commit -m "release: prepare v2.0.0"
git push origin codex/frontend-human-visual-redesign
git tag v2.0.0
git push origin v2.0.0
```

如果你不想直接从当前分支发 release，建议先切一个发布分支：

```bash
git checkout -b release/v2
git add .
git commit -m "release: prepare v2.0.0"
git push origin release/v2
git tag v2.0.0
git push origin v2.0.0
```
