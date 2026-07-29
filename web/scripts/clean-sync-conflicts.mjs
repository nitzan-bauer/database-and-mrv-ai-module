/**
 * Remove OneDrive sync-conflict copies from the build directory.
 *
 * This repository lives inside a OneDrive-synced folder, and OneDrive syncs
 * .next along with the source. When the same generated file exists on two
 * machines it keeps both, naming the loser "<file>-<DeviceName>[.<ext>]".
 * That breaks the build in two distinct ways:
 *
 *   1. Type duplicates. ".next/dev/types/routes.d-nitzan.ts" sits beside
 *      routes.d.ts, tsconfig globs both, and TypeScript reports the
 *      generated route types as duplicate declarations — a build failure
 *      with nothing wrong in the source.
 *
 *   2. A corrupt Turbopack cache, which is the worse one. That cache is a
 *      small embedded database whose files are named by number. A copy
 *      called "00000001-nitzan.sst" makes it fail to open with "invalid
 *      digit found in string", and the dev server exits a few seconds after
 *      printing Ready — looking, from the outside, like a crash with no
 *      cause. The cache is disposable, so if any conflict copy is found in
 *      it the whole directory goes.
 *
 * The durable fix is to stop syncing .next at all (OneDrive settings). This
 * guard means a stray copy cannot break a build in the meantime.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", ".next");
const TURBO_CACHE = path.join(ROOT, "dev", "cache", "turbopack");

/**
 * OneDrive suffixes the copy with the device label, which in practice is the
 * hostname or the account name. Match either, plus the ".d-<x>.ts" shape,
 * which is never a legitimate emit whatever the label happens to be.
 */
const labels = [os.hostname(), os.userInfo().username]
  .filter(Boolean)
  .map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ""));

function isConflictCopy(name) {
  const lower = name.toLowerCase();
  if (/\.d-[^.\\/]+\.ts$/.test(lower)) return true;
  return labels.some(
    (l) => l && (lower.includes(`-${l}.`) || lower.endsWith(`-${l}`)),
  );
}

let removed = 0;
let cacheHit = false;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // .next may not exist yet
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p);
    } else if (isConflictCopy(e.name)) {
      if (p.startsWith(TURBO_CACHE)) cacheHit = true;
      try {
        fs.rmSync(p);
        removed++;
      } catch {
        /* locked by another process — the build will surface it */
      }
    }
  }
}

walk(ROOT);

if (cacheHit) {
  // A partially-cleaned cache still fails to open; drop it entirely.
  try {
    fs.rmSync(TURBO_CACHE, { recursive: true, force: true });
    console.log("clean-sync-conflicts: dropped the Turbopack cache (had conflict copies)");
  } catch {
    /* ignore */
  }
}

if (removed) console.log(`clean-sync-conflicts: removed ${removed} sync-conflict file(s)`);
