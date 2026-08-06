-- A short-lived, revocable, read-only link to one patient's clinical
-- passport.
--
-- WHY THIS EXISTS
--
-- FSHD's near-decade diagnostic odyssey is a communication failure, not
-- a data-collection failure. The clinical passport exists to end the
-- appointment where a patient cannot recount their own history — and
-- until now it could not leave the phone. The web export path is
-- `window.open('', '_blank')` + `print()`, and the browser most of
-- these patients use is WeChat's in-app one, where both of those are
-- unreliable; the failure message even instructs them to「允许弹出新
-- 窗口」, which is not a setting that exists there.
--
-- So the patient forwards a link in WeChat and the clinician opens it
-- on their own phone. No account, no app, no PDF viewer.
--
-- WHAT THIS TABLE IS CAREFUL ABOUT
--
-- The link publishes health data to whoever holds it. That is the
-- point, and it is also the risk, so:
--
--  * `token_hash`, never the token. The link is shown to the patient
--    once, at creation. A dump of this table — a backup that leaks, an
--    operator with read access — yields no working link. Same reasoning
--    as a password digest; sha256 is sufficient here because the token
--    is 32 bytes of CSPRNG output, not a human-chosen secret, so there
--    is nothing to brute-force.
--  * `expires_at` is NOT NULL and has no default. A share that never
--    expires is a permanent publication of a medical record created by
--    someone who thought they were showing a doctor one thing once.
--    The service caps it; the column refuses to let a caller forget it.
--  * `revoked_at` — PIPL Art. 15's convenient withdrawal, and the plain
--    human case of「我发错群了」.
--  * Opens are counted, and the last one timestamped, and that is ALL.
--    No IP, no user agent, no referrer. The patient is entitled to know
--    their link was used; building a log of which clinicians looked at
--    which patient would be a second, unconsented dataset about people
--    who never agreed to anything.
--  * `label` is the patient's own note (「王医生 8月复诊」), so the
--    revoke list is something they can actually reason about instead of
--    four identical rows.
--
-- ON DELETE CASCADE: when the account goes, so do its links. A live
-- share pointing at a deleted profile would 404 anyway, but leaving the
-- row would leave a record of who they shared with, past the deletion
-- request that was supposed to erase them.

CREATE TABLE IF NOT EXISTS passport_share_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  label         TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  opened_count  INTEGER NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The resolve path is a single lookup by hash on every open, by an
-- unauthenticated caller. Unique because two live links must never
-- collide, and because it makes that lookup an index probe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_share_token
  ON passport_share_links (token_hash);

-- 「我分享过什么，还有哪些是活的」 — the list the revoke UI is built
-- from. Partial: revoked rows are kept as evidence that the patient
-- exercised the withdrawal the privacy policy promises them, but they
-- are never what that screen is asking for.
CREATE INDEX IF NOT EXISTS idx_passport_share_live
  ON passport_share_links (user_id, created_at DESC)
  WHERE revoked_at IS NULL;
