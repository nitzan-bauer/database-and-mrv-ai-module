// One-time reconciliation: production's Vercel DATABASE_URL was never
// actually cut over to Supabase (discovered 2026-09-05) — real production
// traffic (the daily cron, real logins) kept writing to the old RDS
// instance for days after the local/manual cutover on 2026-09-02. This
// replays whatever exists in RDS but not yet in Supabase for the handful
// of tables that saw real post-cutover activity, using ON CONFLICT (pk)
// DO NOTHING so it is safe to re-run and never touches a row that already
// made it across in the original bulk copy.
import fs from "fs";
import pg from "pg";
const { Pool } = pg;

const env = {};
fs.readFileSync(new URL("./.env.local", import.meta.url), "utf8")
  .split(/\r?\n/)
  .forEach((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });

const rdsCa = fs.readFileSync(new URL("./certs/rds-global-bundle.pem", import.meta.url), "utf8");
const rdsUrl = new URL(env.RDS_DATABASE_URL_ROLLBACK);
rdsUrl.search = "";
const rds = new Pool({ connectionString: rdsUrl.toString(), ssl: { ca: rdsCa, rejectUnauthorized: true }, max: 3 });

const supaCa = fs.readFileSync(new URL("./certs/supabase-ca-bundle.pem", import.meta.url), "utf8");
const supa = new Pool({ connectionString: env.DATABASE_URL, ssl: { ca: supaCa, rejectUnauthorized: true }, max: 3 });

const TABLES = [
  { name: "agent_memory", pk: "memory_id", cols: ["memory_id", "project_id", "farm_id", "kind", "content", "embedding", "metadata", "created_by", "created_at"] },
  { name: "project_memberships", pk: "membership_id", cols: ["membership_id", "user_id", "project_id", "role", "granted_by", "granted_at"] },
  { name: "work_orders", pk: "wo_id", cols: ["wo_id", "farm_id", "cycle_id", "contractor_name", "contractor_email", "lab_id", "project_lead", "window_start", "window_end", "depth_scheme", "state", "pdf_url", "issued_by", "issued_at", "closed_at", "created_at", "updated_at"] },
  { name: "mcp_tokens", pk: "token_id", cols: ["token_id", "work_order_id", "token_hash", "contractor_email", "issued_by", "issued_at", "expires_at", "revoked_at", "revoked_by", "last_used_at"] },
];

function serialize(v) {
  if (v !== null && typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// audit_log's PK (audit_id) is a Supabase-side GENERATED ALWAYS identity —
// RDS's original values can't be reinserted and wouldn't mean anything
// against Supabase's own independently-advanced sequence anyway. Dedupe
// on the event's real identity instead: (actor, action, target_type,
// target_id, ts) — a row already present under that natural key (from the
// original bulk copy, or from this session's own local testing against
// Supabase) is skipped; a genuinely RDS-only event is inserted fresh.
async function replayAuditLog() {
  const cols = ["actor", "actor_role", "action", "target_type", "target_id", "payload", "session_id", "ts"];
  const casts = { actor: "text", actor_role: "mrv.app_role", action: "text", target_type: "text", target_id: "text", payload: "jsonb", session_id: "uuid", ts: "timestamptz" };
  const { rows } = await rds.query(`SELECT ${cols.join(",")} FROM mrv.audit_log`);
  let inserted = 0;
  for (const batch of chunk(rows, 200)) {
    if (!batch.length) continue;
    const values = [];
    const placeholders = batch
      .map((row, i) => {
        const base = i * cols.length;
        for (const c of cols) values.push(serialize(row[c]));
        return "(" + cols.map((c, j) => `$${base + j + 1}::${casts[c]}`).join(",") + ")";
      })
      .join(",");
    const sql = `
      INSERT INTO mrv.audit_log (${cols.join(",")})
      SELECT * FROM (VALUES ${placeholders}) AS v(${cols.join(",")})
      WHERE NOT EXISTS (
        SELECT 1 FROM mrv.audit_log a
         WHERE a.actor = v.actor AND a.action = v.action
           AND a.target_type = v.target_type AND a.target_id = v.target_id
           AND a.ts = v.ts::timestamptz
      )`;
    const res = await supa.query(sql, values);
    inserted += res.rowCount;
  }
  console.log(`audit_log: RDS has ${rows.length} rows, newly inserted into Supabase: ${inserted}`);
}

async function main() {
  await replayAuditLog();
  for (const t of TABLES) {
    const { rows } = await rds.query(`SELECT ${t.cols.join(",")} FROM mrv.${t.name}`);
    let inserted = 0;
    for (const batch of chunk(rows, 200)) {
      if (!batch.length) continue;
      const values = [];
      const placeholders = batch
        .map((row, i) => {
          const base = i * t.cols.length;
          for (const c of t.cols) values.push(serialize(row[c]));
          return "(" + t.cols.map((_, j) => `$${base + j + 1}`).join(",") + ")";
        })
        .join(",");
      const sql = `INSERT INTO mrv.${t.name} (${t.cols.join(",")}) VALUES ${placeholders} ON CONFLICT (${t.pk}) DO NOTHING`;
      const res = await supa.query(sql, values);
      inserted += res.rowCount;
    }
    console.log(`${t.name}: RDS has ${rows.length} rows, newly inserted into Supabase: ${inserted}`);
  }
  await rds.end();
  await supa.end();
}

main().catch((e) => {
  console.error("REPLAY FAILED:", e.message);
  process.exit(1);
});
