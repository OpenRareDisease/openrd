# Git 工作流与协作规范

适用于当前 openrd monorepo 的日常协作流程。

## 分支策略

- `master`：保持可发布状态，仅通过 PR 合入。
- 变更分支：`pr/<scope>`。
- 发布分支（可选）：`release/<version>`。

## 提交流程

1. 同步 `master` 并新建 `pr/<scope>` 分支。
2. 完成开发后本地执行：

```bash
npm run lint
npm run test
```

3. 提交前由 Husky 执行 `lint-staged`。
4. 发起 PR，说明变更点、测试结果、风险与回滚方式。

## PR 最小要求

- 单一主题，不做无关改动。
- 文档与代码同步更新（若行为变化）。
- 涉及数据库时，补充 `db/` 脚本或迁移说明。
- 涉及接口时，补充请求/响应示例或测试步骤。

## 发布建议

1. 代码冻结后切 `release/<version>`（可选）。
2. 回归核心流程：鉴权、档案、问答、报告上传。
3. 更新 README / `docs/release-checklist.md` / `docs/updates.md`。
4. 合并 `master` 后打 tag 并部署。
