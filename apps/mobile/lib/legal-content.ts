/**
 * Single source for the user agreement, the privacy policy, and the
 * separate sensitive-personal-information consent.
 *
 * ─────────────────────────────────────────────────────────────────────
 * NOT LEGAL ADVICE — MUST BE REVIEWED BY COUNSEL BEFORE LAUNCH.
 *
 * This is a substantive good-faith draft written against 《个人信息保护法》
 * Art. 17 (disclosure), Art. 29 (单独同意 for 敏感个人信息), Art. 31
 * (minors), Art. 44-50 (data-subject rights) and 《民法典》第1035条, using
 * only facts that are verifiable in this repository: the columns the
 * schema actually stores, the retention windows the code actually
 * enforces (services/audit/retention.ts, ACCOUNT_DELETION_COOLING_DAYS),
 * the recipient the AI client actually calls (AI_API_BASE_URL defaults to
 * https://api.siliconflow.cn/v1), and the screens that actually
 * implement each right. Nothing here has been reviewed by a lawyer.
 *
 * TWO THINGS ARE NOT IN THE REPOSITORY AND MUST BE FILLED IN BEFORE THIS
 * SHIPS TO A REAL USER — both are marked 【待补】 in the text below and
 * exported as the constants directly under this comment:
 *
 *   1. 个人信息处理者的登记名称 — the registered name of the operating
 *      entity (公司 / 社会组织 / 个体工商户) plus its 统一社会信用代码 and
 *      registered address. PIPL Art. 17(1) requires the处理者's name and
 *      contact details; "肌愈通" is a product name, not a处理者.
 *   2. 个人信息保护负责人的机构邮箱 — LEGAL_CONTACT_EMAIL currently points
 *      at the personal Outlook address already published on 关于我们.
 *      A privacy contact on a free personal mailbox is a finding in any
 *      app-store or 网信办 review, and the account is also the recovery
 *      path for the whole 删除/查阅 workflow.
 *
 * A third 【待补】 is factual rather than legal: the contracting entity
 * name of the LLM processor. The repo proves the endpoint
 * (api.siliconflow.cn) and the model (deepseek-ai/DeepSeek-V3) but not
 * which registered company we contract with, and inventing a company
 * name in a disclosure document is worse than leaving the slot open.
 *
 * Also unresolved and worth counsel's attention: whether this deployment
 * needs an ICP 备案 / 网络安全等级保护 filing to name here, and whether
 * the 数据捐赠 flow needs its own separate consent document rather than
 * the toggle it has today.
 * ─────────────────────────────────────────────────────────────────────
 *
 * These texts used to be hardcoded TWICE (the register screen's
 * agreement modal and the about-us screen's), which meant any legal
 * revision had to be applied in two places and could silently drift —
 * the register copy had already grown a data-deletion clause the
 * about-us copy lacked. For a medical-data product the two surfaces
 * disagreeing is a compliance hazard, not a style nit.
 *
 * The SECTIONS arrays are the authority; the flat-text exports are
 * DERIVED from them, so structured consumers (about-us styled blocks)
 * and plain-text consumers (the register modal) can't drift by
 * construction.
 *
 * VERSIONS: every acceptance is recorded server-side against
 * (document, version) — see db/migrations/019 and
 * apps/api/src/modules/legal. When you edit the substance of a document
 * you MUST bump its version here, otherwise the ledger will claim users
 * accepted wording they never saw, which is worse than having no ledger
 * at all. The same identifiers exist in
 * apps/api/src/modules/legal/legal.constants.ts; the two lists are
 * duplicated because there is no shared package between the workspaces,
 * and the API test asserts on the identifier set so a rename cannot go
 * one-sided unnoticed.
 */

/** 【待补】Registered name of the personal-information handler. */
export const OPERATOR_LEGAL_NAME = '【待补：运营主体登记名称】';

/**
 * Privacy contact. Same address 关于我们 already publishes, so a user
 * who found it there and a user who found it here reach the same
 * inbox. See the header note — this should become an entity mailbox.
 */
export const LEGAL_CONTACT_EMAIL = 'ailiyaer201025@outlook.com';

/** Also already published on 关于我们. */
export const LEGAL_CONTACT_PHONE = '18099610336';

export interface LegalSection {
  title: string;
  body: string;
}

/**
 * Document identifiers. These strings are persisted in the acceptance
 * ledger forever — renaming one orphans every historical row, so treat
 * them as immutable once shipped.
 */
export const LEGAL_DOCUMENTS = {
  userAgreement: 'user_agreement',
  privacyPolicy: 'privacy_policy',
  sensitiveData: 'sensitive_data_consent',
  guardianConsent: 'guardian_consent',
} as const;

export type LegalDocumentId = (typeof LEGAL_DOCUMENTS)[keyof typeof LEGAL_DOCUMENTS];

/** Effective date shown inside the documents themselves. */
export const LEGAL_EFFECTIVE_DATE = '2026-08-02';

/**
 * Current version of each document. Bump on every substantive edit
 * (see the VERSIONS note in the file header). Date-stamped rather than
 * semver: the question a compliance reviewer asks is 「用户同意的是哪一天
 * 的文本」, and a date answers it without a lookup table.
 */
export const LEGAL_DOCUMENT_VERSIONS: Record<LegalDocumentId, string> = {
  [LEGAL_DOCUMENTS.userAgreement]: '2026-08-02',
  [LEGAL_DOCUMENTS.privacyPolicy]: '2026-08-02',
  [LEGAL_DOCUMENTS.sensitiveData]: '2026-08-02',
  [LEGAL_DOCUMENTS.guardianConsent]: '2026-08-02',
};

export const USER_AGREEMENT_TITLE = '用户协议';
export const PRIVACY_POLICY_TITLE = '隐私政策';
export const SENSITIVE_DATA_CONSENT_TITLE = '敏感个人信息处理单独同意';
export const GUARDIAN_CONSENT_TITLE = '儿童个人信息处理规则与监护人同意';

/** Document id -> the title the user actually saw, for the 授权记录
 *  list. Keyed by the persisted id rather than by the constant name so
 *  a row written by an older build still renders as words. */
export const LEGAL_DOCUMENT_TITLES: Record<string, string> = {
  [LEGAL_DOCUMENTS.userAgreement]: USER_AGREEMENT_TITLE,
  [LEGAL_DOCUMENTS.privacyPolicy]: PRIVACY_POLICY_TITLE,
  [LEGAL_DOCUMENTS.sensitiveData]: SENSITIVE_DATA_CONSENT_TITLE,
  [LEGAL_DOCUMENTS.guardianConsent]: GUARDIAN_CONSENT_TITLE,
};

const VERSION_LINE = (documentId: LegalDocumentId) =>
  '版本 ' +
  LEGAL_DOCUMENT_VERSIONS[documentId] +
  '，生效日期 ' +
  LEGAL_EFFECTIVE_DATE +
  '。本文本的每一次修订都会更新版本号；你在注册或首次上传报告时同意的版本号会被记录，可在「隐私设置」中查看。';

/**
 * PIPL Art. 31: processing the personal information of anyone under 14
 * requires the guardian's consent AND a dedicated 儿童个人信息处理规则.
 *
 * This is not a formality here. FSHD has juvenile- and infantile-onset
 * forms, so the privacy policy's §8 already tells guardians they must
 * consent on the child's behalf — this is the text that promise points
 * at, and the registration form blocks on it once the entered birth
 * date puts the patient under 14.
 */
export const GUARDIAN_CONSENT_SECTIONS: LegalSection[] = [
  {
    title: '0. 版本与生效日期',
    body: VERSION_LINE(LEGAL_DOCUMENTS.guardianConsent),
  },
  {
    title: '1. 这份规则适用于谁',
    body: '你填写的出生日期显示这位患者不满 14 周岁。按《个人信息保护法》第三十一条，处理不满十四周岁未成年人的个人信息，必须取得父母或者其他监护人的同意，并制定专门的处理规则。这份规则就是它，需要由监护人阅读并同意后才能继续建档。如果出生日期填错了，请返回上一步改正——不要为了跳过这一步而填写错误的日期，出生日期会用于计算病程和与同龄患者的对比。',
  },
  {
    title: '2. 我们会收集儿童的哪些信息',
    body: '与成年患者相同：姓名、出生日期、性别、所在地区、确诊信息与基因检测结果、你上传的检查报告原件及其识别出的文字、肌力测量与功能测试记录、日常活动与用药记录。其中健康与基因信息属于敏感个人信息。我们不会额外收集与病程管理无关的儿童信息，也不会要求提供学校、班级或家庭住址。',
  },
  {
    title: '3. 用来做什么',
    body: '仅用于：向监护人展示这位患儿的病程记录与趋势；在监护人主动提问时，结合报告内容作答；以及在监护人单独同意后，将报告文本交由大模型处理以生成解读。不会用于广告、不会用于自动化决策、不会向第三方出售或共享，法律法规另有规定的除外。',
  },
  {
    title: '4. 谁能看到',
    body: '只有登录该账号的人。我们的运维人员不会主动查阅具体患儿的报告；因排障确需接触时会有操作记录。第三方大模型服务的处理需要监护人在首次上传报告前另行单独同意，未同意则报告不会离开我们的服务器。',
  },
  {
    title: '5. 保存多久',
    body: '与账号共存。监护人可以随时删除单份报告或注销整个账号；注销后患儿的档案、报告原件与识别文本会在冷静期结束后删除，法律要求留存的最小审计记录除外，且其中的身份标识会被脱敏。',
  },
  {
    title: '6. 监护人的权利',
    body: '监护人可以代未成年人行使隐私政策第 7 条列出的全部权利：查阅、复制、更正、删除、撤回同意、注销账号。撤回同意不影响撤回前已经进行的处理。若你发现我们在未取得监护人同意的情况下收集了儿童个人信息，请通过隐私政策第 1 条的联系方式告知，我们会尽快删除。',
  },
  {
    title: '7. 你在同意什么',
    body: '勾选即表示：你是这位未成年患者的父母或其他监护人，你已阅读并理解本规则、《用户协议》与《隐私政策》，并代该未成年人同意我们按上述范围处理其个人信息。这条同意会连同版本号与时间被记录下来。',
  },
];

export const USER_AGREEMENT_SECTIONS: LegalSection[] = [
  {
    title: '0. 版本与生效日期',
    body: VERSION_LINE(LEGAL_DOCUMENTS.userAgreement),
  },
  {
    title: '1. 协议双方',
    body:
      '本协议由你（下称「用户」）与「肌愈通」App 的运营者' +
      OPERATOR_LEGAL_NAME +
      '（下称「我们」）订立。注册前请完整阅读本协议与《隐私政策》；勾选同意即视为你已阅读、理解并接受两份文本的全部内容。你可以不同意，但不同意就无法完成注册。',
  },
  {
    title: '2. 服务内容',
    body: '肌愈通面向面肩肱型肌营养不良症（FSHD）患者及其家属，提供：健康档案与随访记录、肌力与功能测试的录入与趋势分析、检查报告的上传与文字识别（OCR）、基于知识库的智能问答、临床试验信息浏览、患者社区与经验分享。具体功能以你所使用版本的实际界面为准。',
  },
  {
    title: '3. 本服务不是医疗行为（重要）',
    body: '肌愈通不是医疗器械，不提供诊断、治疗方案或用药处方。App 内的分析结论、趋势提示、智能问答回答均为信息参考，可能不完整、不及时甚至出错，不得作为就医决策的唯一依据。任何用药调整、康复训练强度变更、是否就诊或急诊，请遵循你的主诊医生意见。如出现呼吸困难、吞咽呛咳、跌倒外伤等紧急情况，请立即就医或拨打急救电话，不要在 App 内等待回答。',
  },
  {
    title: '4. 账号',
    body: '账号以手机号注册并通过短信验证码验证，仅供你本人（或作为患者监护人的你）使用。请妥善保管密码与验证码；因你主动泄露、转借账号造成的后果由你承担。发现账号异常请立即修改密码并通过第 10 条的联系方式告知我们。',
  },
  {
    title: '5. 你录入内容的真实性',
    body: '健康档案、测试数值、报告文件由你自行录入或上传。请尽量真实、准确——录错的数值会进入你自己的趋势图并被智能问答当作事实引用。错误记录可在记录详情页撤回（软删除），撤回后不再参与任何分析。',
  },
  {
    title: '6. 社区行为规范',
    body: '在社区发布内容时，不得发布违法信息、医疗广告、他人隐私（包括他人的病历、检查报告、住址与联系方式）、以及未经证实的疗法推销。我们可以在收到举报或自查发现违规时删除内容或限制发布权限。',
  },
  {
    title: '7. 智能问答的使用限制',
    body: '智能问答默认关闭。开启后，你的问题会经我们的服务器转发给第三方大模型服务商推理（见《隐私政策》第 5 条），并保留调用审计记录。请不要在提问中输入身份证号、银行卡号、家庭住址等与病情无关的信息。你可以随时在「隐私设置」中关闭该功能。',
  },
  {
    title: '8. 知识产权',
    body: 'App 的软件、界面、知识库整理内容的权利归我们或相应权利人所有。你上传的报告、录入的数据、发布的社区内容，权利仍归你所有；你授权我们在提供本服务所必需的范围内存储与处理这些内容。是否用于科研数据捐赠，由你在「隐私设置」中单独选择，默认关闭。',
  },
  {
    title: '9. 服务变更、中止与账号注销',
    body: '我们可能新增、调整或下线功能。你可以随时在「隐私设置 → 注销账号」申请注销：申请后有 7 天冷静期，期间可随时撤销；冷静期结束后我们会删除你的账号及其名下的档案、测试记录、报告文件。详见《隐私政策》第 7 条。',
  },
  {
    title: '10. 责任限制、适用法律与联系方式',
    body:
      '在法律允许的范围内，我们不对你依据 App 信息作出的医疗决策承担责任；但对我们在处理你个人信息过程中的过错，依《个人信息保护法》承担相应责任。本协议适用中华人民共和国大陆地区法律。有争议先联系我们协商：邮箱 ' +
      LEGAL_CONTACT_EMAIL +
      '，电话 ' +
      LEGAL_CONTACT_PHONE +
      '。',
  },
  {
    title: '11. 协议更新',
    body: '本协议修订后会更新版本号并在 App 内提示。涉及你权利义务实质变更的，会在你下次进入 App 时请你重新确认；你不同意的，可以停止使用并注销账号。',
  },
];

export const PRIVACY_POLICY_SECTIONS: LegalSection[] = [
  {
    title: '0. 版本与生效日期',
    body: VERSION_LINE(LEGAL_DOCUMENTS.privacyPolicy),
  },
  {
    title: '1. 我们是谁，怎么找到我们',
    body:
      '个人信息处理者：' +
      OPERATOR_LEGAL_NAME +
      '（「肌愈通」App 的运营者）。个人信息保护相关事宜的联系方式：邮箱 ' +
      LEGAL_CONTACT_EMAIL +
      '，电话 ' +
      LEGAL_CONTACT_PHONE +
      '。我们承诺在收到你的查阅、复制、更正、删除、撤回同意或注销请求后 15 个工作日内答复。如果你认为我们违法处理了你的个人信息，除了联系我们，你还可以向所在地网信部门投诉举报，或向人民法院提起诉讼。',
  },
  {
    title: '2. 特别提示：本 App 处理敏感个人信息',
    body: '你的疾病诊断、基因检测结果（如 D4Z4 重复数、甲基化比例）、影像与化验报告及其识别文本、肌力与功能测试数值、用药记录，依《个人信息保护法》第 28 条属于「医疗健康」类敏感个人信息；其中基因检测结果同时属于人类遗传资源相关信息。一旦泄露或被非法使用，可能导致你受到歧视（就业、保险、婚育）或人身财产安全受到危害。因此：这些信息的处理需要你的单独同意（第 3 条），你可以随时撤回（第 7 条），撤回不影响撤回前已进行的处理。',
  },
  {
    title: '3. 我们收集哪些信息、为什么收集、保存多久',
    body: [
      '（一）注册与登录',
      '· 手机号【必填】——用于创建账号、短信验证码登录、找回密码、以及在你申请注销时核验身份。保存至账号注销。',
      '· 短信验证码记录（手机号、发送时间、尝试次数）——用于验证与防止短信轰炸。验证码过期后 24 小时内自动删除。',
      '· 身份类型（患者或家属 / 医生 / 其他）——用于展示对应的功能入口。保存至账号注销。',
      '',
      '（二）健康档案【敏感个人信息】【选填，不填不影响登录】',
      '· 姓名 / 称呼、出生日期、性别、身高体重、血型、所在省市区——用于按年龄与体型换算参考区间、按地区推荐就近的诊疗与试验信息。',
      '· 诊断分期、确诊日期、基因突变与基因检测结果、主诊医生——用于生成病程视图与临床护照，并在你开启授权后供智能问答引用。',
      '保存至账号注销，或你在档案页自行删除该字段之时。',
      '',
      '（三）检查报告文件与识别文本【敏感个人信息】【选填】',
      '· 你上传的 MRI / 肌电图、血液化验、呼吸功能、心脏检查等报告的照片或 PDF 原件，及文件名、上传时间、文件校验值。',
      '· 对上述文件做文字识别（OCR）后得到的文本与结构化指标。',
      '用于把纸质报告变成可对比的时间线、在报告详情页高亮异常指标、并在你开启授权后供智能问答引用。OCR 在我们自己的服务器上完成，不外发给第三方识别服务。保存至你在「报告管理」中删除该报告，或账号注销。',
      '',
      '（四）随访与日常记录【敏感个人信息】【选填】',
      '· 肌力评分与测量方式、功能测试（爬楼、10 米步行、起坐、6 分钟步行等）的数值与用时、症状评分、日常生活影响评分、活动与训练记录、用药名称剂量频次与起止日期、随访事件（跌倒、住院、感染等）。',
      '用于绘制趋势、生成风险提示与随访小结。撤回的记录以「墓碑」形式保留（不再参与任何分析与展示），账号注销时一并删除。',
      '',
      '（五）设备与日志信息【自动收集】',
      '· 访问 IP 地址、User-Agent（设备与浏览器型号）、请求时间与接口名称、错误日志。用于登录风控、排查故障、以及记录你同意与撤回同意的时间与来源。',
      '· 智能问答的调用审计（时间、模型名、调用的工具、送出的字段名、成功或失败）。不记录提问原文，只记录提问的哈希值。',
      '安全与操作审计日志保存 180 天后自动删除。',
      '',
      '（六）本机存储',
      '· 登录令牌、未完成的表单草稿、问答历史缓存保存在你的设备本地，不上传。退出登录时清除。草稿从不包含密码或验证码。',
      '',
      '我们不收集你的位置、通讯录、相册全量、通话记录或应用列表。相机与相册权限仅在你主动拍摄或选择报告文件时申请。',
    ].join('\n'),
  },
  {
    title: '4. 我们如何使用这些信息',
    body: '（1）提供你直接要求的功能：保存档案、展示趋势、生成临床护照、回答问题。（2）保障安全：登录风控、限流、审计。（3）改进服务：以聚合统计方式了解功能使用情况，不针对个人。（4）法律要求的留存与配合。我们不做用户画像广告推送，不把你的个人信息用于自动化决策来限制你能使用的功能，也不出售你的个人信息。',
  },
  {
    title: '5. 我们向谁提供、委托谁处理（含第三方名单）',
    body: [
      '我们不会公开披露你的个人信息，也不会向第三方出售。以下是全部对外提供与委托处理的情形：',
      '',
      '· 大模型服务商——硅基流动 SiliconFlow（接入地址 api.siliconflow.cn，运行的模型为 DeepSeek-V3；服务商登记名称与备案信息见【待补：服务商合同主体】）。仅在你开启「第三方 LLM 处理」后生效，默认关闭。开启后，你的提问文本与经脱敏、按授权等级筛选的档案字段会发送给该服务商推理并返回答案。姓名、手机号、身份证号在送出前会被移除；是否送出 D4Z4 重复数等原始数值由你的「精确数值授权」单独控制，默认关闭。该接入点（.cn 域名）位于中国境内，你的信息不因此出境；如果我们将来改用境外接入点，会在改用前依《个人信息保护法》第 39 条重新征得你的单独同意并告知境外接收方。我们与该服务商为委托处理关系，要求其不将数据用于模型训练与其他目的。',
      '· 短信服务商——用于发送登录与注册验证码，只提供手机号与验证码内容，不提供任何健康信息。',
      '· 云服务器与对象存储服务商——为我们提供在中国境内的服务器与文件存储，属于技术承载，不单独访问内容。',
      '· 临床试验机构——仅在你在「隐私设置」中开启「临床试验授权」后，用于入组资格筛查，默认关闭。',
      '· 科研机构——仅在你开启「数据捐赠」后，以去标识化形式提供，默认关闭。',
      '· 医院信息系统——仅在你开启「医院数据同步」后双向同步随访数据，默认关闭。',
      '· 其他患者——仅限你自己在社区主动发布的内容。',
      '· 司法与监管机关——在法律法规明确要求时，按法定程序提供。',
      '',
      '除上述情形外，我们不向境外提供你的个人信息，也没有境外接收方。',
    ].join('\n'),
  },
  {
    title: '6. 我们如何保护这些信息',
    body: '传输使用 HTTPS；密码使用加盐哈希存储，我们无法还原你的原始密码；报告文件存放在权限受限的对象存储中，仅能通过你本人登录后的接口取回；智能问答的提示词在送出前经过姓名、手机号、身份证号的脱敏处理；每一次同意的开启与关闭都有带时间戳的记录。我们的团队规模有限，无法承诺绝对安全；一旦发生个人信息泄露、篡改或丢失，我们会按《个人信息保护法》第 57 条立即采取补救措施，并通过 App 内提示、短信或第 1 条的联系方式通知你与监管部门。',
  },
  {
    title: '7. 你的权利以及在哪里行使',
    body: [
      '· 查阅、复制、可携带——「我的 → 隐私设置 → 导出我的数据」一键导出你全部档案、测试记录与报告清单的结构化文件；「临床护照」可导出可打印的就诊摘要。',
      '· 更正、补充——「档案」页可直接编辑任一字段；数据录入页可修改当次提交。',
      '· 删除——单份报告在「报告管理」中删除；单条随访记录在记录详情中撤回；全部数据随账号注销一并删除。',
      '· 撤回同意——「隐私设置」中的每一个开关都可随时关闭，包括 AI 授权三项与临床试验、数据捐赠、医院同步、社区分享四项。关闭立即生效，不影响关闭前已完成的处理。',
      '· 查看我们对你数据的 AI 使用记录——「隐私设置 → 查看 AI 调用记录」。',
      '· 注销账号——「隐私设置 → 注销账号」。申请后进入 7 天冷静期，期间可随时撤销；冷静期结束后系统自动删除你的账号、档案、测试记录与报告文件。为了证明删除确已执行，我们会保留一条不含你健康信息的注销记录。',
      '· 解释说明——对本政策或我们的处理活动有疑问，可通过第 1 条的联系方式要求解释。',
      '',
      '如果你无法自行操作（例如手部力量不足或账号已无法登录），可以通过第 1 条的邮箱或电话请求我们代为处理，我们会先核验你的手机号再执行。',
    ].join('\n'),
  },
  {
    title: '8. 未成年人',
    body: 'FSHD 存在青少年与婴幼儿起病类型，我们预计会有未成年患者使用本 App。不满 14 周岁的儿童必须由父母或其他监护人阅读本政策并代为同意后才能使用；监护人可以随时代为行使第 7 条的全部权利。如果我们发现在未取得监护人同意的情况下收集了儿童个人信息，会尽快删除。监护人请通过第 1 条的联系方式与我们联系。',
  },
  {
    title: '9. 本政策的更新',
    body: '本政策修订后会更新版本号与生效日期。涉及处理目的、处理方式、信息种类或接收方实质变更的，我们会在 App 内重新征得你的同意；仅文字表述调整的，会在本页更新并保留历史版本供你索取。',
  },
];

/**
 * 单独同意 for sensitive personal information (PIPL Art. 29).
 *
 * Deliberately short and deliberately NOT bundled into the general
 * agreement: Art. 29 requires a separate act of consent for sensitive
 * PI, and「用户在注册时勾选了包含健康信息条款的总协议」is exactly the
 * bundling the article exists to forbid. Shown before the first report
 * upload, which is the first moment health and genetic data would
 * actually leave the user's device.
 */
export const SENSITIVE_DATA_CONSENT_SECTIONS: LegalSection[] = [
  {
    title: '0. 版本与生效日期',
    body: VERSION_LINE(LEGAL_DOCUMENTS.sensitiveData),
  },
  {
    title: '1. 我们将处理哪些敏感个人信息',
    body: '你即将上传的检查报告及其识别文本，以及你在档案与随访中填写的疾病诊断、基因检测结果、肌力与功能测试数值、用药与症状记录，属于《个人信息保护法》第 28 条规定的医疗健康类敏感个人信息，基因检测结果同时涉及人类遗传资源信息。',
  },
  {
    title: '2. 处理目的与必要性',
    body: '处理这些信息是本 App 核心功能所必需：没有报告与测试数值，就无法生成病程趋势、异常指标提示与临床护照。仅用于向你本人提供上述功能，以及你另行开启的授权（智能问答引用、临床试验筛查、科研数据捐赠、医院同步），不用于其他目的。',
  },
  {
    title: '3. 对你的影响',
    body: '健康与基因信息一旦泄露可能导致就业、保险、婚育方面的歧视。我们采取的保护措施见《隐私政策》第 6 条：加密传输、权限受限的存储、送往大模型前的脱敏、以及每一次授权变更的时间戳记录。',
  },
  {
    title: '4. 你可以不同意，也可以随时撤回',
    body: '不同意不影响你使用账号、浏览知识内容与社区；只是无法上传报告与使用依赖报告的功能。同意后可随时在「隐私设置」中撤回，并可随时删除已上传的报告；撤回不影响撤回前已进行的处理。不满 14 周岁的用户须由监护人同意。',
  },
];

const toFlatText = (sections: LegalSection[]): string =>
  sections.map((section) => `${section.title}\n\n${section.body}`).join('\n\n');

export const USER_AGREEMENT_TEXT = toFlatText(USER_AGREEMENT_SECTIONS);
export const PRIVACY_POLICY_TEXT = toFlatText(PRIVACY_POLICY_SECTIONS);
export const SENSITIVE_DATA_CONSENT_TEXT = toFlatText(SENSITIVE_DATA_CONSENT_SECTIONS);
