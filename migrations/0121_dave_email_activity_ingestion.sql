-- migrate:up
-- =====================================================================
-- 0121 — Phase 4 of the GHG Calculator web migration: Dave reads real
-- emails sent to his own inbox (dave@carbonature.io), extracts GHG
-- activity data (fuel, fertiliser applications) via LLM, and either
-- records it directly (clean, self-audited extraction) or routes it to
-- the existing pending_agent_actions approval queue (0113) when
-- something looks unresolved or implausible — reusing that
-- infrastructure exactly as its own forward-looking comment intended,
-- rather than building a second review mechanism.
--
-- Dedup log: one row per Gmail message Dave has already looked at, so a
-- daily re-scan does not re-process the same email every run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS mrv.activity_data_email_ingestion_log (
  gmail_id    text PRIMARY KEY,
  outcome     text NOT NULL CHECK (outcome IN ('recorded', 'needs_review', 'not_activity_data', 'failed')),
  detail      text,
  farm_id     uuid REFERENCES mrv.farms(farm_id) ON DELETE SET NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mrv.activity_data_email_ingestion_log IS
  'One row per Gmail message dave_email_activity_ingestion has already looked at — so a daily re-scan of dave@carbonature.io''s inbox skips it instead of re-extracting the same email every run.';

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('dave', 'dave_email_activity_ingestion',
   'Read inbox for GHG activity-data submissions, extract, self-audit, record or flag for review',
   'daily', NULL, now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key = 'dave_email_activity_ingestion';
DROP TABLE IF EXISTS mrv.activity_data_email_ingestion_log;
