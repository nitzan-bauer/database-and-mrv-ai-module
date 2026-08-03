-- migrate:up
-- =====================================================================
-- 0034 — Dave's sixth skill: uncertainty_deduction.
--
-- The engine (VM0042 Eq. 74, web/src/lib/model/uncertainty.ts) has been
-- real and verified since Stage 6 — it is what the Model Run Console
-- already renders on screen. What was missing was the same thin wrapper
-- the GHG-Calculator pilot proved out: a declared tool over the existing
-- engine, fed real stored numbers, never a model guessing variance.
--
-- compute_uncertainty_deduction reads a farm's most recent *completed*
-- model run, area-weights mean net_t_ha/var_model/var_sampling across
-- its mrv.model_results (joined to mrv.strata for area_ha, exactly as
-- the Model Run Console does), and calls equation74. It is 'auto': read
-- and compute only, nothing written but the audit entry — the same
-- standing as run_plot_qa_qc.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('compute_uncertainty_deduction', 'auto', 'Read-only Eq. 74 computation over stored model results; commits nothing externally.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['compute_uncertainty_deduction']::text[],
       skills = skills || ARRAY['uncertainty_deduction']::text[],
       planned_skills = array_remove(planned_skills, 'uncertainty_deduction')
 WHERE agent_id = 'dave'
   AND NOT ('compute_uncertainty_deduction' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'compute_uncertainty_deduction'),
       skills = array_remove(skills, 'uncertainty_deduction'),
       planned_skills = planned_skills || ARRAY['uncertainty_deduction']::text[]
 WHERE agent_id = 'dave';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'compute_uncertainty_deduction';
