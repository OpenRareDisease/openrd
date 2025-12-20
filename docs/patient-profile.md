# Patient Profile Data Model

This note captures the V1 modelling decisions for the “基础档案管理” stream. It focuses on the data persisted in PostgreSQL and how the backend/mobile layers will consume it.

## 1. Scope & Goals

- Persist a patient’s longitudinal profile: baseline demographics, diagnosis metadata, day-to-day health data and supporting documents.
- Support the current mobile flows (“档案信息录入/展示”) without blocking future modules (risk modelling, clinical trial matching).
- Keep the schema migration-friendly and auditable.

Out of scope for V1: advanced analytics tables, AI-generated insights, or full-blown document storage (we only store metadata + storage URI).

## 2. Entity Overview

```
app_users (existing)
  │ 1:1
  ▼
patient_profiles ──────┐
  │ 1:N                │
  ▼                    │
patient_measurements   │
  │ 1:N                │
  ▼                    │
patient_function_tests │
  │ 1:N                │
  ▼                    │
patient_activity_logs  │
  │ 1:N                │
  ▼                    │
patient_documents ─────┘
```

- Every `app_users` row may own exactly one `patient_profiles` record.
- Measurements, functional tests, activities and documents are time-series sub-resources tied back to a profile (and therefore a user).
- `audit_logs` (existing) will record mutations; we will add new event types but no schema change is required here.

## 3. Table Definitions

### 3.1 `patient_profiles`

| Column                           | Type                                   | Notes                                                                                  |
| -------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                             | UUID PK (default `uuid_generate_v4()`) | Surrogate key                                                                          |
| `user_id`                        | UUID FK → `app_users.id` (UNIQUE)      | Enforces 1:1 relationship                                                              |
| `full_name`                      | TEXT                                   | Display name                                                                           |
| `preferred_name`                 | TEXT                                   | Optional alias                                                                         |
| `date_of_birth`                  | DATE                                   |                                                                                        |
| `gender`                         | TEXT                                   | Constrained in application layer (`male`, `female`, `non_binary`, `prefer_not_to_say`) |
| `patient_code`                   | TEXT UNIQUE                            | Optional MRN-style identifier                                                          |
| `diagnosis_stage`                | TEXT                                   | FSHD staging value                                                                     |
| `diagnosis_date`                 | DATE                                   |                                                                                        |
| `genetic_mutation`               | TEXT                                   | e.g. “D4Z4 contraction”                                                                |
| `height_cm`, `weight_kg`         | NUMERIC(5,2)                           | Basic vitals                                                                           |
| `blood_type`                     | TEXT                                   |                                                                                        |
| `contact_phone`, `contact_email` | CITEXT                                 | Emergency info                                                                         |
| `primary_physician`              | TEXT                                   |                                                                                        |
| `notes`                          | TEXT                                   | Free-form                                                                              |
| `created_at`/`updated_at`        | TIMESTAMPTZ                            | Trigger-backed timestamps                                                              |

Indexes:

- `patient_profiles_user_id_key` (unique)
- `CREATE INDEX idx_patient_profiles_patient_code ON patient_profiles (patient_code)` (optional lookups)

### 3.2 `patient_measurements`

Captures individual muscle strength scores (0–5) for predefined muscle groups.

| Column           | Type                                              | Notes                                                                          |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `id`             | UUID PK                                           |
| `profile_id`     | UUID FK → `patient_profiles.id` ON DELETE CASCADE |
| `recorded_at`    | TIMESTAMPTZ NOT NULL DEFAULT `NOW()`              |
| `muscle_group`   | TEXT                                              | Application constrains to enum (`deltoid`, `biceps`, `triceps`, `tibialis`, …) |
| `strength_score` | SMALLINT                                          | Range 0–5                                                                      |
| `method`         | TEXT                                              | e.g. `mrc_scale`, `manual_test`                                                |
| `notes`          | TEXT                                              |                                                                                |
| `created_at`     | TIMESTAMPTZ DEFAULT `NOW()`                       |

Indexes:

- `idx_patient_measurements_profile` (`profile_id`, `recorded_at DESC`)
- Optional partial index for fast latest-score lookup: `CREATE INDEX idx_patient_measurements_latest ON patient_measurements (profile_id, muscle_group, recorded_at DESC);`

### 3.3 `patient_function_tests`

Stores timed/quantitative functional assessments (stair climb time, 6MWT, etc.).

| Column           | Type                                              | Notes                                                                |
| ---------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| `id`             | UUID PK                                           |
| `profile_id`     | UUID FK → `patient_profiles.id` ON DELETE CASCADE |
| `test_type`      | TEXT                                              | Enum (`stair_climb`, `six_minute_walk`, `timed_up_and_go`, `custom`) |
| `measured_value` | NUMERIC(10,2)                                     | Generic numeric result                                               |
| `unit`           | TEXT                                              | e.g. `seconds`, `meters`, `score`                                    |
| `performed_at`   | TIMESTAMPTZ DEFAULT `NOW()`                       |
| `notes`          | TEXT                                              |                                                                      |
| `created_at`     | TIMESTAMPTZ DEFAULT `NOW()`                       |

Indexes:

- `idx_patient_function_tests_profile` (`profile_id`, `performed_at DESC`)

### 3.4 `patient_activity_logs`

Daily qualitative notes (voice transcription, manual entry).

| Column       | Type                                              | Notes                                         |
| ------------ | ------------------------------------------------- | --------------------------------------------- |
| `id`         | UUID PK                                           |
| `profile_id` | UUID FK → `patient_profiles.id` ON DELETE CASCADE |
| `log_date`   | DATE NOT NULL DEFAULT `CURRENT_DATE`              |
| `source`     | TEXT                                              | (`manual`, `voice_transcription`, `imported`) |
| `content`    | TEXT                                              |                                               |
| `mood_score` | SMALLINT                                          | Optional 1–5 scale                            |
| `created_at` | TIMESTAMPTZ DEFAULT `NOW()`                       |

Indexes:

- `idx_patient_activity_logs_profile` (`profile_id`, `log_date DESC`)
- Unique constraint `(profile_id, log_date, source)` to avoid accidental duplicates (optional).

### 3.5 `patient_documents`

Metadata for uploaded reports (MRI, genetic, blood tests, etc.).

| Column            | Type                                              | Notes                                                  |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `id`              | UUID PK                                           |
| `profile_id`      | UUID FK → `patient_profiles.id` ON DELETE CASCADE |
| `document_type`   | TEXT                                              | Enum (`mri`, `genetic_report`, `blood_panel`, `other`) |
| `title`           | TEXT                                              | User-facing name                                       |
| `file_name`       | TEXT                                              | Original file name                                     |
| `mime_type`       | TEXT                                              |                                                        |
| `file_size_bytes` | BIGINT                                            |                                                        |
| `storage_uri`     | TEXT                                              | S3/Object storage URI or local path                    |
| `status`          | TEXT                                              | (`uploaded`, `processing`, `failed`)                   |
| `uploaded_at`     | TIMESTAMPTZ DEFAULT `NOW()`                       |
| `checksum`        | TEXT                                              | Optional integrity hash                                |

Indexes:

- `idx_patient_documents_profile` (`profile_id`, `document_type`) for quick filtering.

## 4. Migrations & Seeds

1. Introduce a migration tool (recommended: Knex) in `apps/api`. Store migration scripts under `apps/api/db/migrations`.
2. Migration order:
   - `001_init_core_tables` (existing tables, ported from `db/init_db.sql`).
   - `002_patient_profile_core` (create `patient_profiles` + indexes).
   - `003_patient_profile_children` (create measurements, tests, activity logs, documents).
   - `004_patient_profile_triggers` (attach `set_updated_at` trigger to `patient_profiles`).
3. Provide a seed (`apps/api/db/seeds/001_patient_profiles.ts`) with 1–2 sample profiles, including child records, to support end-to-end tests.
4. Update `db/init_db.sql` to:
   - Call `RUN_MIGRATIONS` placeholder or delegate to migration tool.
   - For compatibility, keep table creation here until migrations are wired, but mark as deprecated once Knex is in place.

## 5. Application-Level Contracts

- Shared validation schemas in `apps/api/src/modules/patient-profile/profile.schema.ts`, exported for both API and mobile (via REST response typing or generated OpenAPI spec).
- Enumerations (`muscle_group`, `test_type`, `document_type`) live in `apps/api/src/modules/patient-profile/profile.constants.ts` and mirrored in the mobile app (`apps/mobile/src/constants/profile.ts`).
- DTO examples:

```ts
interface PatientProfileDTO {
  id: string;
  fullName: string | null;
  dateOfBirth: string | null;
  gender: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say' | null;
  diagnosisStage: string | null;
  diagnosisDate: string | null;
  geneticMutation: string | null;
  measurements: PatientMeasurementDTO[];
  functionTests: PatientFunctionTestDTO[];
  activityLogs: PatientActivityLogDTO[];
  documents: PatientDocumentDTO[];
  updatedAt: string;
}
```

## 6. Auditing & Security

- Reuse `audit_logs` (`event_type`: `patient_profile.created`, `patient_profile.updated`, `patient_profile.measurement.recorded`, etc.) inside service layer transactions.
- Enforce ownership: endpoints should verify the authenticated user owns the profile or has an elevated role (`clinician`, `admin`).
- PII protection: avoid exposing contact details in unauthenticated contexts; restrict document download URIs to signed URLs (future work).

## 7. Next Steps

1. Scaffold Knex (or Prisma) configuration and generate migrations based on the schema above.
2. Implement backend module:
   - `GET /api/profiles/me` returning aggregated DTO.
   - `POST /api/profiles` & `PUT /api/profiles/me` for upsert.
   - Child resource CRUD endpoints (`/measurements`, `/function-tests`, `/activity-logs`, `/documents`).
3. Update mobile data entry page to submit real payloads (map upload states to `patient_documents`).
4. Wire display page to consume the aggregated DTO.
5. Expand automated tests covering ownership checks and data validation.

This document should be kept in sync with future iterations (e.g. when adding risk scores or clinical trial eligibility data).

---

# 患者档案数据模型（中文版）

本文档记录“基础档案管理”阶段的建模决策，聚焦 PostgreSQL 中的存储结构以及后端与移动端的使用方式。

## 1. 目标与范围

- 记录患者的纵向档案：基础信息、诊断数据、日常健康数据与辅助文档。
- 支撑当前“档案录入/展示”的移动端流程，同时为后续模块（风险评估、临床试验匹配等）预留扩展空间。
- 确保模型便于迁移演进并具备审计能力。

本阶段不包含：高级分析表、AI 洞察或完整的文件存储（仅保存元数据与存储 URI）。

## 2. 实体概览

```
app_users (已存在)
  │ 1:1
  ▼
patient_profiles ──────┐
  │ 1:N                │
  ▼                    │
patient_measurements   │
  │ 1:N                │
  ▼                    │
patient_function_tests │
  │ 1:N                │
  ▼                    │
patient_activity_logs  │
  │ 1:N                │
  ▼                    │
patient_documents ─────┘
```

- 每个 `app_users` 只拥有一条 `patient_profiles` 记录。
- 肌力测量、功能测试、活动日志、上传文档均以子资源形式与档案关联。
- `audit_logs` 继续用于记录操作行为，新增事件类型即可，不需改 schema。

## 3. 表定义

### 3.1 `patient_profiles`

| 列名                             | 类型                                   | 说明                                                               |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `id`                             | UUID 主键（默认 `uuid_generate_v4()`） | 替代键                                                             |
| `user_id`                        | UUID 外键 → `app_users.id`（唯一约束） | 保证 1:1 关系                                                      |
| `full_name`                      | TEXT                                   | 姓名                                                               |
| `preferred_name`                 | TEXT                                   | 常用姓名                                                           |
| `date_of_birth`                  | DATE                                   | 出生日期                                                           |
| `gender`                         | TEXT                                   | 应用层限定在 (`male`, `female`, `non_binary`, `prefer_not_to_say`) |
| `patient_code`                   | TEXT UNIQUE                            | 可选的病案号                                                       |
| `diagnosis_stage`                | TEXT                                   | FSHD 分期                                                          |
| `diagnosis_date`                 | DATE                                   | 首次诊断日期                                                       |
| `genetic_mutation`               | TEXT                                   | 基因信息描述                                                       |
| `height_cm`, `weight_kg`         | NUMERIC(5,2)                           | 身高/体重                                                          |
| `blood_type`                     | TEXT                                   | 血型                                                               |
| `contact_phone`, `contact_email` | CITEXT                                 | 联系方式                                                           |
| `primary_physician`              | TEXT                                   | 主治医生                                                           |
| `notes`                          | TEXT                                   | 备注                                                               |
| `created_at`/`updated_at`        | TIMESTAMPTZ                            | 触发器维护时间戳                                                   |

索引：

- `patient_profiles_user_id_key`（唯一约束）
- `CREATE INDEX idx_patient_profiles_patient_code ON patient_profiles (patient_code)`（可选）

### 3.2 `patient_measurements`

记录单次肌力评分（0–5 分）。

| 列名             | 类型                                                | 说明                                                       |
| ---------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| `id`             | UUID 主键                                           |
| `profile_id`     | UUID 外键 → `patient_profiles.id` ON DELETE CASCADE |
| `recorded_at`    | TIMESTAMPTZ 默认 `NOW()`                            |
| `muscle_group`   | TEXT                                                | 应用侧枚举 (`deltoid`, `biceps`, `triceps`, `tibialis` 等) |
| `strength_score` | SMALLINT                                            | 0–5 分                                                     |
| `method`         | TEXT                                                | 测试方法（`mrc_scale` 等）                                 |
| `notes`          | TEXT                                                |                                                            |
| `created_at`     | TIMESTAMPTZ 默认 `NOW()`                            |

索引：

- `idx_patient_measurements_profile` (`profile_id`, `recorded_at DESC`)
- 可选：`idx_patient_measurements_latest` 查询最新记录

### 3.3 `patient_function_tests`

保存功能性评估（如爬楼计时、6 分钟步行）。

| 列名             | 类型                              | 说明                                                            |
| ---------------- | --------------------------------- | --------------------------------------------------------------- |
| `id`             | UUID 主键                         |
| `profile_id`     | UUID 外键 → `patient_profiles.id` |
| `test_type`      | TEXT                              | (`stair_climb`, `six_minute_walk`, `timed_up_and_go`, `custom`) |
| `measured_value` | NUMERIC(10,2)                     | 数值结果                                                        |
| `unit`           | TEXT                              | 单位（秒、米、分数等）                                          |
| `performed_at`   | TIMESTAMPTZ 默认 `NOW()`          |
| `notes`          | TEXT                              |                                                                 |
| `created_at`     | TIMESTAMPTZ 默认 `NOW()`          |

索引：`idx_patient_function_tests_profile` (`profile_id`, `performed_at DESC`)

### 3.4 `patient_activity_logs`

记录日常活动或语音转写。

| 列名         | 类型                              | 说明                                          |
| ------------ | --------------------------------- | --------------------------------------------- |
| `id`         | UUID 主键                         |
| `profile_id` | UUID 外键 → `patient_profiles.id` |
| `log_date`   | DATE 默认 `CURRENT_DATE`          |
| `source`     | TEXT                              | (`manual`, `voice_transcription`, `imported`) |
| `content`    | TEXT                              | 活动内容                                      |
| `mood_score` | SMALLINT                          | 可选，1–5 分                                  |
| `created_at` | TIMESTAMPTZ 默认 `NOW()`          |

索引：

- `idx_patient_activity_logs_profile` (`profile_id`, `log_date DESC`)
- 可选唯一约束 `(profile_id, log_date, source)`

### 3.5 `patient_documents`

保存上传报告的元数据。

| 列名              | 类型                              | 说明                                              |
| ----------------- | --------------------------------- | ------------------------------------------------- |
| `id`              | UUID 主键                         |
| `profile_id`      | UUID 外键 → `patient_profiles.id` |
| `document_type`   | TEXT                              | (`mri`, `genetic_report`, `blood_panel`, `other`) |
| `title`           | TEXT                              | 对外显示名称                                      |
| `file_name`       | TEXT                              | 原始文件名                                        |
| `mime_type`       | TEXT                              |                                                   |
| `file_size_bytes` | BIGINT                            | 文件大小                                          |
| `storage_uri`     | TEXT                              | 对象存储地址                                      |
| `status`          | TEXT                              | (`uploaded`, `processing`, `failed`)              |
| `uploaded_at`     | TIMESTAMPTZ 默认 `NOW()`          |
| `checksum`        | TEXT                              | 校验和                                            |

索引：`idx_patient_documents_profile` (`profile_id`, `document_type`)

## 4. 迁移与种子数据

1. 在 `apps/api` 引入迁移工具（推荐 Knex），迁移脚本放 `apps/api/db/migrations`。
2. 迁移顺序：
   - `001_init_core_tables`（搬运现有核心表）
   - `002_patient_profile_core`（创建 `patient_profiles` 及索引）
   - `003_patient_profile_children`（创建子表）
   - `004_patient_profile_triggers`（挂载更新时间触发器）
3. 在 `apps/api/db/seeds/001_patient_profiles.ts` 准备样例档案与子表数据，方便联调与测试。
4. 更新 `db/init_db.sql`：暂时仍保留表创建逻辑，但标记为待迁移；迁移体系稳定后逐步替换。

## 5. 应用层约定

- 在 `apps/api/src/modules/patient-profile/profile.schema.ts` 编写 Zod 校验；导出给移动端复用或生成 OpenAPI。
- 枚举常量放在 `profile.constants.ts` 中，移动端在 `apps/mobile` 内创建同名常量。
- DTO 示例：

```ts
interface PatientProfileDTO {
  id: string;
  fullName: string | null;
  dateOfBirth: string | null;
  gender: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say' | null;
  diagnosisStage: string | null;
  diagnosisDate: string | null;
  geneticMutation: string | null;
  measurements: PatientMeasurementDTO[];
  functionTests: PatientFunctionTestDTO[];
  activityLogs: PatientActivityLogDTO[];
  documents: PatientDocumentDTO[];
  updatedAt: string;
}
```

## 6. 审计与安全

- 复用 `audit_logs` 记录事件（如 `patient_profile.created`, `patient_profile.measurement.recorded`）。
- 权限：仅档案所有者或具备 `clinician`/`admin` 角色的账户可访问；接口需校验 JWT 所属用户。
- 隐私：避免在未授权场景返回联系方式；文档下载后续需切换为签名链接。

## 7. 下一步

1. 按上述 schema 编写 Knex（或 Prisma）迁移。
2. 实现后端模块：
   - `GET /api/profiles/me` 返回聚合 DTO
   - `POST /api/profiles`、`PUT /api/profiles/me` 处理创建/更新
   - 子资源 CRUD（`/measurements`、`/function-tests`、`/activity-logs`、`/documents`）
3. 移动端录入页接入真实接口，完成上传/保存逻辑。
4. 展示页消费聚合数据并实现图表、列表。
5. 补充自动化测试与权限校验覆盖。

后续若引入风险评分或临床资格等数据，请及时更新本文档。
