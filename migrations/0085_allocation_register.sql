-- migrate:up
-- =====================================================================
-- 0085 — Allocation Register (John): the credit-buyer financing tracks'
-- single source of truth for reporting, reassigned from Ron to John per
-- Nitzan's explicit correction (2026-08-25 — department-head ownership).
-- Approved via the standalone characterization doc + the combined
-- execution plan, both emailed from john@carbonature.io and approved
-- in chat. See docs/... (no doc file yet — the approved artifacts are
-- the two emailed PDFs) and the agent-memory note
-- project_mrv_allocation_register_ownership for the full history.
--
-- Two vectors, always parallel (never merged): credits_tco2e_potential
-- (frozen at deal time, netted against the pre-sampling yield estimate)
-- and credits_tco2e_actual (filled in once real MRV/soil-sampling data
-- exists for that farm — NULL until then, which is expected, not an
-- error, since the credit-buyer campaign launches long before any
-- sampling round).
--
-- Double-counting, zero tolerance (Nitzan's explicit requirement): the
-- partial unique indexes below are the actual DB-level constraint that
-- makes duplicate sync-writes fail at the database, not just rely on
-- application-level upsert logic. The write-time oversell gate itself
-- (a plot's total committed credits must never exceed its potential)
-- lives in the sync task's own logic
-- (scheduledTasks/johnAllocationSync.ts), because "sum of existing rows
-- plus the new one" isn't expressible as a single-row CHECK constraint
-- in Postgres without a trigger — a trigger is the natural follow-up
-- once the sync task's own gate is live and proven, not before.
-- =====================================================================

ALTER TABLE mrv.scheduled_tasks DROP CONSTRAINT scheduled_tasks_frequency_check;
ALTER TABLE mrv.scheduled_tasks ADD CONSTRAINT scheduled_tasks_frequency_check
  CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly'));

CREATE TABLE mrv.allocation_register (
  allocation_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_type                text NOT NULL CHECK (deal_type IN ('agri_inputs', 'project_funding')),
  buyer_id                 text NOT NULL, -- SaaS profiles.id / credit_buyers — a foreign system's id, not a local FK
  buyer_company_name       text NOT NULL,
  project_id               text NOT NULL, -- SaaS projects.id
  project_name             text NOT NULL,
  -- Only populated for agri_inputs — project_funding names no farm at
  -- all, per the contract text itself ("the certificate names no farm").
  farm_id                  text,
  plot_id                  text,
  agri_input               text,
  application_area_ha      numeric,
  credits_tco2e_potential  numeric NOT NULL,
  credits_tco2e_actual     numeric,
  cost_usd                 numeric NOT NULL,
  transaction_no           text,
  source_reservation_id    text, -- agri_inputs
  source_financing_id      text, -- project_funding
  status                   text NOT NULL DEFAULT 'allocated'
                             CHECK (status IN ('allocated', 'pending_delivery', 'delivered', 'released')),
  certificate_status        text NOT NULL DEFAULT 'pending' CHECK (certificate_status IN ('pending', 'clean')),
  verra_serial_range        text, -- filled in once real VCUs are issued — the Verra-side audit trail
  signed_at                 timestamptz,
  paid_at                   timestamptz,
  delivered_at              timestamptz,
  released_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Double-counting guard, part 1: a real DB constraint, not code-level
-- upsert logic alone. NULLs never conflict in Postgres uniqueness, so
-- these are expressed as two partial indexes rather than one composite
-- constraint spanning both nullable id columns.
CREATE UNIQUE INDEX idx_allocation_register_reservation_plot
  ON mrv.allocation_register (source_reservation_id, plot_id)
  WHERE source_reservation_id IS NOT NULL;
CREATE UNIQUE INDEX idx_allocation_register_financing
  ON mrv.allocation_register (source_financing_id)
  WHERE source_financing_id IS NOT NULL;

CREATE INDEX idx_allocation_register_farm ON mrv.allocation_register (farm_id);
CREATE INDEX idx_allocation_register_project ON mrv.allocation_register (project_id);
CREATE INDEX idx_allocation_register_buyer ON mrv.allocation_register (buyer_id);

COMMENT ON TABLE mrv.allocation_register IS
  'John''s single source of truth for reporting on credits allocated to credit buyers, merging both financing tracks. See src/lib/agent/scheduledTasks/johnAllocationSync.ts.';

-- Per-farm participation (Rev-Share) terms — read individually per farm,
-- never a hardcoded global percentage, because future contracts may
-- differ from today's uniform 50/50 (Nitzan's explicit instruction).
CREATE TABLE mrv.farm_participation_terms (
  farm_id           text NOT NULL,
  farmer_share_pct  numeric NOT NULL DEFAULT 0.5 CHECK (farmer_share_pct >= 0 AND farmer_share_pct <= 1),
  effective_date    date NOT NULL DEFAULT CURRENT_DATE,
  contract_ref      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, effective_date)
);

COMMENT ON TABLE mrv.farm_participation_terms IS
  'Per-farm Rev-Share split (default 50% farmer / 50% CarboNature on the net-of-buyer-allocations pool) — a new row per farm whenever a differently-worded participation contract is signed, never edited in place.';

-- Editable credit-yield rate table — admin (super_admin) only, per
-- Nitzan's explicit request. Seeded with the three rates he gave:
-- open field / young orchard (planted within 3 years) / mature orchard.
CREATE TABLE mrv.credit_yield_rate_table (
  plot_type    text PRIMARY KEY CHECK (plot_type IN ('open_field', 'young_orchard', 'mature_orchard')),
  rate_per_ha  numeric NOT NULL,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mrv.credit_yield_rate_table (plot_type, rate_per_ha, updated_by) VALUES
  ('open_field', 5, 'system:migration_0085'),
  ('young_orchard', 9, 'system:migration_0085'),
  ('mature_orchard', 3, 'system:migration_0085');

COMMENT ON TABLE mrv.credit_yield_rate_table IS
  'Admin-editable credit-yield-per-hectare rates, by plot type. Edit only via the super_admin-gated /admin screen (see src/app/(module)/admin/credit-yield-rates/page.tsx) — never hardcode these numbers elsewhere.';

-- Which of the two live SaaS projects defaults to which plot type — the
-- classification Nitzan confirmed comes from project membership, not a
-- new per-plot intake field. A farm-level override column can be added
-- later if a farm inside a project ever needs to diverge from its
-- project's default (e.g. a mature-orchard farm joining Fruit-Plantations).
CREATE TABLE mrv.project_plot_type_defaults (
  project_id          text PRIMARY KEY, -- SaaS projects.id
  project_name        text NOT NULL,
  default_plot_type   text NOT NULL REFERENCES mrv.credit_yield_rate_table (plot_type),
  created_at           timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mrv.project_plot_type_defaults (project_id, project_name, default_plot_type) VALUES
  ('1d006d6a-909b-458c-83c3-f3937901301f', 'CarboNature Farming Project – E.Africa', 'open_field'),
  ('c3511171-27c0-4c31-85f2-ea5cede8f355', 'CarboNature Fruit-Plantations Project – E.Africa', 'young_orchard');

-- Per-plot potential-credit estimates — computed for every plot,
-- including ones with no deal yet, since the whole point is knowing a
-- farm's potential before any transaction happens on it (the campaign
-- launches well before real soil-sampling rounds).
CREATE TABLE mrv.credit_yield_estimates (
  estimate_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_id            text NOT NULL,
  farm_id            text NOT NULL,
  project_id         text NOT NULL,
  plot_type          text NOT NULL REFERENCES mrv.credit_yield_rate_table (plot_type),
  area_ha            numeric NOT NULL,
  rate_per_ha        numeric NOT NULL,
  estimated_credits  numeric NOT NULL,
  method             text NOT NULL DEFAULT 'rate_table' CHECK (method IN ('rate_table', 'sampled', 'ml_predicted')),
  estimated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_credit_yield_estimates_plot_method ON mrv.credit_yield_estimates (plot_id, method);
CREATE INDEX idx_credit_yield_estimates_farm ON mrv.credit_yield_estimates (farm_id);

COMMENT ON TABLE mrv.credit_yield_estimates IS
  'Pre-sampling potential-credit estimates per plot, by rate table today; sampled/ml_predicted rows join the same table once real sampling rounds start, building the ML training set without losing the original estimates.';

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('john', 'john_allocation_sync',
   'Sync Agri-Inputs + Project Funding deals into the Allocation Register (double-counting gate enforced)',
   'weekly', 0, now()),
  ('john', 'john_credit_potential_estimate',
   'Compute pre-sampling credit-yield potential for new and existing plots',
   'weekly', 0, now()),
  ('john', 'john_actual_reconciliation',
   'Reconcile real MRV/soil-sampling results into the actual-credits vector, alert immediately on shortfall',
   'weekly', 0, now()),
  ('john', 'john_allocation_report',
   'Weekly Allocation Register report — project / farm / CarboNature levels, both vectors',
   'weekly', 0, now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key IN (
  'john_allocation_sync', 'john_credit_potential_estimate', 'john_actual_reconciliation', 'john_allocation_report'
);
DROP TABLE IF EXISTS mrv.credit_yield_estimates;
DROP TABLE IF EXISTS mrv.project_plot_type_defaults;
DROP TABLE IF EXISTS mrv.credit_yield_rate_table;
DROP TABLE IF EXISTS mrv.farm_participation_terms;
DROP TABLE IF EXISTS mrv.allocation_register;
