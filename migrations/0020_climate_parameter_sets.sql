-- migrate:up
-- =====================================================================
-- 0020 — per-climate GHG parameter sets, and honest evaluation times.
--
-- Two unrelated corrections that both had to reach the same deployment.
--
-- (1) One 'wet' parameter set was being applied to every farm, including
--     the dry-climate Israeli ones. The two climate-dependent switches
--     are EF_N_direct (0.013 wet vs 0.005 dry) and Frac_LEACH (0.24 wet
--     vs 0 dry-without-flood-irrigation). Applied to a 40 ha plot cutting
--     synthetic N by 30%, the wet set claims 7.90 tCO2e/yr where the dry
--     set claims 3.01 — a 162% OVER-statement. Over-crediting is the
--     direction a VVB rejects and the direction that puts the ICVCM CCP
--     label at risk, so this is not a rounding concern.
--
--     The schema was already right: ghg_parameters is versioned per
--     project and compute_emissions stores parameter_set_id on the result
--     row, so the evidence chain holds. What was missing is a second set
--     and a rule for choosing between them. Both are added here.
--
-- (2) dry_climate_irrigated is renamed dry_climate_flood_irrigated.
--     Under the IPCC 2019 Refinement, drip irrigation does NOT open the
--     leaching pathway — only flood/furrow does. An Israeli orchard on
--     drip IS irrigated, so the old name invites setting it true, which
--     silently re-applies the wet leaching fraction and inflates the
--     result by ~40%. The name now states the condition it actually
--     tests.
--
-- (3) evaluated_at/computed_at move from now() to clock_timestamp().
--     now() is the transaction start time, so two evaluations in one
--     transaction collide on the UNIQUE keys — which is exactly what the
--     CI assertion hit. These columns record when a measurement was
--     computed; clock_timestamp() is what that means.
-- =====================================================================

-- ---- (2) rename the misleading column -------------------------------
-- frac_leach() depends on it, so it is replaced immediately after.
ALTER TABLE mrv.ghg_parameters
  RENAME COLUMN dry_climate_irrigated TO dry_climate_flood_irrigated;

COMMENT ON COLUMN mrv.ghg_parameters.dry_climate_flood_irrigated IS
  'Dry climate only: true for flood/furrow irrigation, which opens the leaching pathway. Drip and sprinkler are FALSE — IPCC 2019 Refinement treats them as non-leaching. Ignored when climate_zone = wet.';

CREATE OR REPLACE FUNCTION mrv.frac_leach(p mrv.ghg_parameters)
RETURNS numeric AS $$
  SELECT CASE
    WHEN p.climate_zone = 'wet' THEN p.frac_leach_wet
    WHEN p.climate_zone = 'dry' AND p.dry_climate_flood_irrigated THEN p.frac_leach_wet
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE STRICT;

-- ---- (1a) the dry counterpart of the default set ---------------------
-- Same factors as default-v1.0; only the two climate switches differ.
-- n_trend stays 'decrease' so ef_n_direct() is comparable, though for a
-- dry zone ef_n_direct returns the flat dry factor regardless.
INSERT INTO mrv.ghg_parameters (
  project_id, version, effective_from, is_active,
  climate_zone, dry_climate_flood_irrigated, n_trend, soil_n2o_approach,
  source_note
)
SELECT
  NULL, 'dry-v1.0', DATE '2026-01-01', true,
  'dry', false, 'decrease', 'QA3',
  'Dry-climate counterpart of default-v1.0. EF_N_direct takes the dry factor (IPCC 2019 Refinement Table 11.1); Frac_LEACH is zero because the project''s dry-zone farms are drip-irrigated or rain-fed.'
WHERE NOT EXISTS (
  SELECT 1 FROM mrv.ghg_parameters WHERE project_id IS NULL AND version = 'dry-v1.0'
);

-- At most one active global set per climate zone, so resolution below can
-- never be ambiguous. Without this, a second 'wet' fallback added later
-- would make the choice depend on row order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ghg_params_global_active_zone
  ON mrv.ghg_parameters (climate_zone)
  WHERE project_id IS NULL AND is_active;

-- ---- (1b) resolution: farm -> parameter set --------------------------
CREATE OR REPLACE FUNCTION mrv.resolve_parameter_set(
  p_farm_id uuid,
  p_on      date DEFAULT current_date
) RETURNS uuid AS $$
DECLARE
  v_zone    mrv.climate_zone;
  v_project text;
  v_set     uuid;
BEGIN
  SELECT f.climate_zone, f.project_id INTO v_zone, v_project
  FROM mrv.farms f WHERE f.farm_id = p_farm_id;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'resolve_parameter_set: no such farm %', p_farm_id;
  END IF;

  -- A farm with no zone of its own is not silently defaulted: EF_N_direct
  -- differs by a factor of 2.6 between zones, so guessing it would be
  -- guessing the credit volume.
  IF v_zone IS NULL THEN
    RAISE EXCEPTION
      'resolve_parameter_set: farm % has no climate_zone. Set it before computing emissions — wet and dry differ by 2.6x on EF_N_direct.',
      p_farm_id;
  END IF;

  -- Project-specific set wins over the global fallback; among equals the
  -- most recently effective one applies.
  SELECT g.parameter_set_id INTO v_set
  FROM mrv.ghg_parameters g
  WHERE g.is_active
    AND g.climate_zone = v_zone
    AND g.effective_from <= p_on
    AND (g.project_id = v_project OR g.project_id IS NULL)
  ORDER BY (g.project_id IS NOT NULL) DESC, g.effective_from DESC
  LIMIT 1;

  IF v_set IS NULL THEN
    RAISE EXCEPTION
      'resolve_parameter_set: no active % parameter set effective on %', v_zone, p_on;
  END IF;

  RETURN v_set;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION mrv.resolve_parameter_set(uuid, date) IS
  'The parameter set a farm must be costed against, chosen by its climate_zone. Raises rather than defaulting, because the wet/dry choice moves the claimed reduction by more than 2x.';

-- ---- (3) evaluation timestamps ---------------------------------------
-- Column defaults only; evaluate_compliance and the statistics writer
-- both rely on the default, so their bodies need no change.
ALTER TABLE mrv.compliance_scores
  ALTER COLUMN evaluated_at SET DEFAULT clock_timestamp();
ALTER TABLE mrv.compliance_checks
  ALTER COLUMN evaluated_at SET DEFAULT clock_timestamp();
ALTER TABLE mrv.stratum_statistics
  ALTER COLUMN computed_at  SET DEFAULT clock_timestamp();

COMMENT ON COLUMN mrv.compliance_scores.evaluated_at IS
  'When this score was actually computed (clock_timestamp, not transaction start) — so re-evaluating within one transaction produces distinct, truthful rows.';

-- migrate:down
ALTER TABLE mrv.stratum_statistics  ALTER COLUMN computed_at  SET DEFAULT now();
ALTER TABLE mrv.compliance_checks   ALTER COLUMN evaluated_at SET DEFAULT now();
ALTER TABLE mrv.compliance_scores   ALTER COLUMN evaluated_at SET DEFAULT now();

DROP FUNCTION IF EXISTS mrv.resolve_parameter_set(uuid, date);
DROP INDEX IF EXISTS mrv.uq_ghg_params_global_active_zone;
DELETE FROM mrv.ghg_parameters WHERE project_id IS NULL AND version = 'dry-v1.0';

ALTER TABLE mrv.ghg_parameters
  RENAME COLUMN dry_climate_flood_irrigated TO dry_climate_irrigated;

CREATE OR REPLACE FUNCTION mrv.frac_leach(p mrv.ghg_parameters)
RETURNS numeric AS $$
  SELECT CASE
    WHEN p.climate_zone = 'wet' THEN p.frac_leach_wet
    WHEN p.climate_zone = 'dry' AND p.dry_climate_irrigated THEN p.frac_leach_wet
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE STRICT;
