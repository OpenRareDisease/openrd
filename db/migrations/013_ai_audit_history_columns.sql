-- Multi-turn /ai/ask: record how much client-replayed conversation
-- history entered each call. Counts only — the turns themselves are
-- already covered by redacted_prompt_hash (the hash source walks
-- every message, history included), so storing them again would just
-- widen the PII surface.
--
-- DEFAULT 0 keeps every pre-multi-turn row truthful: those calls
-- really did carry zero history messages. history_char_length stays
-- nullable — 0 chars and "predates the feature" are different facts.
ALTER TABLE ai_prompt_audit
  ADD COLUMN IF NOT EXISTS history_message_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS history_char_length INTEGER;
