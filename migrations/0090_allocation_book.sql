-- migrate:up
-- =====================================================================
-- 0090 — Allocation Book (John): the 3-chapter rebuild of the Allocation
-- Register's reporting layer, per the detailed spec approved by Nitzan
-- 2026-08-31 (see agent-memory note project_mrv_allocation_book_spec for
-- the full history — this is Round 3, all 4 flagged decisions resolved).
--
-- This migration adds only what genuinely doesn't exist yet on top of
-- 0085's allocation_register: a test-data flag (for simulated deals run
-- through the book before their real sale cycle completes, e.g. Nitzan's
-- own 2026-08-31 "Credit Buyer" demo-account test), the Actual-vector
-- round ledger (rounds didn't exist at all before this — real issuance
-- has never happened), and the negative-balance protection flags
-- (30%/20% thresholds, Option B: CarboNature's 20% threshold now blocks
-- BOTH financing tracks for that project, per Nitzan's explicit choice).
--
-- Reused as-is from 0085, deliberately NOT duplicated here: the
-- partial-unique double-counting indexes, farm_participation_terms,
-- credit_yield_rate_table/estimates. Those already do exactly what the
-- Book's Chapter 1/2 spec needs.
-- =====================================================================

-- Marks a row that was written to let John's report/test pipeline run
-- against a deal that hasn't genuinely finished its real sale cycle yet
-- (signed + paid) — e.g. a demo-account reservation still awaiting a
-- contract. Never set by the real sync gate in johnAllocationSync.ts;
-- only ever set by an explicit, one-off test-seed script, so a real
-- production number is never silently mixed with a simulated one
-- without a visible tag in the report.
ALTER TABLE mrv.allocation_register ADD COLUMN is_test_data boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN mrv.allocation_register.is_test_data IS
  'True only for rows forced through pre-signature for a deliberate test run (e.g. the 2026-08-31 Credit Buyer demo-account test) — the Book report tags these "(TEST)" and never mixes them into a real published total without saying so.';

-- One row per real Actual-vector issuance round, per project. A "round"
-- = one (or a matched set of) mrv.vcu_issuances rows for that project —
-- reusing the existing issuance table as the anchor rather than inventing
-- a parallel concept, since vcu_issuances already IS "a real issuance
-- happened." available_pool_tco2e is the balance-carry result, computed
-- and stored at round-creation time for audit (Section 7.2's formula:
-- Available(N) = Verified(N) - SUM(Allocated(1..N-1))) — stored, not just
-- computed live, so a later balance dispute can be traced back to exactly
-- what pool this round was actually allocated against.
CREATE TABLE mrv.allocation_rounds (
  round_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            text NOT NULL,
  project_name          text NOT NULL,
  round_number          integer NOT NULL CHECK (round_number > 0),
  issuance_id           uuid REFERENCES mrv.vcu_issuances (issuance_id),
  gross_verified_tco2e  numeric NOT NULL,
  available_pool_tco2e  numeric NOT NULL,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reconciled', 'published')),
  reconciled_at         timestamptz,
  published_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, round_number)
);

COMMENT ON TABLE mrv.allocation_rounds IS
  'Chapter 3''s round ledger — one row per real Actual-vector issuance round, per project. See src/lib/agent/scheduledTasks/allocationBook/chapter3.ts.';

-- One row per farm (or per project-level Project-Funding draw) within a
-- round — the Actual-vector mirror of allocation_register's potential
-- side, scoped to a round rather than to a single deal, since a round's
-- net split is computed against that round's whole verified pool, not
-- deal-by-deal.
CREATE TABLE mrv.actual_allocations (
  actual_allocation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id              uuid NOT NULL REFERENCES mrv.allocation_rounds (round_id),
  farm_id               text,
  buyer_id              text,
  buyer_company_name    text,
  deal_type             text CHECK (deal_type IN ('agri_inputs', 'project_funding')),
  verified_tco2e        numeric NOT NULL,
  offset_tco2e          numeric NOT NULL DEFAULT 0,
  net_farm_tco2e        numeric NOT NULL DEFAULT 0,
  net_cn_tco2e          numeric NOT NULL DEFAULT 0,
  net_buyer_tco2e       numeric NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_actual_allocations_round ON mrv.actual_allocations (round_id);
CREATE INDEX idx_actual_allocations_farm ON mrv.actual_allocations (farm_id);

COMMENT ON TABLE mrv.actual_allocations IS
  'Chapter 3''s per-farm/per-project-funding-draw net split within one round. Quantity-only reconciliation target: SUM(net_farm+net_cn+net_buyer) per round must equal that round''s gross_verified_tco2e.';

-- Negative-balance protection (Section 7.3). scope_type/scope_id is
-- either ('farm', farm_id) or ('project_cn', project_id). Only one ACTIVE
-- flag per (scope, threshold) at a time — a partial unique index, so
-- clearing a flag (status='cleared') always frees that threshold to
-- retrigger later rather than being permanently blocked by history.
-- Option B (Nitzan's explicit choice, 2026-08-31): CarboNature's 20%
-- threshold blocks BOTH financing tracks for that project, not just
-- Project Funding.
CREATE TABLE mrv.negative_balance_flags (
  flag_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type              text NOT NULL CHECK (scope_type IN ('farm', 'project_cn')),
  scope_id                text NOT NULL,
  project_id              text NOT NULL,
  threshold_pct           integer NOT NULL CHECK (threshold_pct IN (30, 20)),
  balance_pct_at_trigger  numeric NOT NULL,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleared')),
  blocks_agri_inputs      boolean NOT NULL DEFAULT false,
  blocks_project_funding  boolean NOT NULL DEFAULT false,
  triggered_at            timestamptz NOT NULL DEFAULT now(),
  cleared_at              timestamptz
);

CREATE UNIQUE INDEX idx_negative_balance_flags_active
  ON mrv.negative_balance_flags (scope_type, scope_id, threshold_pct)
  WHERE status = 'active';
CREATE INDEX idx_negative_balance_flags_project ON mrv.negative_balance_flags (project_id) WHERE status = 'active';

COMMENT ON TABLE mrv.negative_balance_flags IS
  'Section 7.3 negative-balance alerts/blocks — computed weekly by john_allocation_report, read by johnAllocationSync.ts''s write-time gate to actually refuse a new deal for a blocked project (Option B: at project_cn''s 20% threshold, blocks_agri_inputs AND blocks_project_funding are both true).';

-- migrate:down
DROP TABLE IF EXISTS mrv.negative_balance_flags;
DROP TABLE IF EXISTS mrv.actual_allocations;
DROP TABLE IF EXISTS mrv.allocation_rounds;
ALTER TABLE mrv.allocation_register DROP COLUMN IF EXISTS is_test_data;
