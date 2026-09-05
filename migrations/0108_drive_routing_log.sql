-- migrate:up
CREATE TABLE IF NOT EXISTS mrv.drive_routing_log (
  file_id     text PRIMARY KEY,
  file_name   text NOT NULL,
  agent_ids   text[] NOT NULL DEFAULT '{}',
  excluded    boolean NOT NULL DEFAULT false,
  routed_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mrv.drive_routing_log IS
  'One row per source-folder file John''s biweekly sorting round has already classified — so a re-scan skips it instead of re-routing (and re-shortcutting) the same document every cycle. excluded=true means it was deliberately kept out of every agent folder (a work-plan/spec/prompt-engineering document).';

-- migrate:down
DROP TABLE IF EXISTS mrv.drive_routing_log;
