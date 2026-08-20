/**
 * Static check of the db-mode SQL against the real schema.
 *
 * Every query in the data layer runs only when MRV_DATA_MODE=db, so in
 * fixtures mode they are never executed and a wrong column name would sit
 * there silently until the day the module is pointed at RDS. This reads the
 * migrations, builds the table/column map they define, then reads every SQL
 * string in the source and checks each `alias.column` against it.
 *
 * It is not a parser and does not try to be: it resolves aliases from FROM
 * and JOIN clauses and verifies identifiers. That catches the mistakes that
 * actually happen — a renamed column, a table that never existed, a join to
 * the wrong side — without pretending to understand SQL semantics.
 *
 *   node scripts/check-db-queries.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS = path.join(ROOT, "migrations");
const SRC = path.resolve(import.meta.dirname, "..", "src");

/* ── 1. the schema the migrations define ─────────────────────────────── */

const tables = new Map(); // name -> Set(columns)

function addColumn(table, col) {
  if (!tables.has(table)) tables.set(table, new Set());
  tables.get(table).add(col);
}

const migrationSql = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8"))
  // only the up-migration defines the shape we run against
  .map((s) => s.split(/^--\s*migrate:down\s*$/m)[0])
  .join("\n");

for (const m of migrationSql.matchAll(
  /CREATE TABLE (?:IF NOT EXISTS )?mrv\.(\w+)\s*\(([\s\S]*?)\n\);/g,
)) {
  const [, table, body] = m;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("--")) continue;
    // skip table-level constraints
    if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK|EXCLUDE)\b/i.test(t)) continue;
    const col = t.match(/^(\w+)\s+/);
    if (col) addColumn(table, col[1]);
  }
}

// columns added later — one ALTER TABLE can carry several comma-separated
// ADD COLUMN clauses (e.g. 0025 adds `skills` and `planned_skills` in the
// same statement), so each statement's whole body is scanned for every
// ADD COLUMN within it, not just the one right after ALTER TABLE.
for (const stmt of migrationSql.matchAll(/ALTER TABLE mrv\.(\w+)\s+([\s\S]*?);/gi)) {
  const [, table, body] = stmt;
  for (const col of body.matchAll(/ADD COLUMN (?:IF NOT EXISTS )?(\w+)/gi)) {
    addColumn(table, col[1]);
  }
}

// views the app may read
for (const m of migrationSql.matchAll(/CREATE (?:OR REPLACE )?VIEW mrv\.(\w+)/g)) {
  if (!tables.has(m[1])) tables.set(m[1], new Set());
}

/* ── 2. the SQL the app actually sends ───────────────────────────────── */

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const problems = [];
let queriesChecked = 0;

for (const file of sourceFiles(SRC)) {
  const src = fs.readFileSync(file, "utf8");
  // template literals that look like SQL against the mrv schema
  for (const m of src.matchAll(/`([^`]*\bFROM\s+mrv\.[\s\S]*?)`/gi)) {
    const sql = m[1];
    queriesChecked++;
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");

    // alias -> table, from FROM and JOIN clauses
    const alias = new Map();
    for (const t of sql.matchAll(/\b(?:FROM|JOIN)\s+mrv\.(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
      const [, table, as] = t;
      if (!tables.has(table)) {
        problems.push(`${rel}: unknown table mrv.${table}`);
        continue;
      }
      alias.set((as && !/^(ON|WHERE|GROUP|ORDER|LEFT|RIGHT|INNER|FULL|USING)$/i.test(as) ? as : table).toLowerCase(), table);
      alias.set(table.toLowerCase(), table);
    }

    // every alias.column reference
    for (const c of sql.matchAll(/\b(\w+)\.(\w+)\b/g)) {
      const [, a, col] = c;
      if (a.toLowerCase() === "mrv") continue; // mrv.<table>, handled above
      const table = alias.get(a.toLowerCase());
      if (!table) continue; // not a table alias (e.g. a CTE or function)
      const cols = tables.get(table);
      if (cols && cols.size && !cols.has(col)) {
        problems.push(`${rel}: mrv.${table} has no column "${col}"  (as ${a}.${col})`);
      }
    }
  }
}

/* ── 3. report ───────────────────────────────────────────────────────── */

console.log(`schema: ${tables.size} tables/views from migrations`);
console.log(`checked: ${queriesChecked} SQL statements in the source`);

if (!problems.length) {
  console.log("OK — every table and column referenced by db-mode SQL exists");
  process.exit(0);
}

console.log(`\n${problems.length} problem(s):`);
for (const p of [...new Set(problems)]) console.log("  " + p);
process.exit(1);
