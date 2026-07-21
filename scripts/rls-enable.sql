-- =====================================================================
-- Switch row-level security ON.
--
-- The policies already exist (migration 0006); this activates them.
--
-- READ THIS BEFORE RUNNING IN PRODUCTION
--
-- A table's OWNER bypasses RLS unless FORCE is also set. If the
-- application connects as the same role that owns these tables — which
-- is what happens if you point the app at the RDS master user — the
-- policies will be active and yet do nothing at all, which is the worst
-- of both worlds because it looks secure.
--
-- The correct setup is a separate, non-owner application role:
--
--   CREATE ROLE mrv_app LOGIN PASSWORD '...';
--   GRANT USAGE ON SCHEMA mrv TO mrv_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mrv TO mrv_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA mrv
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mrv_app;
--
-- and then, on every connection, before any query:
--
--   SET app.user_id = '<the authenticated user uuid>';
--
-- Background jobs and migrations should keep using the owner role, which
-- bypasses RLS by design.
-- =====================================================================

ALTER TABLE mrv.projects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.farms                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.plots                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.strata                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.baseline_control_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.sampling_points        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.agent_memory           ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.project_memberships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.fertilizers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.machinery_defaults     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrv.ghg_parameters         ENABLE ROW LEVEL SECURITY;
