import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_VERSIONS,
  LEGAL_EFFECTIVE_DATE,
  OPERATOR_LEGAL_NAME,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_TEXT,
  SENSITIVE_DATA_CONSENT_SECTIONS,
  SENSITIVE_DATA_CONSENT_TEXT,
  USER_AGREEMENT_SECTIONS,
  USER_AGREEMENT_TEXT,
  GUARDIAN_CONSENT_SECTIONS,
} from '../legal-content';

/**
 * These are compliance assertions, not style ones. Each names a
 * specific PIPL requirement that the previous five-bullet placeholder
 * failed, so that a future edit which quietly drops a disclosure fails
 * here instead of failing in a 网信办 review.
 */
describe('legal-content: PIPL Art. 17 disclosures', () => {
  it('names the personal-information handler in both documents', () => {
    // A product name is not a 个人信息处理者. Until the registered entity
    // is filled in, the placeholder constant is what appears — and it
    // has to appear in both, because a user who only reads one must
    // still know who is processing their data.
    expect(PRIVACY_POLICY_TEXT).toContain(OPERATOR_LEGAL_NAME);
    expect(USER_AGREEMENT_TEXT).toContain(OPERATOR_LEGAL_NAME);
  });

  it('gives a contact channel for privacy requests', () => {
    expect(PRIVACY_POLICY_TEXT).toContain(LEGAL_CONTACT_EMAIL);
  });

  it.each([
    ['手机号', '手机号'],
    ['出生日期', '出生日期'],
    ['诊断', '诊断分期'],
    ['基因检测结果', '基因检测结果'],
    ['报告扫描件', 'MRI'],
    ['OCR 文本', '文字识别'],
    ['肌力测量', '肌力评分'],
    ['活动记录', '活动与训练记录'],
    ['用药记录', '用药名称剂量频次'],
    ['设备与日志', 'User-Agent'],
  ])('inventories %s', (_label, needle) => {
    expect(PRIVACY_POLICY_TEXT).toContain(needle);
  });

  it('states retention periods rather than leaving 「保存多久」 unanswered', () => {
    // These mirror the windows the code actually enforces —
    // AUDIT_RETENTION_DAYS = 180 and OTP_RETENTION_GRACE_HOURS = 24 in
    // apps/api/src/services/audit/retention.ts, and
    // ACCOUNT_DELETION_COOLING_DAYS = 7. If one of those constants
    // moves, this policy text has to move with it in the same commit.
    expect(PRIVACY_POLICY_TEXT).toContain('180 天');
    expect(PRIVACY_POLICY_TEXT).toContain('24 小时');
    expect(PRIVACY_POLICY_TEXT).toContain('7 天冷静期');
  });

  it('names the LLM processor and says where the endpoint is', () => {
    // The recipient, not just「云端大模型」. The .cn host is the whole
    // basis of the「不出境」claim — if AI_API_BASE_URL is ever pointed
    // at a .com host, this sentence becomes false and PIPL Art. 38
    // applies.
    expect(PRIVACY_POLICY_TEXT).toContain('SiliconFlow');
    expect(PRIVACY_POLICY_TEXT).toContain('api.siliconflow.cn');
    expect(PRIVACY_POLICY_TEXT).toContain('不因此出境');
  });

  it('marks health and genetic data as 敏感个人信息', () => {
    expect(PRIVACY_POLICY_TEXT).toContain('敏感个人信息');
    expect(PRIVACY_POLICY_TEXT).toContain('第 28 条');
  });

  it.each(['查阅', '复制', '更正', '删除', '撤回同意', '注销'])(
    'states how to exercise 「%s」',
    (right) => {
      expect(PRIVACY_POLICY_TEXT).toContain(right);
    },
  );

  it('carries a guardian rule for the minors this disease affects', () => {
    expect(PRIVACY_POLICY_TEXT).toContain('监护人');
    expect(PRIVACY_POLICY_TEXT).toContain('14 周岁');
  });

  it('no longer carries the placeholder policy', () => {
    // The exact sentence the audit flagged. Its return would mean a
    // merge resurrected the placeholder file.
    expect(PRIVACY_POLICY_TEXT).not.toContain('我们收集您提供的个人信息和使用数据');
  });
});

describe('legal-content: versioning', () => {
  it.each(Object.entries(LEGAL_DOCUMENT_VERSIONS))(
    '%s carries a date-stamped version',
    (_document, version) => {
      expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    },
  );

  it.each([
    ['user agreement', USER_AGREEMENT_TEXT, LEGAL_DOCUMENTS.userAgreement],
    ['privacy policy', PRIVACY_POLICY_TEXT, LEGAL_DOCUMENTS.privacyPolicy],
    ['sensitive-PI consent', SENSITIVE_DATA_CONSENT_TEXT, LEGAL_DOCUMENTS.sensitiveData],
  ])('%s states its own version and effective date in the text', (_label, text, document) => {
    // The ledger records (document, version); the user has to be able
    // to see which version they are looking at, or the recorded value
    // proves nothing.
    expect(text).toContain(LEGAL_DOCUMENT_VERSIONS[document]);
    expect(text).toContain(LEGAL_EFFECTIVE_DATE);
  });

  it('pins the document identifiers persisted in the ledger', () => {
    // Mirrored in apps/api/src/modules/legal/legal.constants.ts and in
    // migration 019's CHECK. A rename orphans every historical row.
    expect(Object.values(LEGAL_DOCUMENTS)).toEqual([
      'user_agreement',
      'privacy_policy',
      'sensitive_data_consent',
      'guardian_consent',
    ]);
  });
});

describe('legal-content: Art. 29 单独同意', () => {
  it('keeps the sensitive-PI consent as its own document', () => {
    // Not a section inside the agreement the registration checkbox
    // covers — that would be the bundling Art. 29 forbids.
    expect(SENSITIVE_DATA_CONSENT_SECTIONS.length).toBeGreaterThan(0);
    expect(USER_AGREEMENT_SECTIONS).not.toContainEqual(
      expect.objectContaining({ title: SENSITIVE_DATA_CONSENT_SECTIONS[1].title }),
    );
  });

  it('tells the user what refusing costs and that it is revocable', () => {
    expect(SENSITIVE_DATA_CONSENT_TEXT).toContain('不同意不影响');
    expect(SENSITIVE_DATA_CONSENT_TEXT).toContain('随时在「隐私设置」中撤回');
  });
});

describe('legal-content: derived flat text', () => {
  it('derives from the SECTIONS arrays so the two surfaces cannot drift', () => {
    for (const section of PRIVACY_POLICY_SECTIONS) {
      expect(PRIVACY_POLICY_TEXT).toContain(section.title);
      expect(PRIVACY_POLICY_TEXT).toContain(section.body);
    }
  });
});

describe('legal-content: Art. 31 儿童个人信息', () => {
  it('keeps the guardian rules as their own document, versioned like the rest', () => {
    // Art. 31 wants a dedicated 儿童个人信息处理规则 consented to by the
    // guardian — not a paragraph inside the general agreement, which
    // would leave nothing recording WHO consented for a child.
    expect(GUARDIAN_CONSENT_SECTIONS.length).toBeGreaterThan(0);
    expect(LEGAL_DOCUMENT_VERSIONS[LEGAL_DOCUMENTS.guardianConsent]).toBe(LEGAL_EFFECTIVE_DATE);
  });

  it('states the guardian affirmation the registration gate collects', () => {
    // The ledger row is only evidence if the text the user saw actually
    // says what they were affirming.
    const text = GUARDIAN_CONSENT_SECTIONS.map((section) => section.body).join('\n');
    expect(text).toContain('监护人');
    expect(text).toContain('十四');
  });
});
