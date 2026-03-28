# @openrd/mobile

Expo 客户端，提供 FSHD 患者场景的移动端体验（iOS / Android / Web）。

## 运行方式

在仓库根目录执行：

```bash
npm install
npm run dev:mobile
```

或在当前目录执行：

```bash
npm install
npm run start
```

## 常用脚本

```bash
npm run start
npm run ios
npm run android
npm run web
npm run lint
npm run test
```

## 环境变量

主要使用：

- `EXPO_PUBLIC_API_URL`（默认 `http://localhost:4000/api`）

配置来源为根目录 `.env`，示例见 [`../../.env.example`](../../.env.example)。

## 目录说明

- `app/`: Expo Router 页面
- `components/`: 可复用组件
- `contexts/`: 全局状态（如认证上下文）
- `lib/api.ts`: API 封装与请求入口
- `assets/`: 图片、字体等静态资源

## 联调建议

1. 启动 API：`npm run dev:api`
2. 启动移动端：`npm run dev:mobile`
3. 先走注册/登录，再验证档案、问答、报告上传流程
