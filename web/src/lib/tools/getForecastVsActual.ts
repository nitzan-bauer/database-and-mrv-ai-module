import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface VintageReconciliation {
  vintageStart: string;
  vintageEnd: string;
  forecastTco2e: number;
  actualTco2e: number;
  deltaTco2e: number;
  status: "no_actual_yet" | "behind_forecast" | "on_or_ahead_of_forecast";
}

export interface ForecastVsActualResult {
  projectId: string;
  vintages: VintageReconciliation[];
}

/**
 * John's own stated QA role — "reconcile forecast-vs-actual" — over
 * whatever vintages recordPddForecast has captured. Real credits
 * (non-demo, status issued/retired/sold — the same "actual" standing
 * credit_allocation_qa uses) are summed per vintage year and compared
 * to the PDD's own declared forecast for that period. No model, no
 * invented trend line — arithmetic over two things already recorded.
 */
export async function getForecastVsActual(
  ctx: ToolContext,
  input: { projectId: string },
): Promise<ToolResult<ForecastVsActualResult>> {
  const guard = requireDbMode("getForecastVsActual");
  if (guard) return guard;

  const policy = await checkPolicy("get_forecast_vs_actual", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const { query } = await import("../db");

  const projects = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.projects WHERE project_id = $1`, [
    input.projectId,
  ]);
  if (Number(projects[0].n) === 0) return fail("getForecastVsActual: no such project.");

  // Cast to text and read the year by slicing the string, never by round-tripping
  // through a JS Date — pg's default date parser builds Date objects in the
  // server process's local timezone, and toISOString()/getFullYear() would
  // silently shift a UTC-midnight-adjacent date onto the wrong calendar day.
  const forecasts = await query<{
    vintage_start: string;
    vintage_end: string;
    estimated_net_tco2e: string;
  }>(
    `SELECT vintage_start::text AS vintage_start, vintage_end::text AS vintage_end, estimated_net_tco2e
       FROM mrv.pdd_forecast_vintages
      WHERE project_id = $1
      ORDER BY vintage_start`,
    [input.projectId],
  );
  if (!forecasts.length) {
    return fail("getForecastVsActual: this project has no recorded PDD forecast vintages yet.");
  }

  const vintages: VintageReconciliation[] = [];
  for (const f of forecasts) {
    const startYear = Number(f.vintage_start.slice(0, 4));
    const endYear = Number(f.vintage_end.slice(0, 4));

    const actual = await query<{ total: string }>(
      `SELECT coalesce(sum(c.credits_tco2e), 0)::text AS total
         FROM mrv.credits c
         JOIN mrv.plots p ON p.plot_id = c.plot_id
         JOIN mrv.farms f ON f.farm_id = p.farm_id
        WHERE f.project_id = $1 AND NOT c.is_demo
          AND c.status IN ('issued', 'retired', 'sold')
          AND c.vintage_year BETWEEN $2 AND $3`,
      [input.projectId, startYear, endYear],
    );

    const forecastTco2e = Number(f.estimated_net_tco2e);
    const actualTco2e = Number(actual[0].total);
    const deltaTco2e = Math.round((actualTco2e - forecastTco2e) * 10_000) / 10_000;

    vintages.push({
      vintageStart: f.vintage_start,
      vintageEnd: f.vintage_end,
      forecastTco2e,
      actualTco2e,
      deltaTco2e,
      status: actualTco2e === 0 ? "no_actual_yet" : deltaTco2e < 0 ? "behind_forecast" : "on_or_ahead_of_forecast",
    });
  }

  await audit(ctx, "get_forecast_vs_actual", { type: "project", id: input.projectId }, {
    vintagesReconciled: vintages.length,
  });

  return ok({ projectId: input.projectId, vintages });
}
