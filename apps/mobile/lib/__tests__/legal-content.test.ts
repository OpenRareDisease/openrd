import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_VERSIONS,
  LEGAL_EFFECTIVE_DATES,
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

describe('legal-content: the administrator back office (§10)', () => {
  /**
   * A back office that can read and edit a patient's record is a new
   * recipient and a new processing purpose, and until 2026-08-13 this
   * policy said nothing about it. These assertions are here so a future
   * edit that trims §10 for length fails here rather than in front of a
   * patient who was never told.
   *
   * Each needle is a fact about the code, not a phrasing preference:
   *  · the marker is 「管理员代填」 and the passport/export must not say
   *    「本人填写」 over it (baseline-provenance.ts). THIS FILE CAN ONLY
   *    ASSERT THE SENTENCE — the code it describes is in the API
   *    package and unreachable from a jest run here. What holds the
   *    other end up, named so a reader can check rather than trust:
   *    apps/api/.../profile.passport.diagnosis.test.ts (the fourth
   *    confirmation state and the marked-field list),
   *    passport-share.html.test.ts (the page a doctor opens),
   *    export/{treat-nmd,fhir-r4,phenopacket}.test.ts (all three
   *    documents), and lib/__tests__/clinical-passport-pdf.test.ts (the
   *    printed passport, which IS in this package);
   *  · the admin-writable set is enforced server-side, not by which
   *    boxes a screen draws (ADMIN_WRITABLE_BASELINE_FIELDS);
   *  · clearing a field leaves NO marker, and the policy says so
   *    rather than leaving a reader to assume the opposite;
   *  · reads are audited too, and a failed audit write REFUSES the
   *    request rather than serving it (require-admin.ts);
   *  · the trail lives 180 days (AUDIT_RETENTION_DAYS), which also means
   *    an older access cannot be answered — the policy says both halves;
   *  · the role can only be granted from a shell (scripts/admin-role.mjs).
   */
  it.each([
    ['who can look', '只有角色被设为「管理员」的账号'],
    ['how the role is granted', '在命令行上授予'],
    ['the list is masked', '139****0001'],
    ['reads are audited too', '包括只是打开看看'],
    ['a failed audit write refuses the request', '宁可管理员看不成'],
    ['the search term is not persisted', '不会写进这条记录'],
    ['the retention window', '保存 180 天后自动删除'],
    ['what falls outside it', '我们答不上来'],
    ['the provenance marker', '管理员代填'],
    ['and what it is not', '不会写成「本人填写」'],
    ['which twelve fields are writable', '一共这十二项'],
    ['that the boundary is the server, not the form', '请求会被直接拒绝'],
    ['that reclaiming is per field', '是按字段算的'],
    ['that clearing leaves no marker', '清空，则不会留下「管理员代填」标记'],
    ['that the marker travels into the exports', 'FHIR / Phenopacket / TREAT-NMD'],
    ['that an admin can export one patient', '导成一个文件'],
    ['that a full-database CSV exists', '把全部患者导成一张表'],
    ['how to ask who looked', '15 个工作日内答复'],
  ])('states %s', (_label, needle) => {
    expect(PRIVACY_POLICY_TEXT).toContain(needle);
  });

  it('does not leave §5 claiming the third-party list is the whole story', () => {
    // §5 opens with 「以下是全部对外提供与委托处理的情形」. An internal
    // administrator is not 向第三方提供, which is exactly why a reader
    // would otherwise finish §5 believing nobody else can see anything.
    expect(PRIVACY_POLICY_TEXT).toContain('不是「向第三方提供」');
  });

  it('no longer claims a report can only be fetched by the patient', () => {
    // §6 used to say 「仅能通过你本人登录后的接口取回」, which the back
    // office makes false.
    expect(PRIVACY_POLICY_TEXT).not.toContain('仅能通过你本人登录后的接口取回');
  });

  it('corrects the guardian rules, which said operations staff do not look', () => {
    const text = GUARDIAN_CONSENT_SECTIONS.map((section) => section.body).join('\n');
    expect(text).not.toContain(
      '我们的运维人员不会主动查阅具体患儿的报告；因排障确需接触时会有操作记录',
    );
    expect(text).toContain('管理员');
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
    //
    // Asserted as the whole sentence, not as two independent
    // `toContain`s. Those passed while the effective date was still the
    // shared 2026-08-02 constant, because the privacy policy's own text
    // mentions its revision date in three other places — the assertion
    // was being satisfied by a string that had nothing to do with the
    // version line.
    expect(text).toContain(
      `版本 ${LEGAL_DOCUMENT_VERSIONS[document]}，生效日期 ${LEGAL_EFFECTIVE_DATES[document]}`,
    );
  });

  it.each(Object.entries(LEGAL_DOCUMENT_VERSIONS))(
    '%s takes effect on the day its version is dated',
    (document, version) => {
      // A revision that took effect on some other day would need a
      // reason. Until there is one, the two dates moving apart means
      // somebody bumped a version and forgot the effective date — which
      // is the pair「版本 2026-08-13，生效日期 2026-08-02」that made this
      // map per-document in the first place.
      expect(LEGAL_EFFECTIVE_DATES[document as keyof typeof LEGAL_EFFECTIVE_DATES]).toBe(version);
    },
  );

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
    expect(LEGAL_DOCUMENT_VERSIONS[LEGAL_DOCUMENTS.guardianConsent]).toBe(
      LEGAL_EFFECTIVE_DATES[LEGAL_DOCUMENTS.guardianConsent],
    );
  });

  it('states the guardian affirmation the registration gate collects', () => {
    // The ledger row is only evidence if the text the user saw actually
    // says what they were affirming.
    const text = GUARDIAN_CONSENT_SECTIONS.map((section) => section.body).join('\n');
    expect(text).toContain('监护人');
    expect(text).toContain('十四');
  });
});
