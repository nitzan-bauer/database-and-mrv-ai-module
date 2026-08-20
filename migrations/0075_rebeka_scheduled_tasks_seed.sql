-- migrate:up
-- =====================================================================
-- 0075 — Rebeka's 5 real scheduled tasks (Nitzan's own spec, verbatim,
-- live this session). Handlers land in
-- web/src/lib/agent/scheduledTaskRegistry.ts; this just seeds the rows
-- the cron route (0073) dispatches against.
--
-- next_run_at = now() on all 5, on purpose: the very next daily cron
-- tick (or a manual "Run now" in the Vercel dashboard, the same method
-- already used to verify the scheduler infra itself) fires all 5 for
-- real immediately — 5 real report emails as end-to-end proof, the same
-- verification style used throughout this build.
-- =====================================================================

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('rebeka', 'rebeka_weekly_research_round',
   'Weekly research round: registry sweep, related-project ingestion, PDD redraft',
   'weekly', 1, now()),
  ('rebeka', 'rebeka_monthly_product_research',
   'Monthly product research: manufacturer pages -> Project Activities writing',
   'monthly', NULL, now()),
  ('rebeka', 'rebeka_weekly_pdd_development_scan',
   'Weekly PDD Development scan: new review comments -> redraft',
   'weekly', 1, now()),
  ('rebeka', 'rebeka_weekly_verra_webinar_scan',
   'Weekly Verra webinar scan: upcoming -> calendar reminder, new recordings -> summary',
   'weekly', 1, now()),
  ('rebeka', 'rebeka_biweekly_new_farmer_check',
   'Biweekly new-farmer check: SaaS marketplace -> mrv.farms -> PDD participants redraft',
   'biweekly', 1, now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key IN (
  'rebeka_weekly_research_round',
  'rebeka_monthly_product_research',
  'rebeka_weekly_pdd_development_scan',
  'rebeka_weekly_verra_webinar_scan',
  'rebeka_biweekly_new_farmer_check'
);
