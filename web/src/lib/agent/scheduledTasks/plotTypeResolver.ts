import "server-only";

/**
 * Resolves every farm's plot type in one pass: a farm's own admin-set
 * `mrv.farms.plot_type_override` wins if set (young vs. mature orchard is
 * a real, meaningful distinction — 9 vs. 3 tCO2e/ha — with no other
 * signal to derive it from); otherwise falls back to that farm's
 * project's default (`mrv.project_plot_type_defaults`), exactly as
 * before this override existed (2026-09-01).
 */
export async function resolvePlotTypesByFarm(): Promise<Map<string, string>> {
  const { query } = await import("../../db");
  const [farms, defaults] = await Promise.all([
    query<{ farm_id: string; project_id: string; plot_type_override: string | null }>(
      `SELECT farm_id, project_id, plot_type_override FROM mrv.farms`,
    ),
    query<{ project_id: string; default_plot_type: string }>(`SELECT project_id, default_plot_type FROM mrv.project_plot_type_defaults`),
  ]);
  const defaultByProject = new Map(defaults.map((d) => [d.project_id, d.default_plot_type]));
  const byFarm = new Map<string, string>();
  for (const f of farms) {
    const resolved = f.plot_type_override ?? defaultByProject.get(f.project_id);
    if (resolved) byFarm.set(f.farm_id, resolved);
  }
  return byFarm;
}
