-- migrate:up
-- =====================================================================
-- 0101 — foundational schema for the agent memory/learning layer (Stage 1
-- of the agreed 10-stage plan). No behavior change yet — this only adds
-- the columns/links every later stage needs to already exist.
-- =====================================================================

-- Stage 3 (cross-agent, MRV-domain-scoped recall): a coarser grouping
-- than kind/actionName — free text by convention (pdd_drafting,
-- mrv_monitoring, mrv_verification, sales_crm, ...), not an enum, matching
-- how `kind` already works on this same table.
ALTER TABLE mrv.agent_memory ADD COLUMN IF NOT EXISTS domain text;

COMMENT ON COLUMN mrv.agent_memory.domain IS
  'Coarse professional-domain tag (pdd_drafting, mrv_monitoring, mrv_verification, sales_crm, ...) — lets a lesson recorded by one agent surface for a different agent doing related work. See recallDomainLessons(). Free text by convention, like kind.';

-- Stages 6-7 (supersession chain + consolidation): supersedes_memory_id is
-- set once, at insert time, on the NEW row. superseded_by is written onto
-- the OLD row in the same transaction as that insert — both columns exist
-- so a recall query can filter "is this still current" (WHERE
-- superseded_by IS NULL) without a self-join on every candidate row.
ALTER TABLE mrv.agent_memory ADD COLUMN IF NOT EXISTS supersedes_memory_id uuid REFERENCES mrv.agent_memory(memory_id) ON DELETE SET NULL;
ALTER TABLE mrv.agent_memory ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES mrv.agent_memory(memory_id) ON DELETE SET NULL;

COMMENT ON COLUMN mrv.agent_memory.supersedes_memory_id IS
  'This memory was written because new evidence contradicted/corrected an older one — points at the memory it replaces.';
COMMENT ON COLUMN mrv.agent_memory.superseded_by IS
  'Set on the OLD row when a newer memory supersedes it (mirrors that row''s supersedes_memory_id). NULL means still current — the default filter for recall.';

-- Stage 4 (root-cause linkage): a VVB finding can now be attributed to the
-- specific sampling cycle, model run, baseline site, or work order that
-- caused it, instead of only free-text prose. All nullable — most
-- existing/near-term findings won't have one, and a finding is never
-- required to name a cause to be recorded.
ALTER TABLE mrv.vvb_findings ADD COLUMN IF NOT EXISTS sampling_cycle_id uuid REFERENCES mrv.sampling_cycles(cycle_id) ON DELETE SET NULL;
ALTER TABLE mrv.vvb_findings ADD COLUMN IF NOT EXISTS model_run_id uuid REFERENCES mrv.model_runs(run_id) ON DELETE SET NULL;
ALTER TABLE mrv.vvb_findings ADD COLUMN IF NOT EXISTS baseline_site_id text REFERENCES mrv.baseline_control_sites(bsl_id) ON DELETE SET NULL;
ALTER TABLE mrv.vvb_findings ADD COLUMN IF NOT EXISTS work_order_id text REFERENCES mrv.work_orders(wo_id) ON DELETE SET NULL;

COMMENT ON COLUMN mrv.vvb_findings.sampling_cycle_id IS 'The sampling cycle this finding concerns, if any — lets a finding be mined by root cause instead of only free text.';
COMMENT ON COLUMN mrv.vvb_findings.model_run_id IS 'The model run this finding concerns, if any.';
COMMENT ON COLUMN mrv.vvb_findings.baseline_site_id IS 'The baseline (BSL) site this finding concerns, if any.';
COMMENT ON COLUMN mrv.vvb_findings.work_order_id IS 'The work order this finding concerns, if any.';

-- Stage 5 (Dave's protocol as a stable reference memory, not a decaying
-- episodic note): no schema change needed — 'protocol' is just a new
-- value under the existing free-text `kind` column, exactly like 'lesson'
-- already is. Recorded here only as a note for the next migration reader.

-- migrate:down
ALTER TABLE mrv.vvb_findings DROP COLUMN IF EXISTS work_order_id;
ALTER TABLE mrv.vvb_findings DROP COLUMN IF EXISTS baseline_site_id;
ALTER TABLE mrv.vvb_findings DROP COLUMN IF EXISTS model_run_id;
ALTER TABLE mrv.vvb_findings DROP COLUMN IF EXISTS sampling_cycle_id;
ALTER TABLE mrv.agent_memory DROP COLUMN IF EXISTS superseded_by;
ALTER TABLE mrv.agent_memory DROP COLUMN IF EXISTS supersedes_memory_id;
ALTER TABLE mrv.agent_memory DROP COLUMN IF EXISTS domain;
