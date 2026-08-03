-- migrate:up
-- =====================================================================
-- 0040 — T2-2 agent memory: real write + semantic recall over pgvector,
-- using Voyage AI (voyage-3) as the embedding provider.
--
-- mrv.agent_memory's embedding column was declared vector(1536) in
-- migration 0006, with a comment claiming that dimension "matches
-- text-embedding-3-small and voyage-3". That is correct for OpenAI's
-- text-embedding-3-small but not for voyage-3, whose actual output is
-- 1024 dimensions by default (voyage-2, the prior generation, was
-- 1536 — this is very likely where the comment's assumption came
-- from). The table has never held a row, so the column is corrected
-- here rather than carrying a mismatched dimension forward: an insert
-- of a real voyage-3 embedding would otherwise fail outright.
--
-- record_agent_memory and recall_agent_memory are shared platform
-- tools, not scoped to one agent — the table itself carries no
-- agent_id column, only project_id/farm_id/created_by, so every agent
-- gets both. Both are 'auto': a memory entry is a working note, not an
-- append-only compliance record, and recall is read-only.
-- =====================================================================

ALTER TABLE mrv.agent_memory ALTER COLUMN embedding TYPE vector(1024);

COMMENT ON COLUMN mrv.agent_memory.embedding IS
  'vector(1024) — voyage-3''s actual default output dimension (corrected from an earlier vector(1536) that assumed voyage-3 matched text-embedding-3-small; the table had never held a row). Changing dims again means rewriting the column.';

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('record_agent_memory', 'auto', 'Writes a working note, not an append-only compliance record; commits nothing externally.'),
  ('recall_agent_memory', 'auto', 'Read-only semantic search; commits nothing externally.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['record_agent_memory', 'recall_agent_memory']::text[]
 WHERE NOT ('record_agent_memory' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(array_remove(tools, 'record_agent_memory'), 'recall_agent_memory');

DELETE FROM mrv.agent_action_policies WHERE action_name IN ('record_agent_memory', 'recall_agent_memory');

COMMENT ON COLUMN mrv.agent_memory.embedding IS
  'vector(1536) — text-embedding-3-small / voyage-3. Changing dims means rewriting the column.';

ALTER TABLE mrv.agent_memory ALTER COLUMN embedding TYPE vector(1536);
