-- migrate:up
-- =====================================================================
-- 0128 — Nitzan (chat, 2026-10-31): run an agent on a one-off task from
-- its own Scheduled Tasks block — type a prompt (Hebrew/English), attach
-- files, paste links. Built first for Rebeka, then — his instruction —
-- the identical thing for all five agents (rebeka, dave, john, ron,
-- jennifer), placed last in each panel.
--
-- A 'manual' task row per agent (never picked up by cron, like
-- dave_email_activity_ingestion in 0122) plus one shared job table that
-- carries the request, the live progress and the final answer.
-- Plan: docs/superpowers/plans/2026-10-31-rebeka-one-off-task.md
-- =====================================================================

CREATE TABLE IF NOT EXISTS mrv.adhoc_agent_jobs (
  job_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       text NOT NULL REFERENCES mrv.agents(agent_id),
  requested_by   text NOT NULL,
  prompt         text NOT NULL,
  links          text[] NOT NULL DEFAULT '{}',
  attachments    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{name, text, truncated}] — extracted text only, never the raw file
  chrome_domains text[] NOT NULL DEFAULT '{}',         -- sites the agent may read through its own signed-in Chrome profile (0129)
  status         text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'done', 'needs_approval', 'error')),
  progress       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{at, step, tool, summary}]
  result_text    text,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_adhoc_agent_jobs_agent ON mrv.adhoc_agent_jobs (agent_id, created_at DESC);
COMMENT ON TABLE mrv.adhoc_agent_jobs IS
  'One row per one-off agent task started from a Scheduled Tasks popup (0128). Holds the request, live progress and the final answer.';
COMMENT ON COLUMN mrv.adhoc_agent_jobs.chrome_domains IS
  'Sites Nitzan allowed this agent to read through its dedicated signed-in Chrome profile for this one task (empty = none).';

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, next_run_at)
SELECT v.agent_id, v.agent_id || '_one_off_task',
       'Run ' || initcap(v.agent_id) || ' on a one-off task: a prompt in Hebrew or English, with attached files and links',
       'manual', '9999-12-31T00:00:00Z'
  FROM (VALUES ('rebeka'), ('dave'), ('john'), ('ron'), ('jennifer')) AS v(agent_id)
 WHERE EXISTS (SELECT 1 FROM mrv.agents a WHERE a.agent_id = v.agent_id)
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key IN
  ('rebeka_one_off_task', 'dave_one_off_task', 'john_one_off_task', 'ron_one_off_task', 'jennifer_one_off_task');
DROP TABLE IF EXISTS mrv.adhoc_agent_jobs;
