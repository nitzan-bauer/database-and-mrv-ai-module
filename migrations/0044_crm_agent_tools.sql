-- =====================================================================
-- 0044 · CRM tools for Jennifer and Ron
--
-- These four tools (record_lead, update_lead_stage, add_follow_up,
-- draft_outreach_message) live in web/src/lib/tools/*.ts and write to the
-- crm schema via web/src/lib/crmDb.ts — a separate pool onto the same RDS
-- instance, scoped to crm,public. Their governance (crm.agent_action_
-- policies) lives in the carbonature-crm repo's own migrations, not here:
-- mrv.agent_action_policies gets no new rows from this migration.
--
-- With real tools behind them, crm_hygiene (Jennifer) and farmer_funnel /
-- buyer_funnel (Ron) move from planned to built — they are exactly what
-- these four tools do: keeping lead/customer records current and moving
-- leads through the pipeline. ai_sdr_campaigns, onboard_new_client,
-- content_and_seo (Ron) and scheduling, board_protocol (Jennifer) stay
-- planned: they need the HubSpot webhook receiver, Drive/registration
-- work, or Calendar integration this migration does not touch.
-- =====================================================================

-- migrate:up

UPDATE mrv.agents
  SET tools = tools || ARRAY['record_lead', 'update_lead_stage', 'add_follow_up', 'draft_outreach_message']
  WHERE agent_id IN ('jennifer', 'ron');

UPDATE mrv.agents
  SET skills = skills || ARRAY['crm_hygiene'],
      planned_skills = array_remove(planned_skills, 'crm_hygiene')
  WHERE agent_id = 'jennifer';

UPDATE mrv.agents
  SET skills = skills || ARRAY['farmer_funnel', 'buyer_funnel'],
      planned_skills = array_remove(array_remove(planned_skills, 'farmer_funnel'), 'buyer_funnel')
  WHERE agent_id = 'ron';

-- migrate:down

UPDATE mrv.agents
  SET tools = array_remove(array_remove(array_remove(array_remove(tools,
        'record_lead'), 'update_lead_stage'), 'add_follow_up'), 'draft_outreach_message')
  WHERE agent_id IN ('jennifer', 'ron');

UPDATE mrv.agents
  SET skills = array_remove(skills, 'crm_hygiene'),
      planned_skills = planned_skills || ARRAY['crm_hygiene']
  WHERE agent_id = 'jennifer';

UPDATE mrv.agents
  SET skills = array_remove(array_remove(skills, 'farmer_funnel'), 'buyer_funnel'),
      planned_skills = planned_skills || ARRAY['farmer_funnel', 'buyer_funnel']
  WHERE agent_id = 'ron';
