-- migrate:up
-- =====================================================================
-- 0081 — Nitzan's own UI feedback on the live dashboard: the project
-- card's title should lead with the name of the company that issued the
-- credits (matching the Cowork mockup's "Agreena — EU/UK" convention),
-- not the abstract project name. That's a real field the extraction
-- prompt has to be asked for explicitly, not derived after the fact.
-- =====================================================================

ALTER TABLE mrv.market_scan_projects ADD COLUMN issuer_name text;

COMMENT ON COLUMN mrv.market_scan_projects.issuer_name IS
  'The company/entity the source names as having issued or developed the credits (e.g. "Boomitra", "Agreena") — never derived from project_name, only what john_monthly_vm0042_project_scan''s extraction actually asked for and found.';

-- migrate:down
ALTER TABLE mrv.market_scan_projects DROP COLUMN IF EXISTS issuer_name;
