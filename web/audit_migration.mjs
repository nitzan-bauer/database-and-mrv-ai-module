import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

function envLocal(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = envLocal(".env.local");

let rdsCs = env.DATABASE_URL;
try {
  const u = new URL(rdsCs);
  u.searchParams.delete("sslmode");
  rdsCs = u.toString();
} catch {}

const rds = new Client({ connectionString: rdsCs, ssl: { ca: fs.readFileSync("certs/rds-global-bundle.pem", "utf8"), rejectUnauthorized: true }, connectionTimeoutMillis: 15000 });
const sb = new Client({ connectionString: env.SUPABASE_DB_URL_SESSION, ssl: { rejectUnauthorized: false } });
await rds.connect();
await sb.connect();

async function compareCount(label, sql) {
  const [r, s] = await Promise.all([rds.query(sql), sb.query(sql)]);
  const rn = Number(r.rows[0].n);
  const sn = Number(s.rows[0].n);
  console.log(`${rn === sn ? "OK  " : "DIFF"} ${label}: rds=${rn} supabase=${sn}`);
  return rn === sn;
}

console.log("=== Structural counts, per schema ===");
for (const schema of ["mrv", "crm"]) {
  await compareCount(`${schema} tables`, `SELECT count(*) n FROM information_schema.tables WHERE table_schema='${schema}' AND table_type='BASE TABLE'`);
  await compareCount(`${schema} views`, `SELECT count(*) n FROM information_schema.views WHERE table_schema='${schema}'`);
  await compareCount(`${schema} columns`, `SELECT count(*) n FROM information_schema.columns WHERE table_schema='${schema}'`);
  await compareCount(`${schema} enum types`, `SELECT count(*) n FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace WHERE ns.nspname='${schema}' AND t.typtype='e'`);
  await compareCount(`${schema} functions`, `SELECT count(*) n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='${schema}'`);
  await compareCount(`${schema} triggers`, `SELECT count(*) n FROM information_schema.triggers WHERE trigger_schema='${schema}'`);
  await compareCount(`${schema} indexes`, `SELECT count(*) n FROM pg_indexes WHERE schemaname='${schema}'`);
  await compareCount(`${schema} FK constraints`, `SELECT count(*) n FROM information_schema.table_constraints WHERE constraint_schema='${schema}' AND constraint_type='FOREIGN KEY'`);
  await compareCount(`${schema} CHECK constraints`, `SELECT count(*) n FROM information_schema.table_constraints WHERE constraint_schema='${schema}' AND constraint_type='CHECK'`);
  console.log("");
}

console.log("=== Extension sanity checks ===");
try {
  const r = await sb.query("SELECT ST_AsText(ST_MakePoint(1,2)) AS pt");
  console.log("OK   postgis functional:", r.rows[0].pt);
} catch (e) {
  console.log("FAIL postgis:", e.message);
}
try {
  const r = await sb.query("SELECT 'Farm'::citext = 'farm'::citext AS eq");
  console.log("OK   citext functional (case-insensitive equality):", r.rows[0].eq);
} catch (e) {
  console.log("FAIL citext:", e.message);
}

console.log("\n=== Spot-check real row content (not just counts) ===");
// A row with PostGIS geometry.
const rdsPlot = await rds.query("SELECT plot_id, name, ST_AsText(geom) AS geom_wkt, area_ha, quantification_approach FROM mrv.plots ORDER BY plot_id LIMIT 1");
const sbPlot = await sb.query("SELECT plot_id, name, ST_AsText(geom) AS geom_wkt, area_ha, quantification_approach FROM mrv.plots ORDER BY plot_id LIMIT 1");
console.log("plots[0] rds:     ", JSON.stringify(rdsPlot.rows[0]));
console.log("plots[0] supabase:", JSON.stringify(sbPlot.rows[0]));
console.log(JSON.stringify(rdsPlot.rows[0]) === JSON.stringify(sbPlot.rows[0]) ? "OK   plot row matches exactly" : "DIFF plot row differs");

// A row with jsonb.
const rdsBsl = await rds.query("SELECT bsl_id, similarity_criteria FROM mrv.baseline_control_sites LIMIT 1");
const sbBsl = await sb.query("SELECT bsl_id, similarity_criteria FROM mrv.baseline_control_sites LIMIT 1");
console.log("\nbaseline_control_sites[0] rds:     ", JSON.stringify(rdsBsl.rows[0]));
console.log("baseline_control_sites[0] supabase:", JSON.stringify(sbBsl.rows[0]));
console.log(JSON.stringify(rdsBsl.rows[0]) === JSON.stringify(sbBsl.rows[0]) ? "OK   jsonb row matches exactly" : "DIFF jsonb row differs");

// A generated/computed column — confirm it computed correctly on Supabase, not just copied blank.
const sbSoc = await sb.query("SELECT sample_id, toc_pct FROM mrv.soc_measurements WHERE toc_pct IS NOT NULL LIMIT 1");
const rdsSoc = await rds.query(`SELECT sample_id, toc_pct FROM mrv.soc_measurements WHERE sample_id = $1`, [sbSoc.rows[0]?.sample_id]);
console.log("\nsoc_measurements generated column rds:     ", JSON.stringify(rdsSoc.rows[0]));
console.log("soc_measurements generated column supabase:", JSON.stringify(sbSoc.rows[0]));
console.log(JSON.stringify(rdsSoc.rows[0]) === JSON.stringify(sbSoc.rows[0]) ? "OK   generated column computed identically" : "DIFF generated column differs");

// Enum type usage — confirm a role enum value round-tripped correctly.
const roles = await sb.query("SELECT DISTINCT role FROM mrv.project_memberships ORDER BY role");
console.log("\nmrv.project_memberships distinct roles on supabase:", roles.rows.map((r) => r.role));

console.log("\n=== Confirm RDS untouched (read-only the whole way) ===");
const rdsCheck = await rds.query("SELECT count(*) n FROM mrv.audit_log");
console.log(`rds mrv.audit_log still exactly 3215: ${rdsCheck.rows[0].n === "3215" ? "OK" : "DIFF got " + rdsCheck.rows[0].n}`);

await rds.end();
await sb.end();
