-- migrate:up
-- Per-agent, not per-file: the same file can be shortcut into several
-- agents' folders (Stage 10.2), and each agent digests it independently
-- on its own biweekly round.
CREATE TABLE IF NOT EXISTS mrv.agent_drive_digested (
  agent_id     text NOT NULL REFERENCES mrv.agents(agent_id) ON DELETE CASCADE,
  file_id      text NOT NULL,
  digested_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, file_id)
);

-- migrate:down
DROP TABLE IF EXISTS mrv.agent_drive_digested;
