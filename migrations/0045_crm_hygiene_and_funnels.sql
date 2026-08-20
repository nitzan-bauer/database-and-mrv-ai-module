-- =====================================================================
-- 0045 · crm_hygiene (Jennifer) + farmer_funnel/buyer_funnel (Ron) tools
--
-- 0044 moved these three skills from planned to built and added the four
-- generic write-side CRM tools, but never added the READ-side tools these
-- specific skills actually need — crm_hygiene needs a dedup/staleness/
-- completeness QA tool, farmer_funnel/buyer_funnel need a count-per-stage
-- tool. Neither existed until now (web/src/lib/tools/checkCrmHygiene.ts,
-- web/src/lib/tools/getCrmFunnel.ts). This migration only adds them to
-- tools — skills/planned_skills were already correct as of 0044.
--
-- Governance for these three, like the 0044 four, lives in the
-- carbonature-crm repo's own crm.agent_action_policies, not mrv's.
-- =====================================================================

-- migrate:up

UPDATE mrv.agents
  SET tools = tools || ARRAY['crm_hygiene']
  WHERE agent_id = 'jennifer';

UPDATE mrv.agents
  SET tools = tools || ARRAY['farmer_funnel', 'buyer_funnel']
  WHERE agent_id = 'ron';

-- migrate:down

UPDATE mrv.agents
  SET tools = array_remove(tools, 'crm_hygiene')
  WHERE agent_id = 'jennifer';

UPDATE mrv.agents
  SET tools = array_remove(array_remove(tools, 'farmer_funnel'), 'buyer_funnel')
  WHERE agent_id = 'ron';
