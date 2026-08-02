# 腾讯云 Docker 上线测试指南（单机版）

> ## ⚠️ 生产部署请以 [`docs/runbooks/v2.5.0-deploy.md`](./runbooks/v2.5.0-deploy.md) 为准
>
> 本文是一份**服务器准备 + 单机联调**指南，不是生产部署手册。它给的 compose 命令**不带 `--profile prod`**，也就是说：
>
> - **不启动 Caddy** —— 没有 HTTPS、没有自动证书、没有安全响应头，API 只能靠公网直连 4000 端口（患者数据必须走 HTTPS，这在生产上是不可接受的）
> - **不启动 MinIO** —— 而生产建议 `STORAGE_PROVIDER=minio`
>
> 它还遗留了已退役的 Chroma 配置说明（知识库在 v2.4.0 就迁到本地 pgvector 了）。
>
> **保留本文的用途**：服务器选型、装 Docker、端口/安全组、以及本机上「先把栈跑起来看看」的最小路径。真正的上线动作走 runbook。

## 1. 服务器准备

1. 选择一台 Ubuntu 22.04 或 20.04 的云服务器
2. **内存至少 8 GB**

   `docker-compose.yml` 现在给每个服务设了 `mem_limit`：kb-service 4g（bge-m3 权重约 2 GB，加载后 RSS 会到 3-4 GB）、api 3g、postgres 1g、minio 512m、web 128m、caddy 128m，上限合计 8.75 GiB。这些是「超了杀这个容器」的阈值而不是预留量，但 4 GB 的机器跑不动——bge-m3 warmup 一步就能吃光。

   > 本文以前完全没提内存。一台 4 GB 实例是很自然的选择，然后 KB warmup 撑爆内存，内核按 RSS 打分挑 OOM 受害者，被杀的很可能是 postgres 或 api 而不是肇事的 KB——表现为数据库或 API 在请求中途死掉，日志里没有一行指向 KB。

3. 开放安全组端口

生产（走 Caddy）：**只放行 80 / 443**。

单机联调（不走 Caddy，仅限测试环境）：额外放行 4000（API 直连）。

**任何情况下都不要公网暴露**：

- 5010（KB service）
- 5432（PostgreSQL）
- 9000（MinIO）
- 8080（web 容器）

以上端口在 `docker-compose.yml` 里都绑在 `127.0.0.1` 或只存在于 compose 内网。

## 2. 安装 Docker 与 Compose

1. 安装 Docker
2. 安装 docker compose 插件

## 3. 代码与环境变量

1. 拉取仓库到服务器
2. 拷贝并填写 `.env`

```bash
cp .env.example .env
```

必填项的**完整**清单在 [runbook §1.1](./runbooks/v2.5.0-deploy.md#11-必填-env-变量)。下面只列几条最容易漏的：

- **`NODE_ENV=production`** —— 不写这一行，整个生产 fail-fast 块直接返回空错误列表，下面所有检查都不生效
- **`POSTGRES_PASSWORD`** —— `.env.example` 里没有这一行，需要手工加。compose 用 `${POSTGRES_PASSWORD:?…}`，缺它 `docker compose config` 就失败，一个容器都不会创建
- 基础：`DATABASE_URL`、`JWT_SECRET`、`OTP_HASH_SECRET`（后两个各 ≥32 字符高熵随机串）
- AI：`AI_API_BASE_URL`、`AI_API_MODEL`、`AI_API_KEY`
- 知识库：`KB_SERVICE_TOKEN`（≥32 字符随机串，API 和 KB 两边同值）
- OCR：`OCR_PROVIDER=embedded`
- 存储：`STORAGE_PROVIDER`，用 MinIO 再配 `MINIO_*`；用 `local` 则必须显式 `STORAGE_ALLOW_LOCAL=true`
- CORS：`CORS_ORIGIN` 设成实际前端域名；本地 Docker 联调用 `http://localhost:8080`

> **`CHROMA_*` 已退役**：知识库在 v2.4.0 迁到了本地 pgvector（`KB_BACKEND` 默认 `pgvector`）。`.env.example` 里那几个 Chroma 键留着只是为了一条回退路径，正常部署不需要配。

说明：

- 容器内 `OCR_PYTHON_BIN` 固定为 `python3`，不要填本机 conda 路径。
- 当前已验证可用的 SiliconFlow 文本模型配置是 `Qwen/Qwen3-VL-32B-Instruct`。
- 宿主机已有 PostgreSQL 占用 `5432` 时，用 `POSTGRES_PORT=5433 docker compose up -d --build` 规避冲突。
- 从 `v1` 升级且历史报告在 MinIO 的，继续用 `STORAGE_PROVIDER=minio`。**注意**：远程 / 已有的 MinIO 主机必须 `MINIO_USE_HTTPS=true`，否则 access key、secret key 和每一份扫描件的原始字节都是明文过网。只有 MinIO 就在 compose 内网、走 docker bridge 时，才可以用 `MINIO_ALLOW_INSECURE=true` 显式确认。
- **国内服务器**：`HF_ENDPOINT` 现在默认就是 `https://hf-mirror.com`，不用再手工设。海外部署反过来要显式设成 `https://huggingface.co`。

3. 移动端 API 地址

**不要**在这份根目录 `.env` 里写 `EXPO_PUBLIC_API_URL` —— Expo 只解析 `apps/mobile/` 下的 dotenv 文件，根目录那份它从来不读，写在这里会静默失效。

- Docker web 镜像：由 compose 的 `WEB_EXPO_PUBLIC_API_URL`（默认 `/api`）作为 build arg 传进去，走 Caddy 时默认值就是对的
- 本机 / EAS 构建：写 `apps/mobile/.env`，模板见 `apps/mobile/.env.example`

## 4. 使用 docker-compose 启动

在仓库根目录执行：

```bash
docker compose --profile prod config -q     # 只做插值和校验，不启动任何东西
docker compose --profile prod up -d --build
```

`--profile prod` 会把**全部六个服务**拉起来：`postgres` / `kb-service` / `api` / `web`（无 profile，默认启动）+ `minio` / `caddy`。**不需要**再叠 `--profile minio`。

不带 `--profile prod` 的 `docker compose up -d --build` 只适合本机联调：没有 Caddy（无 HTTPS）、没有 MinIO。

> 迁移不需要单独跑：api 容器的 CMD 是 `node dist/db/migrate.js && node dist/index.js`，并且在一个 advisory lock 里执行。想 migrate-first 就在 up 之前手工 `npm run db:migrate` 一次。

## 5. 冒烟检查

1. API 健康检查（走 Caddy 时是 `https://<域名>/api/healthz/...`）
   - `GET /api/healthz/live`
   - `GET /api/healthz/ready` → 200

   `ready` 只看 database + embedded OCR。KB 挂了 / 正在 warming / 语料为空、MinIO 不可达、AI key 未配都是 `degraded` 但 `ready: true` —— 站点仍在服务，但有东西坏了要处理。

   从公网调 `/api/healthz` 只会拿到 status 和一个 `requestId`；详情要么在宿主机上走 loopback（`docker compose --profile prod exec -T api node -e "fetch('http://127.0.0.1:4000/api/healthz')..."`），要么按 requestId grep 日志。

2. **KB 语料非空**：`SELECT count(*) FROM kb_chunks;`。全新机器上这张表是空的，需要按 [runbook §3.5](./runbooks/v2.5.0-deploy.md#35-全新部署kb-语料-seed空库才需要) 从已 ingest 的环境整表搬过来。
3. AI 问答与报告解析

## 6. 注意事项

1. 单机版默认用本地卷保存上传文件与数据库。**这意味着 `docker compose down -v` 会永久删除所有患者文档和整个数据库**——只用 `docker compose down`（不带 `-v`）。
2. 备份不是可选项：`BACKUP_DIR=/mnt/offsite/openrd npm run db:backup`，并把 `BACKUP_DIR` 指到宿主机之外。见 [runbook §1.7](./runbooks/v2.5.0-deploy.md#17-备份先行)。
3. 兼容 `v1` 的 MinIO 文件存储：`--profile prod` 已包含 minio 服务，把 `STORAGE_PROVIDER` 设为 `minio` 即可。
4. 要多实例请改成对象存储与云数据库。注意迁移 runner 虽然有 advisory lock，但应用层的定时任务（OCR 扫描、注销清理、保留期清理）仍假设单实例。
5. 不要公网暴露 5010；`kb-service` 仅供 API 容器内网访问。
