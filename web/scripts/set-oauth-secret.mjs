/**
 * Put a rotated Google OAuth client secret into .env.local.
 *
 *   npm run auth:google
 *
 * Editing .env.local by hand is where this goes wrong: Notepad appends .txt to
 * dotfiles, and a secret pasted into a chat or a commit cannot be un-pasted.
 * This prompts on the local terminal, echoes nothing, writes only the one line,
 * and prints a fingerprint rather than the value so the terminal scrollback
 * never holds it either.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";

const ENV = path.join(path.resolve(import.meta.dirname, ".."), ".env.local");

if (!fs.existsSync(ENV)) {
  console.error(`No ${ENV}.\nCreate it first, or run:  npm run db:link`);
  process.exit(1);
}

/** Prompt without echoing, so the secret never lands in scrollback. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Swallow the echo of everything typed after the prompt itself.
    let prompted = false;
    rl._writeToOutput = (s) => {
      if (!prompted) { process.stdout.write(s); prompted = true; }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const secret = await askHidden("Paste the NEW client secret (input hidden), then Enter: ");

if (!secret) {
  console.error("Nothing entered — .env.local left untouched.");
  process.exit(1);
}
if (!secret.startsWith("GOCSPX-")) {
  console.error(
    `That does not look like a Google client secret (they begin "GOCSPX-").\n` +
      "Nothing was written. Check you copied the secret and not the client ID.",
  );
  process.exit(1);
}

const before = fs.readFileSync(ENV, "utf8");
if (!/^AUTH_GOOGLE_SECRET=/m.test(before)) {
  console.error("AUTH_GOOGLE_SECRET is not in .env.local — refusing to guess where it belongs.");
  process.exit(1);
}

const old = before.match(/^AUTH_GOOGLE_SECRET=(.*)$/m)[1].trim();
if (old === secret) {
  console.error("That is the secret already in the file. Nothing changed.");
  process.exit(1);
}

// Keep a backup beside it, in case a paste went wrong.
fs.writeFileSync(`${ENV}.bak`, before);
fs.writeFileSync(ENV, before.replace(/^AUTH_GOOGLE_SECRET=.*$/m, `AUTH_GOOGLE_SECRET=${secret}`));

const fp = (v) => crypto.createHash("sha256").update(v).digest("hex").slice(0, 12);
console.log(`updated ${path.basename(ENV)}`);
console.log(`  was  sha256 ${fp(old)}`);
console.log(`  now  sha256 ${fp(secret)}  (length ${secret.length})`);
console.log("\nRestart the dev server, then sign in at http://localhost:3007/login");
