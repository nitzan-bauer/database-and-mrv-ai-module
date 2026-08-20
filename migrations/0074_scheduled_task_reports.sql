-- migrate:up
-- =====================================================================
-- 0074 — mrv.scheduled_task_reports: the literal "save to the database"
-- half of every scheduled task's report (Nitzan's own spec, live this
-- session — every one of the 5 real tasks he asked for ends the same
-- way: "מוציאה דוח עדכונים שומרת בזיכרון שלה, במסד הנתונים ושולחת לי
-- למייל" — produces an update report, saves it to her memory, to the
-- database, and emails it to me).
--
-- Deliberately separate from mrv.agent_memory (0034-era, embedding-
-- based recall): this table is a plain, queryable log of exactly what
-- a scheduled run reported, not a semantic-search index. Both are
-- written on every run — this is the "database" half, agent_memory is
-- the "memory" half.
-- =====================================================================

CREATE TABLE mrv.scheduled_task_reports (
  report_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key    text NOT NULL,
  project_id  text REFERENCES mrv.projects(project_id),
  subject     text NOT NULL,
  body_text   text NOT NULL,
  emailed     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_task_reports_task ON mrv.scheduled_task_reports (task_key, created_at DESC);

COMMENT ON TABLE mrv.scheduled_task_reports IS
  'One row per scheduled-task run''s report — the queryable log half of "save to memory + database + email" (src/lib/reports/scheduledTaskReport.ts). agent_memory holds the embedding-searchable half.';

-- migrate:down
DROP TABLE IF EXISTS mrv.scheduled_task_reports;
