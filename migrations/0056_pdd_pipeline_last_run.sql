-- migrate:up
-- =====================================================================
-- 0056 — weekly check, the honest version: no scheduler exists in this
-- app (it runs when Nitzan starts it by hand from the desktop
-- shortcut), so "once a week" cannot mean a real background clock yet
-- without moving this off the local dev server onto persistent
-- hosting — a real deployment decision, not made here. What this
-- migration gives instead: last_pdd_pipeline_run_at, stamped every time
-- the pipeline actually runs, so the control tower can say "N days
-- since the last round" and prompt a run — a lazy, on-open check, not
-- a cron.
-- =====================================================================

ALTER TABLE mrv.projects ADD COLUMN last_pdd_pipeline_run_at timestamptz;

-- migrate:down
ALTER TABLE mrv.projects DROP COLUMN IF EXISTS last_pdd_pipeline_run_at;
