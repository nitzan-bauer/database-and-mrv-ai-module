-- migrate:up
-- =====================================================================
-- 0111 — Nitzan's own correction to Stage 10.2: an agent's own Drive
-- folder was only ever getting shortcuts to externally-sourced files,
-- never the real documents that agent itself has emailed him over time
-- (PDDs, reports, anything sent because he asked for it). John's
-- biweekly round now also scans Gmail for each agent's own sent
-- attachments and uploads real copies — this table is the dedup log so
-- a re-scan doesn't re-upload the same attachment every round.
-- =====================================================================

CREATE TABLE IF NOT EXISTS mrv.agent_email_document_log (
  gmail_id            text NOT NULL,
  attachment_filename text NOT NULL,
  agent_id            text NOT NULL REFERENCES mrv.agents(agent_id),
  drive_file_id       text,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gmail_id, attachment_filename)
);

COMMENT ON TABLE mrv.agent_email_document_log IS
  'One row per (email, attachment) John''s sorting round has already uploaded into that agent''s own Drive folder as a real file copy — so a re-scan of Gmail skips it instead of re-uploading a duplicate every cycle.';

-- migrate:down
DROP TABLE IF EXISTS mrv.agent_email_document_log;
