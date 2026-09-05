-- migrate:up
-- =====================================================================
-- 0104 — Stage 7 of the agent learning-layer plan: John's monthly memory
-- consolidation job (merges near-duplicate memories, marking the
-- originals superseded_by rather than deleting them).
-- =====================================================================

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('john', 'john_memory_consolidation',
   'Monthly memory consolidation: merge near-duplicate agent memories',
   'monthly', NULL, now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key = 'john_memory_consolidation';
