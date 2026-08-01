import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url); const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
  .map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
const u = new URL(env.DATABASE_URL); u.searchParams.delete("sslmode");
const c = new Client({ connectionString:u.toString(),
  ssl:{ca:fs.readFileSync("certs/rds-global-bundle.pem","utf8"),rejectUnauthorized:true}});
await c.connect();
const ID = "617f7cfb-701e-4760-b13b-7663904be8bf";   // the dry farm
await c.query(`UPDATE mrv.farms SET irrigation_method=NULL WHERE farm_id=$1`,[ID]);
console.log("  irrigation_method cleared on the dry farm");
await c.end();
