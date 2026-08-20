-- migrate:up
-- =====================================================================
-- 0064 — Move the CCP/DayCent/DNDC line from Rebeka's prompt to Dave's.
--
-- Nitzan's own instruction, live: those lines describe running and
-- defending real GHG models (DayCent v6.x, DNDC v9.x) and the ICVCM CCP
-- label's monitoring-technique condition — Dave already owns every one
-- of those by name (his own prompt lists DNDC, DayCent, the GHG
-- Calculator, and dry-combustion SOC enforcement as his skills). Rebeka
-- writes the PDD; she does not run or defend the models that feed it.
-- Leaving the line on both agents invited exactly the kind of scope
-- confusion this fixes.
-- =====================================================================

UPDATE mrv.agents
   SET role_prompt = replace(
     role_prompt,
     E'Ensure the monitoring plan meets the CCP condition — SOC by any permitted technique EXCEPT DSM. Build the PDD-level infrastructure for the DayCent / DNDC models and for the ICVCM CCP label.\n\n',
     ''
   )
 WHERE agent_id = 'rebeka';

UPDATE mrv.agents
   SET role_prompt = role_prompt ||
     E'\n\nEnsure the monitoring plan and every model run meet the ICVCM CCP condition — SOC measured by any ' ||
     'permitted technique except DSM — and that the project qualifies for the ICVCM CCP label.'
 WHERE agent_id = 'dave';

-- migrate:down
UPDATE mrv.agents
   SET role_prompt = role_prompt ||
     E'\n\nEnsure the monitoring plan meets the CCP condition — SOC by any permitted technique EXCEPT DSM. Build the PDD-level infrastructure for the DayCent / DNDC models and for the ICVCM CCP label.'
 WHERE agent_id = 'rebeka';

UPDATE mrv.agents
   SET role_prompt = split_part(role_prompt, E'\n\nEnsure the monitoring plan and every model run meet the ICVCM CCP condition', 1)
 WHERE agent_id = 'dave';
