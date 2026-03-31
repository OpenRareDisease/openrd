# 项目文档导航

这个仓库的文档现在分成 3 层：

- 根 [README.md](../README.md)：项目首页，放项目概览、启动方式、常用命令和一级导航。
- `docs/*.md`：专题文档，放运行说明、设计方案、发布材料和历史记录。
- `apps/*/README.md`：子系统文档，放模块边界、脚本和模块内配置。

如果你是第一次接手这个仓库，建议按这个顺序阅读：

1. [项目 README](../README.md)
2. [测试指南](./testing-guide.md)
3. 对应模块 README：
   - [API](../apps/api/README.md)
   - [Mobile](../apps/mobile/README.md)
   - [Report Manager](../apps/report-manager/README.md)

## 1. 当前事实文档

这些文档描述“现在仓库怎么跑、怎么测、怎么发”：

- [测试指南](./testing-guide.md)：本地联调、冒烟、回归、手工验证入口。
- [腾讯云 Docker 上线测试指南](./cloud-tencent-docker.md)：单机部署和上线前检查。
- [智能问答 / AI Q&A](./ai-chat.md)：AI 问答与知识库服务链路。
- [患者档案数据模型](./patient-profile.md)：当前患者档案及子表设计。
- [版本历史 / Changelog](../CHANGELOG.md)：主版本入口与里程碑索引。
- [v2.3.0 发布说明](./releases/v2.3.0.md)：当前工作版本的功能、验证与发布文案。
- [v1.0.0 发布说明](./releases/v1.0.0.md)：`master` 基线版本说明。
- [v2.0.0 发布说明](./release-v2.md)：`v2` 正式切换时的历史里程碑说明。

## 2. 子系统说明

这些文档比根 README 更贴近模块实现：

- [API README](../apps/api/README.md)：环境变量、接口范围、目录结构。
- [Mobile README](../apps/mobile/README.md)：运行方式、移动端环境变量、联调建议。
- [Report Manager README](../apps/report-manager/README.md)：embedded OCR / parser 的定位与可选独立模式。

## 3. 协作与交付

这些文档用于团队协作、版本发布和持续记录：

- [Git 工作流与协作规范](./WORKFLOW.md)
- [发布 / 部署清单](./release-checklist.md)
- [更新记录](./updates.md)

## 4. 产品 / 设计方案

这些文档偏方案、设计和中长期改造，不一定与当前实现完全等价：

- [FSHD 患者自录与长期随访 Agent 文档](./patient-self-followup-agent.md)
- [FSHD 前端重设计要求与提示词](./frontend-redesign-brief.md)
- [平台技术说明](./platform-tech.md)

## 5. 历史归档

这些文档保留阶段性上下文，默认不作为当前事实来源：

- [2025-11-06 开发更新记录](./update-2025-11-06.md)
- [2025-11-14 开发更新记录](./update-2025-11-14.md)

## 维护约定

- 根 `README` 只保留项目总览、启动方式、常用命令和一级入口，不再堆专题细节。
- `docs/README.md` 只做导航，不重复展开每份文档正文。
- `docs/updates.md` 作为持续追加的更新记录；阶段性 release 说明统一归档到 `docs/releases/`，历史保留文件可继续存在。
- 若设计文档与代码行为冲突，以代码、模块 README 和测试文档为准，再回头修正文档。
