-- Withdrawal of consent, which the consent documents already promise.
--
-- 《敏感个人信息处理单独同意》 tells the user 「同意后可随时在「隐私设置」
-- 中撤回」, and the privacy policy lists 撤回同意 among the rights it
-- grants. PIPL Art. 15 requires a convenient way to exercise it. None
-- of that was implemented: the ledger was append-only with no way to
-- take an acceptance back, so the sentence was a promise the product
-- could not keep — and a review caught that the test covering it
-- asserted the SENTENCE rather than the capability.
--
-- Additive rather than an edit to 019, because 019 has already left
-- this machine. A column with a NULL default is safe on a populated
-- table and needs no rewrite.
--
-- WHY A COLUMN AND NOT A DELETE:
--
--  1. The ledger's whole purpose is being able to show, later, what a
--     user agreed to and when. Deleting the row on withdrawal destroys
--     the evidence that the processing done BEFORE the withdrawal was
--     lawful — and 「撤回不影响撤回前已进行的处理」 is exactly what the
--     document tells the user. A tombstone keeps both halves.
--  2. Re-consenting after a withdrawal has to be possible, and the
--     unique index is on (user_id, document, version). A delete-and-
--     reinsert would silently lose the withdrawal that happened in
--     between; a new row cannot be written at the same version at all.
--     So withdrawal marks the row, and re-consent clears the mark.
--
-- Reads that ask 「has this user consented」 must therefore filter on
-- `withdrawn_at IS NULL`. hasAcceptedDocument does; the partial index
-- below is what keeps that filter cheap on the request path, since it
-- now runs in front of every write that stores health data.

ALTER TABLE legal_document_acceptances
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;

-- The consent gate's query is (user_id, document) WHERE not withdrawn,
-- and it runs on every sensitive write. Partial so withdrawn rows —
-- which the gate never wants — stay out of it entirely.
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_live
  ON legal_document_acceptances (user_id, document)
  WHERE withdrawn_at IS NULL;
