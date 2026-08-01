-- =====================================================================
-- Seed 0002 · Stage 1 — the grouped project and its two DEMO farms
--
-- !! EVERY ROW HERE IS DEMONSTRATION DATA !!
-- Elad Farm and Nitzan-Veg-Tech Farm are not clients. is_demo = true
-- throughout, and migration 0007's triggers keep it that way.
--
-- Imported from the live SaaS API on 2026-07-21:
--   https://app.carbonature.io/api/public/farm-plots?farm=<saas_farm_id>
-- which is what carbonature.io's public farm pages render from, so these
-- polygons are the same ones shown on the marketplace.
--
-- Regenerate with: scripts/import-saas-plots.js
-- Idempotent.
-- =====================================================================

INSERT INTO mrv.organizations (org_id, name, billing_contact, default_region)
SELECT '11111111-1111-1111-1111-111111111111', 'CarboNature', 'nitzan@carbonature.io', 'eu-west-1'
WHERE NOT EXISTS (SELECT 1 FROM mrv.organizations WHERE org_id = '11111111-1111-1111-1111-111111111111');

-- The grouped Verra project both demo farms sit under, mirroring the
-- marketplace heading "CarboNature Farming Project in E.Africa".
INSERT INTO mrv.projects (project_id, org_id, name, methodology, is_grouped, country, status, is_demo)
SELECT 'CARBO-3988-DEMO', '11111111-1111-1111-1111-111111111111',
       'CarboNature Farming Project - E.Africa (DEMO)', 'VM0042 v2.2', true, 'Kenya',
       'under_development', true
WHERE NOT EXISTS (SELECT 1 FROM mrv.projects WHERE project_id = 'CARBO-3988-DEMO');

-- ---------------------------------------------------------------------
-- Nitzan-Veg-Tech Farm (DEMO) — Israel, 5 plots, 223.12 ha
-- ---------------------------------------------------------------------
INSERT INTO mrv.farms (farm_id, project_id, name, installation_code, operator,
                       country, region, climate_zone, irrigation_method, status, is_demo, saas_farm_id)
SELECT '617f7cfb-701e-4760-b13b-7663904be8bf', 'CARBO-3988-DEMO', 'Nitzan-Veg-Tech Farm', 'NVT-DEMO', 'Veg-Tech Ltd',
       'Israel', 'Pardes Hana-Karkur', 'dry'::mrv.climate_zone,
       'drip'::mrv.irrigation_method, 'active', true, '617f7cfb-701e-4760-b13b-7663904be8bf'
WHERE NOT EXISTS (SELECT 1 FROM mrv.farms WHERE farm_id = '617f7cfb-701e-4760-b13b-7663904be8bf');

INSERT INTO mrv.plots (plot_id, farm_id, name, geom, area_ha, application_area_ha,
                       quantification_approach, crop, stroke_color, is_demo, saas_plot_id)
SELECT 'NVT-WP-01', '617f7cfb-701e-4760-b13b-7663904be8bf', 'Imri',
       ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[35.12145947435931,32.99091911921724],[35.12747577276545,32.99071727051917],[35.126573328003985,32.99773124204684],[35.12410664565755,32.99737803378939],[35.12248224508761,32.996520236421006],[35.121579800327225,32.99581380879802],[35.12145947435931,32.99091911921724]]]}')::geometry(Polygon,4326),
       36.07, 36.07, 'QA2', 'cucumber', '#13a4b4', true, '83c2942c-eab6-4ac1-afea-cd5df8150485'
WHERE NOT EXISTS (SELECT 1 FROM mrv.plots WHERE plot_id = 'NVT-WP-01');

INSERT INTO mrv.plots (plot_id, farm_id, name, geom, area_ha, application_area_ha,
                       quantification_approach, crop, stroke_color, is_demo, saas_plot_id)
SELECT 'NVT-WP-02', '617f7cfb-701e-4760-b13b-7663904be8bf', 'Shira',
       ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[35.12121882242238,32.99081819492636],[35.12127898540638,32.98905200115091],[35.118691977092084,32.98920339057332],[35.11141225602077,32.99107050543718],[35.11393910135109,32.999345890359535],[35.118872466043854,32.998387196487286],[35.12151963734331,32.995914727375975],[35.12121882242238,32.99081819492636]]]}')::geometry(Polygon,4326),
       78.89, 78.89, 'QA2', 'Tomatoes', '#e8743b', true, '6465ecd8-7a6b-4faf-97fd-93876c9f0273'
WHERE NOT EXISTS (SELECT 1 FROM mrv.plots WHERE plot_id = 'NVT-WP-02');

INSERT INTO mrv.plots (plot_id, farm_id, name, geom, area_ha, application_area_ha,
                       quantification_approach, crop, stroke_color, is_demo, saas_plot_id)
SELECT 'NVT-WP-03', '617f7cfb-701e-4760-b13b-7663904be8bf', 'Naomi Miriam',
       ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[35.12049688451927,32.98864829819476],[35.11827085410866,32.98254201378448],[35.12296356686565,32.983702744986914],[35.12410666356294,32.98486346092925],[35.12585139010085,32.98501485753542],[35.12759611663867,32.9859232317216],[35.12759611663867,32.98849690782025],[35.12049688451927,32.98864829819476]]]}')::geometry(Polygon,4326),
       36.93, 36.93, 'QA2', 'Wheat', '#3969ac', true, 'a3a5cb5e-6bee-4b84-a520-f958febe2473'
WHERE NOT EXISTS (SELECT 1 FROM mrv.plots WHERE plot_id = 'NVT-WP-03');

INSERT INTO mrv.plots (plot_id, farm_id, name, geom, area_ha, application_area_ha,
                       quantification_approach, crop, stroke_color, is_demo, saas_plot_id)
SELECT 'NVT-WP-04', '617f7cfb-701e-4760-b13b-7663904be8bf', 'Maize 1',
       ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[35.11381607492805,32.99949720112335],[35.10910918699295,33.000542903767425],[35.10639727142686,32.993797903881514],[35.10723890039512,32.99371947061775],[35.106615471530205,32.992098500894215],[35.11135353090884,32.991026552948256],[35.11381607492805,32.99949720112335]]]}')::geometry(Polygon,4326),
       46.56, 46.56, 'QA2', 'Maize', '#3969ac', true, 'd16c0bda-d732-48b7-a9fa-62782ab6992f'
WHERE NOT EXISTS (SELECT 1 FROM mrv.plots WHERE plot_id = 'NVT-WP-04');

INSERT INTO mrv.plots (plot_id, farm_id, name, geom, area_ha, application_area_ha,
                       quantification_approach, crop, stroke_color, is_demo, saas_plot_id)
SELECT 'NVT-WP-05', '617f7cfb-701e-4760-b13b-7663904be8bf', 'Nitzan',
       ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[35.136552280077524,33.00623666694625],[35.136619064371615,33.00116797260641],[35.14159449436434,33.00231615540112],[35.14343106248171,33.004444454717316],[35.142095376577686,33.00612465474916],[35.13935722047552,33.00531256206304],[35.136552280077524,33.00623666694625]]]}')::geometry(Polygon,4326),
       24.67, 24.67, 'QA2', 'sugarcane', '#cf3759', true, '00ade3ff-1bdf-4402-9068-320b94954527'
WHERE NOT EXISTS (SELECT 1 FROM mrv.plots WHERE plot_id = 'NVT-WP-05');

-- ---------------------------------------------------------------------
-- Elad Farm (DEMO) — Kenya, 2 plots, 44.95 ha
-- ---------------------------------------------------------------------
INSERT INTO mrv.farms (farm_id, project_id, name, installation_code, operator,
                       country, region, climate_zone, irrigation_method, status, is_demo, saas_farm_id)
SELECT '8a42abd0-125c-49ad-9077-36b5cd76d86f', 'CARBO-3988-DEMO', 'Elad Farm', 'ELD-DEMO', 'Bouton',
       'Kenya', NULL, 'wet'::mrv.climate_zone,
       'drip'::mrv.irrigation_method, 'active', true, '8a42abd0-125c-49ad-9077-36b5cd76d86f'
WHERE NOT EXISTS (SELECT 1 FROM mrv.farms WHERE farm_id = '8a42abd0-125c-49ad-9077-36b5cd76d86f');

INSERT INTO mrv.plots (plot_id, farm_id, name, geom, area_ha, application_area_ha,
                       quantification_approach, crop, stroke_color, is_demo, saas_plot_id)
SELECT 'ELD-WP-01', '8a42abd0-125c-49ad-9077-36b5cd76d86f', 'tomatoes',
       ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[37.18818524076951,-0.9172516965470408],[37.19047711386426,-0.9164584574327819],[37.19122638006817,-0.9183534172466779],[37.1888463580091,-0.919190724751445],[37.18743597456552,-0.9154008050082041],[37.18615781457086,-0.9160177689604865],[37.186422261467044,-0.9180008666598667],[37.18818524076951,-0.9172516965470408]]]}')::geometry(Polygon,4326),
       2.36, 2.36, 'QA2', 'tomatoes', '#13a4b4', true, '46a076e9-3bbc-4de5-8632-33541463890c'
WHERE NOT EXISTS (SELECT 1 FROM mrv.plots WHERE plot_id = 'ELD-WP-01');

INSERT INTO mrv.plots (plot_id, farm_id, name, geom, area_ha, application_area_ha,
                       quantification_approach, crop, stroke_color, is_demo, saas_plot_id)
SELECT 'ELD-WP-02', '8a42abd0-125c-49ad-9077-36b5cd76d86f', '2 matoes',
       ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[37.20329451848548,-0.9028493520487473],[37.204354352377834,-0.9057208023442627],[37.206644961112005,-0.9046269167857446],[37.20708940758169,-0.9055156988264912],[37.20849112337524,-0.9058575380158231],[37.210508226588985,-0.9034646630178003],[37.20992702735788,-0.903191191489114],[37.20862787613541,-0.9031228236030842],[37.20695265482152,-0.8991916680324579],[37.20096972156094,-0.901687097712383],[37.20124322708131,-0.9027809841575021],[37.20079878061034,-0.9032253754303952],[37.201345791651136,-0.9044218132061133],[37.201790238122044,-0.9045243649967176],[37.202679131063945,-0.9043876292748507],[37.202508190113434,-0.903157007546298],[37.20329451848548,-0.9028493520487473]]]}')::geometry(Polygon,4326),
       42.59, 42.59, 'QA2', 'tomatoe', '#3969ac', true, 'd6a50233-3c9a-4490-96a4-a2f3ab2a3b1b'
WHERE NOT EXISTS (SELECT 1 FROM mrv.plots WHERE plot_id = 'ELD-WP-02');

-- Stored area_ha comes from the SaaS record. Recompute geodesically and
-- warn on drift rather than silently trusting either number.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT plot_id, area_ha, mrv.area_ha(geom) AS computed
    FROM mrv.plots WHERE is_demo
  LOOP
    IF abs(r.area_ha - r.computed) > greatest(0.5, r.area_ha * 0.05) THEN
      RAISE WARNING 'Plot %: stored area %.2f ha vs geometry %.2f ha', r.plot_id, r.area_ha, r.computed;
    END IF;
  END LOOP;
END $$;
