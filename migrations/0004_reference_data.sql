-- =====================================================================
-- 0004 · Reference data — the GHG calculator's constants, as tables
--
-- Derived from GHG_Calculator_VM0042_v2.2_OpenField_v1.xlsx:
--   "Fixed Parameters"    -> mrv.ghg_parameters (versioned per project)
--   "Fertilizer Library"  -> mrv.fertilizers
--   "Machinery-Diesel"    -> mrv.machinery_defaults
--
-- These are leaf tables with no dependency on the sampling lifecycle,
-- which is why they land in Stage A: the calculator can be reproduced
-- against this database before any lab data exists.
--
-- Emission factors are versioned rather than edited in place. VM0042
-- requires that a re-run of any past monitoring period reproduce the
-- numbers that were reported at the time, so a changed factor must
-- become a NEW parameter-set row, never an UPDATE of an old one.
-- =====================================================================

-- migrate:up

-- ---------------------------------------------------------------------
-- Fertilizer library — N content per product, looked up by name.
-- Mirrors the calculator's VLOOKUP against 'Fertilizer Library'!A:B.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.fertilizers (
  fertilizer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,                 -- exact match key, as in the workbook
  n_content     numeric(6,4) NOT NULL,                -- t N / t product
  class         mrv.fertilizer_class NOT NULL,
  density_t_m3  numeric(6,3),                         -- for m³ -> t conversion (organics)
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT n_content_fraction_chk CHECK (n_content >= 0 AND n_content <= 1)
);

COMMENT ON COLUMN mrv.fertilizers.n_content IS 'Nitrogen fraction as t N per t of product (e.g. Urea 46-0-0 = 0.46).';
COMMENT ON COLUMN mrv.fertilizers.class     IS 'Drives which volatilisation fraction applies: Frac_GASF (synthetic) vs Frac_GASM (organic), VM0042 eq. 22.';

-- ---------------------------------------------------------------------
-- Machinery defaults — diesel estimation when fuel invoices are missing.
-- Diesel (L) = HP × 0.7457 × load_factor × SFC × hours_per_ha × area_ha
-- ---------------------------------------------------------------------
CREATE TABLE mrv.machinery_defaults (
  machinery_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment     text NOT NULL UNIQUE,
  rated_hp      numeric(8,2) NOT NULL,
  load_factor   numeric(4,3) NOT NULL,
  sfc_l_per_kwh numeric(5,3) NOT NULL DEFAULT 0.27,   -- IPCC 2019 / EPA NONROAD
  hours_per_ha  numeric(8,3),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mrv.machinery_defaults IS 'Machinery → diesel conversion defaults. Rated kW = HP × 0.7457.';

-- ---------------------------------------------------------------------
-- GHG parameter sets — one immutable row per (project, version).
--
-- Holds the raw factors. The three *derived* values in the workbook
-- (EF_N_direct applied, Frac_LEACH applied, and 44/28) are NOT stored;
-- they are computed by mrv.ef_n_direct() / mrv.frac_leach() below so the
-- selection logic lives in exactly one place.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.ghg_parameters (
  parameter_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       text REFERENCES mrv.projects(project_id) ON DELETE CASCADE,
  version          text NOT NULL,
  effective_from   date NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,

  -- context switches (Fixed Parameters B4-B7)
  climate_zone         mrv.climate_zone   NOT NULL DEFAULT 'wet',
  dry_climate_irrigated boolean           NOT NULL DEFAULT false,
  n_trend              mrv.n_trend        NOT NULL DEFAULT 'flat',
  soil_n2o_approach    mrv.quant_approach NOT NULL DEFAULT 'QA3',

  -- fuel (B9-B10)
  ef_co2_diesel   numeric(10,7) NOT NULL DEFAULT 0.0028860,   -- t CO2e/L
  ef_co2_gasoline numeric(10,7) NOT NULL DEFAULT 0.0028100,   -- t CO2e/L

  -- GWP (B11) — AR5, mandated by VM0042 v2.2
  gwp_n2o numeric(8,3) NOT NULL DEFAULT 265,
  gwp_ch4 numeric(8,3) NOT NULL DEFAULT 28,

  -- direct N2O EF range (B12-B15)
  ef_n_direct_wet  numeric(7,5) NOT NULL DEFAULT 0.016,
  ef_n_direct_dry  numeric(7,5) NOT NULL DEFAULT 0.005,
  ef_n_direct_low  numeric(7,5) NOT NULL DEFAULT 0.013,
  ef_n_direct_high numeric(7,5) NOT NULL DEFAULT 0.019,

  -- indirect N2O (B17-B22)
  frac_gasf       numeric(6,4) NOT NULL DEFAULT 0.11,
  frac_gasm       numeric(6,4) NOT NULL DEFAULT 0.21,
  ef_n_volat      numeric(7,5) NOT NULL DEFAULT 0.014,
  frac_leach_wet  numeric(6,4) NOT NULL DEFAULT 0.24,
  ef_n_leach      numeric(7,5) NOT NULL DEFAULT 0.011,

  -- residue burning (B23-B24)
  cf_combustion numeric(5,3) NOT NULL DEFAULT 0.5,
  ef_c_n2o      numeric(7,4) NOT NULL DEFAULT 0.07,          -- g N2O/kg d.m.

  -- provenance
  source_note text,
  created_by  uuid REFERENCES mrv.users(user_id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (project_id, version)
);

COMMENT ON TABLE mrv.ghg_parameters IS
  'Immutable emission-factor set. Never UPDATE — supersede with a new version so past monitoring periods stay reproducible.';

-- One active parameter set per project at a time.
CREATE UNIQUE INDEX idx_ghg_params_one_active
  ON mrv.ghg_parameters (project_id)
  WHERE is_active;

-- Append-only: corrections are new versions, not edits.
CREATE TRIGGER trg_ghg_params_noupd
  BEFORE UPDATE OR DELETE ON mrv.ghg_parameters
  FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();

CREATE TRIGGER trg_fert_upd BEFORE UPDATE ON mrv.fertilizers        FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_mach_upd BEFORE UPDATE ON mrv.machinery_defaults FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();

-- =====================================================================
-- Derived-parameter functions
-- These replace the workbook's IF-chains in B16 and B21.
-- =====================================================================

-- Fixed Parameters B16: dry climate wins; otherwise the conservativeness
-- direction picks the low/high end of the wet range (VM0042 §8.3).
CREATE OR REPLACE FUNCTION mrv.ef_n_direct(p mrv.ghg_parameters)
RETURNS numeric AS $$
  SELECT CASE
    WHEN p.climate_zone = 'dry'  THEN p.ef_n_direct_dry
    WHEN p.n_trend = 'decrease'  THEN p.ef_n_direct_low
    WHEN p.n_trend = 'increase'  THEN p.ef_n_direct_high
    ELSE p.ef_n_direct_wet
  END;
$$ LANGUAGE sql IMMUTABLE STRICT;

-- Fixed Parameters B21: 0.24 for wet, or dry with non-drip irrigation;
-- 0 otherwise (no leaching pathway in dry rain-fed systems).
CREATE OR REPLACE FUNCTION mrv.frac_leach(p mrv.ghg_parameters)
RETURNS numeric AS $$
  SELECT CASE
    WHEN p.climate_zone = 'wet' THEN p.frac_leach_wet
    WHEN p.climate_zone = 'dry' AND p.dry_climate_irrigated THEN p.frac_leach_wet
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE STRICT;

-- Molar mass ratio N2O/N2 — converts N2O-N to N2O in every N2O equation.
CREATE OR REPLACE FUNCTION mrv.n2o_n_to_n2o() RETURNS numeric AS $$
  SELECT 44.0 / 28.0;
$$ LANGUAGE sql IMMUTABLE;

-- =====================================================================
-- SOC stock — the formula the whole module turns on.
--
--   SOC (t C/ha) = (TOC% / 100) × BD (g/cm³) × depth (cm) × 100
--
-- Resolves the ×100 vs ×1000 discrepancy flagged in the imported schema:
-- the functional spec §11 writes ×1000, but the GHG calculator's
-- Equations sheet (eq. 4/5) and the standard IPCC/Verra form both give
-- ×100. Worked check — TOC 1%, BD 1.3, depth 15 cm:
--   0.01 × 1.3 × 15 × 100 = 19.5 t C/ha, which is the expected order of
-- magnitude for a 0-15 cm increment. ×1000 would give 195 t C/ha.
-- =====================================================================
CREATE OR REPLACE FUNCTION mrv.soc_stock_t_per_ha(
  toc_pct      numeric,
  bulk_density numeric,
  depth_cm     numeric
) RETURNS numeric AS $$
  SELECT round(((toc_pct / 100.0) * bulk_density * depth_cm * 100.0)::numeric, 4);
$$ LANGUAGE sql IMMUTABLE STRICT;

COMMENT ON FUNCTION mrv.soc_stock_t_per_ha(numeric,numeric,numeric) IS
  'SOC stock in t C/ha. Factor is 100 (per GHG calculator eq. 4/5), not 1000 as printed in functional spec §11.';

-- migrate:down

DROP FUNCTION IF EXISTS mrv.soc_stock_t_per_ha(numeric,numeric,numeric);
DROP FUNCTION IF EXISTS mrv.n2o_n_to_n2o();
DROP FUNCTION IF EXISTS mrv.frac_leach(mrv.ghg_parameters);
DROP FUNCTION IF EXISTS mrv.ef_n_direct(mrv.ghg_parameters);
DROP TABLE IF EXISTS mrv.ghg_parameters;
DROP TABLE IF EXISTS mrv.machinery_defaults;
DROP TABLE IF EXISTS mrv.fertilizers;
