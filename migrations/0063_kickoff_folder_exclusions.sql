-- migrate:up
-- =====================================================================
-- 0063 — real, human-confirmed fact: the "Nitzan, Israel" subfolder
-- under FARMERS is demo data, not a real client onboarding, and must
-- never win the earliest-kick-off-date comparison
-- research_project_kickoff_date runs. Confirmed live: a first run of
-- that tool correctly found all 4 real dates but had no way to know
-- one of the four folders wasn't real — it picked "Nitzan, Israel"
-- (20-Jun-2026) as earliest, when the real earliest client onboarding
-- is Credible Bloom Farm (08-Jul-2026). Stored as a real Drive folder
-- id (not a name-substring guess, which breaks the moment a folder is
-- renamed), on the project row next to farmers_drive_folder_id itself
-- — the same place Rebeka already looks for where to search.
-- =====================================================================

ALTER TABLE mrv.projects
  ADD COLUMN IF NOT EXISTS excluded_kickoff_folder_ids text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN mrv.projects.excluded_kickoff_folder_ids IS
  'Drive folder ids under farmers_drive_folder_id that research_project_kickoff_date must skip — demo/test client folders confirmed by a person, never a real onboarding.';

UPDATE mrv.projects
   SET excluded_kickoff_folder_ids = ARRAY['1NXGWhimlLNUcBSInHxyCGzuOp8meBrtu']  -- "Nitzan, Israel" — confirmed demo data, not a real client
 WHERE project_id = 'CARBO-3988';

-- The value research_project_kickoff_date wrote the run before this fix
-- was real Drive content mis-scoped by an excluded demo folder, not a
-- fabricated number — but it's still wrong, and the tool's own
-- "only ever move earlier" guard (removed below) would otherwise never
-- let a corrected, later date replace it. Clearing it here lets the
-- next real run set the true value cleanly.
UPDATE mrv.projects SET project_start_date = NULL WHERE project_id = 'CARBO-3988';

-- migrate:down
ALTER TABLE mrv.projects DROP COLUMN IF EXISTS excluded_kickoff_folder_ids;
