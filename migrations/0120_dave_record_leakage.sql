-- migrate:up
-- =====================================================================
-- 0120 — Phase 2/3 of the GHG Calculator web migration: grant Dave the
-- record_leakage tool for VM0042 §8.4.2/8.4.3/8.4.4 (manually-justified
-- leakage). §8.4.1 has no manual-entry path — it is computed live from
-- activity data (engine.ts's computeLeakage841) — so this tool refuses
-- that component outright; see recordLeakage.ts.
--
-- 'auto', same standing as record_activity_data/record_baseline_site:
-- writes a working row, not append-only, commits nothing externally.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('record_leakage', 'auto', 'Writes a working row, not append-only; commits nothing externally. §8.4.1 is computed, not accepted here.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['record_leakage']::text[]
 WHERE agent_id = 'dave'
   AND NOT ('record_leakage' = ANY (tools));

-- migrate:down
UPDATE mrv.agents SET tools = array_remove(tools, 'record_leakage') WHERE agent_id = 'dave';
DELETE FROM mrv.agent_action_policies WHERE action_name = 'record_leakage';
