-- migrate:up
-- =====================================================================
-- 0039 — John's third skill: credit_allocation_qa.
--
-- The same standing as Rebeka's run_plot_qa_qc: read-only checks over
-- real rows already in mrv.credits and mrv.vcu_issuances (demo rows
-- excluded, matching mrv.v_plot_credits's own convention) — application
-- area vs plot area, duplicate plot/activity/vintage combinations,
-- issued credits with no vintage_year, and VCUs issued beyond what a
-- vintage's own issued/retired/sold credits support. None of it needs
-- a model; every figure is arithmetic over rows that already exist.
--
-- 'auto': read-only reporting, the same standing as run_plot_qa_qc and
-- get_pipeline_status.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('credit_allocation_qa', 'auto', 'Read-only check over mrv.credits/vcu_issuances; commits nothing externally.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['credit_allocation_qa']::text[],
       skills = skills || ARRAY['credit_allocation_qa']::text[],
       planned_skills = array_remove(planned_skills, 'credit_allocation_qa')
 WHERE agent_id = 'john'
   AND NOT ('credit_allocation_qa' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'credit_allocation_qa'),
       skills = array_remove(skills, 'credit_allocation_qa'),
       planned_skills = planned_skills || ARRAY['credit_allocation_qa']::text[]
 WHERE agent_id = 'john';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'credit_allocation_qa';
