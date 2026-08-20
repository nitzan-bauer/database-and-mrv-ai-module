-- migrate:up
-- =====================================================================
-- 0073 — mrv.scheduled_tasks: generic recurring-task infrastructure
-- for every agent (Nitzan's own request, live this session — 5 real
-- tasks for Rebeka to start, with John/Dave/Ron/Jennifer's own
-- scheduled tasks planned to follow the same table and dispatch loop).
--
-- The first cadence representation in this schema — confirmed nothing
-- to reuse: migrations/0056_pdd_pipeline_last_run.sql explicitly notes
-- "no scheduler exists in this app" and falls back to a lazy
-- last-run-timestamp check instead of a real one. Kept to
-- weekly/biweekly/monthly + a day field rather than full cron syntax,
-- since that covers every real task asked for today and stays
-- human-readable later in Admin.
--
-- task_key is the join to code (src/lib/agent/scheduledTaskRegistry.ts),
-- the same relationship mrv.agents.tools has to toolRegistry.ts — the
-- catalog of *what* a key means lives in code, this table only ever
-- holds *when* and *whether* it should run.
-- =====================================================================

CREATE TABLE mrv.scheduled_tasks (
  task_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        text NOT NULL REFERENCES mrv.agents(agent_id) ON DELETE CASCADE,
  task_key        text NOT NULL UNIQUE,
  title           text NOT NULL,
  frequency       text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  day_of_week     smallint CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday..6=Saturday; weekly/biweekly
  day_of_month    smallint CHECK (day_of_month BETWEEN 1 AND 28), -- monthly; capped at 28 so it exists in every month
  enabled         boolean NOT NULL DEFAULT true,
  last_run_at     timestamptz,
  last_run_status text CHECK (last_run_status IN ('ok', 'error', 'no_handler')),
  last_run_detail text,
  next_run_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_tasks_due ON mrv.scheduled_tasks (next_run_at) WHERE enabled;

COMMENT ON TABLE mrv.scheduled_tasks IS
  'Generic recurring-task schedule for any agent — what/when only; the handler for each task_key lives in src/lib/agent/scheduledTaskRegistry.ts.';

-- migrate:down
DROP TABLE IF EXISTS mrv.scheduled_tasks;
