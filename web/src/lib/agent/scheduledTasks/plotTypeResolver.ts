import "server-only";
import type { SaasFinancingProject } from "../../saas/saasClient";

/**
 * Ported 1:1 from carbonature-saas/src/lib/site.ts#resolveProjectKeyForCrops.
 * Keep this in sync if the SaaS source changes — it decides which
 * FinancingProject (and therefore which credit-yield rates) a plot's farm
 * belongs to, from the farm's own registered crops.
 */
export function resolveProjectKeyForCrops(crops: unknown): "fruits" | "eafrica" {
  const isFruits =
    Array.isArray(crops) && crops.some((c) => /fruit|tree|plantation|orchard|avocado|mango|citrus|banana/i.test(String(c)));
  return isFruits ? "fruits" : "eafrica";
}

/**
 * Ported 1:1 from carbonature-saas/src/lib/creditYield.ts#isYoungAtStart.
 * Age is measured against the PROJECT'S start date, never today, so a plot
 * does not drift from one bracket to the other as time passes.
 */
export function isYoungAtStart(plantingDate: string, startDate: string, maxAgeYears: number): boolean | null {
  const planted = new Date(plantingDate);
  const start = new Date(startDate);
  if (Number.isNaN(planted.getTime()) || Number.isNaN(start.getTime())) return null;
  const cutoff = new Date(start);
  cutoff.setFullYear(cutoff.getFullYear() - maxAgeYears);
  return planted >= cutoff;
}

export interface PlotTypeContext {
  /** farm_id -> admin-set manual override, if any (mrv.farm_plot_type_overrides) — still wins over the computed value, for the rare case the real data is wrong or missing. */
  overrideByFarm: Map<string, string>;
  /** SaaS FinancingProject, keyed by its "fruits"/"eafrica" key — carries the real, admin-edited credit-yield rates and orchard-age threshold. */
  saasProjects: Map<string, SaasFinancingProject>;
  /** farm_id -> registered crops, the input to resolveProjectKeyForCrops. */
  cropsByFarm: Map<string, string[]>;
  /** plot_id -> planting_date, as entered by the farmer. */
  plantingDateByPlot: Map<string, string | null>;
}

/**
 * Loads everything needed to resolve every plot's type/rate in one pass.
 * Single source of truth is the SaaS's own settings + real plot data — MRV
 * no longer keeps a parallel static default (see saasClient.ts's
 * getSaasFinancingProjects/listFarmCropsByIds/listAllSaasPlotCropCycles).
 */
export async function loadPlotTypeContext(farmIds: string[]): Promise<PlotTypeContext> {
  const { query } = await import("../../db");
  const { getSaasFinancingProjects, listFarmCropsByIds, listAllSaasPlotCropCycles } = await import("../../saas/saasClient");
  const [overrides, projects, cropsByFarm, cycles] = await Promise.all([
    query<{ farm_id: string; plot_type: string }>(`SELECT farm_id, plot_type FROM mrv.farm_plot_type_overrides`),
    getSaasFinancingProjects(),
    listFarmCropsByIds(farmIds),
    listAllSaasPlotCropCycles(),
  ]);
  return {
    overrideByFarm: new Map(overrides.map((o) => [o.farm_id, o.plot_type])),
    saasProjects: new Map(projects.map((p) => [p.key, p])),
    cropsByFarm,
    plantingDateByPlot: new Map(cycles.map((c) => [c.id, c.planting_date])),
  };
}

function resolveProject(ctx: PlotTypeContext, farmId: string | null): SaasFinancingProject | undefined {
  const crops = farmId ? ctx.cropsByFarm.get(farmId) : undefined;
  return ctx.saasProjects.get(resolveProjectKeyForCrops(crops));
}

/**
 * A farm's manual override always wins (kept for the rare case real data is
 * wrong/missing); otherwise young-vs-mature is computed live from the plot's
 * real planting_date against the project's real start date and
 * youngMaxAgeYears — never a flat per-project assumption. Callers that only
 * need the label (johnAllocationSync.ts's rare new-plot fallback, which
 * still prices from mrv.credit_yield_rate_table) use this.
 */
export function resolvePlotType(ctx: PlotTypeContext, farmId: string | null, plotId?: string): string | undefined {
  if (farmId && ctx.overrideByFarm.has(farmId)) return ctx.overrideByFarm.get(farmId);
  const project = resolveProject(ctx, farmId);
  if (!project) return undefined;
  if (project.kind !== "plantation") return "open_field";
  const plantingDate = plotId ? ctx.plantingDateByPlot.get(plotId) : undefined;
  const young = plantingDate && project.startDate ? isYoungAtStart(plantingDate, project.startDate, project.youngMaxAgeYears) : null;
  // No planting date or no project start date set → cannot decide the bracket.
  // Treat as mature rather than guessing upward: an established stand is the
  // ordinary case, and over-crediting a plot is the more damaging error.
  return young === true ? "young_orchard" : "mature_orchard";
}

/**
 * Type AND rate together, sourced directly from the SaaS project's own
 * admin-edited numbers — no separate MRV rate table. Used by
 * johnCreditPotentialEstimate.ts, the weekly potential-credit estimate that
 * every plot's number ultimately comes from.
 */
export function resolvePlotAndRate(ctx: PlotTypeContext, farmId: string | null, plotId?: string): { plotType: string; ratePerHa: number } | undefined {
  const project = resolveProject(ctx, farmId);
  if (!project) return undefined;

  const overridden = farmId ? ctx.overrideByFarm.get(farmId) : undefined;
  const plotType = overridden ?? resolvePlotType(ctx, farmId, plotId);
  if (!plotType) return undefined;

  const ratePerHa =
    plotType === "young_orchard" ? project.youngCreditsPerHa : plotType === "mature_orchard" ? project.matureCreditsPerHa : project.creditsPerHa;
  return { plotType, ratePerHa };
}
