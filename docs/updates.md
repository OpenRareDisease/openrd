# 更新记录（Updates）

> 统一记录项目迭代内容，按日期追加条目；新增版本只需复制下方模板并填写对应信息即可。

---

## 2025-11-16

### 完成事项

1. **用药管理+风险评估**：在 `db/init_db.sql` 新增 `patient_medications` 表；API 增加用药创建/查询与基础风险总结端点（`/api/profiles/me/medications`、`/api/profiles/me/risk`），完善患者档案聚合。
2. **移动端录入联动**：`p-data_entry` 提交时同时写入档案、肌力测量、活动日志、用药信息；新增用药输入区。API 客户端新增活动/用药/风险请求。
3. **病程页数据化**：`p-manage` 加载档案、用药、风险数据，动态展示平均肌力、各肌群最新分数、最近活动时间、基础风险等级与用药清单，增加加载/错误态。

### 验证

```bash
# DB 初始化（需 Postgres 权限）
psql -h localhost -p 5432 -U <user> -d postgres -f db/init_db.sql

# 启动后端
npm run dev:api
# 健康检查
curl http://localhost:4000/api/healthz

# 启动前端（Expo，终端按 w 打开浏览器）
cd apps/mobile && npm run start
# 前端操作：注册/登录 -> 数据录入（姓名/肌力/活动/用药） -> 病程管理/档案页查看数据
```

### 已知问题

- 上传仍为前端模拟，未接真实存储；用药/测量暂无删除编辑。

### 下一步建议

1. 为用药/测量/活动添加删除与编辑能力，并接入 UI。
2. 对风险模型引入更多指标（测试结果、趋势）并补充图表展示。
3. 针对新端点补充 API 集成测试与移动端空态/错误态覆盖。

---

## 2025-11-15

### 完成事项

1. **统一鉴权上下文**
   - 新增 `apps/mobile/contexts/AuthContext.tsx`，集中管理 token、用户信息、初始化状态与退出登录能力。
   - 在 `app/_layout.tsx` 使用 `AuthProvider` 包裹整个应用，确保任意页面都能读取登录状态。
2. **页面联动**
   - 登录/注册页调用 `setSession` 处理 token 保存；设置页使用 `logout` 清理本地状态并跳回登录页，同时展示当前用户信息。
3. **测试文档**
   - `docs/testing-guide.md` 增加“退出登录”步骤，确保 QA 能覆盖新流程。

### 验证

```bash
# 1. 启动后端与 Expo（同前）
# 2. 登录/注册 -> 自动跳首页
# 3. 数据录入 -> 档案页显示真实数据
# 4. 设置页点击“退出登录” -> 返回登录页，再次打开应用需重新登录
```

### 已知问题

- `npm run lint --workspace @openrd/mobile` 仍受旧模板影响报 “React is defined but never used”，待后续 chore 清理。

### 下一步建议

1. 基于 AuthContext 扩展更多入口（首页、顶部用户信息等），增强登录态可见性。
2. 继续完善档案展示页的图表/趋势功能，形成可对外演示的可视化页面。
3. 安排 lint-cleanup 提交，移除多余 `import React` 或调整 ESLint 规则。

---

## 2025-11-14

### 完成事项

1. **移动端 API 封装**
   - 新建 `apps/mobile/lib/api.ts`，集中处理 `fetch`、JWT 存储、通用 `apiRequest` 与错误类型。
   - 提供 `login` / `register` / `upsertPatientProfile` / `addPatientMeasurement` 等方法，供各页面复用。
2. **移动端联调（登录、录入、档案）**
   - `p-login_register` 改为调用真实 `/api/auth/*`，成功后保存 token 并跳转首页。
   - `p-data_entry` 可填写姓名/诊断并提交至 `/api/profiles` 与 `/profiles/me/measurements`。
   - `p-archive` 调用 `/api/profiles/me`，展示姓名、诊断、最近肌力记录，并提供加载/空态/错误状态及“去录入”入口。
3. **忽略临时目录**
   - 更新 `.gitignore`，加入 `tmp/`、`temp/`，并移除仓库中残留的 `tmp/node-compile-cache/*`。
4. **文档整理**
   - 更新 `docs/testing-guide.md` 统一记录 curl 与前端测试流程。

### 验证

```bash
npm run dev --workspace @openrd/api
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+8613900000000","password":"Passw0rd!"}'
TOKEN='上一步返回的 token'
curl -X POST http://localhost:4000/api/profiles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"张三","diagnosisStage":"Stage1"}'
curl -X POST http://localhost:4000/api/profiles/me/measurements \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"muscleGroup":"deltoid","strengthScore":4}'
curl -X GET http://localhost:4000/api/profiles/me \
  -H "Authorization: Bearer $TOKEN"
# 前端：npm run start --workspace @openrd/mobile 然后登录→录入→档案页查看
```

### 已知问题

- `npm run lint --workspace @openrd/mobile` 仍报 20+ 个 “React is defined but never used”，系 Expo 模板遗留导入，后续需要统一清理。

### 下一步建议

1. 抽象全局 Auth 状态（Context/Zustand）并添加“退出登录”。
2. 扩展档案展示页的图表/历史数据，形成可演示的可视化页面。
3. 单独计划 lint-cleanup 提交，移除多余 `import React` 或调整 ESLint 规则。

---

## 2025-11-06

### 完成事项

1. **档案数据模型落地**
   - 编写中英双语设计文档 `docs/patient-profile.md`，明确 `patient_profiles` 及四类子表的字段、索引和迁移计划。
   - 调整 `db/init_db.sql`：扩展 `patient_profiles` 字段、移除旧的 `muscle_strength` JSON、创建唯一索引及子表，触发器改为可重复执行。
2. **后端 API 支撑**
   - 新增 JWT 鉴权中间件 `apps/api/src/middleware/require-auth.ts`。
   - 实现 `apps/api/src/modules/patient-profile/*`，提供档案及子资源 CRUD；`/api/healthz`、`/api/auth` 正常工作。
3. **本地验证**
   - `psql -U jiexiaofang -d postgres -f db/init_db.sql` 同步数据库。
   - 通过 `curl` 注册/登录获取 JWT 并调用 `/api/profiles`、`/api/profiles/me/measurements` 验证数据流通。

### 当前状态

- `git status` 显示主要变动集中在 `docs/patient-profile.md`、`docs/update-2025-11-06.md`、`db/init_db.sql`、患者档案模块源码及鉴权中间件。
- 所有变更经 ESLint 自动修复；暂未补充自动化测试，可后续使用 Vitest + Supertest。

### 后续建议

1. **提交与推送**：在 `feature/patient-profile` 分支提交并推送，创建 PR 时附上测试步骤。
2. **移动端联调**：把 Expo 表单和展示页接到 `/api/profiles` 系列接口（已在 11-14 完成）。
3. **测试与文档**：追加端到端测试，持续在 `docs/updates.md` 与 `docs/testing-guide.md` 记录流程。

---

## 模板（复制后替换日期与内容）

````
## YYYY-MM-DD

### 完成事项
1. …
2. …

### 验证
```bash
…
````

### 已知问题

- …

### 下一步建议

1. …

```

```
