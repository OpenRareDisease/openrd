ALTER TABLE ai_prompt_audit
  DROP COLUMN IF EXISTS history_message_count,
  DROP COLUMN IF EXISTS history_char_length;
