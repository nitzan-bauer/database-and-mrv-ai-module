-- migrate:up
-- =====================================================================
-- 0062 — GHG reduction draft estimates (Section 1.10 "Summary of
--         Estimated Reductions and Removals") + the real Project Start
--         Date, distinct from the crediting period start.
--
-- Two separate, real gaps Nitzan named directly:
--
-- 1. The GHG reductions table has one real number per vintage year (the
--    founder's own draft total) and nothing else — no baseline/project/
--    leakage/removals breakdown exists yet (no VM0042 model run). Stored
--    here with an explicit `source` so a person reading the DB later can
--    tell "typed in by Nitzan" apart from "continued at the last given
--    rate" — never silently blurred together, and never a number that
--    LOOKS real without being traceable to one of those two origins.
--
-- 2. mrv.projects.crediting_start is a Verra-defined date (can land after
--    real activity begins) — it was wrongly reused for "Project Start
--    Date" (section 1.8), a genuinely different fact: when farmer
--    onboarding actually began. project_start_date is set from the
--    earliest Project Kick-off Meeting report found in the FARMERS Drive
--    folder — a real document date, not a guess — via
--    research_project_kickoff_date (registered below).
-- =====================================================================

ALTER TABLE mrv.projects
  ADD COLUMN IF NOT EXISTS project_start_date date,
  ADD COLUMN IF NOT EXISTS farmers_drive_folder_id text;

COMMENT ON COLUMN mrv.projects.project_start_date IS
  'When project activities actually began (earliest real Project Kick-off Meeting date) — distinct from crediting_start, which is a Verra-defined date that can land later.';
COMMENT ON COLUMN mrv.projects.farmers_drive_folder_id IS
  'Drive folder id of the parent folder holding one subfolder per farmer/client, each with its own Project Kick-off Meeting report — set once so Rebeka knows where to look, not re-asked per run.';

UPDATE mrv.projects
   SET farmers_drive_folder_id = '1YoyZRfnRQF28I5iEdLM8jspi3Dv9mgPN'
 WHERE project_id = 'CARBO-3988';

CREATE TABLE mrv.ghg_reduction_estimates (
  project_id         text NOT NULL REFERENCES mrv.projects (project_id),
  vintage_year        int NOT NULL,
  total_net_reductions_tco2e numeric NOT NULL,
  source              text NOT NULL CHECK (source IN ('human_provided', 'extrapolated')),
  extrapolation_rule  text,
  noted_by            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, vintage_year)
);

COMMENT ON TABLE mrv.ghg_reduction_estimates IS
  'One draft total tCO2e figure per vintage year for the Estimated GHG Emission Reductions and Removals table (1.10). source distinguishes what the founder actually typed from what was mechanically continued at his own stated rate — never blurred together.';

INSERT INTO mrv.ghg_reduction_estimates (project_id, vintage_year, total_net_reductions_tco2e, source, noted_by)
VALUES
  ('CARBO-3988', 2026, 20000, 'human_provided', 'human:nitzan@carbonature.io'),
  ('CARBO-3988', 2027, 50000, 'human_provided', 'human:nitzan@carbonature.io'),
  ('CARBO-3988', 2028, 100000, 'human_provided', 'human:nitzan@carbonature.io'),
  ('CARBO-3988', 2029, 150000, 'human_provided', 'human:nitzan@carbonature.io'),
  ('CARBO-3988', 2030, 150000, 'human_provided', 'human:nitzan@carbonature.io'),
  ('CARBO-3988', 2031, 150000, 'human_provided', 'human:nitzan@carbonature.io')
ON CONFLICT (project_id, vintage_year) DO UPDATE SET
  total_net_reductions_tco2e = excluded.total_net_reductions_tco2e,
  source = excluded.source,
  noted_by = excluded.noted_by,
  updated_at = clock_timestamp();

INSERT INTO mrv.agent_action_policies (action_name, mode, note)
VALUES ('research_project_kickoff_date', 'auto',
        'Scans the project''s own FARMERS Drive folder for Project Kick-off Meeting reports and records the earliest real date found. No external write, no invented data.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = array_append(tools, 'research_project_kickoff_date')
 WHERE agent_id = 'rebeka' AND NOT ('research_project_kickoff_date' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'research_project_kickoff_date')
 WHERE agent_id = 'rebeka';
DELETE FROM mrv.agent_action_policies WHERE action_name = 'research_project_kickoff_date';
DROP TABLE IF EXISTS mrv.ghg_reduction_estimates;
ALTER TABLE mrv.projects
  DROP COLUMN IF EXISTS project_start_date,
  DROP COLUMN IF EXISTS farmers_drive_folder_id;
