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

const tables = await rds.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'mrv' ORDER BY table_name`);

let mismatches = 0;
for (const { table_name } of tables.rows) {
  const [rdsCount, sbCount] = await Promise.all([
    rds.query(`SELECT count(*) FROM mrv.${table_name}`).then((r) => Number(r.rows[0].count)),
    sb.query(`SELECT count(*) FROM mrv.${table_name}`).then((r) => Number(r.rows[0].count)).catch(() => "MISSING TABLE"),
  ]);
  const ok = rdsCount === sbCount;
  if (!ok) mismatches++;
  console.log(`${ok ? "OK  " : "DIFF"} mrv.${table_name}: rds=${rdsCount} supabase=${sbCount}`);
}

await rds.end();
await sb.end();
console.log(`\n${mismatches} mismatch(es) out of ${tables.rows.length} tables.`);
if (mismatches) process.exit(1);
