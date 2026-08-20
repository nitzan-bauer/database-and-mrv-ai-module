/**
 * Runtime configuration. The module runs in one of two data modes:
 *   - "db":       queries the live mrv database on RDS via DATABASE_URL
 *   - "fixtures":  built-in demo data (Elad Farm, Nitzan-Veg-Tech), no DB needed
 *
 * Fixtures is the default whenever DATABASE_URL is absent, so the UI is fully
 * demoable without credentials. Set MRV_DATA_MODE=db (with DATABASE_URL) to
 * run against the real schema.
 */
export type DataMode = "db" | "fixtures";

export const DATABASE_URL = process.env.DATABASE_URL?.trim() || "";

export const DATA_MODE: DataMode =
  process.env.MRV_DATA_MODE === "db" && DATABASE_URL ? "db" : "fixtures";

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() || "";

/**
 * Where the real, already-downloaded VM0042 precedent PDDs live — the
 * folder Nitzan has been saving issued PDDs into by hand. Configurable
 * because it lives outside the repo (a real folder on his machine, not
 * something to copy into version control); defaults to the one already
 * in use so nothing has to be set for the existing setup to work.
 */
export const PDD_PRECEDENTS_DIR =
  process.env.PDD_PRECEDENTS_DIR?.trim() ||
  "C:\\Users\\nitza\\OneDrive\\Desktop\\carbonature\\PDDs vm0042";

/**
 * Read-only access to the customer-facing SaaS Supabase database —
 * carbonature-saas's own farms/plots, the source of truth for a real
 * (non-demo) farm's name, location, crops and contact. Absent in fixtures
 * mode and in any environment that has no business reading customer data.
 */
export const SAAS_SUPABASE_URL = process.env.SAAS_SUPABASE_URL?.trim() || "";
export const SAAS_SUPABASE_SERVICE_ROLE_KEY = process.env.SAAS_SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
