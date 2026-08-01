/**
 * Connect to the mrv database and prove the module can actually run on it.
 *
 *   node scripts/db-doctor.mjs
 *
 * Reads DATABASE_URL from the environment or web/.env.local. Checks, in
 * order, the things that can each independently stop the module working —
 * and stops at the first one, because a later failure would only be a
 * consequence of it:
 *
 *   1. the connection opens at all
 *   2. the mrv schema is there and search_path reaches it
 *   3. every migration this build expects has been applied
 *   4. every db-mode query the data layer sends actually runs
 *
 * Step 4 is the point. Those queries are never executed in fixtures mode,
 * so this is the first thing that ever sends them to a real server. It runs
 * them inside a transaction that is always rolled back, so running the
 * doctor cannot change anything.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

/**
 * Same TLS rules as the app (src/lib/dbSsl.ts): verify against the Amazon
 * RDS CA bundle rather than switching verification off, and strip sslmode
 * from the URL so it cannot override that.
 */
const CA = path.join(path.resolve(import.meta.dirname, ".."), "certs", "rds-global-bundle.pem");
function connOpts(raw) {
  let connectionString = raw;
  try { const u = new URL(raw); u.searchParams.delete("sslmode"); connectionString = u.toString(); }
  catch { connectionString = raw.replace(/[?&]sslmode=[^&]*/i, ""); }
  if (!fs.existsSync(CA))
    throw new Error(`Missing ${CA} — fetch it with:  npm run db:certs`);
  return { connectionString, ssl: { ca: fs.readFileSync(CA, "utf8"), rejectUnauthorized: true } };
}

const WEB = path.resolve(import.meta.dirname, "..");

/* ── connection string ───────────────────────────────────────────────── */

function readEnvLocal() {
  const p = path.join(WEB, ".env.local");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...readEnvLocal(), ...process.env };
const url = (env.DATABASE_URL || "").trim();

const ok = (m) => console.log(`  OK   ${m}`);
const bad = (m) => console.log(`  FAIL ${m}`);

if (!url) {
  console.log("No DATABASE_URL.\n");
  console.log("Put the RDS connection string in web/.env.local:\n");
  console.log("  DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/carbonature_mrv\n");
  console.log("Then run this again. Nothing is sent anywhere — it stays on this machine.");
  process.exit(2);
}

// never print the password back
const safe = url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:****@");
console.log(`DATABASE_URL: ${safe}\n`);

/* ── the queries the data layer actually sends ───────────────────────── */

const QUERIES = [
  ["listProjects", `SELECT project_id, name, methodology, is_grouped, country, status, is_demo FROM mrv.projects ORDER BY name`, []],
  ["listFarms", `SELECT f.farm_id, f.project_id, f.name, f.installation_code, f.operator, f.country, f.region, f.climate_zone, f.status, f.is_demo, count(p.plot_id)::int AS plot_count, coalesce(sum(p.area_ha), 0)::float AS total_area_ha FROM mrv.farms f LEFT JOIN mrv.plots p ON p.farm_id = f.farm_id WHERE f.project_id = $1 GROUP BY f.farm_id ORDER BY f.name`, ["CARBO-3988-DEMO"]],
  ["listPlots", `SELECT plot_id, farm_id, name, ST_AsGeoJSON(geom)::json AS geom, area_ha, application_area_ha, quantification_approach, crop, stroke_color, is_demo FROM mrv.plots WHERE farm_id = $1 ORDER BY plot_id`, ["8a42abd0-125c-49ad-9077-36b5cd76d86f"]],
  ["listSamplingPoints", `SELECT sp.point_id, sp.plot_id, sp.bsl_id, sp.scenario, ST_X(sp.planned_geom) AS lon, ST_Y(sp.planned_geom) AS lat, sp.composite_cores, sp.is_revisit, sp.status FROM mrv.sampling_points sp LEFT JOIN mrv.plots p ON p.plot_id = sp.plot_id LEFT JOIN mrv.baseline_control_sites b ON b.bsl_id = sp.bsl_id LEFT JOIN mrv.farms f ON f.farm_id = coalesce(p.farm_id, b.farm_id) WHERE f.project_id = $1`, ["CARBO-3988-DEMO"]],
  ["listPlans", `SELECT c.cycle_id, c.farm_id, f.name AS farm_name, f.project_id, c.cycle_number, c.cycle_type, c.approach, c.collect_texture, c.texture_depth_cm, c.trigger_type, c.depth_scheme, c.planned_start, c.planned_end, c.confidence_alpha, c.power_1_minus_beta, c.mdd_target, c.same_season, c.revisit_points, c.status, c.generated_by, c.approved_at, ( SELECT count(*) FROM mrv.sampling_events ev WHERE ev.cycle_id = c.cycle_id )::int AS planned_points FROM mrv.sampling_cycles c JOIN mrv.farms f ON f.farm_id = c.farm_id WHERE f.project_id = $1 ORDER BY f.name, c.cycle_number`, ["CARBO-3988-DEMO"]],
  ["listWorkOrders", `SELECT w.wo_id, w.farm_id, f.name AS farm_name, w.cycle_id, c.cycle_number, c.cycle_type, c.approach, w.contractor_name, w.contractor_email, w.project_lead, w.window_start, w.window_end, w.depth_scheme, w.state, w.pdf_url, w.issued_at, w.closed_at, l.lab_id, l.name AS lab_name, l.iso_17025, l.napt_member, l.glosolan_member, l.default_method, l.contact AS lab_contact FROM mrv.work_orders w JOIN mrv.farms f ON f.farm_id = w.farm_id JOIN mrv.sampling_cycles c ON c.cycle_id = w.cycle_id LEFT JOIN mrv.labs l ON l.lab_id = w.lab_id WHERE f.project_id = $1 ORDER BY w.created_at DESC`, ["CARBO-3988-DEMO"]],
  ["workOrderPoints", `SELECT s.sample_id, sp.point_id, s.stratum_code, sp.scenario, ST_Y(sp.planned_geom) AS lat, ST_X(sp.planned_geom) AS lon, sp.composite_cores, sp.is_revisit FROM mrv.sampling_events ev JOIN mrv.sampling_points sp ON sp.point_id = ev.point_id LEFT JOIN mrv.samples s ON s.event_id = ev.event_id AND s.sample_type = 'soc' WHERE ev.work_order_id = $1 ORDER BY s.sample_id NULLS LAST, sp.point_id`, ["WO-2026-0042"]],
  ["workOrderToken", `SELECT token_id, work_order_id, contractor_email, issued_at, expires_at, revoked_at, last_used_at FROM mrv.mcp_tokens WHERE work_order_id = $1 ORDER BY issued_at DESC LIMIT 1`, ["WO-2026-0042"]],
  ["plotSamples", `SELECT s.sample_id, e.point_id, s.sample_type, s.stratum_code, s.scenario, s.depth_top_cm, s.depth_base_cm, s.composite_cores, s.barcode, s.sampling_date, e.distance_from_target_m, e.photo_url, e.field_notes FROM mrv.samples s JOIN mrv.sampling_events e ON e.event_id = s.event_id JOIN mrv.sampling_points sp ON sp.point_id = e.point_id WHERE sp.plot_id = $1 ORDER BY s.sample_id`, ["ELD-WP-01"]],
  ["plotSoc", `SELECT m.sample_id, m.method, m.analysis_date, m.depth_top_cm, m.depth_base_cm, m.bulk_density, m.toc_400_pct, m.roc_600_pct, m.tic_900_pct, m.toc_pct, m.soc_t_per_ha, m.soil_mass_t_ha FROM mrv.soc_measurements m JOIN mrv.samples s ON s.sample_id = m.sample_id JOIN mrv.sampling_events e ON e.event_id = s.event_id JOIN mrv.sampling_points sp ON sp.point_id = e.point_id WHERE sp.plot_id = $1 ORDER BY m.sample_id, m.depth_top_cm`, ["ELD-WP-01"]],
  ["plotTexture", `SELECT t.sample_id, t.sand_pct, t.silt_pct, t.clay_pct, t.usda_class, t.depth_cm FROM mrv.texture_measurements t JOIN mrv.samples s ON s.sample_id = t.sample_id JOIN mrv.sampling_events e ON e.event_id = s.event_id JOIN mrv.sampling_points sp ON sp.point_id = e.point_id WHERE sp.plot_id = $1`, ["ELD-WP-01"]],
  ["plotActivities", `SELECT a.activity_id, a.plot_id, a.activity_type, a.rate, a.rate_unit, a.application_area_ha, a.application_date, a.season, a.scenario, a.notes, p.name AS product_name, p.activity_type AS product_activity_type, p.activity_label, p.cost_per_ha_usd, p.credit_per_ha FROM mrv.alm_activities a LEFT JOIN mrv.products p ON p.product_id = a.product_id WHERE a.plot_id = $1 ORDER BY a.application_date NULLS LAST`, ["ELD-WP-01"]],
  ["plotModelRuns", `SELECT run_id, model, model_version, run_type, scenario, status, uncertainty_method, monte_carlo_iters, period_start, period_end FROM mrv.model_runs WHERE farm_id = $1 ORDER BY created_at DESC LIMIT 10`, ["8a42abd0-125c-49ad-9077-36b5cd76d86f"]],
];

/* migrations this build depends on */
const REQUIRED_MIGRATIONS = [
  "0018_min_5_composites",
  "0019_compliance_full_hard_checks",
];

const client = new Client({ ...connOpts(url), connectionTimeoutMillis: 12_000 });

let failed = false;

try {
  console.log("1. connection");
  await client.connect();
  const v = await client.query("SELECT version()");
  ok(v.rows[0].version.split(",")[0]);

  console.log("\n2. schema");
  await client.query("SET search_path TO mrv, public");
  const t = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='mrv' AND table_type='BASE TABLE'`,
  );
  if (t.rows[0].n === 0) {
    bad("the mrv schema has no tables — migrations have not been applied");
    process.exit(1);
  }
  ok(`${t.rows[0].n} tables in schema mrv`);
  for (const ext of ["postgis", "vector"]) {
    const e = await client.query(`SELECT 1 FROM pg_extension WHERE extname=$1`, [ext]);
    e.rowCount ? ok(`extension ${ext}`) : bad(`extension ${ext} missing`);
    if (!e.rowCount) failed = true;
  }

  console.log("\n3. migrations this build expects");
  const applied = await client.query(
    `SELECT version FROM public.schema_migrations`,
  ).catch(() => ({ rows: [] }));
  const have = new Set(applied.rows.map((r) => String(r.version)));
  for (const m of REQUIRED_MIGRATIONS) {
    const num = m.split("_")[0];
    if ([...have].some((v) => v.startsWith(num))) ok(m);
    else {
      bad(`${m} NOT applied — run: dbmate --migrations-dir ./migrations up`);
      failed = true;
    }
  }
  // the thing 0018/0019 actually change
  const fn = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='mrv' AND p.proname='evaluate_compliance' LIMIT 1`,
  );
  if (fn.rowCount) {
    const def = fn.rows[0].def;
    for (const rule of ["MIN_5_COMPOSITES", "SAME_SEASON_WINDOW", "LAB_ACCREDITED", "DRY_COMBUSTION"]) {
      def.includes(rule) ? ok(`compliance rule ${rule}`) : (bad(`compliance rule ${rule} missing`), (failed = true));
    }
  }

  console.log("\n4. every db-mode query the module sends");
  await client.query("BEGIN");
  for (const [name, sql, params] of QUERIES) {
    try {
      const r = await client.query(sql, params);
      ok(`${name.padEnd(20)} ${String(r.rowCount).padStart(4)} rows`);
    } catch (e) {
      bad(`${name.padEnd(20)} ${e.message}`);
      failed = true;
    }
  }
  await client.query("ROLLBACK");

  console.log(
    failed
      ? "\nSome checks failed — see FAIL lines above."
      : "\nAll checks passed. Set MRV_DATA_MODE=db in web/.env.local to run on this database.",
  );
} catch (e) {
  bad(e.message);
  if (/password|authentication/i.test(e.message)) console.log("\n  → check the credentials in DATABASE_URL");
  if (/timeout|ENOTFOUND|EHOSTUNREACH|ECONNREFUSED/i.test(e.message))
    console.log("\n  → the host is unreachable. RDS is usually closed to the internet:\n" +
                "    check the security group allows this machine's IP on 5432.");
  failed = true;
} finally {
  await client.end().catch(() => {});
}

process.exit(failed ? 1 : 0);
