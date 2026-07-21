-- =====================================================================
-- 0002 · Enum types
-- Every state machine in the module. Stage A creates them all so later
-- stages add tables without touching type definitions.
-- =====================================================================

-- migrate:up

SET search_path = mrv, public;

-- ---- access ---------------------------------------------------------
CREATE TYPE mrv.auth_method AS ENUM ('sso','password');
CREATE TYPE mrv.app_role    AS ENUM ('super_admin','mrv_manager','ai_agent','sampler');

-- ---- quantification -------------------------------------------------
-- QA1 = Measure & Model (DNDC/DayCent), QA2 = Measure & Remeasure,
-- QA3 = Default factors (the GHG calculator's approach for fuel/N2O).
CREATE TYPE mrv.quant_approach AS ENUM ('QA1_DNDC','QA1_DAYCENT','QA2','QA3');

-- ---- sampling lifecycle (used from Stage B) --------------------------
CREATE TYPE mrv.cycle_type      AS ENUM ('initial','true_up','verification');
CREATE TYPE mrv.cycle_status    AS ENUM ('draft','approved','in_field','lab_pending','complete','cancelled');
CREATE TYPE mrv.wo_state        AS ENUM ('draft','sent','in_progress','completed','closed');
CREATE TYPE mrv.sample_scenario AS ENUM ('BSL','PR','WP');
CREATE TYPE mrv.point_status    AS ENUM ('planned','sampled','lab_pending','complete');
CREATE TYPE mrv.parser_status   AS ENUM ('success','partial','quarantined');
CREATE TYPE mrv.lab_method      AS ENUM ('dry_combustion','loi','wet_oxidation');

-- ---- modelling (Stage C) --------------------------------------------
CREATE TYPE mrv.carbon_model   AS ENUM ('DNDC','DayCent');
CREATE TYPE mrv.model_scenario AS ENUM ('baseline','project','paired');
CREATE TYPE mrv.run_status     AS ENUM ('configuring','validating','running','completed','failed');
CREATE TYPE mrv.mvr_status     AS ENUM ('draft','ime_review','signed');

-- ---- credits & compliance (Stage C) ---------------------------------
CREATE TYPE mrv.credit_status     AS ENUM ('estimated','verified','issued','retired','sold');
CREATE TYPE mrv.compliance_result AS ENUM ('pass','warn','fail');

-- ---- agent ----------------------------------------------------------
CREATE TYPE mrv.agent_mode AS ENUM ('auto','confirm','off');

-- ---- agronomy -------------------------------------------------------
CREATE TYPE mrv.activity_type AS ENUM
  ('biofertilizer','crf','cover_crop','reduced_tillage','residue','irrigation','other');

-- Fertilizer classes drive which volatilisation fraction applies:
-- Frac_GASF for synthetic, Frac_GASM for organic (GHG calculator,
-- "Fixed Parameters" B17/B18; VM0042 eq. 22).
CREATE TYPE mrv.fertilizer_class AS ENUM ('synthetic-urea','synthetic-other','organic');

-- Climate zone drives EF_N_direct and Frac_LEACH selection.
CREATE TYPE mrv.climate_zone AS ENUM ('wet','dry');

-- Conservativeness direction per VM0042 §8.3: the project's N trend
-- versus baseline picks the low/mid/high end of the EF_N_direct range.
CREATE TYPE mrv.n_trend AS ENUM ('decrease','flat','increase');

CREATE TYPE mrv.fuel_type AS ENUM ('diesel','gasoline');

-- migrate:down

DROP TYPE IF EXISTS mrv.fuel_type;
DROP TYPE IF EXISTS mrv.n_trend;
DROP TYPE IF EXISTS mrv.climate_zone;
DROP TYPE IF EXISTS mrv.fertilizer_class;
DROP TYPE IF EXISTS mrv.activity_type;
DROP TYPE IF EXISTS mrv.agent_mode;
DROP TYPE IF EXISTS mrv.compliance_result;
DROP TYPE IF EXISTS mrv.credit_status;
DROP TYPE IF EXISTS mrv.mvr_status;
DROP TYPE IF EXISTS mrv.run_status;
DROP TYPE IF EXISTS mrv.model_scenario;
DROP TYPE IF EXISTS mrv.carbon_model;
DROP TYPE IF EXISTS mrv.lab_method;
DROP TYPE IF EXISTS mrv.parser_status;
DROP TYPE IF EXISTS mrv.point_status;
DROP TYPE IF EXISTS mrv.sample_scenario;
DROP TYPE IF EXISTS mrv.wo_state;
DROP TYPE IF EXISTS mrv.cycle_status;
DROP TYPE IF EXISTS mrv.cycle_type;
DROP TYPE IF EXISTS mrv.quant_approach;
DROP TYPE IF EXISTS mrv.app_role;
DROP TYPE IF EXISTS mrv.auth_method;
