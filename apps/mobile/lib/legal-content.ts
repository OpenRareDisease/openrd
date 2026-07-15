/**
 * Single source for the user agreement + privacy policy texts.
 *
 * These used to be hardcoded TWICE (the register screen's agreement
 * modal and the about-us screen's), which meant any legal revision
 * had to be applied in two places and could silently drift — for a
 * medical-data product the two surfaces disagreeing is a real
 * compliance hazard, not a style nit.
 */
export const USER_AGREEMENT_TITLE = '用户协议';
export const PRIVACY_POLICY_TITLE = '隐私政策';

export const USER_AGREEMENT_TEXT = `1. 服务条款

欢迎使用FSHD-openrd应用程序。在使用本应用前，请仔细阅读并理解本用户协议。

2. 服务内容

本应用为FSHD患者提供健康管理、知识查询、社区交流等服务。

3. 用户责任

用户应确保提供真实、准确的个人信息，并妥善保管账户密码。

4. 隐私保护

我们严格保护用户隐私，具体请查看《隐私政策》。

5. 免责声明

本应用提供的信息仅供参考，不构成医疗建议，请在专业医生指导下使用。`;

export const PRIVACY_POLICY_TEXT = `1. 信息收集

我们收集您提供的个人信息和使用数据，用于提供更好的服务。

2. 信息使用

您的信息仅用于应用功能实现，不会用于其他商业目的。

3. 信息保护

我们采用行业标准的安全措施保护您的个人信息。

4. 信息共享

未经您同意，我们不会与第三方分享您的个人信息。

5. 数据删除

您可以随时申请删除账户和相关数据。`;
