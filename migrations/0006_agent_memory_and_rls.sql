-- =====================================================================
-- 0006 · Agent memory + row-level security scaffold
--
-- Completes stage 2 apart from mcp_tokens, which the work plan lists
-- here but which cannot exist yet: a token is scoped to a work order,
-- and work_orders arrives in stage 3. It lands there instead.
--
-- RLS is written now and left DISABLED. v1 is single-tenant, so turning
-- it on today would buy nothing and could lock the application out on
-- day one. Writing it now means the isolation model is designed while
-- the schema is small, and switching it on later is one ALTER per table
-- rather than a migration that has to reason about live data.
-- =====================================================================

-- migrate:up

-- ---------------------------------------------------------------------
-- Agent memory — long-term, per-project, with embeddings.
--
-- 1536 dims matches text-embedding-3-small and voyage-3. Changing the
-- dimension later requires rewriting the column, so if a different model
-- is chosen, do it before there is anything worth keeping.
--
-- HNSW over IVFFlat: HNSW needs no training step, so it behaves sensibly
-- on an empty table, which is exactly the state this ships in.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.agent_memory (
  memory_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL REFERENCES mrv.projects(project_id) ON DELETE CASCADE,
  farm_id    uuid REFERENCES mrv.farms(farm_id) ON DELETE CASCADE,
  kind       text NOT NULL DEFAULT 'long_term',
  content    text NOT NULL,
  embedding  vector(1536),
  metadata   jsonb,
  created_by text,                                  -- user id or 'ai_agent'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_memory_project ON mrv.agent_memory (project_id);
CREATE INDEX idx_agent_memory_farm    ON mrv.agent_memory (farm_id);
CREATE INDEX idx_agent_memory_vec
  ON mrv.agent_memory USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE mrv.agent_memory IS
  'Long-term agent memory. Short-term session state is not persisted here.';
COMMENT ON COLUMN mrv.agent_memory.embedding IS
  'vector(1536) — text-embedding-3-small / voyage-3. Changing dims means rewriting the column.';

-- =====================================================================
-- Access helpers
--
-- The application sets `app.user_id` per connection. current_setting's
-- second argument returns NULL instead of raising when it is unset, so
-- an unconfigured connection is simply denied rather than erroring.
--
-- All three are STABLE, so the planner evaluates them once per query
-- rather than once per row.
-- =====================================================================

CREATE OR REPLACE FUNCTION mrv.current_user_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION mrv.is_super_admin() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM mrv.project_memberships m
    WHERE m.user_id = mrv.current_user_id()
      AND m.role = 'super_admin'
  );
$$ LANGUAGE sql STABLE;

-- Membership test for a single project.
CREATE OR REPLACE FUNCTION mrv.can_access_project(p_project_id text)
RETURNS boolean AS $$
  SELECT mrv.is_super_admin() OR EXISTS (
    SELECT 1 FROM mrv.project_memberships m
    WHERE m.user_id = mrv.current_user_id()
      AND m.project_id = p_project_id
  );
$$ LANGUAGE sql STABLE;

-- Everything below `farms` reaches project_id only through the farm, so
-- resolving it once here keeps the deep-table policies from writing the
-- same three-table join five times over.
CREATE OR REPLACE FUNCTION mrv.can_access_farm(p_farm_id uuid)
RETURNS boolean AS $$
  SELECT mrv.is_super_admin() OR EXISTS (
    SELECT 1
    FROM mrv.farms f
    JOIN mrv.project_memberships m ON m.project_id = f.project_id
    WHERE f.farm_id = p_farm_id
      AND m.user_id = mrv.current_user_id()
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION mrv.can_access_plot(p_plot_id text)
RETURNS boolean AS $$
  SELECT mrv.is_super_admin() OR EXISTS (
    SELECT 1
    FROM mrv.plots p
    JOIN mrv.farms f ON f.farm_id = p.farm_id
    JOIN mrv.project_memberships m ON m.project_id = f.project_id
    WHERE p.plot_id = p_plot_id
      AND m.user_id = mrv.current_user_id()
  );
$$ LANGUAGE sql STABLE;

-- =====================================================================
-- Policies
--
-- Created but NOT activated: a policy on a table without RLS enabled is
-- inert. Turn the whole thing on with scripts/rls-enable.sql, and off
-- again with scripts/rls-disable.sql.
--
-- Note for whoever enables this: the table owner and any superuser
-- BYPASS RLS by default. The application must connect as a non-owner
-- role, or the policies silently do nothing. See docs/CONVENTIONS.md.
-- =====================================================================

CREATE POLICY projects_by_membership ON mrv.projects
  USING (mrv.can_access_project(project_id));

CREATE POLICY farms_by_membership ON mrv.farms
  USING (mrv.can_access_project(project_id));

CREATE POLICY plots_by_membership ON mrv.plots
  USING (mrv.can_access_farm(farm_id));

CREATE POLICY strata_by_membership ON mrv.strata
  USING (mrv.can_access_plot(plot_id));

CREATE POLICY bsl_by_membership ON mrv.baseline_control_sites
  USING (mrv.can_access_farm(farm_id));

-- A sampling point hangs off a plot OR a BSL site, never both, so the
-- policy has to follow whichever parent is populated.
CREATE POLICY points_by_membership ON mrv.sampling_points
  USING (
    CASE
      WHEN plot_id IS NOT NULL THEN mrv.can_access_plot(plot_id)
      ELSE EXISTS (
        SELECT 1 FROM mrv.baseline_control_sites b
        WHERE b.bsl_id = sampling_points.bsl_id
          AND mrv.can_access_farm(b.farm_id)
      )
    END
  );

CREATE POLICY agent_memory_by_membership ON mrv.agent_memory
  USING (mrv.can_access_project(project_id));

-- A user sees their own memberships; a super admin sees all of them.
CREATE POLICY memberships_own ON mrv.project_memberships
  USING (user_id = mrv.current_user_id() OR mrv.is_super_admin());

-- Reference data is shared across projects and carries no project_id, so
-- it is readable by any authenticated user. Writes go through a service
-- role that bypasses RLS.
CREATE POLICY fertilizers_read ON mrv.fertilizers
  FOR SELECT USING (mrv.current_user_id() IS NOT NULL);

CREATE POLICY machinery_read ON mrv.machinery_defaults
  FOR SELECT USING (mrv.current_user_id() IS NOT NULL);

-- Emission factors may be global (project_id IS NULL) or project-scoped.
CREATE POLICY ghg_params_by_membership ON mrv.ghg_parameters
  USING (project_id IS NULL OR mrv.can_access_project(project_id));

-- migrate:down

DROP POLICY IF EXISTS ghg_params_by_membership   ON mrv.ghg_parameters;
DROP POLICY IF EXISTS machinery_read             ON mrv.machinery_defaults;
DROP POLICY IF EXISTS fertilizers_read           ON mrv.fertilizers;
DROP POLICY IF EXISTS memberships_own            ON mrv.project_memberships;
DROP POLICY IF EXISTS agent_memory_by_membership ON mrv.agent_memory;
DROP POLICY IF EXISTS points_by_membership       ON mrv.sampling_points;
DROP POLICY IF EXISTS bsl_by_membership          ON mrv.baseline_control_sites;
DROP POLICY IF EXISTS strata_by_membership       ON mrv.strata;
DROP POLICY IF EXISTS plots_by_membership        ON mrv.plots;
DROP POLICY IF EXISTS farms_by_membership        ON mrv.farms;
DROP POLICY IF EXISTS projects_by_membership     ON mrv.projects;

DROP FUNCTION IF EXISTS mrv.can_access_plot(text);
DROP FUNCTION IF EXISTS mrv.can_access_farm(uuid);
DROP FUNCTION IF EXISTS mrv.can_access_project(text);
DROP FUNCTION IF EXISTS mrv.is_super_admin();
DROP FUNCTION IF EXISTS mrv.current_user_id();

DROP TABLE IF EXISTS mrv.agent_memory;
