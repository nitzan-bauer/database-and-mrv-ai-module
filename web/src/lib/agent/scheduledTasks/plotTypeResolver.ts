import "server-only";

export interface PlotTypeMaps {
  /** farm_id -> admin-set override, if any (mrv.farm_plot_type_overrides). */
  overrideByFarm: Map<string, string>;
  /** SaaS project_id -> project default (mrv.project_plot_type_defaults). */
  defaultByProject: Map<string, string>;
}

/**
 * Loads the two independent lookups needed to resolve a plot's type — a
 * farm's own admin-set override wins if set (young vs. mature orchard is
 * a real, meaningful distinction — 9 vs. 3 tCO2e/ha — with no other
 * signal to derive it from); otherwise the farm's project's default
 * (2026-09-01). Callers combine these with whichever farm_id/project_id
 * they already have per-plot (never re-derive it from
 * mrv.credit_yield_estimates here — johnCreditPotentialEstimate.ts calls
 * this specifically to compute a NEW plot's FIRST estimate, before any
 * row for it exists there, so that table can't be the source of a
 * plot's project_id without breaking exactly that case).
 */
export async function loadPlotTypeMaps(): Promise<PlotTypeMaps> {
  const { query } = await import("../../db");
  const [overrides, defaults] = await Promise.all([
    query<{ farm_id: string; plot_type: string }>(`SELECT farm_id, plot_type FROM mrv.farm_plot_type_overrides`),
    query<{ project_id: string; default_plot_type: string }>(`SELECT project_id, default_plot_type FROM mrv.project_plot_type_defaults`),
  ]);
  return {
    overrideByFarm: new Map(overrides.map((o) => [o.farm_id, o.plot_type])),
    defaultByProject: new Map(defaults.map((d) => [d.project_id, d.default_plot_type])),
  };
}

export function resolvePlotType(maps: PlotTypeMaps, farmId: string | null, projectId: string): string | undefined {
  return (farmId && maps.overrideByFarm.get(farmId)) || maps.defaultByProject.get(projectId);
}
