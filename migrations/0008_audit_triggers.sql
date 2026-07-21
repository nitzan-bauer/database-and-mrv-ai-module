-- =====================================================================
-- 0008 · Automatic audit logging
--
-- Stage 2's acceptance criterion is that every action is recorded with
-- who, what and when. Until now audit_log existed but nothing wrote to
-- it, which meant the guarantee rested on every future caller
-- remembering to log — and the one that forgets is the one the VVB asks
-- about.
--
-- So the database logs for itself. Triggers on the mutable core tables
-- capture INSERT / UPDATE / DELETE regardless of who made the change or
-- through which client. An application that bypasses the API, a manual
-- psql fix at 2am, a migration — all land in audit_log.
--
-- Actor resolution: app.user_id if the connection set it, otherwise the
-- database role. A row attributed to 'mrv_admin' is a direct database
-- change rather than an application action, which is exactly the
-- distinction an auditor wants to see.
-- =====================================================================

-- migrate:up

-- Geometry and embedding columns are stripped from the payload. A
-- polygon serialises to a large WKB hex string that would bloat the log
-- without being readable; what matters for audit is that the geometry
-- changed and when, and the row itself still holds the current value.
CREATE OR REPLACE FUNCTION mrv.audit_payload(rec jsonb) RETURNS jsonb AS $$
  SELECT rec
       - 'geom' - 'planned_geom' - 'captured_geom' - 'embedding'
       || CASE
            WHEN rec ? 'geom'          THEN jsonb_build_object('geom', '<geometry>')
            ELSE '{}'::jsonb
          END
       || CASE
            WHEN rec ? 'planned_geom'  THEN jsonb_build_object('planned_geom', '<geometry>')
            ELSE '{}'::jsonb
          END
       || CASE
            WHEN rec ? 'captured_geom' THEN jsonb_build_object('captured_geom', '<geometry>')
            ELSE '{}'::jsonb
          END
       || CASE
            WHEN rec ? 'embedding'     THEN jsonb_build_object('embedding', '<vector>')
            ELSE '{}'::jsonb
          END;
$$ LANGUAGE sql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION mrv.log_change() RETURNS trigger AS $$
DECLARE
  v_actor     text;
  v_target_id text;
  v_payload   jsonb;
  v_pk        text := TG_ARGV[0];   -- primary-key column name
BEGIN
  v_actor := coalesce(
    nullif(current_setting('app.user_id', true), ''),
    session_user
  );

  IF TG_OP = 'DELETE' THEN
    v_target_id := to_jsonb(OLD) ->> v_pk;
    v_payload   := jsonb_build_object('old', mrv.audit_payload(to_jsonb(OLD)));
  ELSIF TG_OP = 'UPDATE' THEN
    v_target_id := to_jsonb(NEW) ->> v_pk;
    -- Both sides: a diff alone loses the context of what the row was.
    v_payload   := jsonb_build_object(
                     'old', mrv.audit_payload(to_jsonb(OLD)),
                     'new', mrv.audit_payload(to_jsonb(NEW))
                   );
  ELSE
    v_target_id := to_jsonb(NEW) ->> v_pk;
    v_payload   := jsonb_build_object('new', mrv.audit_payload(to_jsonb(NEW)));
  END IF;

  INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
  VALUES (v_actor, lower(TG_OP), TG_TABLE_NAME, v_target_id, v_payload);

  RETURN NULL;   -- AFTER trigger; return value is ignored
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mrv.log_change() IS
  'Generic audit trigger. Pass the primary-key column name as the trigger argument.';

-- ---------------------------------------------------------------------
-- Attach to the core mutable tables.
--
-- Not attached to: audit_log (would recurse), and the append-only
-- evidentiary tables, which are already immutable by construction — an
-- INSERT there is the record. Reference tables (fertilizers,
-- machinery_defaults) are excluded as static lookup data; ghg_parameters
-- IS audited because a changed emission factor changes reported numbers.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_audit_orgs        AFTER INSERT OR UPDATE OR DELETE ON mrv.organizations
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('org_id');

CREATE TRIGGER trg_audit_projects    AFTER INSERT OR UPDATE OR DELETE ON mrv.projects
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('project_id');

CREATE TRIGGER trg_audit_farms       AFTER INSERT OR UPDATE OR DELETE ON mrv.farms
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('farm_id');

CREATE TRIGGER trg_audit_plots       AFTER INSERT OR UPDATE OR DELETE ON mrv.plots
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('plot_id');

CREATE TRIGGER trg_audit_strata      AFTER INSERT OR UPDATE OR DELETE ON mrv.strata
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('stratum_id');

CREATE TRIGGER trg_audit_bsl         AFTER INSERT OR UPDATE OR DELETE ON mrv.baseline_control_sites
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('bsl_id');

CREATE TRIGGER trg_audit_points      AFTER INSERT OR UPDATE OR DELETE ON mrv.sampling_points
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('point_id');

CREATE TRIGGER trg_audit_users       AFTER INSERT OR UPDATE OR DELETE ON mrv.users
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('user_id');

CREATE TRIGGER trg_audit_memberships AFTER INSERT OR UPDATE OR DELETE ON mrv.project_memberships
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('membership_id');

CREATE TRIGGER trg_audit_agent_pol   AFTER INSERT OR UPDATE OR DELETE ON mrv.agent_action_policies
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('policy_id');

CREATE TRIGGER trg_audit_agent_mem   AFTER INSERT OR UPDATE OR DELETE ON mrv.agent_memory
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('memory_id');

-- INSERT only: ghg_parameters is append-only, so this records each new
-- emission-factor version as it is introduced.
CREATE TRIGGER trg_audit_ghg_params  AFTER INSERT ON mrv.ghg_parameters
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('parameter_set_id');

-- migrate:down

DROP TRIGGER IF EXISTS trg_audit_ghg_params  ON mrv.ghg_parameters;
DROP TRIGGER IF EXISTS trg_audit_agent_mem   ON mrv.agent_memory;
DROP TRIGGER IF EXISTS trg_audit_agent_pol   ON mrv.agent_action_policies;
DROP TRIGGER IF EXISTS trg_audit_memberships ON mrv.project_memberships;
DROP TRIGGER IF EXISTS trg_audit_users       ON mrv.users;
DROP TRIGGER IF EXISTS trg_audit_points      ON mrv.sampling_points;
DROP TRIGGER IF EXISTS trg_audit_bsl         ON mrv.baseline_control_sites;
DROP TRIGGER IF EXISTS trg_audit_strata      ON mrv.strata;
DROP TRIGGER IF EXISTS trg_audit_plots       ON mrv.plots;
DROP TRIGGER IF EXISTS trg_audit_farms       ON mrv.farms;
DROP TRIGGER IF EXISTS trg_audit_projects    ON mrv.projects;
DROP TRIGGER IF EXISTS trg_audit_orgs        ON mrv.organizations;

DROP FUNCTION IF EXISTS mrv.log_change();
DROP FUNCTION IF EXISTS mrv.audit_payload(jsonb);
