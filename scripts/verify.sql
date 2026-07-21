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

\echo ''
\echo '--- Append-only guard (expect an exception below) ---'
-- Should raise: "Table audit_log is append-only".
INSERT INTO mrv.audit_log (actor, action) VALUES ('verify', 'test_append_only');
UPDATE mrv.audit_log SET action = 'tampered' WHERE actor = 'verify';
