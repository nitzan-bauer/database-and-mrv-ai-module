-- migrate:up
-- =====================================================================
-- 0088 — Ron's remaining two tasks (Phases 5+6 of the approved plan):
-- ron_expiry_reminder and ron_weekly_report. Completes Ron's 4-task set
-- (kyc_followup, retention_sequence, expiry_reminder, weekly_report),
-- alongside John's 4 (allocation_sync, credit_potential_estimate,
-- actual_reconciliation, allocation_report) — 8 tasks total, all weekly.
--
-- retention_touchpoints gets a third entity_type, 'deal' (a reservation
-- id or a Project Funding entry id), reusing the same fire-once-per-
-- window tracker rather than a bespoke table for expiry reminders.
-- =====================================================================

ALTER TABLE mrv.retention_touchpoints DROP CONSTRAINT retention_touchpoints_entity_type_check;
ALTER TABLE mrv.retention_touchpoints ADD CONSTRAINT retention_touchpoints_entity_type_check
  CHECK (entity_type IN ('farm', 'buyer', 'deal'));

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('ron', 'ron_expiry_reminder',
   'Remind buyers with a signature/payment window closing in 2-3 days, before the daily expiry job cancels the deal',
   'weekly', 0, now()),
  ('ron', 'ron_weekly_report',
   'CRM pipeline by stage, retention activity, farmer land/activity, and customer value (read from John''s allocation report)',
   'weekly', 0, now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key IN ('ron_expiry_reminder', 'ron_weekly_report');
ALTER TABLE mrv.retention_touchpoints DROP CONSTRAINT retention_touchpoints_entity_type_check;
ALTER TABLE mrv.retention_touchpoints ADD CONSTRAINT retention_touchpoints_entity_type_check
  CHECK (entity_type IN ('farm', 'buyer'));
