-- migrate:up
-- =====================================================================
-- 0122 — Nitzan (chat, 2026-09-12): at launch, farmer emails are rare
-- and personally solicited (he calls/messages a farmer, asks them to
-- send their fuel/fertiliser data, and gets exactly one email back) —
-- a daily automatic scan is the wrong shape for that traffic. He wants
-- to notify Dave himself, on demand, right when an email actually
-- arrives, from a "Run Now" control in Dave's own scheduled-tasks panel
-- — not a recurring schedule at all.
--
-- 'manual' is a new frequency value: the cron route (route.ts) excludes
-- it from automatic pickup entirely (WHERE frequency != 'manual'), so
-- next_run_at is cosmetic for this row — set to a far sentinel date
-- purely so nothing in the UI misreads it as "about to run soon".
-- =====================================================================

ALTER TABLE mrv.scheduled_tasks DROP CONSTRAINT scheduled_tasks_frequency_check;
ALTER TABLE mrv.scheduled_tasks ADD CONSTRAINT scheduled_tasks_frequency_check
  CHECK (frequency = ANY (ARRAY['daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'manual']));

UPDATE mrv.scheduled_tasks
   SET frequency = 'manual', next_run_at = '9999-12-31T00:00:00Z'
 WHERE task_key = 'dave_email_activity_ingestion';

-- migrate:down
UPDATE mrv.scheduled_tasks
   SET frequency = 'daily', next_run_at = now()
 WHERE task_key = 'dave_email_activity_ingestion';
ALTER TABLE mrv.scheduled_tasks DROP CONSTRAINT scheduled_tasks_frequency_check;
ALTER TABLE mrv.scheduled_tasks ADD CONSTRAINT scheduled_tasks_frequency_check
  CHECK (frequency = ANY (ARRAY['daily', 'weekly', 'biweekly', 'monthly', 'bimonthly']));
