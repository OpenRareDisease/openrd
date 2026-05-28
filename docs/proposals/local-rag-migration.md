# 本地化 RAG 与 AI 问答升级方案

本文档描述 FSHD-openrd 在 RAG（Retrieval-Augmented Generation）与 AI 问答链路上的下一阶段架构升级方案，目标是在保留现有 SiliconFlow LLM 推理服务的前提下，将所有数据存储与检索能力收口到本地，建立可扩展的 retriever 接口、分级隐私保护机制，并为未来引入 GraphRAG 等高级检索范式留出空间。

---

## 1. 背景与现状

### 1.1 当前架构

AI 问答由两部分组成：

- **Node API（`/api/ai/ask`）**：负责检索问题改写、知识库调用、最终回答生成
- **Python 知识服务（`apps/api/knowledge_service.py`）**：连接 Chroma Cloud 检索片段

AI 模型托管在 SiliconFlow，检索向量由本地 embedding 模型生成。患者档案、报告、随访等结构化数据存于 PostgreSQL。

### 1.2 当前的限制

- **数据合规**：医学 KB 数据存放在境外 Chroma Cloud（人遗资源 / 跨境传输风险）
- **可扩展性**：检索逻辑硬编码在 `ai-chat.routes.ts`，难以扩展新的数据源
- **个性化缺失**：LLM 看不到用户档案与报告，无法回答"我的 D4Z4 意味着什么"这类问题
- **隐私保护粒度粗**：无法让用户在"严格脱敏"与"专业精确"之间选择
- **检索范式单一**：纯向量检索对"关系/因果/全局"类问题召回质量有限

### 1.3 本次升级范围

- 向量库与医学 KB 数据迁移到本地（pgvector）
- 嵌入模型升级到 bge-m3
- 建立可扩展的 retriever / LLM provider 抽象层
- 引入工具调用（tool calling），让 LLM 按需读取用户档案与报告
- 三档用户同意机制 + 分级 PII 脱敏
- AI 聊天前端配合升级（来源展示、模式切换、审计查看）
- 数据库 schema 为知识图谱预留实体/关系表

LLM 推理继续使用 SiliconFlow（DeepSeek-V3.1），不引入自托管 LLM；报告解析继续使用现有 `embedded_parser`，暂不引入 RAGFlow。

---

## 2. 升级目标

1. **数据本地化**：除 LLM 推理外，所有数据（医学 KB、患者档案、报告、随访）100% 本地存储
2. **架构可扩展**：检索层抽象，未来加入 GraphRAG / Hybrid 检索无需改动业务代码
3. **合规与隐私**：用户对个人数据使用拥有分级控制权，所有 AI 调用可审计
4. **个性化体验**：LLM 能基于当前用户的真实档案与报告给出针对性回答

---

## 3. 总体架构

### 3.1 数据流

```
用户提问
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ ① Consent Checker（同意检查）                            │
│   读 patient_profiles.ai_consent_* 决定流程级别          │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ ② Planner（计划器，LLM 第 1 次调用）                     │
│   决定要调哪些工具                                       │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ ③ Executor（执行器，并行）                               │
│   ├─ medical_kb retriever     (pgvector)                │
│   ├─ patient_profile retriever (Postgres SQL，实时)     │
│   ├─ patient_reports retriever (Postgres SQL，实时)     │
│   └─ platform_docs retriever   (远期)                   │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ ④ PII Redactor（分级脱敏）                               │
│   Layer 1（硬删除）→ Layer 2（临床化，可选）→ Layer 3   │
│   （白名单）                                             │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ ⑤ Context Builder（上下文组装）                          │
│   医学 chunks + 脱敏患者上下文 + 用户问题                │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ ⑥ LLM Provider（SiliconFlow，第 2 次调用）               │
│   生成最终答案                                           │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ ⑦ Audit Logger                                          │
│   ai_prompt_audit 表记录本次调用                         │
└─────────────────────────────────────────────────────────┘
    │
    ▼
SSE 流式返回前端
```

### 3.2 关键技术组件

| 组件     | 选型                             | 角色                                 |
| -------- | -------------------------------- | ------------------------------------ |
| 向量库   | **pgvector**（PostgreSQL 扩展）  | 医学 KB 向量存储 + 检索              |
| 嵌入模型 | **bge-m3**（1024 维，BAAI）      | 中文医学语料嵌入                     |
| LLM 服务 | **SiliconFlow**                  | 推理（云端）                         |
| LLM 模型 | **DeepSeek-V3.1**                | Tool calling + 最终回答              |
| 报告解析 | **embedded_parser**（PaddleOCR） | 维持现状                             |
| 编排层   | 手写 TypeScript orchestrator     | Planner + Executor + Context Builder |
| 流式传输 | SSE（Server-Sent Events）        | 前端进度反馈                         |

---

## 4. 数据存储与更新策略

### 4.1 数据分类

| 数据类型         | 存储                           | 更新机制                | 实时性           |
| ---------------- | ------------------------------ | ----------------------- | ---------------- |
| 患者档案         | `patient_profiles`             | 应用层 SQL 写入         | 实时（SQL 直查） |
| 患者报告 OCR     | `documents.ocr_payload`        | 上传 → 解析 → 写入      | 实时             |
| 患者随访/测量    | `follow_up_events` 等          | 应用层写入              | 实时             |
| 医学 KB          | `kb_chunks`（pgvector）        | `kb-ingest.py` 灌库脚本 | 触发式更新       |
| 实体/关系图谱    | `kb_entities` / `kb_relations` | 远期 GraphRAG 阶段填充  | -                |
| 平台文档（远期） | `kb_chunks`（不同 namespace）  | CI 触发                 | 准实时           |

### 4.2 患者数据：实时 SQL 查询

患者档案、报告、随访由 retriever 在问答时直接通过 SQL 查询 Postgres，**不进入向量库**：

- 用户更新档案 → 下次问答立即看到新值
- 用户上传新报告 → 解析完成入库后立即可被引用
- 不需要 embedding，不需要重建索引

### 4.3 医学 KB：多格式源 + 触发式更新

医学知识源文件落在 `content/medical-kb/source/`（gitignored，体积大），通过 `scripts/kb_parsers/` 解析后灌入 pgvector。当前支持的格式：

| 扩展                                                            | 解析器            | 备注                                                                                                                                |
| --------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `.md` / `.markdown`                                             | `markdown_parser` | YAML frontmatter → 文件元数据；body 走 heading-aware 切块                                                                           |
| `.pdf`                                                          | `pdf_parser`      | pdfminer.six 抽文本层，每页一个 section；正文 < 60 字符的页自动 OCR fallback（chi_sim+eng）                                         |
| `.docx`                                                         | `docx_parser`     | python-docx 按 Heading 分组；表格扁平化为 tab-separated；遇 OLE2 头（伪 .docx）报清晰错误；遇 python-docx 解析失败时走 zip+XML 兜底 |
| `.png` / `.jpg` / `.jpeg` / `.tif` / `.tiff` / `.bmp` / `.webp` | `image_parser`    | 直接 OCR（chi_sim+eng）                                                                                                             |
| `.htm` / `.html`                                                | `html_parser`     | BeautifulSoup 去掉 script/style/nav，取可见文本                                                                                     |

每个 parser 返回 `ParseResult(sections, file_metadata)`。Section 经 `kb_parsers.chunker` 二次切块（markdown 走 heading-aware，其它走 paragraph-greedy + 句末标点窗口兜底），再注入 `folder_path / category / language / file_type / parser / pipeline_version` 元数据，最后 batch embed + upsert 到 `kb_chunks`。

灌库流程：

1. 把素材放到 `content/medical-kb/source/`（也可以直接解 zip 进去，不进 git）。脚本默认 `--source content/medical-kb/source`，且会自动剥掉单层 wrapper —— 比如解 `FSHD_知识库.zip` 后多出来的 `source/FSHD_知识库/` 这层会自动跳进去，`category` 仍然是 `01.疾病定义和科普` 而不是 `FSHD_知识库`。
2. 运行 `npm run kb:ingest`（首次会下载 bge-m3 模型 ~2.3GB）。默认写入 pgvector；如果想灌 Chroma 设 `KB_BACKEND=chroma_cloud` 即可。
3. 脚本按文件指纹（`sha256(file_bytes + parser_name + pipeline_version)`）做幂等：
   - 新文件 → 解析 + 切块 + embed + insert
   - 变更文件或 pipeline 版本改了 → 删除旧 chunks + 重灌
   - 删除文件 → 当前不自动清孤儿（见 follow-up issue #20）
4. 同一份素材可重复跑，会自动跳过未变更的文件
5. `--only .pdf,.docx` 可限定增量灌某些格式
6. `--dry-run` 只走解析与切块统计，不动 DB（但仍需要 `DATABASE_URL` 能连通，因为要读现有 fingerprint）

环境依赖：

- Python 3.11（sentence-transformers / pytorch 暂未支持 3.14）
- `tesseract` + `tesseract-lang`（图像 / 扫描 PDF 的 OCR 用，brew 装）
- `pip install -r requirements.txt`（含 `pdfminer.six` / `python-docx` / `pdf2image` / `pytesseract` / `Pillow` / `beautifulsoup4`）

医学 KB 因此可代码化管理（parser + chunker 在 git）、源材料独立存档（zip 或 NAS），并随时一键重灌。

---

## 5. 三档用户同意机制

### 5.1 同意档位

| 档位           | 触发条件                                                              | AI 问答行为                                    |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| **0 未同意**   | `ai_consent_third_party = false` 或 `ai_consent_personal = false`     | 拒绝（HTTP 403，引导用户到隐私设置）           |
| **1 基础同意** | `third_party = true` 且 `personal = true` 且 `precise_values = false` | 严格模式：所有患者数据经分级脱敏后注入 prompt  |
| **2 专业同意** | 加上 `precise_values = true`                                          | 精确模式：基因检测原始数值等专业字段保留原始值 |

### 5.2 数据库字段

```sql
ALTER TABLE patient_profiles
  ADD COLUMN IF NOT EXISTS ai_consent_personal BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_consent_personal_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_consent_third_party BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_consent_third_party_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_consent_precise_values BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_consent_precise_values_at TIMESTAMPTZ;
```

所有字段默认 `false`，必须由用户主动勾选。撤回同意立即生效。

### 5.3 隐私设置 UI

```
🔒 我的数据共享

[ ] 允许 OpenRD 在 AI 问答中使用我的健康数据
    "AI 助手能看到你的档案和报告，给出个性化建议"

[ ] 允许将脱敏后的数据通过第三方 AI 服务（SiliconFlow）处理
    "AI 推理在境内第三方服务器上完成"

[ ] ⚠️ 允许 AI 看到精确数值（如 D4Z4 重复数 3/22 等）
    "可以让回答更专业准确，但精确数据会通过第三方服务处理。
     仅在你想要最详细的解读时打开。可随时关闭。"

[📋 查看我的 AI 数据使用记录]
```

---

## 6. 分级 PII 脱敏

### 6.1 三层护栏

| 层                      | 处理                                                           | 任何档位执行 | 仅严格模式执行 |
| ----------------------- | -------------------------------------------------------------- | ------------ | -------------- |
| **Layer 1：硬删除**     | 删除姓名、手机号、身份证、精确地址、邮箱、完整出生日期         | ✅ 所有档位  | -              |
| **Layer 2：数值临床化** | D4Z4 数值 → "致病范围（低重复）"；甲基化数值 → "甲基化偏低" 等 | -            | ✅ 仅档位 1    |
| **Layer 3：白名单过滤** | 只允许列表中的字段进入 prompt，未授权字段一律拒绝              | ✅ 所有档位  | -              |

### 6.2 模式切换语义

- **严格模式**（档位 1）：医学数值经过临床化解读后注入，回答仍能解释含义，但 LLM 看不到原始数值
- **精确模式**（档位 2）：Layer 2 跳过，原始数值（如 `D4Z4: 3/22`）注入，LLM 能给出最精确的专业解读

无论哪个模式，Layer 1 与 Layer 3 始终执行。即使在精确模式，姓名、联系方式、身份证等纯隐私字段不会发送。

### 6.3 白名单按模式分

```typescript
export const PROMPT_ALLOWLIST = {
  profile: {
    strict: [
      'ageGroup',
      'gender',
      'diagnosisType_clinical',
      'd4z4_clinical',
      'haplotype_clinical',
      'methylation_clinical',
      'onsetRegion',
      'symptomCategories',
    ],
    precise: [
      'ageGroup',
      'gender',
      'diagnosisType',
      'd4z4', // 原始数值
      'haplotype',
      'methylation',
      'onsetRegion',
      'symptomCategories',
    ],
  },
  reports: {
    strict: ['classifiedType', 'reportDate_year', 'fields_clinical'],
    precise: ['classifiedType', 'reportDate_year', 'fields'],
  },
};
```

未来新增字段时，必须显式添加到白名单才能进入 prompt，避免无意泄漏。

---

## 7. 审计日志

每次 `/api/ai/ask` 调用记录一条审计日志：

```sql
CREATE TABLE ai_prompt_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  llm_provider TEXT,
  llm_model TEXT,
  request_id TEXT,
  consent_level TEXT,          -- 'none' | 'basic' | 'precise'
  redaction_mode TEXT,         -- 'strict' | 'precise'
  redacted_prompt_hash TEXT,
  prompt_char_length INT,
  used_personal_data BOOLEAN,
  fields_used JSONB,
  tools_called JSONB,
  latency_ms INT,
  status TEXT,
  error_detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

用途：

- 用户行使知情权 / 数据访问权时给出清单
- 合规审计追溯
- 故障排查与性能分析
- 模式滥用监控

审计表不存储原始 prompt 内容（仅存 hash + 长度 + 用到的字段），既能追溯又避免二次泄露风险。

---

## 8. 接口抽象设计

### 8.1 IRetriever

```typescript
export interface IRetriever {
  readonly id: string;
  readonly kind: 'vector' | 'sql' | 'graph' | 'hybrid';
  search(input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult>;
}

export interface RetrieveResult {
  chunks: Chunk[];
  citations: Citation[];
  metadata: Record<string, unknown>;
}
```

实现：

- `MedicalKbRetriever`：pgvector 向量检索
- `PatientProfileRetriever`：Postgres SQL 实时查询
- `PatientReportsRetriever`：Postgres SQL 实时查询
- `PlatformDocsRetriever`：远期，pgvector 不同 namespace
- `GraphRetriever`：占位，Phase 4 实现

未来加入 GraphRAG 时，新增 `GraphRetriever implements IRetriever` 即可，业务层零改动。

### 8.2 ILLMProvider

```typescript
export interface ILLMProvider {
  readonly id: string;
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream(req: ChatRequest): AsyncIterator<ChatChunk>;
  supportsToolCalling(): boolean;
}
```

默认实现 `SiliconFlowProvider`。未来如需切换 LLM 服务商（或引入自托管），新增实现即可。

### 8.3 VectorBackend（Python 侧）

```python
class VectorBackend(ABC):
    def search(self, queries, fetch_k, where) -> SearchResult: ...
    def upsert(self, chunks) -> None: ...
    def delete(self, ids) -> None: ...
```

实现：

- `PgVectorBackend`：本地 Postgres 向量检索
- `ChromaCloudBackend`：保留作为回退选项

---

## 9. 实施阶段

### Phase 1：向量库本地化 + KB 迁移 + KB 自动化（2.5 周）

**交付物**：

- pgvector 部署完成，`kb_chunks` 表与索引就绪
- bge-m3 嵌入模型集成
- `kb_backends/pgvector.py` 实现
- `content/medical-kb/` 目录结构与初始内容
- `kb-ingest.py` 灌库脚本（幂等）
- 一次性迁移脚本：Chroma Cloud → 本地
- `KB_BACKEND` env 切换支持

**验收**：

- `KB_BACKEND=pgvector` 与 Chroma Cloud 问答效果差异 < 5%（30 条问题人工评估）
- `KB_BACKEND=chroma_cloud` 一键回退
- 修改 `content/medical-kb/` 文件后运行脚本，对应 chunks 自动同步
- 5000 chunks 量级下检索 P50 < 500ms

### Phase 2：架构抽象 + 三档同意 + 分级脱敏（3.5 周）

**交付物**：

- `apps/api/src/modules/ai-agents/` 完整模块
- 4 个 retriever 实现（medical / profile / reports / docs 占位）
- `PIIRedactor` 三层护栏 + 严格/精确两种模式
- `ConsentChecker` 三档同意检查
- `LLMProvider` 抽象 + SiliconFlow 实现
- 完整 orchestrator（Planner + Executor + Context Builder）
- 审计日志表与写入逻辑
- 改造后的 `/api/ai/ask` 端点（支持 SSE）

**验收**：

- 所有 retriever 单元 + 集成测试通过
- PII Redactor 在严格 / 精确两种模式下行为正确（含集成抓包验证）
- 三档同意切换立即生效
- 审计日志覆盖率 100%
- `GraphRetriever` 接口 review：未来加图谱无需改动 orchestrator

### Phase 3：AI 聊天前端升级（3 周）

**3a 基础改造（1 周）**：

- `ConsentGate`：未同意拦截 + 引导
- `DisclaimerBanner`：顶部非诊断声明
- `DataUsageNotice`：答案下方"本回答用到了"清单
- `SourceCitations`：信息来源折叠卡片
- `ConsentModal`：单独同意弹窗
- `p-privacy_settings` 三个开关 + 数据使用记录入口

**3b 配合工具调用（2 周）**：

- `ToolCallTrace`：可展开"AI 思考过程"
- `CitationPopover`：点击 `[1]` 弹出原文
- `StreamingAnswer`：SSE 流式渲染
- `ModeIndicator`：对话顶部显示当前模式（严格/精确）
- `p-ai_audit` 页面：用户查看历次 AI 调用记录

**验收**：

- 未同意用户：聊天可用，明确说明未使用健康数据
- 基础同意：每次答案显示信息来源 + 用到字段
- 专业同意：UI 醒目标识精确模式，答案附带说明
- 撤回同意立即生效
- 流式体验顺滑

### Phase 4：GraphRAG / Hybrid（远期，3+ 月后启动）

基于 Phase 1 已建好的 `kb_entities` / `kb_relations` 表 + Phase 2 已建好的 `IRetriever` 接口，实现：

- 知识图谱构建管道（LightRAG 或类似方案）
- `GraphRetriever` 实现
- Orchestrator 中加入"路由器"：根据问题类型选择 vector / graph / hybrid

启动条件：

- Phase 1-3 已稳定运行 ≥ 2 个月
- KB 规模足够（≥ 5000 chunks）
- 用户问答中"关系/因果/全局"类问题占比明显
- 有医学顾问可参与本体审校

本期不展开。

---

## 10. 部署架构

### 10.1 服务清单（单机部署）

| 服务                            | RAM          | CPU         | 存储       |
| ------------------------------- | ------------ | ----------- | ---------- |
| Node API + Orchestrator         | 2-3 GB       | 2 核        | -          |
| PostgreSQL + pgvector           | 4-8 GB       | 4 核        | 150 GB     |
| Python embedding 服务（bge-m3） | 2-4 GB       | 2 核        | 10 GB      |
| Python embedded_parser（OCR）   | 1-2 GB       | 2 核        | 10 GB      |
| 上传文件存储（本地或对象存储）  | -            | -           | 100 GB     |
| Docker / 系统开销               | 2 GB         | -           | 30 GB      |
| **合计**                        | **11-19 GB** | **8-10 核** | **300 GB** |

### 10.2 推荐云服务器规格

- 8 核 16 GB + 300 GB SSD
- 参考机型：腾讯云 SA5.2XLARGE16 / 阿里云 ecs.c7.2xlarge
- 月成本约 ¥900-1300

### 10.3 月度运营成本

| 项                                   | 金额                |
| ------------------------------------ | ------------------- |
| 云服务器                             | ¥1000               |
| SiliconFlow LLM API（DeepSeek-V3.1） | ¥200-500            |
| 对象存储 / CDN                       | ¥50-200             |
| 监控 / 备份                          | ¥100                |
| 域名 / SSL                           | ¥10                 |
| **合计**                             | **¥1400-1800 / 月** |

---

## 11. 环境变量

新增或变更的关键 env：

```bash
# 向量库后端
KB_BACKEND=pgvector              # 或 chroma_cloud（回退）

# 嵌入模型
KB_EMBED_MODEL=BAAI/bge-m3
KB_INGEST_BATCH_SIZE=32

# LLM 提供商
LLM_PROVIDER=siliconflow
AI_API_BASE_URL=https://api.siliconflow.cn/v1
AI_API_MODEL=deepseek-ai/DeepSeek-V3.1
AI_API_KEY=...

# 审计与同意
AI_AUDIT_ENABLED=true
AI_CONSENT_REQUIRED=true         # 强制要求用户同意才能用 AI 问答
```

`KB_BACKEND=chroma_cloud` 作为回退选项保留，紧急情况下可一键切回云端。

---

## 12. 数据库变更摘要

| Migration                       | 内容                                                 |
| ------------------------------- | ---------------------------------------------------- |
| `006_pgvector_kb.sql`           | `vector` 扩展、`kb_chunks` 表、ivfflat 索引          |
| `007_kb_entities_relations.sql` | `kb_entities` / `kb_relations`（占位，Phase 4 填充） |
| `008_ai_consent.sql`            | `patient_profiles` 加三档同意字段                    |
| `009_ai_audit.sql`              | `ai_prompt_audit` 审计表                             |

---

## 13. 风险与回滚

| 风险                                            | 概率 | 影响 | 回滚方案                                 |
| ----------------------------------------------- | ---- | ---- | ---------------------------------------- |
| pgvector 召回质量不如 Chroma Cloud              | 低   | 中   | `KB_BACKEND=chroma_cloud` 一键切回       |
| bge-m3 内存压力大                               | 中   | 低   | 临时降回 MiniLM（修改 `KB_EMBED_MODEL`） |
| DeepSeek-V3.1 tool calling 在某些 prompt 下不稳 | 中   | 中   | 退化为硬拼 context 模式（不走工具调用）  |
| PII Redactor 误伤医学有用字段                   | 中   | 中   | 调整 allowlist 与 clinicalize 规则       |
| Orchestrator 延迟过高                           | 中   | 中   | SSE 流式 + retriever 并行优化            |
| 用户对三档同意流程理解困难                      | 中   | 低   | UI 文案打磨 + 引导流程                   |
| 精确模式被滥用                                  | 低   | 中   | 审计日志可查 + 默认 false + 单独同意     |

每个阶段独立可上线，独立可回滚。Phase 1 不依赖 Phase 2，Phase 3 前端在 Phase 2 后端未上线时可先用 stub 数据开发。

---

## 14. 本方案不包含的范围

为避免范围蔓延，明确以下事项**不在本方案内**：

- 自托管 LLM 推理（GPU 投入与运维成本不匹配当前阶段）
- RAGFlow 报告解析集成（保留 embedded_parser，未来单独评估）
- GraphRAG 实际实现（架构留接口，Phase 4 单独立项）
- 知识图谱本体建设（需要长期医学顾问，单独立项）
- NMPA 医疗器械软件注册（产品定位不在辅助诊断）
- 网络安全等保备案（合规层面单独走流程）
- 多语言国际化
- 跨用户聚合数据 retriever（接口预留，实现远期）
- 用户对话历史向量化（远期能力）

---

## 15. 时间表

| 周次 | Phase 1                     | Phase 2                        | Phase 3 |
| ---- | --------------------------- | ------------------------------ | ------- |
| W1   | pgvector + 接口抽象         |                                |         |
| W2   | 迁移 + bge-m3 + ingest 脚本 |                                | 设计 3a |
| W3   | 双轨验证 + 切换 + 初始内容  |                                | 开发 3a |
| W4   |                             | retrievers + LLM provider 抽象 | 上线 3a |
| W5   |                             | 三档同意 + 分级 PII Redactor   |         |
| W6   |                             | orchestrator + tool calling    | 开始 3b |
| W7   |                             | 审计日志 + 集成测试            | 开发 3b |
| W8   |                             | 上线                           |         |
| W9   |                             |                                | 上线 3b |

总周期约 **9 周（2.5 个月）**。

---

## 16. 后续路径

完成本方案后，下列方向可作为后续迭代候选：

- **RAGFlow 报告解析评估**：在 Mac Mini 或独立环境跑 RAGFlow，A/B 对比 DeepDoc 与 embedded_parser 在典型 FSHD 报告上的准确率，决定是否引入
- **GraphRAG 落地（Phase 4）**：基于 LightRAG 或 Microsoft GraphRAG，对医学 KB 抽取实体与关系，实现关系/因果类问答的能力升级
- **自托管 LLM**：当产品交付临床机构或合规要求升级时，部署 vLLM + Qwen2.5-32B 等本地模型，彻底切断推理出网
- **跨用户聚合 retriever**：在患者授权后，提供"和你情况相似的患者通常怎么应对"这类基于群体数据的回答
- **多模态扩展**：集成视觉模型，让用户拍照报告直接问答，跳过 OCR 中间环节

---

## 17. 参考链接

- [docs/ai-chat.md](../ai-chat.md)：当前 AI 问答说明
- [docs/patient-profile.md](../patient-profile.md)：患者档案数据模型
- pgvector：https://github.com/pgvector/pgvector
- bge-m3：https://huggingface.co/BAAI/bge-m3
- DeepSeek-V3.1：https://www.deepseek.com/
- LightRAG（远期 GraphRAG 参考）：https://github.com/HKUDS/LightRAG
