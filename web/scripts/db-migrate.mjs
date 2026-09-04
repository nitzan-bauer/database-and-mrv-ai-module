/**
 * Apply pending migrations, without needing dbmate or psql installed.
 *
 *   node scripts/db-migrate.mjs            # show what would run
 *   node scripts/db-migrate.mjs --apply    # run it
 *
 * dbmate remains the supported tool; this exists so a machine that has
 * neither it nor psql can still bring the database up to the build. It is
 * deliberately conservative:
 *
 *   - it reads schema_migrations first and INFERS the version convention
 *     from the rows already there, rather than assuming one. A wrong guess
 *     would re-apply a migration that is already in place.
 *   - it refuses to run if it cannot recognise that convention.
 *   - each migration runs inside its own transaction with its
 *     schema_migrations row, so a failure leaves nothing half-applied.
 *   - only the `-- migrate:up` half is executed, never the down.
 *   - it prints the plan and does nothing at all without --apply.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

/**
 * Same TLS rules as the app (src/lib/dbSsl.ts): verify against a CA bundle
 * rather than switching verification off, and strip sslmode from the URL
 * so it cannot override that. Both the RDS and Supabase bundles are
 * combined (src/lib/dbSsl.ts's own combinedBundle()) so this verifies
 * correctly whichever of the two databases DATABASE_URL currently points
 * at, post-Addendum-1 cutover — this script predates that cutover and
 * only ever trusted RDS's CA until now.
 */
const CERTS_DIR = path.join(path.resolve(import.meta.dirname, ".."), "certs");
const RDS_CA = path.join(CERTS_DIR, "rds-global-bundle.pem");
const SUPABASE_CA = path.join(CERTS_DIR, "supabase-ca-bundle.pem");
function combinedCa() {
  const parts = [];
  if (fs.existsSync(RDS_CA)) parts.push(fs.readFileSync(RDS_CA, "utf8"));
  if (fs.existsSync(SUPABASE_CA)) parts.push(fs.readFileSync(SUPABASE_CA, "utf8"));
  if (!parts.length) throw new Error(`Missing ${RDS_CA} and ${SUPABASE_CA} — fetch them with:  npm run db:certs`);
  return parts.join("\n");
}
function connOpts(raw) {
  let connectionString = raw;
  try { const u = new URL(raw); u.searchParams.delete("sslmode"); connectionString = u.toString(); }
  catch { connectionString = raw.replace(/[?&]sslmode=[^&]*/i, ""); }
  return { connectionString, ssl: { ca: combinedCa(), rejectUnauthorized: true } };
}

const WEB = path.resolve(import.meta.dirname, "..");
const MIGRATIONS = path.resolve(WEB, "..", "migrations");
const APPLY = process.argv.includes("--apply");

function envLocal() {
  const p = path.join(WEB, ".env.local");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...envLocal(), ...process.env };
const url = (env.DATABASE_URL || "").trim();
if (!url) {
  console.error("No DATABASE_URL. Run:  npm run db:link");
  process.exit(2);
}

/** "0019_compliance_full_hard_checks.sql" -> { version: "0019", name } */
const files = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort()
  .map((f) => ({ file: f, version: f.match(/^(\d+)_/)[1], name: f.replace(/\.sql$/, "") }));

const client = new Client({ ...connOpts(url), connectionTimeoutMillis: 12_000 });

try {
  await client.connect();

  const existing = await client
    .query("SELECT version FROM public.schema_migrations ORDER BY version")
    .catch(() => null);

  if (!existing) {
    console.error(
      "public.schema_migrations does not exist — this database has never been migrated.\n" +
        "Bring it up with dbmate rather than this script, which is only for topping up.",
    );
    process.exit(1);
  }

  const applied = new Set(existing.rows.map((r) => String(r.version)));

  // Infer the convention: every recorded version should match a file's
  // numeric prefix. If they do not, this script is not safe to run.
  const known = new Set(files.map((f) => f.version));
  const unrecognised = [...applied].filter((v) => !known.has(v));
  if (unrecognised.length) {
    console.error(
      `schema_migrations holds versions this script does not recognise: ${unrecognised.join(", ")}\n` +
        "The version convention differs from the file prefixes — use dbmate instead.",
    );
    process.exit(1);
  }

  const pending = files.filter((f) => !applied.has(f.version));

  console.log(`applied : ${applied.size}`);
  console.log(`pending : ${pending.length}`);
  if (!pending.length) {
    console.log("\nNothing to do — the database matches the migrations directory.");
    process.exit(0);
  }
  for (const p of pending) console.log(`  - ${p.name}`);

  if (!APPLY) {
    console.log("\nThis was a dry run. To apply:  node scripts/db-migrate.mjs --apply");
    process.exit(0);
  }

  console.log("");
  for (const p of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, p.file), "utf8");
    const up = sql.split(/^--\s*migrate:down\s*$/m)[0].replace(/^--\s*migrate:up\s*$/m, "");
    if (!/\S/.test(up)) {
      console.error(`  ${p.name}: no migrate:up section — stopping.`);
      process.exit(1);
    }
    const started = Date.now();
    try {
      await client.query("BEGIN");
      await client.query(up);
      await client.query("INSERT INTO public.schema_migrations (version) VALUES ($1)", [p.version]);
      await client.query("COMMIT");
      console.log(`  applied ${p.name}  (${Date.now() - started} ms)`);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`  FAILED  ${p.name}\n          ${e.message}`);
      console.error("\n  Rolled back. Nothing from this migration was kept.");
      process.exit(1);
    }
  }
  console.log("\nDone. Verify with:  npm run db:doctor");
} catch (e) {
  console.error(e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
