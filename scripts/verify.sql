-- =====================================================================
-- Post-migration verification.
--
-- Every check RAISES on failure. A verification script that prints FAIL
-- and still exits 0 is worse than no script — it turns a red build green.
-- Run under psql -v ON_ERROR_STOP=1.
-- =====================================================================

\echo '--- Tables in mrv schema ---'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'mrv'
ORDER BY table_name;

\echo ''
\echo '--- Checks ---'

-- ---------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  -- 9 core hierarchy + 3 reference + 2 audit
  SELECT count(*) INTO n
  FROM information_schema.tables WHERE table_schema = 'mrv';
  IF n <> 14 THEN
    RAISE EXCEPTION 'FAIL  | expected 14 tables in mrv, found %', n;
  END IF;
  RAISE NOTICE 'PASS  | 14 tables in mrv';

  -- Every geometry column must be SRID 4326. A wrong projection here
  -- silently mis-locates plots by hundreds of kilometres.
  SELECT count(*) INTO n FROM geometry_columns WHERE f_table_schema = 'mrv';
  IF n <> 4 THEN
    RAISE EXCEPTION 'FAIL  | expected 4 geometry columns, found %', n;
  END IF;

  SELECT count(*) INTO n
  FROM geometry_columns WHERE f_table_schema = 'mrv' AND srid <> 4326;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL  | % geometry column(s) are not SRID 4326', n;
  END IF;
  RAISE NOTICE 'PASS  | 4 geometry columns, all SRID 4326';

  SELECT count(*) INTO n
  FROM pg_indexes WHERE schemaname = 'mrv' AND indexdef LIKE '%USING gist%';
  IF n < 4 THEN
    RAISE EXCEPTION 'FAIL  | expected at least 4 GIST indexes, found %', n;
  END IF;
  RAISE NOTICE 'PASS  | % GIST indexes', n;

  -- pgvector must be present before stage 2's agent_memory lands.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'FAIL  | pgvector extension is not installed';
  END IF;
  RAISE NOTICE 'PASS  | postgis and pgvector installed';
END $$;

-- ---------------------------------------------------------------------
-- Seeded reference data
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM mrv.fertilizers;
  IF n <> 18 THEN
    RAISE EXCEPTION 'FAIL  | expected 18 fertilizers, found %', n;
  END IF;

  SELECT count(*) INTO n FROM mrv.machinery_defaults;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL  | expected 3 machinery defaults, found %', n;
  END IF;

  SELECT count(*) INTO n FROM mrv.agent_action_policies;
  IF n <> 6 THEN
    RAISE EXCEPTION 'FAIL  | expected 6 agent policies, found %', n;
  END IF;

  RAISE NOTICE 'PASS  | reference data seeded (18 fertilizers, 3 machinery, 6 policies)';
END $$;

-- ---------------------------------------------------------------------
-- The formulas
-- ---------------------------------------------------------------------
DO $$
DECLARE
  soc numeric;
  ef  numeric;
  fl  numeric;
BEGIN
  -- TOC 1%, BD 1.3, 15 cm -> 19.5 t C/ha. Factor 100, not 1000.
  soc := mrv.soc_stock_t_per_ha(1.0, 1.3, 15);
  IF soc <> 19.5 THEN
    RAISE EXCEPTION 'FAIL  | SOC stock: expected 19.5 t C/ha, got %', soc;
  END IF;
  RAISE NOTICE 'PASS  | SOC stock formula returns 19.5 t C/ha';

  SELECT mrv.ef_n_direct(p.*), mrv.frac_leach(p.*) INTO ef, fl
  FROM mrv.ghg_parameters p
  WHERE p.project_id IS NULL AND p.version = 'default-v1.0';

  -- Wet climate + decreasing project N takes the low end of the range
  -- (VM0042 §8.3 conservativeness).
  IF ef <> 0.013 THEN
    RAISE EXCEPTION 'FAIL  | EF_N_direct wet+decrease: expected 0.013, got %', ef;
  END IF;
  IF fl <> 0.24 THEN
    RAISE EXCEPTION 'FAIL  | Frac_LEACH wet: expected 0.24, got %', fl;
  END IF;
  RAISE NOTICE 'PASS  | derived parameters (EF_N_direct 0.013, Frac_LEACH 0.24)';
END $$;

-- ---------------------------------------------------------------------
-- The guarantees — these are what make the data auditable
-- ---------------------------------------------------------------------
DO $$
DECLARE
  update_blocked boolean := false;
  delete_blocked boolean := false;
BEGIN
  INSERT INTO mrv.audit_log (actor, action) VALUES ('verify', 'append_only_probe');

  BEGIN
    UPDATE mrv.audit_log SET action = 'tampered' WHERE actor = 'verify';
  EXCEPTION WHEN others THEN
    update_blocked := true;
  END;

  BEGIN
    DELETE FROM mrv.audit_log WHERE actor = 'verify';
  EXCEPTION WHEN others THEN
    delete_blocked := true;
  END;

  IF NOT (update_blocked AND delete_blocked) THEN
    RAISE EXCEPTION 'FAIL  | audit_log append-only guard did not fire (update=%, delete=%)',
      update_blocked, delete_blocked;
  END IF;
  RAISE NOTICE 'PASS  | audit_log rejects UPDATE and DELETE';
END $$;

DO $$
DECLARE
  blocked boolean := false;
BEGIN
  BEGIN
    UPDATE mrv.ghg_parameters SET gwp_n2o = 999 WHERE version = 'default-v1.0';
  EXCEPTION WHEN others THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL  | ghg_parameters is editable — the versioning guarantee is broken';
  END IF;
  RAISE NOTICE 'PASS  | ghg_parameters rejects UPDATE';
END $$;

-- A baseline control site beyond 250 km is a methodology violation
-- (VM0042 Table 7), so the database must refuse it outright.
DO $$
DECLARE
  blocked boolean := false;
BEGIN
  INSERT INTO mrv.organizations (org_id, name) VALUES
    ('00000000-0000-0000-0000-0000000000ff', '__verify__');
  INSERT INTO mrv.projects (project_id, org_id, name) VALUES
    ('__VERIFY__', '00000000-0000-0000-0000-0000000000ff', '__verify__');
  INSERT INTO mrv.farms (farm_id, project_id, name) VALUES
    ('00000000-0000-0000-0000-0000000000fe', '__VERIFY__', '__verify__');

  BEGIN
    INSERT INTO mrv.baseline_control_sites (bsl_id, farm_id, geom, distance_km) VALUES
      ('__VERIFY_BSL__', '00000000-0000-0000-0000-0000000000fe',
       ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 300);
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    DELETE FROM mrv.baseline_control_sites WHERE bsl_id = '__VERIFY_BSL__';
    DELETE FROM mrv.farms         WHERE farm_id    = '00000000-0000-0000-0000-0000000000fe';
    DELETE FROM mrv.projects      WHERE project_id = '__VERIFY__';
    DELETE FROM mrv.organizations WHERE org_id     = '00000000-0000-0000-0000-0000000000ff';
    RAISE EXCEPTION 'FAIL  | BSL distance constraint did not fire at 300 km';
  END IF;

  DELETE FROM mrv.farms         WHERE farm_id    = '00000000-0000-0000-0000-0000000000fe';
  DELETE FROM mrv.projects      WHERE project_id = '__VERIFY__';
  DELETE FROM mrv.organizations WHERE org_id     = '00000000-0000-0000-0000-0000000000ff';

  RAISE NOTICE 'PASS  | BSL beyond 250 km rejected';
END $$;

-- Point-in-plot is the spatial query the whole map depends on. Prove the
-- geometry types and GIST index actually answer it. (Stage 1 acceptance
-- test, run here against throwaway geometry.)
DO $$
DECLARE
  hits int;
BEGIN
  INSERT INTO mrv.organizations (org_id, name) VALUES
    ('00000000-0000-0000-0000-0000000000ff', '__verify__');
  INSERT INTO mrv.projects (project_id, org_id, name) VALUES
    ('__VERIFY__', '00000000-0000-0000-0000-0000000000ff', '__verify__');
  INSERT INTO mrv.farms (farm_id, project_id, name) VALUES
    ('00000000-0000-0000-0000-0000000000fe', '__VERIFY__', '__verify__');
  INSERT INTO mrv.plots (plot_id, farm_id, geom, quantification_approach) VALUES
    ('__VERIFY_PLOT__', '00000000-0000-0000-0000-0000000000fe',
     ST_GeomFromText('POLYGON((34.0 -1.0, 34.1 -1.0, 34.1 -0.9, 34.0 -0.9, 34.0 -1.0))', 4326),
     'QA2');
  INSERT INTO mrv.sampling_points (plot_id, scenario, planned_geom) VALUES
    ('__VERIFY_PLOT__', 'WP', ST_SetSRID(ST_MakePoint(34.05, -0.95), 4326)),  -- inside
    ('__VERIFY_PLOT__', 'WP', ST_SetSRID(ST_MakePoint(35.00, -0.95), 4326));  -- outside

  SELECT count(*) INTO hits
  FROM mrv.sampling_points sp
  JOIN mrv.plots p ON ST_Within(sp.planned_geom, p.geom)
  WHERE p.plot_id = '__VERIFY_PLOT__';

  IF hits <> 1 THEN
    RAISE EXCEPTION 'FAIL  | point-in-plot query returned % points, expected 1', hits;
  END IF;
  RAISE NOTICE 'PASS  | point-in-plot spatial query';

  DELETE FROM mrv.sampling_points WHERE plot_id = '__VERIFY_PLOT__';
  DELETE FROM mrv.plots         WHERE plot_id   = '__VERIFY_PLOT__';
  DELETE FROM mrv.farms         WHERE farm_id    = '00000000-0000-0000-0000-0000000000fe';
  DELETE FROM mrv.projects      WHERE project_id = '__VERIFY__';
  DELETE FROM mrv.organizations WHERE org_id     = '00000000-0000-0000-0000-0000000000ff';
END $$;

\echo ''
\echo 'All checks passed.'
