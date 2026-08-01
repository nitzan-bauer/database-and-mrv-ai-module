import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface PlotQaIssue {
  plotId: string;
  plotName: string;
  code: "INVALID_GEOMETRY" | "AREA_MISMATCH" | "APPLICATION_AREA_EXCEEDS_PLOT" | "OVERLAPPING_PLOTS";
  detail: string;
}

export interface PlotQaResult {
  farmId: string;
  plotsChecked: number;
  issues: PlotQaIssue[];
}

/**
 * Boundary and area QA/QC over a farm's plots — Rebeka's own responsibility,
 * in her own words: "run QA/QC on boundaries, areas and soil inputs before
 * every submission."
 *
 * Four checks, none of them needing a model:
 *
 *   - the polygon is geometrically valid (ST_IsValid). A self-intersecting
 *     ring is not really an area at all, and ST_Area on one is not
 *     reliable — so an invalid plot skips the area checks below rather
 *     than comparing against a number that means nothing yet.
 *   - the recorded area_ha matches the geometry's own measured area within
 *     a tolerance. 2% is the default because that is roughly the spread
 *     already present in this project's real plots (0.05%-0.58%) — wide
 *     enough not to flag ordinary GPS/digitising noise, narrow enough to
 *     catch a boundary redrawn after its area was typed in, or the
 *     reverse.
 *   - the applied area never exceeds the plot's own area — the area
 *     actually receiving the practice cannot be larger than the plot it
 *     sits inside.
 *   - no two plots on the same farm overlap. A hectare counted under two
 *     plots is a hectare of credits counted twice.
 *
 * A clean result says the boundaries are internally consistent — a
 * precondition for what gets built on top of them, not a claim of
 * eligibility on its own.
 */
export async function runPlotQaQc(
  ctx: ToolContext,
  input: { farmId: string; areaTolerancePct?: number },
): Promise<ToolResult<PlotQaResult>> {
  const guard = requireDbMode("runPlotQaQc");
  if (guard) return guard;

  const policy = await checkPolicy("run_plot_qa_qc", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const tolerance = input.areaTolerancePct ?? 2;
  if (!(tolerance > 0)) return fail("runPlotQaQc: areaTolerancePct must be a positive number.");

  const { query } = await import("../db");

  const plots = await query<{
    plot_id: string;
    name: string;
    area_ha: string;
    application_area_ha: string | null;
    is_valid: boolean;
    geo_area_ha: string;
  }>(
    `SELECT plot_id, name, area_ha, application_area_ha,
            ST_IsValid(geom) AS is_valid,
            (ST_Area(geom::geography) / 10000.0) AS geo_area_ha
       FROM mrv.plots WHERE farm_id = $1 ORDER BY plot_id`,
    [input.farmId],
  );
  if (!plots.length) return fail("runPlotQaQc: that farm has no plots to check.");

  const issues: PlotQaIssue[] = [];
  for (const p of plots) {
    if (!p.is_valid) {
      issues.push({
        plotId: p.plot_id,
        plotName: p.name,
        code: "INVALID_GEOMETRY",
        detail: "the polygon is not geometrically valid (self-intersecting or degenerate) — its area cannot be trusted until the boundary is redrawn",
      });
      continue;
    }

    const recorded = Number(p.area_ha);
    const measured = Number(p.geo_area_ha);
    const diffPct = recorded > 0 ? (Math.abs(recorded - measured) / recorded) * 100 : 100;
    if (diffPct > tolerance) {
      issues.push({
        plotId: p.plot_id,
        plotName: p.name,
        code: "AREA_MISMATCH",
        detail: `recorded ${recorded.toFixed(2)} ha vs the boundary's own ${measured.toFixed(2)} ha — ${diffPct.toFixed(1)}% apart, over the ${tolerance}% tolerance`,
      });
    }

    const appArea = p.application_area_ha == null ? null : Number(p.application_area_ha);
    if (appArea != null && appArea > recorded) {
      issues.push({
        plotId: p.plot_id,
        plotName: p.name,
        code: "APPLICATION_AREA_EXCEEDS_PLOT",
        detail: `application area ${appArea.toFixed(2)} ha exceeds the plot's own ${recorded.toFixed(2)} ha`,
      });
    }
  }

  const overlaps = await query<{ a: string; a_name: string; b: string; b_name: string }>(
    `SELECT a.plot_id AS a, a.name AS a_name, b.plot_id AS b, b.name AS b_name
       FROM mrv.plots a JOIN mrv.plots b
         ON a.farm_id = b.farm_id AND a.plot_id < b.plot_id
       WHERE a.farm_id = $1 AND ST_IsValid(a.geom) AND ST_IsValid(b.geom)
         AND ST_Overlaps(a.geom, b.geom)`,
    [input.farmId],
  );
  for (const o of overlaps) {
    issues.push({
      plotId: o.a,
      plotName: o.a_name,
      code: "OVERLAPPING_PLOTS",
      detail: `overlaps ${o.b_name} (${o.b}) on the same farm`,
    });
  }

  await audit(ctx, "run_plot_qa_qc", { type: "farm", id: input.farmId }, {
    plotsChecked: plots.length,
    areaTolerancePct: tolerance,
    issuesFound: issues.length,
    issues: issues.map((i) => ({ plotId: i.plotId, code: i.code })),
  });

  return ok({ farmId: input.farmId, plotsChecked: plots.length, issues });
}
