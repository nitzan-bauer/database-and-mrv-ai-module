-- =====================================================================
-- 0011 · Stage 4 — lab ingestion and the SOC schema
--
--   labs                the analytical laboratory
--   lab_imports         one ingested workbook — provenance
--   soc_measurements    canonical carbon result, per sample per depth
--   texture_measurements sand/silt/clay, the cycle-1 characterisation
--   import_quarantine   rows that failed parsing, with the reason
--   esm_soc_stocks       equivalent-soil-mass stock, per stratum per cycle
--
-- This is the evidentiary heart of the module. Every table here except
-- labs is append-only: a correction is a new row, never an edit, because
-- a VVB must be able to see the original lab value even after it is
-- superseded.
--
-- Two things the research forced into the schema:
--
-- 1. DIN 19539 / ISO 17505 ramped combustion gives three fractions —
--    TOC400 (labile), ROC600 (recalcitrant: char, soot, coal), TIC900
--    (carbonates). TC = TOC400 + ROC600 + TIC900, and true organic
--    carbon is TOC400 + ROC600. Storing only "TOC" would lose the
--    fraction that matters for fire-affected soils.
--
-- 2. ESM (VM0042 8.2.1.6): stock change must be on an equivalent-soil-
--    mass basis, so soil mass = dry sample mass / probe area, not
--    BD x depth. Both inputs are captured on soc_measurements.
-- =====================================================================

-- migrate:up

-- ---------------------------------------------------------------------
-- Laboratories. Mutable reference data (accreditation status changes).
-- ---------------------------------------------------------------------
CREATE TABLE mrv.labs (
  lab_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL UNIQUE,
  iso_17025         boolean NOT NULL DEFAULT false,
  napt_member       boolean NOT NULL DEFAULT false,
  glosolan_member   boolean NOT NULL DEFAULT false,
  default_method    mrv.lab_method,
  contact           text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mrv.labs IS
  'Analytical labs. VM0042 8.2.1.4 wants ISO/IEC 17025 where possible, one lab for the project lifetime, and NAPT or GLOSOLAN proficiency evidence.';

-- Now that labs exists, tie the stage-3 work-order column to it.
ALTER TABLE mrv.work_orders
  ADD CONSTRAINT work_orders_lab_fk
  FOREIGN KEY (lab_id) REFERENCES mrv.labs(lab_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- Lab imports — provenance for each ingested workbook. Append-only.
--
-- The raw file is kept in Supabase Storage (the S3 `labs` bucket under
-- AWS), never mutated, for the audit trail. This row records where it
-- came from and how the parse went.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.lab_imports (
  import_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id        uuid REFERENCES mrv.farms(farm_id) ON DELETE SET NULL,
  wo_id          text REFERENCES mrv.work_orders(wo_id) ON DELETE SET NULL,
  lab_id         uuid REFERENCES mrv.labs(lab_id) ON DELETE SET NULL,
  workbook_url   text NOT NULL,                    -- raw file, kept for audit
  workbook_sha256 text,                            -- integrity of the stored file
  datasheet_version text,                          -- e.g. 'CarboNature v2.0'
  email_from     citext,
  parser_status  mrv.parser_status NOT NULL DEFAULT 'success',
  rows_parsed    integer NOT NULL DEFAULT 0 CHECK (rows_parsed >= 0),
  rows_failed    integer NOT NULL DEFAULT 0 CHECK (rows_failed >= 0),
  imported_by    text,                             -- user id or 'ai_agent'
  received_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_imports_farm ON mrv.lab_imports (farm_id);
CREATE INDEX idx_imports_wo   ON mrv.lab_imports (wo_id);

-- ---------------------------------------------------------------------
-- SOC measurements — the canonical carbon result. Append-only.
--
-- One row per sample per depth increment. The fractions are stored as
-- the lab reports them; toc_pct and tc are GENERATED so the identity
-- TOC = TOC400 + ROC600 can never drift, and so a downstream query
-- cannot accidentally treat the labile fraction alone as organic carbon.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.soc_measurements (
  measurement_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id       text NOT NULL REFERENCES mrv.samples(sample_id) ON DELETE RESTRICT,
  lab_import_id   uuid REFERENCES mrv.lab_imports(import_id) ON DELETE SET NULL,
  lab_id          uuid REFERENCES mrv.labs(lab_id) ON DELETE SET NULL,
  method          mrv.lab_method NOT NULL DEFAULT 'dry_combustion',
  analysis_date   date,
  replicate_no    smallint NOT NULL DEFAULT 1 CHECK (replicate_no >= 1),

  depth_top_cm    smallint NOT NULL CHECK (depth_top_cm >= 0),
  depth_base_cm   smallint NOT NULL CHECK (depth_base_cm > 0),

  -- Bulk density and the ESM inputs.
  bulk_density    numeric(6,3) CHECK (bulk_density IS NULL OR (bulk_density > 0 AND bulk_density < 3)),
  small_cf_pct    numeric(5,2) CHECK (small_cf_pct IS NULL OR small_cf_pct BETWEEN 0 AND 100),  -- 2-10 mm, mass %
  large_cf_pct    numeric(5,2) CHECK (large_cf_pct IS NULL OR large_cf_pct BETWEEN 0 AND 100),  -- >10 mm, vol %
  dry_sample_mass_g numeric(10,3) CHECK (dry_sample_mass_g IS NULL OR dry_sample_mass_g > 0),
  probe_area_cm2  numeric(10,3) CHECK (probe_area_cm2 IS NULL OR probe_area_cm2 > 0),

  -- DIN 19539 / ISO 17505 fractions, as measured.
  tc_pct          numeric(7,4) CHECK (tc_pct IS NULL OR tc_pct >= 0),
  toc_400_pct     numeric(7,4) CHECK (toc_400_pct IS NULL OR toc_400_pct >= 0),
  roc_600_pct     numeric(7,4) CHECK (roc_600_pct IS NULL OR roc_600_pct >= 0),
  tic_900_pct     numeric(7,4) CHECK (tic_900_pct IS NULL OR tic_900_pct >= 0),
  n_pct           numeric(7,4) CHECK (n_pct IS NULL OR n_pct >= 0),

  -- Total organic carbon = labile + recalcitrant. Generated, not stored,
  -- so it can never be entered inconsistently with its fractions.
  toc_pct numeric(7,4) GENERATED ALWAYS AS (
    CASE WHEN toc_400_pct IS NULL AND roc_600_pct IS NULL THEN NULL
         ELSE coalesce(toc_400_pct,0) + coalesce(roc_600_pct,0) END
  ) STORED,

  -- SOC stock on a fixed-depth basis, t C/ha, coarse-fragment corrected.
  -- Convenience only: the auditable stock is the ESM one in
  -- esm_soc_stocks. Factor 100 (per the GHG calculator, not the spec's 1000).
  soc_t_per_ha numeric(12,4) GENERATED ALWAYS AS (
    CASE WHEN (coalesce(toc_400_pct,0)+coalesce(roc_600_pct,0)) > 0
              AND bulk_density IS NOT NULL
         THEN round(
                (coalesce(toc_400_pct,0)+coalesce(roc_600_pct,0))
                * bulk_density * (depth_base_cm - depth_top_cm)
                * (1 - coalesce(large_cf_pct,0)/100.0), 4)
         ELSE NULL END
  ) STORED,

  -- Soil mass t/ha for the ESM basis: dry mass / probe area preferred,
  -- BD x thickness as fallback.
  soil_mass_t_ha numeric(12,4) GENERATED ALWAYS AS (
    CASE WHEN dry_sample_mass_g IS NOT NULL AND probe_area_cm2 IS NOT NULL
         THEN round((dry_sample_mass_g / probe_area_cm2 * 100)::numeric, 4)
         WHEN bulk_density IS NOT NULL
         THEN round((bulk_density * (depth_base_cm - depth_top_cm) * 100
                     * (1 - coalesce(large_cf_pct,0)/100.0))::numeric, 4)
         ELSE NULL END
  ) STORED,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (sample_id, depth_top_cm, depth_base_cm, replicate_no),
  CONSTRAINT soc_depth_chk CHECK (depth_base_cm > depth_top_cm),
  -- If all three fractions and TC are present they must reconcile.
  CONSTRAINT soc_tc_identity_chk CHECK (
    tc_pct IS NULL OR toc_400_pct IS NULL OR roc_600_pct IS NULL OR tic_900_pct IS NULL
    OR abs(tc_pct - toc_400_pct - roc_600_pct - tic_900_pct) <= 0.1
  )
);

COMMENT ON COLUMN mrv.soc_measurements.toc_pct IS
  'Total organic carbon = TOC400 + ROC600. Generated — never entered. Using TOC400 alone under-reports char/soot carbon.';
COMMENT ON COLUMN mrv.soc_measurements.soc_t_per_ha IS
  'Fixed-depth stock, convenience only. The auditable figure is the ESM stock in esm_soc_stocks.';
COMMENT ON COLUMN mrv.soc_measurements.soil_mass_t_ha IS
  'Soil mass for the ESM basis: dry_sample_mass / probe_area preferred (VM0042 8.2.1.6), BD x thickness as fallback.';

-- ---------------------------------------------------------------------
-- Texture measurements — the cycle-1 characterisation that drives
-- stratification. Append-only. sand + silt + clay = 100 of fine earth.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.texture_measurements (
  texture_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id      text NOT NULL REFERENCES mrv.samples(sample_id) ON DELETE RESTRICT,
  lab_import_id  uuid REFERENCES mrv.lab_imports(import_id) ON DELETE SET NULL,
  lab_id         uuid REFERENCES mrv.labs(lab_id) ON DELETE SET NULL,
  method         text,                             -- hydrometer, pipette, laser
  analysis_date  date,
  depth_cm       smallint CHECK (depth_cm IS NULL OR depth_cm >= 0),
  sand_pct       numeric(5,2) NOT NULL CHECK (sand_pct BETWEEN 0 AND 100),
  silt_pct       numeric(5,2) NOT NULL CHECK (silt_pct BETWEEN 0 AND 100),
  clay_pct       numeric(5,2) NOT NULL CHECK (clay_pct BETWEEN 0 AND 100),
  -- Class derived from the same function the strata table uses.
  usda_class text GENERATED ALWAYS AS (mrv.usda_texture_class(sand_pct, silt_pct, clay_pct)) STORED,
  created_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (sample_id),
  CONSTRAINT texture_sum_chk CHECK (abs(sand_pct + silt_pct + clay_pct - 100) <= 1.0)
);

COMMENT ON TABLE mrv.texture_measurements IS
  'Cycle-1 texture, the variance-characterisation input to stratification (VM0042 8.2.1.3(10)). Note the lab method: laser diffraction reads clay lower than hydrometer/pipette and is not interchangeable across cycles.';

-- ---------------------------------------------------------------------
-- Import quarantine — rows the parser could not accept. Append-only.
-- Keeps the failure visible instead of dropping it silently.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.import_quarantine (
  quarantine_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id     uuid NOT NULL REFERENCES mrv.lab_imports(import_id) ON DELETE CASCADE,
  row_index     integer,
  raw_row       jsonb,
  error         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_quarantine_import ON mrv.import_quarantine (import_id);

-- ---------------------------------------------------------------------
-- ESM SOC stocks — the auditable stock, per stratum per cycle.
-- Computed by the service layer on the equivalent-soil-mass basis and
-- written here. Append-only: a recomputation is a new row.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.esm_soc_stocks (
  esm_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stratum_id          uuid NOT NULL REFERENCES mrv.strata(stratum_id) ON DELETE RESTRICT,
  cycle_id            uuid NOT NULL REFERENCES mrv.sampling_cycles(cycle_id) ON DELETE RESTRICT,
  scenario            mrv.sample_scenario NOT NULL,
  reference_soil_mass_t_ha numeric(14,4) CHECK (reference_soil_mass_t_ha IS NULL OR reference_soil_mass_t_ha > 0),
  soc_stock_esm_t_ha  numeric(12,4),
  n_samples           smallint CHECK (n_samples IS NULL OR n_samples > 0),
  sd_t_ha             numeric(12,4),
  method_ref          text NOT NULL DEFAULT 'Wendt & Hauser 2013',
  computed_by         text,
  computed_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (stratum_id, cycle_id, scenario, computed_at)
);

COMMENT ON TABLE mrv.esm_soc_stocks IS
  'SOC stock on an equivalent-soil-mass basis (VM0042 8.2.1.6). This, not soc_measurements.soc_t_per_ha, is what a verification reads.';

-- ---------------------------------------------------------------------
-- Append-only guards + audit
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_imports_noupd    BEFORE UPDATE OR DELETE ON mrv.lab_imports         FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();
CREATE TRIGGER trg_soc_noupd        BEFORE UPDATE OR DELETE ON mrv.soc_measurements     FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();
CREATE TRIGGER trg_texture_noupd    BEFORE UPDATE OR DELETE ON mrv.texture_measurements FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();
CREATE TRIGGER trg_quar_noupd       BEFORE UPDATE OR DELETE ON mrv.import_quarantine    FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();
CREATE TRIGGER trg_esm_noupd        BEFORE UPDATE OR DELETE ON mrv.esm_soc_stocks       FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();

CREATE TRIGGER trg_labs_upd BEFORE UPDATE ON mrv.labs FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();

CREATE INDEX idx_soc_sample     ON mrv.soc_measurements (sample_id);
CREATE INDEX idx_soc_import     ON mrv.soc_measurements (lab_import_id);
CREATE INDEX idx_texture_sample ON mrv.texture_measurements (sample_id);
CREATE INDEX idx_esm_stratum    ON mrv.esm_soc_stocks (stratum_id, cycle_id);

CREATE TRIGGER trg_audit_labs     AFTER INSERT OR UPDATE OR DELETE ON mrv.labs                FOR EACH ROW EXECUTE FUNCTION mrv.log_change('lab_id');
CREATE TRIGGER trg_audit_imports  AFTER INSERT ON mrv.lab_imports         FOR EACH ROW EXECUTE FUNCTION mrv.log_change('import_id');
CREATE TRIGGER trg_audit_soc      AFTER INSERT ON mrv.soc_measurements     FOR EACH ROW EXECUTE FUNCTION mrv.log_change('measurement_id');
CREATE TRIGGER trg_audit_texture  AFTER INSERT ON mrv.texture_measurements FOR EACH ROW EXECUTE FUNCTION mrv.log_change('texture_id');
CREATE TRIGGER trg_audit_esm      AFTER INSERT ON mrv.esm_soc_stocks       FOR EACH ROW EXECUTE FUNCTION mrv.log_change('esm_id');

-- migrate:down

DROP TRIGGER IF EXISTS trg_audit_esm     ON mrv.esm_soc_stocks;
DROP TRIGGER IF EXISTS trg_audit_texture ON mrv.texture_measurements;
DROP TRIGGER IF EXISTS trg_audit_soc     ON mrv.soc_measurements;
DROP TRIGGER IF EXISTS trg_audit_imports ON mrv.lab_imports;
DROP TRIGGER IF EXISTS trg_audit_labs    ON mrv.labs;
DROP TRIGGER IF EXISTS trg_esm_noupd     ON mrv.esm_soc_stocks;
DROP TRIGGER IF EXISTS trg_quar_noupd    ON mrv.import_quarantine;
DROP TRIGGER IF EXISTS trg_texture_noupd ON mrv.texture_measurements;
DROP TRIGGER IF EXISTS trg_soc_noupd     ON mrv.soc_measurements;
DROP TRIGGER IF EXISTS trg_imports_noupd ON mrv.lab_imports;

ALTER TABLE mrv.work_orders DROP CONSTRAINT IF EXISTS work_orders_lab_fk;

DROP TABLE IF EXISTS mrv.esm_soc_stocks;
DROP TABLE IF EXISTS mrv.import_quarantine;
DROP TABLE IF EXISTS mrv.texture_measurements;
DROP TABLE IF EXISTS mrv.soc_measurements;
DROP TABLE IF EXISTS mrv.lab_imports;
DROP TABLE IF EXISTS mrv.labs;
