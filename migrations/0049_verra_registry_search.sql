-- migrate:up
-- =====================================================================
-- 0049 — search_verra_registry (Rebeka).
--
-- research_pdd_precedents (0048) grounded Rebeka in the local corpus
-- because registry.verra.org — a client-rendered app — cannot be read
-- by a plain GET. This migration is what changes that: watching the
-- registry's own network traffic (not guessing) found the real JSON API
-- its UI calls, prod-us.api.platts.com's publicReportPageSearch, and
-- confirmed directly — a bare server-side fetch, zero cookies, zero
-- login — that it answers with real project data given only the site's
-- own public front-end app key and a few static standard-identifying
-- headers. So Rebeka is now genuinely, live connected to Verra's real
-- registry: filterable by methodology (VM0042), and by status, which is
-- how "Rejected by Administrator" / "Registration request denied" VM0042
-- projects are distinguishable from "Registered" ones — real precedent
-- for what not to do, not assumed.
--
-- mrv.verra_registry_snapshot is what a live search accumulates into,
-- and what gives newSinceLastCheck a meaning: an entry seen for the
-- first time this call, not just "in this page of results". This is the
-- foundation of a daily digest; nothing here schedules the daily part
-- yet — that is a separate, later piece.
--
-- 'auto': read-only against Verra's own public API, writing only to a
-- local snapshot table.
-- =====================================================================

CREATE TABLE mrv.verra_registry_snapshot (
  entry_id           text PRIMARY KEY,
  verra_project_id   integer NOT NULL,
  project_name       text NOT NULL,
  status             text NOT NULL,
  methodology_query  text NOT NULL,
  description        text,
  modified_date      timestamptz,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_verra_snapshot_methodology ON mrv.verra_registry_snapshot (methodology_query, status);

COMMENT ON TABLE mrv.verra_registry_snapshot IS
  'Real VM0042 (or whichever methodology was searched) projects pulled live from Verra''s own registry API — not a guess, not a local corpus. first_seen_at is what makes "new since last check" meaningful.';

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('search_verra_registry', 'auto', 'Read-only against Verra''s own public registry API; writes only to a local snapshot table.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['search_verra_registry']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('search_verra_registry' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'search_verra_registry')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'search_verra_registry';

DROP TABLE IF EXISTS mrv.verra_registry_snapshot;
