-- migrate:up
-- =====================================================================
-- 0021 — the rest of the now() collisions.
--
-- 0020 moved compliance_scores, compliance_checks and stratum_statistics
-- to clock_timestamp(). Checking the remaining timestamp columns turned up
-- two more with the identical defect: a UNIQUE constraint that includes
-- computed_at, defaulted to now(). Because now() is the transaction start
-- time, writing the same logical row twice in one transaction produces two
-- identical keys and the second insert fails on a constraint that was
-- meant to prevent duplicate *results*, not duplicate *attempts*.
--
--   mrv.emission_results  UNIQUE (activity_data_id, parameter_set_id, computed_at)
--   mrv.esm_soc_stocks    UNIQUE (stratum_id, cycle_id, scenario, computed_at)
--
-- mrv.model_results also defaults to now() but carries no UNIQUE over the
-- column, so it has no collision to fix and is deliberately left alone.
--
-- These columns record when a figure was computed. clock_timestamp() is
-- what that sentence means; now() means when the surrounding transaction
-- opened, which for a long batch can be minutes earlier.
-- =====================================================================

ALTER TABLE mrv.emission_results
  ALTER COLUMN computed_at SET DEFAULT clock_timestamp();
ALTER TABLE mrv.esm_soc_stocks
  ALTER COLUMN computed_at SET DEFAULT clock_timestamp();

COMMENT ON COLUMN mrv.emission_results.computed_at IS
  'When this result was actually computed (clock_timestamp, not transaction start), so recomputing within one transaction yields distinct rows rather than a unique violation.';
COMMENT ON COLUMN mrv.esm_soc_stocks.computed_at IS
  'When this stock was actually computed (clock_timestamp, not transaction start), so recomputing within one transaction yields distinct rows rather than a unique violation.';

-- migrate:down
ALTER TABLE mrv.esm_soc_stocks   ALTER COLUMN computed_at SET DEFAULT now();
ALTER TABLE mrv.emission_results ALTER COLUMN computed_at SET DEFAULT now();
