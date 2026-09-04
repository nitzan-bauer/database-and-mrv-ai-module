-- migrate:up
-- =====================================================================
-- 0094 — Three tables 0093 missed: farm_participation_terms.farm_id,
-- actual_allocations.farm_id, negative_balance_flags.project_id. Same
-- financing-domain pattern as 0093 (real SaaS uuid stored as untyped
-- text) — found live when john_allocation_report failed with "operator
-- does not exist: text = uuid" joining allocation_register (now uuid)
-- against farm_participation_terms (still text).
--
-- negative_balance_flags.scope_id is deliberately left as text: it's
-- polymorphic (a farm id or a project id depending on scope_type), so no
-- single foreign key applies.
-- =====================================================================

ALTER TABLE mrv.farm_participation_terms
  ALTER COLUMN farm_id TYPE uuid USING farm_id::uuid,
  ADD CONSTRAINT farm_participation_terms_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms (id);

ALTER TABLE mrv.actual_allocations
  ALTER COLUMN farm_id TYPE uuid USING farm_id::uuid,
  ADD CONSTRAINT actual_allocations_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms (id);

ALTER TABLE mrv.negative_balance_flags
  ALTER COLUMN project_id TYPE uuid USING project_id::uuid,
  ADD CONSTRAINT negative_balance_flags_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects (id);

-- migrate:down
ALTER TABLE mrv.negative_balance_flags DROP CONSTRAINT IF EXISTS negative_balance_flags_project_id_fkey, ALTER COLUMN project_id TYPE text;
ALTER TABLE mrv.actual_allocations DROP CONSTRAINT IF EXISTS actual_allocations_farm_id_fkey, ALTER COLUMN farm_id TYPE text;
ALTER TABLE mrv.farm_participation_terms DROP CONSTRAINT IF EXISTS farm_participation_terms_farm_id_fkey, ALTER COLUMN farm_id TYPE text;
