/**
 * The legal documents a user can accept, and the version of each that
 * this build considers current.
 *
 * These identifiers are persisted in `legal_document_acceptances`
 * (migration 019) forever — renaming one orphans every historical row
 * and silently turns「同意过」into「没同意过」for existing users. They are
 * also duplicated in apps/mobile/lib/legal-content.ts, because there is
 * no shared package between the two workspaces; legal.service.test.ts
 * asserts on the full identifier set so a one-sided rename fails a test
 * rather than a patient's upload.
 *
 * The versions here are the SERVER's view of what is current. The
 * client sends the version it actually displayed, which may lag by one
 * deploy (the web export ships separately from the API), and the ledger
 * records what the user really saw. What the server's copy is for is
 * `outstanding`: deciding whether a user still owes an acceptance —
 * either because they never accepted a document at all, or because the
 * text has been revised since they did.
 */

/** Every known document, in the order migration 019's CHECK lists them.
 *  Declared as a const tuple (the shape `z.enum` needs) so the zod
 *  schema, the DB constraint and the type all come off one line. */
export const LEGAL_DOCUMENT_IDS = [
  'user_agreement',
  'privacy_policy',
  'sensitive_data_consent',
  'guardian_consent',
] as const;

export type LegalDocumentId = (typeof LEGAL_DOCUMENT_IDS)[number];

export const LEGAL_DOCUMENTS = {
  userAgreement: 'user_agreement',
  privacyPolicy: 'privacy_policy',
  sensitiveData: 'sensitive_data_consent',
  guardianConsent: 'guardian_consent',
} as const satisfies Record<string, LegalDocumentId>;

/**
 * Keep in step with LEGAL_DOCUMENT_VERSIONS in
 * apps/mobile/lib/legal-content.ts. Bump on every substantive edit to
 * the corresponding text — a version that does not move means the
 * ledger claims users accepted wording they never saw.
 */
export const LEGAL_DOCUMENT_VERSIONS: Record<LegalDocumentId, string> = {
  [LEGAL_DOCUMENTS.userAgreement]: '2026-08-02',
  // 2026-08-13: the privacy policy gained §10 (「我们自己的人什么时候会看到
  // 你的档案」) and the guardian rules' §4 was rewritten, both because the
  // administrator back office is a new recipient and a new processing
  // purpose. Bumping here is what makes `outstanding` report the debt —
  // every account that accepted the older privacy policy now owes a
  // re-acceptance. Keep in step with apps/mobile/lib/legal-content.ts.
  [LEGAL_DOCUMENTS.privacyPolicy]: '2026-08-13',
  [LEGAL_DOCUMENTS.sensitiveData]: '2026-08-02',
  [LEGAL_DOCUMENTS.guardianConsent]: '2026-08-13',
};

/**
 * Accepted at registration, as one general act of consent.
 *
 * The sensitive-PI document is NOT in this list and must not be added
 * to it: PIPL Art. 29 wants a separate consent for 敏感个人信息, and
 * folding it into the registration checkbox is precisely the bundling
 * the article forbids. It is collected at the first report upload
 * instead — see SENSITIVE_DATA_DOCUMENT.
 */
export const REGISTRATION_DOCUMENTS: readonly LegalDocumentId[] = [
  LEGAL_DOCUMENTS.userAgreement,
  LEGAL_DOCUMENTS.privacyPolicy,
];

/** The Art. 29 单独同意 gate, collected before the first report upload. */
export const SENSITIVE_DATA_DOCUMENT: LegalDocumentId = LEGAL_DOCUMENTS.sensitiveData;

/**
 * The Art. 31 儿童个人信息 gate, collected during profile registration
 * when the date of birth puts the patient under 14.
 *
 * Not in REGISTRATION_DOCUMENTS because it applies to a minority of
 * accounts and is decided from a field the general acceptance is
 * collected before — the phone-number sign-up has no birth date yet.
 * The profile form does, which is why the gate lives there.
 */
export const GUARDIAN_CONSENT_DOCUMENT: LegalDocumentId = LEGAL_DOCUMENTS.guardianConsent;

/** PIPL Art. 31. FSHD has juvenile- and infantile-onset forms, so this
 *  is a real population, not an edge case. */
export const GUARDIAN_CONSENT_AGE = 14;

/**
 * Documents whose absence means something is genuinely owed.
 *
 * `outstanding` drives 「这个用户还欠哪些同意」, and a document that only
 * applies to some accounts must not sit in it for everyone. Guardian
 * consent applies to under-14 patients; listing it universally would
 * tell an adult they owe a consent they can never legitimately give,
 * and would make the list useless as a prompt. The registration form
 * decides that case from the birth date and records the acceptance
 * directly — it does not consult `outstanding`.
 */
export const CONDITIONAL_DOCUMENTS: readonly LegalDocumentId[] = [LEGAL_DOCUMENTS.guardianConsent];

/** Mirrors the CHECK on `legal_document_acceptances.version`. Rejecting
 *  at the schema layer keeps a 400 (「版本号不合法」) out of the 500 that
 *  a constraint violation would otherwise become. */
export const LEGAL_VERSION_MAX_LENGTH = 32;

/** Mirrors the CHECK on `legal_document_acceptances.user_agent`. The
 *  writer truncates to this rather than letting the INSERT fail: a
 *  browser with a 600-character UA string must still be able to
 *  register. */
export const LEGAL_USER_AGENT_MAX_LENGTH = 512;

/** Mirrors the CHECK on `legal_document_acceptances.ip`. */
export const LEGAL_IP_MAX_LENGTH = 64;
