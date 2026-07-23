-- =====================================================================
-- 0014 · Stage 5c — the compliance engine
--
--   stratum_statistics   n, mean, SD, CV, MDD per stratum per cycle
--   compliance_checks    one row per rule evaluated, per farm-cycle
--   compliance_scores    the 0-100 rollup
--
-- The rules are VM0042 v2.2's own §8.2.1 hard checks — NOT VMD0018 /
-- VMD0021, which the research confirmed belong to the older VM0021
-- lineage and are not cited by VM0042 v2.2. VM0042 handles
-- stratification (§8.2.1.2) and ESM (§8.2.1.6) internally.
--
-- stratum_statistics is the variance characterisation the whole
-- sampling-optimisation argument turns on: CV per stratum is what tells
-- the plan generator whether a stratum is homogeneous enough, and the
-- achieved MDD is what the deduction ultimately prices.
-- =====================================================================

-- migrate:up

-- ---------------------------------------------------------------------
-- Stratum statistics — computed from soc_measurements, per stratum per
-- cycle per scenario. Append-only: a recompute is a new row.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.stratum_statistics (
  stat_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stratum_id    uuid NOT NULL REFERENCES mrv.strata(stratum_id) ON DELETE RESTRICT,
  cycle_id      uuid NOT NULL REFERENCES mrv.sampling_cycles(cycle_id) ON DELETE RESTRICT,
  scenario      mrv.sample_scenario NOT NULL,
  n_samples     smallint CHECK (n_samples IS NULL OR n_samples >= 0),
  mean_soc_t_ha numeric(12,4),
  sd_t_ha       numeric(12,4) CHECK (sd_t_ha IS NULL OR sd_t_ha >= 0),
  -- CV as a fraction (0.30 = 30%). The flag VM0042 §8.2.1.3 hangs on.
  cv            numeric(8,4) CHECK (cv IS NULL OR cv >= 0),
  -- Minimum detectable difference achieved at the cycle's alpha/power.
  mdd_achieved_t_ha numeric(12,4),
  computed_by   text,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stratum_id, cycle_id, scenario, computed_at)
);

CREATE INDEX idx_stratstat_cycle ON mrv.stratum_statistics (cycle_id, scenario);

COMMENT ON TABLE mrv.stratum_statistics IS
  'Per-stratum variance from soc_measurements. CV drives the high-CV compliance warning; mean feeds ESM stock change.';

-- ---------------------------------------------------------------------
-- Compliance checks — one row per rule per farm-cycle.
-- rule_code is a stable string the engine and the UI both key on.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.compliance_checks (
  check_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id       uuid NOT NULL REFERENCES mrv.farms(farm_id) ON DELETE CASCADE,
  cycle_id      uuid REFERENCES mrv.sampling_cycles(cycle_id) ON DELETE CASCADE,
  rule_code     text NOT NULL,
  is_hard       boolean NOT NULL,          -- hard check (must pass) vs soft warning
  result        mrv.compliance_result NOT NULL,
  detail        text,
  vm0042_ref    text,
  evaluated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checks_farm_cycle ON mrv.compliance_checks (farm_id, cycle_id);

-- ---------------------------------------------------------------------
-- Compliance scores — the rollup. Append-only.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.compliance_scores (
  score_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id       uuid NOT NULL REFERENCES mrv.farms(farm_id) ON DELETE CASCADE,
  cycle_id      uuid REFERENCES mrv.sampling_cycles(cycle_id) ON DELETE CASCADE,
  score         smallint CHECK (score BETWEEN 0 AND 100),
  hard_passed   smallint,
  hard_total    smallint,
  warnings      smallint,
  evaluated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, cycle_id, evaluated_at)
);

-- ---------------------------------------------------------------------
-- The rule engine. Evaluates a farm-cycle against VM0042's hard checks
-- and soft warnings, writes one compliance_checks row per rule, and a
-- compliance_scores rollup. Returns the score.
--
-- The score is: 100 if every hard check passes, else the fraction of
-- hard checks that passed, scaled to 0-100, minus 5 per warning (floored
-- at 0). Hard failures dominate — a project that fails a hard check is
-- not compliant regardless of warnings, and the dashboard colours red.
-- ---------------------------------------------------------------------
-- Small helper so the engine below stays readable — plpgsql cannot
-- declare a nested procedure, so this lives at schema level.
-- p_result is text and cast inside, so callers can pass a CASE
-- expression without Postgres failing to resolve the enum overload.
CREATE OR REPLACE FUNCTION mrv.record_check(
  p_farm_id uuid, p_cycle_id uuid, p_code text, p_hard boolean,
  p_result text, p_detail text, p_ref text
) RETURNS void AS $$
  INSERT INTO mrv.compliance_checks (farm_id, cycle_id, rule_code, is_hard, result, detail, vm0042_ref)
  VALUES (p_farm_id, p_cycle_id, p_code, p_hard, p_result::mrv.compliance_result, p_detail, p_ref);
$$ LANGUAGE sql;

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

  -- ---- HARD 2: >= 3 composite samples per stratum (§8.2.1.2) ---------
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
  -- Only meaningful for QA2. >=3 sites, and each within 250 km (the
  -- distance ceiling is already enforced at insert, so here we just
  -- confirm presence and count).
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
  'Evaluates a farm-cycle against VM0042 v2.2 hard checks and soft warnings; writes compliance_checks + compliance_scores; returns 0-100. Hard failures cap the score below 100.';

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_stratstat_noupd BEFORE UPDATE OR DELETE ON mrv.stratum_statistics FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();
CREATE TRIGGER trg_scores_noupd    BEFORE UPDATE OR DELETE ON mrv.compliance_scores  FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();

CREATE TRIGGER trg_audit_stratstat AFTER INSERT ON mrv.stratum_statistics FOR EACH ROW EXECUTE FUNCTION mrv.log_change('stat_id');
CREATE TRIGGER trg_audit_scores    AFTER INSERT ON mrv.compliance_scores  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('score_id');

-- migrate:down

DROP TRIGGER IF EXISTS trg_audit_scores    ON mrv.compliance_scores;
DROP TRIGGER IF EXISTS trg_audit_stratstat ON mrv.stratum_statistics;
DROP TRIGGER IF EXISTS trg_scores_noupd    ON mrv.compliance_scores;
DROP TRIGGER IF EXISTS trg_stratstat_noupd ON mrv.stratum_statistics;

DROP FUNCTION IF EXISTS mrv.evaluate_compliance(uuid, uuid);
DROP FUNCTION IF EXISTS mrv.record_check(uuid, uuid, text, boolean, text, text, text);

DROP TABLE IF EXISTS mrv.compliance_scores;
DROP TABLE IF EXISTS mrv.compliance_checks;
DROP TABLE IF EXISTS mrv.stratum_statistics;
