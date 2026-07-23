-- =====================================================================
-- 0012 · Stage 5a — the commercial branch
--
--   products          the agri-input catalogue (marketplace)
--   alm_activities    an application of a product to a plot
--   credits           application-based credits, plot level (marketplace)
--   vcu_issuances     Verra-issued VCUs, grouped-project level
--
-- This is the lineage the marketplace shows. It meets the verification
-- lineage (samples -> SOC) only at the plot. Credits here are the
-- ex-ante "Received Credits" figure on carbonature.io; a VCU issuance is
-- the ex-post Verra unit and lives at the grouped project, because that
-- is Verra's unit of issuance.
-- =====================================================================

-- migrate:up

-- ---------------------------------------------------------------------
-- Products — the agri-input catalogue. Mutable reference data.
-- credit_per_ha is the ex-ante rate shown on the marketplace; the real
-- credit is only known after verification, so this is a planning figure.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.products (
  product_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL UNIQUE,
  manufacturer      text,
  activity_type     mrv.activity_type NOT NULL DEFAULT 'biofertilizer',
  activity_label    text,                              -- 'Apply Mycorrhiza'
  application_method text,
  cost_per_ha_usd   numeric(12,2) CHECK (cost_per_ha_usd IS NULL OR cost_per_ha_usd >= 0),
  credit_per_ha     numeric(10,4) CHECK (credit_per_ha IS NULL OR credit_per_ha >= 0),  -- tCO2e/ha, ex-ante
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN mrv.products.credit_per_ha IS
  'Ex-ante tCO2e/ha shown on the marketplace. A planning figure — real credits are only known after verification.';

-- ---------------------------------------------------------------------
-- ALM activities — a management practice applied to a plot in a season.
-- This is both the commercial trigger and the QA1/QA3 model input.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.alm_activities (
  activity_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_id            text NOT NULL REFERENCES mrv.plots(plot_id) ON DELETE CASCADE,
  product_id         uuid REFERENCES mrv.products(product_id) ON DELETE SET NULL,
  activity_type      mrv.activity_type NOT NULL,
  rate               numeric(12,4),
  rate_unit          text,
  application_area_ha numeric(12,4) CHECK (application_area_ha IS NULL OR application_area_ha >= 0),
  application_date   date,
  season             text,
  scenario           mrv.sample_scenario NOT NULL DEFAULT 'PR',   -- baseline vs with-project
  notes              text,
  is_demo            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alm_plot    ON mrv.alm_activities (plot_id);
CREATE INDEX idx_alm_product ON mrv.alm_activities (product_id);

-- ---------------------------------------------------------------------
-- Credits — application-based, plot level. What the marketplace totals.
-- credits_tco2e is generated: area x product rate. Frozen figures
-- (cost, area) are stored, not recomputed, so a later product-price
-- change does not rewrite a credit already shown to a buyer.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.credits (
  credit_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_id            text NOT NULL REFERENCES mrv.plots(plot_id) ON DELETE CASCADE,
  activity_id        uuid REFERENCES mrv.alm_activities(activity_id) ON DELETE SET NULL,
  product_id         uuid REFERENCES mrv.products(product_id) ON DELETE SET NULL,
  application_area_ha numeric(12,4) NOT NULL CHECK (application_area_ha >= 0),
  credit_per_ha      numeric(10,4) NOT NULL CHECK (credit_per_ha >= 0),
  credits_tco2e      numeric(14,4) GENERATED ALWAYS AS
                       (round((application_area_ha * credit_per_ha)::numeric, 4)) STORED,
  cost_usd           numeric(14,2),
  vintage_year       integer,
  status             mrv.credit_status NOT NULL DEFAULT 'estimated',
  is_demo            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_credits_plot   ON mrv.credits (plot_id);
CREATE INDEX idx_credits_status ON mrv.credits (status);

-- ---------------------------------------------------------------------
-- VCU issuances — Verra units, grouped-project level (the issuance unit).
-- ---------------------------------------------------------------------
CREATE TABLE mrv.vcu_issuances (
  issuance_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         text NOT NULL REFERENCES mrv.projects(project_id) ON DELETE RESTRICT,
  vintage            integer,
  quantity_tco2e     numeric(16,4) CHECK (quantity_tco2e IS NULL OR quantity_tco2e >= 0),
  verra_serial_range text,
  issued_date        date,
  status             mrv.credit_status NOT NULL DEFAULT 'issued',
  is_demo            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vcu_project ON mrv.vcu_issuances (project_id);

-- ---------------------------------------------------------------------
-- Per-plot and per-farm credit rollup — what feeds "Received Credits".
-- Real data only: demo rows excluded, matching v_real_plots.
-- ---------------------------------------------------------------------
CREATE VIEW mrv.v_plot_credits AS
SELECT
  p.plot_id,
  f.farm_id,
  f.name              AS farm_name,
  f.project_id,
  p.area_ha,
  count(c.credit_id)  AS credit_lines,
  coalesce(sum(c.credits_tco2e), 0) AS credits_tco2e,
  coalesce(sum(c.cost_usd), 0)      AS cost_usd
FROM mrv.plots p
JOIN mrv.farms f ON f.farm_id = p.farm_id
LEFT JOIN mrv.credits c ON c.plot_id = p.plot_id AND NOT c.is_demo
WHERE NOT p.is_demo AND NOT f.is_demo
GROUP BY p.plot_id, f.farm_id, f.name, f.project_id, p.area_ha;

COMMENT ON VIEW mrv.v_plot_credits IS
  'Per-plot credit rollup for real (non-demo) plots. Feeds the marketplace Received Credits figure.';

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_products_upd BEFORE UPDATE ON mrv.products       FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_alm_upd      BEFORE UPDATE ON mrv.alm_activities  FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_credits_upd  BEFORE UPDATE ON mrv.credits         FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_vcu_upd      BEFORE UPDATE ON mrv.vcu_issuances   FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();

CREATE TRIGGER trg_audit_products AFTER INSERT OR UPDATE OR DELETE ON mrv.products      FOR EACH ROW EXECUTE FUNCTION mrv.log_change('product_id');
CREATE TRIGGER trg_audit_alm      AFTER INSERT OR UPDATE OR DELETE ON mrv.alm_activities FOR EACH ROW EXECUTE FUNCTION mrv.log_change('activity_id');
CREATE TRIGGER trg_audit_credits  AFTER INSERT OR UPDATE OR DELETE ON mrv.credits        FOR EACH ROW EXECUTE FUNCTION mrv.log_change('credit_id');
CREATE TRIGGER trg_audit_vcu      AFTER INSERT OR UPDATE OR DELETE ON mrv.vcu_issuances   FOR EACH ROW EXECUTE FUNCTION mrv.log_change('issuance_id');

-- A demo activity or credit must not sit on a real plot, mirroring the
-- farm/plot interlock from migration 0007.
CREATE OR REPLACE FUNCTION mrv.check_demo_child_of_plot() RETURNS trigger AS $$
DECLARE
  plot_is_demo boolean;
BEGIN
  SELECT is_demo INTO plot_is_demo FROM mrv.plots WHERE plot_id = NEW.plot_id;
  IF NEW.is_demo <> plot_is_demo THEN
    RAISE EXCEPTION '% is_demo=% but its plot % is is_demo=%',
      TG_TABLE_NAME, NEW.is_demo, NEW.plot_id, plot_is_demo;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_alm_demo_chk     BEFORE INSERT OR UPDATE ON mrv.alm_activities FOR EACH ROW EXECUTE FUNCTION mrv.check_demo_child_of_plot();
CREATE TRIGGER trg_credits_demo_chk BEFORE INSERT OR UPDATE ON mrv.credits        FOR EACH ROW EXECUTE FUNCTION mrv.check_demo_child_of_plot();

-- migrate:down

DROP TRIGGER IF EXISTS trg_credits_demo_chk ON mrv.credits;
DROP TRIGGER IF EXISTS trg_alm_demo_chk     ON mrv.alm_activities;
DROP FUNCTION IF EXISTS mrv.check_demo_child_of_plot();

DROP TRIGGER IF EXISTS trg_audit_vcu      ON mrv.vcu_issuances;
DROP TRIGGER IF EXISTS trg_audit_credits  ON mrv.credits;
DROP TRIGGER IF EXISTS trg_audit_alm      ON mrv.alm_activities;
DROP TRIGGER IF EXISTS trg_audit_products ON mrv.products;
DROP TRIGGER IF EXISTS trg_vcu_upd      ON mrv.vcu_issuances;
DROP TRIGGER IF EXISTS trg_credits_upd  ON mrv.credits;
DROP TRIGGER IF EXISTS trg_alm_upd      ON mrv.alm_activities;
DROP TRIGGER IF EXISTS trg_products_upd ON mrv.products;

DROP VIEW IF EXISTS mrv.v_plot_credits;
DROP TABLE IF EXISTS mrv.vcu_issuances;
DROP TABLE IF EXISTS mrv.credits;
DROP TABLE IF EXISTS mrv.alm_activities;
DROP TABLE IF EXISTS mrv.products;
