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

6. **上传报告（本地存储 + 同步OCR占位）**

   ```bash
   curl -X POST http://localhost:4000/api/profiles/me/documents/upload \
     -H "Authorization: Bearer $TOKEN" \
     -F "documentType=mri" \
     -F "title=MRI影像报告" \
     -F "file=@/absolute/path/to/report.jpg"
   ```

   返回体内包含 `ocrPayload`（占位结果）与 `storageUri`。

7. **查看OCR结果**

   ```bash
   DOC_ID='上一步返回的 document id'
   curl -X GET http://localhost:4000/api/profiles/me/documents/$DOC_ID/ocr \
     -H "Authorization: Bearer $TOKEN"
   ```

8. **预览上传文件**

   ```bash
   curl -X GET http://localhost:4000/api/profiles/me/documents/$DOC_ID \
     -H "Authorization: Bearer $TOKEN" \
     --output /tmp/openrd-report.bin
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
   - 回到“档案”页（`p-archive`）确认姓名/诊断阶段与“最近更新”同步刷新。

5. **前端查看**
   - 登录账号后进入“档案”页（`p-archive`），页面会加载 `/api/profiles/me` 的真实数据：顶部显示姓名/诊断，最近肌力测量列表会同步更新。
   - 若没有档案数据，会提示“去录入”；填完数据录入页后返回档案页即可看到最新内容。

6. **退出登录**
   - 在“设置”页点击“退出登录”，确认后会清空本地 token 并跳回登录页。
   - 刷新或重新进入应用时，应重新要求登录，证明会话状态已统一管理。

> **注**：`npm run lint --workspace @openrd/mobile` 仍受旧文件影响报 “React is defined but never used”，后续会单独清理。\*\*\*

## 新增说明（档案文件闭环）

1. **本地存储目录**
   - API 侧上传文件默认存放在 `apps/api/uploads/`，按用户 ID 分目录。

2. **数据库字段**
   - `patient_documents` 新增 `ocr_payload`（JSONB）字段。
   - 旧库可手动执行：
     ```sql
     ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS ocr_payload JSONB;
     ```

3. **移动端上传验证**
   - 在 `p-data_entry` 的“医疗报告”卡片上传图片，状态应从“上传中...”变为“已上传”。
   - “报告上传历史”应显示 OCR 摘要文案（占位结果）。
