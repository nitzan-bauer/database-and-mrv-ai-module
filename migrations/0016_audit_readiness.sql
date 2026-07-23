-- =====================================================================
-- 0016 · Stage 7 — audit-readiness
--
-- The database half of the final stage. Terraform already carries the
-- infrastructure half (RDS automated backups, S3 lifecycle to Glacier,
-- 10-year retention). What the database owes a VVB is traceability: the
-- ability to follow a credited number back to the physical sample it
-- rests on, and to see at a glance whether that chain is complete.
--
--   v_sample_chain     one row per SOC sample, farm -> plot -> stratum ->
--                      point -> event -> sample -> measurement, with the
--                      lab and import provenance attached
--   v_data_completeness per farm-cycle: is every link present?
--   mrv.audit_trail(target) walks the audit_log for one object
--
-- All read-only. Nothing here changes stored data — stage 7 is about
-- being able to prove what is already there.
-- =====================================================================

-- migrate:up

-- ---------------------------------------------------------------------
-- The evidence chain, one row per SOC measurement. This is the query a
-- VVB effectively runs: given a credited figure, show me the sample, the
-- lab, the file it came in, who captured it and where.
-- ---------------------------------------------------------------------
CREATE VIEW mrv.v_sample_chain AS
SELECT
  f.project_id,
  f.farm_id,
  f.name              AS farm_name,
  f.is_demo,
  p.plot_id,
  st.code             AS stratum_code,
  sp.point_id,
  sp.is_revisit,
  ev.event_id,
  ev.sampling_date,
  ev.captured_geom,
  ev.locked           AS event_locked,
  sa.sample_id,
  sa.sample_type,
  cyc.cycle_number,
  cyc.approach,
  sm.measurement_id,
  sm.depth_top_cm,
  sm.depth_base_cm,
  sm.toc_pct,
  sm.soc_t_per_ha,
  sm.soil_mass_t_ha,
  sm.method           AS lab_method,
  lab.name            AS lab_name,
  lab.iso_17025,
  li.import_id,
  li.workbook_url,
  li.workbook_sha256,
  li.received_at      AS import_received_at
FROM mrv.soc_measurements sm
JOIN mrv.samples sa           ON sa.sample_id = sm.sample_id
JOIN mrv.sampling_events ev   ON ev.event_id = sa.event_id
JOIN mrv.sampling_cycles cyc  ON cyc.cycle_id = ev.cycle_id
JOIN mrv.sampling_points sp   ON sp.point_id = ev.point_id
LEFT JOIN mrv.strata st       ON st.stratum_id = sp.stratum_id
LEFT JOIN mrv.plots p         ON p.plot_id = sp.plot_id
JOIN mrv.farms f              ON f.farm_id = sa.farm_id
LEFT JOIN mrv.labs lab        ON lab.lab_id = sm.lab_id
LEFT JOIN mrv.lab_imports li  ON li.import_id = sm.lab_import_id;

COMMENT ON VIEW mrv.v_sample_chain IS
  'Full evidence chain per SOC measurement: farm -> plot -> stratum -> point -> event -> sample -> measurement, with lab and import provenance. The traceability a VVB reads.';

-- ---------------------------------------------------------------------
-- Data completeness per farm-cycle. Each column answers one "is the link
-- there?" question a verification would ask, so a gap is visible before
-- an auditor finds it rather than after.
-- ---------------------------------------------------------------------
CREATE VIEW mrv.v_data_completeness AS
SELECT
  f.farm_id,
  f.name                                   AS farm_name,
  f.is_demo,
  cyc.cycle_id,
  cyc.cycle_number,
  cyc.approach,
  cyc.status                               AS cycle_status,
  count(DISTINCT sp.point_id)              AS planned_points,
  count(DISTINCT ev.event_id)              AS captured_events,
  count(DISTINCT ev.event_id) FILTER (WHERE ev.locked) AS locked_events,
  count(DISTINCT sa.sample_id)             AS samples,
  count(DISTINCT sm.measurement_id)        AS soc_measurements,
  count(DISTINCT tm.texture_id)            AS texture_measurements,
  -- provenance: every SOC measurement should trace to a stored file
  count(DISTINCT sm.measurement_id) FILTER (WHERE sm.lab_import_id IS NULL)
                                           AS measurements_without_import,
  -- the compliance verdict, if evaluated
  cs.score                                 AS compliance_score
FROM mrv.sampling_cycles cyc
JOIN mrv.farms f                ON f.farm_id = cyc.farm_id
LEFT JOIN mrv.sampling_events ev ON ev.cycle_id = cyc.cycle_id
LEFT JOIN mrv.sampling_points sp ON sp.point_id = ev.point_id
LEFT JOIN mrv.samples sa         ON sa.event_id = ev.event_id
LEFT JOIN mrv.soc_measurements sm     ON sm.sample_id = sa.sample_id
LEFT JOIN mrv.texture_measurements tm ON tm.sample_id = sa.sample_id
LEFT JOIN LATERAL (
  SELECT score FROM mrv.compliance_scores
  WHERE farm_id = f.farm_id AND cycle_id = cyc.cycle_id
  ORDER BY evaluated_at DESC LIMIT 1
) cs ON true
GROUP BY f.farm_id, f.name, f.is_demo, cyc.cycle_id, cyc.cycle_number,
         cyc.approach, cyc.status, cs.score;

COMMENT ON VIEW mrv.v_data_completeness IS
  'Per farm-cycle link check: planned vs captured points, samples, measurements, and any measurement missing its lab-import provenance.';

-- ---------------------------------------------------------------------
-- Walk the audit log for one object. audit_log is polymorphic (no FK),
-- so this is the readable way to ask "everything that happened to plot
-- KIS-WP-01", in order.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mrv.audit_trail(
  p_target_type text,
  p_target_id   text
) RETURNS TABLE (
  ts          timestamptz,
  actor       text,
  action      text,
  payload     jsonb
) AS $$
  SELECT ts, actor, action, payload
  FROM mrv.audit_log
  WHERE target_type = p_target_type AND target_id = p_target_id
  ORDER BY ts;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION mrv.audit_trail(text, text) IS
  'Every audit_log entry for one object, in time order. audit_trail(''plots'',''KIS-WP-01'').';

-- ---------------------------------------------------------------------
-- Retention marker. The 10-year audit trail lives in S3 + Glacier
-- (Terraform), but the database should say so where an operator looks.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.retention_policy (
  policy_key    text PRIMARY KEY,
  description   text NOT NULL,
  retention     text NOT NULL,
  enforced_by   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mrv.retention_policy (policy_key, description, retention, enforced_by) VALUES
  ('audit_log',   'Append-only action log',              'project lifetime + 5 years', 'trigger (db) + S3 mirror (planned)'),
  ('lab_files',   'Raw lab workbooks in the labs bucket', '10 years, Glacier after 2', 'S3 lifecycle (Terraform)'),
  ('rds_backups', 'Automated RDS snapshots',              'dev 1 day / prod 30 days',   'RDS (Terraform); dev capped by Free plan'),
  ('soc_evidence','Sample, SOC, ESM, import rows',        'project lifetime',           'append-only triggers (db)')
ON CONFLICT (policy_key) DO NOTHING;

COMMENT ON TABLE mrv.retention_policy IS
  'Declares where each class of evidence is retained and for how long, and what enforces it. Documentation surfaced in-database, not the enforcement itself.';

-- ---------------------------------------------------------------------
-- Spatial index tuning. The NFR target is a map render under 2 seconds
-- for 500 points; GIS-CAPACITY.md measured 83 ms at 10x that. The
-- existing GIST indexes already deliver it. ANALYZE so the planner has
-- fresh statistics on the spatial tables after the demo seed.
-- ---------------------------------------------------------------------
ANALYZE mrv.plots;
ANALYZE mrv.sampling_points;
ANALYZE mrv.strata;
ANALYZE mrv.baseline_control_sites;

CREATE TRIGGER trg_audit_retention AFTER INSERT OR UPDATE OR DELETE ON mrv.retention_policy FOR EACH ROW EXECUTE FUNCTION mrv.log_change('policy_key');

-- migrate:down

DROP TRIGGER IF EXISTS trg_audit_retention ON mrv.retention_policy;
DROP TABLE IF EXISTS mrv.retention_policy;
DROP FUNCTION IF EXISTS mrv.audit_trail(text, text);
DROP VIEW IF EXISTS mrv.v_data_completeness;
DROP VIEW IF EXISTS mrv.v_sample_chain;
