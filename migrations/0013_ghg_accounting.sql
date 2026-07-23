-- =====================================================================
-- 0013 · Stage 5b — QA3 emissions accounting
--
-- The GHG calculator, as tables. The work plan scoped stage 5 as the
-- commercial branch only; the calculator adds this larger half —
-- activity data, computed emissions, leakage — and it is what turns raw
-- fertilizer/fuel records into the emission-reduction figure a project
-- actually reports.
--
--   activity_data           one farm-year per scenario (baseline|project)
--   fertilizer_applications one product application under a year
--   emission_results        computed emissions per farm-year
--   leakage                 VM0042 §8.4 leakage components
--
-- Emissions are COMPUTED, not entered. mrv.compute_emissions() applies
-- the VM0042 equations against the active ghg_parameters, so a re-run
-- reproduces exactly what was reported — the whole reason ghg_parameters
-- is append-only. The workbook hard-codes three synthetic fertilizer
-- slots per row; a child table removes that ceiling.
-- =====================================================================

-- migrate:up

-- ---------------------------------------------------------------------
-- Activity data — one row per farm per year per scenario.
-- Fertilizers hang off this in a child table rather than three fixed
-- column groups as the spreadsheet does.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.activity_data (
  activity_data_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id          uuid NOT NULL REFERENCES mrv.farms(farm_id) ON DELETE CASCADE,
  scenario         mrv.sample_scenario NOT NULL,       -- BSL (baseline avg) vs PR (project year)
  year             smallint NOT NULL,
  area_ha          numeric(12,4) NOT NULL CHECK (area_ha > 0),

  -- fuel
  diesel_l         numeric(12,2) DEFAULT 0 CHECK (diesel_l >= 0),
  gasoline_l       numeric(12,2) DEFAULT 0 CHECK (gasoline_l >= 0),

  -- residue burning (eq 32)
  residue_burnt_kg numeric(14,2) DEFAULT 0 CHECK (residue_burnt_kg >= 0),

  -- N-fixing crop residue returned (eq 24/25)
  nfix_dry_matter_t numeric(12,4) DEFAULT 0 CHECK (nfix_dry_matter_t >= 0),
  nfix_n_content    numeric(6,4) DEFAULT 0 CHECK (nfix_n_content >= 0 AND nfix_n_content <= 1),

  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (farm_id, scenario, year)
);

CREATE INDEX idx_activity_farm ON mrv.activity_data (farm_id, scenario);

-- ---------------------------------------------------------------------
-- Fertilizer applications — one product under an activity-data row.
-- N applied is generated from mass x the library N content, annualised
-- by the application interval for organics (workbook eq 19/20).
-- ---------------------------------------------------------------------
CREATE TABLE mrv.fertilizer_applications (
  application_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_data_id uuid NOT NULL REFERENCES mrv.activity_data(activity_data_id) ON DELETE CASCADE,
  fertilizer_id    uuid REFERENCES mrv.fertilizers(fertilizer_id) ON DELETE RESTRICT,
  fertilizer_name  text NOT NULL,                      -- denormalised for audit stability
  mass_t           numeric(12,4) NOT NULL CHECK (mass_t >= 0),
  n_content        numeric(6,4) NOT NULL CHECK (n_content >= 0 AND n_content <= 1),
  class            mrv.fertilizer_class NOT NULL,
  interval_years   smallint NOT NULL DEFAULT 1 CHECK (interval_years >= 1),

  -- Annualised N applied, t N. Organic mass is spread over its interval.
  n_applied_t numeric(12,4) GENERATED ALWAYS AS
                (round((mass_t / interval_years * n_content)::numeric, 4)) STORED,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fertapp_activity ON mrv.fertilizer_applications (activity_data_id);

-- ---------------------------------------------------------------------
-- Emission results — computed per farm-year. Append-only: a recompute is
-- a new row keyed by parameter_set and computed_at, so past reports stay
-- reproducible.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.emission_results (
  result_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_data_id uuid NOT NULL REFERENCES mrv.activity_data(activity_data_id) ON DELETE CASCADE,
  parameter_set_id uuid REFERENCES mrv.ghg_parameters(parameter_set_id) ON DELETE SET NULL,

  fsn_t_n          numeric(12,4),                       -- synthetic N
  fon_t_n          numeric(12,4),                       -- organic N (annualised)
  n2o_direct_tco2e_ha   numeric(12,4),
  n2o_indirect_tco2e_ha numeric(12,4),
  n2o_nfix_tco2e_ha     numeric(12,4),
  co2_fuel_tco2e_ha     numeric(12,4),
  n2o_burn_tco2e_ha     numeric(12,4),
  total_tco2e_ha        numeric(12,4),
  total_tco2e           numeric(14,4),

  computed_by      text,
  computed_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (activity_data_id, parameter_set_id, computed_at)
);

CREATE INDEX idx_emiss_activity ON mrv.emission_results (activity_data_id);

-- ---------------------------------------------------------------------
-- Leakage — VM0042 §8.4. §8.4.1 (organic amendments) is computed; the
-- others are entered with justification.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.leakage (
  leakage_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id        uuid REFERENCES mrv.farms(farm_id) ON DELETE CASCADE,
  project_id     text REFERENCES mrv.projects(project_id) ON DELETE CASCADE,
  component      text NOT NULL,                         -- '8.4.1' | '8.4.2' | '8.4.3' | '8.4.4'
  year           smallint,
  leakage_tco2e  numeric(14,4) NOT NULL DEFAULT 0,
  justification  text,
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leakage_scope_chk CHECK (num_nonnulls(farm_id, project_id) >= 1)
);

CREATE INDEX idx_leakage_farm ON mrv.leakage (farm_id);

-- =====================================================================
-- The emissions engine. One function that applies the VM0042 equations
-- for a single activity_data row against a parameter set, and returns
-- the components. Kept in SQL so the calculation lives in one auditable
-- place — the same reason the derived-parameter functions do.
-- =====================================================================
CREATE OR REPLACE FUNCTION mrv.compute_emissions(
  p_activity_data_id uuid,
  p_parameter_set_id uuid
) RETURNS mrv.emission_results AS $$
DECLARE
  ad   mrv.activity_data%ROWTYPE;
  p    mrv.ghg_parameters%ROWTYPE;
  r    mrv.emission_results;
  fsn  numeric;
  fon  numeric;
  gasf numeric;   -- synthetic N x Frac_GASF
  gasm numeric;   -- organic  N x Frac_GASM
  conv numeric;   -- 44/28 x GWP_N2O
BEGIN
  SELECT * INTO ad FROM mrv.activity_data WHERE activity_data_id = p_activity_data_id;
  SELECT * INTO p  FROM mrv.ghg_parameters WHERE parameter_set_id = p_parameter_set_id;
  IF ad.activity_data_id IS NULL OR p.parameter_set_id IS NULL THEN
    RAISE EXCEPTION 'compute_emissions: activity data or parameter set not found';
  END IF;

  -- FSN / FON from the fertilizer applications (eq 19/20)
  SELECT coalesce(sum(n_applied_t) FILTER (WHERE class <> 'organic'), 0),
         coalesce(sum(n_applied_t) FILTER (WHERE class =  'organic'), 0),
         coalesce(sum(n_applied_t * p.frac_gasf) FILTER (WHERE class <> 'organic'), 0),
         coalesce(sum(n_applied_t * p.frac_gasm) FILTER (WHERE class =  'organic'), 0)
    INTO fsn, fon, gasf, gasm
    FROM mrv.fertilizer_applications WHERE activity_data_id = p_activity_data_id;

  conv := mrv.n2o_n_to_n2o() * p.gwp_n2o;

  r.activity_data_id := p_activity_data_id;
  r.parameter_set_id := p_parameter_set_id;
  r.fsn_t_n := fsn;
  r.fon_t_n := fon;

  -- eq 18 direct N2O, per ha
  r.n2o_direct_tco2e_ha := round(((fsn + fon) * mrv.ef_n_direct(p) * conv / ad.area_ha)::numeric, 4);

  -- eq 22 volatilisation + eq 23 leaching, per ha (eq 21)
  r.n2o_indirect_tco2e_ha := round((
      ( (gasf + gasm) * p.ef_n_volat * conv )
      + ( (fsn + fon) * mrv.frac_leach(p) * p.ef_n_leach * conv )
    ) / ad.area_ha, 4);

  -- eq 24 N-fixing residue, per ha
  r.n2o_nfix_tco2e_ha := round((
      ad.nfix_dry_matter_t * ad.nfix_n_content * mrv.ef_n_direct(p) * conv / ad.area_ha
    )::numeric, 4);

  -- eq 7/6 fuel CO2, per ha
  r.co2_fuel_tco2e_ha := round((
      (ad.diesel_l * p.ef_co2_diesel + ad.gasoline_l * p.ef_co2_gasoline) / ad.area_ha
    )::numeric, 4);

  -- eq 32 residue burning, per ha
  r.n2o_burn_tco2e_ha := round((
      p.gwp_n2o * ad.residue_burnt_kg * p.cf_combustion * p.ef_c_n2o / 1000000.0 / ad.area_ha
    )::numeric, 4);

  -- total. Soil N2O (direct + indirect + nfix) is counted here only under
  -- QA3; under QA1 it comes from the model instead (double-counting guard).
  r.total_tco2e_ha := r.co2_fuel_tco2e_ha + r.n2o_burn_tco2e_ha
    + CASE WHEN p.soil_n2o_approach = 'QA3'
           THEN r.n2o_direct_tco2e_ha + r.n2o_indirect_tco2e_ha + r.n2o_nfix_tco2e_ha
           ELSE 0 END;
  r.total_tco2e := round((r.total_tco2e_ha * ad.area_ha)::numeric, 4);

  RETURN r;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION mrv.compute_emissions(uuid, uuid) IS
  'VM0042 emission equations for one farm-year against a parameter set. Soil N2O is excluded from the total when the parameter set is QA1 (it comes from the model instead).';

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_activity_upd BEFORE UPDATE ON mrv.activity_data FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_leakage_upd  BEFORE UPDATE ON mrv.leakage       FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();

-- emission_results is append-only (reproducibility).
CREATE TRIGGER trg_emiss_noupd BEFORE UPDATE OR DELETE ON mrv.emission_results FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();

CREATE TRIGGER trg_audit_activity AFTER INSERT OR UPDATE OR DELETE ON mrv.activity_data          FOR EACH ROW EXECUTE FUNCTION mrv.log_change('activity_data_id');
CREATE TRIGGER trg_audit_fertapp  AFTER INSERT OR UPDATE OR DELETE ON mrv.fertilizer_applications FOR EACH ROW EXECUTE FUNCTION mrv.log_change('application_id');
CREATE TRIGGER trg_audit_emiss    AFTER INSERT ON mrv.emission_results FOR EACH ROW EXECUTE FUNCTION mrv.log_change('result_id');
CREATE TRIGGER trg_audit_leakage  AFTER INSERT OR UPDATE OR DELETE ON mrv.leakage FOR EACH ROW EXECUTE FUNCTION mrv.log_change('leakage_id');

-- migrate:down

DROP TRIGGER IF EXISTS trg_audit_leakage  ON mrv.leakage;
DROP TRIGGER IF EXISTS trg_audit_emiss    ON mrv.emission_results;
DROP TRIGGER IF EXISTS trg_audit_fertapp  ON mrv.fertilizer_applications;
DROP TRIGGER IF EXISTS trg_audit_activity ON mrv.activity_data;
DROP TRIGGER IF EXISTS trg_emiss_noupd    ON mrv.emission_results;
DROP TRIGGER IF EXISTS trg_leakage_upd    ON mrv.leakage;
DROP TRIGGER IF EXISTS trg_activity_upd   ON mrv.activity_data;

DROP FUNCTION IF EXISTS mrv.compute_emissions(uuid, uuid);

DROP TABLE IF EXISTS mrv.leakage;
DROP TABLE IF EXISTS mrv.emission_results;
DROP TABLE IF EXISTS mrv.fertilizer_applications;
DROP TABLE IF EXISTS mrv.activity_data;
