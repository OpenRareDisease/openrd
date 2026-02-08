# 腾讯云 Docker 上线测试指南（单机版）

本指南帮助你把当前仓库部署到腾讯云单机服务器进行上线测试。

## 1. 服务器准备

1. 选择一台 Ubuntu 22.04 或 20.04 的云服务器
2. 开放安全组端口

- 4000 (API)
- 8000 (report-manager)
- 5010 (KB service)
- 5432 (PostgreSQL，如果不使用云数据库可关闭公网)
- 9000/9001 (MinIO，如果不使用可关闭公网)

## 2. 安装 Docker 与 Compose

1. 安装 Docker
2. 安装 docker compose 插件

## 3. 代码与环境变量

1. 拉取仓库到服务器
2. 拷贝并填写 .env

- 基础：DATABASE_URL、JWT_SECRET、OTP_HASH_SECRET
- AI：AI_API_KEY
- Chroma：CHROMA_API_KEY、CHROMA_TENANT_ID
- Report Manager：REPORT_MANAGER_API_KEY、REPORT_MANAGER_SECRET_KEY、REPORT_MANAGER_AI_API_KEY
- MinIO：REPORT_MANAGER_MINIO_ACCESS_KEY、REPORT_MANAGER_MINIO_SECRET_KEY

3. 移动端设置 EXPO_PUBLIC_API_URL 指向云端 API

## 4. 使用 docker-compose 启动

在仓库根目录执行：

```bash
docker compose up -d --build
```

## 5. 冒烟检查

1. API 健康检查
   `GET http://<server-ip>:4000/api/healthz`
2. 报告服务健康检查
   `GET http://<server-ip>:8000/healthz`
3. AI 问答与报告解析

## 6. 注意事项

1. 单机版默认使用本地卷保存上传文件与数据库
2. 如果要多实例，请改成对象存储与云数据库
