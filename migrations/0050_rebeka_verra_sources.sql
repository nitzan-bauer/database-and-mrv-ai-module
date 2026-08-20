-- migrate:up
-- =====================================================================
-- 0050 — Rebeka's prompt names her real sources by URL.
--
-- Her prompt already claimed she researches Verra's registry; what was
-- missing was tools that could actually reach it, and a concrete address
-- to reach rather than a guess (an earlier live run watched her guess a
-- wrong verra.org search URL with fetch_public_url and get a 404 — one
-- tool call, no retry, silent stop). Both real addresses below were
-- confirmed directly, not assumed:
--
--   - the VM0042 methodology page (verra.org) is a plain page —
--     fetch_public_url reads it correctly, and it already carries live,
--     current content (a June 2026 Corrections and Clarifications notice
--     was on it the day this was checked).
--   - the registry itself (registry.verra.org) is client-rendered and
--     fetch_public_url cannot read it — but search_verra_registry (0049)
--     now calls the real API behind it directly.
-- =====================================================================

UPDATE mrv.agents
   SET role_prompt = role_prompt || E'\n\nReal sources, not guessed: the VM0042 methodology page is ' ||
     'https://verra.org/methodologies/vm0042-improved-agricultural-land-management-v2-2/ — read it with ' ||
     'fetch_public_url to check for new Corrections and Clarifications. The project registry itself is ' ||
     'client-rendered and fetch_public_url cannot read it; use search_verra_registry instead, which calls ' ||
     'the real registry API directly.'
 WHERE agent_id = 'rebeka';

-- migrate:down
UPDATE mrv.agents
   SET role_prompt = split_part(role_prompt, E'\n\nReal sources, not guessed:', 1)
 WHERE agent_id = 'rebeka';
