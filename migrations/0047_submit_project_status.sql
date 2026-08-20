-- migrate:up
-- =====================================================================
-- 0047 — submit_project_status (Rebeka).
--
-- Rebeka's own prompt says she "submit[s] under Under Development to
-- register the project", but mrv.projects.status sat frozen at its
-- insert-time default forever — nothing in the codebase ever changed
-- it. This is not a call to Verra (there is no public submission API;
-- the real filing still happens by hand, outside this repo) — it is an
-- honest, audited record of which VM0042 pipeline stage the project's
-- owner has actually declared it at.
--
-- 'confirm' rather than 'auto': moving a project's declared status is
-- externally meaningful in a way generate_pdd_draft's read-only
-- assembly is not, so an agent calling it unattended needs a manager's
-- approval the same way send_work_order does.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('submit_project_status', 'confirm', 'Moves the project''s declared VM0042 pipeline stage — a manager''s approval, not a call to Verra.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['submit_project_status']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('submit_project_status' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'submit_project_status')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'submit_project_status';
