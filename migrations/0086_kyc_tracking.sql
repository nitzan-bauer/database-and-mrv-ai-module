-- migrate:up
-- =====================================================================
-- 0086 — KYC tracking (Ron, Phase 3 of the approved Ron/John plan).
--
-- Mirrors the real Sale Cycle stage 4 (Due diligence / KYC-AML): a
-- condition precedent before any transaction, reviewed manually by
-- CarboNature against documents emailed to info@carbonature.io — no
-- document-upload/parsing flow exists anywhere in the SaaS today, so
-- this table only tracks STATE (what stage a buyer is stuck at, since
-- when) for automated follow-up reminders, not the documents themselves.
--
-- 'cleared' is the one legally/financially sensitive status — per the
-- plan's own risk mitigation, it is NEVER set by an agent inferring
-- readiness; only a human (cleared_by = their email) moves a row there.
-- Ron's ron_kyc_followup task only ever reads this table and sends
-- reminders; it has no write path to 'cleared' at all.
-- =====================================================================

CREATE TABLE mrv.kyc_tracking (
  kyc_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id             text NOT NULL UNIQUE, -- SaaS profiles.id — one KYC record per credit buyer
  buyer_company_name   text NOT NULL,
  buyer_email          text,
  status               text NOT NULL DEFAULT 'pending_documents'
                         CHECK (status IN ('pending_documents', 'under_review', 'enhanced_review_required', 'cleared', 'rejected')),
  requested_at         timestamptz NOT NULL DEFAULT now(),
  last_reminder_sent_at timestamptz,
  cleared_at           timestamptz,
  cleared_by           text, -- the human actor's email — never an agent id
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kyc_tracking_status ON mrv.kyc_tracking (status) WHERE status NOT IN ('cleared', 'rejected');

COMMENT ON TABLE mrv.kyc_tracking IS
  'State-only KYC/AML tracking per credit buyer (no documents) — populated by the account-opening webhook, followed up by ron_kyc_followup, cleared only by a human. See src/app/api/webhooks/saas-account-opened/route.ts and src/lib/agent/scheduledTasks/ronKycFollowup.ts.';

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('ron', 'ron_kyc_followup',
   'Remind credit buyers stuck in KYC without a cleared status',
   'weekly', 0, now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key = 'ron_kyc_followup';
DROP TABLE IF EXISTS mrv.kyc_tracking;
