-- migrate:up
-- =====================================================================
-- 0032 — Jennifer's first real skill: document_centralisation, over the
-- actual Google Drive folders the team already uses (see the client-
-- folder convention: tree crops -> fruit-plantations, open-field crops
-- -> farming project E.Africa, each farm named "<farm>, <country>").
--
-- This does not guess or create that folder structure. mrv.farms gets
-- one nullable column, drive_folder_id: a farm's folder is linked once,
-- explicitly, by whoever already has it open in Drive and copies its id
-- — the same discipline as everywhere else in this build that refuses
-- to invent structure it cannot verify (VM0042 Table 7 criteria, the PDD
-- template outline). Once linked, the folder is verified to exist and be
-- reachable before it is trusted for anything.
--
-- Three tools, three different standing:
--   - link_farm_drive_folder: records a mapping a person already
--     confirmed by hand. 'auto' — the same standing as recording a
--     baseline site's criteria.
--   - list_farm_drive_documents: read-only. 'auto'.
--   - centralize_farm_document: writes a real file into the team's
--     Drive. 'confirm' — the same standing as export_plots_kmz and
--     generate_pdd_draft, both of which also produce something that
--     leaves this system.
-- =====================================================================

ALTER TABLE mrv.farms ADD COLUMN drive_folder_id text;

COMMENT ON COLUMN mrv.farms.drive_folder_id IS
  'The Google Drive folder id already holding this farm''s documents, linked by a person via link_farm_drive_folder — never inferred or created by guessing at folder structure.';

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('link_farm_drive_folder', 'auto', 'Records a mapping a person already confirmed by hand; commits nothing externally.'),
  ('list_farm_drive_documents', 'auto', 'Read-only.'),
  ('centralize_farm_document', 'confirm', 'Writes a real file into the team''s Drive — a person should see it go out.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['link_farm_drive_folder', 'list_farm_drive_documents', 'centralize_farm_document']::text[],
       skills = skills || ARRAY['document_centralisation']::text[],
       planned_skills = array_remove(planned_skills, 'document_centralisation')
 WHERE agent_id = 'jennifer'
   AND NOT ('link_farm_drive_folder' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(array_remove(array_remove(tools,
         'link_farm_drive_folder'), 'list_farm_drive_documents'), 'centralize_farm_document'),
       skills = array_remove(skills, 'document_centralisation'),
       planned_skills = planned_skills || ARRAY['document_centralisation']::text[]
 WHERE agent_id = 'jennifer';

DELETE FROM mrv.agent_action_policies
 WHERE action_name IN ('link_farm_drive_folder', 'list_farm_drive_documents', 'centralize_farm_document');

ALTER TABLE mrv.farms DROP COLUMN IF EXISTS drive_folder_id;
