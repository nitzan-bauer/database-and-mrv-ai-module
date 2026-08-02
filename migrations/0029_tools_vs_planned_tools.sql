-- migrate:up
-- =====================================================================
-- 0029 — split an agent's tools into built vs planned, same as skills.
--
-- Migration 0024 seeded Dave with all six actions named in
-- mrv.agent_action_policies. Only two of them have code behind them:
-- propose_sampling_plan (createSamplingPlan.ts) and send_work_order
-- (issueWorkOrder.ts). run_model, recalibrate_model and issue_alerts have
-- a policy row and a place in the specification, and nothing else — no
-- DNDC/DayCent integration, no alerting mechanism.
--
-- That is the identical problem 0025 fixed for skills: a dashboard badge
-- reading "6 tools" where 3 exist reads as a fact and is not one, the
-- same failure mode as an emissions figure over invented inputs. So
-- `tools` now means what it always should have: callable today. A new
-- `planned_tools` holds the rest, exactly mirroring `planned_skills`.
--
-- 'chat' stays in `tools`. It is not a registry entry with its own
-- handler — it is the runtime's fallback path whenever the model answers
-- with text instead of invoking something, which every agent supports
-- the moment the runtime exists, without separate implementation.
--
-- The one place this changes behaviour: the runtime's tool registry
-- (Tier 2) offers a model only the actions in `tools`. Before this
-- migration, offering Dave's full array would have included three names
-- with no handler behind them — reachable in principle, broken in
-- practice the first time the model tried one.
-- =====================================================================

ALTER TABLE mrv.agents
  ADD COLUMN planned_tools text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN mrv.agents.planned_tools IS
  'Named in mrv.agent_action_policies or the specification but with no tool implementation yet. Mirrors planned_skills: the dashboard reports this as the gap, not as capability.';

UPDATE mrv.agents
   SET tools = ARRAY['propose_sampling_plan', 'send_work_order', 'chat'],
       planned_tools = ARRAY['run_model', 'recalibrate_model', 'issue_alerts']
 WHERE agent_id = 'dave';

-- migrate:down
UPDATE mrv.agents
   SET tools = ARRAY['propose_sampling_plan', 'send_work_order', 'run_model',
                      'recalibrate_model', 'issue_alerts', 'chat'],
       planned_tools = '{}'
 WHERE agent_id = 'dave';

ALTER TABLE mrv.agents DROP COLUMN IF EXISTS planned_tools;
