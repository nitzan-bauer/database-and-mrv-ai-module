-- migrate:up
-- =====================================================================
-- 0030 — Dave's fourth and fifth tools: baseline control sites and
-- activity data. These close the two real gaps the TIER-1 report named:
-- PDD readiness reading "0/2 baseline defined", and the GHG Calculator
-- reading "no activity data recorded" for every farm.
--
-- bsl_id generation follows mrv.next_sample_id() / mrv.next_wo_id(): a
-- sequence, not "read the max and add one" in application code, because
-- two people entering a site at the same moment would both compute the
-- same next number and one insert would lose to the primary key.
--
-- Both actions are 'auto', the same standing as propose_sampling_plan:
-- writing a row is not, on its own, an external commitment, and neither
-- table is append-only (unlike ghg_parameters or samples) — a person can
-- still correct a mis-typed figure directly, which is the right answer
-- for a working number rather than an issued one.
-- =====================================================================

CREATE SEQUENCE mrv.bsl_id_seq;

CREATE OR REPLACE FUNCTION mrv.next_bsl_id() RETURNS text AS $$
  SELECT 'BSL-' || lpad(nextval('mrv.bsl_id_seq')::text, 4, '0');
$$ LANGUAGE sql;

COMMENT ON FUNCTION mrv.next_bsl_id() IS
  'Baseline control site id: BSL-<4 digits>, allocated from a sequence so two people entering a site at once cannot collide.';

ALTER TABLE mrv.baseline_control_sites ALTER COLUMN bsl_id SET DEFAULT mrv.next_bsl_id();

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('record_baseline_site', 'auto', 'Writes a working row, not append-only; commits nothing externally.'),
  ('record_activity_data', 'auto', 'Writes a working row, not append-only; commits nothing externally.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['record_baseline_site', 'record_activity_data']::text[]
 WHERE agent_id = 'dave'
   AND NOT ('record_baseline_site' = ANY (tools))
   AND NOT ('record_activity_data' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(array_remove(tools, 'record_baseline_site'), 'record_activity_data')
 WHERE agent_id = 'dave';
DELETE FROM mrv.agent_action_policies WHERE action_name IN ('record_baseline_site', 'record_activity_data');
ALTER TABLE mrv.baseline_control_sites ALTER COLUMN bsl_id DROP DEFAULT;
DROP FUNCTION IF EXISTS mrv.next_bsl_id();
DROP SEQUENCE IF EXISTS mrv.bsl_id_seq;
