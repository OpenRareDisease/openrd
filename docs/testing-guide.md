# Testing Guide

## 后端 API（命令行）

1. **启动服务**

   ```bash
   npm run dev --workspace @openrd/api
   ```

2. **注册或登录获取 token**

   ```bash
   curl -X POST http://localhost:4000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"phoneNumber":"+8613900000000","password":"Passw0rd!"}'
   ```

   若未注册，将 `login` 替换为 `register`，手机号使用新的号码。

3. **创建/更新档案**

   ```bash
   TOKEN='上一步返回的 token'
   curl -X POST http://localhost:4000/api/profiles \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"fullName":"张三","diagnosisStage":"Stage1"}'
   ```

4. **写入肌力测量**

   ```bash
   curl -X POST http://localhost:4000/api/profiles/me/measurements \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"muscleGroup":"deltoid","strengthScore":4}'
   ```

5. **查看档案**
   ```bash
   curl -X GET http://localhost:4000/api/profiles/me \
     -H "Authorization: Bearer $TOKEN"
   ```

## 移动端（前端）

1. **启动 API（见上）**，确保数据库连通。
2. **启动 Expo**

   ```bash
   npm run start --workspace @openrd/mobile
   ```

   按需在 Web、模拟器或 Expo Go 打开。

3. **注册/登录**
   - 在登录注册页输入手机号+密码（验证码任意），点“注册”或“登录”。
   - 成功后会自动跳转到首页。

4. **数据录入**
   - 打开“数据录入”页（`p-data_entry`），填写姓名、诊断，选择肌群并拖动滑杆，点击“提交数据”。
   - 看到“提交成功”提示后，可在命令行再用 `curl GET /api/profiles/me` 验证。

5. **前端查看**
   - 登录账号后进入“档案”页（`p-archive`），页面会加载 `/api/profiles/me` 的真实数据：顶部显示姓名/诊断，最近肌力测量列表会同步更新。
   - 若没有档案数据，会提示“去录入”；填完数据录入页后返回档案页即可看到最新内容。

> **注**：`npm run lint --workspace @openrd/mobile` 仍受旧文件影响报 “React is defined but never used”，后续会单独清理。\*\*\*
