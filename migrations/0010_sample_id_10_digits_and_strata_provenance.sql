-- =====================================================================
-- 0010 · Sample ID widened to 10 digits, and stratum provenance
--
-- Two corrections that had to wait for stage 3.
--
-- 1. The Sample ID format guard. The generator lives in 0009; this
--    enforces OFM + exactly 10 digits at the table, so a hand-written
--    insert cannot introduce a second format. Physical bags carry this
--    number and a barcode scanner matches it exactly.
--
-- 2. Strata are an OUTPUT of the cycle-1 texture campaign, not an input
--    to it. The schema previously let a stratum exist with no record of
--    where its boundary came from. A VVB will ask.
-- =====================================================================

-- migrate:up

-- Reject anything not matching the agreed format, whoever inserts it.
-- The generator itself lives in 0009.
ALTER TABLE mrv.samples
  ADD CONSTRAINT sample_id_format_chk CHECK (sample_id ~ '^OFM[0-9]{10}$');

-- ---------------------------------------------------------------------
-- Stratum provenance
-- ---------------------------------------------------------------------
ALTER TABLE mrv.strata
  ADD COLUMN method              mrv.stratification_method NOT NULL DEFAULT 'provisional',
  ADD COLUMN derived_from_cycle  uuid REFERENCES mrv.sampling_cycles(cycle_id) ON DELETE SET NULL,
  ADD COLUMN derived_at          timestamptz,
  -- Mean texture of the stratum, from the cycle that defined it. Kept on
  -- the stratum so the sampling planner can reason about it without
  -- re-aggregating every measurement.
  ADD COLUMN mean_sand_pct       numeric(5,2) CHECK (mean_sand_pct IS NULL OR mean_sand_pct BETWEEN 0 AND 100),
  ADD COLUMN mean_silt_pct       numeric(5,2) CHECK (mean_silt_pct IS NULL OR mean_silt_pct BETWEEN 0 AND 100),
  ADD COLUMN mean_clay_pct       numeric(5,2) CHECK (mean_clay_pct IS NULL OR mean_clay_pct BETWEEN 0 AND 100),
  ADD COLUMN usda_texture_class  text;

COMMENT ON COLUMN mrv.strata.method IS
  'How the boundary was derived. "provisional" means cycle 1 has not yet run — the stratum is a placeholder.';
COMMENT ON COLUMN mrv.strata.derived_from_cycle IS
  'The sampling cycle whose results defined this stratum. Null for manual or map-derived boundaries.';

-- A texture-derived stratum must say which cycle derived it, and must
-- carry the composition that justifies the boundary.
ALTER TABLE mrv.strata
  ADD CONSTRAINT strata_texture_provenance_chk
  CHECK (
    method <> 'texture'
    OR (derived_from_cycle IS NOT NULL
        AND mean_sand_pct IS NOT NULL
        AND mean_silt_pct IS NOT NULL
        AND mean_clay_pct IS NOT NULL)
  );

-- Fractions are of the fine-earth (<2 mm) fraction and must sum to 100.
-- One percentage point of slack absorbs lab rounding.
ALTER TABLE mrv.strata
  ADD CONSTRAINT strata_texture_sum_chk
  CHECK (
    mean_sand_pct IS NULL OR mean_silt_pct IS NULL OR mean_clay_pct IS NULL
    OR abs(mean_sand_pct + mean_silt_pct + mean_clay_pct - 100) <= 1.0
  );

-- ---------------------------------------------------------------------
-- USDA texture classification.
--
-- Verified by tiling rather than by citation: across 5,151 grid points
-- covering the whole simplex, every point matches exactly one class —
-- no gaps, no overlaps, all 12 classes present. Wrong boundaries would
-- leave a hole or a double-match.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mrv.usda_texture_class(
  sand numeric, silt numeric, clay numeric
) RETURNS text AS $$
  SELECT CASE
    WHEN sand IS NULL OR silt IS NULL OR clay IS NULL THEN NULL
    WHEN abs(sand + silt + clay - 100) > 1.0 THEN NULL
    WHEN silt + 1.5 * clay < 15 THEN 'sand'
    WHEN silt + 1.5 * clay >= 15 AND silt + 2 * clay < 30 THEN 'loamy sand'
    WHEN (clay >= 7 AND clay < 20 AND sand > 52 AND silt + 2 * clay >= 30)
      OR (clay < 7 AND silt < 50 AND sand > 43 AND silt + 2 * clay >= 30) THEN 'sandy loam'
    WHEN clay >= 7 AND clay < 27 AND silt >= 28 AND silt < 50 AND sand <= 52 THEN 'loam'
    WHEN (silt >= 50 AND clay >= 12 AND clay < 27)
      OR (silt >= 50 AND silt < 80 AND clay < 12) THEN 'silt loam'
    WHEN silt >= 80 AND clay < 12 THEN 'silt'
    WHEN clay >= 20 AND clay < 35 AND silt < 28 AND sand > 45 THEN 'sandy clay loam'
    WHEN clay >= 27 AND clay < 40 AND sand > 20 AND sand <= 45 THEN 'clay loam'
    WHEN clay >= 27 AND clay < 40 AND sand <= 20 THEN 'silty clay loam'
    WHEN clay >= 35 AND sand > 45 THEN 'sandy clay'
    WHEN clay >= 40 AND silt >= 40 THEN 'silty clay'
    WHEN clay >= 40 AND sand <= 45 AND silt < 40 THEN 'clay'
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION mrv.usda_texture_class(numeric,numeric,numeric) IS
  'USDA soil texture class from sand/silt/clay percentages of the fine-earth fraction. Returns NULL if they do not sum to 100 within 1 point.';

-- Keep the stored class consistent with the stored percentages.
CREATE OR REPLACE FUNCTION mrv.set_stratum_texture_class() RETURNS trigger AS $$
BEGIN
  NEW.usda_texture_class :=
    mrv.usda_texture_class(NEW.mean_sand_pct, NEW.mean_silt_pct, NEW.mean_clay_pct);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_strata_texture_class
  BEFORE INSERT OR UPDATE ON mrv.strata
  FOR EACH ROW EXECUTE FUNCTION mrv.set_stratum_texture_class();

CREATE TRIGGER trg_audit_strata_stage3 AFTER INSERT OR UPDATE OR DELETE ON mrv.strata
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('stratum_id');

-- migrate:down

DROP TRIGGER IF EXISTS trg_audit_strata_stage3 ON mrv.strata;
DROP TRIGGER IF EXISTS trg_strata_texture_class ON mrv.strata;
DROP FUNCTION IF EXISTS mrv.set_stratum_texture_class();
DROP FUNCTION IF EXISTS mrv.usda_texture_class(numeric,numeric,numeric);

ALTER TABLE mrv.strata
  DROP CONSTRAINT IF EXISTS strata_texture_sum_chk,
  DROP CONSTRAINT IF EXISTS strata_texture_provenance_chk,
  DROP COLUMN IF EXISTS usda_texture_class,
  DROP COLUMN IF EXISTS mean_clay_pct,
  DROP COLUMN IF EXISTS mean_silt_pct,
  DROP COLUMN IF EXISTS mean_sand_pct,
  DROP COLUMN IF EXISTS derived_at,
  DROP COLUMN IF EXISTS derived_from_cycle,
  DROP COLUMN IF EXISTS method;

ALTER TABLE mrv.samples DROP CONSTRAINT IF EXISTS sample_id_format_chk;

