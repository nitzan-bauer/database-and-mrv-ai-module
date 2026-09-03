import "server-only";
import { DATA_MODE } from "../env";
import type {
  AdditionalityAssessment,
  BaselineSite,
  ClimateZone,
  Farm,
  FarmWithPlots,
  IrrigationMethod,
  Plot,
  PlotDetail,
  Project,
  SampleRow,
  PddDraft,
  SamplingPlan,
  SamplingPoint,
  WorkOrder,
  WorkOrderPoint,
} from "./types";
import type { ActivityData } from "../ghg/engine";
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
      `SELECT project_id, name, methodology, is_grouped, country, status, is_demo, google_doc_id, google_doc_url,
              readiness_report_doc_id, readiness_report_doc_url, eligibility_pack_doc_id, eligibility_pack_doc_url,
              last_pdd_pipeline_run_at, pdd_generator_locked_at
         FROM mrv.projects ORDER BY name`,
    )
  ).map(rowToProject);
}

export async function getProject(projectId: string): Promise<Project | null> {
  const all = await listProjects();
  return all.find((p) => p.projectId === projectId) ?? null;
}

/**
 * Which project a single-project-scoped page (Factory, PDD questionnaire)
 * should show. Picking `projects[0]` broke the moment a second project
 * existed: `listProjects()` sorts by name, so which project lands at [0]
 * is an accident of naming, not a choice — a real project could silently
 * replace the demo one a page had always shown, or (the opposite problem)
 * be unreachable because it never sorts first.
 *
 * Explicit id (from `?project=`) wins. Otherwise default to the demo
 * project — matching every page's existing behaviour today — so nothing
 * changes for existing links until a person deliberately switches.
 */
export function resolveActiveProject(projects: Project[], requestedId?: string): Project {
  const requested = requestedId ? projects.find((p) => p.projectId === requestedId) : undefined;
  if (requested) return requested;
  return projects.find((p) => p.isDemo) ?? projects[0];
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
            f.drive_folder_id,
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
            f.drive_folder_id,
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
    googleDocId: (r.google_doc_id as string | null) ?? null,
    googleDocUrl: (r.google_doc_url as string | null) ?? null,
    readinessReportDocId: (r.readiness_report_doc_id as string | null) ?? null,
    readinessReportDocUrl: (r.readiness_report_doc_url as string | null) ?? null,
    eligibilityPackDocId: (r.eligibility_pack_doc_id as string | null) ?? null,
    eligibilityPackDocUrl: (r.eligibility_pack_doc_url as string | null) ?? null,
    lastPddPipelineRunAt: r.last_pdd_pipeline_run_at
      ? new Date(r.last_pdd_pipeline_run_at as string | Date).toISOString()
      : null,
    pddGeneratorLockedAt: r.pdd_generator_locked_at
      ? new Date(r.pdd_generator_locked_at as string | Date).toISOString()
      : null,
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
    driveFolderId: (r.drive_folder_id as string | null) ?? null,
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

/* ─────────────────────── writes (admin only) ───────────────────────── */

/**
 * Record a farm's climate zone and irrigation method.
 *
 * These two fields decide EF_N_direct and Frac_LEACH, so between them they
 * move the claimed reduction by more than a factor of two. They are the only
 * farm fields the module writes, and they are written one farm at a time and
 * never in bulk: irrigation varies farm by farm — drip runs at scale across
 * East Africa as much as in Israel — so there is no rule that could set them
 * from the country, the region, or a neighbouring farm.
 *
 * mrv.farms carries an audit trigger (migration 0008), so the before/after
 * lands in mrv.audit_log without anything extra here. `actor` is recorded for
 * the same reason: a VVB asking why a figure changed gets a name and a time.
 */
export async function setFarmContext(
  farmId: string,
  climateZone: ClimateZone | null,
  irrigationMethod: IrrigationMethod | null,
  actor: string,
): Promise<void> {
  if (DATA_MODE === "fixtures") {
    throw new Error("setFarmContext: not available in fixtures mode — fixtures are read-only.");
  }
  const { query } = await import("../db");
  await query(
    `UPDATE mrv.farms
        SET climate_zone      = $2::mrv.climate_zone,
            irrigation_method = $3::mrv.irrigation_method
      WHERE farm_id = $1`,
    [farmId, climateZone, irrigationMethod],
  );
  await query(
    `INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
     VALUES ($1, 'set_farm_context', 'farm', $2, $3::jsonb)`,
    [actor, farmId, JSON.stringify({ climateZone, irrigationMethod })],
  );
}

/* ───────────────────── compliance (db mode reads) ───────────────────── */

export interface DbComplianceCheck {
  ruleCode: string;
  isHard: boolean;
  result: "pass" | "warn" | "fail";
  detail: string | null;
  vm0042Ref: string | null;
  evaluatedAt: string;
}

export interface DbComplianceScore {
  score: number;
  hardPassed: number;
  hardTotal: number;
  warnings: number;
  evaluatedAt: string;
  cycleId: string;
  cycleNumber: number;
  checks: DbComplianceCheck[];
}

/**
 * The latest compliance evaluation for a farm, straight from the engine's
 * own tables.
 *
 * In db mode the module deliberately does NOT re-run its TypeScript mirror
 * of the rules and show that instead: mrv.evaluate_compliance() is the
 * authority, its rows are what a VVB is shown, and a screen that recomputed
 * them client-side would drift the day one rule changes in only one place.
 * The mirror stays for fixtures mode, where there is no database to ask.
 *
 * Returns null when the farm has never been evaluated — which the screen
 * should say plainly rather than showing a fixture score that looks real.
 */
export async function getLatestCompliance(farmId: string): Promise<DbComplianceScore | null> {
  if (DATA_MODE === "fixtures") return null;
  const { query } = await import("../db");

  const scores = await query<Record<string, unknown>>(
    `SELECT s.score, s.hard_passed, s.hard_total, s.warnings, s.evaluated_at,
            s.cycle_id, c.cycle_number
       FROM mrv.compliance_scores s
       JOIN mrv.sampling_cycles c ON c.cycle_id = s.cycle_id
      WHERE s.farm_id = $1
      ORDER BY s.evaluated_at DESC
      LIMIT 1`,
    [farmId],
  );
  if (!scores.length) return null;
  const s = scores[0];

  // The checks from the same evaluation run. evaluate_compliance() clears
  // and rewrites the farm-cycle's checks each run, so the latest set for
  // this cycle is the set that produced this score.
  const checks = await query<Record<string, unknown>>(
    `SELECT rule_code, is_hard, result::text AS result, detail, vm0042_ref, evaluated_at
       FROM mrv.compliance_checks
      WHERE farm_id = $1 AND cycle_id = $2
      ORDER BY is_hard DESC, rule_code`,
    [farmId, String(s.cycle_id)],
  );

  return {
    score: Number(s.score),
    hardPassed: Number(s.hard_passed),
    hardTotal: Number(s.hard_total),
    warnings: Number(s.warnings),
    evaluatedAt: String(s.evaluated_at),
    cycleId: String(s.cycle_id),
    cycleNumber: Number(s.cycle_number),
    checks: checks.map((r) => ({
      ruleCode: String(r.rule_code),
      isHard: Boolean(r.is_hard),
      result: String(r.result) as DbComplianceCheck["result"],
      detail: (r.detail as string | null) ?? null,
      vm0042Ref: (r.vm0042_ref as string | null) ?? null,
      evaluatedAt: String(r.evaluated_at),
    })),
  };
}

/* ─────────────────────── admin (db mode reads) ─────────────────────── */

/**
 * The people and identities the module actually knows about, for Admin.
 *
 * Shaped to the same AdminUser the fixtures use, so the screen renders both
 * without caring which mode it is in. Roles come from project_memberships;
 * live sampler tokens appear as identities too, because they are — a token
 * is something that can act, and an access review that misses it reviews
 * the wrong list.
 */
export async function listAdminUsers(): Promise<import("./fixtures").AdminUser[]> {
  if (DATA_MODE === "fixtures") {
    const { DEMO_ADMIN_USERS } = await import("./fixtures");
    return DEMO_ADMIN_USERS;
  }
  const { query } = await import("../db");

  const users = await query<Record<string, unknown>>(
    `SELECT u.full_name, u.email, u.auth_method::text AS auth_method, u.is_active,
            u.last_active_at,
            coalesce(string_agg(DISTINCT m.role::text, ', '), 'no role yet') AS role,
            coalesce(string_agg(DISTINCT m.project_id, ', '), '—')           AS scope
       FROM mrv.users u
       LEFT JOIN mrv.project_memberships m ON m.user_id = u.user_id
      GROUP BY u.user_id
      ORDER BY u.full_name`,
  );

  const tokens = await query<Record<string, unknown>>(
    `SELECT t.contractor_email, t.work_order_id, t.last_used_at, w.contractor_name
       FROM mrv.mcp_tokens t
       JOIN mrv.work_orders w ON w.wo_id = t.work_order_id
      WHERE t.revoked_at IS NULL AND t.expires_at > clock_timestamp()
      ORDER BY t.issued_at DESC`,
  );

  return [
    ...users.map((u) => ({
      name: String(u.full_name),
      email: String(u.email),
      role: String(u.role),
      scope: String(u.scope),
      system: "MRV" as const,
      authMethod: (u.auth_method as "sso" | "password" | "mcp_token") ?? "sso",
      isActive: Boolean(u.is_active),
      lastActiveAt: u.last_active_at ? String(u.last_active_at).slice(0, 10) : null,
    })),
    ...tokens.map((t) => ({
      name: String(t.contractor_name ?? "Sampling contractor"),
      email: String(t.contractor_email ?? "—"),
      role: "Sampler · work-order scoped",
      scope: String(t.work_order_id),
      system: "MRV" as const,
      authMethod: "mcp_token" as const,
      isActive: true,
      lastActiveAt: t.last_used_at ? String(t.last_used_at).slice(0, 10) : null,
    })),
  ];
}

/** The live agent action policies — the same rows checkPolicy() enforces. */
export async function listAgentPolicies(): Promise<
  Array<{ action: string; mode: "auto" | "confirm" | "off"; note: string }>
> {
  if (DATA_MODE === "fixtures") {
    const { DEMO_AGENT_POLICIES } = await import("./fixtures");
    return DEMO_AGENT_POLICIES;
  }
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT action_name, mode::text AS mode, note FROM mrv.agent_action_policies ORDER BY action_name`,
  );
  return rows.map((r) => ({
    action: String(r.action_name),
    mode: (r.mode as "auto" | "confirm" | "off") ?? "confirm",
    note: String(r.note ?? ""),
  }));
}

/** The most recent audit entries, newest first. */
export async function listAuditLog(limit = 40): Promise<
  Array<{ ts: string; actor: string; actorRole: string; action: string; targetType: string; targetId: string }>
> {
  if (DATA_MODE === "fixtures") {
    const { DEMO_AUDIT } = await import("./fixtures");
    return DEMO_AUDIT;
  }
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT ts, actor, coalesce(actor_role::text, '') AS actor_role, action,
            coalesce(target_type, '') AS target_type, coalesce(target_id, '') AS target_id
       FROM mrv.audit_log ORDER BY ts DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    ts: new Date(String(r.ts)).toISOString(),
    actor: String(r.actor),
    actorRole: String(r.actor_role),
    action: String(r.action),
    targetType: String(r.target_type),
    targetId: String(r.target_id),
  }));
}

/** Whether any GHG activity data exists for a farm — drives the GHG screen's honesty. */
export async function countActivityData(farmId: string): Promise<number> {
  if (DATA_MODE === "fixtures") return -1; // fixtures always have their demo set
  const { query } = await import("../db");
  const rows = await query<{ n: string }>(
    `SELECT count(*)::text n FROM mrv.activity_data WHERE farm_id = $1`,
    [farmId],
  );
  return Number(rows[0].n);
}

/** The fertilizer catalog (mrv.fertilizers) — what a farm's activity-data entry can be matched against. */
export async function listFertilizers(): Promise<
  Array<{ name: string; nContent: number; class: string }>
> {
  if (DATA_MODE === "fixtures") return [];
  const { query } = await import("../db");
  const rows = await query<{ name: string; n_content: string; class: string }>(
    `SELECT name, n_content, class::text FROM mrv.fertilizers ORDER BY name`,
  );
  return rows.map((r) => ({ name: r.name, nContent: Number(r.n_content), class: r.class }));
}

/** A project's recorded VM0042 §7 additionality assessments, newest first. */
export async function listAdditionalityAssessments(projectId: string): Promise<AdditionalityAssessment[]> {
  if (DATA_MODE === "fixtures") return [];
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT assessment_id, regulatory_surplus_met, regulatory_surplus_note, barriers,
            common_practice_region, common_practice_adoption_pct, step4c_demonstrated, step4c_note,
            assessed_by, assessed_at
       FROM mrv.additionality_assessments WHERE project_id = $1 ORDER BY assessed_at DESC`,
    [projectId],
  );
  return rows.map((r) => {
    const adoptionPct = r.common_practice_adoption_pct == null ? null : Number(r.common_practice_adoption_pct);
    const step4c = Boolean(r.step4c_demonstrated);
    const commonPracticeMet = adoptionPct != null && adoptionPct < 20 ? true : step4c;
    const barriers = (r.barriers ?? []) as AdditionalityAssessment["barriers"];
    return {
      assessmentId: String(r.assessment_id),
      regulatorySurplusMet: Boolean(r.regulatory_surplus_met),
      regulatorySurplusNote: String(r.regulatory_surplus_note),
      barriers,
      commonPracticeRegion: String(r.common_practice_region),
      commonPracticeAdoptionPct: adoptionPct,
      step4cDemonstrated: step4c,
      step4cNote: r.step4c_note ? String(r.step4c_note) : null,
      commonPracticeMet,
      overallMet: Boolean(r.regulatory_surplus_met) && barriers.length > 0 && commonPracticeMet,
      assessedBy: String(r.assessed_by),
      assessedAt: new Date(String(r.assessed_at)).toISOString(),
    };
  });
}

/** A project's generated PDD drafts, newest first. */
export async function listPddDrafts(projectId: string): Promise<PddDraft[]> {
  if (DATA_MODE === "fixtures") return [];
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT d.draft_id, t.name AS template_name, t.version AS template_version,
            d.sections_total, d.sections_filled, d.content, d.generated_by, d.generated_at
       FROM mrv.pdd_drafts d JOIN mrv.pdd_templates t ON t.template_id = d.template_id
      WHERE d.project_id = $1 ORDER BY d.generated_at DESC`,
    [projectId],
  );
  return rows.map((r) => ({
    draftId: String(r.draft_id),
    templateName: String(r.template_name),
    templateVersion: String(r.template_version),
    sectionsTotal: Number(r.sections_total),
    sectionsFilled: Number(r.sections_filled),
    content: String(r.content),
    generatedBy: String(r.generated_by),
    generatedAt: new Date(String(r.generated_at)).toISOString(),
  }));
}

/** A farm's recorded QA2 baseline control sites. */
export async function listBaselineSites(farmId: string): Promise<BaselineSite[]> {
  if (DATA_MODE === "fixtures") return [];
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT bsl_id, farm_id, linked_plot_id, ST_AsGeoJSON(geom)::json AS geom,
            area_ha, distance_km, similarity_criteria, created_at
       FROM mrv.baseline_control_sites WHERE farm_id = $1 ORDER BY bsl_id`,
    [farmId],
  );
  return rows.map((r) => ({
    bslId: String(r.bsl_id),
    farmId: String(r.farm_id),
    linkedPlotId: r.linked_plot_id ? String(r.linked_plot_id) : null,
    geom: r.geom as BaselineSite["geom"],
    areaHa: Number(r.area_ha),
    distanceKm: Number(r.distance_km),
    criteria: (r.similarity_criteria ?? []) as BaselineSite["criteria"],
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}

/**
 * A farm's real GHG activity data — fuel, residue, N-fixing crops, and
 * fertilizer applications — shaped exactly like the engine's own
 * ActivityData, so the GHG page can hand it straight to computeReduction /
 * explainFarmYear with no translation step of its own.
 *
 * mrv.fertilizer_class carries three values because the catalog
 * distinguishes urea from other synthetics for other reasons; the engine's
 * N2O math only branches on synthetic vs organic (VM0042 eq 18-23 apply
 * FRAC_GASF to any synthetic and FRAC_GASM to organic, regardless of which
 * synthetic fertilizer it is), so both synthetic variants collapse to
 * "synthetic" here.
 */
export async function listActivityData(farmId: string): Promise<ActivityData[]> {
  if (DATA_MODE === "fixtures") {
    const { DEMO_ACTIVITY_DATA } = await import("./fixtures");
    return DEMO_ACTIVITY_DATA.filter((a) => a.farmId === farmId);
  }
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT activity_data_id, scenario::text, year, area_ha, diesel_l, gasoline_l,
            residue_burnt_kg, nfix_dry_matter_t, nfix_n_content
       FROM mrv.activity_data
      WHERE farm_id = $1 AND scenario IN ('BSL','PR')
      ORDER BY year`,
    [farmId],
  );
  const out: ActivityData[] = [];
  for (const r of rows) {
    const ferts = await query<{
      fertilizer_name: string;
      mass_t: string;
      n_content: string;
      class: string;
      interval_years: number;
    }>(
      `SELECT fertilizer_name, mass_t, n_content, class::text, interval_years
         FROM mrv.fertilizer_applications WHERE activity_data_id = $1 ORDER BY application_id`,
      [r.activity_data_id],
    );
    out.push({
      farmId,
      scenario: r.scenario as "BSL" | "PR",
      year: Number(r.year),
      areaHa: Number(r.area_ha),
      dieselL: Number(r.diesel_l),
      gasolineL: Number(r.gasoline_l),
      residueBurntKg: Number(r.residue_burnt_kg),
      nfixDryMatterT: Number(r.nfix_dry_matter_t),
      nfixNContent: Number(r.nfix_n_content),
      fertilizers: ferts.map((f) => ({
        fertilizerName: f.fertilizer_name,
        massT: Number(f.mass_t),
        nContent: Number(f.n_content),
        class: f.class === "organic" ? "organic" : "synthetic",
        intervalYears: Number(f.interval_years),
      })),
    });
  }
  return out;
}

/** Whether any QA1 model run exists — drives the Model Run Console's honesty. */
export async function countModelRuns(): Promise<number> {
  if (DATA_MODE === "fixtures") return -1; // fixtures carry their demo run
  const { query } = await import("../db");
  const rows = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.model_runs`);
  return Number(rows[0].n);
}

/* ──────────────── the Verified Credits Factory (Tier-2) ──────────────── */

export interface AgentRecord {
  agentId: string;
  displayName: string;
  title: string;
  reportsTo: string | null;
  mission: string;
  owns: string;
  rolePrompt: string;
  /** Callable today — a real handler exists behind every name here. */
  tools: string[];
  skills: string[];
  plannedSkills: string[];
  /** Named in policy or the specification, but with no implementation yet. */
  plannedTools: string[];
  actorId: string;
  avatarHue: number;
  isActive: boolean;
  /** Actions this agent has taken, from mrv.audit_log. */
  actionCount: number;
  lastActedAt: string | null;
}

/**
 * The department, in reporting order.
 *
 * The action count and last-acted time come from the audit log rather than
 * from a status column, so an agent cannot appear busy without having done
 * something. Nothing here is a claim about a plan — it is what the agent has
 * actually written.
 */
export async function listAgents(): Promise<AgentRecord[]> {
  if (DATA_MODE === "fixtures") return [];
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT a.agent_id, a.display_name, a.title, a.reports_to, a.mission, a.owns,
            a.role_prompt, a.tools, a.skills, a.planned_skills, a.planned_tools, a.actor_id,
            a.avatar_hue, a.is_active,
            ( SELECT count(*) FROM mrv.audit_log l WHERE l.actor = a.actor_id )::int AS action_count,
            ( SELECT max(l.ts)  FROM mrv.audit_log l WHERE l.actor = a.actor_id )     AS last_acted_at
       FROM mrv.agents a
      ORDER BY a.sort_order`,
  );
  return rows.map((r) => ({
    agentId: String(r.agent_id),
    displayName: String(r.display_name),
    title: String(r.title),
    reportsTo: (r.reports_to as string | null) ?? null,
    mission: String(r.mission),
    owns: String(r.owns),
    rolePrompt: String(r.role_prompt),
    tools: (r.tools as string[]) ?? [],
    skills: (r.skills as string[]) ?? [],
    plannedSkills: (r.planned_skills as string[]) ?? [],
    plannedTools: (r.planned_tools as string[]) ?? [],
    actorId: String(r.actor_id),
    avatarHue: Number(r.avatar_hue ?? 160),
    isActive: Boolean(r.is_active),
    actionCount: Number(r.action_count ?? 0),
    lastActedAt: r.last_acted_at ? new Date(String(r.last_acted_at)).toISOString() : null,
  }));
}

/** One agent, for the runtime — it needs exactly one record, not the roster. */
export async function getAgent(agentId: string): Promise<AgentRecord | null> {
  const all = await listAgents();
  return all.find((a) => a.agentId === agentId) ?? null;
}

export interface ScheduledTaskCard {
  taskKey: string;
  /** A few words, derived from task_key — the card/row label. */
  shortTitle: string;
  /** mrv.scheduled_tasks.title, verbatim — a full sentence, shown as context in the popup only. */
  fullTitle: string;
  /** 'pending' — added here, not a DB value — means the task has never run yet (last_run_status is NULL). */
  status: "ok" | "error" | "no_handler" | "pending";
  lastRunAt: string | null;
  nextRunAt: string;
  lastRunDetail: string | null;
}

const SCHEDULED_TASK_ACRONYMS = new Set(["kyc", "pdd", "crm", "vm0042", "saas"]);

/** "ron_kyc_followup" -> "KYC Followup" — task_key is already a short, meaningful identifier; `title` in the DB is a full descriptive sentence, not card-sized. */
function shortTitleFromTaskKey(taskKey: string, agentId: string): string {
  const stripped = taskKey.startsWith(`${agentId}_`) ? taskKey.slice(agentId.length + 1) : taskKey;
  return stripped
    .split("_")
    .map((w) => (SCHEDULED_TASK_ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * One agent's scheduled tasks, for the small status panel on its dashboard
 * page (Nitzan's own spec). Reads mrv.scheduled_tasks directly —
 * last_run_status/last_run_detail already carry both success/failure and a
 * human-readable summary per run (set by the cron route after every
 * invocation), so there is no need to reconstruct either from
 * scheduled_task_reports or the audit log.
 */
export async function listScheduledTasksForAgent(agentId: string): Promise<ScheduledTaskCard[]> {
  if (DATA_MODE === "fixtures") return [];
  const { query } = await import("../db");
  const rows = await query<Record<string, unknown>>(
    `SELECT task_key, title, last_run_status, last_run_at, next_run_at, last_run_detail
       FROM mrv.scheduled_tasks
      WHERE agent_id = $1 AND enabled
      ORDER BY task_key`,
    [agentId],
  );
  return rows.map((r) => ({
    taskKey: String(r.task_key),
    shortTitle: shortTitleFromTaskKey(String(r.task_key), agentId),
    fullTitle: String(r.title),
    status: (r.last_run_status as ScheduledTaskCard["status"] | null) ?? "pending",
    lastRunAt: r.last_run_at ? new Date(String(r.last_run_at)).toISOString() : null,
    nextRunAt: new Date(String(r.next_run_at)).toISOString(),
    lastRunDetail: (r.last_run_detail as string | null) ?? null,
  }));
}

export interface PipelineStage {
  key: string;
  label: string;
  count: number;
  unit: string;
  /** What has to happen for this stage to advance. */
  blocker: string | null;
}

/**
 * The credit pipeline, counted from the tables rather than tracked.
 *
 * A stage's number is a COUNT over the rows that stage produces, so it
 * cannot drift from reality the way a status field does — there is no
 * separate record to forget to update. Where a stage is at zero, the reason
 * is stated, because "0" on a control tower is only useful with the reason
 * beside it.
 */
export async function creditPipeline(): Promise<PipelineStage[]> {
  if (DATA_MODE === "fixtures") return [];
  const { query } = await import("../db");
  const n = async (sql: string) => Number((await query<{ n: string }>(sql))[0].n);

  const farms = await n(`SELECT count(*)::text n FROM mrv.farms`);
  const plots = await n(`SELECT count(*)::text n FROM mrv.plots`);
  const points = await n(`SELECT count(*)::text n FROM mrv.sampling_points`);
  const captured = await n(`SELECT count(*)::text n FROM mrv.sampling_events WHERE submitted_at IS NOT NULL`);
  const measured = await n(`SELECT count(*)::text n FROM mrv.soc_measurements`);
  const scored = await n(`SELECT count(*)::text n FROM mrv.compliance_scores`);
  const modelled = await n(`SELECT count(*)::text n FROM mrv.model_results`);
  const issued = await n(`SELECT count(*)::text n FROM mrv.vcu_issuances`);

  return [
    { key: "farms", label: "Farms enrolled", count: farms, unit: "farms", blocker: null },
    { key: "plots", label: "Plots mapped", count: plots, unit: "plots", blocker: null },
    { key: "planned", label: "Points planned", count: points, unit: "points", blocker: null },
    { key: "captured", label: "Points captured", count: captured, unit: "events", blocker: null },
    { key: "measured", label: "SOC measured", count: measured, unit: "measurements", blocker: null },
    {
      key: "scored",
      label: "Cycles scored",
      count: scored,
      unit: "cycles",
      blocker: null,
    },
    {
      key: "modelled",
      label: "Modelled (QA1)",
      count: modelled,
      unit: "runs",
      blocker: modelled === 0 ? "needs a second measured cycle before a model can be calibrated" : null,
    },
    {
      key: "issued",
      label: "VCUs issued",
      count: issued,
      unit: "issuances",
      blocker: issued === 0 ? "needs validation, then verification by a VVB" : null,
    },
  ];
}

/* ─────────────────────── PDD readiness (Rebeka) ───────────────────────── */

export interface PddTemplateInfo {
  name: string;
  version: string;
  sectionCount: number;
  registeredAt: string;
}

export interface ReadinessItem {
  key: string;
  label: string;
  ready: number;
  total: number;
  detail: string;
}

export interface PddReadiness {
  template: PddTemplateInfo | null;
  items: ReadinessItem[];
}

/**
 * How close a project is to having the evidence a PDD needs behind it —
 * not against the literal wording of whichever template is loaded (that
 * would mean guessing what an arbitrary section title requires, and the
 * whole point of storing the template as data is that its wording is not
 * assumed), but against the small set of things Rebeka's own role makes
 * her responsible for regardless of template version: described farms,
 * clean boundaries, a defined baseline, and an evaluated cycle.
 *
 * Every figure is an X/Y count over real rows, the same discipline as
 * creditPipeline: a status field would need to be kept in sync by hand and
 * would eventually disagree with the database; a count cannot.
 */
export async function pddReadiness(projectId: string): Promise<PddReadiness> {
  if (DATA_MODE === "fixtures") return { template: null, items: [] };
  const { query } = await import("../db");

  const tpl = await query<Record<string, unknown>>(
    `SELECT name, version, section_count, registered_at
       FROM mrv.pdd_templates ORDER BY registered_at DESC LIMIT 1`,
  );
  const template: PddTemplateInfo | null = tpl.length
    ? {
        name: String(tpl[0].name),
        version: String(tpl[0].version),
        sectionCount: Number(tpl[0].section_count),
        registeredAt: new Date(String(tpl[0].registered_at)).toISOString(),
      }
    : null;

  const farms = await query<{ n: string }>(
    `SELECT count(*)::text n FROM mrv.farms WHERE project_id = $1`,
    [projectId],
  );
  const totalFarms = Number(farms[0].n);
  if (totalFarms === 0) {
    return { template, items: [] };
  }

  const described = await query<{ n: string }>(
    `SELECT count(*)::text n FROM mrv.farms
      WHERE project_id = $1
        AND climate_zone IS NOT NULL
        AND (climate_zone = 'wet' OR irrigation_method IS NOT NULL)`,
    [projectId],
  );

  const plots = await query<{ total: string; valid: string }>(
    `SELECT count(*)::text total, count(*) FILTER (WHERE ST_IsValid(p.geom))::text valid
       FROM mrv.plots p JOIN mrv.farms f ON f.farm_id = p.farm_id
      WHERE f.project_id = $1`,
    [projectId],
  );

  const baseline = await query<{ n: string }>(
    `SELECT count(*)::text n FROM mrv.farms f
      WHERE f.project_id = $1
        AND (
          (SELECT count(*) FROM mrv.baseline_control_sites b WHERE b.farm_id = f.farm_id) >= 3
          OR EXISTS (SELECT 1 FROM mrv.model_runs r WHERE r.farm_id = f.farm_id)
        )`,
    [projectId],
  );

  const scored = await query<{ n: string }>(
    `SELECT count(DISTINCT s.farm_id)::text n FROM mrv.compliance_scores s
       JOIN mrv.farms f ON f.farm_id = s.farm_id WHERE f.project_id = $1`,
    [projectId],
  );

  const items: ReadinessItem[] = [
    {
      key: "described",
      label: "Farms fully described",
      ready: Number(described[0].n),
      total: totalFarms,
      detail: "climate zone set, and irrigation method set for every dry-zone farm",
    },
    {
      key: "boundaries",
      label: "Plot boundaries valid",
      ready: Number(plots[0].valid),
      total: Number(plots[0].total),
      detail: "geometrically valid — run Rebeka's QA/QC to find which ones are not",
    },
    {
      key: "baseline",
      label: "Baseline defined",
      ready: Number(baseline[0].n),
      total: totalFarms,
      detail: "≥3 baseline control sites (QA2) or a model run exists (QA1)",
    },
    {
      key: "evaluated",
      label: "Compliance evaluated",
      ready: Number(scored[0].n),
      total: totalFarms,
      detail: "at least one VM0042 compliance run recorded",
    },
  ];

  return { template, items };
}
