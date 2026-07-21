-- =====================================================================
-- Carbonature — AI Soil Sampling & Carbon Modelling Module
-- PostgreSQL 16 + PostGIS schema · v1.0
-- Derived from: Functional Spec v1.0 + Data Architecture Roadmap v1.0
--
-- IMPORTED 2026-07-21 from Claude Desktop chat
-- "חיבור אפליקציית SaaS למסד נתונים וBackend"
-- (https://claude.ai/chat/01f3625f-27b1-4217-bb64-e6acc35f2c14)
-- DDL validated against libpg_query — 114 statements, syntax-clean.
--
-- !! DO NOT RUN AS-IS AGAINST THE LIVE SUPABASE PROJECT !!
-- Table names projects / farms / plots collide with the live SaaS
-- schema in public (see supabase/schema.sql). See
-- docs/MRV-DB-WORKPLAN.md for the integration plan before applying.
--
-- Hierarchy: projects (grouped Verra) -> farms (instance / CropNut
-- "installation") -> plots -> strata -> sampling_points
--
-- Two lineages meet only at the plot:
-- commercial : alm_activities -> products -> credits (marketplace)
-- verification : sampling_events -> soc_measurements -> esm/model_results
--
-- Conventions: snake_case · 4326 (WGS84) for all geometry · timestamptz
-- everywhere · append-only on evidentiary tables (see section 5).
-- =====================================================================

-- =====================================================================
-- 0. EXTENSIONS
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS postgis;   -- spatial types & indexing
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector for agent_memory

-- =====================================================================
-- 1. ENUM TYPES
-- =====================================================================
CREATE TYPE auth_method AS ENUM ('sso','password');
CREATE TYPE app_role AS ENUM ('super_admin','mrv_manager','ai_agent','sampler');
CREATE TYPE quant_approach AS ENUM ('QA1_DNDC','QA1_DAYCENT','QA2');
CREATE TYPE cycle_type AS ENUM ('initial','true_up','verification');
CREATE TYPE cycle_status AS ENUM ('draft','approved','in_field','lab_pending','complete','cancelled');
CREATE TYPE wo_state AS ENUM ('draft','sent','in_progress','completed','closed');
CREATE TYPE sample_scenario AS ENUM ('BSL','PR','WP');
CREATE TYPE point_status AS ENUM ('planned','sampled','lab_pending','complete');
CREATE TYPE parser_status AS ENUM ('success','partial','quarantined');
CREATE TYPE carbon_model AS ENUM ('DNDC','DayCent');
CREATE TYPE model_scenario AS ENUM ('baseline','project','paired');
CREATE TYPE run_status AS ENUM ('configuring','validating','running','completed','failed');
CREATE TYPE credit_status AS ENUM ('estimated','verified','issued','retired','sold');
CREATE TYPE compliance_result AS ENUM ('pass','warn','fail');
CREATE TYPE agent_mode AS ENUM ('auto','confirm','off');
CREATE TYPE activity_type AS ENUM ('biofertilizer','crf','cover_crop','reduced_tillage','residue','irrigation','other');
CREATE TYPE mvr_status AS ENUM ('draft','ime_review','signed');
CREATE TYPE lab_method AS ENUM ('dry_combustion','loi','wet_oxidation');

-- =====================================================================
-- 2. HELPER FUNCTIONS
-- =====================================================================
-- maintain updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
NEW.updated_at := now();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- hard append-only guard: block every UPDATE/DELETE
CREATE OR REPLACE FUNCTION prevent_mutation() RETURNS trigger AS $$
BEGIN
RAISE EXCEPTION
'Table % is append-only: % is not permitted. Insert a correcting row instead.',
TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- freeze a field-capture row once it is locked
CREATE OR REPLACE FUNCTION prevent_mutation_when_locked() RETURNS trigger AS $$
BEGIN
IF TG_OP = 'DELETE' THEN
IF OLD.locked THEN
RAISE EXCEPTION 'sampling_event % is locked and cannot be deleted', OLD.event_id;
END IF;
RETURN OLD;
END IF;
IF OLD.locked THEN
RAISE EXCEPTION 'sampling_event % is locked and cannot be modified', OLD.event_id;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Carbonature Sample ID generator (format: OFM + 8-digit zero-padded,
-- e.g. OFM00021615 as used in the spec mockups; widen lpad if 10 digits
-- are later required per spec section 11).
CREATE SEQUENCE IF NOT EXISTS sample_id_seq;
CREATE OR REPLACE FUNCTION next_sample_id() RETURNS text AS $$
SELECT 'OFM' || lpad(nextval('sample_id_seq')::text, 8, '0');
$$ LANGUAGE sql;

-- =====================================================================
-- 3. TABLES
-- =====================================================================

-- ---------- ACCESS & ORG ----------
CREATE TABLE organizations (
org_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
name text NOT NULL,
billing_contact text,
default_region text NOT NULL DEFAULT 'eu-west-1',
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
org_id uuid NOT NULL REFERENCES organizations(org_id) ON DELETE RESTRICT,
email citext NOT NULL UNIQUE,
full_name text NOT NULL,
auth_method auth_method NOT NULL DEFAULT 'sso',
is_active boolean NOT NULL DEFAULT true,
last_active_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- PROJECTS & SPATIAL (PostGIS) ----------
-- The grouped, Verra-registered umbrella. Unit of VCU issuance.
CREATE TABLE projects (
project_id text PRIMARY KEY, -- Carbonature ID, e.g. 'CARBO-3988'
org_id uuid NOT NULL REFERENCES organizations(org_id) ON DELETE RESTRICT,
name text NOT NULL,
methodology text NOT NULL DEFAULT 'VM0042 v2.2',
is_grouped boolean NOT NULL DEFAULT true,
verra_registry_id text,
status text NOT NULL DEFAULT 'under_development',
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- A participant farm / instance (CropNut "installation"), e.g. RAI Group.
-- Each farm owns its plots, BSL, strata and sampling campaigns.
CREATE TABLE farms (
farm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
project_id text NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
name text NOT NULL,
installation_code text UNIQUE, -- maps to CropNut 'Installation'
operator text,
country text,
region text,
carbon_rights_ref text, -- contract/MoU ref (anti double-counting)
joined_at date, -- instance added to grouped project
status text NOT NULL DEFAULT 'active',
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- "With Project" (WP) polygon. Belongs to a farm. QA approach lives here.
CREATE TABLE plots (
plot_id text PRIMARY KEY, -- e.g. 'KIS-WP-01'
farm_id uuid NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
geom geometry(Polygon,4326) NOT NULL,
area_ha numeric(12,4),
application_area_ha numeric(12,4),
quantification_approach quant_approach NOT NULL,
soil_group_wrb text,
soil_texture_fao text,
climate_zone_ipcc text,
slope_class text,
stroke_color text, -- Mapbox per-plot outline
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- Homogeneous sub-units of a plot (Stratum A/B/C/D, or named).
CREATE TABLE strata (
stratum_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
plot_id text NOT NULL REFERENCES plots(plot_id) ON DELETE CASCADE,
code text NOT NULL, -- 'A','C','Avtah', ...
geom geometry(Polygon,4326),
area_ha numeric(12,4),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
UNIQUE (plot_id, code)
);

-- QA2 baseline control sites. Each farm has its own.
CREATE TABLE baseline_control_sites (
bsl_id text PRIMARY KEY, -- e.g. 'BSL-01'
farm_id uuid NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
linked_plot_id text REFERENCES plots(plot_id) ON DELETE SET NULL, -- WP it controls for
geom geometry(Polygon,4326) NOT NULL,
area_ha numeric(12,4),
distance_km numeric(8,3) CHECK (distance_km IS NULL OR distance_km >= 0),
similarity_criteria jsonb, -- VM0042 Table 7 (9 criteria)
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- Persistent georeferenced sampling locations, re-visited across cycles.
CREATE TABLE sampling_points (
point_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
plot_id text REFERENCES plots(plot_id) ON DELETE CASCADE,
stratum_id uuid REFERENCES strata(stratum_id) ON DELETE SET NULL,
bsl_id text REFERENCES baseline_control_sites(bsl_id) ON DELETE CASCADE,
scenario sample_scenario NOT NULL,
planned_geom geometry(Point,4326) NOT NULL,
composite_cores smallint,
is_revisit boolean NOT NULL DEFAULT false,
status point_status NOT NULL DEFAULT 'planned',
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
-- a point belongs to a WP plot OR a BSL site, not neither/both
CONSTRAINT point_parent_chk CHECK (num_nonnulls(plot_id, bsl_id) = 1)
);

-- ---------- ACCESS: project-scoped membership & tokens ----------
CREATE TABLE project_memberships (
membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
project_id text NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
role app_role NOT NULL,
granted_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
granted_at timestamptz NOT NULL DEFAULT now(),
UNIQUE (user_id, project_id)
);

-- ---------- SAMPLING LIFECYCLE ----------
-- A per-farm sampling plan / campaign.
CREATE TABLE sampling_cycles (
cycle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
farm_id uuid NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
cycle_number integer NOT NULL,
cycle_type cycle_type NOT NULL,
approach quant_approach NOT NULL,
trigger_type text, -- 'end_of_growth' | '1y_cap' | 'manual'
depth_scheme text NOT NULL DEFAULT '0-15/15-30',
confidence_alpha numeric(4,3) DEFAULT 0.90,
power_1_minus_beta numeric(4,3) DEFAULT 0.80,
mdd_target numeric(8,3), -- t SOC/ha
same_season boolean NOT NULL DEFAULT true,
revisit_points boolean NOT NULL DEFAULT true,
composite_for_bsl boolean NOT NULL DEFAULT false,
status cycle_status NOT NULL DEFAULT 'draft',
generated_by text NOT NULL DEFAULT 'manual', -- 'manual' | 'agent'
approved_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
UNIQUE (farm_id, cycle_number)
);

CREATE TABLE work_orders (
wo_id text PRIMARY KEY, -- e.g. 'WO-2026-0042'
farm_id uuid NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
cycle_id uuid NOT NULL REFERENCES sampling_cycles(cycle_id) ON DELETE CASCADE,
contractor_name text,
contractor_email citext,
lab_destination text,
project_lead uuid REFERENCES users(user_id) ON DELETE SET NULL,
window_start date,
window_end date,
depth_scheme text,
state wo_state NOT NULL DEFAULT 'draft',
pdf_url text, -- S3
issued_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
issued_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- Scoped MCP activation token for an external sampler (no SSO account).
CREATE TABLE mcp_tokens (
token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
work_order_id text NOT NULL REFERENCES work_orders(wo_id) ON DELETE CASCADE,
token_hash text NOT NULL, -- store a hash, never the raw token
contractor_email citext,
issued_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
issued_at timestamptz NOT NULL DEFAULT now(),
expires_at timestamptz NOT NULL,
revoked_at timestamptz,
UNIQUE (work_order_id)
);

-- One capture of one point in one cycle (the field record). Mutable until locked.
CREATE TABLE sampling_events (
event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
point_id uuid NOT NULL REFERENCES sampling_points(point_id) ON DELETE RESTRICT,
cycle_id uuid NOT NULL REFERENCES sampling_cycles(cycle_id) ON DELETE RESTRICT,
work_order_id text REFERENCES work_orders(wo_id) ON DELETE SET NULL,
sampling_date date,
captured_geom geometry(Point,4326),
gps_accuracy_m numeric(7,2),
distance_from_target_m numeric(8,2),
barcode text,
photo_url text, -- S3
field_notes text,
sampler_token_id uuid REFERENCES mcp_tokens(token_id) ON DELETE SET NULL,
locked boolean NOT NULL DEFAULT false,
submitted_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
UNIQUE (point_id, cycle_id)
);

-- The physical sample bag. Carbonature-issued Sample ID. Append-only.
CREATE TABLE samples (
sample_id text PRIMARY KEY DEFAULT next_sample_id(), -- 'OFM00021615'
event_id uuid NOT NULL REFERENCES sampling_events(event_id) ON DELETE RESTRICT,
farm_id uuid NOT NULL REFERENCES farms(farm_id) ON DELETE RESTRICT, -- = installation
stratum_code text,
scenario sample_scenario NOT NULL,
sampling_date date,
created_at timestamptz NOT NULL DEFAULT now(),
UNIQUE (event_id)
);

-- ---------- LAB & SOC DATA (CropNut canonical) ----------
CREATE TABLE labs (
lab_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
name text NOT NULL,
iso_17025 boolean NOT NULL DEFAULT false,
napt_glosolan boolean NOT NULL DEFAULT false,
method lab_method,
contact text,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- Provenance for each ingested workbook. Append-only.
CREATE TABLE lab_imports (
import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
farm_id uuid REFERENCES farms(farm_id) ON DELETE SET NULL,
wo_id text REFERENCES work_orders(wo_id) ON DELETE SET NULL,
lab_id uuid REFERENCES labs(lab_id) ON DELETE SET NULL,
workbook_url text NOT NULL, -- raw file kept in S3 for audit
email_from citext,
parser_status parser_status NOT NULL DEFAULT 'success',
rows_parsed integer NOT NULL DEFAULT 0,
rows_failed integer NOT NULL DEFAULT 0,
imported_by text, -- user id or 'ai_agent'
received_at timestamptz NOT NULL DEFAULT now()
);

-- Canonical SOC measurement. Two rows per sample (0-15 & 15-30 cm). Append-only.
CREATE TABLE soc_measurements (
measurement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
sample_id text NOT NULL REFERENCES samples(sample_id) ON DELETE RESTRICT,
lab_import_id uuid REFERENCES lab_imports(import_id) ON DELETE SET NULL,
depth_cm smallint NOT NULL CHECK (depth_cm IN (15,30)), -- lower bound of increment
bulk_density numeric(6,3), -- g/cm3
toc_pct numeric(7,4), -- primary lab measurement
tic_900_pct numeric(7,4),
tc_pct numeric(7,4),
n_pct numeric(7,4),
cn_ratio numeric(8,3),
roc_600_pct numeric(7,4),
toc_400_pct numeric(7,4),
-- SOC stock written by the ingestion service (NOT the Excel formula).
-- Spec formula: (toc_pct/100) * bulk_density * depth_cm * 1000.
-- NOTE: verify the unit factor — the standard SOC-stock factor is *100
-- (fraction x g/cm3 x cm x 100 = t C/ha); confirm against CropNut before go-live.
soc_t_per_ha numeric(12,4),
created_at timestamptz NOT NULL DEFAULT now(),
UNIQUE (sample_id, depth_cm)
);

-- Rows that failed parsing, with diagnostics. Append-only.
CREATE TABLE import_quarantine (
quarantine_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
import_id uuid NOT NULL REFERENCES lab_imports(import_id) ON DELETE CASCADE,
row_index integer,
raw_row jsonb,
error text,
created_at timestamptz NOT NULL DEFAULT now()
);

-- Equivalent Soil Mass reporting basis (mandatory). Per stratum per cycle.
CREATE TABLE esm_soc_stocks (
esm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
stratum_id uuid NOT NULL REFERENCES strata(stratum_id) ON DELETE CASCADE,
cycle_id uuid NOT NULL REFERENCES sampling_cycles(cycle_id) ON DELETE CASCADE,
reference_soil_mass numeric(14,4), -- t/ha
soc_stock_esm_t_ha numeric(12,4),
computed_at timestamptz NOT NULL DEFAULT now(),
UNIQUE (stratum_id, cycle_id)
);

-- ---------- CARBON MODELLING (QA1) ----------
-- ALM = Agricultural Land Management activity (also the commercial trigger).
CREATE TABLE products (
product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
name text NOT NULL, -- 'DYNOMYCO Spark', 'Rootella L', ...
activity_type activity_type NOT NULL DEFAULT 'biofertilizer',
application_method text,
cost_per_ha numeric(12,2),
credit_per_ha numeric(10,4), -- tCO2e VCU per hectare
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alm_activities (
activity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
plot_id text NOT NULL REFERENCES plots(plot_id) ON DELETE CASCADE,
product_id uuid REFERENCES products(product_id) ON DELETE SET NULL,
activity_type activity_type NOT NULL,
rate numeric(12,4),
application_area_ha numeric(12,4),
application_date date,
season text,
notes text,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_runs (
run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
farm_id uuid NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
cycle_id uuid REFERENCES sampling_cycles(cycle_id) ON DELETE SET NULL,
model carbon_model NOT NULL,
model_version text,
run_type text, -- 'true_up' | 'verification' | 'recalibrate'
scenario model_scenario NOT NULL DEFAULT 'paired',
period_start date,
period_end date,
parameter_set text,
scope jsonb, -- strata / plots in scope
input_manifest jsonb, -- snapshot of input sources
status run_status NOT NULL DEFAULT 'configuring',
log_url text, -- S3
output_url text, -- S3
initiated_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
started_at timestamptz,
completed_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_results (
result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
run_id uuid NOT NULL REFERENCES model_runs(run_id) ON DELETE CASCADE,
stratum_id uuid REFERENCES strata(stratum_id) ON DELETE SET NULL,
delta_soc_wp numeric(12,4), -- project, t/ha
delta_soc_bsl numeric(12,4), -- baseline, t/ha
net_t_ha numeric(12,4),
uncertainty_pct numeric(7,3),
monte_carlo_iters integer,
computed_at timestamptz NOT NULL DEFAULT now()
);

-- Model Validation Report (QA1, VMD0053). P3 workflow.
CREATE TABLE mvr (
mvr_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
run_id uuid NOT NULL REFERENCES model_runs(run_id) ON DELETE CASCADE,
status mvr_status NOT NULL DEFAULT 'draft',
ime_reviewer text,
document_url text, -- S3
signed_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- CREDITS & COMPLIANCE ----------
-- Commercial credits (application-based). Plot/farm level -> marketplace.
CREATE TABLE credits (
credit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
plot_id text NOT NULL REFERENCES plots(plot_id) ON DELETE CASCADE,
activity_id uuid REFERENCES alm_activities(activity_id) ON DELETE SET NULL,
product_id uuid REFERENCES products(product_id) ON DELETE SET NULL,
application_area_ha numeric(12,4),
credits_tco2e numeric(14,4), -- area * credit_per_ha
cost_usd numeric(14,2),
vintage_year integer,
status credit_status NOT NULL DEFAULT 'estimated',
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- Verra-issued VCUs. Grouped-project level (the Verra issuance unit).
CREATE TABLE vcu_issuances (
issuance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
project_id text NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
vintage integer,
quantity_tco2e numeric(16,4),
verra_serial_range text,
issued_date date,
status credit_status NOT NULL DEFAULT 'issued',
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per hard/soft check evaluated for a farm's cycle.
CREATE TABLE compliance_checks (
check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
farm_id uuid NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
cycle_id uuid REFERENCES sampling_cycles(cycle_id) ON DELETE CASCADE,
rule_code text NOT NULL, -- e.g. 'STRATIFIED_RANDOM'
result compliance_result NOT NULL,
detail text,
evaluated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compliance_scores (
score_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
farm_id uuid NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
cycle_id uuid REFERENCES sampling_cycles(cycle_id) ON DELETE CASCADE,
score smallint CHECK (score BETWEEN 0 AND 100),
checks_passed integer,
warnings integer,
fails integer,
evaluated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- AUDIT & AGENT ----------
-- Append-only. Polymorphic target (no FK) so any object can be referenced.
CREATE TABLE audit_log (
audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
actor text NOT NULL, -- user id, 'ai_agent', or token id
action text NOT NULL,
target_type text,
target_id text,
payload jsonb, -- inputs / agent reasoning chain
session_id uuid,
ts timestamptz NOT NULL DEFAULT now()
);

-- Per-action AUTO / CONFIRM / OFF policy for the AI agent.
CREATE TABLE agent_action_policies (
policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
action_name text NOT NULL UNIQUE,
mode agent_mode NOT NULL DEFAULT 'confirm',
updated_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
updated_at timestamptz NOT NULL DEFAULT now()
);

-- Long-term per-project agent memory with embeddings (pgvector).
CREATE TABLE agent_memory (
memory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
project_id text NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
kind text NOT NULL DEFAULT 'long_term',
content text NOT NULL,
embedding vector(1536), -- adjust dim to your model
created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 4. INDEXES
-- =====================================================================
-- Spatial (GIST)
CREATE INDEX idx_plots_geom ON plots USING gist (geom);
CREATE INDEX idx_strata_geom ON strata USING gist (geom);
CREATE INDEX idx_bsl_geom ON baseline_control_sites USING gist (geom);
CREATE INDEX idx_points_geom ON sampling_points USING gist (planned_geom);
CREATE INDEX idx_events_geom ON sampling_events USING gist (captured_geom);

-- Foreign-key / lookup indexes (hot join paths)
CREATE INDEX idx_farms_project ON farms (project_id);
CREATE INDEX idx_plots_farm ON plots (farm_id);
CREATE INDEX idx_strata_plot ON strata (plot_id);
CREATE INDEX idx_bsl_farm ON baseline_control_sites (farm_id);
CREATE INDEX idx_points_plot ON sampling_points (plot_id);
CREATE INDEX idx_points_stratum ON sampling_points (stratum_id);
CREATE INDEX idx_cycles_farm ON sampling_cycles (farm_id);
CREATE INDEX idx_wo_cycle ON work_orders (cycle_id);
CREATE INDEX idx_wo_farm ON work_orders (farm_id);
CREATE INDEX idx_events_point ON sampling_events (point_id);
CREATE INDEX idx_events_cycle ON sampling_events (cycle_id);
CREATE INDEX idx_samples_event ON samples (event_id);
CREATE INDEX idx_samples_farm ON samples (farm_id);
CREATE INDEX idx_soc_sample ON soc_measurements (sample_id);
CREATE INDEX idx_soc_import ON soc_measurements (lab_import_id);
CREATE INDEX idx_alm_plot ON alm_activities (plot_id);
CREATE INDEX idx_runs_farm ON model_runs (farm_id);
CREATE INDEX idx_results_run ON model_results (run_id);
CREATE INDEX idx_credits_plot ON credits (plot_id);
CREATE INDEX idx_memberships_project ON project_memberships (project_id);
CREATE INDEX idx_audit_target ON audit_log (target_type, target_id);
CREATE INDEX idx_audit_ts ON audit_log (ts);

-- Vector similarity (pgvector). Tune lists/ef per data volume.
CREATE INDEX idx_agent_memory_vec ON agent_memory USING hnsw (embedding vector_cosine_ops);

-- =====================================================================
-- 5. TRIGGERS
-- =====================================================================
-- updated_at maintenance (mutable tables only)
CREATE TRIGGER trg_org_upd BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_upd BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_proj_upd BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_farms_upd BEFORE UPDATE ON farms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_plots_upd BEFORE UPDATE ON plots FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_strata_upd BEFORE UPDATE ON strata FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_bsl_upd BEFORE UPDATE ON baseline_control_sites FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_points_upd BEFORE UPDATE ON sampling_points FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cycles_upd BEFORE UPDATE ON sampling_cycles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_wo_upd BEFORE UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_labs_upd BEFORE UPDATE ON labs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_prod_upd BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_alm_upd BEFORE UPDATE ON alm_activities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_runs_upd BEFORE UPDATE ON model_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_mvr_upd BEFORE UPDATE ON mvr FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_credits_upd BEFORE UPDATE ON credits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_vcu_upd BEFORE UPDATE ON vcu_issuances FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only / immutable evidentiary tables (Verra audit trail)
CREATE TRIGGER trg_audit_noupd BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_soc_noupd BEFORE UPDATE OR DELETE ON soc_measurements FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_samples_noupd BEFORE UPDATE OR DELETE ON samples FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_imports_noupd BEFORE UPDATE OR DELETE ON lab_imports FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_quar_noupd BEFORE UPDATE OR DELETE ON import_quarantine FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- Field-capture rows freeze once locked
CREATE TRIGGER trg_events_lock BEFORE UPDATE OR DELETE ON sampling_events FOR EACH ROW EXECUTE FUNCTION prevent_mutation_when_locked();

-- =====================================================================
-- 6. KEY COMMENTS (for DB introspection)
-- =====================================================================
COMMENT ON TABLE projects IS 'Grouped, Verra-registered umbrella project. Unit of VCU issuance.';
COMMENT ON TABLE farms IS 'Participant farm / instance (CropNut "installation"). Owns plots, BSL, strata, sampling campaigns.';
COMMENT ON TABLE plots IS 'WP polygon under a farm. quantification_approach lives here (a farm may be mixed-QA).';
COMMENT ON COLUMN soc_measurements.soc_t_per_ha IS 'Computed in the ingestion service, not from the Excel formula. Verify unit factor (*100 vs *1000) against CropNut.';
COMMENT ON TABLE audit_log IS 'Append-only. Mirrored to S3 (Glacier). Polymorphic target_type/target_id (no FK).';

-- =====================================================================
-- 7. ROW-LEVEL SECURITY (OPTIONAL — enable once SSO + app roles are wired)
-- =====================================================================
-- v1 is single-tenant, but the project_id column lets you switch on
-- project-scoped isolation without a migration. Enable per table, set
-- app.user_id from the API on each connection, and add policies, e.g.:
--
-- ALTER TABLE farms ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY farms_by_membership ON farms
-- USING (project_id IN (
-- SELECT project_id FROM project_memberships
-- WHERE user_id = current_setting('app.user_id', true)::uuid));
--
-- Grant a service/migration role BYPASSRLS so background jobs are unaffected.
-- =====================================================================

-- =====================================================================
-- 8. SEED HINTS (run separately)
-- =====================================================================
-- 1) organizations -> 1 Carbonature org
-- 2) projects -> the grouped Verra project(s)
-- 3) farms -> RAI Group, Nitzan Farm, ... (one per marketplace page)
-- 4) products -> DYNOMYCO Spark / Rootella L / Haifa Multicote
-- with credit_per_ha = 1.0 (tCO2e VCU/ha) from the marketplace
-- 5) plots -> import existing GeoJSON polygons (ST_GeomFromGeoJSON), set farm_id
-- =====================================================================
