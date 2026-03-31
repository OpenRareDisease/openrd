# @openrd/report-manager

主 API 内嵌调用的 Python 报告 OCR / 结构化解析引擎。当前目录只保留嵌入式解析所需文件，不再保留旧的独立 HTTP 服务模式。

## 在本仓库中的定位

当前主链路由 `apps/api` 直接调用：

- `apps/report-manager/embedded_parser.py`

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

## 文件作用概览

- `embedded_parser.py`：当前默认主链路入口，`apps/api` 直接调用。
- `app/services/fshd_report_service.py`：FSHD 专病结构化解析与指标归一化。
- `app/services/ocr_service.py`：PDF / 图片 OCR 提取。
- `tests/test_fshd_report_service.py`：当前仓库保留的自动化回归测试。
- `apps/report-manager/.env`：不是当前生效配置来源；统一使用仓库根目录 `.env`。

## 当前约束

- 主仓库只支持由 `apps/api` 通过嵌入式脚本调用 OCR / parser。
- 不再支持 `OCR_PROVIDER=report_manager` 或独立 `report-manager` HTTP 服务。
- Docker 部署也不再单独构建或运行 `report-manager` 服务。
