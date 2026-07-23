-- =====================================================================
-- 0017 · machinery_to_diesel() — the fuel-input helper
--
-- The GHG engine (0013) already reproduces the calculator's fuel CO2
-- exactly, from litres of diesel/gasoline. This adds the one piece that
-- was reference data without a function: the calculator's "Machinery-
-- Diesel" sheet, which estimates litres from machinery when a fuel
-- invoice is unavailable.
--
--   Diesel (L) = HP × 0.7457 × load_factor × SFC × hours_per_ha × area_ha
--
-- 0.7457 converts HP to kW. The result feeds activity_data.diesel_l, so
-- the emission side is unchanged — this only completes the input side.
-- =====================================================================

-- migrate:up

CREATE OR REPLACE FUNCTION mrv.machinery_to_diesel(
  p_rated_hp     numeric,
  p_load_factor  numeric,
  p_sfc_l_per_kwh numeric,
  p_hours_per_ha numeric,
  p_area_ha      numeric
) RETURNS numeric AS $$
  SELECT round(
    (p_rated_hp * 0.7457 * p_load_factor * p_sfc_l_per_kwh * p_hours_per_ha * p_area_ha)::numeric,
    2);
$$ LANGUAGE sql IMMUTABLE STRICT;

COMMENT ON FUNCTION mrv.machinery_to_diesel(numeric,numeric,numeric,numeric,numeric) IS
  'Diesel litres from machinery when no fuel invoice exists (GHG calculator Machinery-Diesel sheet). HP x 0.7457 x load x SFC x hours/ha x area. Feeds activity_data.diesel_l.';

-- Convenience overload keyed on a seeded machinery_defaults row, so a
-- caller need only give the equipment name and the area worked.
CREATE OR REPLACE FUNCTION mrv.machinery_to_diesel(
  p_equipment text,
  p_area_ha   numeric
) RETURNS numeric AS $$
  SELECT mrv.machinery_to_diesel(rated_hp, load_factor, sfc_l_per_kwh, hours_per_ha, p_area_ha)
  FROM mrv.machinery_defaults WHERE equipment = p_equipment;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION mrv.machinery_to_diesel(text,numeric) IS
  'Diesel litres for a named machinery_defaults row over p_area_ha. Returns NULL if the equipment is unknown.';

-- migrate:down

DROP FUNCTION IF EXISTS mrv.machinery_to_diesel(text, numeric);
DROP FUNCTION IF EXISTS mrv.machinery_to_diesel(numeric, numeric, numeric, numeric, numeric);
