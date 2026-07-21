-- =====================================================================
-- Post-migration verification. Run after scripts/apply.sh.
-- Every check should report PASS.
-- =====================================================================

\echo '--- Tables in mrv schema ---'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'mrv'
ORDER BY table_name;

\echo ''
\echo '--- Checks ---'

-- Stage A must create exactly these 11 tables.
SELECT CASE WHEN count(*) = 11 THEN 'PASS' ELSE 'FAIL (' || count(*) || ')' END
       AS "Stage A tables = 11"
FROM information_schema.tables WHERE table_schema = 'mrv';

-- PostGIS geometry columns, all SRID 4326.
SELECT CASE WHEN count(*) = 4 AND count(*) FILTER (WHERE srid = 4326) = 4
            THEN 'PASS' ELSE 'FAIL' END AS "4 geometry columns, all SRID 4326"
FROM geometry_columns WHERE f_table_schema = 'mrv';

-- Spatial indexes present.
SELECT CASE WHEN count(*) >= 4 THEN 'PASS' ELSE 'FAIL (' || count(*) || ')' END
       AS "GIST indexes >= 4"
FROM pg_indexes
WHERE schemaname = 'mrv' AND indexdef LIKE '%USING gist%';

-- Reference data seeded.
SELECT CASE WHEN count(*) = 18 THEN 'PASS' ELSE 'FAIL (' || count(*) || ')' END
       AS "Fertilizers = 18" FROM mrv.fertilizers;

SELECT CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL (' || count(*) || ')' END
       AS "Machinery defaults = 3" FROM mrv.machinery_defaults;

SELECT CASE WHEN count(*) = 6 THEN 'PASS' ELSE 'FAIL (' || count(*) || ')' END
       AS "Agent policies = 6" FROM mrv.agent_action_policies;

-- SOC formula: TOC 1%, BD 1.3, 15 cm -> 19.5 t C/ha (factor 100).
SELECT CASE WHEN mrv.soc_stock_t_per_ha(1.0, 1.3, 15) = 19.5
            THEN 'PASS' ELSE 'FAIL (' || mrv.soc_stock_t_per_ha(1.0, 1.3, 15) || ')' END
       AS "SOC stock formula";

-- Derived EF selection: wet + decreasing N -> the low end, 0.013.
SELECT CASE WHEN mrv.ef_n_direct(p.*) = 0.013 THEN 'PASS'
            ELSE 'FAIL (' || mrv.ef_n_direct(p.*) || ')' END
       AS "EF_N_direct wet+decrease = 0.013"
FROM mrv.ghg_parameters p WHERE p.project_id IS NULL AND p.version = 'default-v1.0';

-- Derived leaching fraction: wet -> 0.24.
SELECT CASE WHEN mrv.frac_leach(p.*) = 0.24 THEN 'PASS'
            ELSE 'FAIL (' || mrv.frac_leach(p.*) || ')' END
       AS "Frac_LEACH wet = 0.24"
FROM mrv.ghg_parameters p WHERE p.project_id IS NULL AND p.version = 'default-v1.0';

-- The append-only guard must actually fire. Caught here rather than left
-- to raise, so this script can run under ON_ERROR_STOP in CI.
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

  IF update_blocked AND delete_blocked THEN
    RAISE NOTICE 'PASS  | audit_log rejects UPDATE and DELETE';
  ELSE
    RAISE EXCEPTION 'FAIL  | audit_log append-only guard did not fire (update_blocked=%, delete_blocked=%)',
      update_blocked, delete_blocked;
  END IF;
END $$;

-- Same for the emission-factor table: a changed factor must become a new
-- version, never an edit, or past monitoring periods stop reproducing.
DO $$
DECLARE
  blocked boolean := false;
BEGIN
  BEGIN
    UPDATE mrv.ghg_parameters SET gwp_n2o = 999 WHERE version = 'default-v1.0';
  EXCEPTION WHEN others THEN
    blocked := true;
  END;

  IF blocked THEN
    RAISE NOTICE 'PASS  | ghg_parameters rejects UPDATE';
  ELSE
    RAISE EXCEPTION 'FAIL  | ghg_parameters is editable — versioning guarantee is broken';
  END IF;
END $$;

-- A baseline control site beyond 250 km is a methodology violation
-- (VM0042 Table 7), so the database must refuse it outright.
DO $$
DECLARE
  blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO mrv.organizations (org_id, name) VALUES
      ('00000000-0000-0000-0000-0000000000ff', '__verify__');
    INSERT INTO mrv.projects (project_id, org_id, name) VALUES
      ('__VERIFY__', '00000000-0000-0000-0000-0000000000ff', '__verify__');
    INSERT INTO mrv.farms (farm_id, project_id, name) VALUES
      ('00000000-0000-0000-0000-0000000000fe', '__VERIFY__', '__verify__');
    INSERT INTO mrv.baseline_control_sites (bsl_id, farm_id, geom, distance_km) VALUES
      ('__VERIFY_BSL__', '00000000-0000-0000-0000-0000000000fe',
       ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 300);
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;

  IF blocked THEN
    RAISE NOTICE 'PASS  | BSL beyond 250 km rejected';
  ELSE
    RAISE EXCEPTION 'FAIL  | BSL distance constraint did not fire';
  END IF;

  -- Clean up the probe rows regardless of which path ran.
  DELETE FROM mrv.baseline_control_sites WHERE bsl_id = '__VERIFY_BSL__';
  DELETE FROM mrv.farms    WHERE farm_id    = '00000000-0000-0000-0000-0000000000fe';
  DELETE FROM mrv.projects WHERE project_id = '__VERIFY__';
  DELETE FROM mrv.organizations WHERE org_id = '00000000-0000-0000-0000-0000000000ff';
END $$;

\echo ''
\echo 'Verification complete.'
