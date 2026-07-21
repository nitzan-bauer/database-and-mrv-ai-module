-- =====================================================================
-- Seed · Reference data, verbatim from the GHG calculator workbook
-- Idempotent — safe to re-run.
-- =====================================================================

SET search_path = mrv, public;

-- ---- Fertilizer Library (workbook rows 4-21) ------------------------
INSERT INTO mrv.fertilizers (name, n_content, class, density_t_m3, note) VALUES
  ('Urea 46-0-0',                       0.4600, 'synthetic-urea',  NULL, 'Solid urea'),
  ('UAN / Uran 32-0-0',                 0.3200, 'synthetic-urea',  NULL, 'Liquid urea-ammonium-nitrate'),
  ('Ammonium nitrate 34-0-0',           0.3400, 'synthetic-other', NULL, NULL),
  ('Ammonium sulphate 21-0-0',          0.2100, 'synthetic-other', NULL, NULL),
  ('Ammonium nitrate solution 21%',     0.2100, 'synthetic-other', NULL, NULL),
  ('Ammonium nitrate sulphur sol. 12%', 0.1200, 'synthetic-other', NULL, NULL),
  ('N-P-K 8-0-8',                       0.0800, 'synthetic-other', NULL, 'Potassium-rich blend'),
  ('N-P-K 9-0-9',                       0.0900, 'synthetic-other', NULL, NULL),
  ('N-P-K 12-1-6',                      0.1200, 'synthetic-other', NULL, NULL),
  ('N-P-K 15-15-15',                    0.1500, 'synthetic-other', NULL, NULL),
  ('N-P-K 20-20-20',                    0.2000, 'synthetic-other', NULL, NULL),
  ('MAP 11-52-0',                       0.1100, 'synthetic-other', NULL, NULL),
  ('DAP 18-46-0',                       0.1800, 'synthetic-other', NULL, NULL),
  ('Potassium nitrate 13-0-46',         0.1300, 'synthetic-other', NULL, NULL),
  ('Calcium nitrate 15.5-0-0',          0.1550, 'synthetic-other', NULL, NULL),
  ('Compost (generic)',                 0.0150, 'organic',         0.600, 'N ~1-2.5% d.m.; confirm by lab. m³ × density = tonnes.'),
  ('Manure (cattle, solid)',            0.0060, 'organic',         0.800, 'Confirm N by analysis.'),
  ('Manure (poultry)',                  0.0300, 'organic',         0.700, 'Confirm N by analysis.')
ON CONFLICT (name) DO NOTHING;

-- ---- Machinery-Diesel defaults (workbook rows 5-7) ------------------
INSERT INTO mrv.machinery_defaults (equipment, rated_hp, load_factor, sfc_l_per_kwh, hours_per_ha) VALUES
  ('Tractor (heavy, ploughing)', 120, 0.55, 0.27, 6.0),
  ('Tractor (medium, spraying)',  80, 0.45, 0.27, 3.0),
  ('Combine harvester',          250, 0.60, 0.27, 1.5)
ON CONFLICT (equipment) DO NOTHING;

-- ---- Global default parameter set -----------------------------------
-- project_id NULL = the fallback set inherited when a project has none
-- of its own. Values are the workbook defaults (IPCC 2019 + AR5).
INSERT INTO mrv.ghg_parameters (
  project_id, version, effective_from, is_active,
  climate_zone, dry_climate_irrigated, n_trend, soil_n2o_approach,
  source_note
)
SELECT
  NULL, 'default-v1.0', DATE '2026-01-01', true,
  'wet', false, 'decrease', 'QA3',
  'Workbook defaults: GHG_Calculator_VM0042_v2.2_OpenField_v1.xlsx, "Fixed Parameters". IPCC 2019 Refinement + AR5 GWP.'
WHERE NOT EXISTS (
  SELECT 1 FROM mrv.ghg_parameters WHERE project_id IS NULL AND version = 'default-v1.0'
);

-- ---- AI agent action policy defaults (spec §6.9) --------------------
INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('propose_sampling_plan', 'auto',    'Read-only proposal; manager approves.'),
  ('send_work_order',       'confirm', 'Always requires manager click.'),
  ('run_model',             'confirm', 'Avoids accidental compute spend.'),
  ('recalibrate_model',     'confirm', 'Affects all subsequent runs; explicit signoff.'),
  ('issue_alerts',          'auto',    'Read-only; no system changes.'),
  ('chat',                  'auto',    'Read-only by default; write actions gated per action above.')
ON CONFLICT (action_name) DO NOTHING;
