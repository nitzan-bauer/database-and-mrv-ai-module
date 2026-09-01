-- migrate:up
-- =====================================================================
-- 0092 — Move the farm plot-type override off mrv.farms onto its own
-- table, keyed by the SaaS farm id directly (text), not mrv.farms'
-- internal uuid FK.
--
-- Real gap found minutes after 0091 shipped: mrv.farms has only 4 rows
-- (a curated subset used for climate-zone/irrigation admin) — it is
-- MISSING the one farm that actually needs this feature, the sole real
-- orchard farm ("credible blooms avocado", farm_id eb166215-...), which
-- exists only via mrv.credit_yield_estimates / the live SaaS. Storing the
-- override as a column on mrv.farms meant the one farm an admin would
-- actually want to mark "mature" had no row to attach it to at all.
--
-- mrv.credit_yield_estimates already has every real, active farm by
-- definition (it's what the whole report is built from) — this table
-- keys the same way (farm_id as text) so it can cover ANY farm, whether
-- or not it also happens to have a mrv.farms row.
-- =====================================================================

ALTER TABLE mrv.farms DROP COLUMN IF EXISTS plot_type_override;

CREATE TABLE mrv.farm_plot_type_overrides (
  farm_id      text PRIMARY KEY,
  plot_type    text NOT NULL REFERENCES mrv.credit_yield_rate_table (plot_type),
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mrv.farm_plot_type_overrides IS
  'Admin-set override (super_admin, /admin panel) of one farm''s plot type for credit-yield purposes — young_orchard vs. mature_orchard is a real distinction (9 vs. 3 tCO2e/ha) with no other signal to derive it from. Keyed by the SaaS farm_id directly (not mrv.farms.farm_id) so it covers every farm mrv.credit_yield_estimates knows about, not just the curated subset in mrv.farms. A farm with no row here falls back to mrv.project_plot_type_defaults, exactly as before this ever existed.';

-- migrate:down
DROP TABLE IF EXISTS mrv.farm_plot_type_overrides;
ALTER TABLE mrv.farms ADD COLUMN plot_type_override text REFERENCES mrv.credit_yield_rate_table (plot_type);
