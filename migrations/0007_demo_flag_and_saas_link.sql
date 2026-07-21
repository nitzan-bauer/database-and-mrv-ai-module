-- =====================================================================
-- 0007 · Demo marking + link back to the SaaS records
--
-- Two additions that only look small.
--
-- is_demo: the farms seeded in stage 1 are demonstration data, not
-- clients. In an MRV database that is not a label, it is a safety
-- interlock — a demo hectare that reaches a Verra submission is a
-- material misstatement. Marked at the source so every downstream query,
-- view and report can exclude it, and so the whole set can be deleted
-- in one statement when real farms arrive.
--
-- saas_*_id: these farms already exist in the customer-facing Supabase
-- database, which is where the marketplace and the public farm pages
-- read from. Storing that id makes the two systems joinable later and
-- makes re-syncing a plot polygon a lookup rather than a name match.
-- =====================================================================

-- migrate:up

ALTER TABLE mrv.projects ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE mrv.farms    ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE mrv.plots    ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN mrv.projects.is_demo IS
  'Demonstration data. MUST be excluded from any Verra submission or credit issuance.';
COMMENT ON COLUMN mrv.farms.is_demo IS
  'Demonstration farm, not a client. MUST be excluded from any Verra submission or credit issuance.';
COMMENT ON COLUMN mrv.plots.is_demo IS
  'Demonstration plot. MUST be excluded from any Verra submission or credit issuance.';

-- Partial indexes: real data is the common query path, so let the planner
-- skip demo rows cheaply once there is a mix of both.
CREATE INDEX idx_farms_real ON mrv.farms (project_id) WHERE NOT is_demo;
CREATE INDEX idx_plots_real ON mrv.plots (farm_id)    WHERE NOT is_demo;

-- A demo farm cannot sit under a real project. Without this, one careless
-- insert quietly puts demo hectares inside a registered grouped project,
-- which is exactly the failure this flag exists to prevent.
CREATE OR REPLACE FUNCTION mrv.check_demo_consistency() RETURNS trigger AS $$
DECLARE
  parent_is_demo boolean;
BEGIN
  IF TG_TABLE_NAME = 'farms' THEN
    SELECT is_demo INTO parent_is_demo FROM mrv.projects WHERE project_id = NEW.project_id;
    IF NEW.is_demo AND NOT parent_is_demo THEN
      RAISE EXCEPTION 'Demo farm % cannot belong to non-demo project %', NEW.name, NEW.project_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'plots' THEN
    SELECT is_demo INTO parent_is_demo FROM mrv.farms WHERE farm_id = NEW.farm_id;
    IF NEW.is_demo <> parent_is_demo THEN
      RAISE EXCEPTION 'Plot % is_demo=% but its farm is is_demo=%', NEW.plot_id, NEW.is_demo, parent_is_demo;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_farms_demo_chk
  BEFORE INSERT OR UPDATE ON mrv.farms
  FOR EACH ROW EXECUTE FUNCTION mrv.check_demo_consistency();

CREATE TRIGGER trg_plots_demo_chk
  BEFORE INSERT OR UPDATE ON mrv.plots
  FOR EACH ROW EXECUTE FUNCTION mrv.check_demo_consistency();

-- ---------------------------------------------------------------------
-- Link to the SaaS (Supabase) records these were imported from.
-- ---------------------------------------------------------------------
ALTER TABLE mrv.farms ADD COLUMN saas_farm_id uuid;
ALTER TABLE mrv.plots ADD COLUMN saas_plot_id uuid;

CREATE UNIQUE INDEX idx_farms_saas_id ON mrv.farms (saas_farm_id) WHERE saas_farm_id IS NOT NULL;
CREATE UNIQUE INDEX idx_plots_saas_id ON mrv.plots (saas_plot_id) WHERE saas_plot_id IS NOT NULL;

COMMENT ON COLUMN mrv.farms.saas_farm_id IS
  'public.farms.id in the customer-facing Supabase database. Source of the marketplace page and the farm-plots API.';
COMMENT ON COLUMN mrv.plots.saas_plot_id IS
  'public.plots.id in the customer-facing Supabase database.';

-- ---------------------------------------------------------------------
-- Convenience view: the real, auditable estate. Query this rather than
-- mrv.plots when producing anything that could reach a VVB.
-- ---------------------------------------------------------------------
CREATE VIEW mrv.v_real_plots AS
SELECT p.*, f.name AS farm_name, f.project_id
FROM mrv.plots p
JOIN mrv.farms f ON f.farm_id = p.farm_id
WHERE NOT p.is_demo AND NOT f.is_demo;

COMMENT ON VIEW mrv.v_real_plots IS
  'Plots excluding all demonstration data. Use for anything audit-facing.';

-- migrate:down

DROP VIEW IF EXISTS mrv.v_real_plots;

DROP INDEX IF EXISTS mrv.idx_plots_saas_id;
DROP INDEX IF EXISTS mrv.idx_farms_saas_id;
ALTER TABLE mrv.plots DROP COLUMN IF EXISTS saas_plot_id;
ALTER TABLE mrv.farms DROP COLUMN IF EXISTS saas_farm_id;

DROP TRIGGER IF EXISTS trg_plots_demo_chk ON mrv.plots;
DROP TRIGGER IF EXISTS trg_farms_demo_chk ON mrv.farms;
DROP FUNCTION IF EXISTS mrv.check_demo_consistency();

DROP INDEX IF EXISTS mrv.idx_plots_real;
DROP INDEX IF EXISTS mrv.idx_farms_real;

ALTER TABLE mrv.plots    DROP COLUMN IF EXISTS is_demo;
ALTER TABLE mrv.farms    DROP COLUMN IF EXISTS is_demo;
ALTER TABLE mrv.projects DROP COLUMN IF EXISTS is_demo;
