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

**配置文件是本目录下的 `apps/mobile/.env`，不是仓库根目录的 `.env`。**

Expo 的 dotenv 加载器只在 _project root_（即 `app.json` 所在目录，也就是
`apps/mobile`）下找 `.env`。根目录那份是给 API 和 docker compose 用的，
Expo 从来不读它——按旧文档在根目录设 `EXPO_PUBLIC_API_URL` 再
`npm run dev:mobile` / `npx expo export`，打出来的包里根本没有 API 地址。

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

变量清单和取值说明见 [`.env.example`](./.env.example)。常用的两类：

- `EXPO_PUBLIC_API_URL`：API 基址（含 `/api` 前缀）。本地开发不设时
  `lib/api.ts` 回退到 `http://localhost:4000/api`；但 `NODE_ENV=production`
  的构建下没设会在模块加载时直接抛错，让配错的发布在首次启动就暴露，
  而不是让患者的手机静默地去连一个不存在的 localhost。
- `EXPO_PUBLIC_ENABLE_EXPLORE` / `EXPO_PUBLIC_ENABLE_PERSONALIZATION`：
  构建期特性开关，默认关（见 `lib/feature-flags.ts`）。

所有 `EXPO_PUBLIC_*` 都会被内联进 bundle，等同于公开信息，不要放密钥。

Docker web 镜像不走这个文件：`Dockerfile.web` 用构建参数
`EXPO_PUBLIC_API_URL`（默认 `/api`，即 Caddy 后的同源路径），由
`docker-compose.yml` 的 `WEB_EXPO_PUBLIC_API_URL` 提供。

## 版本号与打包标识

`app.json` 里有两套版本号，改的时候不要混：

- `expo.version`是给人看的市场版本，跟仓库其他 manifest 一起在
  发版提交里统一 bump。
- `ios.buildNumber` / `android.versionCode` 是构建计数器，每提交一次商店
  包就要 +1，跟市场版本无关。安卓各应用商店的升级判定看的是
  `versionCode`，重复的包会被直接拒收。

`ios.bundleIdentifier` / `android.package` 固定为 `com.fshdyouth.jiyutong`，
`scheme` 为 `jiyutong`。这三个一旦提交过商店就不能再改——改了等于换一个
应用，已有的深链也会失效。

## 原生构建（eas.json）

当前实际在跑的发行物只有一个：`Dockerfile.web` 的 web 导出，由
`docker compose --profile prod up -d --build` 发布。`eas.json` 在这里是把
版本策略写进仓库、让人能 review，不代表已经有商店发布流程——仓库里没有
EAS 项目绑定（`app.json` 没有 `extra.eas.projectId`），`eas-cli` 也不是
依赖，真要用得先 `npx eas-cli login && npx eas init`。

三个 profile：

| profile       | 用途     | 说明                                   |
| ------------- | -------- | -------------------------------------- |
| `development` | 本机联调 | development client，API 指向 localhost |
| `preview`     | 内部分发 | 安卓出 APK，直接装机                   |
| `production`  | 商店包   | 安卓出 AAB，`autoIncrement` 自动进位   |

`cli.appVersionSource` 设为 `local`：构建号的真值在 `app.json`（上一节的
`buildNumber` / `versionCode`），`autoIncrement` 会在 production 构建时改写
它并留在 diff 里。设成 `remote` 的话计数器搬到 EAS 服务端，`app.json` 里的
值就变成没人看的死配置——那正是这份文件想避免的情况。

`submit` 段故意留空：商店账号、签名密钥、审核主体都还没有定，凭空写一份
配置只会让人以为它验证过。

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
