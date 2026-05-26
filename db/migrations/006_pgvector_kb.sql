-- 006_pgvector_kb.sql
-- Local medical knowledge base storage backed by pgvector.
-- Supports the migration off Chroma Cloud and the move to the bge-m3
-- embedding model (1024 dimensions).
--
-- See docs/proposals/local-rag-migration.md for the broader plan.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS kb_chunks (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Source tracking: which markdown / document the chunk came from and
  -- what the source content hashed to at ingest time. The ingest script
  -- uses source_fingerprint to detect file changes.
  source_file        TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  chunk_index        INTEGER NOT NULL DEFAULT 0,
  -- Chunk content + a content-level fingerprint for deduplication.
  content            TEXT NOT NULL,
  fingerprint        TEXT NOT NULL UNIQUE,
  -- Free-form metadata: source frontmatter (authority, tags, ...) plus
  -- any other fields the ingest pipeline wants to attach.
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Embedding model identifier so we can detect dimension/model mismatches
  -- if KB_EMBED_MODEL ever changes. Default points at the current choice.
  embed_model        TEXT NOT NULL DEFAULT 'BAAI/bge-m3',
  -- 1024-d vectors for bge-m3. If the model dimension changes, re-create
  -- the column with the new dimension and re-ingest all chunks.
  embedding          vector(1024),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Approximate nearest neighbor index for cosine similarity search.
-- ivfflat lists=100 is a reasonable default for tens of thousands of
-- chunks; tune `lists` upward if the corpus grows past ~1M chunks.
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_ivfflat
  ON kb_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- GIN index supports metadata filtering (e.g. authority = 'high').
CREATE INDEX IF NOT EXISTS kb_chunks_metadata_gin
  ON kb_chunks USING gin (metadata);

CREATE INDEX IF NOT EXISTS kb_chunks_source_file_idx
  ON kb_chunks (source_file);

-- Reuse the shared timestamp trigger defined in init_db.sql.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS kb_chunks_set_updated_at ON kb_chunks;
    CREATE TRIGGER kb_chunks_set_updated_at
    BEFORE UPDATE ON kb_chunks
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();
  END IF;
END;
$$ LANGUAGE plpgsql;
