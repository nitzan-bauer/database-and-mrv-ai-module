-- migrate:up
-- =====================================================================
-- 0080 — John's market-scan tables (Nitzan's own spec, attached prompt:
-- "the architecture change to the agents' UI and the MRV app's design
-- line"). Two real-data destinations for the department dashboard's own
-- mockup (a project-issuance list and a deal/price tracker), populated by
-- John's own scheduled tasks (scheduledTaskRegistry.ts), read by the
-- dashboard, never fabricated in either direction.
-- =====================================================================

CREATE TABLE mrv.market_scan_projects (
  scan_project_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry          text NOT NULL,             -- 'Verra' | the real registry name a search actually names
  methodology       text,                      -- 'VM0042' or null for a non-Verra regenerative-ag project
  project_name      text NOT NULL,
  location          text,
  credits_issued_note text,                    -- whatever quantity/date the source itself states — never computed
  source_url        text NOT NULL,
  discovered_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registry, project_name)
);

CREATE INDEX idx_market_scan_projects_discovered ON mrv.market_scan_projects (discovered_at DESC);

COMMENT ON TABLE mrv.market_scan_projects IS
  'VM0042 (any registry) and non-Verra regenerative-agriculture projects that have issued credits, found by john_monthly_vm0042_project_scan via real web search — every row traces to source_url, nothing computed or estimated.';

CREATE TABLE mrv.market_scan_deals (
  scan_deal_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry          text NOT NULL,
  methodology       text,
  project_or_seller text NOT NULL,
  price_note        text NOT NULL,             -- whatever the source states verbatim, e.g. '$11.6/t, 39,207 VCUs'
  brief             text NOT NULL,             -- short coverage summary for the popup
  source_url        text NOT NULL,
  discovered_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registry, project_or_seller, price_note)
);

CREATE INDEX idx_market_scan_deals_discovered ON mrv.market_scan_deals (discovered_at DESC);

COMMENT ON TABLE mrv.market_scan_deals IS
  'VM0042 and non-Verra regenerative-agriculture credit deals/prices, found by john_monthly_credit_market_scan via real web search — the department dashboard''s market tracker card reads this.';

-- next_run_at = now() on the project scan doubles as the spec's own
-- "initial and immediate review" — the very next cron tick runs it for
-- real, the same pattern 0075 used for Rebeka's first 5 tasks.
INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, day_of_week, next_run_at)
VALUES
  ('john', 'john_monthly_vm0042_project_scan',
   'Monthly VM0042 project scan: Verra registry + open web -> issuing projects',
   'monthly', NULL, now()),
  ('john', 'john_monthly_credit_market_scan',
   'Monthly credit market scan: VM0042 + non-Verra regen-ag deals and prices',
   'monthly', NULL, now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key IN (
  'john_monthly_vm0042_project_scan',
  'john_monthly_credit_market_scan'
);
DROP TABLE IF EXISTS mrv.market_scan_deals;
DROP TABLE IF EXISTS mrv.market_scan_projects;
