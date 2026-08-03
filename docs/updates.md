# 更新记录（Updates）

> 统一记录项目迭代内容，按日期追加条目；新增版本只需复制下方模板并填写对应信息即可。

---

## 2026-08-02（v2.5.0 待发布）

> 本文件在 v2.4.0（2026-06-20 发布）时漏记了一次。`docs/release-checklist.md` §5 一直要求「已记录本次发布变化」，那一次勾了但没写——这条补记同时把 v2.4.0 的缺口一并说明。

### 完成事项

1. **v2.4.0 补记**：AI 患者问答完整链路上线（本地 pgvector 知识库 + orchestrator + 三档隐私同意 + 移动端 SSE 流式回答 + 引用与审计），patient profile 重写与 OCR `document_type` 规范化（migration 011/012），12 个 PR 的多轮安全审计闭合。详见 `docs/releases/v2.4.0.md`。
2. **v2.5.0 主线：88 条 deploy-readiness finding 闭合**。没有新的患者侧功能面，全部是「测试全绿」到「生产能跑」之间那一层：
   - 生产 fail-fast 补齐六道闸门（AI key 缺失、`postgres:postgres` 凭据、密钥强度、Baidu OCR 凭据、跨境 `AI_API_BASE_URL`、本地磁盘存储与明文 MinIO），新增三个显式确认位 `AI_CROSS_BORDER_ACKNOWLEDGED` / `STORAGE_ALLOW_LOCAL` / `MINIO_ALLOW_INSECURE`。
   - compose 收口：`DATABASE_URL` 改插值（此前 operator 填的托管库连接串被静默丢弃）、`POSTGRES_PASSWORD` 强制必填、`minio` 加入 `prod` profile、每服务 `mem_limit` + 日志上限、api `stop_grace_period: 25s`、kb-service 撤掉 `env_file`（它此前持有 `JWT_SECRET`、OTP 密钥和短信/AI 凭据）。
   - readiness 与健康端点：`ready` 只看 database + embedded OCR，KB / 对象存储 / 未配置的 AI key 走 `degraded`；生产下 `/api/healthz` 对非 loopback 调用方只返回 status，详情进日志并回 `requestId`。
   - 数据库：迁移 013–020；`migrate --down <id>` 把 `_down.sql` 与 ledger 删除放进同一事务；015 先把患者填的 `unit` 原文存进 `unit_legacy` 再归一化；迁移跑在 advisory lock 里并记录 SHA-256 以便 `--status` 报 `drifted`。
   - 备份成为代码：`scripts/db-backup.sh` / `scripts/db-restore.sh`（`npm run db:backup` / `db:restore`），带空语料闸、归档回读校验、非空目标拒绝覆盖。
   - 保留期与删除权：四张此前无界增长的表接入定期清理；账号注销时对 `audit_logs` 做 tombstone（保留合规证据，剥离手机号 / 邮箱 / IP）。
   - 客户端：根 ErrorBoundary 中文兜底页替代白屏；上传超时按体积计算；移除向任意父框架广播路由与 `documentId` 的 `postMessage`，并在 nginx 与 Caddy 两处补齐 `frame-ancestors 'none'` 等安全响应头。
   - Python 层：kb-service 多线程 + 有界检索信号量、空语料挡 readiness、SIGTERM 处理、`/multi` 参数钳制、HF 镜像默认；PDF OCR 页数上限并流式落盘；实际使用的 OCR 引擎（Tesseract）现在可见。
3. **合规层从占位文本变成实现**：`apps/mobile/lib/legal-content.ts` 写出四份成文文档（用户协议、隐私政策、敏感个人信息处理单独同意、儿童个人信息处理规则与监护人同意），点名 LLM 服务商与全部接收方、列出信息清单 / 目的 / 保留期；migration 019 建 `legal_document_acceptances` 记录 `(user_id, document, version, accepted_at)`，`GET/POST /api/legal/acceptances` 读写；服务端 `requireSensitiveDataConsent` 挡在报告上传与健康数据写入路由前面，`requireGuardianConsentForMinor` 用服务器时钟重算年龄挡住未满 14 岁的建档；migration 020 加 `withdrawn_at` + `POST /api/legal/acceptances/withdraw`，隐私设置页可以看到自己同意过的版本并撤回敏感信息处理同意——撤回是打墓碑而不是删行，因为「撤回不影响撤回前已进行的处理」这句话要能被证明。
4. **接入 CI**：`.github/workflows/ci.yml` 三个 job —— API（lint / format / typecheck / test）、Mobile（lint / typecheck / test / web export）、Report manager（pytest）——Node 固定 20、Python 固定 3.11，与两个镜像一致；mobile job 用和 `Dockerfile.web` 相同的命令跑 `expo export`，Metro 解析与静态渲染因此有了门禁。仍**不覆盖** `docker compose build`（镜像里的 Python / ML 依赖只有真 build 会暴露）。
5. **文档按当前代码树重写**：新增 `docs/runbooks/v2.5.0-deploy.md`；`docs/release-checklist.md` 补齐版本号、`NODE_ENV`、备份、语料、隐私政策、备案等门禁；`docs/cloud-tencent-docker.md` 标注为不适用于生产；`docs/proposals/prd-v2.md` 标注交付渠道现状（只有 web export，产不出原生包）；v2.4.0 手册加了 superseded 横幅并逐条列出它对当前代码树的失真之处。

### 验证

```bash
npm run lint
npm run format
npm test
python -m pytest apps/report-manager/tests scripts/kb_parsers
docker compose --profile prod config -q
```

### 已知问题

- 法律文本已成文，但 `OPERATOR_LEGAL_NAME`（运营主体登记名称）和 §5 的「服务商合同主体」仍是 `【待补】`。PIPL 第 17 条要求告知处理者名称，所以 `docs/release-checklist.md` §4 的隐私政策项仍不打勾——卡住它的是营业执照和合同，不是代码。
- 隐私政策 §7 把「导出我的数据」和「注销账号」的路径写成「我的 → 隐私设置 → …」，实际两个控件都在「我的」页自己的「数据与账号」分组里，隐私设置页没有。功能可用，路径写错一跳。
- CI 不跑 `docker compose build`：web bundle 有 `expo export` 门禁了，但三个镜像（api 的 Python OCR 依赖、kb 的 ML 依赖、web 的 nginx 层）第一次被构建仍然是在部署机上。
- `.env.example` 的 `DATABASE_URL` 现在是注释掉的（本地直跑与 compose 需要不同主机名，注释掉才能一份模板两边可用）。手工取消注释并填 `localhost` 再跑 compose 会被 `validateContainerTopologyEnv` 在启动时拒绝——这是有意的兜底，不是缺陷。
- KB 源语料（547 MB）仍是单机单点，未纳入常规备份。

### 下一步建议

1. 补齐两个 `【待补】`（运营主体登记名称、服务商合同主体），把清单 §4 的隐私政策项打勾——这两个填完之前，其余合规实现都不足以让那一项达标。
2. 在 master 打开 required status checks，并给 CI 补一个 `docker compose build` 的镜像构建 job——现在 CI 绿只代表 web bundle 能导出来，不代表镜像能构建出来。
3. 把 KB 源语料纳入 `scripts/db-backup.sh` 之外的对象存储备份。

---

## 2026-03-29

### 完成事项

1. 完成 `report-manager` 与主仓库整合，启用 embedded OCR / parser，新增 FSHD 专病结构化抽取、标准化摘要和报告详情页展示链路。
2. 完成患者随访扩展能力，包括 submission、symptom score、daily impact、follow-up event、clinical passport、报告聚合视图和首页/病程页入口调整。
3. 完成上线前安全与运维收口，包括日志脱敏、鉴权/AI 限流、登录失败锁定、生产 env fail-fast、移动端 `expo-secure-store` 接入。
4. 完成 AI 与知识库链路联调，切换到可用模型，验证 AI 问答、报告摘要、KB readiness / warmup 与 fallback 行为。
5. 完成 Docker 部署收口，修复 API 镜像迁移路径、容器 bootstrap 冲突、KB 冷启动缓存，并同步中英 README、测试文档和发布清单。

### 验证

```bash
npm run build --workspace @openrd/api
npx tsc --noEmit -p apps/mobile/tsconfig.json
docker compose config
POSTGRES_PORT=5433 docker compose up -d --build --remove-orphans
RUN_AI_TESTS=1 bash scripts/smoke-test.sh
RUN_AI_TESTS=1 bash scripts/latest-test.sh
```

### 当前结论

- 当前仓库已达到 GitHub `v2.0.0` release 候选状态。
- 代码、Docker、数据库迁移、AI 与 KB 主链路均已实际联调通过。
- 正式公网部署前仍需替换生产环境密钥、短信通道、CORS 域名等运行参数。

### 下一步建议

1. 以 `release/v2` 或当前稳定分支提交本次改动并打 `v2.0.0` tag。
2. 生成生产 `.env`，替换默认密钥和 mock 配置。
3. 若面向公网生产，继续规划对象存储、反向代理、HTTPS 和备份策略。

## 2026-03-17

### 完成事项

1. 系统性核对仓库文档与当前代码结构，重写根 README（中/英）并补充文档导航。
2. 更新子模块文档：`apps/mobile/README.md`、`apps/api/README.md`、`apps/report-manager/README.md`，统一为 monorepo 使用方式。
3. 更新协作与交付文档：`docs/WORKFLOW.md`、`docs/testing-guide.md`、`docs/release-checklist.md`，移除过期说明并校正命令。
4. 新增 `docs/README.md` 作为文档索引入口。

### 验证

```bash
npm run lint
```

- 结果：通过（API 与 mobile lint 均可执行）。

### 备注

- `apps/api` 当前无 Vitest 用例文件，`npm run test --workspace @openrd/api -- --run` 会因无测试文件返回非零。
- `apps/mobile` `npm run test` 默认是 watch 模式，CI 需额外传参。

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

- `git status` 当时的主要变动集中在 `docs/patient-profile.md`、`db/init_db.sql`、患者档案模块源码及鉴权中间件。
- 所有变更经 ESLint 自动修复；暂未补充自动化测试，可后续使用 Vitest + Supertest。

### 后续建议

1. **提交与推送**：在对应功能分支提交并推送，创建 PR 时附上测试步骤。
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
