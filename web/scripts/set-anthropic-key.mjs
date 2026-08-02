/**
 * Put an Anthropic API key into .env.local, as ANTHROPIC_API_KEY.
 *
 *   npm run agent:key
 *
 * Same reasoning as set-oauth-secret.mjs (Google's client secret): editing
 * .env.local by hand is where this goes wrong, and a key pasted into a chat
 * cannot be un-pasted. This reads the clipboard first — copying the key on
 * console.anthropic.com is a step already being taken — and falls back to a
 * hidden prompt.
 *
 * Unlike AUTH_GOOGLE_SECRET, ANTHROPIC_API_KEY does not already exist as a
 * line in .env.local (no key has been created yet), so this appends the
 * line rather than refusing when it's missing.
 *
 * The value is never printed. Confirmation shows its length and last four
 * characters, which is enough to tell two keys apart and not enough to be
 * one.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ENV = path.join(path.resolve(import.meta.dirname, ".."), ".env.local");
const KEY_NAME = "ANTHROPIC_API_KEY";
const PREFIX = "sk-ant-";

if (!fs.existsSync(ENV)) {
  console.error(`No ${ENV}.\nCreate it first, or run:  npm run db:link`);
  process.exit(1);
}

const mask = (v) => `${PREFIX}${"•".repeat(Math.max(0, v.length - PREFIX.length - 4))}${v.slice(-4)}`;
const fp = (v) => crypto.createHash("sha256").update(v).digest("hex").slice(0, 12);

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

/* ---- find the key ------------------------------------------------- */
let key = null;

const clip = fromClipboard();
if (clip && clip.startsWith(PREFIX) && !/\s/.test(clip)) {
  console.log(`Found an Anthropic API key on the clipboard:  ${mask(clip)}   (${clip.length} characters)`);
  const yes = (await ask("Use it? [Y/n]: ")).toLowerCase();
  if (yes === "" || yes === "y" || yes === "yes") key = clip;
  else console.log("Not using the clipboard.\n");
} else if (clip) {
  console.log(`The clipboard does not hold an Anthropic API key (they begin "${PREFIX}").\n`);
} else {
  console.log("Could not read the clipboard.\n");
}

if (!key) {
  console.log(`Type or paste it instead. Nothing appears as you type.`);
  console.log(`In this window paste with Ctrl+V — right-click paste is often off.\n`);
  key = await ask("Anthropic API key: ", { hidden: true });
}

/* ---- check it -------------------------------------------------------- */
if (!key) {
  console.error("\nNothing was entered, so .env.local is unchanged.");
  console.error("Copy the key from console.anthropic.com > API Keys and run this again — it");
  console.error("will pick it up from the clipboard without you having to paste here.");
  process.exit(1);
}
if (!key.startsWith(PREFIX)) {
  console.error(`\nThat does not look like an Anthropic API key — they begin "${PREFIX}".`);
  console.error("Nothing was written.");
  process.exit(1);
}

const before = fs.readFileSync(ENV, "utf8");
const existing = before.match(new RegExp(`^${KEY_NAME}=(.*)$`, "m"));

if (existing) {
  const old = existing[1].trim();
  if (old === key) {
    console.error("\nThat is already the key in the file. Nothing changed.");
    process.exit(1);
  }
  fs.writeFileSync(`${ENV}.bak`, before);
  fs.writeFileSync(ENV, before.replace(new RegExp(`^${KEY_NAME}=.*$`, "m"), `${KEY_NAME}=${key}`));
  console.log(`\nupdated ${path.basename(ENV)}`);
  console.log(`  was  sha256 ${fp(old)}`);
} else {
  fs.writeFileSync(`${ENV}.bak`, before);
  const withTrailingNewline = before.endsWith("\n") ? before : before + "\n";
  fs.writeFileSync(ENV, `${withTrailingNewline}${KEY_NAME}=${key}\n`);
  console.log(`\nadded ${KEY_NAME} to ${path.basename(ENV)}`);
}

console.log(`  now  sha256 ${fp(key)}   ${mask(key)}   (${key.length} characters)`);
console.log("\nRestart the dev server for it to take effect.");
