import "server-only";
import { Pool } from "pg";
import { DATABASE_URL } from "./env";
import { dbConnection } from "./dbSsl";

/**
 * A single shared pg Pool for the mrv database. Every connection sets
 * search_path=mrv,public so the app's queries read the dedicated schema.
 *
 * This is only ever imported by server code. In fixtures mode it is never
 * touched (the data layer short-circuits before calling query()).
 */
declare global {
  var __mrvPool: Pool | undefined;
}

function makePool(): Pool {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Run in fixtures mode, or provide the RDS connection string.",
    );
  }
  const { connectionString, ssl } = dbConnection(DATABASE_URL);
  const pool = new Pool({
    connectionString,
    ssl,
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

/** A client bound to one transaction, so callers cannot stray onto the pool. */
export interface Tx {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * Run several statements as one unit, on a single connection.
 *
 * `query` above takes whichever connection the pool hands out, so a sequence
 * of calls can land on different ones — which makes BEGIN and COMMIT issued
 * that way meaningless. Anything writing more than one row needs this
 * instead.
 *
 * It matters most for a sampling plan: strata, a cycle, and the points are
 * one artefact. Half of it in the database is worse than none, because the
 * compliance engine would read it as a real plan that fails its checks
 * rather than as a plan that was never finished.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn({
      query: async (text, params) => {
        const r = await client.query(text, params as never[]);
        return { rows: r.rows as never[], rowCount: r.rowCount };
      },
    });
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
