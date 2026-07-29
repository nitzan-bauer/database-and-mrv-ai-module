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
