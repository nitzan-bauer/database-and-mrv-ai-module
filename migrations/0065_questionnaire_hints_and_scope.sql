-- migrate:up
-- =====================================================================
-- 0065 — question_hint on the structured PDD questionnaire.
--
-- mrv.pdd_section_status rows only ever carried a section TITLE, not a
-- concrete question — a person opening a pending "Risks to Stakeholders
-- and the Environment" row has to work out for themselves what a short,
-- honest answer looks like. This adds one plain-language hint per row,
-- shown next to the title, for the five sections Nitzan asked to make
-- easy to answer next (live, this session) — real, current pending
-- sections in CARBO-3988's own questionnaire, not invented placeholders.
-- =====================================================================

ALTER TABLE mrv.pdd_section_status
  ADD COLUMN IF NOT EXISTS question_hint text;

COMMENT ON COLUMN mrv.pdd_section_status.question_hint IS
  'A short, concrete question shown next to the section title — for a pending section where the template''s own guidance text alone is not enough to know what a quick answer looks like.';

UPDATE mrv.pdd_section_status SET question_hint =
  'How did you identify the stakeholders affected by this project (neighbouring communities, farm workers)? One sentence is enough.'
WHERE project_id = 'CARBO-3988' AND section_index = 39;

UPDATE mrv.pdd_section_status SET question_hint =
  'Any known environmental or social risk right now (e.g. water-use conflict, land dispute)? If none, say "none identified".'
WHERE project_id = 'CARBO-3988' AND section_index = 45;

UPDATE mrv.pdd_section_status SET question_hint =
  'Does CarboNature have (or plan) a grievance process for farmers to raise concerns? Yes/No, one line.'
WHERE project_id = 'CARBO-3988' AND section_index = 48;

UPDATE mrv.pdd_section_status SET question_hint =
  'Which SOC measurement technique do you actually use (e.g. dry combustion, LOI)? One line.'
WHERE project_id = 'CARBO-3988' AND section_index = 82;

UPDATE mrv.pdd_section_status SET question_hint =
  'Do you have a target/expected total tCO2e for the full 20-year crediting period, to sanity-check the draft-estimate extrapolation in section 1.10?'
WHERE project_id = 'CARBO-3988' AND section_index = 71;

-- migrate:down
ALTER TABLE mrv.pdd_section_status DROP COLUMN IF EXISTS question_hint;
