# Report Manager 002

一个用于患者管理PDF医学报告的Python API项目，支持OCR文本提取和AI分析功能。

## 项目介绍

Report Manager 002是一个基于FastAPI框架开发的医学报告管理系统，主要功能包括：

- 用户管理（注册、登录、CRUD操作）
- PDF医学报告上传和存储
- OCR文本提取
- AI医学数据分析
- 医学报告查询和管理

## 技术栈

- **框架**: FastAPI
- **数据库**: PostgreSQL 16
- **文件存储**: MinIO
- **OCR**: PyPDF2 + PaddleOCR（pytesseract 兜底）
- **AI分析**: Silicon Flow API
- **ORM**: SQLAlchemy
- **API文档**: Swagger UI

## 主要功能

### 1. 用户管理

- 用户注册和登录
- 用户信息管理
- 权限控制

### 2. 医学报告管理

- PDF报告上传
- 报告查询和检索
- 报告详情查看
- 报告删除

### 3. OCR文本提取

- 从PDF中提取文本内容
- 扫描版PDF/图片优先使用 PaddleOCR
- PaddleOCR 失败时自动回退到 pytesseract
- 支持多页PDF

### 4. AI医学数据分析

从医学报告中提取以下数据项：

- D4Z4 重复数
- 甲基化值
- 前锯肌脂肪化等级
- 三角肌、肱二头肌、肱三头肌、肱四头肌的肌力评估
- 肝功能、肌酸激酶
- 楼梯测试结果

## 安装和运行

### 1. 克隆仓库

```bash
git clone https://gitcode.com/guotiecheng/report_manager_002.git
cd report_manager_002
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 配置环境

创建`.env`（或使用 openrd 根目录 `.env`），配置数据库和MinIO连接信息：

```env
REPORT_MANAGER_ENV=development
REPORT_MANAGER_SECRET_KEY=

# 数据库配置（建议使用 REPORT_MANAGER_* 前缀）
REPORT_MANAGER_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/report_manager
REPORT_MANAGER_SQLALCHEMY_ECHO=false

# MinIO配置（建议使用 REPORT_MANAGER_* 前缀）
REPORT_MANAGER_MINIO_ENDPOINT=127.0.0.1:9000
REPORT_MANAGER_MINIO_ACCESS_KEY=minioadmin
REPORT_MANAGER_MINIO_SECRET_KEY=minioadmin12345678
REPORT_MANAGER_MINIO_BUCKET_NAME=medical-reports
REPORT_MANAGER_MINIO_USE_HTTPS=false

# AI API配置（建议使用 REPORT_MANAGER_* 前缀）
REPORT_MANAGER_AI_API_KEY=your_ai_api_key
REPORT_MANAGER_AI_API_URL=https://api.siliconflow.cn/v1/chat/completions

# API Key（建议生产环境启用）
REPORT_MANAGER_API_KEY=your_report_manager_api_key

# PaddleOCR（可选）
# 若启动时卡在模型源检查，可设为 true
PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=false
```

### 4. 初始化数据库

```bash
# 使用SQL脚本初始化数据库
psql -U postgres -f db_init_script.sql

# 或使用Python脚本初始化
python init_db.py
```

### 5. 初始化MinIO

```bash
python minio_init_script.py
```

### 6. 启动应用

```bash
python -m uvicorn main:app --reload --port 8000
```

应用将在 http://127.0.0.1:8000 运行

## API文档

启动应用后，访问以下地址查看完整的API文档：

```
http://127.0.0.1:8000/swagger
```

健康检查：

```
http://127.0.0.1:8000/healthz
```

### 主要API端点

#### 用户管理

- `POST /api/users/` - 创建用户
- `POST /api/users/login/` - 用户登录
- `GET /api/users/` - 获取所有用户
- `GET /api/users/{user_id}` - 获取用户详情
- `PUT /api/users/{user_id}` - 更新用户信息
- `DELETE /api/users/{user_id}` - 删除用户

#### 医学报告管理

- `POST /api/reports/` - 上传医学报告
- `POST /api/reports/upload-and-analyze` - 上传并分析医学报告（集成OCR和AI分析）
- `GET /api/reports/` - 获取所有报告
- `GET /api/reports/{report_id}` - 获取报告详情
- `GET /api/reports/user/{user_id}` - 获取用户的所有报告
- `PUT /api/reports/{report_id}` - 更新报告信息
- `DELETE /api/reports/{report_id}` - 删除报告
- `GET /api/reports/{report_id}/file` - 获取报告文件URL

## 使用示例

### 1. 用户注册

```bash
curl -X POST "http://127.0.0.1:8000/api/users/" -H "accept: application/json" -H "Content-Type: application/json" -d '{"username":"test_user","password":"test_password","email":"test@example.com","full_name":"Test User"}'
```

### 2. 上传并分析医学报告

```bash
curl -X POST "http://127.0.0.1:8000/api/reports/upload-and-analyze" \
  -H "accept: application/json" \
  -H "Content-Type: multipart/form-data" \
  -H "X-API-Key: <REPORT_MANAGER_API_KEY>" \
  -F "file=@path/to/your/report.pdf" \
  -F "report_name=Test Report" \
  -F "user_id=1"
```

### 3. 获取用户报告列表

```bash
curl -X GET "http://127.0.0.1:8000/api/reports/user/1" -H "accept: application/json"
```

## 项目结构

```
report_manager_002/
├── app/
│   ├── dependencies/       # 依赖注入
│   ├── models/             # 数据库模型
│   ├── routes/             # API路由
│   └── services/           # 业务逻辑层
├── config.py               # 配置文件
├── main.py                 # 应用入口
├── requirements.txt        # 依赖列表
├── init_db.py              # 数据库初始化脚本
├── db_init_script.sql      # PostgreSQL SQL脚本
├── minio_init_script.py    # MinIO初始化脚本
└── README.md               # 项目文档
```

## 配置说明

### 数据库配置

在`config.py`中配置PostgreSQL连接：

```python
SQLALCHEMY_DATABASE_URI = 'postgresql://postgres:postgres@192.168.56.102:5432/report_manager'
```

### MinIO配置

在`config.py`中配置MinIO连接：

```python
MINIO_ENDPOINT = '192.168.56.1:9000'
MINIO_ACCESS_KEY = 'minioadmin'
MINIO_SECRET_KEY = 'minioadmin12345678'
MINIO_BUCKET_NAME = 'medical-reports'
MINIO_USE_HTTPS = False
```

### AI API配置

在`config.py`中配置Silicon Flow API：

```python
AI_API_KEY = 'your_api_key'
AI_API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
```

### 提示词优化要点（Prompt Guidance）

当前 AI 提示词已做了以下优化，以提高结构化质量并减少噪声：

1. 明确禁止将“疾病小常识/科普/注意事项”等教育段落抽取为 `observations` 或 `findings`。
2. 识别“姓名/性别/年龄/身份证号/样品送检日期/门诊号/住院号”等结构化行，并将 `has_tables` 置为 `true`（即使不是严格表格）。
3. 强制提取身份证号（`patient_info.id_numbers.patient_id`，可从长字符串中提取 18 位）、样品编号（`patient_info.id_numbers.barcode`）、地址/电话/邮箱等联系信息。
4. 基因检测报告只保留简明结论/印象到 `findings`，避免混入科普内容。
5. 身份证号/病历号/条码号严格映射：18 位身份证 → `patient_id`；门诊/住院/病历号 → `visit_id`；样本/条码/资料编号 → `barcode`。
6. 血常规/CBC 表格逐行抽取，非数值噪声不当作结果；单位仅在明确表头存在时继承。
7. 姓名清洗：优先连续中文字符，去除明显标点/星号但不臆测缺失字符。
8. 病人ID/患者ID/MR号/检查号等标识一律归入 `visit_id`（除非明确 18 位身份证号）。

如需进一步调整提示词，请查看并修改：
`apps/report-manager/app/services/ai_service.py`

## 开发和贡献

### 安装开发依赖

```bash
pip install -r requirements.txt
```

### 运行测试

```bash
pytest
```

### 代码风格检查

```bash
black .
flake8
```

## 许可证

MIT License

## 联系方式

如有问题或建议，请联系：

- 邮箱: seanguo_007@163.com
- GitCode: https://gitcode.com/guotiecheng

## 更新日志

### v1.0.0 (2026-01-19)

- 初始版本发布
- 实现用户管理功能
- 实现医学报告上传和管理
- 实现OCR文本提取
- 实现AI医学数据分析
- 集成Swagger API文档
