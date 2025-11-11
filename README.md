# FSHD-openrd (肌愈通)

[English](./README.en.md)

---

专为 FSHD（面肩肱型肌营养不良症）患者设计的综合性移动应用平台，提供智能问答、动态健康档案、病程管理、患者社区功能和临床试验匹配能力。本仓库现已升级为统一管理移动端与后端服务的 **monorepo**，便于团队协作与持续扩展。

## 🎯 项目概述

FSHD-openrd 是一个以移动端为主的平台，为 FSHD 患者提供自我管理工具、知识获取、社区支持和临床试验参与功能。该应用集成了 AI 驱动的洞察与全面的数据跟踪，提供个性化护理和支持。

## 🛠 技术栈

| 层级     | 技术                             | 说明                                    |
| -------- | -------------------------------- | --------------------------------------- |
| 移动端   | Expo (React Native + TypeScript) | 面向 iOS / Android / Web 的统一代码仓库 |
| 后端 API | Express + TypeScript             | 提供认证、档案、问答等核心 REST API     |
| 数据库   | PostgreSQL                       | 结构化业务数据存储与扩展                |
| 代码规范 | ESLint + Prettier + Husky        | 统一的代码风格和提交校验                |
| 日志     | pino/pino-http                   | 结构化日志输出，便于排错与监控          |

## 📁 Monorepo 目录结构

```
openrd/
├── apps/
│   ├── api/                # TypeScript Express API 服务
│   │   ├── src/            # 应用源码（配置、认证模块等）
│   │   ├── package.json    # 服务依赖与脚本
│   │   └── eslint.config.mjs
│   └── mobile/             # Expo React Native 应用
│       ├── app/            # Expo Router 页面
│       ├── screens/        # 复杂页面的 UI 组件
│       ├── assets/         # 图片、图标、字体
│       └── package.json
├── db/                     # PostgreSQL 初始化脚本与迁移
├── ui/                     # 静态原型页面
├── .husky/                 # Git hooks（pre-commit 运行 lint-staged）
├── .env.example            # 环境变量示例
├── package.json            # 顶层工作区配置及统一脚本
└── prettier.config.cjs     # 项目级代码格式化配置
```

## 🚀 快速开始

### 1. 环境准备

- Node.js ≥ 18
- npm ≥ 10（随 Node 一起安装）
- PostgreSQL ≥ 14
- 可选：Expo Go（移动端调试）

### 2. 克隆与依赖安装

```bash
git clone <仓库地址>
cd openrd
cp .env.example .env          # 根据实际环境调整
npm install                   # 安装 workspace 依赖并初始化 Husky
```

> 如需初始化数据库，可使用 `db/init_db.sql`：
>
> ```bash
> psql -U postgres -f db/init_db.sql
> ```

### 3. 启动服务

| 模块      | 命令                 | 说明                                                        |
| --------- | -------------------- | ----------------------------------------------------------- |
| 后端 API  | `npm run dev:api`    | 在 `http://localhost:4000` 启动开发服务器，暴露 `/api` 路径 |
| 移动端    | `npm run dev:mobile` | 进入 Expo 开发工具，可选择 iOS/Android/Web                  |
| 统一 lint | `npm run lint`       | 运行全部工作区的 ESLint 脚本                                |
| 统一测试  | `npm run test`       | 执行所有工作区内的测试命令                                  |

## 🔐 后端基础能力

后端服务位于 `apps/api`，目前提供：

- `/api/healthz`：基础健康检查，包含数据库连通性探测
- `/api/auth/register`：手机号/邮箱注册，采用 `bcrypt` 存储密码摘要
- `/api/auth/login`：手机号或邮箱登录，返回 JWT 令牌
- 统一日志与错误处理：使用 `pino` 输出结构化日志，并对 API 错误进行集中捕获
- PostgreSQL 连接池：集中初始化并在路由中复用

所有配置项均由 `.env` 管理，可通过 `apps/api/src/config/env.ts` 查看默认值与校验规则。

## 🧭 Git 工作流

- **分支策略**：`main` 保持可部署状态，功能迭代以 `feature/<scope>` 命名
- **提交校验**：提交前自动执行 `lint-staged`（包含 ESLint、Prettier），确保代码质量
- **代码检查**：建议在提交前手动运行 `npm run lint` 与 `npm run test`
- **数据库迁移**：`db` 目录用于保存 SQL 脚本，PR 中需说明对应变更

更多细节请参考 [`docs/WORKFLOW.md`](./docs/WORKFLOW.md)。

## 📄 其他文档

- [系统架构设计文档](./FSHD-openrd-系统架构设计文档.md)
- [产品需求文档](./prd-v2.md)
- [数据库初始化脚本](./db/init_db.sql)

## 📞 支持与反馈

如需技术支持或有关应用的疑问：

- 邮箱：support@fshd-openrd.org
- 社区：加入我们的患者论坛
- 文档：持续更新中的开发规范与 API 文档

---

欢迎为 FSHD 社区、医疗专业人员和开发者贡献力量。请遵循仓库内的开发规范和 Git 工作流，共建可信赖的医疗健康平台。
