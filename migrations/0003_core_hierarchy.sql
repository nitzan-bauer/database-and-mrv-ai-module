-- =====================================================================
-- 0003 · Core hierarchy — the spatial spine of the module
--
--   organizations
--        └── projects   (grouped, Verra-registered umbrella — VCU unit)
--              └── farms        (instance = CropNut "installation")
--                    ├── plots  (WP polygons; QA approach lives HERE)
--                    │     └── strata
--                    │           └── sampling_points
--                    └── baseline_control_sites (BSL, QA2)
--                          └── sampling_points
--
-- Each farm is self-contained: its own plots, its own BSL, its own
-- strata, and (Stage B) its own sampling campaign.
-- =====================================================================

-- migrate:up

-- ---------------------------------------------------------------------
-- Organizations & users
--
-- Kept local rather than leaning on Supabase auth.users, because two of
-- the four personas are not auth users at all: the AI agent runs as a
-- service identity, and external samplers reach the system through a
-- work-order-scoped MCP token (Stage B). If this database is later
-- merged into the Supabase project, add
--   supabase_user_id uuid REFERENCES auth.users(id)
-- to mrv.users rather than replacing this table.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.organizations (
  org_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  billing_contact text,
  default_region  text NOT NULL DEFAULT 'eu-west-1',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mrv.users (
  user_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES mrv.organizations(org_id) ON DELETE RESTRICT,
  email          citext NOT NULL UNIQUE,
  full_name      text NOT NULL,
  auth_method    mrv.auth_method NOT NULL DEFAULT 'sso',
  is_active      boolean NOT NULL DEFAULT true,
  last_active_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Projects — the grouped, Verra-registered umbrella.
-- Thin by design: registration, crediting period, and (Stage C) VCU
-- issuance. All operational data hangs off farms.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.projects (
  project_id        text PRIMARY KEY,                       -- 'CARBO-3988'
  org_id            uuid NOT NULL REFERENCES mrv.organizations(org_id) ON DELETE RESTRICT,
  name              text NOT NULL,
  methodology       text NOT NULL DEFAULT 'VM0042 v2.2',
  is_grouped        boolean NOT NULL DEFAULT true,
  verra_registry_id text,
  country           text,
  crediting_start   date,
  crediting_end     date,
  status            text NOT NULL DEFAULT 'under_development',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crediting_period_chk
    CHECK (crediting_end IS NULL OR crediting_start IS NULL OR crediting_end > crediting_start)
);

-- ---------------------------------------------------------------------
-- Farms — a participant instance under the grouped project.
-- This is the operational hub and the GHG calculator's "quantification
-- unit" (its per-farm-year rows key on this).
--
-- baseline_start_year / baseline_end_year hold the 3-year pre-project
-- window the calculator averages over ("Baseline rule", README B8).
-- ---------------------------------------------------------------------
CREATE TABLE mrv.farms (
  farm_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          text NOT NULL REFERENCES mrv.projects(project_id) ON DELETE RESTRICT,
  name                text NOT NULL,
  installation_code   text UNIQUE,          -- CropNut 'Installation' column
  operator            text,
  country             text,
  region              text,
  carbon_rights_ref   text,                 -- contract/MoU — anti double-counting
  joined_at           date,                 -- added to the grouped project
  project_start_date  date,                 -- drives the baseline window
  baseline_start_year smallint,
  baseline_end_year   smallint,
  climate_zone        mrv.climate_zone,     -- overrides project default for EF selection
  status              text NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT baseline_window_chk
    CHECK (baseline_end_year IS NULL OR baseline_start_year IS NULL
           OR baseline_end_year >= baseline_start_year)
);

-- ---------------------------------------------------------------------
-- Plots — "With Project" (WP) polygons.
--
-- quantification_approach sits here, not on the project: a single farm
-- may run QA1 and QA2 side by side (Kisima does), and VM0042 §8.1
-- requires strata on different approaches to be accounted separately.
--
-- area_ha is stored (not computed on read) because reported areas must
-- stay frozen for audit even if a polygon is later corrected; use
-- mrv.area_ha(geom) to populate it and to check for drift.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.plots (
  plot_id                 text PRIMARY KEY,                 -- 'KIS-WP-01'
  farm_id                 uuid NOT NULL REFERENCES mrv.farms(farm_id) ON DELETE CASCADE,
  name                    text,
  geom                    geometry(Polygon,4326) NOT NULL,
  area_ha                 numeric(12,4),
  application_area_ha     numeric(12,4),
  quantification_approach mrv.quant_approach NOT NULL,
  crop                    text,
  soil_group_wrb          text,
  soil_texture_fao        text,
  climate_zone_ipcc       text,
  slope_class             text,
  stroke_color            text,                             -- Mapbox outline
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plot_area_positive_chk
    CHECK (area_ha IS NULL OR area_ha > 0),
  CONSTRAINT application_area_within_plot_chk
    CHECK (application_area_ha IS NULL OR area_ha IS NULL OR application_area_ha <= area_ha)
);

-- ---------------------------------------------------------------------
-- Strata — homogeneous sub-units of a plot. Sample counts are allocated
-- per stratum (VM0042 §8.2.1.2: ≥3 composites each).
-- ---------------------------------------------------------------------
CREATE TABLE mrv.strata (
  stratum_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_id    text NOT NULL REFERENCES mrv.plots(plot_id) ON DELETE CASCADE,
  code       text NOT NULL,                                 -- 'A','C','Avtah'
  geom       geometry(Polygon,4326),
  area_ha    numeric(12,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plot_id, code)
);

-- ---------------------------------------------------------------------
-- Baseline control sites (QA2). Per farm, ≥3 sites, each within 250 km
-- of the WP and meeting the 9 similarity criteria of VM0042 Table 7
-- (stored as jsonb so the rule engine can evaluate them field by field).
-- ---------------------------------------------------------------------
CREATE TABLE mrv.baseline_control_sites (
  bsl_id              text PRIMARY KEY,                     -- 'BSL-01'
  farm_id             uuid NOT NULL REFERENCES mrv.farms(farm_id) ON DELETE CASCADE,
  linked_plot_id      text REFERENCES mrv.plots(plot_id) ON DELETE SET NULL,
  geom                geometry(Polygon,4326) NOT NULL,
  area_ha             numeric(12,4),
  distance_km         numeric(8,3),
  similarity_criteria jsonb,                                -- VM0042 Table 7
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- 250 km ceiling is a hard methodology limit, not a preference.
  CONSTRAINT bsl_distance_chk
    CHECK (distance_km IS NULL OR (distance_km >= 0 AND distance_km <= 250))
);

-- ---------------------------------------------------------------------
-- Sampling points — persistent georeferenced locations, re-visited
-- across cycles so ESM comparisons stay like-for-like.
-- A point belongs to either a WP plot or a BSL site, never both.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.sampling_points (
  point_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_id         text REFERENCES mrv.plots(plot_id) ON DELETE CASCADE,
  stratum_id      uuid REFERENCES mrv.strata(stratum_id) ON DELETE SET NULL,
  bsl_id          text REFERENCES mrv.baseline_control_sites(bsl_id) ON DELETE CASCADE,
  scenario        mrv.sample_scenario NOT NULL,
  planned_geom    geometry(Point,4326) NOT NULL,
  composite_cores smallint CHECK (composite_cores IS NULL OR composite_cores > 0),
  is_revisit      boolean NOT NULL DEFAULT false,
  status          mrv.point_status NOT NULL DEFAULT 'planned',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT point_parent_chk CHECK (num_nonnulls(plot_id, bsl_id) = 1)
);

-- ---------------------------------------------------------------------
-- Project-scoped membership
-- ---------------------------------------------------------------------
CREATE TABLE mrv.project_memberships (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES mrv.users(user_id) ON DELETE CASCADE,
  project_id    text NOT NULL REFERENCES mrv.projects(project_id) ON DELETE CASCADE,
  role          mrv.app_role NOT NULL,
  granted_by    uuid REFERENCES mrv.users(user_id) ON DELETE SET NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

-- =====================================================================
-- Indexes
-- =====================================================================
CREATE INDEX idx_plots_geom  ON mrv.plots                  USING gist (geom);
CREATE INDEX idx_strata_geom ON mrv.strata                 USING gist (geom);
CREATE INDEX idx_bsl_geom    ON mrv.baseline_control_sites USING gist (geom);
CREATE INDEX idx_points_geom ON mrv.sampling_points        USING gist (planned_geom);

CREATE INDEX idx_farms_project    ON mrv.farms (project_id);
CREATE INDEX idx_plots_farm       ON mrv.plots (farm_id);
CREATE INDEX idx_strata_plot      ON mrv.strata (plot_id);
CREATE INDEX idx_bsl_farm         ON mrv.baseline_control_sites (farm_id);
CREATE INDEX idx_points_plot      ON mrv.sampling_points (plot_id);
CREATE INDEX idx_points_stratum   ON mrv.sampling_points (stratum_id);
CREATE INDEX idx_points_bsl       ON mrv.sampling_points (bsl_id);
CREATE INDEX idx_memberships_proj ON mrv.project_memberships (project_id);

-- =====================================================================
-- updated_at triggers
-- =====================================================================
CREATE TRIGGER trg_org_upd    BEFORE UPDATE ON mrv.organizations          FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_users_upd  BEFORE UPDATE ON mrv.users                  FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_proj_upd   BEFORE UPDATE ON mrv.projects               FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_farms_upd  BEFORE UPDATE ON mrv.farms                  FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_plots_upd  BEFORE UPDATE ON mrv.plots                  FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_strata_upd BEFORE UPDATE ON mrv.strata                 FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_bsl_upd    BEFORE UPDATE ON mrv.baseline_control_sites FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_points_upd BEFORE UPDATE ON mrv.sampling_points        FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();

-- =====================================================================
-- Comments
-- =====================================================================
COMMENT ON TABLE  mrv.projects IS 'Grouped, Verra-registered umbrella project. Unit of VCU issuance.';
COMMENT ON TABLE  mrv.farms    IS 'Participant farm / instance (CropNut "installation"). Owns plots, BSL, strata, sampling campaigns. Also the GHG calculator quantification unit.';
COMMENT ON TABLE  mrv.plots    IS 'WP polygon under a farm. quantification_approach lives here — a farm may be mixed-QA (VM0042 §8.1).';
COMMENT ON COLUMN mrv.farms.carbon_rights_ref IS 'Reference to the signed carbon-rights agreement. Guards against double-counting.';
COMMENT ON COLUMN mrv.baseline_control_sites.similarity_criteria IS 'VM0042 v2.2 Table 7 — the 9 similarity criteria, one key per criterion.';

-- migrate:down

DROP TABLE IF EXISTS mrv.project_memberships;
DROP TABLE IF EXISTS mrv.sampling_points;
DROP TABLE IF EXISTS mrv.baseline_control_sites;
DROP TABLE IF EXISTS mrv.strata;
DROP TABLE IF EXISTS mrv.plots;
DROP TABLE IF EXISTS mrv.farms;
DROP TABLE IF EXISTS mrv.projects;
DROP TABLE IF EXISTS mrv.users;
DROP TABLE IF EXISTS mrv.organizations;
