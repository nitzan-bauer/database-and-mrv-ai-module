-- =====================================================================
-- Switch row-level security OFF.
--
-- Policies are left in place — they are inert while RLS is disabled, so
-- this is a clean revert, not a teardown.
-- =====================================================================

ALTER TABLE mrv.ghg_parameters         DISABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.machinery_defaults     DISABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.fertilizers            DISABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.project_memberships    DISABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.agent_memory           DISABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.sampling_points        DISABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.baseline_control_sites DISABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.strata                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.plots                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.farms                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.projects               DISABLE ROW LEVEL SECURITY;
