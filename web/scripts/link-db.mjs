/**
 * Write DATABASE_URL into web/.env.local, straight from Terraform.
 *
 *   node scripts/link-db.mjs
 *
 * The connection string contains the master password, so it is never
 * printed: it goes from `terraform output -raw database_url` into the
 * git-ignored .env.local and nowhere else. What this does print is the host,
 * database and user — enough to confirm it wrote the right thing.
 *
 * Existing keys in .env.local are preserved; only DATABASE_URL and
 * MRV_DATA_MODE are touched. A previous DATABASE_URL is replaced, not
 * duplicated.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const WEB = path.resolve(import.meta.dirname, "..");
const TF = path.resolve(WEB, "..", "infra", "terraform");
const ENV = path.join(WEB, ".env.local");

function fail(msg, hint) {
  console.error(`\n  ${msg}`);
  if (hint) console.error(`  → ${hint}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(TF, "terraform.tfstate")))
  fail("No Terraform state in infra/terraform.", "Run this on the machine that provisioned the stack.");

let url;
try {
  url = execFileSync("terraform", ["output", "-raw", "database_url"], {
    cwd: TF,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
} catch (e) {
  fail(
    "terraform output failed.",
    /not recognized|ENOENT/i.test(String(e.message))
      ? "Terraform is not on PATH."
      : "Try `terraform init` in infra/terraform first.",
  );
}

if (!/^postgres(ql)?:\/\//.test(url)) fail("That did not look like a connection string.");

// Parse for the reassurance line — never log the password.
let host = "?", db = "?", user = "?";
try {
  const u = new URL(url);
  host = u.host;
  db = u.pathname.replace(/^\//, "");
  user = u.username;
} catch {
  /* keep the placeholders */
}

const prev = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
const kept = prev
  .split("\n")
  .filter((l) => !/^\s*(DATABASE_URL|MRV_DATA_MODE)\s*=/.test(l))
  .join("\n")
  .replace(/\n+$/, "");

const next =
  (kept ? kept + "\n" : "") +
  `\n# Written by scripts/link-db.mjs — this file is git-ignored.\n` +
  `DATABASE_URL=${url}\n` +
  `MRV_DATA_MODE=db\n`;

fs.writeFileSync(ENV, next);

console.log("\n  wrote web/.env.local");
console.log(`    host     ${host}`);
console.log(`    database ${db}`);
console.log(`    user     ${user}`);
console.log(`    mode     db  (was fixtures)`);
console.log("\n  next:  npm run db:doctor");
