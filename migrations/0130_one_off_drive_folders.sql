-- migrate:up
-- One Off Task: Google Drive folders the request asks the agent to read (a pasted folder link; the system reads
-- the files when the run starts, with the same Google identity the other Drive tools use).
ALTER TABLE mrv.adhoc_agent_jobs ADD COLUMN IF NOT EXISTS drive_folders text[] NOT NULL DEFAULT '{}';

-- migrate:down
ALTER TABLE mrv.adhoc_agent_jobs DROP COLUMN IF EXISTS drive_folders;
