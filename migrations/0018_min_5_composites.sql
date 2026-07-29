-- =====================================================================
-- 0018 · Minimum composites per stratum: 3 -> 5
--
-- VM0042 §8.2.1.2 sets a floor, not a target. Functional Specification
-- v2.0 raises CarboNature's own floor from 3 to 5 composite samples per
-- stratum, and requires the generator and the compliance engine to
-- enforce the same number — so the planning screen cannot propose a
-- cycle the auditor's own engine would then fail.
--
-- Only the composites hard check changes. The rule code changes with it
-- (MIN_3_COMPOSITES -> MIN_5_COMPOSITES) so historical rows stay
-- readable as what they actually asserted at the time; the check count
-- and scoring are untouched.
-- =====================================================================

-- migrate:up

CREATE OR REPLACE FUNCTION mrv.evaluate_compliance(
  p_farm_id  uuid,
  p_cycle_id uuid
) RETURNS smallint AS $$
DECLARE
  v_approach        mrv.quant_approach;
  v_n_strata        int;
  v_bad_composites  int;
  v_stratified      boolean;
  v_bsl_count       int;
  v_bsl_far         int;
  v_high_cv         int;
  v_esm_ok          boolean;
  v_hard_total      int := 0;
  v_hard_passed     int := 0;
  v_warnings        int := 0;
  v_score           smallint;
  c_min_composites  constant int := 5;   -- spec v2.0 (was 3)
BEGIN
  SELECT approach INTO v_approach FROM mrv.sampling_cycles WHERE cycle_id = p_cycle_id;

  -- Clear prior checks for this exact farm-cycle so a re-run is clean.
  DELETE FROM mrv.compliance_checks WHERE farm_id = p_farm_id AND cycle_id = p_cycle_id;

  -- ---- HARD 1: stratified random sampling employed (§8.2.1.2) --------
  SELECT count(*) INTO v_n_strata
  FROM mrv.strata s JOIN mrv.plots pl ON pl.plot_id = s.plot_id
  WHERE pl.farm_id = p_farm_id;
  v_stratified := v_n_strata > 0;
  v_hard_total := v_hard_total + 1;
  IF v_stratified THEN v_hard_passed := v_hard_passed + 1; END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'STRATIFIED_RANDOM', true,
              CASE WHEN v_stratified THEN 'pass' ELSE 'fail' END,
              v_n_strata || ' strata defined', '§8.2.1.2');

  -- ---- HARD 2: >= 5 composite samples per stratum (§8.2.1.2) ---------
  SELECT count(*) INTO v_bad_composites
  FROM mrv.strata s
  JOIN mrv.plots pl ON pl.plot_id = s.plot_id
  WHERE pl.farm_id = p_farm_id
    AND ( SELECT count(DISTINCT sp.point_id)
          FROM mrv.sampling_points sp WHERE sp.stratum_id = s.stratum_id ) < c_min_composites;
  v_hard_total := v_hard_total + 1;
  IF v_n_strata > 0 AND v_bad_composites = 0 THEN v_hard_passed := v_hard_passed + 1; END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'MIN_5_COMPOSITES', true,
              CASE WHEN v_n_strata > 0 AND v_bad_composites = 0 THEN 'pass' ELSE 'fail' END,
              v_bad_composites || ' strata below ' || c_min_composites || ' points', '§8.2.1.2');

  -- ---- HARD 3: ESM basis available (2 depth increments) (§8.2.1.6) ---
  SELECT bool_and(has2) INTO v_esm_ok FROM (
    SELECT sm.sample_id, count(DISTINCT sm.depth_top_cm) >= 2 AS has2
    FROM mrv.soc_measurements sm
    JOIN mrv.samples sa ON sa.sample_id = sm.sample_id
    JOIN mrv.sampling_events ev ON ev.event_id = sa.event_id
    WHERE ev.cycle_id = p_cycle_id AND sa.farm_id = p_farm_id
    GROUP BY sm.sample_id
  ) q;
  v_esm_ok := coalesce(v_esm_ok, false);
  v_hard_total := v_hard_total + 1;
  IF v_esm_ok THEN v_hard_passed := v_hard_passed + 1; END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'ESM_TWO_INCREMENTS', true,
              CASE WHEN v_esm_ok THEN 'pass' ELSE 'fail' END,
              'ESM needs >=2 depth increments per sample', '§8.2.1.6');

  -- ---- HARD 4/5: QA2 baseline control sites (§8.3) ------------------
  IF v_approach = 'QA2' THEN
    SELECT count(*), count(*) FILTER (WHERE distance_km > 250)
      INTO v_bsl_count, v_bsl_far
      FROM mrv.baseline_control_sites WHERE farm_id = p_farm_id;
    v_hard_total := v_hard_total + 1;
    IF v_bsl_count >= 3 AND v_bsl_far = 0 THEN v_hard_passed := v_hard_passed + 1; END IF;
    PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'QA2_3_CONTROL_SITES', true,
                CASE WHEN v_bsl_count >= 3 AND v_bsl_far = 0 THEN 'pass' ELSE 'fail' END,
                v_bsl_count || ' control sites', '§8.3');
  END IF;

  -- ---- SOFT: per-stratum CV > 30% (§8.2.1.3) ------------------------
  SELECT count(*) INTO v_high_cv
  FROM mrv.stratum_statistics st
  JOIN mrv.strata s  ON s.stratum_id = st.stratum_id
  JOIN mrv.plots pl  ON pl.plot_id = s.plot_id
  WHERE pl.farm_id = p_farm_id AND st.cycle_id = p_cycle_id AND st.cv > 0.30;
  IF v_high_cv > 0 THEN
    v_warnings := v_warnings + 1;
    PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'HIGH_CV', false, 'warn',
                v_high_cv || ' strata with CV > 30% — consider +1 sample next cycle', '§8.2.1.3');
  END IF;

  -- ---- score --------------------------------------------------------
  IF v_hard_passed = v_hard_total THEN
    v_score := greatest(0, 100 - 5 * v_warnings);
  ELSE
    v_score := greatest(0, (v_hard_passed * 100 / v_hard_total) - 5 * v_warnings);
  END IF;

  INSERT INTO mrv.compliance_scores
    (farm_id, cycle_id, score, hard_passed, hard_total, warnings)
  VALUES (p_farm_id, p_cycle_id, v_score, v_hard_passed, v_hard_total, v_warnings);

  RETURN v_score;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mrv.evaluate_compliance(uuid, uuid) IS
  'Evaluates a farm-cycle against VM0042 v2.2 hard checks and soft warnings; writes compliance_checks + compliance_scores; returns 0-100. Hard failures cap the score below 100. Composites floor is 5 per stratum (spec v2.0).';

-- migrate:down

CREATE OR REPLACE FUNCTION mrv.evaluate_compliance(
  p_farm_id  uuid,
  p_cycle_id uuid
) RETURNS smallint AS $$
DECLARE
  v_approach        mrv.quant_approach;
  v_n_strata        int;
  v_bad_composites  int;
  v_stratified      boolean;
  v_bsl_count       int;
  v_bsl_far         int;
  v_high_cv         int;
  v_esm_ok          boolean;
  v_hard_total      int := 0;
  v_hard_passed     int := 0;
  v_warnings        int := 0;
  v_score           smallint;
BEGIN
  SELECT approach INTO v_approach FROM mrv.sampling_cycles WHERE cycle_id = p_cycle_id;

  DELETE FROM mrv.compliance_checks WHERE farm_id = p_farm_id AND cycle_id = p_cycle_id;

  SELECT count(*) INTO v_n_strata
  FROM mrv.strata s JOIN mrv.plots pl ON pl.plot_id = s.plot_id
  WHERE pl.farm_id = p_farm_id;
  v_stratified := v_n_strata > 0;
  v_hard_total := v_hard_total + 1;
  IF v_stratified THEN v_hard_passed := v_hard_passed + 1; END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'STRATIFIED_RANDOM', true,
              CASE WHEN v_stratified THEN 'pass' ELSE 'fail' END,
              v_n_strata || ' strata defined', '§8.2.1.2');

  SELECT count(*) INTO v_bad_composites
  FROM mrv.strata s
  JOIN mrv.plots pl ON pl.plot_id = s.plot_id
  WHERE pl.farm_id = p_farm_id
    AND ( SELECT count(DISTINCT sp.point_id)
          FROM mrv.sampling_points sp WHERE sp.stratum_id = s.stratum_id ) < 3;
  v_hard_total := v_hard_total + 1;
  IF v_n_strata > 0 AND v_bad_composites = 0 THEN v_hard_passed := v_hard_passed + 1; END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'MIN_3_COMPOSITES', true,
              CASE WHEN v_n_strata > 0 AND v_bad_composites = 0 THEN 'pass' ELSE 'fail' END,
              v_bad_composites || ' strata below 3 points', '§8.2.1.2');

  SELECT bool_and(has2) INTO v_esm_ok FROM (
    SELECT sm.sample_id, count(DISTINCT sm.depth_top_cm) >= 2 AS has2
    FROM mrv.soc_measurements sm
    JOIN mrv.samples sa ON sa.sample_id = sm.sample_id
    JOIN mrv.sampling_events ev ON ev.event_id = sa.event_id
    WHERE ev.cycle_id = p_cycle_id AND sa.farm_id = p_farm_id
    GROUP BY sm.sample_id
  ) q;
  v_esm_ok := coalesce(v_esm_ok, false);
  v_hard_total := v_hard_total + 1;
  IF v_esm_ok THEN v_hard_passed := v_hard_passed + 1; END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'ESM_TWO_INCREMENTS', true,
              CASE WHEN v_esm_ok THEN 'pass' ELSE 'fail' END,
              'ESM needs >=2 depth increments per sample', '§8.2.1.6');

  IF v_approach = 'QA2' THEN
    SELECT count(*), count(*) FILTER (WHERE distance_km > 250)
      INTO v_bsl_count, v_bsl_far
      FROM mrv.baseline_control_sites WHERE farm_id = p_farm_id;
    v_hard_total := v_hard_total + 1;
    IF v_bsl_count >= 3 AND v_bsl_far = 0 THEN v_hard_passed := v_hard_passed + 1; END IF;
    PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'QA2_3_CONTROL_SITES', true,
                CASE WHEN v_bsl_count >= 3 AND v_bsl_far = 0 THEN 'pass' ELSE 'fail' END,
                v_bsl_count || ' control sites', '§8.3');
  END IF;

  SELECT count(*) INTO v_high_cv
  FROM mrv.stratum_statistics st
  JOIN mrv.strata s  ON s.stratum_id = st.stratum_id
  JOIN mrv.plots pl  ON pl.plot_id = s.plot_id
  WHERE pl.farm_id = p_farm_id AND st.cycle_id = p_cycle_id AND st.cv > 0.30;
  IF v_high_cv > 0 THEN
    v_warnings := v_warnings + 1;
    PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'HIGH_CV', false, 'warn',
                v_high_cv || ' strata with CV > 30% — consider +1 sample next cycle', '§8.2.1.3');
  END IF;

  IF v_hard_passed = v_hard_total THEN
    v_score := greatest(0, 100 - 5 * v_warnings);
  ELSE
    v_score := greatest(0, (v_hard_passed * 100 / v_hard_total) - 5 * v_warnings);
  END IF;

  INSERT INTO mrv.compliance_scores
    (farm_id, cycle_id, score, hard_passed, hard_total, warnings)
  VALUES (p_farm_id, p_cycle_id, v_score, v_hard_passed, v_hard_total, v_warnings);

  RETURN v_score;
END;
$$ LANGUAGE plpgsql;
