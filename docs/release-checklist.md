# 发布/部署清单

## 1. 配置核对

- `.env` 已按目标环境填写。
- 关键密钥已替换默认值（JWT、OCR、AI）。
- 生产环境未使用 `OTP_PROVIDER=mock`、`OCR_PROVIDER=mock`、`CORS_ORIGIN=*`。
- `EXPO_PUBLIC_API_URL` / `WEB_EXPO_PUBLIC_API_URL` 指向目标 API。
- `OCR_PROVIDER` 已确认，生产默认使用 `embedded`。

## 2. 构建与启动验证

- 本地 `npm run lint` 通过。
- `npm run db:migrate` 已执行并成功。
- `docker compose config` 通过。
- `docker compose up -d --build` 可正常拉起服务。
- 健康检查可用：
  - `GET /api/healthz/live`
  - `GET /api/healthz/ready`

## 3. 核心流程冒烟

- 注册/登录（含 OTP 发送与校验，如启用）。
- 档案创建/更新/查询。
- 测量、活动、用药写入和读取。
- 报告上传与 OCR 状态查询。
- AI 问答与进度轮询。
- AI 主模型链路已验证可用，不是 fallback 假通过。

## 4. 数据与安全

- 数据库初始化脚本/迁移已执行。
- 日志不含敏感信息明文。
- 对外端口与安全组策略已收敛。

## 5. 发布交付

- README（中/英）已同步。
- `docs/testing-guide.md` 与线上版本一致。
- `docs/updates.md` 已记录本次发布变化。
- 回滚方案已准备（镜像 tag / 版本切换 / 数据回滚策略）。
