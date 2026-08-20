-- migrate:up
-- =====================================================================
-- 0054 — sync_pdd_readiness_report (Rebeka): the progress report,
-- placed in the same Drive folder as the PDD Doc (0052's project
-- folder), computed from the structured questionnaire (0053).
--
-- 'confirm': same standing as sync_pdd_google_doc — a real file written
-- into the signed-in person's own Drive.
-- =====================================================================

ALTER TABLE mrv.projects
  ADD COLUMN readiness_report_doc_id  text,
  ADD COLUMN readiness_report_doc_url text;

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('sync_pdd_readiness_report', 'confirm', 'Writes a real file into the signed-in person''s own Drive — a person should see it go out.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['sync_pdd_readiness_report']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('sync_pdd_readiness_report' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'sync_pdd_readiness_report')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'sync_pdd_readiness_report';

ALTER TABLE mrv.projects
  DROP COLUMN IF EXISTS readiness_report_doc_id,
  DROP COLUMN IF EXISTS readiness_report_doc_url;
