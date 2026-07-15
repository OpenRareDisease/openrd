/**
 * Single source for the user agreement + privacy policy texts.
 *
 * These used to be hardcoded TWICE (the register screen's agreement
 * modal and the about-us screen's), which meant any legal revision
 * had to be applied in two places and could silently drift — the
 * register copy had already grown a data-deletion clause the
 * about-us copy lacked. For a medical-data product the two surfaces
 * disagreeing is a compliance hazard, not a style nit.
 *
 * The SECTIONS arrays are the authority; the flat-text exports are
 * DERIVED from them, so structured consumers (about-us styled
 * blocks) and plain-text consumers (the register modal) can't drift
 * by construction.
 */
export interface LegalSection {
  title: string;
  body: string;
}

export const USER_AGREEMENT_TITLE = '用户协议';
export const PRIVACY_POLICY_TITLE = '隐私政策';

export const USER_AGREEMENT_SECTIONS: LegalSection[] = [
  {
    title: '1. 服务条款',
    body: '欢迎使用FSHD-openrd应用程序。在使用本应用前，请仔细阅读并理解本用户协议。',
  },
  {
    title: '2. 服务内容',
    body: '本应用为FSHD患者提供健康管理、知识查询、社区交流等服务。',
  },
  {
    title: '3. 用户责任',
    body: '用户应确保提供真实、准确的个人信息，并妥善保管账户密码。',
  },
  {
    title: '4. 隐私保护',
    body: '我们严格保护用户隐私，具体请查看《隐私政策》。',
  },
  {
    title: '5. 免责声明',
    body: '本应用提供的信息仅供参考，不构成医疗建议，请在专业医生指导下使用。',
  },
];

export const PRIVACY_POLICY_SECTIONS: LegalSection[] = [
  {
    title: '1. 信息收集',
    body: '我们收集您提供的个人信息和使用数据，用于提供更好的服务。',
  },
  {
    title: '2. 信息使用',
    body: '您的信息仅用于应用功能实现，不会用于其他商业目的。',
  },
  {
    title: '3. 信息保护',
    body: '我们采用行业标准的安全措施保护您的个人信息。',
  },
  {
    title: '4. 信息共享',
    body: '未经您同意，我们不会与第三方分享您的个人信息。',
  },
  {
    title: '5. 数据删除',
    body: '您可以随时申请删除账户和相关数据。',
  },
];

const toFlatText = (sections: LegalSection[]): string =>
  sections.map((section) => `${section.title}\n\n${section.body}`).join('\n\n');

export const USER_AGREEMENT_TEXT = toFlatText(USER_AGREEMENT_SECTIONS);
export const PRIVACY_POLICY_TEXT = toFlatText(PRIVACY_POLICY_SECTIONS);
