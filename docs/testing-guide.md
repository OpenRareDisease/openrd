# Testing Guide

## 1. 前置条件

测试脚本默认假设 API 已经启动，并且可从 `http://localhost:4000` 访问。

脚本默认依赖 mock OTP，因此建议至少设置：

```bash
OTP_PROVIDER=mock
OCR_PROVIDER=embedded
```

如果要测试报告 OCR / 结构化链路，本地直跑 API 时还需要：

```bash
pip install -r apps/api/requirements-embedded-report.txt
```

## 2. 启动服务

```bash
# 数据库
docker compose up -d postgres
npm run db:migrate

# API
npm run dev:api

# 移动端
npm run dev:mobile
```

如果还要测试 AI 问答 / 报告总结，需要配置：

```bash
AI_API_KEY=...
# 或
OPENAI_API_KEY=...
```

## 3. 一键脚本

### 3.1 快速冒烟

适合每次改完接口后先看主链路是否还通：

```bash
npm run test:smoke
# 或
bash scripts/smoke-test.sh
```

覆盖内容：

- `/api/healthz`
- OTP 发送、注册、登录
- 创建档案
- 测量、功能测试、活动日志
- 报告上传
- OCR 结果读取
- `classifiedType` 与关键字段校验
- 报告下载
- `passport` / `risk` / `muscle insights`

### 3.2 全量回归

适合发布前或改了 patient profile / report OCR 主链路之后运行：

```bash
npm run test:latest
# 或
bash scripts/latest-test.sh
```

覆盖内容：

- 健康检查、注册、登录
- 创建档案与更新档案
- baseline 建档
- submission 创建与列表
- measurement / function test / symptom score / daily impact
- followup event / activity log / medication
- 5 类合成报告上传
- 报告与 submission 关联
- OCR 分类与关键字段断言
- 报告下载
- `/me`、`passport`、`passport/export`
- `/risk`、`/progression-summary`、`/insights/muscle`

### 3.3 AI 链路

两个脚本默认只在检测到 `AI_API_KEY` 或 `OPENAI_API_KEY` 时才执行 AI 用例。

也可以显式控制：

```bash
RUN_AI_TESTS=1 npm run test:smoke
RUN_AI_TESTS=0 npm run test:latest
```

### 3.4 自定义地址

如果 API 不在本机 4000 端口：

```bash
API_BASE_URL=http://127.0.0.1:4001 npm run test:smoke
```

## 4. 手工接口验证

### 4.1 发送 OTP

```bash
curl -X POST http://localhost:4000/api/auth/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+8613900000000","scene":"register"}'
```

### 4.2 注册并拿 token

```bash
OTP_REQUEST_ID='<requestId>'
OTP_CODE='<mockCode>'
PHONE='+8613900000000'
REGISTER=$(curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"$PHONE\",\"password\":\"Passw0rd!\",\"otpCode\":\"$OTP_CODE\",\"otpRequestId\":\"$OTP_REQUEST_ID\"}")
TOKEN=$(printf '%s' "$REGISTER" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
```

### 4.3 上传报告并读取 OCR

```bash
curl -X POST http://localhost:4000/api/profiles/me/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "documentType=genetic_report" \
  -F "title=基因报告" \
  -F "file=@/absolute/path/to/report.pdf"
```

```bash
curl -X GET http://localhost:4000/api/profiles/me/documents/<documentId>/ocr \
  -H "Authorization: Bearer $TOKEN"
```

重点确认：

- `ocrPayload.fields.classifiedType`
- `ocrPayload.fields.classifiedTypeConfidence`
- `ocrPayload.aiExtraction.fshd.structured_fields`
- `ocrPayload.aiExtraction.fshd.normalized_summary`

## 5. 移动端手工回归

建议至少走一遍这些链路：

1. 注册 / 登录
2. 建档
3. 录入测量、症状、活动、用药
4. 上传报告并进入报告详情
5. 查看护照页、风险页、时间线页
6. 测试 AI 问答
7. 退出登录

## 6. 静态检查

```bash
npm run lint
npm run test --workspace @openrd/api
npm run build --workspace @openrd/api
npx tsc --noEmit -p apps/mobile/tsconfig.json
python3 -m compileall \
  apps/report-manager/app/services/fshd_report_service.py \
  apps/report-manager/embedded_parser.py \
  apps/report-manager/app/services/ocr_service.py
```

说明：

- 根 `npm run test` 仍然只会转发 workspace 自己的测试命令，不等于接口冒烟。
- `apps/mobile` 的 Jest 已改为非 watch 模式，但当前覆盖仍以前端基础校验为主，后端联调仍建议以冒烟脚本和手工回归为准。
