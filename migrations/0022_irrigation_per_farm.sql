-- migrate:up
-- =====================================================================
-- 0022 — irrigation method belongs to the farm, not the parameter set.
--
-- 0020 put a dry_climate_flood_irrigated flag on ghg_parameters. That was
-- structurally wrong. A parameter set is scoped per project and climate
-- zone, so every farm sharing a zone was forced to share an irrigation
-- method — the same class of error 0020 itself was written to fix, just
-- along a different axis.
--
-- It is also wrong about the world. Drip is not an Israeli speciality:
-- large drip schemes run across Kenya and East Africa, and water scarcity
-- is moving more farms onto drip every season. Any default keyed off the
-- country or the climate zone would mislabel a real farm's water
-- management, and under VM0042 improved irrigation is itself an eligible
-- project activity — the module must be able to record that a farm moved
-- onto drip, not assume it away.
--
-- So irrigation_method moves onto mrv.farms, one value per farm, no
-- default. Where it is unknown, resolution raises rather than guessing.
--
-- What the method does and does not change
-- ----------------------------------------
-- Frac_LEACH is about a water surplus draining below the root zone
-- (IPCC 2019 Refinement Vol.4 Ch.11). Two different causes:
--
--   wet zone  — precipitation exceeds evapotranspiration, so the surplus
--               comes from rain. Leaching happens whatever the irrigation
--               method is, and drip does not remove it. This is not a
--               penalty attached to a region; it is where the water is.
--
--   dry zone  — rain alone leaves no surplus, so only irrigation can
--               create one. Flood and furrow do; sprinkler wets the whole
--               profile and is treated as doing so; drip delivers to the
--               root zone and does not; rain-fed has no irrigation at all.
--
-- The consequence is that a dry-zone farm on drip gets Frac_LEACH = 0
-- whether it is in Israel or in Kenya. The determination is now made from
-- the farm's own zone and method, and nothing else.
-- =====================================================================

CREATE TYPE mrv.irrigation_method AS ENUM
  ('flood','furrow','sprinkler','drip','rainfed');

COMMENT ON TYPE mrv.irrigation_method IS
  'How water reaches the crop. Drives Frac_LEACH in a dry zone; recorded for every farm because VM0042 treats improved irrigation as a project activity in its own right.';

ALTER TABLE mrv.farms
  ADD COLUMN irrigation_method mrv.irrigation_method;

COMMENT ON COLUMN mrv.farms.irrigation_method IS
  'Per-farm, deliberately with no default. An unset value raises at resolution rather than being assumed, because assuming flood irrigation overstates leaching and assuming drip understates it.';

CREATE INDEX idx_farms_irrigation ON mrv.farms (irrigation_method);

-- ---- Frac_LEACH now takes the farm's method -------------------------
-- The single-argument form is dropped, not left beside this one: leaving
-- it would let a caller keep reading the flag on the parameter set and
-- silently get a different answer from the same database.
DROP FUNCTION IF EXISTS mrv.frac_leach(mrv.ghg_parameters);

-- Deliberately NOT STRICT. A STRICT function returns NULL for a NULL
-- argument, so an unset irrigation_method would make Frac_LEACH NULL,
-- which would propagate through the multiplication and land as a NULL
-- indirect-N2O figure instead of an error. Without STRICT the CASE runs:
-- `NULL IN ('flood',...)` is not true, so a dry zone with an unknown
-- method falls to 0 — and compute_emissions raises before it can.
CREATE FUNCTION mrv.frac_leach(p mrv.ghg_parameters, m mrv.irrigation_method)
RETURNS numeric AS $$
  SELECT CASE
    -- Rain makes the surplus; the irrigation method cannot take it away.
    WHEN p.climate_zone = 'wet' THEN p.frac_leach_wet
    -- Dry zone: only irrigation that wets beyond the root zone leaches.
    WHEN m IN ('flood','furrow','sprinkler') THEN p.frac_leach_wet
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION mrv.frac_leach(mrv.ghg_parameters, mrv.irrigation_method) IS
  'Frac_LEACH from the climate zone and the farm''s own irrigation method. Wet zones leach on rainfall regardless of method; dry zones leach only under flood, furrow or sprinkler.';

-- The flag it replaces stays on the table because result rows already
-- point at these parameter sets and a VVB must still be able to read what
-- produced an issued figure. Nothing consults it any more.
COMMENT ON COLUMN mrv.ghg_parameters.dry_climate_flood_irrigated IS
  'DEPRECATED as of migration 0022 — superseded by mrv.farms.irrigation_method, which is per farm. Retained only so historical emission_results remain interpretable. Not read by mrv.frac_leach().';

-- ---- compute_emissions passes the farm's method ----------------------
CREATE OR REPLACE FUNCTION mrv.compute_emissions(
  p_activity_data_id uuid,
  p_parameter_set_id uuid
) RETURNS mrv.emission_results AS $$
DECLARE
  ad   mrv.activity_data%ROWTYPE;
  p    mrv.ghg_parameters%ROWTYPE;
  r    mrv.emission_results;
  irr  mrv.irrigation_method;
  fsn  numeric;
  fon  numeric;
  gasf numeric;
  gasm numeric;
  conv numeric;
BEGIN
  SELECT * INTO ad FROM mrv.activity_data WHERE activity_data_id = p_activity_data_id;
  SELECT * INTO p  FROM mrv.ghg_parameters WHERE parameter_set_id = p_parameter_set_id;
  IF ad.activity_data_id IS NULL OR p.parameter_set_id IS NULL THEN
    RAISE EXCEPTION 'compute_emissions: activity data or parameter set not found';
  END IF;

  SELECT f.irrigation_method INTO irr FROM mrv.farms f WHERE f.farm_id = ad.farm_id;

  -- Only a dry zone needs the method; in a wet zone rainfall decides and
  -- an unset value changes nothing, so do not block the calculation.
  IF irr IS NULL AND p.climate_zone = 'dry' THEN
    RAISE EXCEPTION
      'compute_emissions: farm % has no irrigation_method. In a dry zone it decides Frac_LEACH (0 on drip or rain-fed, % under flood), so it cannot be assumed.',
      ad.farm_id, p.frac_leach_wet;
  END IF;

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
      + ( (fsn + fon) * mrv.frac_leach(p, irr) * p.ef_n_leach * conv )
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

  INSERT INTO mrv.emission_results
    (activity_data_id, parameter_set_id, fsn_t_n, fon_t_n,
     n2o_direct_tco2e_ha, n2o_indirect_tco2e_ha, n2o_nfix_tco2e_ha,
     co2_fuel_tco2e_ha, n2o_burn_tco2e_ha, total_tco2e_ha, total_tco2e)
  VALUES
    (r.activity_data_id, r.parameter_set_id, r.fsn_t_n, r.fon_t_n,
     r.n2o_direct_tco2e_ha, r.n2o_indirect_tco2e_ha, r.n2o_nfix_tco2e_ha,
     r.co2_fuel_tco2e_ha, r.n2o_burn_tco2e_ha, r.total_tco2e_ha, r.total_tco2e)
  RETURNING * INTO r;

  RETURN r;
END;
$$ LANGUAGE plpgsql;

-- migrate:down
DROP INDEX IF EXISTS mrv.idx_farms_irrigation;
ALTER TABLE mrv.farms DROP COLUMN IF EXISTS irrigation_method;
DROP FUNCTION IF EXISTS mrv.frac_leach(mrv.ghg_parameters, mrv.irrigation_method);
DROP TYPE IF EXISTS mrv.irrigation_method;

CREATE FUNCTION mrv.frac_leach(p mrv.ghg_parameters)
RETURNS numeric AS $$
  SELECT CASE
    WHEN p.climate_zone = 'wet' THEN p.frac_leach_wet
    WHEN p.climate_zone = 'dry' AND p.dry_climate_flood_irrigated THEN p.frac_leach_wet
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE STRICT;

COMMENT ON COLUMN mrv.ghg_parameters.dry_climate_flood_irrigated IS
  'Dry climate only: true for flood/furrow irrigation, which opens the leaching pathway. Drip and sprinkler are FALSE — IPCC 2019 Refinement treats them as non-leaching. Ignored when climate_zone = wet.';

-- compute_emissions has to go back to the single-argument frac_leach in
-- the same step. Restoring the type and function without restoring the
-- caller would leave a compute_emissions that references a dropped type —
-- plpgsql bodies are not checked until they run, so it would look fine
-- and fail on the next calculation.
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
  gasf numeric;
  gasm numeric;
  conv numeric;
BEGIN
  SELECT * INTO ad FROM mrv.activity_data WHERE activity_data_id = p_activity_data_id;
  SELECT * INTO p  FROM mrv.ghg_parameters WHERE parameter_set_id = p_parameter_set_id;
  IF ad.activity_data_id IS NULL OR p.parameter_set_id IS NULL THEN
    RAISE EXCEPTION 'compute_emissions: activity data or parameter set not found';
  END IF;

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
  r.n2o_direct_tco2e_ha := round(((fsn + fon) * mrv.ef_n_direct(p) * conv / ad.area_ha)::numeric, 4);
  r.n2o_indirect_tco2e_ha := round((
      ( (gasf + gasm) * p.ef_n_volat * conv )
      + ( (fsn + fon) * mrv.frac_leach(p) * p.ef_n_leach * conv )
    ) / ad.area_ha, 4);
  r.n2o_nfix_tco2e_ha := round((
      ad.nfix_dry_matter_t * ad.nfix_n_content * mrv.ef_n_direct(p) * conv / ad.area_ha
    )::numeric, 4);
  r.co2_fuel_tco2e_ha := round((
      (ad.diesel_l * p.ef_co2_diesel + ad.gasoline_l * p.ef_co2_gasoline) / ad.area_ha
    )::numeric, 4);
  r.n2o_burn_tco2e_ha := round((
      p.gwp_n2o * ad.residue_burnt_kg * p.cf_combustion * p.ef_c_n2o / 1000000.0 / ad.area_ha
    )::numeric, 4);
  r.total_tco2e_ha := r.co2_fuel_tco2e_ha + r.n2o_burn_tco2e_ha
    + CASE WHEN p.soil_n2o_approach = 'QA3'
           THEN r.n2o_direct_tco2e_ha + r.n2o_indirect_tco2e_ha + r.n2o_nfix_tco2e_ha
           ELSE 0 END;
  r.total_tco2e := round((r.total_tco2e_ha * ad.area_ha)::numeric, 4);

  INSERT INTO mrv.emission_results
    (activity_data_id, parameter_set_id, fsn_t_n, fon_t_n,
     n2o_direct_tco2e_ha, n2o_indirect_tco2e_ha, n2o_nfix_tco2e_ha,
     co2_fuel_tco2e_ha, n2o_burn_tco2e_ha, total_tco2e_ha, total_tco2e)
  VALUES
    (r.activity_data_id, r.parameter_set_id, r.fsn_t_n, r.fon_t_n,
     r.n2o_direct_tco2e_ha, r.n2o_indirect_tco2e_ha, r.n2o_nfix_tco2e_ha,
     r.co2_fuel_tco2e_ha, r.n2o_burn_tco2e_ha, r.total_tco2e_ha, r.total_tco2e)
  RETURNING * INTO r;

  RETURN r;
END;
$$ LANGUAGE plpgsql;
