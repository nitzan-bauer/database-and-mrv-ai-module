import "server-only";
import { DATA_MODE } from "../env";
import type {
  Farm,
  FarmWithPlots,
  Plot,
  PlotDetail,
  Project,
  SampleRow,
  SamplingPlan,
  SamplingPoint,
  WorkOrder,
  WorkOrderPoint,
} from "./types";
import {
  DEMO_ACTIVITIES,
  DEMO_FARMS,
  DEMO_MODEL_RUNS,
  DEMO_PLANS,
  DEMO_PLOTS,
  DEMO_PROJECT,
  DEMO_SAMPLES,
  DEMO_SAMPLING_POINTS,
  DEMO_SOC,
  DEMO_TEXTURE,
  DEMO_WORK_ORDERS,
} from "./fixtures";

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
            f.country, f.region, f.climate_zone, f.irrigation_method, f.status, f.is_demo,
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

/** All sampling points for a project (WP + BSL), for the map. */
export async function listSamplingPoints(projectId: string): Promise<SamplingPoint[]> {
  if (DATA_MODE === "fixtures") {
    const farmIds = new Set(
      DEMO_FARMS.filter((f) => f.projectId === projectId).map((f) => f.farmId),
    );
    const plotIds = new Set(
      DEMO_PLOTS.filter((p) => farmIds.has(p.farmId)).map((p) => p.plotId),
    );
    return DEMO_SAMPLING_POINTS.filter((sp) => sp.plotId && plotIds.has(sp.plotId));
  }
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT sp.point_id, sp.plot_id, sp.bsl_id, sp.scenario,
            ST_X(sp.planned_geom) AS lon, ST_Y(sp.planned_geom) AS lat,
            sp.composite_cores, sp.is_revisit, sp.status
       FROM mrv.sampling_points sp
       LEFT JOIN mrv.plots p  ON p.plot_id = sp.plot_id
       LEFT JOIN mrv.baseline_control_sites b ON b.bsl_id = sp.bsl_id
       LEFT JOIN mrv.farms f  ON f.farm_id = coalesce(p.farm_id, b.farm_id)
      WHERE f.project_id = $1`,
    [projectId],
  );
  return rows.map((r) => ({
    pointId: String(r.point_id),
    plotId: (r.plot_id as string | null) ?? null,
    bslId: (r.bsl_id as string | null) ?? null,
    scenario: (r.scenario as SamplingPoint["scenario"]) ?? "WP",
    lonLat: [Number(r.lon), Number(r.lat)],
    compositeCores: r.composite_cores == null ? null : Number(r.composite_cores),
    isRevisit: Boolean(r.is_revisit),
    status: (r.status as SamplingPoint["status"]) ?? "planned",
  }));
}

/**
 * All sampling plans for a project (spec §6.4). The screen shows the coming
 * three years grouped by project and filterable by farm, so this returns the
 * whole set ordered by farm then cycle.
 */
export async function listPlans(projectId: string): Promise<SamplingPlan[]> {
  if (DATA_MODE === "fixtures") {
    return DEMO_PLANS.filter((p) => p.projectId === projectId);
  }
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT c.cycle_id, c.farm_id, f.name AS farm_name, f.project_id,
            c.cycle_number, c.cycle_type, c.approach, c.collect_texture,
            c.texture_depth_cm, c.trigger_type, c.depth_scheme,
            c.planned_start, c.planned_end, c.confidence_alpha,
            c.power_1_minus_beta, c.mdd_target, c.same_season,
            c.revisit_points, c.status, c.generated_by, c.approved_at,
            ( SELECT count(*) FROM mrv.sampling_events ev
               WHERE ev.cycle_id = c.cycle_id )::int AS planned_points
       FROM mrv.sampling_cycles c
       JOIN mrv.farms f ON f.farm_id = c.farm_id
      WHERE f.project_id = $1
      ORDER BY f.name, c.cycle_number`,
    [projectId],
  );
  return rows.map((r) => ({
    cycleId: String(r.cycle_id),
    farmId: String(r.farm_id),
    farmName: String(r.farm_name),
    projectId: String(r.project_id),
    cycleNumber: Number(r.cycle_number),
    cycleType: (r.cycle_type as SamplingPlan["cycleType"]) ?? "initial",
    approach: (r.approach as SamplingPlan["approach"]) ?? "QA2",
    collectTexture: Boolean(r.collect_texture),
    textureDepthCm: r.texture_depth_cm == null ? null : Number(r.texture_depth_cm),
    triggerType: (r.trigger_type as string | null) ?? null,
    depthScheme: String(r.depth_scheme ?? "0-15/15-30"),
    plannedStart: fmtDate(r.planned_start),
    plannedEnd: fmtDate(r.planned_end),
    confidenceAlpha: num(r.confidence_alpha),
    power: num(r.power_1_minus_beta),
    mddTarget: num(r.mdd_target),
    sameSeason: Boolean(r.same_season),
    revisitPoints: Boolean(r.revisit_points),
    status: (r.status as SamplingPlan["status"]) ?? "draft",
    generatedBy: String(r.generated_by ?? "manual"),
    approvedAt: fmtDate(r.approved_at),
    plannedPoints: Number(r.planned_points ?? 0),
  }));
}

/** All work orders for a project (spec §6.5). */
export async function listWorkOrders(projectId: string): Promise<WorkOrder[]> {
  if (DATA_MODE === "fixtures") {
    const farmIds = new Set(
      DEMO_FARMS.filter((f) => f.projectId === projectId).map((f) => f.farmId),
    );
    return DEMO_WORK_ORDERS.filter((w) => farmIds.has(w.farmId));
  }
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT w.wo_id, w.farm_id, f.name AS farm_name, w.cycle_id,
            c.cycle_number, c.cycle_type, c.approach,
            w.contractor_name, w.contractor_email, w.project_lead,
            w.window_start, w.window_end, w.depth_scheme, w.state,
            w.pdf_url, w.issued_at, w.closed_at,
            l.lab_id, l.name AS lab_name, l.iso_17025, l.napt_member,
            l.glosolan_member, l.default_method, l.contact AS lab_contact
       FROM mrv.work_orders w
       JOIN mrv.farms f ON f.farm_id = w.farm_id
       JOIN mrv.sampling_cycles c ON c.cycle_id = w.cycle_id
       LEFT JOIN mrv.labs l ON l.lab_id = w.lab_id
      WHERE f.project_id = $1
      ORDER BY w.created_at DESC`,
    [projectId],
  );
  const out: WorkOrder[] = [];
  for (const r of rows) out.push(await hydrateWorkOrder(r));
  return out;
}

/** One work order with its points and token. */
export async function getWorkOrder(woId: string): Promise<WorkOrder | null> {
  if (DATA_MODE === "fixtures") {
    return DEMO_WORK_ORDERS.find((w) => w.woId === woId) ?? null;
  }
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT w.wo_id, w.farm_id, f.name AS farm_name, w.cycle_id,
            c.cycle_number, c.cycle_type, c.approach,
            w.contractor_name, w.contractor_email, w.project_lead,
            w.window_start, w.window_end, w.depth_scheme, w.state,
            w.pdf_url, w.issued_at, w.closed_at,
            l.lab_id, l.name AS lab_name, l.iso_17025, l.napt_member,
            l.glosolan_member, l.default_method, l.contact AS lab_contact
       FROM mrv.work_orders w
       JOIN mrv.farms f ON f.farm_id = w.farm_id
       JOIN mrv.sampling_cycles c ON c.cycle_id = w.cycle_id
       LEFT JOIN mrv.labs l ON l.lab_id = w.lab_id
      WHERE w.wo_id = $1`,
    [woId],
  );
  return rows.length ? hydrateWorkOrder(rows[0]) : null;
}

/** Attach the sampling-points table and the current token to a work-order row. */
async function hydrateWorkOrder(r: Record<string, unknown>): Promise<WorkOrder> {
  const { query } = await import("../db");
  const woId = String(r.wo_id);

  const pointRows = await query<Record<string, unknown>>(
    `SELECT s.sample_id, sp.point_id, s.stratum_code, sp.scenario,
            ST_Y(sp.planned_geom) AS lat, ST_X(sp.planned_geom) AS lon,
            sp.composite_cores, sp.is_revisit
       FROM mrv.sampling_events ev
       JOIN mrv.sampling_points sp ON sp.point_id = ev.point_id
       LEFT JOIN mrv.samples s ON s.event_id = ev.event_id AND s.sample_type = 'soc'
      WHERE ev.work_order_id = $1
      ORDER BY s.sample_id NULLS LAST, sp.point_id`,
    [woId],
  );

  const tokenRows = await query<Record<string, unknown>>(
    `SELECT token_id, work_order_id, contractor_email, issued_at,
            expires_at, revoked_at, last_used_at
       FROM mrv.mcp_tokens WHERE work_order_id = $1
      ORDER BY issued_at DESC LIMIT 1`,
    [woId],
  );

  const depthScheme = String(r.depth_scheme ?? "0-15/15-30");
  return {
    woId,
    farmId: String(r.farm_id),
    farmName: String(r.farm_name),
    cycleId: String(r.cycle_id),
    cycleNumber: Number(r.cycle_number),
    cycleType: (r.cycle_type as WorkOrder["cycleType"]) ?? "initial",
    approach: (r.approach as WorkOrder["approach"]) ?? "QA2",
    contractorName: (r.contractor_name as string | null) ?? null,
    contractorEmail: (r.contractor_email as string | null) ?? null,
    lab: r.lab_id
      ? {
          labId: String(r.lab_id),
          name: String(r.lab_name),
          iso17025: Boolean(r.iso_17025),
          naptMember: Boolean(r.napt_member),
          glosolanMember: Boolean(r.glosolan_member),
          defaultMethod: (r.default_method as string | null) ?? null,
          contact: (r.lab_contact as string | null) ?? null,
        }
      : null,
    projectLead: (r.project_lead as string | null) ?? null,
    windowStart: fmtDate(r.window_start),
    windowEnd: fmtDate(r.window_end),
    depthScheme,
    state: (r.state as WorkOrder["state"]) ?? "draft",
    pdfUrl: (r.pdf_url as string | null) ?? null,
    issuedAt: r.issued_at ? new Date(String(r.issued_at)).toISOString() : null,
    closedAt: r.closed_at ? new Date(String(r.closed_at)).toISOString() : null,
    points: pointRows.map((p) => ({
      sampleId: String(p.sample_id ?? ""),
      pointId: String(p.point_id),
      stratumCode: (p.stratum_code as string | null) ?? null,
      scenario: (p.scenario as WorkOrderPoint["scenario"]) ?? "WP",
      lat: Number(p.lat),
      lon: Number(p.lon),
      depthScheme,
      compositeCores: p.composite_cores == null ? null : Number(p.composite_cores),
      isRevisit: Boolean(p.is_revisit),
    })),
    token: tokenRows.length
      ? {
          tokenId: String(tokenRows[0].token_id),
          workOrderId: woId,
          contractorEmail: (tokenRows[0].contractor_email as string | null) ?? null,
          issuedAt: new Date(String(tokenRows[0].issued_at)).toISOString(),
          expiresAt: new Date(String(tokenRows[0].expires_at)).toISOString(),
          revokedAt: tokenRows[0].revoked_at
            ? new Date(String(tokenRows[0].revoked_at)).toISOString()
            : null,
          lastUsedAt: tokenRows[0].last_used_at
            ? new Date(String(tokenRows[0].last_used_at)).toISOString()
            : null,
        }
      : null,
  };
}

/**
 * Everything the Plot Details screen needs (spec §6.3), in one payload.
 * Returns null when the plot does not exist.
 */
export async function getPlotDetail(plotId: string): Promise<PlotDetail | null> {
  if (DATA_MODE === "fixtures") {
    const plot = DEMO_PLOTS.find((p) => p.plotId === plotId);
    if (!plot) return null;
    const farmBase = DEMO_FARMS.find((f) => f.farmId === plot.farmId)!;
    const farm = withTotals(farmBase, DEMO_PLOTS);
    const points = DEMO_SAMPLING_POINTS.filter((sp) => sp.plotId === plotId);
    const pointIds = new Set(points.map((p) => p.pointId));
    const samples = DEMO_SAMPLES.filter((s) => pointIds.has(s.pointId));
    const sampleIds = new Set(samples.map((s) => s.sampleId));
    return {
      plot,
      farm,
      points,
      samples,
      soc: DEMO_SOC.filter((m) => sampleIds.has(m.sampleId)),
      texture: DEMO_TEXTURE.filter((t) => sampleIds.has(t.sampleId)),
      activities: DEMO_ACTIVITIES.filter((a) => a.plotId === plotId),
      modelRuns: DEMO_MODEL_RUNS,
    };
  }

  const { query } = await import("../db");
  const plotRows = await query<Record<string, unknown>>(
    `SELECT plot_id, farm_id, name, ST_AsGeoJSON(geom)::json AS geom,
            area_ha, application_area_ha, quantification_approach, crop,
            stroke_color, is_demo
       FROM mrv.plots WHERE plot_id = $1`,
    [plotId],
  );
  if (!plotRows.length) return null;
  const plot = rowToPlot(plotRows[0]);

  const farmRows = await query<Record<string, unknown>>(
    `SELECT f.farm_id, f.project_id, f.name, f.installation_code, f.operator,
            f.country, f.region, f.climate_zone, f.irrigation_method, f.status, f.is_demo,
            count(p.plot_id)::int              AS plot_count,
            coalesce(sum(p.area_ha), 0)::float AS total_area_ha
       FROM mrv.farms f LEFT JOIN mrv.plots p ON p.farm_id = f.farm_id
      WHERE f.farm_id = $1 GROUP BY f.farm_id`,
    [plot.farmId],
  );

  const pointRows = await query<Record<string, unknown>>(
    `SELECT point_id, plot_id, bsl_id, scenario,
            ST_X(planned_geom) AS lon, ST_Y(planned_geom) AS lat,
            composite_cores, is_revisit, status
       FROM mrv.sampling_points WHERE plot_id = $1 ORDER BY point_id`,
    [plotId],
  );

  const sampleRows = await query<Record<string, unknown>>(
    `SELECT s.sample_id, e.point_id, s.sample_type, s.stratum_code, s.scenario,
            s.depth_top_cm, s.depth_base_cm, s.composite_cores, s.barcode,
            s.sampling_date, e.distance_from_target_m, e.photo_url, e.field_notes
       FROM mrv.samples s
       JOIN mrv.sampling_events e ON e.event_id = s.event_id
       JOIN mrv.sampling_points sp ON sp.point_id = e.point_id
      WHERE sp.plot_id = $1
      ORDER BY s.sample_id`,
    [plotId],
  );

  const socRows = await query<Record<string, unknown>>(
    `SELECT m.sample_id, m.method, m.analysis_date, m.depth_top_cm, m.depth_base_cm,
            m.bulk_density, m.toc_400_pct, m.roc_600_pct, m.tic_900_pct,
            m.toc_pct, m.soc_t_per_ha, m.soil_mass_t_ha
       FROM mrv.soc_measurements m
       JOIN mrv.samples s ON s.sample_id = m.sample_id
       JOIN mrv.sampling_events e ON e.event_id = s.event_id
       JOIN mrv.sampling_points sp ON sp.point_id = e.point_id
      WHERE sp.plot_id = $1
      ORDER BY m.sample_id, m.depth_top_cm`,
    [plotId],
  );

  const textureRows = await query<Record<string, unknown>>(
    `SELECT t.sample_id, t.sand_pct, t.silt_pct, t.clay_pct, t.usda_class, t.depth_cm
       FROM mrv.texture_measurements t
       JOIN mrv.samples s ON s.sample_id = t.sample_id
       JOIN mrv.sampling_events e ON e.event_id = s.event_id
       JOIN mrv.sampling_points sp ON sp.point_id = e.point_id
      WHERE sp.plot_id = $1`,
    [plotId],
  );

  const actRows = await query<Record<string, unknown>>(
    `SELECT a.activity_id, a.plot_id, a.activity_type, a.rate, a.rate_unit,
            a.application_area_ha, a.application_date, a.season, a.scenario, a.notes,
            p.name AS product_name, p.activity_type AS product_activity_type,
            p.activity_label, p.cost_per_ha_usd, p.credit_per_ha
       FROM mrv.alm_activities a
       LEFT JOIN mrv.products p ON p.product_id = a.product_id
      WHERE a.plot_id = $1
      ORDER BY a.application_date NULLS LAST`,
    [plotId],
  );

  const runRows = await query<Record<string, unknown>>(
    `SELECT run_id, model, model_version, run_type, scenario, status,
            uncertainty_method, monte_carlo_iters, period_start, period_end
       FROM mrv.model_runs WHERE farm_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [plot.farmId],
  );

  return {
    plot,
    farm: rowToFarm(farmRows[0]),
    points: pointRows.map((r) => ({
      pointId: String(r.point_id),
      plotId: (r.plot_id as string | null) ?? null,
      bslId: (r.bsl_id as string | null) ?? null,
      scenario: (r.scenario as SamplingPoint["scenario"]) ?? "WP",
      lonLat: [Number(r.lon), Number(r.lat)] as [number, number],
      compositeCores: r.composite_cores == null ? null : Number(r.composite_cores),
      isRevisit: Boolean(r.is_revisit),
      status: (r.status as SamplingPoint["status"]) ?? "planned",
    })),
    samples: sampleRows.map((r) => ({
      sampleId: String(r.sample_id),
      pointId: String(r.point_id),
      sampleType: (r.sample_type as SampleRow["sampleType"]) ?? "soc",
      stratumCode: (r.stratum_code as string | null) ?? null,
      scenario: (r.scenario as SampleRow["scenario"]) ?? "WP",
      depthTopCm: r.depth_top_cm == null ? null : Number(r.depth_top_cm),
      depthBaseCm: r.depth_base_cm == null ? null : Number(r.depth_base_cm),
      compositeCores: r.composite_cores == null ? null : Number(r.composite_cores),
      barcode: (r.barcode as string | null) ?? null,
      samplingDate: fmtDate(r.sampling_date),
      distanceFromTargetM:
        r.distance_from_target_m == null ? null : Number(r.distance_from_target_m),
      photoUrl: (r.photo_url as string | null) ?? null,
      fieldNotes: (r.field_notes as string | null) ?? null,
    })),
    soc: socRows.map((r) => ({
      sampleId: String(r.sample_id),
      method: String(r.method ?? "dry_combustion"),
      analysisDate: fmtDate(r.analysis_date),
      depthTopCm: Number(r.depth_top_cm),
      depthBaseCm: Number(r.depth_base_cm),
      bulkDensity: num(r.bulk_density),
      toc400Pct: num(r.toc_400_pct),
      roc600Pct: num(r.roc_600_pct),
      tic900Pct: num(r.tic_900_pct),
      tocPct: num(r.toc_pct),
      socTPerHa: num(r.soc_t_per_ha),
      soilMassTHa: num(r.soil_mass_t_ha),
    })),
    texture: textureRows.map((r) => ({
      sampleId: String(r.sample_id),
      sandPct: Number(r.sand_pct),
      siltPct: Number(r.silt_pct),
      clayPct: Number(r.clay_pct),
      usdaClass: String(r.usda_class ?? ""),
      depthCm: r.depth_cm == null ? null : Number(r.depth_cm),
    })),
    activities: actRows.map((r) => ({
      activityId: String(r.activity_id),
      plotId: String(r.plot_id),
      product: r.product_name
        ? {
            name: String(r.product_name),
            activityType: String(r.product_activity_type ?? ""),
            activityLabel: String(r.activity_label ?? ""),
            costPerHaUsd: num(r.cost_per_ha_usd),
            creditPerHa: num(r.credit_per_ha),
          }
        : null,
      activityType: String(r.activity_type),
      rate: num(r.rate),
      rateUnit: (r.rate_unit as string | null) ?? null,
      applicationAreaHa: num(r.application_area_ha),
      applicationDate: fmtDate(r.application_date),
      season: (r.season as string | null) ?? null,
      scenario: (r.scenario as SampleRow["scenario"]) ?? "PR",
      notes: (r.notes as string | null) ?? null,
    })),
    modelRuns: runRows.map((r) => ({
      runId: String(r.run_id),
      model: String(r.model),
      modelVersion: (r.model_version as string | null) ?? null,
      runType: (r.run_type as string | null) ?? null,
      scenario: String(r.scenario ?? "paired"),
      status: String(r.status ?? ""),
      uncertaintyMethod: (r.uncertainty_method as string | null) ?? null,
      monteCarloIters: r.monte_carlo_iters == null ? null : Number(r.monte_carlo_iters),
      periodStart: fmtDate(r.period_start),
      periodEnd: fmtDate(r.period_end),
    })),
  };
}

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}
function fmtDate(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
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
    // Deliberately not defaulted. A missing zone used to become "dry",
    // which quietly picked a parameter set and so quietly picked a credit
    // volume. It now stays null and resolveParameters() refuses it.
    climateZone: (r.climate_zone as Farm["climateZone"]) ?? null,
    irrigationMethod: (r.irrigation_method as Farm["irrigationMethod"]) ?? null,
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
