-- migrate:up
-- =====================================================================
-- 0036 — John's first two skills: pipeline_control and ceo_reporting.
--
-- Both are read-only aggregations of numbers this build already computes
-- correctly and shows on screen — creditPipeline(), listAgents(),
-- listAuditLog() filtered to agent actors — packaged as declared tools
-- rather than recomputed. get_pipeline_status is creditPipeline() as-is;
-- get_department_report adds the same built/planned/action-count
-- reductions the control-tower page itself uses, so a report from John
-- can never disagree with what a person sees on the dashboard.
--
-- Both are 'auto': read-only, nothing written but the audit entry.
--
-- forecast_vs_actual, credit_allocation_qa and verra_benchmarking stay
-- planned — none has a real engine or data source behind it yet.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('get_pipeline_status',   'auto', 'Read-only aggregation; commits nothing externally.'),
  ('get_department_report', 'auto', 'Read-only aggregation; commits nothing externally.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['get_pipeline_status', 'get_department_report']::text[],
       skills = skills || ARRAY['pipeline_control', 'ceo_reporting']::text[],
       planned_skills = array_remove(array_remove(planned_skills,
         'pipeline_control'), 'ceo_reporting')
 WHERE agent_id = 'john'
   AND NOT ('get_pipeline_status' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(array_remove(tools,
         'get_pipeline_status'), 'get_department_report'),
       skills = array_remove(array_remove(skills,
         'pipeline_control'), 'ceo_reporting'),
       planned_skills = planned_skills || ARRAY['pipeline_control', 'ceo_reporting']::text[]
 WHERE agent_id = 'john';

DELETE FROM mrv.agent_action_policies WHERE action_name IN ('get_pipeline_status', 'get_department_report');
