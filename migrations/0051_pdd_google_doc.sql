-- migrate:up
-- =====================================================================
-- 0051 — sync_pdd_google_doc (Rebeka): the live PDD document.
--
-- generatePddDraft's output only ever lived in a <pre> block — read-only,
-- single-owner, unreachable by anyone but whoever clicked the button.
-- Nitzan asked directly: is there an online document he can open and
-- edit, that a VVB can eventually reach too? This is that document —
-- a real Google Doc, created from a real .docx (Drive's own conversion
-- reads Word heading styles into a real Docs outline) and kept in sync
-- with mrv on every call.
--
-- One Doc per project, not one per draft: mrv.projects gets the link,
-- not mrv.pdd_drafts, because there is exactly one live working document
-- per project, while pdd_drafts already accumulates a history of
-- point-in-time snapshots.
--
-- 'confirm': this writes a real file into the signed-in person's own
-- Drive, the same standing as centralize_farm_document (0032) — a
-- person should see it go out, not have an unattended agent action
-- surprise them with a new Doc in their Drive.
-- =====================================================================

ALTER TABLE mrv.projects
  ADD COLUMN google_doc_id  text,
  ADD COLUMN google_doc_url text;

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('sync_pdd_google_doc', 'confirm', 'Writes a real file into the signed-in person''s own Drive — a person should see it go out.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['sync_pdd_google_doc']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('sync_pdd_google_doc' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'sync_pdd_google_doc')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'sync_pdd_google_doc';

ALTER TABLE mrv.projects
  DROP COLUMN IF EXISTS google_doc_id,
  DROP COLUMN IF EXISTS google_doc_url;
