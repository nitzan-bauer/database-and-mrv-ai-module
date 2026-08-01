-- migrate:up
-- =====================================================================
-- 0025 — skills on the agent registry.
--
-- Spec §13 Screen A puts a "skills · tools" badge on every agent block.
-- The mockup shows aspirational counts — John 12 skills / 9 tools, Dave
-- 9 / 8 — describing the department once it is finished.
--
-- This column holds what has actually been built. The dashboard reports the
-- real number and, separately, what is planned, because a control tower
-- showing "Dave: 9 skills" when one exists is the same failure as an
-- emissions figure over invented inputs: it reads as a fact and is not one.
-- The whole point of the screen is that John can see where the department
-- actually stands.
--
-- Skills are a distinct thing from tools. A tool is a write into the
-- database, governed by mrv.agent_action_policies. A skill is a body of
-- method the agent applies — how to stratify, how to run DNDC, how to write
-- a PDD — and it changes nothing on its own.
-- =====================================================================

ALTER TABLE mrv.agents
  ADD COLUMN skills         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN planned_skills text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN mrv.agents.skills IS
  'Skills that exist and run today. Not the specification target — the dashboard reports this as the real number.';
COMMENT ON COLUMN mrv.agents.planned_skills IS
  'Named in the specification but not yet built. Shown separately so the gap between plan and state stays visible rather than being averaged away.';

-- ---- what exists today -----------------------------------------------
-- Dave's GHG-Calculator skill was built as the Tier-1 pilot
-- (web/src/lib/ghg/skill.ts) and runs over the same engine the screens use.
UPDATE mrv.agents SET skills = '{ghg_calculator}' WHERE agent_id = 'dave';

-- ---- what the specification calls for ---------------------------------
UPDATE mrv.agents SET planned_skills =
  '{stratification,baseline_definition,dndc,daycent,uncertainty_deduction,soc_datasheet,vvb_liaison,mvr_ime_signoff}'
  WHERE agent_id = 'dave';
UPDATE mrv.agents SET planned_skills =
  '{pdd_generator,additionality,grouped_project_design,kmz_preparation,public_comment,vvb_validation_liaison}'
  WHERE agent_id = 'reveka';
UPDATE mrv.agents SET planned_skills =
  '{pipeline_control,forecast_vs_actual,credit_allocation_qa,verra_benchmarking,ceo_reporting}'
  WHERE agent_id = 'john';
UPDATE mrv.agents SET planned_skills =
  '{farmer_funnel,buyer_funnel,onboard_new_client,ai_sdr_campaigns,content_and_seo}'
  WHERE agent_id = 'ron';
UPDATE mrv.agents SET planned_skills =
  '{document_centralisation,crm_hygiene,scheduling,board_protocol}'
  WHERE agent_id = 'jennifer';

-- migrate:down
ALTER TABLE mrv.agents DROP COLUMN IF EXISTS planned_skills;
ALTER TABLE mrv.agents DROP COLUMN IF EXISTS skills;
