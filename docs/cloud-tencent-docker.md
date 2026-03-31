# 腾讯云 Docker 上线测试指南（单机版）

本指南帮助你把当前仓库部署到腾讯云单机服务器进行上线测试。

## 1. 服务器准备

1. 选择一台 Ubuntu 22.04 或 20.04 的云服务器
2. 开放安全组端口

- 80 / 443（推荐由反向代理统一入口）
- 4000（如果暂时直连 API）

不建议公网暴露：

- 5010（KB service）
- 5432（PostgreSQL）

## 2. 安装 Docker 与 Compose

1. 安装 Docker
2. 安装 docker compose 插件

## 3. 代码与环境变量

1. 拉取仓库到服务器
2. 拷贝并填写 .env

- 基础：DATABASE_URL、JWT_SECRET、OTP_HASH_SECRET
- 运行模式：`NODE_ENV=production`
- AI：AI_API_BASE_URL、AI_API_MODEL、AI_API_KEY
- Chroma：CHROMA_API_KEY、CHROMA_TENANT_ID
- OCR：OCR_PROVIDER
- 存储：`STORAGE_PROVIDER`，如使用 MinIO 再配置 `MINIO_*`
- CORS：把 `CORS_ORIGIN` 设置为实际前端域名；本地 Docker 联调用 `http://localhost:8080`

说明：

- 如果直接使用仓库里的 `docker-compose.yml`，容器内 `OCR_PYTHON_BIN` 会固定为 `python3`，不要填本机 conda 路径。
- 当前已验证可用的 SiliconFlow 文本模型配置是 `Qwen/Qwen3-VL-32B-Instruct`。
- 如果宿主机已有 PostgreSQL 占用 `5432`，启动时可用 `POSTGRES_PORT=5433 docker compose up -d --build` 规避端口冲突。
- 如果你从 `v1` 升级且历史报告保存在 MinIO，建议在 `v2` 继续使用 `STORAGE_PROVIDER=minio`，并启用 compose 里的 `minio` profile。

3. 移动端设置 EXPO_PUBLIC_API_URL 指向云端 API

## 4. 使用 docker-compose 启动

在仓库根目录执行：

```bash
npm run db:migrate
docker compose config
docker compose up -d --build
```

如果启用 MinIO：

```bash
docker compose --profile minio up -d --build
```

## 5. 冒烟检查

1. API 健康检查
   `GET http://<server-ip>:4000/api/healthz/live`
   `GET http://<server-ip>:4000/api/healthz/ready`
2. AI 问答与报告解析

## 6. 注意事项

1. 单机版默认使用本地卷保存上传文件与数据库
2. 如需兼容 `v1` 的 MinIO 文件存储，可直接启用 `minio` profile，并把 `STORAGE_PROVIDER` 设为 `minio`
3. 如果要多实例，请改成对象存储与云数据库
4. 不建议公网暴露 5010；`kb-service` 仅供 API 容器内网访问
