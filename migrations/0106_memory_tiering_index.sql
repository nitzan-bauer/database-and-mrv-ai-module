-- migrate:up
-- =====================================================================
-- 0106 — Stage 9 of the agent learning-layer plan: real active/archive
-- tiering, not just a WHERE filter application code has to remember to
-- apply. The vector index itself now only covers non-superseded rows —
-- a superseded (archived) memory is excluded from the ANN search
-- structure entirely, not merely filtered out after being found. This is
-- what keeps semantic recall fast as the table grows over years of
-- consolidation (0104) and correction (0101) instead of the index itself
-- growing to cover rows nothing should ever surface by default again.
--
-- Archived rows stay fully queryable on demand — same table, ordinary
-- SQL, just outside this index and outside recallAgentMemory's default
-- path (which already filters WHERE superseded_by IS NULL, Stage 3).
-- =====================================================================

DROP INDEX IF EXISTS mrv.idx_agent_memory_vec;

CREATE INDEX idx_agent_memory_vec_active ON mrv.agent_memory
  USING hnsw (embedding vector_cosine_ops)
  WHERE superseded_by IS NULL;

COMMENT ON INDEX mrv.idx_agent_memory_vec_active IS
  'Partial: only non-superseded ("active") memories. Superseded/archived rows (0101) are deliberately excluded from the ANN structure itself, not just filtered post-search.';

-- The on-demand archive-lookup path: "what superseded this row" / "list
-- everything archived" — a plain btree, since that's an equality/IS NOT
-- NULL lookup, not a similarity search.
CREATE INDEX IF NOT EXISTS idx_agent_memory_superseded_by ON mrv.agent_memory (superseded_by) WHERE superseded_by IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS mrv.idx_agent_memory_superseded_by;
DROP INDEX IF EXISTS mrv.idx_agent_memory_vec_active;
CREATE INDEX idx_agent_memory_vec ON mrv.agent_memory USING hnsw (embedding vector_cosine_ops);
