import fs from "node:fs";
import path from "node:path";
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

// Copy data for tables created up to (and including) this migration file —
// determines dependency order. Default: every table that exists so far.
const UPTO_FILE = process.argv[2] || "9999";
const dir = "../migrations";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().filter((f) => f.slice(0, 4) <= UPTO_FILE);

const tableOrder = [];
const seen = new Set();
for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  const upIdx = sql.indexOf("-- migrate:up");
  const downIdx = sql.indexOf("-- migrate:down");
  const up = upIdx === -1 ? sql : sql.slice(upIdx, downIdx === -1 ? sql.length : downIdx);
  const re = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?mrv\.([a-z_]+)/gi;
  let m;
  while ((m = re.exec(up))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      tableOrder.push(m[1]);
    }
  }
}

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

console.log(`Copying data for ${tableOrder.length} tables, columns limited to what currently exists on the Supabase side.\n`);

const summary = [];
for (const table of tableOrder) {
  const colRows = await sb.query(
    `SELECT column_name, data_type, is_identity, is_generated FROM information_schema.columns WHERE table_schema = 'mrv' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  if (!colRows.rows.length) {
    summary.push({ table, status: "skipped (table not in target schema)" });
    continue;
  }
  // Generated/computed columns (GENERATED ALWAYS AS (...) STORED) can never
  // be written to directly — Postgres always computes them itself.
  const targetCols = new Map(colRows.rows.filter((r) => r.is_generated !== "ALWAYS").map((r) => [r.column_name, r]));

  let rows;
  try {
    rows = await rds.query(`SELECT * FROM mrv.${table}`);
  } catch (e) {
    summary.push({ table, status: `skip — source read failed: ${e.message}` });
    continue;
  }
  if (!rows.rows.length) {
    summary.push({ table, status: "0 rows (nothing to copy)" });
    continue;
  }

  // Only columns that exist on BOTH sides right now — a column the schema
  // replay hasn't added yet (a later migration's ALTER TABLE) is dropped
  // rather than failing the whole table.
  const cols = rows.fields.map((f) => f.name).filter((c) => targetCols.has(c));
  const hasIdentity = cols.some((c) => targetCols.get(c).is_identity === "YES");
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const jsonCols = new Set(cols.filter((c) => ["json", "jsonb"].includes(targetCols.get(c).data_type)));

  let copied = 0;
  let failed = 0;
  for (const row of rows.rows) {
    const values = cols.map((c) => {
      const v = row[c];
      if (v !== null && jsonCols.has(c) && typeof v === "object") return JSON.stringify(v);
      return v;
    });
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const overriding = hasIdentity ? "OVERRIDING SYSTEM VALUE " : "";
    try {
      await sb.query(`INSERT INTO mrv.${table} (${colList}) ${overriding}VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
      copied++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.error(`  ${table}: row insert failed — ${e.message}`);
    }
  }
  summary.push({ table, status: `${copied}/${rows.rows.length} copied${failed ? `, ${failed} FAILED` : ""}` });
  console.log(`${table}: ${copied}/${rows.rows.length} copied${failed ? `, ${failed} FAILED` : ""}`);
}

await rds.end();
await sb.end();

console.log("\n--- summary ---");
for (const s of summary) console.log(`${s.table}: ${s.status}`);
const anyFail = summary.some((s) => s.status.includes("FAILED"));
if (anyFail) process.exit(1);
