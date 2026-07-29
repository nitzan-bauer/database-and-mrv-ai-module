/**
 * Remove OneDrive sync-conflict copies from .next before a build.
 *
 * This repository lives inside a OneDrive-synced folder. OneDrive syncs the
 * .next build cache too, and when it sees the same generated file written on
 * two machines it keeps both, naming the loser "<file>-<DeviceName>.<ext>":
 *
 *     .next/dev/types/routes.d.ts
 *     .next/dev/types/routes.d-nitzan.ts   <- conflict copy
 *
 * tsconfig pulls in .next/**\/*.ts, so the copy is compiled as well and
 * TypeScript reports the generated route types as duplicate declarations —
 * a build failure with nothing wrong in the source. The durable fix is to
 * stop syncing .next at all (OneDrive settings), but this guard means a
 * stray copy can never fail a build in the meantime.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", ".next");

/** "routes.d-nitzan.ts" — a .d-<something>.ts is never a real emit. */
const CONFLICT = /\.d-[^.\\/]+\.ts$/;

let removed = 0;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // .next may not exist yet
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (CONFLICT.test(e.name)) {
      try {
        fs.rmSync(p);
        removed++;
        console.log(`removed sync-conflict copy: ${path.relative(ROOT, p)}`);
      } catch {
        /* locked by another process — the build will surface it */
      }
    }
  }
}

walk(ROOT);
if (removed) console.log(`clean-sync-conflicts: removed ${removed} file(s)`);
