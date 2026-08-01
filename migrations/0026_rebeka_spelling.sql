-- migrate:up
-- =====================================================================
-- 0026 — correct the Validation Manager's name: Rebeka, not Reveka.
--
-- 0024 seeded her as 'reveka' — a misspelling caught after the row was
-- already live. It is fixed here with a new migration rather than by
-- editing 0024 in place, for the same reason the irrigation-method rename
-- went through 0022 instead of rewriting 0004: a migration is a record of
-- what actually ran, and rewriting an applied one would make that record
-- describe something that never happened on the databases that already
-- ran it.
--
-- The primary key itself is renamed, not just the display name — 'reveka'
-- would otherwise remain in agent_id, actor_id, and every audit_log row
-- yet to be written under it. Safe to rename: no other agent's reports_to
-- points at 'reveka' (all four reports point at 'john'), so no foreign key
-- is left dangling.
-- =====================================================================

UPDATE mrv.agents
   SET agent_id     = 'rebeka',
       display_name = 'Rebeka',
       actor_id      = 'agent:rebeka',
       role_prompt   = replace(role_prompt, 'Reveka', 'Rebeka')
 WHERE agent_id = 'reveka';

-- John's own prompt names her too, parenthetically ("Validation (Reveka)").
UPDATE mrv.agents
   SET role_prompt = replace(role_prompt, 'Reveka', 'Rebeka')
 WHERE agent_id = 'john' AND role_prompt LIKE '%Reveka%';

-- migrate:down
UPDATE mrv.agents
   SET role_prompt = replace(role_prompt, 'Rebeka', 'Reveka')
 WHERE agent_id = 'john' AND role_prompt LIKE '%Rebeka%';

UPDATE mrv.agents
   SET agent_id     = 'reveka',
       display_name = 'Reveka',
       actor_id      = 'agent:reveka',
       role_prompt   = replace(role_prompt, 'Rebeka', 'Reveka')
 WHERE agent_id = 'rebeka';
