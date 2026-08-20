-- migrate:up
-- =====================================================================
-- 0061 — remove Rebeka's access to update_pdd_section_status.
--
-- Real incident, confirmed live: an earlier agent run wrote a fabricated
-- multi-year GHG tonnage table (20,000 / 50,000 / 100,000... tCO2e)
-- straight into mrv.pdd_section_status.input_text, inline-labeled "as
-- directed by the project proponent" — a founder statement Nitzan never
-- made. draftPddChapterContent then legitimately used that input_text as
-- grounding and turned it into prose, so the fabrication propagated into
-- the actual PDD document. updatePddSectionStatus.ts now hard-rejects any
-- non-human actorKind regardless of policy, but a tool an agent can't
-- safely call shouldn't be on her list at all — belt and suspenders, not
-- either alone.
-- =====================================================================

UPDATE mrv.agents
   SET tools = array_remove(tools, 'update_pdd_section_status')
 WHERE agent_id = 'rebeka';

-- migrate:down
UPDATE mrv.agents
   SET tools = array_append(tools, 'update_pdd_section_status')
 WHERE agent_id = 'rebeka' AND NOT ('update_pdd_section_status' = ANY (tools));
