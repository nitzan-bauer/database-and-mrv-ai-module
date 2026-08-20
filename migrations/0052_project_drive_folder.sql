-- migrate:up
-- =====================================================================
-- 0052 — a project-level Drive folder, shared by the PDD Google Doc and
-- the (upcoming) PDD Readiness Report — both belong next to each other,
-- not scattered across Drive root. Farms already have drive_folder_id
-- (0032); this is the same idea one level up, for project-scoped
-- documents rather than farm-scoped ones.
-- =====================================================================

ALTER TABLE mrv.projects ADD COLUMN drive_folder_id text;

-- migrate:down
ALTER TABLE mrv.projects DROP COLUMN IF EXISTS drive_folder_id;
