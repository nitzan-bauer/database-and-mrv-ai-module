-- migrate:up
-- =====================================================================
-- 0066 — compile_eligibility_evidence_pack (Rebeka): links every real
-- project activity (mrv.alm_activities) to the specific VM0042 v2.2
-- Appendix 1 category and bullet it falls under (pp.140-142 of the
-- local docs/source/VM0042v2.2.txt) — real supporting evidence for
-- eligibility (Applicability Condition 1) and additionality (Step 3
-- Common Practice), Nitzan's own explicit ask.
--
-- Delivered as a Drive doc, same convention as sync_pdd_readiness_report
-- (0054) — same Drive folder, same create-then-update lifecycle, same
-- 'confirm' policy: a real file written into the signed-in person's own
-- Drive is something a person should see go out.
-- =====================================================================

ALTER TABLE mrv.projects
  ADD COLUMN eligibility_pack_doc_id  text,
  ADD COLUMN eligibility_pack_doc_url text;

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('compile_eligibility_evidence_pack', 'confirm', 'Writes a real file into the signed-in person''s own Drive — a person should see it go out.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['compile_eligibility_evidence_pack']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('compile_eligibility_evidence_pack' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'compile_eligibility_evidence_pack')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'compile_eligibility_evidence_pack';

ALTER TABLE mrv.projects
  DROP COLUMN IF EXISTS eligibility_pack_doc_id,
  DROP COLUMN IF EXISTS eligibility_pack_doc_url;
