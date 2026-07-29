import "server-only";
import { Pool } from "pg";
import { DATABASE_URL } from "./env";

/**
 * A single shared pg Pool for the mrv database. Every connection sets
 * search_path=mrv,public so the app's queries read the dedicated schema.
 *
 * This is only ever imported by server code. In fixtures mode it is never
 * touched (the data layer short-circuits before calling query()).
 */
declare global {
  // eslint-disable-next-line no-var
  var __mrvPool: Pool | undefined;
}

function makePool(): Pool {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Run in fixtures mode, or provide the RDS connection string.",
    );
  }
  const pool = new Pool({
    connectionString: DATABASE_URL,
    // RDS enforces TLS; do not reject the AWS-managed cert chain in dev.
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("connect", (client) => {
    client.query("SET search_path TO mrv, public").catch(() => {});
  });
  return pool;
}

export function getPool(): Pool {
  if (!global.__mrvPool) global.__mrvPool = makePool();
  return global.__mrvPool;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await getPool().query(text, params as never[]);
  return res.rows as T[];
}
