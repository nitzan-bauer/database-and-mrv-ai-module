-- migrate:up
-- =====================================================================
-- 0038 — Dave's mvr_ime_signoff skill: record_mvr_signoff.
--
-- mrv.mvr has existed since Stage 6 (migration 0015) with the real
-- VMD0053 §5.2 fields — nothing was ever fabricated here, the table
-- simply had no tool writing to it. record_mvr_signoff computes
-- bias_within_pmu and coverage_pass from whatever inputs are given
-- (both stated plainly in VMD0053, not judgement calls) and enforces
-- ime_contracted_by = 'VVB' — the single most misunderstood point in
-- VMD0053 (§5's whole point is the IME is hired by the VVB, never the
-- proponent), so accepting anything else here would mean recording
-- exactly the violation the check exists to catch.
--
-- 'confirm': the most consequential record in the QA1 chain — a VVB
-- reads this to decide whether a run's SOC change can be claimed at
-- all, materially higher-stakes even than ingest_model_results.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('record_mvr_signoff', 'confirm', 'The record a VVB reads to decide whether a run''s SOC change can be claimed; a person must confirm before it is entered.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['record_mvr_signoff']::text[],
       skills = skills || ARRAY['mvr_ime_signoff']::text[],
       planned_skills = array_remove(planned_skills, 'mvr_ime_signoff')
 WHERE agent_id = 'dave'
   AND NOT ('record_mvr_signoff' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'record_mvr_signoff'),
       skills = array_remove(skills, 'mvr_ime_signoff'),
       planned_skills = planned_skills || ARRAY['mvr_ime_signoff']::text[]
 WHERE agent_id = 'dave';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'record_mvr_signoff';
