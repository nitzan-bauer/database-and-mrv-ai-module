/**
 * Put a rotated Google OAuth client secret into .env.local.
 *
 *   npm run auth:google      (or the desktop shortcut)
 *
 * Editing .env.local by hand is where this goes wrong: Notepad appends .txt
 * to dotfiles, and a value pasted anywhere other than after
 * AUTH_GOOGLE_SECRET= is simply not read, because the file only parses
 * KEY=value lines. A secret pasted into a chat cannot be un-pasted either.
 *
 * It reads the clipboard first. Pasting into a console window is the step
 * that keeps failing — cmd.exe launched from a shortcut has right-click
 * paste off by default, so the paste silently does nothing, Enter submits an
 * empty line, and the run ends with no change and no obvious reason. Copying
 * the secret in the browser is a step the user is already taking, so reading
 * it from there removes the failure entirely. Typing it in stays available
 * for anything without a clipboard.
 *
 * The value is never printed. Confirmation shows its length and last four
 * characters, which is enough to tell two secrets apart and not enough to be
 * one.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ENV = path.join(path.resolve(import.meta.dirname, ".."), ".env.local");
const PREFIX = "GOCSPX-";

if (!fs.existsSync(ENV)) {
  console.error(`No ${ENV}.\nCreate it first, or run:  npm run db:link`);
  process.exit(1);
}

const mask = (v) => `${PREFIX}${"•".repeat(Math.max(0, v.length - PREFIX.length - 4))}${v.slice(-4)}`;
const fp = (v) => crypto.createHash("sha256").update(v).digest("hex").slice(0, 12);

/**
 * Strip a secret that arrived more than once in a row.
 *
 * A clipboard holding "GOCSPX-…GOCSPX-…" passes a prefix check and is
 * written whole, and Google answers invalid_client — which reads as "wrong
 * secret" rather than "right secret, twice". It has already happened once
 * here, and the halves were byte-identical, so the case is worth handling
 * rather than merely rejecting.
 */
function deduplicate(v) {
  const second = v.indexOf(PREFIX, 1);
  if (second === -1) return { value: v, repeated: 0 };
  const parts = v.split(PREFIX).filter(Boolean).map((p) => PREFIX + p);
  const allSame = parts.every((p) => p === parts[0]);
  return allSame ? { value: parts[0], repeated: parts.length } : { value: v, repeated: -1 };
}

/** Whatever is on the Windows clipboard, or null. */
function fromClipboard() {
  if (process.platform !== "win32") return null;
  try {
    return execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return null;
  }
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (hidden) {
      let shown = false;
      rl._writeToOutput = (s) => {
        if (!shown) {
          process.stdout.write(s);
          shown = true;
        }
      };
    }
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(a.trim());
    });
  });
}

/* ---- find the secret ------------------------------------------------- */
let secret = null;

const clip = fromClipboard();
if (clip && clip.startsWith(PREFIX) && !/\s/.test(clip)) {
  console.log(`Found a client secret on the clipboard:  ${mask(clip)}   (${clip.length} characters)`);
  const yes = (await ask("Use it? [Y/n]: ")).toLowerCase();
  if (yes === "" || yes === "y" || yes === "yes") secret = clip;
  else console.log("Not using the clipboard.\n");
} else if (clip) {
  console.log(`The clipboard does not hold a client secret (they begin "${PREFIX}").\n`);
} else {
  console.log("Could not read the clipboard.\n");
}

if (!secret) {
  console.log(`Type or paste it instead. Nothing appears as you type.`);
  console.log(`In this window paste with Ctrl+V — right-click paste is often off.\n`);
  secret = await ask("Client secret: ", { hidden: true });
}

/* ---- check it -------------------------------------------------------- */
if (!secret) {
  console.error("\nNothing was entered, so .env.local is unchanged.");
  console.error("Copy the secret in Google Cloud Console and run this again — it will");
  console.error("pick it up from the clipboard without you having to paste here.");
  process.exit(1);
}
if (!secret.startsWith(PREFIX)) {
  console.error(`\nThat does not look like a Google client secret — they begin "${PREFIX}".`);
  console.error("Nothing was written. Check you copied the secret and not the client ID.");
  process.exit(1);
}

const dedup = deduplicate(secret);
if (dedup.repeated === -1) {
  console.error("\nThat looks like two different secrets joined together.");
  console.error("Nothing was written. Copy just one and run this again.");
  process.exit(1);
}
if (dedup.repeated > 1) {
  console.log(`\nThe value arrived ${dedup.repeated} times over; using a single copy.`);
  secret = dedup.value;
}

const before = fs.readFileSync(ENV, "utf8");
if (!/^AUTH_GOOGLE_SECRET=/m.test(before)) {
  console.error("\nAUTH_GOOGLE_SECRET is not in .env.local — refusing to guess where it belongs.");
  process.exit(1);
}

const old = before.match(/^AUTH_GOOGLE_SECRET=(.*)$/m)[1].trim();
if (old === secret) {
  console.error("\nThat is already the secret in the file. Nothing changed.");
  console.error("If sign-in is still failing, the new secret was probably not the one copied.");
  process.exit(1);
}

/* ---- write it -------------------------------------------------------- */
fs.writeFileSync(`${ENV}.bak`, before);
fs.writeFileSync(ENV, before.replace(/^AUTH_GOOGLE_SECRET=.*$/m, `AUTH_GOOGLE_SECRET=${secret}`));

console.log(`\nupdated ${path.basename(ENV)}`);
console.log(`  was  sha256 ${fp(old)}`);
console.log(`  now  sha256 ${fp(secret)}   ${mask(secret)}   (${secret.length} characters)`);
console.log("\nRestart the server, then sign in at http://localhost:3007/login");
