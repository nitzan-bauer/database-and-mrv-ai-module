-- migrate:up
-- =====================================================================
-- 0112 — Nitzan's own request: give John a real "go into websites,
-- download documents, sort them into folders" capability, with the
-- sorting criteria left for him to define per use in chat later —
-- deliberately not hardcoded here.
--
-- browse_website already exists (0095, granted to Rebeka/Dave) — same
-- read-only, same-origin multi-page crawl, same 'auto' risk profile,
-- just extended to John too rather than rebuilt.
--
-- download_document_to_agent_folder (new) is the download-and-place
-- half: fetches one https:// URL's real bytes (reusing fetchPublicUrl's
-- own SSRF/https-only check) and saves it as a real file — not a
-- shortcut — into a named agent's own Drive folder. 'auto': a human
-- names both the exact URL and the destination agent in the call, the
-- same shape as every other Drive-write tool in this codebase
-- (link_agent_drive_folder, download's own sibling john_drive_sorting_
-- round's copyDriveFile/uploadFileToDriveFolder calls).
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('download_document_to_agent_folder', 'auto', 'A human names the exact URL and destination agent in the call — same shape as every other Drive-write tool.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['browse_website', 'download_document_to_agent_folder']::text[]
 WHERE agent_id = 'john'
   AND NOT ('browse_website' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(array_remove(tools, 'browse_website'), 'download_document_to_agent_folder')
 WHERE agent_id = 'john';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'download_document_to_agent_folder';
