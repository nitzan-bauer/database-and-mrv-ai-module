-- migrate:up
-- =====================================================================
-- 0071 — retire sync_pdd_readiness_report (Nitzan's own decision,
-- confirmed twice: "PDD READINESS REPORT — מיותר אנא תמחק"). PDD
-- Development (0067) shows per-section progress and missing inputs
-- directly, live, per section — the report's whole job. The already-
-- created Google Doc (mrv.projects.readiness_report_doc_id/url) is left
-- alone; it's a real file in Nitzan's Drive, just no longer synced.
-- =====================================================================

UPDATE mrv.agents
   SET tools = array_remove(tools, 'sync_pdd_readiness_report')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'sync_pdd_readiness_report';

-- migrate:down
INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('sync_pdd_readiness_report', 'confirm', 'Writes a real file into the signed-in person''s own Drive — a person should see it go out.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['sync_pdd_readiness_report']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('sync_pdd_readiness_report' = ANY (tools));
