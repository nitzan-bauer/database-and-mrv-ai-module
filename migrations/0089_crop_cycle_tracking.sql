-- migrate:up
-- =====================================================================
-- 0089 — Crop-cycle tracking (Ron, new request 2026-08-26): a "smart
-- table" synced from each plot's own info-window data (crop, planting
-- date, agri-inputs — all read from carbonature-saas's plots.geojson,
-- confirmed live there are no separate DB columns for these), plus an
-- admin-editable crop→cycle-length lookup (Nitzan: "אני אמלא אותה פעם
-- אחת ידני" — he fills it in once, by hand) that drives an escalating
-- pre-season-end reminder for open-field crops and an annual check-in
-- for orchards (plot type reused from mrv.project_plot_type_defaults —
-- no new classification needed).
-- =====================================================================

-- Admin-editable (super_admin only, same gate as credit_yield_rate_table)
-- crop-name -> cycle-length lookup. crop_name is stored/matched
-- lowercase+trimmed since the SaaS's own `crop` field is free text typed
-- by farmers ("Tomato" vs "tomatoes" would otherwise never match).
CREATE TABLE mrv.crop_cycle_lengths (
  crop_name    text PRIMARY KEY,
  cycle_days   integer NOT NULL CHECK (cycle_days > 0),
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mrv.crop_cycle_lengths IS
  'Admin-editable (super_admin) crop-name -> cycle-length-in-days lookup, keyed lowercase-trimmed. Drives ron_crop_cycle_reminder''s pre-season-end escalation for open-field crops. Edit only via the /admin screen.';

-- The smart table itself — one row per plot, refreshed weekly from the
-- SaaS's plots.geojson.properties (the plot's own info-window data).
CREATE TABLE mrv.plot_crop_cycles (
  plot_id        text PRIMARY KEY,
  farm_id        text NOT NULL,
  project_id     text NOT NULL,
  plot_type      text, -- from mrv.project_plot_type_defaults; NULL if the project has no mapping yet
  crop           text,
  planting_date  date,
  agri_inputs    jsonb,
  plants_density numeric,
  synced_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_plot_crop_cycles_farm ON mrv.plot_crop_cycles (farm_id);

COMMENT ON TABLE mrv.plot_crop_cycles IS
  'Synced copy of each plot''s crop-cycle info-window (crop/planting_date/agri_inputs/plants_density) — read-only mirror, refreshed by ron_plot_cycle_sync. See src/lib/agent/scheduledTasks/ronPlotCycleSync.ts.';

-- Reuse the existing fire-once/on-interval/on-change tracker for
-- per-plot reminders too, rather than a bespoke table.
ALTER TABLE mrv.retention_touchpoints DROP CONSTRAINT retention_touchpoints_entity_type_check;
ALTER TABLE mrv.retention_touchpoints ADD CONSTRAINT retention_touchpoints_entity_type_check
  CHECK (entity_type IN ('farm', 'buyer', 'deal', 'plot'));

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('ron', 'ron_plot_cycle_sync',
   'Sync each plot''s crop-cycle info (crop, planting date, inputs) from its SaaS info-window',
   'weekly', 0, now()),
  ('ron', 'ron_crop_cycle_reminder',
   'Escalating pre-season-end reminder for open-field crops (45/30/15/7 days), annual check-in for orchards',
   'weekly', 0, now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key IN ('ron_plot_cycle_sync', 'ron_crop_cycle_reminder');
ALTER TABLE mrv.retention_touchpoints DROP CONSTRAINT retention_touchpoints_entity_type_check;
ALTER TABLE mrv.retention_touchpoints ADD CONSTRAINT retention_touchpoints_entity_type_check
  CHECK (entity_type IN ('farm', 'buyer', 'deal'));
DROP TABLE IF EXISTS mrv.plot_crop_cycles;
DROP TABLE IF EXISTS mrv.crop_cycle_lengths;
