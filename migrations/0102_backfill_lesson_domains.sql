-- migrate:up
-- =====================================================================
-- 0102 — retroactive domain tagging for existing lessons (Stage 3).
-- 0101 added the column; this backfills every lesson recorded before
-- that existed, using the same two-bucket split runAgentTask.ts's
-- AGENT_DOMAIN map now uses going forward.
-- =====================================================================

UPDATE mrv.agent_memory
   SET domain = 'mrv'
 WHERE kind = 'lesson' AND domain IS NULL AND metadata->>'agentId' IN ('rebeka', 'dave', 'john');

UPDATE mrv.agent_memory
   SET domain = 'crm'
 WHERE kind = 'lesson' AND domain IS NULL AND metadata->>'agentId' IN ('ron', 'jennifer');

-- migrate:down
UPDATE mrv.agent_memory SET domain = NULL WHERE kind = 'lesson';
