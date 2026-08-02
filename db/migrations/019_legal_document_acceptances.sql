-- 019_legal_document_acceptances.sql
--
-- Proof that a user accepted a specific VERSION of a specific legal
-- document at a specific time.
--
-- Why this table has to exist at all: until now consent to the 用户协议
-- and 隐私政策 was implicit — the login screen said 「登录即表示同意以下
-- 条款」 next to two links and nothing was recorded anywhere. So the
-- honest answer to 「这位患者同意过哪一版隐私政策？」 was "we have no
-- idea", and the honest answer to 「你们凭什么处理他的基因检测结果？」 was
-- the same. 《个人信息保护法》第 14 条 requires consent to be given
-- 「在充分知情的前提下自愿、明确作出」 and 第 29 条 requires a SEPARATE
-- consent for 敏感个人信息 (this app stores D4Z4 repeat counts, MRI and
-- genetic report scans, and their OCR text). A consent you cannot
-- evidence is, in an audit, a consent you did not obtain.
--
-- One row per (user, document, version). Three documents ship today —
-- 'user_agreement', 'privacy_policy' and 'sensitive_data_consent' —
-- and the last one is the Art. 29 单独同意 gate shown before the first
-- report upload, deliberately NOT bundled into the general agreement.
--
-- WHY user_id CASCADES (this was the real decision here)
--
-- Migration 014 makes the opposite choice for account_deletion_requests
-- and states why: that table is the ledger proving an erasure happened,
-- so its rows must survive the very DELETE they describe. The argument
-- does not carry over to this table, and it is worth writing down why,
-- because "acceptance records are evidence, so keep them forever" is
-- the intuitive answer and it is wrong here:
--
--  1. This table is itself personal information. A surviving row holds
--     the user's id, their IP address and their device string. Keeping
--     that after the user exercised 删除权 (PIPL Art. 47) means the
--     deletion they asked for did not actually delete — and a
--     retained-forever consent log is exactly the kind of thing an
--     app-store data-deletion review or an Art. 47 complaint looks for.
--  2. The evidentiary need is already met by rows that DO survive.
--     account_deletion_requests keeps (requested_at, purged_at) with no
--     FK, so the timeline 「账号存在过，于 D 日按用户请求删除」 is always
--     provable. What consent covered is only ever a question about data
--     we still hold; once the data is gone, so is the question.
--  3. The thing worth being able to prove after erasure — that the
--     product structurally could not be used without accepting — is a
--     property of the code, not of a row: registration is blocked until
--     the checkbox is ticked and the first upload is blocked until the
--     sensitive-PI consent is recorded, both covered by tests.
--
-- If counsel later decides acceptances must outlive erasure, the change
-- is ON DELETE SET NULL plus scrubbing ip/user_agent in the purge — NOT
-- dropping the FK, because an orphaned row that still carries an IP is
-- the worst of both worlds.
CREATE TABLE IF NOT EXISTS legal_document_acceptances (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    -- Document identifier. Kept as TEXT + CHECK rather than an enum
    -- type so adding a document is a one-line constraint change
    -- instead of an ALTER TYPE that cannot run inside the runner's
    -- transaction.
    --
    -- `guardian_consent` is the PIPL Art. 31 case: FSHD has juvenile
    -- and infantile-onset forms, so under-14 patients are expected,
    -- and for them the person accepting the agreement is a parent or
    -- guardian rather than the patient. Recorded as its own document
    -- because Art. 31 wants a distinct 儿童个人信息处理规则 consented
    -- to by the guardian — folding it into the general registration
    -- acceptance would leave nothing to show WHO consented for a child.
    -- These strings are mirrored in apps/mobile/lib/legal-content.ts
    -- and apps/api/src/modules/legal/legal.constants.ts; they are
    -- persisted forever, so renaming one orphans history.
    document     TEXT NOT NULL
                 CHECK (document IN (
                   'user_agreement',
                   'privacy_policy',
                   'sensitive_data_consent',
                   'guardian_consent'
                 )),
    -- The version string the user actually saw, e.g. '2026-08-02'.
    -- Capped because it is client-supplied: without a bound, a client
    -- bug could write a whole document body into this column and every
    -- 「最新同意版本」 lookup would drag it along.
    version      TEXT NOT NULL
                 CHECK (length(version) BETWEEN 1 AND 32),
    accepted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Deliberately TEXT and not INET. `trust proxy` makes Express's
    -- req.ip the leftmost X-Forwarded-For value, which is entirely
    -- caller-controlled and is NOT validated as an address — a request
    -- carrying `X-Forwarded-For: not-an-ip` would make an INET column
    -- raise 22P02 and abort the INSERT, and this INSERT sits on the
    -- registration path. Recording consent must never be the reason a
    -- patient cannot create an account.
    ip           TEXT CHECK (ip IS NULL OR length(ip) <= 64),
    -- Truncated by the writer; the CHECK is the backstop. User-Agent
    -- is unbounded on the wire.
    user_agent   TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 512)
);

-- Accepting the same version twice is a duplicate tap or a retry over a
-- flaky connection, not a second consent. The unique index turns the
-- write into an idempotent upsert (the writer uses ON CONFLICT DO
-- NOTHING and re-reads the original row), so `accepted_at` keeps
-- meaning 「第一次同意的时间」 — which is the timestamp a compliance
-- question is actually about.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_legal_acceptance_user_document_version
    ON legal_document_acceptances (user_id, document, version);

-- The dominant read is 「这个用户每份文件最新同意的是哪一版」, asked on
-- every app start by the consent gate.
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user_document_time
    ON legal_document_acceptances (user_id, document, accepted_at DESC);
