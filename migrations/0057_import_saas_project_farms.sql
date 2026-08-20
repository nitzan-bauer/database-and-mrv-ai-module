-- migrate:up
-- =====================================================================
-- 0057 — Rebeka's tool for bringing a real, already-onboarded SaaS
-- project and its farms into the MRV database.
--
-- Every farm the app has worked with until now was demo data (0002's
-- seed, is_demo=true throughout). The first real pipeline-listing round
-- (CarboNature Farming Project – E.Africa, SaaS external_id '3988')
-- needs its own project row and its own real farms, sourced from the
-- same customer-facing Supabase database 0007's saas_farm_id link was
-- built for — not typed in by hand, and not the demo farms.
--
-- Writes only mrv.projects and mrv.farms. Commits nothing externally
-- (no Verra call, no email) and is idempotent on project_id / saas_farm_id,
-- so re-running it after a SaaS-side edit just refreshes the row rather
-- than duplicating it — the same standing as register_pdd_template.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note)
VALUES ('import_saas_project_farms', 'auto',
        'Creates/updates mrv.projects and mrv.farms rows from the customer-facing SaaS database. No external call; idempotent on saas ids.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = array_append(tools, 'import_saas_project_farms')
 WHERE agent_id = 'rebeka' AND NOT ('import_saas_project_farms' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'import_saas_project_farms')
 WHERE agent_id = 'rebeka';
DELETE FROM mrv.agent_action_policies WHERE action_name = 'import_saas_project_farms';
