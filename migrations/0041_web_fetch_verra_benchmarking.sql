-- migrate:up
-- =====================================================================
-- 0041 — fetch_public_url, and John's fourth skill: verra_benchmarking.
--
-- Verra's registry is public domain — no API key or account needed to
-- browse a project or read a methodology update (confirmed directly).
-- What was actually missing was never access; it was a tool that
-- fetches real content rather than a model recalling — or guessing —
-- what a page probably says. fetch_public_url is that tool: a plain
-- https GET against a public URL, real text back, nothing invented.
--
-- Rebeka's pdd_generator skill already claims, in her own role prompt,
-- to "research every issued PDD in the category on the Verra registry"
-- — a claim generatePddDraft.ts never actually carried out, since no
-- tool existed to do the fetching. She gets fetch_public_url here so
-- that claim can become genuinely true rather than staying aspirational.
--
-- John's verra_benchmarking moves from planned to built on the same
-- basis: benchmarking against comparable VM0042/ALM projects is real
-- work over real fetched registry pages, not a deterministic
-- computation — the same standing pdd_generator itself already has as
-- a "skill" built from a tool plus the model's own reasoning over real
-- inputs.
--
-- 'auto': read-only, reaches the public internet rather than an
-- internal system, commits nothing.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('fetch_public_url', 'auto', 'Read-only fetch of a public URL; commits nothing externally.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['fetch_public_url']::text[]
 WHERE agent_id IN ('rebeka', 'john')
   AND NOT ('fetch_public_url' = ANY (tools));

UPDATE mrv.agents
   SET skills = skills || ARRAY['verra_benchmarking']::text[],
       planned_skills = array_remove(planned_skills, 'verra_benchmarking')
 WHERE agent_id = 'john'
   AND NOT ('verra_benchmarking' = ANY (skills));

-- migrate:down
UPDATE mrv.agents
   SET skills = array_remove(skills, 'verra_benchmarking'),
       planned_skills = planned_skills || ARRAY['verra_benchmarking']::text[]
 WHERE agent_id = 'john';

UPDATE mrv.agents
   SET tools = array_remove(tools, 'fetch_public_url')
 WHERE agent_id IN ('rebeka', 'john');

DELETE FROM mrv.agent_action_policies WHERE action_name = 'fetch_public_url';
