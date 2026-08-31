-- migrate:up
-- =====================================================================
-- 0087 — Retention touchpoints (Ron, Phase 4 of the approved plan).
--
-- One generic tracker for every retention touchpoint, farmer and buyer
-- alike, rather than a bespoke table per touchpoint: (entity_type,
-- entity_id, touchpoint_key) is the natural key, last_sent_at gates
-- re-firing (once-ever for a welcome, interval-gated for periodic ones),
-- and last_seen_value lets a touchpoint diff against its own prior
-- reading (e.g. activity_status.current_status) without a second table.
-- =====================================================================

CREATE TABLE mrv.retention_touchpoints (
  entity_type      text NOT NULL CHECK (entity_type IN ('farm', 'buyer')),
  entity_id        text NOT NULL, -- SaaS farm.id or buyer profile.id
  touchpoint_key   text NOT NULL,
  last_sent_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_value  text,
  PRIMARY KEY (entity_type, entity_id, touchpoint_key)
);

COMMENT ON TABLE mrv.retention_touchpoints IS
  'Fire-once / fire-on-interval / fire-on-change state for Ron''s retention sequences. See src/lib/agent/scheduledTasks/ronRetentionSequence.ts.';

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('ron', 'ron_retention_sequence',
   'Farmer and credit-buyer retention touchpoints (welcome, activity updates, land nudge, near-delivery invite, pre-deal KYC check, annual impact)',
   'weekly', 0, now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key = 'ron_retention_sequence';
DROP TABLE IF EXISTS mrv.retention_touchpoints;
