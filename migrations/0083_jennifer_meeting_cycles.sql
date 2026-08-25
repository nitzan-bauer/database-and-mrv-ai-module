-- migrate:up
-- =====================================================================
-- 0083 — Jennifer's recurring weekly-meeting cycle: full end-to-end
-- automation (Nitzan's own explicit standing requirement, this session:
-- every scheduled task must reach full automation, not best-effort).
--
-- mrv.scheduled_tasks only ever stored *when* a task runs, never a
-- task's own mutable state across runs — every existing task is
-- stateless between invocations (rescan, re-report). This task is not:
-- it owns a real lifecycle (active -> renewal_requested -> renewed, or
-- -> lapsed) that has to survive across many daily cron ticks, so it
-- gets its own state table rather than being shoehorned into the
-- append-only mrv.scheduled_task_reports log.
--
-- 'daily' is added to the frequency check because the renewal step
-- only fires on one specific day (7 days before a cycle's last
-- occurrence) and reply-detection has to be checked every day in
-- between — weekly/biweekly/monthly cadences can't express that.
-- =====================================================================

ALTER TABLE mrv.scheduled_tasks DROP CONSTRAINT scheduled_tasks_frequency_check;
ALTER TABLE mrv.scheduled_tasks ADD CONSTRAINT scheduled_tasks_frequency_check
  CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly'));

CREATE TABLE mrv.jennifer_meeting_cycles (
  cycle_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lets one handler manage more than one distinct recurring meeting later
  -- without a schema change — only 'weekly_work_meeting' exists today.
  meeting_key           text NOT NULL,
  summary                text NOT NULL,
  attendee_emails        text[] NOT NULL,
  -- 0=Sunday..6=Saturday, matching mrv.scheduled_tasks.day_of_week's own
  -- convention (JS Date#getDay) rather than inventing a second one.
  weekday                smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_hour             smallint NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
  start_minute           smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 59),
  duration_minutes       integer NOT NULL DEFAULT 60,
  calendar_event_id      text,
  cycle_start_date       date NOT NULL,
  cycle_end_date         date NOT NULL, -- the date of the LAST occurrence in this cycle
  status                 text NOT NULL CHECK (status IN ('active', 'renewal_requested', 'renewed', 'lapsed')),
  renewal_requested_at   timestamptz,
  renewal_email_subject  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jennifer_meeting_cycles_lookup ON mrv.jennifer_meeting_cycles (meeting_key, status, created_at DESC);

COMMENT ON TABLE mrv.jennifer_meeting_cycles IS
  'One row per ~3-month recurring-meeting cycle Jennifer has created — the mutable lifecycle state a stateless scheduled-task report cannot hold. See src/lib/agent/scheduledTasks/jenniferWeeklyMeetingCycle.ts.';

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, next_run_at)
VALUES
  ('jennifer', 'jennifer_weekly_meeting_cycle',
   'Weekly work meeting: recurring calendar cycle, renewal approval, and notifications',
   'daily', now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key = 'jennifer_weekly_meeting_cycle';
DROP TABLE IF EXISTS mrv.jennifer_meeting_cycles;
ALTER TABLE mrv.scheduled_tasks DROP CONSTRAINT scheduled_tasks_frequency_check;
ALTER TABLE mrv.scheduled_tasks ADD CONSTRAINT scheduled_tasks_frequency_check
  CHECK (frequency IN ('weekly', 'biweekly', 'monthly'));
