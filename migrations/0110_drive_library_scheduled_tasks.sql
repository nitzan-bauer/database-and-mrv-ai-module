-- migrate:up
-- =====================================================================
-- 0110 — Stage 10 cadence: John's sorting round runs first; the 5
-- agents' digestion rounds are seeded a day later. The cron here only
-- ticks once a day (vercel.json), so same-run "immediately after"
-- sequencing isn't available — a one-day offset is the honest, correct
-- version of that at this granularity: John's round is fully done and
-- routed before any agent's digestion round ever looks at its own
-- folder. Both then keep advancing on their own 14-day step from these
-- anchors, so the one-day gap persists indefinitely.
-- =====================================================================

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('john', 'john_drive_sorting_round',
   'Biweekly Drive sorting round: CLAUDE/CARBONATURE/DOWNLOADS -> agent folders',
   'biweekly', NULL, now()),
  ('dave', 'dave_drive_digestion', 'Biweekly Drive folder review', 'biweekly', NULL, now() + interval '1 day'),
  ('jennifer', 'jennifer_drive_digestion', 'Biweekly Drive folder review', 'biweekly', NULL, now() + interval '1 day'),
  ('john', 'john_drive_digestion', 'Biweekly Drive folder review', 'biweekly', NULL, now() + interval '1 day'),
  ('rebeka', 'rebeka_drive_digestion', 'Biweekly Drive folder review', 'biweekly', NULL, now() + interval '1 day'),
  ('ron', 'ron_drive_digestion', 'Biweekly Drive folder review', 'biweekly', NULL, now() + interval '1 day')
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key IN (
  'john_drive_sorting_round', 'dave_drive_digestion', 'jennifer_drive_digestion',
  'john_drive_digestion', 'rebeka_drive_digestion', 'ron_drive_digestion'
);
