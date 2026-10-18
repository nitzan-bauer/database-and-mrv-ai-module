-- migrate:up
-- =====================================================================
-- 0116 — Phase 2 of the GHG Calculator web migration: activating
-- mrv.leakage §8.4.1 (New/additional organic amendments, eq 33) in
-- practice, per the Excel workbook's real formula:
--   LE = MAX(0, project_avg_mass_t - baseline_avg_mass_t) * carbon_content * 0.12 * 44/12
-- mrv.fertilizer_applications tracks n_content (for N2O accounting) but
-- has no carbon-content field, which eq 33 needs and the N2O side
-- never did. Nullable: only organic fertilizer rows populate it: NULL
-- for synthetic fertilizer, where §8.4.1 does not apply.
-- =====================================================================

ALTER TABLE mrv.fertilizer_applications
  ADD COLUMN carbon_content numeric(6,4)
    CHECK (carbon_content IS NULL OR (carbon_content >= 0 AND carbon_content <= 1));

COMMENT ON COLUMN mrv.fertilizer_applications.carbon_content IS
  'Fraction (t C / t material), organic fertilizer only. VM0042 §8.4.1 eq 33 leakage input. NULL for synthetic fertilizer.';

-- migrate:down
ALTER TABLE mrv.fertilizer_applications DROP COLUMN carbon_content;
