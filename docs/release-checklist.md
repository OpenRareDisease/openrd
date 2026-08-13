# 发布 / 部署清单

> 每次发布都要过一遍的通用门禁。版本特定的步骤在 `docs/runbooks/<version>-deploy.md`（当前：[v2.5.0](./runbooks/v2.5.0-deploy.md)）。
>
> **未打勾的项不是「稍后补」，是「不发」。** 这份清单在 v2.4.0 有两项被跳过还照发了（README 版本号、`docs/updates.md` 条目），后果是新人从首页读到的当前版本落后两个 release——一份大家默认可以不勾的清单，保护不了任何东西。

## 0. 版本号与发布材料

**这一节整节是 v2.5.0 新增。** 此前清单里完全没有版本号步骤：bump 全靠记性，而没有任何自动检查会发现 manifest 还停在一个已经打过 tag 的版本上——现在有了 CI，但它跑的是 lint / typecheck / test，**不比对版本号**，所以这一节仍然是人来过。

- [ ] 四个 manifest 的 `version` 已 bump 到本次版本，且四个值一致：
  - `package.json`
  - `apps/api/package.json`
  - `apps/mobile/package.json`
  - `apps/mobile/app.json`（`expo.version`）
- [ ] 根 `package-lock.json` 里那四处 workspace 版本号已同步（跑一次 `npm install --package-lock-only`，不要手改）。
      （`apps/mobile/package-lock.json` 那个残留文件已在 v2.5.0 删除——它自 `1.0.0` 起就没跟过版本。npm workspace 用的是根 lock，仓库里现在只有这一份，不用去找第二个。）
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
- [ ] `OCR_PROVIDER=embedded`。**生产不要用 `baidu`**：那个模式会把患者上传的报告图片 base64 后 POST 给 `aip.baidubce.com`，而隐私政策 §3（三）对患者写的是「OCR 在我们自己的服务器上完成，不外发给第三方识别服务」，§5 的受托方名单里也没有这一家。换过去之前要先改政策文本、把接收方写进 §5、签委托处理协议——不是一个环境变量的决定。`OCR_PARSER_TIMEOUT_MS` 是 300000 而不是 120000（120s 是已知会误杀健康解析的旧值，实测单份要 ~103s）。
- [ ] 四个调参项的耦合已确认：`实例数 × DATABASE_POOL_MAX` < Postgres `max_connections`；`SHUTDOWN_READINESS_DRAIN_MS` < `SHUTDOWN_GRACE_MS` < compose `stop_grace_period`（25s）；`SHUTDOWN_READINESS_DRAIN_MS` > 负载均衡器健康检查间隔（本仓库 Caddy 不做健康轮询，单副本可设 0）；`DATABASE_CONNECT_TIMEOUT_MS` 与托管库的网络延迟相称。
      中间那条**三段不等式**别拆开看：GRACE 是从 t=0 起算的强制退出 deadline，DRAIN 只是推迟 `server.close()` 的等待。DRAIN ≥ GRACE 时 `server.close()` 和 `closePool()` 永远排不上，进程到点被 `process.exit(1)` 打断，正在流式回答的 SSE 从 socket 层被切断，而日志打出来的是「shutdown grace expired with connections still open」——读起来像慢客户端，其实是这两个值设反了。左半边（DRAIN + 1s ≤ GRACE）现在由 env schema 在启动时强制，配错直接起不来；右半边（GRACE < `stop_grace_period`）仍然只有这份清单在管，compose 的值代码读不到。
- [ ] `docker compose --profile prod config -q` 通过（只做插值和校验，不启动任何东西）。

## 2. 构建与启动验证

- [ ] `npm run lint` 通过。
- [ ] `npm run format` 通过（**不要**跳过：仓库里没有 CRLF 问题，prettier 在 master 上是干净的）。
- [ ] `npm test` 通过（API + 移动端两个 workspace）。
- [ ] `python -m pytest apps/report-manager/tests scripts/kb_parsers` 通过，且 **pytest 收到的测试文件数与 `.github/workflows/ci.yml` 里 Test step 上方注释记的那个数一致**：

      ```
      python -m pytest apps/report-manager/tests scripts/kb_parsers --collect-only -q | grep '::' | cut -d: -f1 | sort -u | wc -l
      ```

      这是 collection 的完整性检查，不是装饰：import-mode / conftest 一坏，`scripts/kb_parsers` 整个不被收集，pytest 照样打绿退出 0。

      **不要用 `ls` 数文件**——这一条要抓的是「pytest 收没收」，而 `ls` 数的是「磁盘上有没有」，两回事。实测：往 `scripts/kb_parsers/` 放一个只有 `collect_ignore_glob = ["test_*.py"]` 的 conftest.py，`ls` 在坏树和好树上数出来一样多，`pytest -q` 退出 0，整条检查等于没做；上面那条命令在坏树上只剩 2 个文件。

      末尾的 `N tests collected` 一起看，同样对照 ci.yml 那条注释。**测试数和文件数都只此一份，都在 ci.yml，不要在这里再抄**——两份拷贝会各自漂。两个数都是手工维护的，没有测试在盯着它们：加了测试就把 ci.yml 那两个数一起改；对不上时先确认是不是自己刚加的用例，再怀疑 collection。

      「依赖二进制或依赖语料的用例会自行 skip」只对**开发机**成立。CI 上 `CI=true`，test_docx_parser.py 的 `_CONVERTER_REQUIRED` 和 test_pgvector_reusable_embeddings.py 的 `_DB_REQUIRED` 会把这些 skip 变成 fail——故意的，免得 runner 丢了 LibreOffice 或 pgvector 容器还报绿。语料相关的 census 用例在两边都 skip（语料 gitignore，没有 job ingest 过），除非显式设 `KB_CENSUS_REQUIRED=1`。

- [ ] **release commit 上的 CI 全绿**：`.github/workflows/ci.yml` 的三个 job —— `API (lint, format, typecheck, test)`、`Mobile (lint, typecheck, test, web export)`、`Report manager (pytest)` —— 都是绿的。CI 存在**不代表**上面四条可以跳过：workflow 只在 push / PR 上跑，而 release commit 有可能是本地打完 tag 直接推的。所以本地手工跑 + CI 全绿是两道，不是二选一。
- [ ] `docker compose --profile prod build` 在发布前至少成功过一次。CI 的 mobile job 已经跑 `expo export`（Metro 解析 + 静态渲染都过了），但**镜像本身**——api 镜像里的 Python OCR 依赖、`Dockerfile.kb` 的 ML 依赖、nginx 层——仍然只有真 build 会暴露。
- [ ] `npm run db:migrate:status` 输出符合预期且**退出码为 0**：没有意外的 `pending`，没有 `drifted`（ledger 里的 SHA-256 和磁盘文件对不上），没有 `orphan`（ledger 有行、磁盘没文件；`*_down.sql` 形态的 orphan 会让这条命令直接非零退出，处理办法见 runbook §2.1 的 pre-flight）。这条命令是只读的，可以在生产上放心跑。
- [ ] `npm run db:migrate` 已执行并成功。
- [ ] `docker compose --profile prod up -d --build` 可正常拉起服务。**必须带 `--profile prod`**：不带的话 Caddy 和 MinIO 都不启动——没有对外入口，而且每一次患者上传都会在 connect 阶段 500。
- [ ] 健康检查可用，且语义符合预期：
  - `GET /api/healthz/live`
  - `GET /api/healthz/ready` → 200。`ready` 现在只看 database + embedded OCR；KB 挂了 / warming / 空语料、MinIO 不可达、AI key 未配都走 `degraded` 但 `ready: true`。
  - `GET /api/healthz`（**在宿主机上走 loopback**）→ 检查 `components` 里没有 `error`。从公网调这个端点只会拿到 status，详情进日志 + 一个 `requestId`。
- [ ] **KB 语料非空**：`SELECT count(*) FROM kb_chunks;` 与**源环境当次实测值**一致（不要对手册里的历史数字——语料随 ingest / prune 变动）。全新环境按 runbook §3.5 搬表。
- [ ] **全新环境的首次备份**：`MIN_APP_USERS` 和 `MIN_KB_CHUNKS` 默认都是 1，空库出不了档。首次备份需 `MIN_APP_USERS=0 MIN_KB_CHUNKS=0 npm run db:backup`，之后恢复默认。
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
      `BACKUP_DIR` 必须是**绝对路径**（相对路径直接被拒，因为它会解析到仓库根，把 PHI dump 写进工作区），而且必须在宿主机之外——和 `pg-data` 同一块盘上的 dump 扛不住任何一种真正会发生的故障。脚本自带的闸：`app_users` / `kb_chunks` 低于下限拒绝出档、行数比上一份 dump 跌超 10% 或库名变了就停下（`.dump.meta` 旁挂清单）、先写 `.partial` 再改名、`pg_restore --list` 回读通过后才写清单，且新 dump 比上一份少患者或小 40% 时**跳过**清理旧档。
- [ ] **恢复演练**：本季度至少做过一次 `npm run db:restore -- <dump> --into <空的演练库>` 并核对行数。没被恢复过的备份是一个假设，不是备份。
- [ ] `api-uploads` 卷（`STORAGE_PROVIDER=local` 时）的备份任务在跑，或已确认走 minio。
- [ ] 数据库初始化脚本 / 迁移已执行。
- [ ] 日志不含敏感信息明文。
- [ ] 对外端口与安全组策略已收敛：只放行 80 / 443。不要放行 4000 / 8080 / 5432 / 5010 / 9000。
- [ ] 安全响应头在线上生效：`X-Frame-Options: DENY`、`Content-Security-Policy: frame-ancestors 'none'`（静态站）、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、HSTS。
- [ ] **ICP 备案**：`fshdyouth.com` 的备案号已记录在案，且站点页脚已渲染。
      大陆区域的服务器，未备案域名的 80/443 入站会被拦，Caddy 的 HTTP-01 challenge 一直失败、站点根本起不来，而日志里只有取证循环，看不出原因。
- [ ] **隐私政策**：本次发布的政策文本已声明处理者、联系方式、个人信息清单、目的、**保留期**和接收方（含 LLM 服务商的名字）；且用户接受记录 `(user_id, document, version, accepted_at)` 可查。
      ⚠️ **截至 v2.5.0 这一项仍然未达标，但原因已经换了一个**：文本本身写完了——`apps/mobile/lib/legal-content.ts` 现在是四份成文文档（用户协议 / 隐私政策 / 敏感个人信息处理单独同意 / 儿童个人信息处理规则与监护人同意），点名了 LLM 服务商（硅基流动 SiliconFlow，`api.siliconflow.cn`，DeepSeek-V3）、列了信息清单、目的、保留期和全部接收方；接受记录由 migration 019 的 `legal_document_acceptances` + `POST /api/legal/acceptances` 落库，`(user_id, document, version, accepted_at)` 可查。**卡住这一项的是两个 `【待补】`**：`OPERATOR_LEGAL_NAME`（运营主体登记名称，PIPL 第 17 条第一项要求告知的「个人信息处理者的名称」）和 §5 里的「服务商合同主体」。填这两个要的是营业执照和合同，不是代码——**留在清单里不打勾**，而不是从清单里删掉。
- [ ] **撤回同意的路径与文本一致**：《敏感个人信息处理单独同意》正文承诺「同意后可随时在『隐私设置』中撤回」，PIPL 第 15 条要求提供便捷的撤回方式。发布前**在真机/真浏览器上走一遍**，不要只看代码：隐私设置页能看到自己同意过的文件与版本 → 点「撤回敏感信息处理同意」→ 再去数据录入页写一条健康数据，期望被 403 `sensitive_consent_required` 挡住并重新弹同意书 → 重新同意后能写入。数据库侧确认那一行是被打了 `withdrawn_at` 而不是被删掉（`SELECT document, version, accepted_at, withdrawn_at FROM legal_document_acceptances WHERE user_id = …`）——撤回前已完成的处理是否合法，日后要靠这一行来证明。
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
