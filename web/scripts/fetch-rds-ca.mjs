/**
 * Fetch Amazon's RDS root certificate bundle into certs/.
 *
 *   npm run db:certs
 *
 * The module verifies the database's certificate against this rather than
 * disabling verification, so the bundle has to exist before it can connect.
 * It is public, and committed, so a fresh checkout works without this — this
 * exists to refresh it when Amazon rotates a root.
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";
const OUT = path.join(path.resolve(import.meta.dirname, ".."), "certs", "rds-global-bundle.pem");

fs.mkdirSync(path.dirname(OUT), { recursive: true });

https
  .get(URL, (res) => {
    if (res.statusCode !== 200) {
      console.error(`Download failed: HTTP ${res.statusCode}`);
      process.exit(1);
    }
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const count = (body.match(/BEGIN CERTIFICATE/g) || []).length;
      if (count === 0) {
        console.error("That download contained no certificates — not writing it.");
        process.exit(1);
      }
      fs.writeFileSync(OUT, body);
      console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${count} certificates`);
    });
  })
  .on("error", (e) => {
    console.error(`Could not reach ${URL}\n  ${e.message}`);
    process.exit(1);
  });
