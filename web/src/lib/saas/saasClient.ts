import "server-only";
import { SAAS_SUPABASE_SERVICE_ROLE_KEY, SAAS_SUPABASE_URL } from "../env";

/**
 * Raw PostgREST reads against the customer-facing SaaS Supabase database —
 * no @supabase/supabase-js dependency, matching how driveClient.ts and
 * gmailClient.ts already talk to Google's REST APIs directly. Read-only:
 * nothing here can write back to the SaaS database, on purpose — a real
 * PDD import has no business mutating the marketplace/onboarding data.
 */

export interface SaasFarm {
  id: string;
  farm_name: string;
  company_name: string | null;
  addr_country: string;
  addr_city: string;
  cultivation_area: number | null;
  cultivation_unit: "Ha" | "Acres" | null;
  crops: string[];
  contact_first: string | null;
  contact_surname: string | null;
}

function assertConfigured(): void {
  if (!SAAS_SUPABASE_URL || !SAAS_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SAAS_SUPABASE_URL / SAAS_SUPABASE_SERVICE_ROLE_KEY are not configured.");
  }
}

async function restGet<T>(path: string): Promise<T> {
  assertConfigured();
  const res = await fetch(`${SAAS_SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SAAS_SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SAAS_SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SaaS Supabase REST ${path} returned ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

/** One farm by its SaaS id, or null if it doesn't exist there. */
export async function fetchSaasFarm(saasFarmId: string): Promise<SaasFarm | null> {
  const rows = await restGet<SaasFarm[]>(
    `farms?id=eq.${encodeURIComponent(saasFarmId)}&select=id,farm_name,company_name,addr_country,addr_city,cultivation_area,cultivation_unit,crops,contact_first,contact_surname`,
  );
  return rows[0] ?? null;
}

/**
 * Farms registered after `sinceIso` — the "new farmer since last check"
 * source for the biweekly scheduled task (Nitzan's own spec, live this
 * session). Confirmed live that farms.created_at exists on the real SaaS
 * table before writing this, the same way every other real-data claim in
 * this codebase is verified rather than assumed.
 */
export async function listSaasFarmsSince(sinceIso: string): Promise<SaasFarm[]> {
  return restGet<SaasFarm[]>(
    `farms?created_at=gt.${encodeURIComponent(sinceIso)}&select=id,farm_name,company_name,addr_country,addr_city,cultivation_area,cultivation_unit,crops,contact_first,contact_surname&order=created_at.asc`,
  );
}
