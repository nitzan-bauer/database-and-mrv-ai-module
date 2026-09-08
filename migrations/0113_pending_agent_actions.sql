-- migrate:up
-- =====================================================================
-- 0113 — The missing half of every 'confirm'-mode action.
--
-- checkPolicy (src/lib/tools/context.ts) has always had a real 'confirm'
-- mode: for an agent actor it only passes when ctx.confirmed === true.
-- Confirmed live 2026-09-08: nothing in the entire codebase has ever set
-- confirmed: true, anywhere — not from a scheduled task, not from the
-- interactive "Ask <Agent>" chat. So every one of the ~12 real actions
-- already marked 'confirm' (send_work_order, export_plots_kmz,
-- generate_pdd_draft, centralize_farm_document, ingest_model_results,
-- record_mvr_signoff, sync_pdd_google_doc, submit_project_status,
-- run_pdd_generator_pipeline, schedule_calendar_event,
-- compile_eligibility_evidence_pack) has been structurally unreachable
-- since the day it was built — an agent proposing one always gets
-- refused, and there has never been anywhere for a human to actually
-- say yes.
--
-- runAgentTask.ts already builds everything a replay needs the moment a
-- call is refused (agent id, exact action name, exact input, refusal
-- reason) — it just threw that away instead of writing it somewhere a
-- person could act on later. This table is that somewhere: one row per
-- proposed-but-not-yet-approved action, mutable (pending -> approved /
-- rejected / failed) by design, which is exactly why this is a real
-- table and not something layered onto mrv.audit_log (append-only by
-- trigger, mrv.prevent_mutation() — see migrations/0005_audit.sql).
-- =====================================================================

CREATE TYPE mrv.pending_action_status AS ENUM ('pending', 'approved', 'rejected', 'failed');

CREATE TABLE mrv.pending_agent_actions (
  pending_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     text NOT NULL REFERENCES mrv.agents(agent_id) ON DELETE CASCADE,
  -- Matches mrv.agent_action_policies.action_name / TOOL_REGISTRY's own
  -- keys — not a foreign key, since action names are a code-level
  -- registry, not a database table.
  action_name  text NOT NULL,
  -- The exact tool input runAgentTask was about to hand the handler,
  -- stored verbatim (post farmId-name-to-uuid resolution) so approval
  -- replays the identical call, not a reconstruction of one.
  input        jsonb NOT NULL,
  reason       text NOT NULL,
  requested_by text NOT NULL,
  status       mrv.pending_action_status NOT NULL DEFAULT 'pending',
  resolved_by  uuid REFERENCES mrv.users(user_id) ON DELETE SET NULL,
  resolved_at  timestamptz,
  -- What the replayed handler actually returned once resolved (success
  -- data or the failure reason) — kept for the record, not re-parsed by
  -- anything.
  result       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Same shape as mrv.work_orders' own wo_issued_chk (migrations/0009):
  -- a row leaving its initial state must record who + when.
  CONSTRAINT pending_resolved_chk CHECK (status = 'pending' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);

CREATE INDEX idx_pending_agent_actions_status ON mrv.pending_agent_actions (status, created_at DESC);

-- migrate:down
DROP TABLE IF EXISTS mrv.pending_agent_actions;
DROP TYPE IF EXISTS mrv.pending_action_status;
