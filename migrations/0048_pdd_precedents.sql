-- migrate:up
-- =====================================================================
-- 0048 — research_pdd_precedents (Rebeka).
--
-- The pdd_generator skill's own text claims Rebeka "research[es] every
-- issued PDD in the category on the Verra registry, anchor[s] the draft
-- to the closest projects" — but the only tool she held for reaching
-- Verra was fetch_public_url, a single raw HTTPS GET. That works against
-- verra.org's plain marketing pages; it cannot work against
-- registry.verra.org, which is a client-rendered React app — a GET
-- there returns an empty shell, not project data, no matter how correct
-- the URL. Confirmed directly by loading it and watching the network
-- panel, not assumed.
--
-- So this grounds the research claim in what is actually real today:
-- Nitzan has already been downloading issued VM0042 PDDs by hand into
-- one folder (PDD_PRECEDENTS_DIR). This table is the extracted, indexed
-- text of that real corpus — searchable precedent, not a registry
-- crawl. A real-time Verra registry crawler is a distinct, larger piece
-- of infrastructure (this app has no headless-browser capability at
-- all) and is tracked separately rather than pretended into this tool.
--
-- 'auto': read-only research plus indexing a folder Nitzan already
-- curated by hand — nothing external, nothing a manager needs to
-- approve per call.
-- =====================================================================

CREATE TABLE mrv.pdd_precedents (
  precedent_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name         text NOT NULL UNIQUE,
  verra_project_id  text,
  extracted_text    text NOT NULL,
  char_count        integer NOT NULL,
  file_sha256       text NOT NULL,
  indexed_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mrv.pdd_precedents IS
  'Extracted text of real, issued VM0042 PDDs Nitzan has downloaded by hand — the precedent corpus research_pdd_precedents searches, not a live Verra registry crawl (registry.verra.org is a client-rendered app a raw fetch cannot read).';

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('research_pdd_precedents', 'auto', 'Read-only search over a locally indexed, already-curated PDD corpus.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['research_pdd_precedents']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('research_pdd_precedents' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'research_pdd_precedents')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'research_pdd_precedents';

DROP TABLE IF EXISTS mrv.pdd_precedents;
