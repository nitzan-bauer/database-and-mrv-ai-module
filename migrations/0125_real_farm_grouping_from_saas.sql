-- migrate:up
-- =====================================================================
-- 0125 — Nitzan (chat, 2026-09-12): real farm-to-project grouping,
-- sourced from the DB/SaaS itself, not from screenshots. Nitzan's own
-- correction mid-task: the Marketplace screenshots he sent were "for
-- illustration only — pull the real grouping architecture from the DB
-- or the SaaS." Re-derived directly against the real, live data (one
-- physical database, mrv + public schemas, per the earlier SaaS-DB
-- unification work):
--
--   SELECT f.farm_name, pl.project_id, pr.name, pr.external_id
--   FROM public.farms f
--   LEFT JOIN public.plots pl ON pl.farm_id = f.id
--   LEFT JOIN public.projects pr ON pr.id = pl.project_id;
--
-- Real result: "beauty dan flower ltd", "credible blooms vegetables",
-- "elad", and "Nitzan-Veg-Tech" all have real plots under SaaS project
-- 1d006d6a-909b-458c-83c3-f3937901301f ("CarboNature Farming Project –
-- E.Africa") — which mrv.projects.saas_project_id already links to
-- CARBO-3988 today. "credible blooms avocado" (farm eb166215-f5c9-
-- 440f-a6ad-5370032e90f7, real SaaS row: Kenya, Rumuruti/Laikipia
-- County, company "credible blooms limited", plot "Avocado" 63.3 Ha,
-- confirmed live) has its one real plot under SaaS project
-- c3511171-27c0-4c31-85f2-ea5cede8f355 ("CarboNature Fruit-Plantations
-- Project – E.Africa") — which had no mrv.projects.saas_project_id link
-- yet; this migration adds it, onto the real CARBO-FRUIT-1 row created
-- in 0115. (Both SaaS projects happen to share the display external_id
-- "3988" — a SaaS-side labeling quirk, not evidence of one project;
-- their real distinct identity is the project uuid, matched above.)
--
-- Second real finding while resolving the demo/project-grouping
-- discrepancy this reveals: mrv.farms.saas_farm_id is *the same uuid*
-- as mrv.farms.farm_id for every existing row (the "same id" identity
-- design from the SaaS-DB unification work) — so "Elad Farm" and
-- "Nitzan-Veg-Tech Farm" are not placeholder/demo rows at all; they are
-- real SaaS farms (real profile_id, real company, real plots, real
-- crops) that were mis-flagged is_demo=true in mrv when first created,
-- before the saas_farm_id link existed. Confirms further: their own
-- mrv.activity_data already carries is_demo=false (Elad Farm's 2021
-- BSL row) — the "demo" flag on the farm row was already stale/unused
-- in practice, not a deliberate real/demo distinction. This migration
-- corrects that stale flag using the real SaaS linkage as evidence,
-- not a guess — and only then reassigns project_id, since
-- mrv.check_demo_consistency() (trg_farms_demo_chk) correctly refuses
-- a demo-flagged farm under CARBO-3988 (is_demo=false) otherwise.
-- mrv.plots rows for both farms are corrected the same way, for the
-- same reason (mrv.check_demo_consistency() also gates plots against
-- their farm's is_demo).
--
-- CARBO-3988-DEMO itself is left untouched and NOT deleted: 96
-- pdd_section_status rows, 9 pdd_drafts, vvb_findings and others are
-- still real project_id='CARBO-3988-DEMO' references (found earlier
-- this session) — moving the farms does not touch any of them.
--
-- Credible Blooms Avocado Farm is inserted with farm_id/saas_farm_id
-- BOTH set to eb166215-f5c9-440f-a6ad-5370032e90f7 — the real SaaS
-- farm's own id, matching the "same id" pattern every other real farm
-- row already uses, not a freshly generated uuid. No mrv.plots row yet
-- — that needs a real PostGIS polygon this session has no source for,
-- matching exactly how beauty dan flower ltd's and credible blooms
-- vegetables' own mrv.farms rows started (a real farm, zero plots
-- recorded, until quantification data is actually gathered).
-- =====================================================================

UPDATE mrv.projects SET saas_project_id = 'c3511171-27c0-4c31-85f2-ea5cede8f355'
 WHERE project_id = 'CARBO-FRUIT-1';

UPDATE mrv.farms SET is_demo = false
 WHERE farm_id IN ('8a42abd0-125c-49ad-9077-36b5cd76d86f', '617f7cfb-701e-4760-b13b-7663904be8bf');

UPDATE mrv.plots SET is_demo = false
 WHERE farm_id IN ('8a42abd0-125c-49ad-9077-36b5cd76d86f', '617f7cfb-701e-4760-b13b-7663904be8bf');

UPDATE mrv.farms SET project_id = 'CARBO-3988'
 WHERE farm_id IN ('8a42abd0-125c-49ad-9077-36b5cd76d86f', '617f7cfb-701e-4760-b13b-7663904be8bf');

INSERT INTO mrv.farms (farm_id, saas_farm_id, project_id, name, country, region, is_demo)
VALUES (
  'eb166215-f5c9-440f-a6ad-5370032e90f7',
  'eb166215-f5c9-440f-a6ad-5370032e90f7',
  'CARBO-FRUIT-1',
  'Credible Blooms Avocado Farm',
  'Kenya',
  'Rumuruti, Laikipia County',
  false
);

-- migrate:down
DELETE FROM mrv.farms WHERE farm_id = 'eb166215-f5c9-440f-a6ad-5370032e90f7';

UPDATE mrv.farms SET project_id = 'CARBO-3988-DEMO'
 WHERE farm_id IN ('8a42abd0-125c-49ad-9077-36b5cd76d86f', '617f7cfb-701e-4760-b13b-7663904be8bf');

UPDATE mrv.farms SET is_demo = true
 WHERE farm_id IN ('8a42abd0-125c-49ad-9077-36b5cd76d86f', '617f7cfb-701e-4760-b13b-7663904be8bf');

UPDATE mrv.plots SET is_demo = true
 WHERE farm_id IN ('8a42abd0-125c-49ad-9077-36b5cd76d86f', '617f7cfb-701e-4760-b13b-7663904be8bf');

UPDATE mrv.projects SET saas_project_id = NULL
 WHERE project_id = 'CARBO-FRUIT-1';
