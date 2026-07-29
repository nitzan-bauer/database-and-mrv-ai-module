-- =====================================================================
-- 0019 · Complete the VM0042 hard-check set
--
-- Functional Specification v2.0 §7 lists eight hard checks. The engine
-- built in 0014 (and amended in 0018) evaluates four:
--
--     STRATIFIED_RANDOM      §8.2.1.2
--     MIN_5_COMPOSITES       §8.2.1.2
--     ESM_TWO_INCREMENTS     §8.2.1.6
--     QA2_3_CONTROL_SITES    §8.3      (QA2 only)
--
-- Three of the remaining four are marked "enforced" in the spec but were
-- never implemented, so a cycle could score 100 while breaking them:
--
--     SAME_SEASON_WINDOW     §8.2.1.1
--     LAB_ACCREDITED         §8.2.1.4
--     DRY_COMBUSTION         §8.2.1.4
--
-- The eighth (QA1 model validated per VMD0053 with an IME-signed MVR,
-- §8.6.1.3) stays out: the spec schedules it P3, and it is reported by
-- the module as planned rather than silently passing.
--
-- §8.2.1.4 prefers dry combustion "unless a deviation is documented", so
-- the rule needs somewhere to hold that documentation. Adding a nullable
-- note column does not violate the append-only guarantee on the table.
-- =====================================================================

-- migrate:up

ALTER TABLE mrv.soc_measurements
  ADD COLUMN IF NOT EXISTS method_deviation_note text;

COMMENT ON COLUMN mrv.soc_measurements.method_deviation_note IS
  'Why an analysis method other than dry combustion was used (VM0042 §8.2.1.4). A non-dry-combustion measurement passes the DRY_COMBUSTION hard check only when this is present.';

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
  v_same_season     boolean;
  v_out_of_window   int;
  v_bad_lab         int;
  v_bad_method      int;
  v_n_measurements  int;
  v_hard_total      int := 0;
  v_hard_passed     int := 0;
  v_warnings        int := 0;
  v_score           smallint;
  c_min_composites  constant int := 5;   -- spec v2.0 (was 3)
BEGIN
  SELECT approach, same_season INTO v_approach, v_same_season
    FROM mrv.sampling_cycles WHERE cycle_id = p_cycle_id;

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
  -- Grouped by sampling EVENT, not by sample. 0-15 and 15-30 cm are
  -- physically different soil — separate bags, separate barcodes, separate
  -- sample_ids, as mrv.samples' UNIQUE (event_id, sample_type, depth_top_cm,
  -- depth_base_cm) allows for. Grouping by sample_id (as 0014 did) asked
  -- each individual sample to span two depths, which it never can, so the
  -- check could not pass however correctly the field work was done.
  SELECT bool_and(has2) INTO v_esm_ok FROM (
    SELECT ev.event_id, count(DISTINCT sm.depth_top_cm) >= 2 AS has2
    FROM mrv.soc_measurements sm
    JOIN mrv.samples sa ON sa.sample_id = sm.sample_id
    JOIN mrv.sampling_events ev ON ev.event_id = sa.event_id
    WHERE ev.cycle_id = p_cycle_id AND sa.farm_id = p_farm_id
      AND sa.sample_type = 'soc'
    GROUP BY ev.event_id
  ) q;
  v_esm_ok := coalesce(v_esm_ok, false);
  v_hard_total := v_hard_total + 1;
  IF v_esm_ok THEN v_hard_passed := v_hard_passed + 1; END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'ESM_TWO_INCREMENTS', true,
              CASE WHEN v_esm_ok THEN 'pass' ELSE 'fail' END,
              'ESM needs >=2 depth increments per sampling point', '§8.2.1.6');

  -- ---- HARD 4: same-season sampling window (§8.2.1.1) ----------------
  -- Every event in the cycle must fall inside the cycle's planned window.
  -- A cycle that has deliberately dropped the same-season requirement
  -- records that intent on the cycle and is not penalised for it.
  SELECT count(*) INTO v_out_of_window
  FROM mrv.sampling_events ev
  JOIN mrv.sampling_cycles c ON c.cycle_id = ev.cycle_id
  WHERE ev.cycle_id = p_cycle_id
    AND ev.sampling_date IS NOT NULL
    AND c.planned_start IS NOT NULL AND c.planned_end IS NOT NULL
    AND (ev.sampling_date < c.planned_start OR ev.sampling_date > c.planned_end);
  v_hard_total := v_hard_total + 1;
  IF NOT coalesce(v_same_season, true) OR v_out_of_window = 0 THEN
    v_hard_passed := v_hard_passed + 1;
  END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'SAME_SEASON_WINDOW', true,
              CASE WHEN NOT coalesce(v_same_season, true) OR v_out_of_window = 0
                   THEN 'pass' ELSE 'fail' END,
              CASE WHEN NOT coalesce(v_same_season, true)
                   THEN 'same-season not required for this cycle'
                   ELSE v_out_of_window || ' events outside the planned window' END,
              '§8.2.1.1');

  -- ---- HARD 5: laboratory accreditation (§8.2.1.4) -------------------
  -- ISO/IEC 17025, or NAPT / GLOSOLAN membership.
  SELECT count(*), count(*) FILTER (
           WHERE l.lab_id IS NULL
              OR NOT (l.iso_17025 OR l.napt_member OR l.glosolan_member))
    INTO v_n_measurements, v_bad_lab
  FROM mrv.soc_measurements sm
  JOIN mrv.samples sa ON sa.sample_id = sm.sample_id
  JOIN mrv.sampling_events ev ON ev.event_id = sa.event_id
  LEFT JOIN mrv.labs l ON l.lab_id = sm.lab_id
  WHERE ev.cycle_id = p_cycle_id AND sa.farm_id = p_farm_id;
  v_hard_total := v_hard_total + 1;
  IF v_n_measurements > 0 AND v_bad_lab = 0 THEN v_hard_passed := v_hard_passed + 1; END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'LAB_ACCREDITED', true,
              CASE WHEN v_n_measurements > 0 AND v_bad_lab = 0 THEN 'pass' ELSE 'fail' END,
              CASE WHEN v_n_measurements = 0 THEN 'no lab results yet'
                   ELSE v_bad_lab || ' measurements from an unaccredited or unknown laboratory' END,
              '§8.2.1.4');

  -- ---- HARD 6: dry combustion unless documented (§8.2.1.4) -----------
  SELECT count(*) INTO v_bad_method
  FROM mrv.soc_measurements sm
  JOIN mrv.samples sa ON sa.sample_id = sm.sample_id
  JOIN mrv.sampling_events ev ON ev.event_id = sa.event_id
  WHERE ev.cycle_id = p_cycle_id AND sa.farm_id = p_farm_id
    AND sm.method <> 'dry_combustion'
    AND coalesce(btrim(sm.method_deviation_note), '') = '';
  v_hard_total := v_hard_total + 1;
  IF v_n_measurements > 0 AND v_bad_method = 0 THEN v_hard_passed := v_hard_passed + 1; END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'DRY_COMBUSTION', true,
              CASE WHEN v_n_measurements > 0 AND v_bad_method = 0 THEN 'pass' ELSE 'fail' END,
              CASE WHEN v_n_measurements = 0 THEN 'no lab results yet'
                   ELSE v_bad_method || ' measurements on another method with no documented deviation' END,
              '§8.2.1.4');

  -- ---- HARD 7/8: QA2 baseline control sites (§8.3) -------------------
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
  'Evaluates a farm-cycle against the VM0042 v2.2 hard checks and soft warnings; writes compliance_checks + compliance_scores; returns 0-100. Hard failures cap the score below 100. Seven hard checks (six plus QA2 control sites); the QA1 MVR/IME check is scheduled P3.';

-- migrate:down

-- Restore the 0018 function (four hard checks) and drop the note column.
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
  c_min_composites  constant int := 5;
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
          FROM mrv.sampling_points sp WHERE sp.stratum_id = s.stratum_id ) < c_min_composites;
  v_hard_total := v_hard_total + 1;
  IF v_n_strata > 0 AND v_bad_composites = 0 THEN v_hard_passed := v_hard_passed + 1; END IF;
  PERFORM mrv.record_check(p_farm_id, p_cycle_id, 'MIN_5_COMPOSITES', true,
              CASE WHEN v_n_strata > 0 AND v_bad_composites = 0 THEN 'pass' ELSE 'fail' END,
              v_bad_composites || ' strata below ' || c_min_composites || ' points', '§8.2.1.2');

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

ALTER TABLE mrv.soc_measurements DROP COLUMN IF EXISTS method_deviation_note;
