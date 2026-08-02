# 发布 / 部署清单

> 每次发布都要过一遍的通用门禁。版本特定的步骤在 `docs/runbooks/<version>-deploy.md`（当前：[v2.5.0](./runbooks/v2.5.0-deploy.md)）。
>
> **未打勾的项不是「稍后补」，是「不发」。** 这份清单在 v2.4.0 有两项被跳过还照发了（README 版本号、`docs/updates.md` 条目），后果是新人从首页读到的当前版本落后两个 release——一份大家默认可以不勾的清单，保护不了任何东西。

## 0. 版本号与发布材料

**这一节整节是 v2.5.0 新增。** 此前清单里完全没有版本号步骤：bump 全靠记性，没有 CI 也没有 hook 会发现 manifest 还停在一个已经打过 tag 的版本上。

- [ ] 四个 manifest 的 `version` 已 bump 到本次版本，且四个值一致：
  - `package.json`
  - `apps/api/package.json`
  - `apps/mobile/package.json`
  - `apps/mobile/app.json`（`expo.version`）
- [ ] 根 `package-lock.json` 里那四处 workspace 版本号已同步（跑一次 `npm install --package-lock-only`，不要手改）。
      （`apps/mobile/package-lock.json` 是个残留文件，自 `1.0.0` 起就没跟过版本，npm workspace 用的是根 lock。要么删掉它，要么就别假装它在跟。）
- [ ] `CHANGELOG.md` 顶部已有本次版本条目。
- [ ] `docs/releases/<version>.md` 已写（如果本次按惯例出 release note）。
- [ ] `README.md` / `README.en.md` 的「当前工作版本」行和发布说明链接已更新。
- [ ] `docs/README.md` 的版本链接已更新。
- [ ] 目标 tag 尚未被占用：`git ls-remote --tags origin | grep <version>` 无输出。
- [ ] bump 放在专门的 pre-tag release commit 里（沿用 `3cedc92` 的做法），不要混进功能分支。

## 1. 配置核对

- [ ] **`NODE_ENV=production`（或 `staging`）已写进目标环境的 `.env`。**
      这一项排在最前面不是排版偏好：`validateProductionEnv` 第一行就是 `if (!env.isProductionLike) return errors;`，非生产模式下**整个生产 fail-fast 块返回空错误列表**，一条日志都不打。少了这一行，下面每一项检查都退化成「祝你好运」——`change-me-super-secret`、`CORS_ORIGIN=*`、`OTP_PROVIDER=mock`、仓库里公开的 KB 占位 token、明文 PHI 数据库连接全部照过。
- [ ] `POSTGRES_PASSWORD` 已设且不是 `postgres`。compose 用 `${POSTGRES_PASSWORD:?…}`，缺它连渲染都过不去；而 `validateProductionEnv` 会独立拒绝任何仍带 `postgres:postgres` 的 `DATABASE_URL`（不看主机名）。
- [ ] `.env` 已按目标环境逐行填写，关键密钥全部替换默认值：`JWT_SECRET` / `OTP_HASH_SECRET`（各 ≥32 字符、≥10 个不同字符，用 `openssl rand -hex 32`）、`KB_SERVICE_TOKEN`、`AI_API_KEY`、OCR 凭据。
- [ ] 生产环境未使用 `OTP_PROVIDER=mock`、`OCR_PROVIDER=mock`、`CORS_ORIGIN=*`。
- [ ] `AI_API_KEY` 或 `OPENAI_API_KEY` 至少有一个非空。（没有它 prod 会干净启动、`ready: true`、健康容器，然后每个患者提问都返回「AI 服务未配置」，而监控看到的是「AI 调用量为 0」——读起来像用量低。）
- [ ] `AI_API_BASE_URL` 仍指向 `.cn` endpoint；若确实要换到境外主机，`AI_CROSS_BORDER_ACKNOWLEDGED=true` 已设，**且**对应的 PIPL 第 38–39 条手续（CAC 安全评估或已备案标准合同、单独同意、载明境外接收方）已经办完。这不是一个改 host 就完事的开关。
- [ ] 存储：`STORAGE_PROVIDER=minio`（推荐），或显式 `STORAGE_ALLOW_LOCAL=true` 并确认你自己有卷备份方案。用 minio 时 `MINIO_USE_HTTPS=true`，除非它就在 compose 内网、并已设 `MINIO_ALLOW_INSECURE=true`。
- [ ] 数据库传输：`DATABASE_SSL_ENABLED=true`（远程 / 托管库必须），或 `DATABASE_ALLOW_INSECURE=true`（compose 内网）二选一显式表态。
- [ ] `WEB_EXPO_PUBLIC_API_URL` 指向目标 API（compose web 服务的 build arg，默认 `/api`，走 Caddy 时就是对的）。
      **`EXPO_PUBLIC_API_URL` 不在仓库根 `.env` 里**——Expo 只解析 `apps/mobile/` 下的 dotenv，根目录那份它从来不读。本地 / EAS 构建看 `apps/mobile/.env`（模板 `apps/mobile/.env.example`）。
- [ ] `OCR_PROVIDER` 已确认，生产默认 `embedded`。`OCR_PARSER_TIMEOUT_MS` 是 300000 而不是 120000（120s 是已知会误杀健康解析的旧值，实测单份要 ~103s）。
- [ ] 四个调参项的耦合已确认：`实例数 × DATABASE_POOL_MAX` < Postgres `max_connections`；`SHUTDOWN_GRACE_MS` < compose `stop_grace_period`（25s）；`SHUTDOWN_READINESS_DRAIN_MS` > 负载均衡器健康检查间隔（本仓库 Caddy 不做健康轮询，单副本可设 0）；`DATABASE_CONNECT_TIMEOUT_MS` 与托管库的网络延迟相称。
- [ ] `docker compose --profile prod config -q` 通过（只做插值和校验，不启动任何东西）。

## 2. 构建与启动验证

- [ ] `npm run lint` 通过。
- [ ] `npm run format` 通过（**不要**跳过：仓库里没有 CRLF 问题，prettier 在 master 上是干净的）。
- [ ] `npm test` 通过（API 48 个测试文件 + 移动端 24 个）。
- [ ] `python -m pytest apps/report-manager/tests scripts/kb_parsers` 通过（13 个 Python 测试文件；依赖二进制的用例会自行 skip）。
      仓库目前**没有 CI**（没有 `.github/workflows`，master 分支保护也没有 required status checks），所以上面四条是唯一的自动化验证，必须人手工跑。装上 CI 之后把这四条换成「release commit 上的 CI 全绿」。
- [ ] `npm run db:migrate:status` 输出符合预期：没有意外的 `pending`，没有 `drifted`（`drifted` = ledger 里的 SHA-256 和磁盘文件对不上）。
- [ ] `npm run db:migrate` 已执行并成功。
- [ ] `docker compose --profile prod up -d --build` 可正常拉起服务。**必须带 `--profile prod`**：不带的话 Caddy 和 MinIO 都不启动——没有对外入口，而且每一次患者上传都会在 connect 阶段 500。
- [ ] 健康检查可用，且语义符合预期：
  - `GET /api/healthz/live`
  - `GET /api/healthz/ready` → 200。`ready` 现在只看 database + embedded OCR；KB 挂了 / warming / 空语料、MinIO 不可达、AI key 未配都走 `degraded` 但 `ready: true`。
  - `GET /api/healthz`（**在宿主机上走 loopback**）→ 检查 `components` 里没有 `error`。从公网调这个端点只会拿到 status，详情进日志 + 一个 `requestId`。
- [ ] **KB 语料非空**：`SELECT count(*) FROM kb_chunks;` 与源环境一致（当前约 12352）。全新环境按 runbook §3.5 搬表。
      kb-service 现在会用 503 + `status: "empty_corpus"` 挡住 readiness，但**在部署前就确认过**比让门禁替你发现要好——一个语料为空的环境在所有其它维度上都是全绿的，而它对每一个 FSHD 患者说文献里查不到。

## 3. 核心流程冒烟

- [ ] 注册 / 登录（含 OTP 发送与校验）。
- [ ] 档案创建 / 更新 / 查询。
- [ ] 测量、活动、用药写入和读取。
- [ ] 报告上传与 OCR 状态查询。**含一份接近 10 MB 上限的扫描件**（上传超时按体积计算，此前是死的 60s，接近上限的文件重试多少次都传不完）。
- [ ] **OCR 抽检**：拿几份结论已知的真实报告跑一遍，人工核对关键字段（D4Z4 重复数、EcoRI 片段长度、MRC 评分、CK 值）。
      生产 OCR 是 **Tesseract-only**（`OCR_DISABLE_PADDLE=true`，paddleocr 不在任何一个安装的 requirements 里），而解析流水线当初是围绕 PaddleOCR 写和调的。这一层的失败模式是「一条静默错误的病历」，不是报错，所以只有人眼抽检能发现。启动日志里的 `OCR engine (resolved): …` 会告诉你当前实际跑的是哪个引擎。
- [ ] AI 问答与进度轮询。
- [ ] AI 主模型链路已验证可用，不是 fallback 假通过。
- [ ] **失败路径也过一遍**：停掉 kb-service 再提问 → 回答降级但站点照常、`/healthz/ready` 仍 200；同一出口 IP 的两个账号互不影响限流额度。
- [ ] **前端不白屏**：临时让某页面 throw，确认看到中文兜底页而不是空白 SPA。

## 4. 数据与安全

- [ ] **迁移前备份已完成并通过回读校验**：`BACKUP_DIR=/mnt/offsite/… npm run db:backup`。
      `BACKUP_DIR` 必须在宿主机之外——和 `pg-data` 同一块盘上的 dump 扛不住任何一种真正会发生的故障。脚本自带三道闸：语料为空拒绝出档、先写 `.partial` 再改名、`pg_restore --list` 回读通过后才允许清理旧档。
- [ ] **恢复演练**：本季度至少做过一次 `npm run db:restore -- <dump> --into <空的演练库>` 并核对行数。没被恢复过的备份是一个假设，不是备份。
- [ ] `api-uploads` 卷（`STORAGE_PROVIDER=local` 时）的备份任务在跑，或已确认走 minio。
- [ ] 数据库初始化脚本 / 迁移已执行。
- [ ] 日志不含敏感信息明文。
- [ ] 对外端口与安全组策略已收敛：只放行 80 / 443。不要放行 4000 / 8080 / 5432 / 5010 / 9000。
- [ ] 安全响应头在线上生效：`X-Frame-Options: DENY`、`Content-Security-Policy: frame-ancestors 'none'`（静态站）、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、HSTS。
- [ ] **ICP 备案**：`fshdyouth.com` 的备案号已记录在案，且站点页脚已渲染。
      大陆区域的服务器，未备案域名的 80/443 入站会被拦，Caddy 的 HTTP-01 challenge 一直失败、站点根本起不来，而日志里只有取证循环，看不出原因。
- [ ] **隐私政策**：本次发布的政策文本已声明处理者、联系方式、个人信息清单、目的、**保留期**和接收方（含 LLM 服务商的名字）；且用户接受记录 `(user_id, document, version, accepted_at)` 可查。
      ⚠️ **截至 v2.5.0 这一项是未达标的**：`apps/mobile/lib/legal-content.ts` 仍是五条一句话的占位文本，没有任何表记录谁接受过哪个版本。第三方 LLM 的单独同意开关存在且默认关闭（`ai_consent_events`），但没点名接收方。这是独立的产品 / 法务工作，不是技术部署项——**留在清单里不打勾**，而不是从清单里删掉。
- [ ] 代码里的保留期与政策文本一致：`otp_verification_codes` / `auth_otps` 过期后 24 小时，`audit_logs` / `ai_prompt_audit` 180 天（见 `apps/api/src/services/audit/retention.ts`）。**改这些数字就要在同一个 commit 里改政策文本**——保留期是对外承诺，不是每次部署可调的旋钮。

## 5. 发布交付

- [ ] README（中 / 英）已同步：具体指 `README.md:7` 附近的版本行 + 发布说明链接、`README.en.md` 同两处、`docs/README.md` 的版本链接。（写成三个明确路径是因为「已同步」这句话在 v2.4.0 被勾过一次，而三处都没改。）
- [ ] `docs/testing-guide.md` 与线上版本一致。
- [ ] `docs/updates.md` 已记录本次发布变化。
- [ ] `docs/runbooks/<version>-deploy.md` 已写，且**对着当前代码树核对过**，不是复制上一版改个版本号：必填 env 表、迁移范围、compose 命令、回滚步骤四项每次都会漂。
- [ ] **移动端分发**：默认无独立步骤——`docker compose --profile prod up -d --build` 已经重新导出并发布了 Expo web bundle，患者刷新页面即得新版本。
      仓库产不出原生包（没有 `apps/mobile/android` / `ios`，没有 EAS project 链接，`expo-updates` 不在依赖里）。**真的启动商店分发时，把这一项换成逐商店的清单**，并同步 `apps/mobile/eas.json` 的 `submit` 配置和 `app.json` 的 `buildNumber` / `versionCode` 策略——在那之前不要在任何计划里为商店审核排期。
- [ ] 回滚方案已准备。本栈的回滚是 **git tag 重建**（`git checkout <上一个 tag> && docker compose --profile prod up -d --build`），不是换 image tag——三个自建服务没有 `image:` 键。数据回滚见 runbook §4。
- [ ] 回滚前置条件已确认：如果本次有破坏性迁移，回滚步骤和数据存档 SQL 已经写在 runbook §4.1 里，而不是发布当天现想。
