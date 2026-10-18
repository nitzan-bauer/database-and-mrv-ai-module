-- migrate:up
-- =====================================================================
-- 0124 — Phase 6 of the GHG Calculator web migration: close the gap
-- Explore found at the very start of this work — ghg/skill.ts's 4
-- GHG_TOOLS (compute_farm_year, explain_farm_year, compute_reduction,
-- explain_parameters) were declared metadata only, never registered in
-- TOOL_REGISTRY or granted to Dave, despite his own role_prompt claiming
-- "a GHG-Calculator skill that runs the whole workbook end to end" all
-- along. Registered in ghgSkillTools.ts, calling the exact same
-- engine.ts/skill.ts functions /ghg itself calls.
--
-- Also corrects role_prompt's own overclaim, found while writing this:
-- it described the VCU roll-up as including "AFOLU buffer withholding",
-- which was never true — that is compute_uncertainty_deduction's own
-- separate step for the QA1 model-run pathway, unconnected to this
-- Approach-3 calculator's roll-up (aggregateProjectReduction), which is
-- explicitly labelled "pre-verification" in the UI for exactly this
-- reason. Phase 6's own instruction was to describe what exists after
-- phases 1-5, not before — this line described something that was
-- never built.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('compute_farm_year', 'auto', 'Read-only computation, no side effects.'),
  ('explain_farm_year', 'auto', 'Read-only computation, no side effects.'),
  ('compute_reduction', 'auto', 'Read-only computation, no side effects.'),
  ('explain_parameters', 'auto', 'Read-only computation, no side effects.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['compute_farm_year', 'explain_farm_year', 'compute_reduction', 'explain_parameters']::text[]
 WHERE agent_id = 'dave'
   AND NOT ('compute_farm_year' = ANY (tools));

UPDATE mrv.agents
   SET role_prompt = REPLACE(
     role_prompt,
     'the QA3-vs-QA1 soil-N2O double-counting switch, leakage, and the roll-up to estimated VCUs with AFOLU buffer withholding.',
     'the QA3-vs-QA1 soil-N2O double-counting switch, §8.4.1 leakage computed automatically from activity data (§8.4.2-8.4.4 entered with justification), and the project-wide roll-up to a pre-verification VCU estimate — before any buffer or uncertainty deduction, which is compute_uncertainty_deduction''s own separate step for the QA1 pathway, not part of this roll-up. The skill itself is now backed by real tools: compute_farm_year and explain_farm_year for one farm-year, compute_reduction and explain_parameters for the baseline-vs-project comparison and the resolved factors behind it — the same functions the /ghg page itself calls, so you and the page can never disagree on a number.'
   )
 WHERE agent_id = 'dave';

-- migrate:down
UPDATE mrv.agents
   SET role_prompt = REPLACE(
     role_prompt,
     'the QA3-vs-QA1 soil-N2O double-counting switch, §8.4.1 leakage computed automatically from activity data (§8.4.2-8.4.4 entered with justification), and the project-wide roll-up to a pre-verification VCU estimate — before any buffer or uncertainty deduction, which is compute_uncertainty_deduction''s own separate step for the QA1 pathway, not part of this roll-up. The skill itself is now backed by real tools: compute_farm_year and explain_farm_year for one farm-year, compute_reduction and explain_parameters for the baseline-vs-project comparison and the resolved factors behind it — the same functions the /ghg page itself calls, so you and the page can never disagree on a number.',
     'the QA3-vs-QA1 soil-N2O double-counting switch, leakage, and the roll-up to estimated VCUs with AFOLU buffer withholding.'
   )
 WHERE agent_id = 'dave';

UPDATE mrv.agents
   SET tools = array_remove(array_remove(array_remove(array_remove(tools,
         'compute_farm_year'), 'explain_farm_year'), 'compute_reduction'), 'explain_parameters')
 WHERE agent_id = 'dave';

DELETE FROM mrv.agent_action_policies
 WHERE action_name IN ('compute_farm_year', 'explain_farm_year', 'compute_reduction', 'explain_parameters');
