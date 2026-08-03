-- migrate:up
-- =====================================================================
-- 0037 — Dave's ingest_model_results tool.
--
-- dndc and daycent stay in planned_skills: this repo has never had
-- access to either model, so actually running one is still refused —
-- building that "skill" today would mean faking a scientific result,
-- same as every other refusal in this build. What this tool does
-- instead is the one honest step available: ingest a run that already
-- happened outside this repo. It never simulates or computes a
-- stock-change figure; it records one a real external run produced,
-- with the run's own output file kept as source evidence, mirroring
-- ingestLabResults's relationship to a lab's own workbook.
--
-- 'confirm', not 'auto': mrv.model_results is append-only and feeds
-- directly into the Eq. 74 deduction and eventually a credit claim —
-- a materially higher-stakes write than a working row like
-- record_baseline_site, so a person should see it land.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('ingest_model_results', 'confirm', 'Writes an append-only model run and results from an external model; a person should confirm before it enters the quantification chain.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['ingest_model_results']::text[]
 WHERE agent_id = 'dave'
   AND NOT ('ingest_model_results' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'ingest_model_results')
 WHERE agent_id = 'dave';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'ingest_model_results';
