-- migrate:up
-- =====================================================================
-- 0070 — register update_pdd_seed_answer, same standing as
-- update_pdd_section_status (0053): a working record, not an external
-- action, so 'auto' — the tool's own hard guard (human-only, not an
-- agent) is what actually protects it, this policy row just satisfies
-- the "every action needs a policy" rule.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('update_pdd_seed_answer', 'auto', 'Writes one SEED-questionnaire answer — a working record, not an external action.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['update_pdd_seed_answer']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('update_pdd_seed_answer' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'update_pdd_seed_answer')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'update_pdd_seed_answer';
