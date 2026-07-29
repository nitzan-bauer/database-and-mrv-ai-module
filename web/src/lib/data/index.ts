import "server-only";
import { DATA_MODE } from "../env";
import type { Farm, FarmWithPlots, Plot, Project } from "./types";
import { DEMO_FARMS, DEMO_PLOTS, DEMO_PROJECT } from "./fixtures";

/**
 * The single data-access surface for the module. Every screen reads through
 * here, so it works identically in fixtures mode (demo data) and db mode
 * (live mrv schema on RDS). Server-only — never imported by client components.
 */

/* ─────────────────────────── fixtures mode ─────────────────────────── */

function fx() {
  const farms = DEMO_FARMS;
  const plots = DEMO_PLOTS;
  return { farms, plots };
}

/* ──────────────────────────────── API ──────────────────────────────── */

export async function listProjects(): Promise<Project[]> {
  if (DATA_MODE === "fixtures") return [DEMO_PROJECT];
  const { query } = await import("../db");
  return (
    await query<Record<string, unknown>>(
      `SELECT project_id, name, methodology, is_grouped, country, status, is_demo
         FROM mrv.projects ORDER BY name`,
    )
  ).map(rowToProject);
}

export async function getProject(projectId: string): Promise<Project | null> {
  const all = await listProjects();
  return all.find((p) => p.projectId === projectId) ?? null;
}

export async function listFarms(projectId: string): Promise<Farm[]> {
  if (DATA_MODE === "fixtures") {
    const { farms, plots } = fx();
    return farms
      .filter((f) => f.projectId === projectId)
      .map((f) => withTotals(f, plots));
  }
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT f.farm_id, f.project_id, f.name, f.installation_code, f.operator,
            f.country, f.region, f.climate_zone, f.status, f.is_demo,
            count(p.plot_id)::int          AS plot_count,
            coalesce(sum(p.area_ha), 0)::float AS total_area_ha
       FROM mrv.farms f
       LEFT JOIN mrv.plots p ON p.farm_id = f.farm_id
      WHERE f.project_id = $1
      GROUP BY f.farm_id
      ORDER BY f.name`,
    [projectId],
  );
  return rows.map(rowToFarm);
}

export async function getFarmsWithPlots(projectId: string): Promise<FarmWithPlots[]> {
  const farms = await listFarms(projectId);
  const out: FarmWithPlots[] = [];
  for (const f of farms) out.push({ ...f, plots: await listPlots(f.farmId) });
  return out;
}

export async function listPlots(farmId: string): Promise<Plot[]> {
  if (DATA_MODE === "fixtures") {
    return fx().plots.filter((p) => p.farmId === farmId);
  }
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT plot_id, farm_id, name, ST_AsGeoJSON(geom)::json AS geom,
            area_ha, application_area_ha, quantification_approach, crop,
            stroke_color, is_demo
       FROM mrv.plots WHERE farm_id = $1 ORDER BY plot_id`,
    [farmId],
  );
  return rows.map(rowToPlot);
}

/* ──────────────────────────── row mappers ──────────────────────────── */

function withTotals(f: Farm, plots: Plot[]): Farm {
  const mine = plots.filter((p) => p.farmId === f.farmId);
  return {
    ...f,
    plotCount: mine.length,
    totalAreaHa: Number(mine.reduce((s, p) => s + p.areaHa, 0).toFixed(2)),
  };
}

function rowToProject(r: Record<string, unknown>): Project {
  return {
    projectId: String(r.project_id),
    name: String(r.name),
    methodology: String(r.methodology),
    isGrouped: Boolean(r.is_grouped),
    country: String(r.country ?? ""),
    status: (r.status as Project["status"]) ?? "under_development",
    isDemo: Boolean(r.is_demo),
  };
}

function rowToFarm(r: Record<string, unknown>): Farm {
  return {
    farmId: String(r.farm_id),
    projectId: String(r.project_id),
    name: String(r.name),
    installationCode: String(r.installation_code ?? ""),
    operator: (r.operator as string | null) ?? null,
    country: String(r.country ?? ""),
    region: (r.region as string | null) ?? null,
    climateZone: (r.climate_zone as Farm["climateZone"]) ?? "dry",
    status: String(r.status ?? ""),
    isDemo: Boolean(r.is_demo),
    plotCount: Number(r.plot_count ?? 0),
    totalAreaHa: Number(r.total_area_ha ?? 0),
  };
}

function rowToPlot(r: Record<string, unknown>): Plot {
  return {
    plotId: String(r.plot_id),
    farmId: String(r.farm_id),
    name: String(r.name),
    geom: r.geom as Plot["geom"],
    areaHa: Number(r.area_ha ?? 0),
    applicationAreaHa: Number(r.application_area_ha ?? 0),
    quantificationApproach: (r.quantification_approach as Plot["quantificationApproach"]) ?? "QA2",
    crop: (r.crop as string | null) ?? null,
    strokeColor: String(r.stroke_color ?? "#2b6161"),
    isDemo: Boolean(r.is_demo),
  };
}
