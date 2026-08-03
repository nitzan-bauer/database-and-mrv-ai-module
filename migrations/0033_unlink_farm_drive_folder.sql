-- migrate:up
-- =====================================================================
-- 0033 — undo a Drive folder link.
--
-- Needed the same day 0032 shipped: a demo farm got linked to a real
-- prospective client's folder to prove the OAuth/Drive integration
-- actually worked end to end, and that link needed clearing immediately
-- once it did — a demo farm's boundary has no business pointing at a
-- real (not yet onboarded) client's document folder. 'auto', same
-- standing as link_farm_drive_folder: it only clears a mapping, nothing
-- in Drive itself is touched.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('unlink_farm_drive_folder', 'auto', 'Clears a mapping; touches nothing in Drive itself.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['unlink_farm_drive_folder']::text[]
 WHERE agent_id = 'jennifer'
   AND NOT ('unlink_farm_drive_folder' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'unlink_farm_drive_folder')
 WHERE agent_id = 'jennifer';
DELETE FROM mrv.agent_action_policies WHERE action_name = 'unlink_farm_drive_folder';
