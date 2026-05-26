-- 007_kb_entities_relations.sql
-- Knowledge-graph scaffolding reserved for the deferred GraphRAG phase
-- (see docs/proposals/local-rag-migration.md §9 Phase 4).
--
-- The tables are intentionally created up-front so the schema lands once
-- and downstream code (IRetriever implementations, ingest pipelines) can
-- be written against a stable shape. They remain empty until Phase 4
-- populates them.

CREATE TABLE IF NOT EXISTS kb_entities (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Canonical surface form of the entity, e.g. "FSHD1", "D4Z4", "DUX4".
  name        TEXT NOT NULL,
  -- Coarse classification used by retrievers and UI, e.g.
  -- 'disease' | 'gene' | 'symptom' | 'treatment' | 'test'.
  type        TEXT,
  -- Alternate spellings / translations that should resolve to this entity.
  aliases     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Free-form payload for downstream attributes (definition, references,
  -- authoritative source, etc.).
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kb_entities_name_idx ON kb_entities (name);
CREATE INDEX IF NOT EXISTS kb_entities_type_idx ON kb_entities (type);
CREATE INDEX IF NOT EXISTS kb_entities_aliases_gin
  ON kb_entities USING gin (aliases);

CREATE TABLE IF NOT EXISTS kb_relations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id     UUID NOT NULL REFERENCES kb_entities(id) ON DELETE CASCADE,
  target_id     UUID NOT NULL REFERENCES kb_entities(id) ON DELETE CASCADE,
  -- Relation label, e.g. 'causes', 'located_in', 'treats', 'subtype_of'.
  relation_type TEXT NOT NULL,
  -- Edge weight for ranking / pruning during graph traversal.
  weight        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kb_relations_source_idx
  ON kb_relations (source_id, relation_type);
CREATE INDEX IF NOT EXISTS kb_relations_target_idx
  ON kb_relations (target_id, relation_type);

-- Updated-at trigger for kb_entities (kb_relations is append-only for now).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS kb_entities_set_updated_at ON kb_entities;
    CREATE TRIGGER kb_entities_set_updated_at
    BEFORE UPDATE ON kb_entities
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();
  END IF;
END;
$$ LANGUAGE plpgsql;
