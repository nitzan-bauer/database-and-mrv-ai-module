-- migrate:up
-- =====================================================================
-- 0129 — Nitzan (chat, 2026-10-31): every agent gets its own dedicated,
-- signed-in Chrome on his PC, and can read — read-only — the sites he
-- allows for a one-off task. The deployed app cannot see his browser, so a
-- small worker per agent on his PC answers requests queued here.
--
--   mrv.browser_requests          one row per "open this page" request
--   mrv.browser_worker_heartbeat  one row per agent: is its Chrome worker alive?
--
-- 'auto' policy: read-only, limited to the domains ticked for that task
-- (re-checked by the worker), no clicks/typing/submits; page text is wiped
-- from the DB when the job ends.
-- =====================================================================

CREATE TABLE IF NOT EXISTS mrv.browser_requests (
  request_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES mrv.adhoc_agent_jobs(job_id) ON DELETE CASCADE,
  url          text NOT NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'done', 'error', 'refused')),
  result_title text,
  result_text  text,            -- page text from a signed-in session: wiped when the job finishes (jobStore.finishJob)
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_browser_requests_queue ON mrv.browser_requests (status, created_at);

CREATE TABLE IF NOT EXISTS mrv.browser_worker_heartbeat (
  agent_id  text PRIMARY KEY REFERENCES mrv.agents(agent_id) ON DELETE CASCADE,
  last_seen timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('browse_chrome_session', 'auto',
   'Read-only: opens one page in the agent''s own signed-in Chrome profile on Nitzan''s PC and returns its text; limited to the domains ticked for that task; no clicks, typing or submits.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['browse_chrome_session']::text[]
 WHERE agent_id IN ('rebeka', 'dave', 'john', 'ron', 'jennifer')
   AND NOT ('browse_chrome_session' = ANY(tools));

-- migrate:down
UPDATE mrv.agents SET tools = array_remove(tools, 'browse_chrome_session');
DELETE FROM mrv.agent_action_policies WHERE action_name = 'browse_chrome_session';
DROP TABLE IF EXISTS mrv.browser_worker_heartbeat;
DROP TABLE IF EXISTS mrv.browser_requests;
