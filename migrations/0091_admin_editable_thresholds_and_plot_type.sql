-- migrate:up
-- =====================================================================
-- 0091 — Admin-editable negative-balance thresholds + per-farm plot-type
-- override (young vs. mature orchard), per Nitzan's explicit request
-- (2026-09-01): "I want the threshold values AND the credit-yield
-- potential to be admin-editable, and I want to decide per farm whether
-- it's a young or mature orchard, as admin."
--
-- Two independent additions:
--  1. mrv.negative_balance_settings — the 30%/20% thresholds (Section
--     7.3) were hardcoded literals in negativeBalance.ts; now a real,
--     admin-editable settings table, same pattern as 0085's
--     credit_yield_rate_table (super_admin-gated /admin panel).
--  2. mrv.farms.plot_type_override — until now, plot type (open_field /
--     young_orchard / mature_orchard) was resolved ONLY from
--     mrv.project_plot_type_defaults, a per-PROJECT constant — there was
--     no per-farm distinction anywhere, and "mature_orchard" was a rate-
--     table row nothing ever actually assigned. This column lets an
--     admin override the project default for one specific farm; NULL
--     (the default for every existing farm) falls back to the project's
--     default exactly as before — a real, additive change, no farm's
--     resolved plot type changes today.
-- =====================================================================

CREATE TABLE mrv.negative_balance_settings (
  setting_key    text PRIMARY KEY CHECK (setting_key IN ('alert_threshold_pct', 'block_threshold_pct')),
  threshold_pct  integer NOT NULL CHECK (threshold_pct > 0 AND threshold_pct < 100),
  updated_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mrv.negative_balance_settings (setting_key, threshold_pct, updated_by) VALUES
  ('alert_threshold_pct', 30, 'system:migration_0091'),
  ('block_threshold_pct', 20, 'system:migration_0091');

COMMENT ON TABLE mrv.negative_balance_settings IS
  'Section 7.3''s alert/block thresholds — admin-editable via /admin (super_admin only), read live by allocationBook/negativeBalance.ts. Was hardcoded 30/20 until 2026-09-01.';

-- The 0090 CHECK on negative_balance_flags.threshold_pct assumed the only
-- possible values were the hardcoded 30/20 — now that an admin can set
-- any threshold, widen it to match negative_balance_settings' own range
-- check instead of an exact-value enum.
ALTER TABLE mrv.negative_balance_flags DROP CONSTRAINT negative_balance_flags_threshold_pct_check;
ALTER TABLE mrv.negative_balance_flags ADD CONSTRAINT negative_balance_flags_threshold_pct_check
  CHECK (threshold_pct > 0 AND threshold_pct < 100);

ALTER TABLE mrv.farms ADD COLUMN plot_type_override text REFERENCES mrv.credit_yield_rate_table (plot_type);

COMMENT ON COLUMN mrv.farms.plot_type_override IS
  'Admin-set override (super_admin, /admin panel) of this farm''s plot type for credit-yield purposes — young_orchard vs. mature_orchard is a real, meaningful distinction (9 vs. 3 tCO2e/ha) with no other signal to derive it from. NULL (every farm today) falls back to mrv.project_plot_type_defaults, exactly as before this migration.';

-- migrate:down
ALTER TABLE mrv.farms DROP COLUMN IF EXISTS plot_type_override;
ALTER TABLE mrv.negative_balance_flags DROP CONSTRAINT negative_balance_flags_threshold_pct_check;
ALTER TABLE mrv.negative_balance_flags ADD CONSTRAINT negative_balance_flags_threshold_pct_check
  CHECK (threshold_pct IN (30, 20));
DROP TABLE IF EXISTS mrv.negative_balance_settings;
