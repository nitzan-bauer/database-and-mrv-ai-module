-- =====================================================================
-- 0015 · Stage 6 — QA1 model structures
--
--   model_runs      one DNDC / DayCent run — config, status, provenance
--   model_results   per-stratum delta-SOC, with the uncertainty terms
--   mvr             the VMD0053 Model Validation Report + IME signoff
--
-- Tables now, DNDC/DayCent integration deferred (the spec's P2/P3). The
-- schema must be able to hold a run's metadata, its results, and the
-- validation record a VVB reads — that is what "ready to receive" means.
--
-- The uncertainty columns are shaped by the regulatory research: the
-- deduction is VM0042 Eq. 74, fed by Var(ERR) which under QA1 comes from
-- either analytical propagation (Eqs. 60-64) or Monte Carlo (Eqs. 65-69).
-- model_results carries the variance components so Eq. 74 can be computed
-- from stored numbers, not recomputed from scratch at report time.
--
-- VMD0053 v2.1 governs validity: the IME is hired by the VVB (not the
-- proponent), and every MVR + IME report is published on the registry.
-- The mvr table records that chain.
-- =====================================================================

-- migrate:up

-- ---------------------------------------------------------------------
-- Model runs. cycle_id is nullable — a baseline-initialisation or a
-- recalibration run is not tied to one sampling cycle.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.model_runs (
  run_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id          uuid NOT NULL REFERENCES mrv.farms(farm_id) ON DELETE CASCADE,
  cycle_id         uuid REFERENCES mrv.sampling_cycles(cycle_id) ON DELETE SET NULL,
  model            mrv.carbon_model NOT NULL,       -- DNDC | DayCent
  model_version    text,
  parameter_set    text,                            -- e.g. 'tropical_drylands_v3'
  run_type         text,                            -- 'baseline_init' | 'true_up' | 'verification' | 'recalibrate'
  scenario         mrv.model_scenario NOT NULL DEFAULT 'paired',
  period_start     date,
  period_end       date,

  -- how the uncertainty was propagated for this run
  uncertainty_method text CHECK (uncertainty_method IS NULL
                        OR uncertainty_method IN ('analytical','monte_carlo')),
  monte_carlo_iters  integer CHECK (monte_carlo_iters IS NULL OR monte_carlo_iters > 0),

  scope            jsonb,                            -- strata / plots in scope
  input_manifest   jsonb,                            -- snapshot of input sources, for reproducibility
  status           mrv.run_status NOT NULL DEFAULT 'configuring',
  log_url          text,                             -- S3 / Supabase Storage
  output_url       text,
  initiated_by     uuid REFERENCES mrv.users(user_id) ON DELETE SET NULL,
  started_at       timestamptz,
  completed_at     timestamptz,
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT model_period_chk
    CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  -- Monte Carlo count only means something for the Monte Carlo method.
  CONSTRAINT model_mc_chk
    CHECK (monte_carlo_iters IS NULL OR uncertainty_method = 'monte_carlo')
);

CREATE INDEX idx_runs_farm  ON mrv.model_runs (farm_id);
CREATE INDEX idx_runs_cycle ON mrv.model_runs (cycle_id);

COMMENT ON COLUMN mrv.model_runs.input_manifest IS
  'Snapshot of every input source and version. VMD0053 reproducibility: same model version, seeds disclosed for stochastic models.';

-- ---------------------------------------------------------------------
-- Model results — per stratum per run. Append-only: a re-run is a new
-- set of rows under a new run_id, so a past report stays reproducible.
--
-- The delta columns are the project vs baseline SOC change; the variance
-- columns carry what Eq. 74 needs. net_t_ha is generated as project
-- minus baseline so it cannot drift from its parts.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.model_results (
  result_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES mrv.model_runs(run_id) ON DELETE CASCADE,
  stratum_id       uuid REFERENCES mrv.strata(stratum_id) ON DELETE SET NULL,

  delta_soc_wp_t_ha  numeric(12,4),                  -- project scenario, t C/ha
  delta_soc_bsl_t_ha numeric(12,4),                  -- baseline scenario, t C/ha
  net_t_ha numeric(12,4) GENERATED ALWAYS AS
             (coalesce(delta_soc_wp_t_ha,0) - coalesce(delta_soc_bsl_t_ha,0)) STORED,

  -- variance of the mean SOC change, and the resulting Eq. 74 deduction.
  var_model        numeric(16,8),                    -- model prediction error variance
  var_sampling     numeric(16,8),                    -- sampling-design variance
  uncertainty_pct  numeric(7,3) CHECK (uncertainty_pct IS NULL OR uncertainty_pct >= 0),  -- Eq. 74 %

  computed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_results_run     ON mrv.model_results (run_id);
CREATE INDEX idx_results_stratum ON mrv.model_results (stratum_id);

COMMENT ON COLUMN mrv.model_results.uncertainty_pct IS
  'VM0042 Eq. 74 deduction, %. A probability-of-exceedance deduction — credited value sits at the 33.3rd percentile.';

-- ---------------------------------------------------------------------
-- MVR — Model Validation Report (VMD0053 v2.1). The IME is contracted by
-- the VVB, not the proponent, and both MVR and IME report are published
-- on the Verra registry — the columns record that.
--
-- The three validation outcomes are stored explicitly because a VVB
-- reads them directly: bias within pooled measurement uncertainty, and
-- 90% prediction intervals covering >=90% of validation observations.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.mvr (
  mvr_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid NOT NULL REFERENCES mrv.model_runs(run_id) ON DELETE CASCADE,
  status            mrv.mvr_status NOT NULL DEFAULT 'draft',

  -- VMD0053 §5.2 validation outcomes
  mean_bias         numeric(12,6),
  pooled_meas_unc   numeric(12,6),                   -- PMU (Eq. 2)
  bias_within_pmu   boolean,                         -- valid where bias <= PMU
  coverage_pct      numeric(6,3) CHECK (coverage_pct IS NULL OR coverage_pct BETWEEN 0 AND 100),
  coverage_pass     boolean,                         -- >= 90%

  -- the VVB-contracted IME
  ime_name          text,
  ime_contracted_by text NOT NULL DEFAULT 'VVB',     -- always the VVB, never the proponent
  document_url      text,                            -- the MVR itself
  ime_report_url    text,                            -- the IME assessment report
  registry_url      text,                            -- public Verra registry link
  signed_at         timestamptz,

  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (run_id)
);

COMMENT ON TABLE mrv.mvr IS
  'VMD0053 v2.1 Model Validation Report. The IME is contracted by the VVB, not the proponent; both MVR and IME report are published on the Verra registry.';
COMMENT ON COLUMN mrv.mvr.ime_contracted_by IS
  'Always the VVB. The single most misunderstood point in VMD0053 — the proponent does not hire the IME.';

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_runs_upd BEFORE UPDATE ON mrv.model_runs FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_mvr_upd  BEFORE UPDATE ON mrv.mvr        FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();

-- model_results is append-only (reproducibility of a reported vintage).
CREATE TRIGGER trg_results_noupd BEFORE UPDATE OR DELETE ON mrv.model_results FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();

CREATE TRIGGER trg_audit_runs    AFTER INSERT OR UPDATE OR DELETE ON mrv.model_runs FOR EACH ROW EXECUTE FUNCTION mrv.log_change('run_id');
CREATE TRIGGER trg_audit_results AFTER INSERT ON mrv.model_results FOR EACH ROW EXECUTE FUNCTION mrv.log_change('result_id');
CREATE TRIGGER trg_audit_mvr     AFTER INSERT OR UPDATE OR DELETE ON mrv.mvr        FOR EACH ROW EXECUTE FUNCTION mrv.log_change('mvr_id');

-- A demo run must sit on a demo farm, mirroring the other interlocks.
CREATE OR REPLACE FUNCTION mrv.check_demo_child_of_farm() RETURNS trigger AS $$
DECLARE
  farm_is_demo boolean;
BEGIN
  SELECT is_demo INTO farm_is_demo FROM mrv.farms WHERE farm_id = NEW.farm_id;
  IF NEW.is_demo <> farm_is_demo THEN
    RAISE EXCEPTION '% is_demo=% but its farm % is is_demo=%',
      TG_TABLE_NAME, NEW.is_demo, NEW.farm_id, farm_is_demo;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_runs_demo_chk BEFORE INSERT OR UPDATE ON mrv.model_runs FOR EACH ROW EXECUTE FUNCTION mrv.check_demo_child_of_farm();

-- migrate:down

DROP TRIGGER IF EXISTS trg_runs_demo_chk ON mrv.model_runs;
DROP FUNCTION IF EXISTS mrv.check_demo_child_of_farm();
DROP TRIGGER IF EXISTS trg_audit_mvr     ON mrv.mvr;
DROP TRIGGER IF EXISTS trg_audit_results ON mrv.model_results;
DROP TRIGGER IF EXISTS trg_audit_runs    ON mrv.model_runs;
DROP TRIGGER IF EXISTS trg_results_noupd ON mrv.model_results;
DROP TRIGGER IF EXISTS trg_mvr_upd  ON mrv.mvr;
DROP TRIGGER IF EXISTS trg_runs_upd ON mrv.model_runs;

DROP TABLE IF EXISTS mrv.mvr;
DROP TABLE IF EXISTS mrv.model_results;
DROP TABLE IF EXISTS mrv.model_runs;
