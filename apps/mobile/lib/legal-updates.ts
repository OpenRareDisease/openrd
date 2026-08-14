/**
 * 「这一版改了什么」 — the per-version change notes a returning patient
 * is shown when a document they already accepted has been revised.
 *
 * WHY THIS EXISTS
 *
 * 隐私政策 §9 promises 「涉及处理目的、处理方式、信息种类或接收方实质
 * 变更的，我们会在 App 内重新征得你的同意」, and 用户协议 §11 promises
 * 「会在你下次进入 App 时请你重新确认」. The administrator back office
 * is exactly such a change — a new recipient and a new processing
 * purpose — so both documents were revised and their versions bumped
 * (lib/legal-content.ts and, on the server, legal.constants.ts).
 * `GET /legal/acceptances` therefore reports
 * `outstanding: ['privacy_policy']` for every account that accepted the
 * older text. Until this round nothing in apps/mobile read that field,
 * which made the promise in §9 a sentence with no code behind it.
 *
 * WHY A CHANGE NOTE AND NOT JUST THE DOCUMENT
 *
 * The revised privacy policy is ten sections long and only one of them
 * is new. Handing a patient the whole text again and asking them to
 * tick a box is how a re-consent becomes a formality — the person
 * scrolls to the bottom because that is where the button is. What
 * actually changed is that an administrator can now read and edit
 * their record, and that is a sentence, not a version number. The full
 * text is still one tap away on the same screen (`sectionsFor`), and it
 * is still the authority; this file is the summary that makes the
 * question answerable.
 *
 * EVERY BULLET BELOW IS CHECKABLE IN THIS REPOSITORY. Where one names
 * a number or a refusal, the thing that enforces it is named in a
 * comment beside it. A sentence here that stops being true is the same
 * defect as a comment that lies about the code, one audience worse.
 *
 * KEEPING IT IN STEP: lib/__tests__/legal-updates.test.ts fails if a
 * document's current version is not the first-published one and has no
 * note — i.e. a future revision that bumps a version and leaves the
 * patient with 「有更新，请重新同意」 and nothing else fails a test
 * rather than shipping.
 */

import {
  GUARDIAN_CONSENT_SECTIONS,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_TITLES,
  LEGAL_DOCUMENT_VERSIONS,
  PRIVACY_POLICY_SECTIONS,
  SENSITIVE_DATA_CONSENT_SECTIONS,
  USER_AGREEMENT_SECTIONS,
  type LegalDocumentId,
  type LegalSection,
} from './legal-content';

/** Document id -> its full text, so a re-consent screen can show the
 *  authority under the summary without a second copy of the mapping.
 *  Keyed by every id in LEGAL_DOCUMENTS; a compile error here is the
 *  point of the `satisfies`. */
export const LEGAL_DOCUMENT_SECTIONS = {
  [LEGAL_DOCUMENTS.userAgreement]: USER_AGREEMENT_SECTIONS,
  [LEGAL_DOCUMENTS.privacyPolicy]: PRIVACY_POLICY_SECTIONS,
  [LEGAL_DOCUMENTS.sensitiveData]: SENSITIVE_DATA_CONSENT_SECTIONS,
  [LEGAL_DOCUMENTS.guardianConsent]: GUARDIAN_CONSENT_SECTIONS,
} satisfies Record<LegalDocumentId, LegalSection[]>;

export interface LegalVersionNote {
  /** The version this note describes, always YYYY-MM-DD — same shape as
   *  LEGAL_DOCUMENT_VERSIONS. The LEDGER's version is not: migration 019
   *  stores any 1..32-char string and legal.schema.ts deliberately does
   *  not pin the format. So 「newer than what you accepted」 is a string
   *  compare only against a version this build can order — see
   *  DATE_VERSION. */
  version: string;
  /** One sentence: what happened. Shown as the heading of the note. */
  headline: string;
  /** The specifics, in the order a worried person would ask them. */
  changes: string[];
}

/**
 * What each revision changed, newest first.
 *
 * A document that has never been revised has an empty list — there is
 * nothing to summarise, and inventing 「初版」 copy for it would put a
 * note on screen that says nothing.
 */
export const LEGAL_VERSION_NOTES: Record<LegalDocumentId, LegalVersionNote[]> = {
  [LEGAL_DOCUMENTS.userAgreement]: [],
  [LEGAL_DOCUMENTS.privacyPolicy]: [
    {
      version: '2026-08-13',
      headline:
        '我们上线了一个管理员后台。这意味着我们自己的管理员账号可以查阅你的档案，也可以代你填写其中一部分字段——以前的隐私政策里没有这件事。',
      changes: [
        // admin.controller.ts getPatientRecord: account (含 phone_number)
        // / identity / baseline / documents(标题·类型·状态·上传时间) /
        // followups / falls / instruments。报告原件与 OCR 文本不在这个
        // 响应里（没有 storageUri，也没有 ocrPayload）。
        '管理员打开你的档案后能看到：你的手机号与账号信息、基线临床字段、随访事件、跌倒记录、量表结果，以及你上传的报告清单（标题、类型、状态、上传时间）。报告文件本身不在那个页面上。',
        // ADMIN_WRITABLE_BASELINE_FIELDS（baseline-provenance.ts）是这
        // 十二项；applyAdminBaselineWrite 对名单以外的改动直接 400。
        '管理员可以代你填写十二项基线字段：姓名、称呼、地区、出生年份、确诊年份、分型、D4Z4、单倍型、甲基化、家族史、起病部位、备注。你对自己身体的那些回答——诊断进展、能不能独立行走、各项困难评分——后台只能看，服务端会拒绝代填。',
        // §B3。标记随值一起存在 baseline_payload 里，护照与三种导出都
        // 单独列出来；patient 自己再写同一个字段时标记按字段移除。
        '被代填过的字段会标成「管理员代填」，不会写成「本人填写」；你自己再改一次那一个字段，标记就消失，这个字段回到你名下。',
        // require-admin.ts：审计行在 handler 之前写，写不进去就 503。
        // 保存 180 天 = AUDIT_RETENTION_DAYS。
        '每一次查阅和修改都记一条带时间的记录，保存 180 天。这条记录写不进去，这次访问就会被服务端拒绝——宁可管理员看不成，也不留一次没有记录的查阅。',
        // auth.schema.ts 的注册 enum 只有 patient/caregiver；授予走
        // scripts/admin-role.mjs，需要数据库访问权。
        '管理员权限不能自己给自己：注册页上没有这个选项，只能由能登录我们服务器的人在命令行上授予，收回同样是一条命令。',
        // AdminController.exportPatient，三种格式，审计事件 admin.export。
        // 三种格式都不带原件（DocumentReference / files 只写一条本平台
        // 的 API 路径）。姓名、电话、住址：fhir-r4.ts 的 Patient 资源
        // 从不写入，phenopacket 同理，TREAT-NMD 放在 localOnly 节，而
        // AdminController.exportPatient 恒传 includeLocalOnly:false —— 家族史
        // 也在那一节里（treat-nmd.ts 的 familyHistory）。反过来，测量 /
        // 功能测试 / 症状评分 / 日常影响是 getPatientRecord 明确不发、
        // 而导出会写的（fhir-r4.ts 的 buildFhirExport），所以「和页面上
        // 一样」是假话。
        '管理员还可以把你这一份档案导成一个 FHIR / Phenopacket / TREAT-NMD 文件（研究与医院系统常用的格式），导出同样单独记一条。这个文件里没有你上传的报告原件，也不写姓名、电话、住址和家族史；但它比后台页面上看到的多——你记录过的肌力测量、功能测试、症状评分与日常影响也在里面。',
        // §10（七）。App 里确实还没有自助入口——「查看 AI 调用记录」
        // 只覆盖 AI 调用。
        '想知道谁看过你的档案，现在要通过隐私政策第 1 条的邮箱或电话问我们，App 里还没有自助入口；能查到的范围是最近 180 天。',
      ],
    },
  ],
  [LEGAL_DOCUMENTS.sensitiveData]: [],
  [LEGAL_DOCUMENTS.guardianConsent]: [
    {
      version: '2026-08-13',
      headline:
        '同一个后台上线了，所以这份儿童规则的第 4 条也改了：管理员可以查阅这位患儿的档案，也可以代填其中一部分字段。',
      changes: [
        // 旧文本可在 git 里核对：HEAD~1 的 GUARDIAN_CONSENT_SECTIONS
        // 第 4 条写的是「我们的运维人员不会主动查阅具体患儿的报告」。
        '第 4 条以前写的是「我们的运维人员不会主动查阅具体患儿的报告」。管理员后台上线后这句话不再成立，我们把它改掉了，而不是留在那里。',
        '管理员能看到的、能代填的十二项，与成年患者完全相同；患儿对自己身体的那些回答，后台只能看，服务端会拒绝代填。',
        '代填过的字段会标成「管理员代填」；监护人自己再改一次那一个字段，标记就消失、回到监护人名下。',
        '每一次查阅和修改都记一条带时间的记录，保存 180 天。监护人可以按隐私政策第 1 条的方式来问是谁看过。',
      ],
    },
  ],
};

/**
 * How the ask is worded per document.
 *
 * Guardian consent is given by an adult on a child's behalf, so both
 * the button and the opening sentence have to address that person as a
 * guardian: a screen that tells them 「跟你的病历有关」 and offers
 * 「我同意」 is asking the wrong person the wrong question. It is the
 * same distinction SensitiveDataConsentGate already draws for the
 * button, extended to the sentence above it.
 */
const ASK_COPY: Record<LegalDocumentId, { lead: string; label: string; hint: string }> = {
  [LEGAL_DOCUMENTS.userAgreement]: {
    lead: '我们改了一件跟你怎么使用这个 App 直接有关的事。',
    label: '我读完了，同意这一版',
    hint: '记录你对这一版《用户协议》的同意',
  },
  [LEGAL_DOCUMENTS.privacyPolicy]: {
    lead: '我们改了一件跟你的病历直接有关的事。',
    label: '我读完了，同意这一版',
    hint: '记录你对这一版《隐私政策》的同意',
  },
  [LEGAL_DOCUMENTS.sensitiveData]: {
    lead: '我们改了一件跟你上传的报告与健康数据直接有关的事。',
    label: '我读完了，同意这一版',
    hint: '记录你对这一版《敏感个人信息处理单独同意》的同意',
  },
  [LEGAL_DOCUMENTS.guardianConsent]: {
    lead: '我们改了一件跟这位患儿的档案直接有关的事。',
    label: '我是监护人，代为同意这一版',
    hint: '记录监护人对这一版《儿童个人信息处理规则》的同意',
  },
};

export interface ConsentAsk {
  document: LegalDocumentId;
  title: string;
  /** The version this build displays and would record. */
  currentVersion: string;
  /** What the ledger says this account last accepted, or null when it
   *  holds no LIVE row for this document. The payload does not say why
   *  there is none, so copy keyed off this field must name no cause:
   *  it would be guessing, in front of the one person who knows the
   *  answer. */
  acceptedVersion: string | null;
  /** Notes for every version newer than `acceptedVersion`, newest
   *  first. Empty when there is nothing to diff against. */
  notes: LegalVersionNote[];
  sections: LegalSection[];
  /** The opening sentence, which has to name whose record this is. */
  lead: string;
  acceptLabel: string;
  acceptHint: string;
}

/** Fixed ask order, matching LEGAL_DOCUMENT_IDS on the server. */
const ASK_ORDER: LegalDocumentId[] = [
  LEGAL_DOCUMENTS.userAgreement,
  LEGAL_DOCUMENTS.privacyPolicy,
  LEGAL_DOCUMENTS.sensitiveData,
  LEGAL_DOCUMENTS.guardianConsent,
];

interface AcceptanceSummaryLike {
  acceptances?: Array<{ document: string; version: string; acceptedAt: string }>;
  outstanding?: string[];
}

/** The shape every version in LEGAL_VERSION_NOTES has. The ledger is
 *  NOT limited to it: migration 019 stores any 1..32-char string,
 *  legal.schema.ts deliberately refuses to pin the format, and the
 *  oldest rows carry 'v1'. `'2026-08-13' > 'v1'` is false, so a raw
 *  `>` against such a row drops every note and the screen then says no
 *  summary was written. A version this build cannot order counts as
 *  older than every note instead, so all of them are shown: a summary
 *  the patient may already have read is recoverable, silently dropping
 *  the one that says who can now read their record is not. */
const DATE_VERSION = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn `GET /legal/acceptances` into the list of documents this build
 * can actually ask about.
 *
 * THREE THINGS ARE DELIBERATELY DROPPED:
 *
 * 1. A document id this build does not know. The server decides
 *    `outstanding`; a bundle older than the API can be told about a
 *    document whose text it does not carry, and there is nothing
 *    honest to render for it. Dropping it means the patient is not
 *    asked rather than shown an empty screen they cannot clear.
 *
 * 2. A document whose stored acceptance is ALREADY this build's
 *    current version. legal.constants.ts spells out why this happens:
 *    the web export ships separately from the API, so the server can
 *    consider a newer version current while this bundle still displays
 *    — and would still record — the older one. Asking would record the
 *    same version again, the server would still report it outstanding,
 *    and the screen would come straight back. The patient sees nothing
 *    until the export catches up, which is the failure mode that
 *    leaves them able to use their own app.
 *
 * 3. A FIRST ask for 《敏感个人信息处理单独同意》. See the guard below:
 *    PIPL Art. 29 wants that consent separate and in context, which is
 *    the first health-data write, not a re-consent screen at app entry.
 *
 * The first two are the difference between a prompt and a loop; the
 * third is the difference between a separate consent and a bundled one.
 */
export const buildConsentAsks = (summary: AcceptanceSummaryLike | null): ConsentAsk[] => {
  if (!summary) return [];
  const outstanding = new Set(summary.outstanding ?? []);
  const accepted = new Map<string, { version: string; acceptedAt: string }>();
  for (const item of summary.acceptances ?? []) {
    // The server returns the latest acceptance per document, but a
    // duplicate here must not silently pick the older one. Ordered on
    // `acceptedAt` — the server writes an ISO timestamp there — and not
    // on `version`, which the ledger does not constrain: 'v1' sorts
    // after every date, so a version compare would prefer the oldest
    // row it can find.
    const existing = accepted.get(item.document);
    if (existing === undefined || item.acceptedAt > existing.acceptedAt) {
      accepted.set(item.document, { version: item.version, acceptedAt: item.acceptedAt });
    }
  }

  const asks: ConsentAsk[] = [];
  for (const document of ASK_ORDER) {
    if (!outstanding.has(document)) continue;
    const currentVersion = LEGAL_DOCUMENT_VERSIONS[document];
    const acceptedVersion = accepted.get(document)?.version ?? null;
    // The FIRST ask for the Art. 29 单独同意 belongs at the first
    // health-data write (SensitiveDataConsentGate), not here.
    // legal.constants.ts keeps that document out of
    // REGISTRATION_DOCUMENTS because collecting it beside the general
    // consent is the bundling the article forbids — and this screen is
    // reached from the app-entry gate, ahead of onboarding, which is
    // the same bundling one screen later. The server reports it
    // outstanding for every account that has not uploaded a report yet;
    // that is a consent not yet due, not a debt. A STALE row still
    // reaches the ask below: that is a revision of a consent already
    // given, which §9 does promise to re-ask here.
    if (acceptedVersion === null && document === LEGAL_DOCUMENTS.sensitiveData) continue;
    if (acceptedVersion === currentVersion) continue; // stale bundle — see above
    const notes =
      acceptedVersion === null
        ? []
        : LEGAL_VERSION_NOTES[document]
            .filter((note) => !DATE_VERSION.test(acceptedVersion) || note.version > acceptedVersion)
            .sort((a, b) => b.version.localeCompare(a.version));
    asks.push({
      document,
      title: LEGAL_DOCUMENT_TITLES[document] ?? document,
      currentVersion,
      acceptedVersion,
      notes,
      sections: LEGAL_DOCUMENT_SECTIONS[document],
      lead: ASK_COPY[document].lead,
      acceptLabel: ASK_COPY[document].label,
      acceptHint: ASK_COPY[document].hint,
    });
  }
  return asks;
};
