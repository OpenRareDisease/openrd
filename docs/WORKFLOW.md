# Git 工作流与协作规范

本指南用于协调 FSHD-openrd 团队协作，确保代码库在多人开发时保持稳定、可维护。

## 分支策略

- `main`：随时保持可部署状态，仅通过 Pull Request 合并。
- `develop`（可选）：复杂迭代可以在此进行集成测试，再合入 `main`。
- 功能分支：`feature/<scope>`，例如 `feature/auth-service`、`feature/mobile-theme`。
- 修复分支：`fix/<scope>`，例如 `fix/login-crash`。
- 预发布分支：`release/<version>`，用于发布前的集中验收。

## 提交流程

1. 从最新的 `main` 拉取代码：`git checkout main && git pull`。
2. 新建分支：`git checkout -b feature/<scope>`。
3. 开发过程中保持 commit 原子化，并撰写清晰的提交信息。
4. 在提交前运行：
   - `npm run lint`
   - `npm run test`
5. 提交时触发 Husky 的 `pre-commit` 钩子，自动执行 `lint-staged`。
6. 提交 Pull Request 时附带：
   - 变更概述
   - 测试项及结果
   - 数据库或 API 变更说明（如有）

## 代码规范

- 统一使用 TypeScript。
- 遵循 ESLint + Prettier 规则，避免手动格式化。
- 前端遵循组件拆分原则：页面 → 组件 → UI 元素。
- 后端遵循模块化目录结构：`config`、`modules/<domain>`、`middleware`、`utils`。
- 严格区分业务日志与错误日志，敏感信息不得写入日志。

## 版本控制建议

- 每个 PR 限制在单一主题，避免“大杂烩”合并。
- 避免直接向 `main` 推送，必须通过 PR 审核。
- 使用标签记录里程碑，如 `v0.1.0-alpha`。
- 保持 `TODO.md` 的任务状态同步更新。

## 发布流程（建议）

1. 创建 `release/<version>` 分支，冻结新特性。
2. 运行完整的自动化测试和冒烟测试。
3. 更新版本号、变更日志、文档。
4. 经审核后合并至 `main` 并打 tag。
5. 部署至目标环境并监控。

---

遵循上述流程可以显著提升团队协作效率，减少回归风险。如需补充或调整规范，请在 PR 中提出建议。
