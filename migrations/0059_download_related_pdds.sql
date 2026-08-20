-- migrate:up
-- =====================================================================
-- 0059 — download_related_pdds (Rebeka).
--
-- Real files, not links. Found by live network inspection of Verra's
-- registry SPA (registry.verra.org — client-rendered, unreadable by a
-- plain GET) down to the actual unauthenticated backend on
-- prod-us.api.platts.com: getProjectById returns each document's real
-- id and filename, POST downloadDocumentById returns the real bytes.
-- Same backend and header family search_verra_registry.ts already uses.
--
-- Writes real files into a project's own Drive folder, under a new
-- "RELATED PDDS" subfolder — commits nothing to Verra, reads only. 'auto'
-- like every other Drive-writing research step in this build.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note)
VALUES ('download_related_pdds', 'auto',
        'Downloads real documents from Verra''s public registry into the project''s Drive folder. No external write, nothing sent to Verra.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = array_append(tools, 'download_related_pdds')
 WHERE agent_id = 'rebeka' AND NOT ('download_related_pdds' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'download_related_pdds')
 WHERE agent_id = 'rebeka';
DELETE FROM mrv.agent_action_policies WHERE action_name = 'download_related_pdds';
