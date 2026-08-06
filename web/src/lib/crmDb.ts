import "server-only";
import { Pool } from "pg";
import { DATABASE_URL } from "./env";
import { dbConnection } from "./dbSsl";

/**
 * A second pool onto the SAME RDS instance the mrv schema lives on, scoped
 * to crm,public via search_path — never mrv. This is how Jennifer's and
 * Ron's CRM tools reach crm.* directly (spec §3: "no external API is
 * required for this internal access, since the CRM and the agents share
 * the same Postgres instance"), without this module ever touching mrv.*.
 *
 * Deliberately a distinct Pool from getPool() in ./db, not a shared one
 * with a runtime SET search_path per query — two independent connection
 * pools, each fixed to its own schema at connection time, is simpler to
 * reason about than one pool whose meaning depends on which query ran on
 * a given client last.
 */
declare global {
  var __crmToolPool: Pool | undefined;
}

function makePool(): Pool {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — the crm schema needs the same RDS connection as mrv.");
  }
  const { connectionString, ssl } = dbConnection(DATABASE_URL);
  return new Pool({
    connectionString,
    ssl,
    options: "-c search_path=crm,public",
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function getCrmPool(): Pool {
  if (!global.__crmToolPool) global.__crmToolPool = makePool();
  return global.__crmToolPool;
}

export async function crmQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await getCrmPool().query(text, params as never[]);
  return res.rows as T[];
}

export interface CrmTx {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export async function crmTransaction<T>(fn: (tx: CrmTx) => Promise<T>): Promise<T> {
  const client = await getCrmPool().connect();
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
