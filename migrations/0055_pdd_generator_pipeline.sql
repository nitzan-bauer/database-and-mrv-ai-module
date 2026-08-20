-- migrate:up
-- =====================================================================
-- 0055 — run_pdd_generator_pipeline (Rebeka): "PDD GENERATOR FOR A NEW
-- PROJECT" from Nitzan's own development plan, as one deterministic
-- pipeline over tools that already exist and are already individually
-- audited (research_pdd_precedents, search_verra_registry,
-- sync_pdd_google_doc, sync_pdd_readiness_report), plus a PDF export
-- and an email step, new here.
--
-- Deliberately NOT an autonomous loop where a model decides what to
-- call next — runAgentTask.ts's own reasoning for staying single-turn
-- (auditability: one request, one response, one action taken or
-- withheld) still applies. This is instead a fixed, known sequence,
-- same standing as any other tool in this registry; it just happens to
-- call several other tools internally instead of doing one database
-- write itself.
--
-- 'confirm': the pipeline writes real files to Drive and sends a real
-- email — the same standing as sync_pdd_google_doc and
-- sync_pdd_readiness_report, both of which it calls.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('run_pdd_generator_pipeline', 'confirm', 'Runs several Drive/email-writing steps in sequence — a person should see it go out.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['run_pdd_generator_pipeline']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('run_pdd_generator_pipeline' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'run_pdd_generator_pipeline')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'run_pdd_generator_pipeline';
