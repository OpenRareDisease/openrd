# @openrd/report-manager

主 API 内嵌调用的 Python 报告 OCR / 结构化解析引擎。目录中仍保留 FastAPI 代码，但当前主链路优先通过嵌入式脚本调用 `embedded_parser.py`，不再要求独立数据库和独立部署。

## 在本仓库中的定位

当前主链路由 `apps/api` 直接调用：

- `apps/report-manager/embedded_parser.py`

只有在将 API 配置为 `OCR_PROVIDER=report_manager` 时，才会重新走独立 HTTP 服务模式。

## 本地依赖

在仓库根目录准备 `.env` 后执行：

```bash
pip install -r ../api/requirements-embedded-report.txt
```

主 API 通过根目录 `.env` 统一读取 OCR 与 AI 配置。嵌入式模式主要使用：

- `OCR_PROVIDER=embedded`
- `OCR_PYTHON_BIN`
- `AI_API_KEY` / `OPENAI_API_KEY`
- `OCR_DISABLE_PADDLE`

完整示例见根目录 [`../../.env.example`](../../.env.example)。

## 常用接口

- `GET /healthz`
- `POST /api/reports/`
- `POST /api/reports/upload-and-analyze`
- `GET /api/reports/{report_id}`
- `GET /api/reports/user/{user_id}`
- `GET /api/reports/{report_id}/file`

## 独立服务模式（可选）

如果确实需要保留旧的独立 HTTP 服务，再执行：

```bash
cd apps/report-manager
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

并在主 API 中设置 `OCR_PROVIDER=report_manager` 与 `REPORT_MANAGER_OCR_URL`。

## Docker

主仓库 `docker-compose.yml` 已默认改为由 `api` 容器内嵌运行 OCR 引擎，不再单独启动 `report-manager` 服务。

如需旧模式，可手动构建该目录的 Dockerfile。
