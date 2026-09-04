-- migrate:up
-- =====================================================================
-- 0093 — Real foreign keys into the SaaS's public schema, now that mrv
-- and public live in the same physical database (Addendum 1: one
-- database for SaaS + MRV + CRM).
--
-- mrv.farms/plots/projects are a second, legitimate domain model for the
-- same real-world things public.farms/plots/projects model (GHG
-- quantification vs. commercial/marketplace) — not a naming accident.
-- This migration links them with real, enforced foreign keys instead of
-- the untyped text columns every table built during the financing work
-- (0085+) used because a cross-database FK was physically impossible.
--
-- Real data confirmed live before writing this (never assumed):
--   - mrv.farms.farm_id ALREADY equals public.farms.id for all 4 existing
--     rows (whoever seeded them reused the real SaaS uuid) — no new
--     column needed, just the constraint.
--   - mrv.projects.project_id / mrv.plots.plot_id are human-readable
--     codes ('CARBO-3988', 'ELD-WP-01'), not uuids — these get a new
--     bridge column, backfilled by hand-verified match (7 plots, 2
--     projects — small enough to check every one, not fuzzy-match).
--   - One mrv.plots row (NVT-WP-05, "Nitzan"/sugarcane) and one
--     mrv.projects row (CARBO-3988-DEMO) have NO real counterpart in the
--     SaaS — demo/orphaned by design, so both new columns are nullable,
--     not NOT NULL.
--   - mrv.users' single real row (nitzan@carbonature.io) also has a
--     Supabase Auth account backing the SaaS's admin login — linked here
--     too, per the column this table's own 2026 design comment already
--     called for.
-- =====================================================================

-- mrv.farms: farm_id already IS the real public.farms.id — just enforce it.
ALTER TABLE mrv.farms
  ADD CONSTRAINT farms_saas_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms (id);

-- mrv.projects: human-readable code, needs a real bridge column.
ALTER TABLE mrv.projects
  ADD COLUMN IF NOT EXISTS saas_project_id uuid REFERENCES public.projects (id);

UPDATE mrv.projects SET saas_project_id = '1d006d6a-909b-458c-83c3-f3937901301f' WHERE project_id = 'CARBO-3988';
-- CARBO-3988-DEMO stays NULL: demo project, no real SaaS counterpart.

-- mrv.plots: same — human-readable code, needs a real bridge column.
ALTER TABLE mrv.plots
  ADD COLUMN IF NOT EXISTS saas_plot_id uuid REFERENCES public.plots (id);

UPDATE mrv.plots SET saas_plot_id = (CASE plot_id
  WHEN 'NVT-WP-01' THEN '83c2942c-eab6-4ac1-afea-cd5df8150485' -- Imri, cucumber
  WHEN 'NVT-WP-02' THEN '6465ecd8-7a6b-4faf-97fd-93876c9f0273' -- Shira, Tomatoes
  WHEN 'NVT-WP-03' THEN 'a3a5cb5e-6bee-4b84-a520-f958febe2473' -- Naomi Miriam, Wheat
  WHEN 'NVT-WP-04' THEN 'd16c0bda-d732-48b7-a9fa-62782ab6992f' -- Maize 1, Maize
  WHEN 'ELD-WP-01' THEN '46a076e9-3bbc-4de5-8632-33541463890c' -- tomatoes
  WHEN 'ELD-WP-02' THEN 'd6a50233-3c9a-4490-96a4-a2f3ab2a3b1b' -- 2 matoes
  ELSE NULL -- NVT-WP-05 ("Nitzan", sugarcane): no matching public.plots row exists
END)::uuid;

-- mrv.users: the column this table's own original design comment (0003) called for.
ALTER TABLE mrv.users
  ADD COLUMN IF NOT EXISTS supabase_user_id uuid REFERENCES auth.users (id);

UPDATE mrv.users SET supabase_user_id = '89dad8e7-6835-4d75-9776-6a0044d568b7' WHERE email = 'nitzan@carbonature.io';

-- The financing/allocation tables (0085+) already store the real SaaS
-- uuid in these columns as untyped text — converting the type and adding
-- the FK is a straight cast, no bridge column or backfill needed.
ALTER TABLE mrv.credit_yield_estimates
  ALTER COLUMN farm_id TYPE uuid USING farm_id::uuid,
  ALTER COLUMN plot_id TYPE uuid USING plot_id::uuid,
  ALTER COLUMN project_id TYPE uuid USING project_id::uuid,
  ADD CONSTRAINT credit_yield_estimates_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms (id),
  ADD CONSTRAINT credit_yield_estimates_plot_id_fkey FOREIGN KEY (plot_id) REFERENCES public.plots (id),
  ADD CONSTRAINT credit_yield_estimates_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects (id);

ALTER TABLE mrv.allocation_register
  ALTER COLUMN farm_id TYPE uuid USING farm_id::uuid,
  ALTER COLUMN plot_id TYPE uuid USING plot_id::uuid,
  ALTER COLUMN project_id TYPE uuid USING project_id::uuid,
  ADD CONSTRAINT allocation_register_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms (id),
  ADD CONSTRAINT allocation_register_plot_id_fkey FOREIGN KEY (plot_id) REFERENCES public.plots (id),
  ADD CONSTRAINT allocation_register_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects (id);

ALTER TABLE mrv.farm_plot_type_overrides
  ALTER COLUMN farm_id TYPE uuid USING farm_id::uuid,
  ADD CONSTRAINT farm_plot_type_overrides_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms (id);

ALTER TABLE mrv.project_plot_type_defaults
  ALTER COLUMN project_id TYPE uuid USING project_id::uuid,
  ADD CONSTRAINT project_plot_type_defaults_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects (id);

COMMENT ON COLUMN mrv.projects.saas_project_id IS 'The same real project in public.projects — NULL only for demo-data rows with no live SaaS counterpart.';
COMMENT ON COLUMN mrv.plots.saas_plot_id IS 'The same real plot in public.plots — NULL only when no matching SaaS plot exists (verified by hand at migration time, not fuzzy-matched).';
COMMENT ON COLUMN mrv.users.supabase_user_id IS 'This person''s Supabase Auth account, if they also have SaaS admin access — NULL for agent/sampler identities with no SaaS login.';

-- migrate:down
ALTER TABLE mrv.project_plot_type_defaults DROP CONSTRAINT IF EXISTS project_plot_type_defaults_project_id_fkey, ALTER COLUMN project_id TYPE text;
ALTER TABLE mrv.farm_plot_type_overrides DROP CONSTRAINT IF EXISTS farm_plot_type_overrides_farm_id_fkey, ALTER COLUMN farm_id TYPE text;
ALTER TABLE mrv.allocation_register
  DROP CONSTRAINT IF EXISTS allocation_register_farm_id_fkey,
  DROP CONSTRAINT IF EXISTS allocation_register_plot_id_fkey,
  DROP CONSTRAINT IF EXISTS allocation_register_project_id_fkey,
  ALTER COLUMN farm_id TYPE text, ALTER COLUMN plot_id TYPE text, ALTER COLUMN project_id TYPE text;
ALTER TABLE mrv.credit_yield_estimates
  DROP CONSTRAINT IF EXISTS credit_yield_estimates_farm_id_fkey,
  DROP CONSTRAINT IF EXISTS credit_yield_estimates_plot_id_fkey,
  DROP CONSTRAINT IF EXISTS credit_yield_estimates_project_id_fkey,
  ALTER COLUMN farm_id TYPE text, ALTER COLUMN plot_id TYPE text, ALTER COLUMN project_id TYPE text;
ALTER TABLE mrv.users DROP COLUMN IF EXISTS supabase_user_id;
ALTER TABLE mrv.plots DROP COLUMN IF EXISTS saas_plot_id;
ALTER TABLE mrv.projects DROP COLUMN IF EXISTS saas_project_id;
ALTER TABLE mrv.farms DROP CONSTRAINT IF EXISTS farms_saas_farm_id_fkey;
