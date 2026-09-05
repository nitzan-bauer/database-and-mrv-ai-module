-- migrate:up
-- =====================================================================
-- 0105 — Stage 8 of the agent learning-layer plan: a running profile per
-- recurring real-world entity (a specific lab, VVB, farm, or contractor),
-- distinct from the episodic notes in mrv.agent_memory. A lab's
-- systematic bias, or a VVB's known strictness pattern, is a fact about
-- that entity that should get REFINED as new evidence arrives, not
-- re-stated as another one-off note competing with the last ten.
--
-- entity_id is free text, not an FK — vvb/contractor have no backing
-- table of their own (a VVB today is just a name/reference string on
-- mrv.vvb_findings.raised_by), so this has to stay polymorphic rather
-- than pick one real table to point at.
-- =====================================================================

CREATE TABLE IF NOT EXISTS mrv.entity_profile (
  entity_type    text NOT NULL CHECK (entity_type IN ('lab', 'vvb', 'farm', 'contractor')),
  entity_id      text NOT NULL,
  profile_text   text NOT NULL,
  evidence_count integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);

COMMENT ON TABLE mrv.entity_profile IS
  'One row per recurring real-world entity (lab/vvb/farm/contractor) — updated in place as new evidence arrives, not appended to. See updateEntityProfile.ts. Distinct from mrv.agent_memory, which is episodic (one row per event).';

UPDATE mrv.agents
   SET tools = tools || '{update_entity_profile}'
 WHERE agent_id = 'dave' AND NOT ('update_entity_profile' = ANY(tools));

INSERT INTO mrv.agent_action_policies (action_name, mode, note)
SELECT 'update_entity_profile', 'auto', 'Refines a running profile for a lab/VVB/farm/contractor from new evidence — same risk profile as record_agent_memory, which is already auto.'
WHERE NOT EXISTS (SELECT 1 FROM mrv.agent_action_policies WHERE action_name = 'update_entity_profile');

-- migrate:down
DELETE FROM mrv.agent_action_policies WHERE action_name = 'update_entity_profile';
UPDATE mrv.agents SET tools = array_remove(tools, 'update_entity_profile') WHERE agent_id = 'dave';
DROP TABLE IF EXISTS mrv.entity_profile;
