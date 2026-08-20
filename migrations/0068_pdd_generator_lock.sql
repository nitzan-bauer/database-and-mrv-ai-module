-- migrate:up
-- =====================================================================
-- 0068 — PDD Generator gate + one-time lock (Nitzan's own spec, live
-- this session): "the control is inactive unless it received all the
-- answers to the questionnaire", and "cannot return to this
-- questionnaire after clicking PDD GENERATOR — can still view answers".
--
-- One project-level timestamp is enough for that: NULL means the
-- questionnaire is still open for edits and the Generator hasn't run;
-- set means it has, and the questionnaire page renders read-only from
-- here on. Not a boolean — keeping *when* it ran is free and useful
-- (e.g. "why does this project's PDD look frozen since March").
-- =====================================================================

ALTER TABLE mrv.projects
  ADD COLUMN IF NOT EXISTS pdd_generator_locked_at timestamptz;

COMMENT ON COLUMN mrv.projects.pdd_generator_locked_at IS
  'Set once run_pdd_generator_pipeline succeeds — the SEED questionnaire becomes view-only from this point on.';

-- migrate:down
ALTER TABLE mrv.projects
  DROP COLUMN IF EXISTS pdd_generator_locked_at;
