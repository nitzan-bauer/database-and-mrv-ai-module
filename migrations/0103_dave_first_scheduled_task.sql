-- migrate:up
-- =====================================================================
-- 0103 — Dave's first scheduled task (Stage 5 of the agent learning-layer
-- plan). Runs immediately on the next cron tick, then every 2 months
-- (the 'bimonthly' frequency the cron runner now supports) — the
-- schedule is expected to change once real farms need this instead of
-- the two demo farms.
-- =====================================================================

ALTER TABLE mrv.scheduled_tasks DROP CONSTRAINT scheduled_tasks_frequency_check;
ALTER TABLE mrv.scheduled_tasks ADD CONSTRAINT scheduled_tasks_frequency_check
  CHECK (frequency = ANY (ARRAY['daily', 'weekly', 'biweekly', 'monthly', 'bimonthly']));

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('dave', 'dave_bsl_protocol_and_sampling_plan',
   'BSL selection protocol + sampling plan for the demo farms',
   'bimonthly', NULL, now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key = 'dave_bsl_protocol_and_sampling_plan';
ALTER TABLE mrv.scheduled_tasks DROP CONSTRAINT scheduled_tasks_frequency_check;
ALTER TABLE mrv.scheduled_tasks ADD CONSTRAINT scheduled_tasks_frequency_check
  CHECK (frequency = ANY (ARRAY['daily', 'weekly', 'biweekly', 'monthly']));
