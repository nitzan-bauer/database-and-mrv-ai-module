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

function extractUp(sql) {
  const upIdx = sql.indexOf("-- migrate:up");
  const downIdx = sql.indexOf("-- migrate:down");
  if (upIdx === -1) return null; // not a dbmate-style file
  const start = upIdx + "-- migrate:up".length;
  const end = downIdx === -1 ? sql.length : downIdx;
  return sql.slice(start, end).trim();
}

const FROM_FILE = process.argv[2]; // e.g. "0060" — resume from this file, skipping earlier ones already applied
const dir = "../migrations";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().filter((f) => !FROM_FILE || f.slice(0, 4) >= FROM_FILE);

const client = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const results = [];
for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  const up = extractUp(sql);
  if (!up) {
    results.push({ file, status: "skipped (no migrate:up marker)" });
    continue;
  }
  try {
    await client.query("BEGIN");
    await client.query(up);
    await client.query("COMMIT");
    results.push({ file, status: "ok" });
    console.log(`OK   ${file}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    results.push({ file, status: `FAILED: ${e.message}` });
    console.error(`FAIL ${file}: ${e.message}`);
    break; // stop at first failure so we know exactly where we are
  }
}

await client.end();
console.log("\n--- summary ---");
for (const r of results) console.log(r.status.startsWith("ok") || r.status.startsWith("skipped") ? `${r.file}: ${r.status}` : `${r.file}: ${r.status}`);
const failed = results.find((r) => r.status.startsWith("FAILED"));
if (failed) process.exit(1);
