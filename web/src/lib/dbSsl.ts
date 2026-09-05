import fs from "node:fs";
import path from "node:path";

/**
 * TLS for the RDS connection, and the reason it is not simply switched off.
 *
 * The connection string Terraform produces ends in `?sslmode=require`.
 * Modern pg-connection-string treats `require` as an alias for `verify-full`,
 * which demands a chain back to a trusted root — and RDS presents an Amazon
 * CA that is not in Node's default trust store. The result is
 * "self-signed certificate in certificate chain", and the usual fix found
 * online is `rejectUnauthorized: false`.
 *
 * That fix is wrong here. This connection carries the sampling and
 * laboratory evidence a VVB will audit; disabling verification means anyone
 * positioned between the module and the database can read or alter it
 * undetected, and the certificate would still look fine. So instead the
 * Amazon RDS root bundle is shipped in certs/ and verification is kept on.
 *
 * `sslmode` is stripped from the URL because it would otherwise override the
 * explicit ssl object below with its own, untrusting, behaviour.
 */

export interface DbConnection {
  connectionString: string;
  ssl: { ca: string; rejectUnauthorized: true } | { rejectUnauthorized: false };
}

const RDS_BUNDLE = path.join(process.cwd(), "certs", "rds-global-bundle.pem");
const SUPABASE_BUNDLE = path.join(process.cwd(), "certs", "supabase-ca-bundle.pem");

/**
 * Both CA bundles combined — `ssl.ca` accepts a concatenation of trusted
 * roots, so this verifies correctly whichever of the two databases
 * DATABASE_URL currently points at (Addendum 1's one-database migration:
 * AWS RDS during the cutover, the SaaS's own Supabase project after),
 * without the app needing to know which one it is.
 *
 * The Supabase bundle is read from an env var first, file second. Confirmed
 * live in production: reading it from certs/supabase-ca-bundle.pem alone
 * was silently inconsistent under Vercel's serverless bundler (some
 * invocations got "self-signed certificate in certificate chain" — the
 * classic symptom of the file not actually being present in that specific
 * function's deployed bundle, Next.js's output-file-tracing not reliably
 * picking up a plain fs.readFileSync call on a non-imported file). The
 * bundle is small (~40 lines, public CA data, no secret) and cheap to keep
 * in an env var instead of depending on file tracing at all. The RDS
 * bundle stays file-only — it's ~2700 lines and only matters for the
 * rollback path, not today's real connection.
 */
function combinedBundle(): string {
  const parts: string[] = [];
  if (fs.existsSync(RDS_BUNDLE)) parts.push(fs.readFileSync(RDS_BUNDLE, "utf8"));
  if (process.env.SUPABASE_CA_BUNDLE_PEM) parts.push(process.env.SUPABASE_CA_BUNDLE_PEM);
  else if (fs.existsSync(SUPABASE_BUNDLE)) parts.push(fs.readFileSync(SUPABASE_BUNDLE, "utf8"));
  return parts.join("\n");
}

/** True when at least one CA bundle is present, so callers can report how they connected. */
export function caBundleAvailable(): boolean {
  return fs.existsSync(RDS_BUNDLE) || Boolean(process.env.SUPABASE_CA_BUNDLE_PEM) || fs.existsSync(SUPABASE_BUNDLE);
}

/**
 * Build pg connection options from a URL.
 *
 * Verification is only relaxed when the caller explicitly asks — which
 * nothing in the app does. It exists so the doctor can tell the difference
 * between "the CA is wrong" and "the host is unreachable".
 */
export function dbConnection(url: string, allowInsecure = false): DbConnection {
  // Strip sslmode so it cannot override the ssl object.
  let connectionString = url;
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    connectionString = u.toString();
  } catch {
    connectionString = url.replace(/[?&]sslmode=[^&]*/i, "");
  }

  if (caBundleAvailable()) {
    return {
      connectionString,
      ssl: { ca: combinedBundle(), rejectUnauthorized: true },
    };
  }

  if (allowInsecure) return { connectionString, ssl: { rejectUnauthorized: false } };

  throw new Error(
    `No CA bundle found at ${RDS_BUNDLE} or ${SUPABASE_BUNDLE}.\n` +
      `Fetch the RDS one with:  npm run db:certs\n` +
      `Connecting without it would mean not verifying the database's identity.`,
  );
}
