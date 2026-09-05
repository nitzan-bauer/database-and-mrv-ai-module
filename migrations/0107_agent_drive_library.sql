-- migrate:up
-- =====================================================================
-- 0107 — Stage 10 of the agent learning-layer plan: a personal Drive
-- folder per agent (mirroring mrv.farms.drive_folder_id, migration
-- 0032's own pattern — reused, not reinvented, per Nitzan's own decision
-- on 10.1) plus a small config table naming the real source folders
-- John's biweekly sorting round reads from.
-- =====================================================================

ALTER TABLE mrv.agents ADD COLUMN IF NOT EXISTS drive_folder_id text;
COMMENT ON COLUMN mrv.agents.drive_folder_id IS
  'This agent''s own Drive folder, centralizing every document it has ever produced via a scheduled task, plus whatever John''s sorting round has routed to it. Set via link_agent_drive_folder, same pattern as mrv.farms.drive_folder_id.';

CREATE TABLE IF NOT EXISTS mrv.drive_source_folders (
  source_key     text PRIMARY KEY CHECK (source_key IN ('claude', 'carbonature', 'downloads')),
  drive_folder_id text NOT NULL,
  drive_folder_name text NOT NULL,
  linked_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE mrv.drive_source_folders IS
  'The 3 real Drive folders John''s biweekly sorting round scans (CLAUDE, CARBONATURE, DOWNLOADS) — linked once via link_source_drive_folder, the same "paste the id, we verify it" pattern as every other Drive link in this codebase. Empty until Nitzan links them.';

INSERT INTO mrv.agent_action_policies (action_name, mode, note)
SELECT v.action, 'auto', v.note FROM (VALUES
  ('link_agent_drive_folder', 'Same risk as link_farm_drive_folder, already auto — a human confirms the folder id by pasting it.'),
  ('list_agent_drive_documents', 'Read-only, same as list_farm_drive_documents.'),
  ('link_source_drive_folder', 'Same shape as link_agent_drive_folder — a human-confirmed id, not a search/guess.')
) AS v(action, note)
WHERE NOT EXISTS (SELECT 1 FROM mrv.agent_action_policies WHERE action_name = v.action);

UPDATE mrv.agents
   SET tools = tools || ARRAY['link_agent_drive_folder', 'list_agent_drive_documents']
 WHERE NOT ('link_agent_drive_folder' = ANY(tools));

UPDATE mrv.agents
   SET tools = tools || ARRAY['link_source_drive_folder']
 WHERE agent_id = 'john' AND NOT ('link_source_drive_folder' = ANY(tools));

-- migrate:down
UPDATE mrv.agents SET tools = array_remove(array_remove(tools, 'link_agent_drive_folder'), 'list_agent_drive_documents');
UPDATE mrv.agents SET tools = array_remove(tools, 'link_source_drive_folder') WHERE agent_id = 'john';
DELETE FROM mrv.agent_action_policies WHERE action_name IN ('link_agent_drive_folder', 'list_agent_drive_documents', 'link_source_drive_folder');
DROP TABLE IF EXISTS mrv.drive_source_folders;
ALTER TABLE mrv.agents DROP COLUMN IF EXISTS drive_folder_id;
