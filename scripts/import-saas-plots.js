const fs = require('fs');
const q = s => s === null || s === undefined ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'";

const FARMS = [
  { key:'nitzan', code:'NVT', name:'Nitzan-Veg-Tech Farm', operator:'Veg-Tech Ltd',
    country:'Israel', region:'Pardes Hana-Karkur', climate:'dry',
    saasId:'617f7cfb-701e-4760-b13b-7663904be8bf' },
  { key:'elad', code:'ELD', name:'Elad Farm', operator:'Bouton',
    country:'Kenya', region:null, climate:'wet',
    saasId:'8a42abd0-125c-49ad-9077-36b5cd76d86f' },
];

let out = `-- =====================================================================
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
`;

for (const f of FARMS) {
  const data = JSON.parse(fs.readFileSync(`plots_${f.key}.json`, 'utf8'));
  const plots = data.plots || [];
  const total = plots.reduce((s, p) => s + (p.area_ha || 0), 0);

  out += `
-- ---------------------------------------------------------------------
-- ${f.name} (DEMO) — ${f.country}, ${plots.length} plots, ${total.toFixed(2)} ha
-- ---------------------------------------------------------------------
INSERT INTO mrv.farms (farm_id, project_id, name, installation_code, operator,
                       country, region, climate_zone, status, is_demo, saas_farm_id)
SELECT '${f.saasId}', 'CARBO-3988-DEMO', ${q(f.name)}, ${q(f.code + '-DEMO')}, ${q(f.operator)},
       ${q(f.country)}, ${q(f.region)}, ${q(f.climate)}::mrv.climate_zone, 'active', true, '${f.saasId}'
WHERE NOT EXISTS (SELECT 1 FROM mrv.farms WHERE farm_id = '${f.saasId}');
`;

  plots.forEach((p, i) => {
    const plotId = `${f.code}-WP-${String(i + 1).padStart(2, '0')}`;
    const name = (p.name || '').trim();
    // QA2 (measure & remeasure) is the working assumption for demo data;
    // the real approach is set per plot when a project is registered.
    out += `
INSERT INTO mrv.plots (plot_id, farm_id, name, geom, area_ha, application_area_ha,
                       quantification_approach, crop, stroke_color, is_demo, saas_plot_id)
SELECT ${q(plotId)}, '${f.saasId}', ${q(name)},
       ST_GeomFromGeoJSON(${q(JSON.stringify(p.geometry))})::geometry(Polygon,4326),
       ${p.area_ha}, ${p.area_ha}, 'QA2', ${q(p.crop || null)}, ${q(p.color || null)}, true, ${q(p.id)}
WHERE NOT EXISTS (SELECT 1 FROM mrv.plots WHERE plot_id = ${q(plotId)});
`;
  });
}

out += `
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
`;

fs.writeFileSync('C:/Users/nitza/OneDrive/Desktop/claude code/database-and-mrv-ai-module/seeds/0002_demo_farms.sql', out);
console.log('written, ' + out.split('\n').length + ' lines');
